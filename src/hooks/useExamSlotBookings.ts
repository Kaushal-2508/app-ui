import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExamSlotBookingsPayload } from "@/lib/examSlots";

interface UseExamSlotBookingsArgs {
  classIds: string[];
  from: Date | null;
  to: Date | null;
  /** The exam being scheduled, so it never clashes with itself. */
  excludeExamId?: string | null;
  /** Its subjects: bookings in the same optional group come back runs_alongside. */
  subjectIds?: string[];
  enabled?: boolean;
}

function uniqueSorted(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => !!id && id.trim() !== ""))).sort();
}

/**
 * Booked exam slots for the sections an exam is being scheduled into, from
 * the scoped get_exam_slot_bookings RPC (migration 20260928170000). The RPC
 * returns bookings only for sections the caller may see and marks the rest
 * `authorized: false`, so a teacher never sees another class's timetable.
 *
 * Bounded by construction: at most 50 sections and a 45-day range (enforced
 * server-side), 500 rows max.
 */
export function useExamSlotBookings({
  classIds,
  from,
  to,
  excludeExamId,
  subjectIds,
  enabled = true,
}: UseExamSlotBookingsArgs) {
  const classKey = useMemo(() => uniqueSorted(classIds), [classIds]);
  const subjectKey = useMemo(() => uniqueSorted(subjectIds), [subjectIds]);
  const fromIso = from ? from.toISOString() : null;
  const toIso = to ? to.toISOString() : null;

  return useQuery({
    queryKey: ["exam-slot-bookings", classKey, fromIso, toIso, excludeExamId ?? null, subjectKey],
    queryFn: async (): Promise<ExamSlotBookingsPayload> => {
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>)("get_exam_slot_bookings", {
        _class_ids: classKey,
        _from: fromIso,
        _to: toIso,
        _exclude_exam_id: excludeExamId ?? null,
        _subject_ids: subjectKey.length > 0 ? subjectKey : null,
      });
      if (error) throw error;
      const payload = (data ?? {}) as Partial<ExamSlotBookingsPayload>;
      return {
        classes: Array.isArray(payload.classes) ? payload.classes : [],
        bookings: Array.isArray(payload.bookings) ? payload.bookings : [],
      };
    },
    enabled: enabled && classKey.length > 0 && !!fromIso && !!toIso,
    // Fresh on every open of the sheet comes from useExamSlotPlan, which
    // refetches when it opens: refetchOnMount cannot do it, because the
    // observer mounts while the sheet is closed (enabled = false).
    staleTime: 60_000,
    // Other teachers' bookings stay out of localStorage (shared devices), and a
    // reload never paints yesterday's slots before the refetch lands.
    meta: { persist: false },
  });
}
