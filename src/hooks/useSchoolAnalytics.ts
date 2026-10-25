import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * School Analytics data layer.
 *
 * Every figure on /school/analytics is aggregated by one of five SECURITY
 * DEFINER RPCs (migration 20260910190000). Nothing is counted, summed or banded
 * in the browser: the surface has to hold a 1,376-exam / 19,500-attempt school
 * (Alliance) as comfortably as a 113-exam one, and the version this replaced
 * fetched whole tables and reduced them client-side.
 *
 * The window comes from `dash_range_window`, the same helper the Command Center
 * uses, so "last 3 months" means the identical span on both surfaces.
 */

// ── Window ───────────────────────────────────────────────────────────────────

export const ANALYTICS_RANGES = [
  { value: "tm", label: "This month" },
  { value: "1m", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "ay", label: "Academic year" },
] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]["value"];

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "ay";

export function rangeLabel(range: AnalyticsRange): string {
  return ANALYTICS_RANGES.find((r) => r.value === range)?.label ?? "Academic year";
}

// ── Score bands ──────────────────────────────────────────────────────────────

/** Band ids are produced by the RPC; the order here is the display order. */
export const SCORE_BANDS = [
  { band: "lt35", label: "Under 35%", short: "<35" },
  { band: "b35_49", label: "35 to 49%", short: "35-49" },
  { band: "b50_69", label: "50 to 69%", short: "50-69" },
  { band: "b70_89", label: "70 to 89%", short: "70-89" },
  { band: "b90plus", label: "90% and above", short: "90+" },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number]["band"];

// ── Payload shapes (mirror the RPC jsonb exactly, do not widen) ──────────────

export interface AnalyticsWindow {
  range: AnalyticsRange;
  from: string;
  to: string;
  /** False when "Academic year" fell back to a trailing 12 months (platform scope). */
  range_is_exact?: boolean;
  prev_from?: string;
  prev_to?: string;
  class_id?: string | null;
}

export interface OverviewPayload {
  institution: { id: string; name: string; timezone: string } | null;
  window: AnalyticsWindow;
  roster: { students: number; teachers: number; classes: number };
  performance: {
    results: number;
    /** Where the marks came from. A mark entered from an offline paper exists
     *  for students who have never signed in, which is most of them at some
     *  schools, so the split has to be visible next to the totals. */
    results_online: number;
    results_offline: number;
    absent_results: number;
    students_assessed: number;
    avg_pct: number | null;
    pass_rate: number | null;
    prev_avg_pct: number | null;
    prev_pass_rate: number | null;
    prev_results: number;
  };
  pipeline: {
    exams_in_window: number;
    exams_draft: number;
    exams_scored: number;
    exams_with_results: number;
    exams_awaiting_results: number;
    attempts_submitted: number;
    results_published: number;
    awaiting_evaluation: number;
    awaiting_result: number;
    /** Hybrid papers live on a separate plane and can never carry a score. */
    exams_hybrid: number;
    /** Combined papers whose one score is attributed to each of their subjects. */
    multi_subject_exams: number;
  };
  distribution: { band: ScoreBand; label: string; students: number }[];
  subjects: {
    subject_id: string;
    subject_name: string;
    avg_pct: number | null;
    results: number;
    exams: number;
    pass_rate: number | null;
  }[];
  trend: {
    exam_id: string;
    title: string;
    exam_type: string;
    exam_date: string;
    avg_pct: number | null;
    participation: number;
  }[];
}

export interface ClassRow {
  class_id: string;
  name: string;
  section: string | null;
  /** False for a deactivated class that still carries results in this window. */
  is_active: boolean;
  roster: number;
  results: number;
  students_assessed: number;
  absent_results: number;
  avg_pct: number | null;
  pass_rate: number | null;
  awaiting_results: number;
  flagged_sessions: number;
}

export interface ExamRow {
  exam_id: string;
  title: string;
  exam_type: string;
  status: string;
  mode: string;
  is_results_only: boolean;
  exam_date: string;
  total_marks: number | null;
  subjects: string | null;
  classes: string | null;
  assigned: number;
  attempted: number;
  /** Papers actually written: attempted minus those marked absent. */
  sat: number;
  results: number;
  absent: number;
  avg_pct: number | null;
  pass_rate: number | null;
  flagged_sessions: number;
}

export interface StudentRow {
  student_id: string;
  full_name: string;
  avatar_path: string | null;
  class_id: string | null;
  class_name: string | null;
  section: string | null;
  results: number;
  avg_pct: number | null;
  pass_rate: number | null;
  band: ScoreBand;
}

export interface IntegrityPayload {
  scope: "institution" | "platform";
  window: AnalyticsWindow;
  /** How many distinct event types and flagged exams exist behind the top 8. */
  event_types_total: number;
  exams_total: number;
  sessions: {
    total: number;
    requires_review: number;
    pending: number;
    reviewed: number;
    cleared: number;
    flagged: number;
    settled: number;
  };
  severity: { high: number; medium: number; low: number; total: number };
  event_types: { event_type: string; events: number }[];
  exams: {
    exam_id: string;
    title: string;
    institution_name: string | null;
    exam_date: string;
    sessions: number;
    flagged: number;
    flag_rate: number | null;
  }[];
}

