import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";

export interface PendingGroup {
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  filled: boolean;
}
export interface PendingSyllabusDay {
  date: string;
  is_today: boolean;
  groups: PendingGroup[];
}
export interface PendingSyllabusDays {
  unresolved_day_count: number;
  days: PendingSyllabusDay[];
}

/** Days with ≥1 (class, subject) group missing a jar entry (past, optionally today). */
export function useTeacherPendingSyllabusDays(opts: { includeToday: boolean; enabled?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-pending-syllabus-days", user?.id, opts.includeToday],
    enabled: (opts.enabled ?? true) && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PendingSyllabusDays> => {
      const { data, error } = await supabase.rpc("teacher_pending_syllabus_days", {
        p_include_today: opts.includeToday,
      });
      if (error) throw error;
      return (data as unknown as PendingSyllabusDays) ?? { unresolved_day_count: 0, days: [] };
    },
  });
}

export type ChapterAction = "completed" | "partial";
export interface ChapterProgressState {
  topic_id: string;
  topic_name: string;
  chapter_number: number | null;
  position: number;
  status: "completed" | "partial" | "untouched";
  action_on_date: ChapterAction | null;
}

/** Chapter working set for one (class, subject): status + what's recorded for `date`. */
export function useSyllabusProgressState(args: { classId: string; subjectId: string; date?: string | null } | null) {
  return useQuery({
    queryKey: ["syllabus-progress-state", args?.classId, args?.subjectId, args?.date],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<ChapterProgressState[]> => {
      if (!args) return [];
      const { data, error } = await supabase.rpc("syllabus_progress_state", {
        p_class_id: args.classId,
        p_subject_id: args.subjectId,
        p_date: args.date ?? null,
      });
      if (error) throw error;
      return (data as unknown as ChapterProgressState[]) ?? [];
    },
  });
}

export interface SyllabusEntryTime {
  topic_id: string;
  created_at: string;
}

/**
 * When each chapter entry for one (class, subject, date) was typed in. A day
 * logged three weeks after it happened reads exactly like one logged at the
 * bell unless someone shows this. Keyed under "syllabus-progress-state" so
 * every write that refreshes the chapter state refreshes this too.
 */
export function useSyllabusEntryTimes(args: { classId: string; subjectId: string; date: string } | null) {
  return useQuery({
    queryKey: ["syllabus-progress-state", "entered-at", args?.classId, args?.subjectId, args?.date],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<SyllabusEntryTime[]> => {
      if (!args) return [];
      const { data, error } = await supabase
        .from("syllabus_progress_events")
        .select("topic_id, created_at")
        .eq("class_id", args.classId)
        .eq("subject_id", args.subjectId)
        .eq("date", args.date)
        // One row per chapter logged that day, so this never binds in practice.
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The single jar write path — event upsert + coverage dual-write in one RPC transaction. */
export function useRecordSyllabusProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      classId: string; subjectId: string; topicId: string;
      date: string; action: ChapterAction; source: "checkout" | "checkin" | "correction";
    }) => {
      const { error } = await supabase.rpc("record_syllabus_progress", {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_topic_id: input.topicId,
        p_date: input.date,
        p_action: input.action,
        p_source: input.source,
      });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't save syllabus progress.", context: "recordSyllabusProgress" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan"] });
      // My Week reads a period's logged status from the projection's `actual`
      // list and the week's plan rows (a Completed entry flips one to done).
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "teacher-plans-week"] });
    },
  });
}

export interface ProjectedPeriod {
  date: string;
  slot_id: string;
  class_id: string;
  subject_id: string;
  topic_id: string;
  topic_name: string;
  chapter_ord: number;
}
export interface ActualEntry {
  date: string;
  class_id: string;
  subject_id: string;
  topic_id: string;
  topic_name: string;
  action: ChapterAction;
}
export interface ProjectionOverflow {
  class_id: string;
  subject_id: string;
  unscheduled: number;
}
export interface TeacherProjection {
  projected: ProjectedPeriod[];
  actual: ActualEntry[];
  overflow: ProjectionOverflow[];
}

/** Auto-timeline for the calling teacher's slots in [from, to] + actual entries for the window. */
export function useTeacherProjection(args: { fromIso: string; toIso: string; enabled?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["syllabus-projection", "teacher", user?.id, args.fromIso, args.toIso],
    enabled: (args.enabled ?? true) && !!user?.id && !!args.fromIso && !!args.toIso,
    staleTime: 60_000,
    queryFn: async (): Promise<TeacherProjection> => {
      const { data, error } = await supabase.rpc("teacher_projection_for_range", {
        p_from: args.fromIso,
        p_to: args.toIso,
      });
      if (error) throw error;
      return (data as unknown as TeacherProjection) ?? { projected: [], actual: [], overflow: [] };
    },
  });
}

