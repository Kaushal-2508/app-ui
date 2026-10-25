import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { Json } from "@/integrations/supabase/types";
import type { CadenceUnit, TargetMetric } from "@/lib/targetPeriods";

/**
 * Every query and mutation for Teacher Targets. RPC names are `tgt_*`
 * (renamed from an earlier `tt_` draft to avoid colliding with the Timetable
 * module's own `tt_*` namespace — see 2026-09-15-teacher-targets.md Task 3).
 *
 * Every query sets an explicit staleTime and destructures `error`; every
 * mutation invalidates the `["teacher-targets"]` key and routes failures
 * through `toastError`, never a bare `toast.error(error.message)`.
 */

export interface TargetPeriodRow {
  period_index: number;
  period_start: string;
  period_end: string;
  target_value: number;
  achieved_value: number;
  status: "open" | "met" | "missed";
  /**
   * Exams that are fully marked but whose results have not been published, so
   * they do not count yet. Present on the OPEN period only: once a period is
   * closed there is nothing left to act on. Never added to achieved_value.
   */
  awaiting_results?: number;
}

export type TargetScope = "wing" | "teacher";
export type TargetStatus = "active" | "stopped" | "completed";

/** One row from `tgt_targets_overview` — an admin's or coordinator's view. */
export interface TeacherTargetRow {
  id: string;
  metric: TargetMetric;
  scope: TargetScope;
  wing_id: string | null;
  owner_id: string;
  parent_target_id: string | null;
  target_value: number;
  starts_on: string;
  ends_on: string;
  cadence_unit: CadenceUnit | null;
  cadence_n: number | null;
  status: TargetStatus;
  note: string | null;
  wing_name: string | null;
  owner_name: string | null;
  /** SUM of active children's target_value. Populated only for scope='wing'. */
  allocated: number | null;
  /** Count of active children. Populated only for scope='wing'. */
  teacher_count: number | null;
  open_period: TargetPeriodRow | null;
}

/** One row from `tgt_my_targets` — the caller's own teacher-scoped targets. */
export interface MyTargetRow {
  id: string;
  metric: TargetMetric;
  target_value: number;
  starts_on: string;
  ends_on: string;
  cadence_unit: CadenceUnit | null;
  cadence_n: number | null;
  status: TargetStatus;
  note: string | null;
  open_period: TargetPeriodRow | null;
  /** Up to 24 most recent closed periods, newest first. Stays populated after
   *  the target is stopped or completed so history remains readable. */
  history: TargetPeriodRow[];
}

interface TargetsOverviewPayload {
  ok: boolean;
  is_admin: boolean;
  targets: TeacherTargetRow[];
}

interface MyTargetsPayload {
  ok: boolean;
  targets: MyTargetRow[];
}

