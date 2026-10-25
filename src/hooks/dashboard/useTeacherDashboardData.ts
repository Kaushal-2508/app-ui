import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useDashboardScope } from "./DashboardScope";

/**
 * Teacher-only dashboard panels (spec 2.3 + 2.4).
 *
 * Both RPCs aggregate server-side and return one small JSONB payload, so nothing
 * here fetches rows to count them client-side (CLAUDE.md §23). Both resolve
 * scope through `dash_resolve_scoped_pairs()`, the same (class_id, subject_id)
 * boundary the KPI tiles use — there is no client-side filtering anywhere in
 * this file, deliberately: the security boundary lives in the database.
 *
 * Both hooks are gated on `scope === "teacher"`, so mounting these components
 * under the coordinator or admin scope is a no-op rather than a wrong query.
 */

export interface ActionQueueItem {
  key: "grading" | "homework" | "attendance" | "planning";
  count: number;
  label: string;
  /** One-line context, e.g. the exam or homework title. Null when count is 0. */
  context: string | null;
  /** Destination for the row's action. Null when there is nothing to open. */
  href: string | null;
  action: string;
}

export interface ActionQueue {
  total: number;
  items: ActionQueueItem[];
}

export type PerformanceBand = "needs_attention" | "developing" | "stable" | "excellent";

export interface TeacherClassSubject {
  class_id: string;
  class_name: string;
  section: string | null;
  subject_id: string;
  subject_name: string;
  students: number;
  /** Null when the pair has no graded results yet — never conflate with 0%. */
  score_pct: number | null;
  prev_pct: number | null;
  delta_pp: number | null;
  exams_count: number;
  last_exam_on: string | null;
  band: PerformanceBand | null;
}

export interface TeacherClassSubjects {
  has_data: boolean;
  pairs: TeacherClassSubject[];
}

export function useTeacherActionQueue() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherActionQueue"],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async (): Promise<ActionQueue> => {
      const { data, error } = await supabase.rpc("dash_teacher_action_queue");
      if (error) throw error;
      return data as unknown as ActionQueue;
    },
  });
}

export function useTeacherClassSubjects() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherClassSubjects"],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async (): Promise<TeacherClassSubjects> => {
      const { data, error } = await supabase.rpc("dash_teacher_class_subjects");
      if (error) throw error;
      return data as unknown as TeacherClassSubjects;
    },
  });
}

/** PRD §12.3 bands. Single source of truth for the label + tone pairing. */
export const BAND_META: Record<PerformanceBand, { label: string; tone: string }> = {
  needs_attention: { label: "Needs attention", tone: "bg-rose-500/10 text-rose-600" },
  developing: { label: "Developing", tone: "bg-amber-500/10 text-amber-600" },
  stable: { label: "Stable", tone: "bg-sky-500/10 text-sky-600" },
  excellent: { label: "Excellent", tone: "bg-emerald-500/10 text-emerald-600" },
};

// ── Phase 3 panels (spec 2.5 / 2.6 / 2.7 / 2.8) ───────────────────────────

export interface WeakChapter {
  tag: string;
  subject_name: string;
  mastery_pct: number;
  students: number;
  below_50: number;
}

export interface AttentionStudent {
  student_id: string;
  student_name: string | null;
  class_id: string;
  class_name: string;
  section: string | null;
  severity: "high" | "medium" | "watch";
  reasons: string[] | null;
}

export interface PortalAdoption {
  has_data: boolean;
  total_students?: number;
  never_logged_in?: { count: number; names: string[] };
  today?: { n: number; pct: number };
  yesterday?: { n: number; pct: number };
  avg_7?: { n: number; pct: number };
  avg_30?: { n: number; pct: number };
  sparkline?: { d: string; n: number }[];
  engagement?: { homework_pct: number | null; tests_pct: number | null };
}

export interface SyllabusCoverageRow {
  class_id: string;
  class_name: string;
  section: string | null;
  subject_id: string;
  subject_name: string;
  total_chapters: number;
  done_chapters: number;
  coverage_pct: number | null;
  last_logged_on: string | null;
  days_since_log: number | null;
}

export function useTeacherWeakChapters() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherWeakChapters"],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_weak_chapters", { p_limit: 8 });
      if (error) throw error;
      return data as unknown as { has_data: boolean; chapters: WeakChapter[] };
    },
  });
}

export function useTeacherStudentsAttention() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherStudentsAttention"],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_students_attention", { p_limit: 25 });
      if (error) throw error;
      return data as unknown as { has_data: boolean; students: AttentionStudent[] };
    },
  });
}

export function useTeacherPortalAdoption(classId?: string | null) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherPortalAdoption", classId ?? null],
    enabled: scope === "teacher",
    staleTime: 5 * 60_000, // login rollup only moves once a day
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_portal_adoption", {
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as PortalAdoption;
    },
  });
}

export function useTeacherSyllabusCoverage() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherSyllabusCoverage"],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_syllabus_coverage");
      if (error) throw error;
      return data as unknown as { has_data: boolean; subjects: SyllabusCoverageRow[] };
    },
  });
}

/** Severity chips for spec 2.6. Tokenised so both themes flip. */
export const SEVERITY_META: Record<AttentionStudent["severity"], { label: string; tone: string }> = {
  high: { label: "High", tone: "bg-rose-500/10 text-rose-600" },
  medium: { label: "Medium", tone: "bg-amber-500/10 text-amber-600" },
  // The RPC's third band is still keyed 'watch'; only the label reads "Low", so
  // no migration is needed and the severity ordering stays high > medium > low.
  watch: { label: "Low", tone: "bg-sky-500/10 text-sky-600" },
};