/** Auto-timeline for one class (student week grid). */
export function useClassProjection(args: { classId: string; fromIso: string; toIso: string } | null) {
  return useQuery({
    queryKey: ["syllabus-projection", "class", args?.classId, args?.fromIso, args?.toIso],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<ProjectedPeriod[]> => {
      if (!args) return [];
      const { data, error } = await supabase.rpc("class_projection_for_range", {
        p_class_id: args.classId,
        p_from: args.fromIso,
        p_to: args.toIso,
      });
      if (error) throw error;
      const parsed = data as unknown as { projected: ProjectedPeriod[] } | null;
      return parsed?.projected ?? [];
    },
  });
}

/** Rewrite the remaining-chapter order for one (class, subject). Auto wins:
 *  the projection recomputes from this order on the next read. */
export function useReorderChapters() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      classId: string; subjectId: string; institutionId: string; orderedTopicIds: string[];
    }) => {
      const rows = input.orderedTopicIds.map((topicId, idx) => ({
        institution_id: input.institutionId,
        class_id: input.classId,
        subject_id: input.subjectId,
        topic_id: topicId,
        position: idx + 1,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("syllabus_sequence")
        .upsert(rows, { onConflict: "class_id,subject_id,topic_id" });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't reorder the chapters.", context: "reorderChapters" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
    },
  });
}

/** A note-only log on one period of a day (a surprise test, an activity). */
export interface SyllabusDayNote {
  id: string;
  slot_id: string;
  note: string | null;
  created_at: string;
}

/**
 * The note(s) logged for one (class, subject, date). A day can carry a note
 * AND chapter entries (one period taught, another a test), so the editor reads
 * this beside the chapter state rather than inferring it from "filled". Keyed
 * under "syllabus-progress-state" so every syllabus write refreshes it.
 */
export function useSyllabusDayNotes(args: { classId: string; subjectId: string; date: string } | null) {
  return useQuery({
    queryKey: ["syllabus-progress-state", "day-notes", args?.classId, args?.subjectId, args?.date],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<SyllabusDayNote[]> => {
      if (!args) return [];
      const { data, error } = await supabase
        .from("tt_lesson_plans" as never)
        .select("id, slot_id, note, created_at")
        .eq("class_id", args.classId)
        .eq("subject_id", args.subjectId)
        .eq("date", args.date)
        .eq("is_note_only", true)
        .order("created_at")
        // One per period at most; a school day has a handful of periods.
        .limit(20);
      if (error) throw error;
      return (data as unknown as SyllabusDayNote[]) ?? [];
    },
  });
}

export interface EditSyllabusDayInput {
  classId: string;
  subjectId: string;
  date: string;
  source: "checkout" | "checkin" | "correction";
  /** Chapter entries to take off this day. */
  removeTopicIds?: string[];
  /** Chapter entries to add, or to change between Completed and Partial. */
  set?: { topicId: string; action: ChapterAction }[];
  /** Save (or rewrite) the day's note. */
  note?: string;
  /** The period whose note is edited or cleared; omit to let the server pick. */
  noteSlotId?: string | null;
  clearNote?: boolean;
}

/**
 * Every edit of one day's syllabus log, in ONE transaction (edit_syllabus_day,
 * migration 20260929120000): removals, then clearing the note, then entries,
 * then the note, so a chapter can be swapped for a note (or back) without the
 * day ever being half-changed. It calls the same single write paths
 * (record_ / delete_syllabus_progress, tt_record_period_note) server-side.
 */
export function useEditSyllabusDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditSyllabusDayInput) => {
      const { error } = await supabase.rpc("edit_syllabus_day" as never, {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_date: input.date,
        p_remove_topic_ids: input.removeTopicIds ?? [],
        p_set: (input.set ?? []).map((s) => ({ topic_id: s.topicId, action: s.action })),
        p_note: input.note ?? null,
        p_note_slot_id: input.noteSlotId ?? null,
        p_clear_note: input.clearNote ?? false,
        p_source: input.source,
      } as never);
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't save the syllabus log.", context: "editSyllabusDay" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      // A note or a Completed entry changes the day's lesson-plan rows too.
      queryClient.invalidateQueries({ queryKey: ["timetable-v2"] });
    },
  });
}

/** Corrections: delete one jar entry (and revert its dual-written done row). */
export function useDeleteSyllabusProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classId: string; subjectId: string; topicId: string; date: string }) => {
      const { error } = await supabase.rpc("delete_syllabus_progress", {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_topic_id: input.topicId,
        p_date: input.date,
      });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't remove the entry.", context: "deleteSyllabusProgress" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "teacher-plans-week"] });
    },
  });
}