export function useTargetsOverview(metric?: TargetMetric) {
  return useQuery({
    queryKey: ["teacher-targets", "overview", metric ?? "all"],
    queryFn: async () => {
      const args = metric ? { _metric: metric } : {};
      const { data, error } = await supabase.rpc("tgt_targets_overview", args);
      if (error) throw error;
      return data as unknown as TargetsOverviewPayload;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useMyTargets() {
  return useQuery({
    queryKey: ["teacher-targets", "mine"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tgt_my_targets");
      if (error) throw error;
      return (data as unknown as MyTargetsPayload).targets;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface CreateWingTargetVars {
  wingId: string;
  coordinatorId: string;
  metric: TargetMetric;
  targetValue: number;
  /** "YYYY-MM-DD" */
  startsOn: string;
  /** "YYYY-MM-DD" */
  endsOn: string;
  cadenceUnit?: CadenceUnit | null;
  cadenceN?: number | null;
  note?: string | null;
}

export function useCreateWingTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: CreateWingTargetVars) => {
      const { data, error } = await supabase.rpc("tgt_create_wing_target", {
        _wing_id: vars.wingId,
        _coordinator_id: vars.coordinatorId,
        _metric: vars.metric,
        _target_value: vars.targetValue,
        _starts_on: vars.startsOn,
        _ends_on: vars.endsOn,
        _cadence_unit: vars.cadenceUnit ?? undefined,
        _cadence_n: vars.cadenceN ?? undefined,
        _note: vars.note ?? undefined,
      });
      if (error) throw error;
      return data as unknown as { ok: boolean; target_id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-targets"] });
      toast.success("Wing target set. The coordinator has been notified.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't set this wing target.", context: "createWingTarget" }),
  });
}

export interface SplitAllocation {
  teacher_id: string;
  value: number;
}

export interface SplitWingTargetResult {
  ok: boolean;
  teachers: number;
  allocated: number;
  pool: number;
  gap: number;
}

export function useSplitWingTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { parentId: string; allocations: SplitAllocation[] }) => {
      const { data, error } = await supabase.rpc("tgt_split_wing_target", {
        _parent_id: vars.parentId,
        _allocations: vars.allocations as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as SplitWingTargetResult;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["teacher-targets"] });
      toast.success(
        r.gap === 0
          ? `Shared out across ${r.teachers} teachers.`
          : `Shared out ${r.allocated} of ${r.pool}. ${r.gap} still to allocate.`,
      );
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't share out this target.", context: "splitWingTarget" }),
  });
}

export interface CreateTeacherTargetsVars {
  metric: TargetMetric;
  targetValue: number;
  /** "YYYY-MM-DD" */
  startsOn: string;
  /** "YYYY-MM-DD" */
  endsOn: string;
  teacherIds: string[];
  cadenceUnit?: CadenceUnit | null;
  cadenceN?: number | null;
  note?: string | null;
}

export function useCreateTeacherTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: CreateTeacherTargetsVars) => {
      const { data, error } = await supabase.rpc("tgt_create_teacher_targets", {
        _metric: vars.metric,
        _target_value: vars.targetValue,
        _starts_on: vars.startsOn,
        _ends_on: vars.endsOn,
        _teacher_ids: vars.teacherIds,
        _cadence_unit: vars.cadenceUnit ?? undefined,
        _cadence_n: vars.cadenceN ?? undefined,
        _note: vars.note ?? undefined,
      });
      if (error) throw error;
      return data as unknown as { ok: boolean; created: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["teacher-targets"] });
      toast.success(`Target set for ${r.created} teacher${r.created === 1 ? "" : "s"}.`);
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't set this target.", context: "createTeacherTargets" }),
  });
}

export function useStopTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetId: string) => {
      const { data, error } = await supabase.rpc("tgt_stop_target", { _target_id: targetId });
      if (error) throw error;
      return data as unknown as { ok: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-targets"] });
      toast.success("Target stopped.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't stop this target.", context: "stopTarget" }),
  });
}

export interface WingTeacherRow {
  id: string;
  full_name: string;
  email: string;
}

/**
 * The teachers of a wing, for the split-a-pool picker.
 *
 * MUST come from this RPC, never from `wing_assignments` / `useWingMembers`.
 * `wing_assignments` is the wing-to-COORDINATOR edge: at Salci National the
 * Senior Wing has 34 teachers via the class path but only 2 rows there, and its
 * RLS shows a coordinator nothing but their own row, so a coordinator opening
 * the split sheet saw a list containing only themselves. `tgt_wing_teachers`
 * resolves wing_class_mappings -> ACTIVE classes -> class_assignments(teacher)
 * under SECURITY DEFINER, which is the same definition WingsPage and
 * coordinator_covers_task already use.
 */
export function useWingTeachers(wingId: string | null) {
  return useQuery({
    queryKey: ["teacher-targets", "wing-teachers", wingId],
    enabled: !!wingId,
    queryFn: async () => {
      if (!wingId) return [] as WingTeacherRow[];
      const { data, error } = await supabase.rpc("tgt_wing_teachers", { _wing_id: wingId });
      if (error) throw error;
      return (data ?? []) as WingTeacherRow[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
