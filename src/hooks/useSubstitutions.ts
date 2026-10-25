import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSubstitutionCaches, notifySubstituteAssigned } from "@/lib/substitutions";

export interface PendingSubstitution {
  id: string;
  date: string;
  slot_id: string;
  original_teacher_id: string | null;
  status: "pending" | "assigned" | "completed" | "cancelled" | "no_teacher_available";
  source: "manual" | "auto";
  class: {
    id: string;
    name: string;
    section: string | null;
  } | null;
  period: {
    period_number: number;
    label: string;
    start_time: string;
    end_time: string;
  } | null;
  original_teacher: {
    id: string;
    full_name: string;
  } | null;
}

const todayStr = () => format(new Date(), "yyyy-MM-dd");

/**
 * Pending substitutions for the signed-in coordinator's wing (admins
 * see the whole institution). Fetched via the existing
 * tt_substitutions_select RLS — institution-scoped — and narrowed
 * client-side using `useCoordinatorClasses`.
 */
export function usePendingSubstitutions(date: string = todayStr()) {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const isAdmin = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;
  const isCoordinator = roleInfo?.isCoordinator;
  const { classIds: coordinatorClassIds, isLoading: coordLoading } = useCoordinatorClasses();

  const query = useQuery({
    queryKey: ["substitutions", "pending", institutionId, date],
    queryFn: async (): Promise<PendingSubstitution[]> => {
      if (!institutionId) return [];

      // Two-step fetch: subs for the date + status, then a slot lookup.
      // PostgREST embedded resources for tt_slots → classes / period →
      // subject can recurse through the RLS we hardened in
      // 20260504100000_fix_tt_slots_rls_recursion, so we keep it explicit.
      // One school-day of pending covers is a few hundred rows at most (the
      // busiest school peaks near 200); the range is the backstop.
      const { data: subs, error: subsErr } = await supabase
        .from("tt_substitutions" as never)
        .select(
          "id, date, slot_id, original_teacher_id, status, source",
        )
        .eq("date", date)
        .eq("status", "pending")
        .range(0, 499);
      if (subsErr) throw subsErr;
      type SubRow = {
        id: string;
        date: string;
        slot_id: string;
        original_teacher_id: string | null;
        status: PendingSubstitution["status"];
        source: PendingSubstitution["source"];
      };
      const rows = (subs ?? []) as SubRow[];
      if (rows.length === 0) return [];

      const slotIds = [...new Set(rows.map((r) => r.slot_id))];
      const teacherIds = [
        ...new Set(rows.map((r) => r.original_teacher_id).filter((id): id is string => !!id)),
      ];

      const [slotsRes, teachersRes] = await Promise.all([
        supabase
          .from("tt_slots")
          .select(
            "id, class_id, period_slot_id, institution_id, " +
              "classes!tt_slots_class_id_fkey(id, name, section), " +
              "period_slot:tt_period_slots!tt_slots_period_slot_id_fkey(period_number, label, start_time, end_time)",
          )
          .in("id", slotIds),
        teacherIds.length > 0
          ? supabase
              .from("profiles")
              .select("id, full_name")
              .in("id", teacherIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (slotsRes.error) throw slotsRes.error;
      if (teachersRes.error) throw teachersRes.error;

      type SlotRow = {
        id: string;
        class_id: string;
        period_slot_id: string;
        institution_id: string;
        classes: { id: string; name: string; section: string | null } | null;
        period_slot: {
          period_number: number;
          label: string;
          start_time: string;
          end_time: string;
        } | null;
      };
      type ProfileRow = { id: string; full_name: string };
      const slotMap = new Map<string, SlotRow>();
      ((slotsRes.data ?? []) as unknown as SlotRow[]).forEach((s) => slotMap.set(s.id, s));
      const teacherMap = new Map<string, ProfileRow>();
      ((teachersRes.data ?? []) as ProfileRow[]).forEach((t) => teacherMap.set(t.id, t));

      // Filter for institution scope (defense-in-depth — RLS already does
      // this) and, if coordinator-only, the wing's class set.
      return rows
        .map((r): PendingSubstitution | null => {
          const slot = slotMap.get(r.slot_id);
          if (!slot) return null;
          if (slot.institution_id !== institutionId) return null;
          const cls = slot.classes;
          return {
            id: r.id,
            date: r.date,
            slot_id: r.slot_id,
            original_teacher_id: r.original_teacher_id,
            status: r.status,
            source: r.source,
            class: cls,
            period: slot.period_slot,
            original_teacher: r.original_teacher_id
              ? teacherMap.get(r.original_teacher_id) ?? null
              : null,
          };
        })
        .filter((r): r is PendingSubstitution => r !== null);
    },
    enabled: !!institutionId && (!isCoordinator || !coordLoading),
    // Pending covers turn over during the day as teachers check in and
    // covers are assigned; a minute keeps the list honest without polling.
    staleTime: 60_000,
  });

  // Coordinator wing-scope. Admins see everything. Memoized so the list
  // identity stays stable when nothing relevant changed.
  const visible = useMemo(() => {
    const all = query.data ?? [];
    if (isAdmin) return all;
    if (isCoordinator) {
      const wing = new Set(coordinatorClassIds);
      return all.filter((r) => r.class && wing.has(r.class.id));
    }
    return [];
  }, [query.data, isAdmin, isCoordinator, coordinatorClassIds]);

  return { ...query, data: visible };
}

export interface FreeTeacherCandidate {
  teacher_id: string;
  full_name: string;
  rank: number;
  same_subject: boolean;
  same_class_group: boolean;
  subs_today: number;
}

/**
 * Ranked candidates for a slot on a date. Wraps the
 * tt_get_free_teachers_for_slot SECURITY DEFINER RPC. Caller usually
 * passes the slot of a *pending* substitution.
 */
export function useFreeTeachersForSlot(slotId: string | null, date: string | null) {
  return useQuery({
    queryKey: ["substitutions", "free-teachers", slotId, date],
    queryFn: async (): Promise<FreeTeacherCandidate[]> => {
      if (!slotId || !date) return [];
      const { data, error } = await supabase.rpc(
        "tt_get_free_teachers_for_slot" as never,
        { p_slot_id: slotId, p_date: date } as never,
      );
      if (error) throw error;
      return (data ?? []) as FreeTeacherCandidate[];
    },
    enabled: !!slotId && !!date,
    // tt_assign_substitute re-checks availability on write, so a minute-old
    // list can at worst offer someone who has since been taken.
    staleTime: 60_000,
  });
}

/** Coordinator / admin accepts a candidate. Routes through the RPC. */
export function useAssignSubstitute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      substitutionId,
      substituteTeacherId,
    }: {
      substitutionId: string;
      substituteTeacherId: string;
    }) => {
      const { error } = await supabase.rpc(
        "tt_assign_substitute" as never,
        { p_sub_id: substitutionId, p_substitute_id: substituteTeacherId } as never,
      );
      if (error) throw error;
      return substitutionId;
    },
    onSuccess: (substitutionId) => {
      invalidateSubstitutionCaches(queryClient);
      toast.success("Substitute assigned");
      // This path never notified anyone, so a cover assigned here left the
      // substitute with no way of knowing they were covering a class.
      notifySubstituteAssigned(substitutionId);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't assign substitute.", context: "assignSubstitute" }),
  });
}