// ── Spec 2.1 header meta + 2.7 "Not using the portal" ─────────────────────

export interface TeacherHeaderMeta {
  wing_name: string | null;
  academic_year: string | null;
}

export interface PortalLaggard {
  student_id: string;
  student_name: string | null;
  class_id: string;
  class_name: string;
  section: string | null;
  days_since: number | null;
  never_seen: boolean;
  hw_submitted: number;
  hw_expected: number;
  ex_attempted: number;
  ex_expected: number;
  severity: "high" | "medium" | "watch";
  note: string | null;
}

export function useTeacherHeader() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherHeader"],
    enabled: scope === "teacher",
    staleTime: 5 * 60_000, // wing + academic year barely change
    queryFn: async (): Promise<TeacherHeaderMeta> => {
      const { data, error } = await supabase.rpc("dash_teacher_header");
      if (error) throw error;
      return data as unknown as TeacherHeaderMeta;
    },
  });
}

export function useTeacherPortalLaggards() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherPortalLaggards"],
    enabled: scope === "teacher",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_portal_laggards", { p_limit: 15 });
      if (error) throw error;
      return data as unknown as { has_data: boolean; students: PortalLaggard[] };
    },
  });
}

/** Roster-vs-class gap: an optional subject with no enrolments collapses every
 *  denominator on the page, so the UI names it instead of quietly dividing by 1. */
export interface RosterGap {
  roster: number;
  class_total: number;
  gap: boolean;
}

export function useTeacherRosterGap() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherRosterGap"],
    enabled: scope === "teacher",
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RosterGap> => {
      const { data, error } = await supabase.rpc("dash_teacher_roster_gap");
      if (error) throw error;
      return data as unknown as RosterGap;
    },
  });
}

// ── Spec 2.2 — monthly portal-engagement standing ─────────────────────────

export interface TeacherStanding {
  available: boolean;
  reason?: string;
  /** Null when the cohort is too small for a rank to mean anything. */
  rank: number | null;
  cohort_size: number;
  score: number;
  movement: number | null;
  badge_label: string | null;
  /** How many of the four measures the score is actually based on. */
  inputs_present: number;
}

export function useTeacherStanding() {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherStanding"],
    enabled: scope === "teacher",
    staleTime: 5 * 60_000, // recomputed nightly
    queryFn: async (): Promise<TeacherStanding> => {
      const { data, error } = await supabase.rpc("teacher_engagement_standing");
      if (error) throw error;
      return data as unknown as TeacherStanding;
    },
  });
}

// ── Per-chapter syllabus detail (spec 2.8, expanded) ──────────────────────

export type ChapterStatus = "completed" | "partial" | "scheduled" | "not_started";

/** A paper held for the class this academic year (published or completed). */
export interface SyllabusExam {
  id: string;
  title: string;
  held_on: string;
  results_only: boolean;
}

export interface SyllabusChapter {
  topic_id: string;
  name: string;
  chapter_number: number | null;
  status: ChapterStatus;
  last_logged_on: string | null;
  next_planned_on: string | null;
  /**
   * Held papers for this class that tag this chapter, whoever set them (the
   * same papers the Command Center counts). Before 2026-09-25 this counted
   * only the teacher's own exams.
   */
  exams_count: number;
  /* Added 2026-09-25 (migration 20260925150000). Optional because a snapshot
     persisted before that (src/lib/queryPersist.ts) lacks them until refetch. */
  exams?: SyllabusExam[];
  display_order?: number | null;
  first_completed_on?: string | null;
  /** Every date this chapter was logged, oldest first (migration 20260929120000). */
  logs?: { date: string; action: "completed" | "partial" }[];
}

export interface SyllabusSubjectDetail {
  class_id: string;
  class_name: string;
  section: string | null;
  subject_id: string;
  subject_name: string;
  total: number;
  completed: number;
  partial: number;
  scheduled: number;
  not_started: number;
  exams_total: number;
  chapters: SyllabusChapter[];
  /** Distinct held papers for the class + subject. Optional: see SyllabusChapter. */
  papers?: number;
  /** Held papers for the class + subject that tag none of its chapters. */
  untagged_exams?: SyllabusExam[];
}

/**
 * Coverage %: a partly-done chapter counts as half a finished one. The
 * Command Center's rule (dash5_tree syl_pct, Dash5Drawers), so a teacher and
 * the principal see the same number for the same class.
 */
export function syllabusCoveragePct(s: Pick<SyllabusSubjectDetail, "total" | "completed" | "partial">): number {
  return s.total > 0 ? Math.round(((s.completed * 2 + s.partial) / (s.total * 2)) * 100) : 0;
}

export function useTeacherSyllabusChapters(classId?: string | null) {
  const scope = useDashboardScope();
  return useQuery({
    queryKey: ["dash", scope, "teacherSyllabusChapters", classId ?? null],
    enabled: scope === "teacher",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_teacher_syllabus_chapters", {
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as { has_data: boolean; subjects: SyllabusSubjectDetail[] };
    },
  });
}

/** Chapter status chips. Keyed by the RPC's status strings. */
export const CHAPTER_STATUS: Record<ChapterStatus, { label: string; tone: string }> = {
  completed: { label: "Done", tone: "bg-emerald-500/10 text-emerald-600" },
  partial: { label: "Part done", tone: "bg-amber-500/10 text-amber-600" },
  scheduled: { label: "Scheduled", tone: "bg-sky-500/10 text-sky-600" },
  not_started: { label: "Not started", tone: "bg-slate-500/10 text-slate-600" },
};
