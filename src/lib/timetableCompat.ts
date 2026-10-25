// =============================================================
// timetableCompat — internal shim for the post-rebuild schema.
// Existing public APIs (currentAcademicYear, useAcademicCalendar,
// getCoverageForClassSubject) keep their signatures; their
// implementation reads cal_*/tt_* tables from this module.
// External imports do NOT change. This file is the only place
// that knows about the new schema during Plan 1.
// =============================================================

import { supabase } from "@/integrations/supabase/client";

// -------------------------------------------------------------
// currentAcademicYear — preserves the legacy date-based contract.
// Reads cal_academic_years.is_active when available; falls back
// to the original month-based heuristic. Pure function (no async)
// to keep call-sites unchanged.
// -------------------------------------------------------------
export function currentAcademicYearFromDate(today = new Date()): string {
  const month = today.getMonth() + 1;
  const year  = today.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Async variant that prefers cal_academic_years.is_active when set.
// Falls back silently if the table is empty or the institution has
// no active row.
export async function currentAcademicYearActive(institutionId: string | null | undefined): Promise<string> {
  if (!institutionId) return currentAcademicYearFromDate();
  const { data, error } = await supabase
    .from("cal_academic_years" as never)
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return currentAcademicYearFromDate();
  return (data as unknown as { code: string }).code;
}

// -------------------------------------------------------------
// Calendar event row shape — matches the LEGACY shape so that
// existing AcademicCalendarEvent consumers don't break. Internal
// reads pull from cal_events, internal writes push to cal_events.
// -------------------------------------------------------------
export type CompatAcademicEventType =
  | "holiday"
  | "exam_block"
  | "ptm"
  | "special_event";

export interface CompatAcademicCalendarEvent {
  id: string;
  institution_id: string;
  academic_year: string;
  title: string;
  date: string;            // legacy: starts_on -> date
  end_date: string | null; // legacy: ends_on   -> end_date (null when single-day)
  event_type: CompatAcademicEventType;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const KIND_TO_LEGACY: Record<string, CompatAcademicEventType> = {
  holiday: "holiday",
  exam_block: "exam_block",
  // We collapsed ptm + special_event into "event" on cal_events.
  // Map both back to "special_event" — close enough for downstream
  // consumers that only branch on holiday/exam_block.
  event: "special_event",
};

const LEGACY_TO_KIND: Record<CompatAcademicEventType, string> = {
  holiday: "holiday",
  exam_block: "exam_block",
  ptm: "event",
  special_event: "event",
};

interface CalEventRow {
  id: string;
  institution_id: string;
  academic_year: string;
  title: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEvent(row: CalEventRow): CompatAcademicCalendarEvent {
  return {
    id: row.id,
    institution_id: row.institution_id,
    academic_year: row.academic_year,
    title: row.title,
    date: row.starts_on,
    end_date: row.ends_on === row.starts_on ? null : row.ends_on,
    event_type: KIND_TO_LEGACY[row.kind] ?? "special_event",
    description: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchCalendarEvents(
  institutionId: string,
  academicYear: string,
): Promise<CompatAcademicCalendarEvent[]> {
  const { data, error } = await supabase
    .from("cal_events" as never)
    .select("*")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .order("starts_on", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as CalEventRow[]).map(rowToEvent);
}

export interface CompatEventInput {
  title: string;
  date: string;
  end_date?: string | null;
  event_type: CompatAcademicEventType;
  description?: string | null;
}

export async function insertCalendarEvent(
  institutionId: string,
  academicYear: string,
  input: CompatEventInput,
): Promise<CompatAcademicCalendarEvent> {
  const { data: userRes } = await supabase.auth.getUser();
  const ends_on = input.end_date ?? input.date;
  const { data, error } = await supabase
    .from("cal_events" as never)
    .insert({
      institution_id: institutionId,
      academic_year: academicYear,
      title: input.title,
      kind: LEGACY_TO_KIND[input.event_type],
      starts_on: input.date,
      ends_on,
      notes: input.description ?? null,
      created_by: userRes.user?.id ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data as unknown as CalEventRow);
}

export async function updateCalendarEvent(
  id: string,
  input: CompatEventInput,
): Promise<CompatAcademicCalendarEvent> {
  const ends_on = input.end_date ?? input.date;
  const { data, error } = await supabase
    .from("cal_events" as never)
    .update({
      title: input.title,
      kind: LEGACY_TO_KIND[input.event_type],
      starts_on: input.date,
      ends_on,
      notes: input.description ?? null,
    } as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data as unknown as CalEventRow);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from("cal_events" as never).delete().eq("id", id);
  if (error) throw error;
}

// -------------------------------------------------------------
// Coverage read — mirrors the legacy lesson_plans SELECT used by
// syllabusCoverage.ts. Returns rows with the same column names so
// the caller's reduce loop stays unchanged.
// -------------------------------------------------------------
export interface CompatCoveragePlanRow {
  topic_id: string | null;
  status: "planned" | "done" | "skipped" | "pending";
  session_type: "teaching" | "test" | "doubt_session" | "other";
  class_id: string;
  subject_id: string | null;
}

export async function fetchCoveragePlans(args: {
  classId: string;
  subjectId: string;
  chapterIds: string[];
}): Promise<CompatCoveragePlanRow[]> {
  if (args.chapterIds.length === 0) return [];
  const { data, error } = await supabase
    .from("tt_lesson_plans" as never)
    .select("topic_id, status, session_type, class_id, subject_id")
    .eq("class_id", args.classId)
    .eq("subject_id", args.subjectId)
    .in("topic_id", args.chapterIds);
  if (error) throw error;
  const planRows = (data ?? []) as unknown as CompatCoveragePlanRow[];

  const { data: events, error: eventsError } = await supabase
    .from("syllabus_progress_events" as never)
    .select("topic_id, class_id, subject_id")
    .eq("class_id", args.classId)
    .eq("subject_id", args.subjectId)
    .eq("action", "completed")
    .in("topic_id", args.chapterIds);
  if (eventsError) throw eventsError;
  // Jar completions count as done teaching rows — closes the
  // "more chapters completed than free periods that day" coverage gap.
  const eventRows = ((events ?? []) as unknown as Array<{ topic_id: string; class_id: string; subject_id: string }>).map(
    (r) => ({
      topic_id: r.topic_id,
      status: "done",
      session_type: "teaching",
      class_id: r.class_id,
      subject_id: r.subject_id,
    }),
  );
  return ([...planRows, ...eventRows]) as CompatCoveragePlanRow[];
}