interface Paged<T> {
  window: AnalyticsWindow;
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

export type ClassesPayload = Paged<ClassRow>;
export type ExamsPayload = Paged<ExamRow>;
export type StudentsPayload = Paged<StudentRow> & { band: ScoreBand | null };

/** Index signature so the object satisfies the generated `Json` arg type. */
export interface ExamFilters {
  [key: string]: string | undefined;
  status?: string;
  class_id?: string;
  subject_id?: string;
  exam_type?: string;
  mode?: string;
}

// ── Shared query options ─────────────────────────────────────────────────────

/**
 * 60s stale time (CLAUDE.md §23) and no refetch on focus: these are heavy
 * institution-wide aggregates and a principal tabbing back to the window does
 * not need them recomputed.
 */
const BASE = { staleTime: 60_000, refetchOnWindowFocus: false } as const;

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useAnalyticsOverview(
  institutionId: string | null,
  range: AnalyticsRange,
  classId: string | null,
) {
  return useQuery({
    ...BASE,
    queryKey: ["school-analytics", "overview", institutionId, range, classId],
    enabled: !!institutionId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<OverviewPayload> => {
      const { data, error } = await supabase.rpc("school_analytics_overview", {
        _institution_id: institutionId!,
        _range: range,
        _class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as OverviewPayload;
    },
  });
}

export function useAnalyticsClasses(
  institutionId: string | null,
  range: AnalyticsRange,
  classId: string | null,
  opts: { assessedOnly: boolean; sort: string; limit: number; offset: number },
) {
  return useQuery({
    ...BASE,
    queryKey: [
      "school-analytics",
      "classes",
      institutionId,
      range,
      classId,
      opts.assessedOnly,
      opts.sort,
      opts.limit,
      opts.offset,
    ],
    enabled: !!institutionId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ClassesPayload> => {
      const { data, error } = await supabase.rpc("school_analytics_classes", {
        _institution_id: institutionId!,
        _range: range,
        _class_id: classId ?? undefined,
        _assessed_only: opts.assessedOnly,
        _sort: opts.sort,
        _limit: opts.limit,
        _offset: opts.offset,
      });
      if (error) throw error;
      return data as unknown as ClassesPayload;
    },
  });
}

export function useAnalyticsExams(
  institutionId: string | null,
  range: AnalyticsRange,
  filters: ExamFilters,
  opts: { limit: number; offset: number },
) {
  return useQuery({
    ...BASE,
    queryKey: ["school-analytics", "exams", institutionId, range, filters, opts.limit, opts.offset],
    enabled: !!institutionId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ExamsPayload> => {
      const { data, error } = await supabase.rpc("school_analytics_exams", {
        _institution_id: institutionId!,
        _range: range,
        _filters: filters,
        _limit: opts.limit,
        _offset: opts.offset,
      });
      if (error) throw error;
      return data as unknown as ExamsPayload;
    },
  });
}

export function useAnalyticsStudents(
  institutionId: string | null,
  range: AnalyticsRange,
  classId: string | null,
  band: ScoreBand | null,
  opts: { limit: number; offset: number; enabled: boolean },
) {
  return useQuery({
    ...BASE,
    queryKey: [
      "school-analytics",
      "students",
      institutionId,
      range,
      classId,
      band,
      opts.limit,
      opts.offset,
    ],
    enabled: !!institutionId && opts.enabled,
    // Deliberately NO keepPreviousData: the band is part of the sheet's title,
    // so holding the last band's rows would list the wrong students under the
    // new heading. A short skeleton is honest; stale rows are not.
    queryFn: async (): Promise<StudentsPayload> => {
      const { data, error } = await supabase.rpc("school_analytics_students", {
        _institution_id: institutionId!,
        _range: range,
        _class_id: classId ?? undefined,
        _band: band ?? undefined,
        _limit: opts.limit,
        _offset: opts.offset,
      });
      if (error) throw error;
      return data as unknown as StudentsPayload;
    },
  });
}

/**
 * `platform` is the super-admin, all-institutions view. It exists because the
 * hook this replaced fetched every proctoring session on the platform into the
 * browser (2,914 rows against a silent 1,000-row cap) and filtered them there.
 */
export function useAnalyticsIntegrity(
  institutionId: string | null,
  range: AnalyticsRange,
  classId: string | null,
  platform = false,
) {
  return useQuery({
    ...BASE,
    queryKey: [
      "school-analytics",
      "integrity",
      platform ? "platform" : institutionId,
      range,
      platform ? null : classId,
    ],
    enabled: platform || !!institutionId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<IntegrityPayload> => {
      const { data, error } = await supabase.rpc("school_analytics_integrity", {
        _institution_id: platform ? undefined : institutionId!,
        _range: range,
        _class_id: platform ? undefined : (classId ?? undefined),
        _platform: platform,
      });
      if (error) throw error;
      return data as unknown as IntegrityPayload;
    },
  });
}

/**
 * Class options for the page filter. Deliberately not `useDashboardClassList`:
 * that one reads the caller's own institution, which is the wrong school when a
 * super admin is inspecting someone else's analytics.
 */
export function useAnalyticsClassOptions(institutionId: string | null) {
  return useQuery({
    ...BASE,
    queryKey: ["school-analytics", "class-options", institutionId],
    enabled: !!institutionId,
    queryFn: async (): Promise<{ id: string; name: string; section: string | null }[]> => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId as string)
        .eq("is_active", true)
        .order("name")
        .order("section")
        .range(0, 999);
      if (error) throw error;
      return data ?? [];
    },
  });
}
