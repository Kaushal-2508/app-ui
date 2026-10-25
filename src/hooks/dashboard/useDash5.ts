import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  ReportAttendance, ReportCore, ReportSnapshot, ReportStudents,
} from "@/lib/reports/schoolPerformanceReport";

import { dashRetry } from "./dashRetry";

/** Year-level aggregates move when marks, lessons or the roster move, not
 *  minute to minute, so they hold for five minutes rather than one. */
const YEAR_STALE_MS = 5 * 60_000;

/**
 * Admin Dashboard v5 data layer.
 *
 * One RPC backs the whole performance spine: `dash5_tree` returns a single level
 * of wings -> classes -> subjects, plus the footer total for that level. The
 * levels are derived from the same per (class, subject) atom in SQL, so a row
 * and the total under it cannot disagree - verified against Alliance.
 *
 * Every hook holds an explicit `staleTime` (CLAUDE.md 23) and every aggregate is
 * computed server-side; the client never fetches rows to count them.
 */

export type Dash5Level = "wings" | "classes" | "subjects";
export type Dash5Band = "exc" | "good" | "watch" | "att";

/** One row at whichever level is being shown. Fields absent at a level are null. */
export interface Dash5Row {
  id: string;
  name: string;
  /** Wing head, or the class teacher. Null when nobody is assigned. */
  sub: string | null;
  /** Subjects level only. */
  teacher: string | null;
  class_count: number | null;
  students: number | null;
  subject_pairs: number | null;
  subject_count: number | null;
  attendance_pct: number | null;
  syllabus_pct: number | null;
  lessons_taught: number | null;
  lessons_planned: number | null;
  papers: number | null;
  wk_done: number | null;
  wk_planned: number | null;
  accuracy: number | null;
  attempts: number | null;
  homework_pct: number | null;
  /** Null on a subject nobody has examined: "not assessed", never a zero. */
  composite: number | null;
  band: Dash5Band | null;
  /** Subjects level only. */
  chapters: number | null;
  chapters_done: number | null;
  chapters_partial: number | null;
  pending_grading: number | null;
}

export interface Dash5Total {
  class_count: number;
  students: number;
  subject_pairs: number;
  subject_count: number;
  chapters: number;
  chapters_done: number;
  chapters_partial: number;
  attendance_pct: number | null;
  syllabus_pct: number | null;
  lessons_taught: number;
  lessons_planned: number;
  papers: number;
  wk_done: number;
  wk_planned: number;
  accuracy: number | null;
  homework_pct: number | null;
  band: Dash5Band;
}

export interface Dash5Scope {
  week_start: string;
  today: string;
  ay_start: string | null;
  ay_end: string | null;
  wing_id: string | null;
  wing_name: string | null;
  class_id: string | null;
  class_label: string | null;
}

export interface Dash5Tree {
  level: Dash5Level;
  scope: Dash5Scope;
  rows: Dash5Row[];
  total: Dash5Total;
}

/**
 * One level of the tree. `wingId` is required for the class level and `classId`
 * for the subject level; both are part of the query key so drilling never shows
 * the previous node's rows while the new ones load.
 */
export function useDash5Tree(
  level: Dash5Level,
  wingId: string | null,
  classId: string | null,
) {
  return useQuery({
    queryKey: ["dash5", "tree", level, wingId, classId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    enabled: level !== "subjects" || !!classId,
    queryFn: async (): Promise<Dash5Tree> => {
      const { data, error } = await supabase.rpc("dash5_tree", {
        p_level: level,
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5Tree;
    },
  });
}

export type Dash5ChapterState = "done" | "partial" | "none";

export interface Dash5Chapter {
  topic_id: string;
  name: string;
  chapter_number: number | null;
  state: Dash5ChapterState;
  last_logged_on: string | null;
}

export interface Dash5SubjectStats {
  accuracy: number | null;
  attempts: number | null;
  papers: number | null;
  students: number | null;
  lessons_taught: number | null;
  lessons_planned: number | null;
  homework_pct: number | null;
  pending_grading: number | null;
  /** What this subject is compared against in the "where this lands" note. */
  class_accuracy: number | null;
  class_subjects: number | null;
  class_subjects_assessed: number | null;
  teacher: string | null;
}

export interface Dash5SubjectChapters {
  class_id: string;
  subject_id: string;
  subject_name: string | null;
  class_label: string | null;
  stats: Dash5SubjectStats | null;
  chapters: Dash5Chapter[];
}

/** The fourth level. SALCI drills to the chapter and stops there. */
export function useDash5SubjectChapters(classId: string | null, subjectId: string | null) {
  return useQuery({
    queryKey: ["dash5", "chapters", classId, subjectId],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    enabled: !!classId && !!subjectId,
    queryFn: async (): Promise<Dash5SubjectChapters> => {
      const { data, error } = await supabase.rpc("dash5_subject_chapters", {
        p_class_id: classId as string,
        p_subject_id: subjectId as string,
      });
      if (error) throw error;
      return data as unknown as Dash5SubjectChapters;
    },
  });
}

/* ------------------------------------------------------------- students -- */

export interface Dash5StudentRow {
  id: string;
  name: string;
  students: number;
  adopt_pct: number | null;
  submission_pct: number | null;
  score_pct: number | null;
  homework_pct: number | null;
  attendance_pct: number | null;
  at_risk: number;
  never_in: number;
}

export interface Dash5StudentTree {
  level: "wings" | "classes";
  scope: { wing_id: string | null; wing_name: string | null };
  rows: Dash5StudentRow[];
  total: Omit<Dash5StudentRow, "id" | "name">;
}

/** Student-side measures only: portal, papers sat, homework in, attendance. */
export function useDash5StudentTree(level: "wings" | "classes", wingId: string | null) {
  return useQuery({
    queryKey: ["dash5", "studentTree", level, wingId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5StudentTree> => {
      const { data, error } = await supabase.rpc("dash5_student_tree", {
        p_level: level,
        p_wing_id: wingId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5StudentTree;
    },
  });
}

export interface Dash5Distribution {
  wings: { id: string; name: string }[];
  bands: { label: string; total: number; by_wing: { wing_id: string; n: number }[] }[];
  scored: number;
}

export function useDash5ScoreDistribution(wingId: string | null) {
  return useQuery({
    queryKey: ["dash5", "scoreDistribution", wingId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5Distribution> => {
      const { data, error } = await supabase.rpc("dash5_score_distribution", {
        p_wing_id: wingId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5Distribution;
    },
  });
}

export interface Dash5RiskRow {
  student_id: string;
  name: string;
  roll: string | null;
  class_label: string | null;
  class_teacher: string | null;
  wing_id: string | null;
  /** The number the queue is ordered by. Shown, not just sorted on. */
  rank_score: number | null;
  score: number | null;
  attendance_pct: number | null;
  homework_pct: number | null;
  submission_pct: number | null;
  band: Dash5Band;
  never_in: boolean;
  reasons: string[];
}

export interface Dash5AtRisk {
  total: number;
  /** Every flagged student split by wing, not just the page of rows below. */
  by_wing: { wing_id: string; wing_name: string; n: number }[];
  unmapped: number;
  rows: Dash5RiskRow[];
}

export function useDash5AtRisk(wingId: string | null, classId: string | null, limit = 25) {
  return useQuery({
    queryKey: ["dash5", "atRisk", wingId, classId, limit],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5AtRisk> => {
      const { data, error } = await supabase.rpc("dash5_students_at_risk", {
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
        p_limit: limit,
        p_offset: 0,
      });
      if (error) throw error;
      return data as unknown as Dash5AtRisk;
    },
  });
}

/* ------------------------------------------------------------- teachers -- */

export type Dash5EngagementLevel = "Minimal" | "Moderate" | "Strong";

export interface Dash5TeacherRow {
  id: string;
  name: string;
  wing_id: string | null;
  wing_name: string | null;
  classes: number;
  subjects: number;
  subject_names: string | null;
  last_seen_days: number | null;
  tests: number;
  homework_given: number;
  lessons: number;
  avg_score: number | null;
  engagement: number;
  level: Dash5EngagementLevel;
}

export interface Dash5TeacherActivity {
  total: number;
  minimal: number;
  rows: Dash5TeacherRow[];
}

/** Quietest first. Engagement is platform behaviour only, never student scores. */
export function useDash5TeacherActivity(wingId: string | null) {
  return useQuery({
    queryKey: ["dash5", "teacherActivity", wingId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5TeacherActivity> => {
      const { data, error } = await supabase.rpc("dash5_teacher_activity", {
        p_wing_id: wingId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5TeacherActivity;
    },
  });
}

export interface Dash5CoordinatorRow {
  wing_id: string;
  wing_name: string;
  coordinator: string | null;
  coordinator_id: string | null;
  /** Teachers in this wing whose engagement reads "Minimal". */
  teachers_minimal: number;
  classes: number;
  students: number;
  teachers: number;
  avg_score: number | null;
  coverage_pct: number | null;
  attendance_pct: number | null;
  tasks_closed: number;
  tasks_total: number;
  tasks_overdue: number;
  band: Dash5Band;
}

/**
 * ADMIN ONLY. dash5_coordinators ranks every wing's coordinator against the
 * others, so it deliberately kept the old resolver in migration 20260922100000
 * and RAISES for a coordinator. `enabled` exists for that reason: the
 * coordinator console mounts the teacher-activity card, which reads this only
 * to populate a wing picker it does not show, and an unconditional call turned
 * that card into an error state on their page.
 */
export function useDash5Coordinators(enabled = true) {
  return useQuery({
    queryKey: ["dash5", "coordinators"],
    enabled,
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<{ rows: Dash5CoordinatorRow[] }> => {
      const { data, error } = await supabase.rpc("dash5_coordinators", {});
      if (error) throw error;
      return data as unknown as { rows: Dash5CoordinatorRow[] };
    },
  });
}

/* ---------------------------------------------------------- exam papers -- */

export interface Dash5PaperRow {
  exam_id: string;
  title: string | null;
  cycle: string | null;
  teacher: string | null;
  pass_pct: number | null;
  top_pct: number | null;
  date: string;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string | null;
  avg_pct: number | null;
  appeared: number;
  roster: number;
  mode: string;
  total_marks: number | null;
  band: Dash5Band;
}

export interface Dash5ExamPapers {
  from: string;
  to: string;
  /** Rows actually returned. */
  count: number;
  /** Rows that matched before the cap, so the card can say what it is not showing. */
  total: number;
  rows: Dash5PaperRow[];
}

/** One row per (exam, class, subject) event, newest first, bounded. */
export function useDash5ExamPapers(
  wingId: string | null, classId: string | null,
  from?: string | null, to?: string | null,
) {
  return useQuery({
    queryKey: ["dash5", "examPapers", wingId, classId, from ?? null, to ?? null],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5ExamPapers> => {
      const { data, error } = await supabase.rpc("dash5_exam_papers", {
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5ExamPapers;
    },
  });
}

/* ----------------------------------------------------------- attendance -- */

export interface Dash5AttDay {
  date: string;
  /** Present or late, over the whole student roll for that day. */
  student_pct: number | null;
  /** Checked in, over the whole teaching roster for that day. */
  staff_pct: number | null;
  /** Both totals are the ROLL as of that day, not the number marked. */
  student_total: number;
  student_present: number;
  /** How many were actually registered. Below the roll means the register
   *  was not taken everywhere, which is the usual cause of a low day. */
  student_marked: number;
  staff_total: number;
  staff_present: number;
  staff_marked: number;
}

export function useDash5AttendanceSeries(days = 20) {
  return useQuery({
    queryKey: ["dash5", "attSeries", days],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<{ days: Dash5AttDay[] }> => {
      const { data, error } = await supabase.rpc("dash5_attendance_series", { p_days: days });
      if (error) throw error;
      return data as unknown as { days: Dash5AttDay[] };
    },
  });
}

export interface Dash5WingAtt { wing_id: string; wing_name: string; students: number; pct: number | null }

export function useDash5AttendanceByWing() {
  return useQuery({
    queryKey: ["dash5", "attByWing"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<{ rows: Dash5WingAtt[] }> => {
      const { data, error } = await supabase.rpc("dash5_attendance_by_wing", {});
      if (error) throw error;
      return data as unknown as { rows: Dash5WingAtt[] };
    },
  });
}

export interface Dash5AbsentRow {
  student_id: string;
  name: string;
  roll: string | null;
  class_id: string;
  class_label: string;
  class_teacher: string | null;
  wing_id: string | null;
  pct: number;
  days_counted: number;
  absent_streak: number;
  /** Attendance over the whole year, so a short window keeps its context. */
  year_pct: number | null;
  score: number | null;
}

export interface Dash5AbsentWing {
  wing_id: string;
  wing_name: string;
  n: number;
  coordinator_id: string | null;
  coordinator: string | null;
  /** Up to three names, worst first, for the hand-over row's sub-line. */
  worst: string[];
}

export interface Dash5Absentees {
  window_days: number;
  threshold: number;
  streak: number;
  total: number;
  total_school: number;
  by_wing: Dash5AbsentWing[];
  unmapped: number;
  rows: Dash5AbsentRow[];
}

/**
 * Recomputed from the register over the chosen window, so "below 75%" means
 * below 75% IN THAT WINDOW rather than the year figure filtered afterwards.
 */
export function useDash5ChronicAbsentees(
  wingId: string | null, classId: string | null,
  days: number, threshold: number, streak: number,
) {
  return useQuery({
    queryKey: ["dash5", "absentees", wingId, classId, days, threshold, streak],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5Absentees> => {
      const { data, error } = await supabase.rpc("dash5_chronic_absentees", {
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
        p_days: days,
        p_threshold: threshold,
        p_streak: streak,
      });
      if (error) throw error;
      return data as unknown as Dash5Absentees;
    },
  });
}

export interface Dash5NeedItem {
  severity: "High" | "Medium" | "Low";
  title: string;
  detail: string;
  /** The words on the link. `goto` is where it lands; they are not the same. */
  cta: string;
  goto: string;
}

export interface Dash5NeedsWing {
  wing_id: string;
  wing_name: string;
  coordinator_id: string | null;
  coordinator: string | null;
  classes: number;
  students: number;
  high: number;
  count: number;
  items: Dash5NeedItem[];
}

export function useDash5NeedsByWing() {
  return useQuery({
    queryKey: ["dash5", "needsByWing"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<{ pace: number; total: number; wings: Dash5NeedsWing[] }> => {
      const { data, error } = await supabase.rpc("dash5_needs_by_wing", {});
      if (error) throw error;
      return data as unknown as { pace: number; total: number; wings: Dash5NeedsWing[] };
    },
  });
}

/* ------------------------------------------- pipeline + task suggestions -- */

export interface Dash5Pipeline {
  year_elapsed_pct: number;
  held: number;
  planned: number;
  remaining: number;
  drafted: number;
  unscheduled: number;
  pending_publication: number;
  pairs: number;
  pairs_with_no_paper: number;
  on_pace: number | null;
  /** The four places a paper can sit. These four add up to `planned`. */
  held_results_out: number;
  held_results_pending: number;
  on_calendar: number;
  in_draft: number;
  not_written: number;
}

export function useDash5ExamPipeline(
  wingId: string | null, classId: string | null, subjectId: string | null,
) {
  return useQuery({
    queryKey: ["dash5", "pipeline", wingId, classId, subjectId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5Pipeline> => {
      const { data, error } = await supabase.rpc("dash5_exam_pipeline", {
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
        p_subject_id: subjectId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5Pipeline;
    },
  });
}

export interface Dash5Suggestion {
  code: string;
  title: string;
  detail: string;
  priority: number;
  task_type: string;
  due_days: number;
  assignee_id: string | null;
  assignee_name: string | null;
}

export function useDash5TaskSuggestions() {
  return useQuery({
    queryKey: ["dash5", "taskSuggestions"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<{ total: number; high: number; rows: Dash5Suggestion[] }> => {
      const { data, error } = await supabase.rpc("dash5_task_suggestions", {});
      if (error) throw error;
      return data as unknown as { total: number; high: number; rows: Dash5Suggestion[] };
    },
  });
}

export interface Dash5NewTask {
  title: string;
  detail: string;
  assignee_id: string | null;
  priority: number;
  task_type: string;
  due_days: number;
}

/**
 * Writes a REAL task through create_task_group, the same transactional RPC the
 * Tasks page uses. Multi-assignee tasks are a fan-out (CLAUDE.md 11), so the
 * assignee list goes to the RPC rather than being written here one row at a
 * time. Every assign control on the dashboard, from a suggestion card to a
 * drawer, goes through this one path.
 */
export function useDash5CreateTask(institutionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Dash5NewTask) => {
      if (!institutionId) throw new Error("No school is selected.");
      if (!t.assignee_id) throw new Error("Nobody is available to take this on yet.");
      if (!t.title.trim()) throw new Error("Give the task a title first.");
      const due = new Date();
      due.setDate(due.getDate() + t.due_days);
      const { data, error } = await supabase.rpc("create_task_group", {
        p_institution_id: institutionId,
        p_title: t.title.trim(),
        p_description: t.detail,
        p_task_type: t.task_type as never,
        p_priority: t.priority,
        p_due_date: due.toISOString(),
        p_assignees: [{ assignee_id: t.assignee_id }] as unknown as never,
        p_supervisor_id: undefined,
        p_supervisor_ids: undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dash5", "taskSuggestions"] });
      void qc.invalidateQueries({ queryKey: ["dash5", "coordinators"] });
      void qc.invalidateQueries({ queryKey: ["dash5", "needsByWing"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/** A suggestion is just a task with the wording already written. */
export function useDash5ApproveSuggestion(institutionId: string | null) {
  const create = useDash5CreateTask(institutionId);
  return {
    ...create,
    mutate: (s: Dash5Suggestion, opts?: Parameters<typeof create.mutate>[1]) =>
      create.mutate(
        {
          title: s.title, detail: s.detail, assignee_id: s.assignee_id,
          priority: s.priority, task_type: s.task_type, due_days: s.due_days,
        },
        opts,
      ),
  };
}

/* ------------------------------------------------------ filter options -- */

export interface Dash5FilterOptions {
  wings: { id: string; name: string }[];
  /** `wing_id` is null for a class nobody has mapped into a wing. */
  classes: { id: string; label: string; wing_id: string | null }[];
  subjects: { id: string; name: string }[];
}

/**
 * Every picker on the page reads this one cached entry, so adding a filter to a
 * card costs no extra round trip. Subjects are deduped on the normalised name
 * server-side: universal_subjects holds one row per subject PER GRADE, and an
 * undeduped picker offers "Punjabi" sixteen times.
 */
export const dash5FilterOptionsQuery = queryOptions({
  queryKey: ["dash5", "filterOptions"],
  // Wings, classes and subjects change when somebody edits the school, not
  // while a dashboard is open.
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  retry: dashRetry,
  queryFn: async (): Promise<Dash5FilterOptions> => {
    const { data, error } = await supabase.rpc("dash5_filter_options", {});
    if (error) throw error;
    return data as unknown as Dash5FilterOptions;
  },
});

/** The options object is exported so the coordinator console can prefetch
 *  the exact same key and queryFn before its wing gate resolves. */
export function useDash5FilterOptions() {
  return useQuery(dash5FilterOptionsQuery);
}

/* -------------------------------------------------------------- drawers -- */

export interface Dash5AssignTarget {
  id: string | null;
  name: string | null;
  role: string | null;
  /** False when the named person is a stand-in, not the natural owner. */
  exact: boolean;
}

export interface Dash5AssignSuggestion {
  title: string;
  detail: string;
  priority: number;
  task_type: string;
  due_days: number;
}

export interface Dash5AssignContext {
  scope: "school" | "wing" | "class" | "subject";
  label: string;
  sublabel: string | null;
  full_label: string;
  pace_pct: number;
  target: Dash5AssignTarget;
  stats: { label: string; value: number | null; unit: string }[];
  facts: {
    pairs: number; pairs_no_paper: number;
    chapters: number; chapters_done: number; chapters_partial: number;
    lessons_taught: number; lessons_planned: number;
    papers: number; pending_grading: number;
    homework_pct: number | null; students: number; classes: number;
    coverage_pct: number | null; accuracy_pct: number | null; attendance_pct: number | null;
  };
  suggestions: Dash5AssignSuggestion[];
}

/**
 * Who owns a wing, a class or one subject in one class, and what is worth
 * asking them for. Only fetched while a drawer is open, so the landing page
 * pays nothing for six panels nobody has opened.
 */
export function useDash5AssignContext(
  scope: { wingId?: string | null; classId?: string | null; subjectId?: string | null } | null,
) {
  return useQuery({
    queryKey: ["dash5", "assignContext", scope?.wingId ?? null, scope?.classId ?? null, scope?.subjectId ?? null],
    enabled: !!scope,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5AssignContext> => {
      const { data, error } = await supabase.rpc("dash5_assign_context", {
        p_wing_id: scope?.wingId ?? undefined,
        p_class_id: scope?.classId ?? undefined,
        p_subject_id: scope?.subjectId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5AssignContext;
    },
  });
}

export interface Dash5RosterRow {
  student_id: string;
  name: string;
  roll: string | null;
  never_in: boolean;
  subject_pct: number | null;
  subject_papers: number;
  score: number | null;
  attendance_pct: number | null;
  homework_pct: number | null;
}

export interface Dash5SubjectRoster {
  class_id: string;
  class_label: string | null;
  subject_id: string;
  subject_name: string | null;
  total: number;
  scored: number;
  lowest: number | null;
  median: number | null;
  highest: number | null;
  /** How many of `total` came back, since the list is bounded. */
  count: number;
  rows: Dash5RosterRow[];
}

export function useDash5SubjectRoster(classId: string | null, subjectId: string | null) {
  return useQuery({
    queryKey: ["dash5", "subjectRoster", classId, subjectId],
    enabled: !!classId && !!subjectId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5SubjectRoster> => {
      const { data, error } = await supabase.rpc("dash5_subject_roster", {
        p_class_id: classId as string,
        p_subject_id: subjectId as string,
        p_limit: 200,
      });
      if (error) throw error;
      return data as unknown as Dash5SubjectRoster;
    },
  });
}

export interface Dash5PaperDetail {
  exam_id: string;
  title: string | null;
  date: string | null;
  status: string;
  mode: string;
  total_marks: number | null;
  pass_marks: number | null;
  class_label: string | null;
  subjects: string | null;
  roster: number;
  appeared: number;
  absent: number;
  unpublished: number;
  avg_pct: number | null;
  median_pct: number | null;
  pass_pct: number | null;
  top_pct: number | null;
  /** The two baselines a single paper's average only means anything against. */
  class_avg_pct: number | null;
  school_avg_pct: number | null;
  teacher: string | null;
  exam_type: string | null;
  bands: { label: string; n: number }[];
  top: { name: string; pct: number; obtained: number | null; max: number | null }[];
  bottom: { name: string; pct: number; obtained: number | null; max: number | null }[];
}

export function useDash5PaperDetail(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["dash5", "paperDetail", examId, classId],
    enabled: !!examId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5PaperDetail> => {
      const { data, error } = await supabase.rpc("dash5_paper_detail", {
        p_exam_id: examId as string,
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5PaperDetail;
    },
  });
}

export interface Dash5NeverWing {
  wing_id: string;
  wing_name: string;
  students: number;
  never_in: number;
  pct: number | null;
  coordinator_id: string | null;
  coordinator: string | null;
}

export interface Dash5NeverSignedIn {
  total: number;
  students: number;
  filtered_total: number;
  count: number;
  /** Students in no wing at all. They belong to nobody, so they are called out. */
  unmapped: number;
  wings: Dash5NeverWing[];
  rows: { student_id: string; name: string; roll: string | null; class_label: string | null; wing_id: string | null }[];
}

export function useDash5NeverSignedIn(wingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["dash5", "neverSignedIn", wingId],
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5NeverSignedIn> => {
      const { data, error } = await supabase.rpc("dash5_never_signed_in", {
        p_wing_id: wingId ?? undefined,
        p_limit: 100,
      });
      if (error) throw error;
      return data as unknown as Dash5NeverSignedIn;
    },
  });
}

export interface Dash5StudentContext {
  student_id: string;
  name: string;
  roll: string | null;
  class_id: string | null;
  class_label: string | null;
  wing_id: string | null;
  never_in: boolean;
  at_risk: boolean;
  band: Dash5Band;
  score: number | null;
  attendance_pct: number | null;
  homework_pct: number | null;
  submission_pct: number | null;
  guardian: { name: string | null; phone: string | null; email: string | null };
  class_teacher: { id: string; name: string } | null;
  coordinator: { id: string; name: string } | null;
}

export function useDash5StudentContext(studentId: string | null) {
  return useQuery({
    queryKey: ["dash5", "studentContext", studentId],
    enabled: !!studentId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5StudentContext> => {
      const { data, error } = await supabase.rpc("dash5_student_context", {
        p_student_id: studentId as string,
      });
      if (error) throw error;
      return data as unknown as Dash5StudentContext;
    },
  });
}

/* ------------------------------------------------- reference parity ------ */

export interface Dash5BandSlice {
  band: Dash5Band;
  n: number;
  pct: number | null;
  by_wing: { wing_id: string; wing_name: string; n: number }[];
}

export interface Dash5BandDonut {
  total: number;
  wings: { id: string; name: string }[];
  bands: Dash5BandSlice[];
}

/**
 * Students bucketed by the band their work sits in, with the wing behind each
 * slice. Bands come from the same student atom the risk queue reads, so the
 * donut and the queue under it cannot disagree.
 */
export function useDash5BandDonut(wingId: string | null) {
  return useQuery({
    queryKey: ["dash5", "bandDonut", wingId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5BandDonut> => {
      const { data, error } = await supabase.rpc("dash5_band_donut", {
        p_wing_id: wingId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5BandDonut;
    },
  });
}

export interface Dash5SchoolWideNeeds {
  items: {
    severity: "High" | "Medium" | "Low";
    title: string;
    detail: string;
    cta: string;
    goto: string;
  }[];
  counts: {
    proctoring: number; issues: number; student_leave: number;
    staff_leave: number; unpublished_papers: number;
  };
}

/** Open items that belong to no single wing, so counting them per wing would
 *  either double them or drop them. */
export function useDash5SchoolWideNeeds() {
  return useQuery({
    queryKey: ["dash5", "schoolWideNeeds"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5SchoolWideNeeds> => {
      const { data, error } = await supabase.rpc("dash5_school_wide_needs", {});
      if (error) throw error;
      return data as unknown as Dash5SchoolWideNeeds;
    },
  });
}

export interface Dash5Communication {
  /** False while no outbound channel is switched on, which is the case today. */
  channels_live: boolean;
  circulars: {
    total: number; requiring_ack: number; recipients: number;
    reached: number; opened: number; acknowledged: number;
    rows: { id: string; title: string; type: string; published_at: string;
            recipients: number | null; opened: number; requires_ack: boolean }[];
  };
  ptm: {
    total: number; slots: number; bookings: number; feedback: number;
    rows: { id: string; title: string; date: string; status: string;
            slots: number | null; bookings: number }[];
  };
  /** `unit` is "pct" for a rate drawn against 100, "count" for one scaled
   *  against its neighbours. `of` is the denominator behind a rate. */
  reach: { label: string; value: number | null; unit: "pct" | "count";
           of?: number; n?: number }[];
}

export function useDash5Communication() {
  return useQuery({
    queryKey: ["dash5", "communication"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5Communication> => {
      const { data, error } = await supabase.rpc("dash5_communication", {});
      if (error) throw error;
      return data as unknown as Dash5Communication;
    },
  });
}

/* ----------------------------------------------- audit-round additions --- */

export interface Dash5StudentSubjectRow {
  id: string;
  name: string;
  teacher: string | null;
  students: number;
  students_sat: number;
  papers: number;
  submission_pct: number | null;
  score_pct: number | null;
  homework_pct: number | null;
  attempts: number;
}

export interface Dash5StudentSubjects {
  class_id: string;
  class_label: string | null;
  total: number;
  students: number;
  rows: Dash5StudentSubjectRow[];
}

/** The adoption table's third level: subjects inside a class, from the student
 *  side. The teaching-side view of the same pair is dash5_tree. */
export function useDash5StudentSubjects(classId: string | null) {
  return useQuery({
    queryKey: ["dash5", "studentSubjects", classId],
    enabled: !!classId,
    staleTime: YEAR_STALE_MS, // the student tree's third level, same atom and age
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5StudentSubjects> => {
      const { data, error } = await supabase.rpc("dash5_student_subjects", {
        p_class_id: classId as string,
      });
      if (error) throw error;
      return data as unknown as Dash5StudentSubjects;
    },
  });
}

export interface Dash5BandClasses {
  band: Dash5Band;
  wing_id: string | null;
  wing_name: string | null;
  in_band: number;
  total: number;
  rows: { class_id: string; class_label: string; n: number; of: number; pct: number | null }[];
}

/** The donut's third level: the classes behind one band inside one wing. */
export function useDash5BandClasses(band: Dash5Band | null, wingId: string | null) {
  return useQuery({
    queryKey: ["dash5", "bandClasses", band, wingId],
    enabled: !!band && !!wingId,
    staleTime: YEAR_STALE_MS, // the band donut's third level, same atom and age
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5BandClasses> => {
      const { data, error } = await supabase.rpc("dash5_band_classes", {
        p_band: band as string,
        p_wing_id: wingId as string,
      });
      if (error) throw error;
      return data as unknown as Dash5BandClasses;
    },
  });
}

/* ------------------------------------------------- teacher targets ------- */

export interface Dash5TargetPair {
  /** In the target period when one is set, otherwise the year to date. */
  done: number;
  /** 0 means nobody set a target for this row. */
  target: number;
  /** Publications this academic year, carried whether or not a target exists. */
  ytd: number;
  /** How many teachers in this row actually hold a target. */
  teachers: number;
}

export interface Dash5TreeTargets {
  level: Dash5Level;
  has_targets: boolean;
  period: { start: string | null; end: string | null } | null;
  rows: Record<string, { exams: Dash5TargetPair; homework: Dash5TargetPair; teachers: number }>;
  total: { exams: Dash5TargetPair; homework: Dash5TargetPair; teachers: number };
}

/**
 * The Teacher Targets denominator for the performance tree.
 *
 * Targets exist only at wing and teacher scope, and a teacher target is ONE
 * TOTAL across everything that teacher teaches. The RPC maps them onto whatever
 * level is being drawn; the consequence, which the card says out loud, is that a
 * teacher counts in full against every class and subject they touch, so rows do
 * not sum to their parent.
 */
export function useDash5TreeTargets(
  level: Dash5Level, wingId: string | null, classId: string | null,
) {
  return useQuery({
    queryKey: ["dash5", "treeTargets", level, wingId, classId],
    staleTime: YEAR_STALE_MS, // year-level aggregate, see YEAR_STALE_MS
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<Dash5TreeTargets> => {
      const { data, error } = await supabase.rpc("dash5_tree_targets", {
        p_level: level,
        p_wing_id: wingId ?? undefined,
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as Dash5TreeTargets;
    },
  });
}

/**
 * The School Performance Report, assembled from three RPCs run at once.
 *
 * It used to be one call. That call took 10.9s on Alliance and `authenticated`
 * is pinned to an 8s statement_timeout, so every real user saw the report's
 * error state while it worked fine through the Management API, where postgres
 * has no timeout. Nothing inside a plpgsql function can run concurrently, so
 * the work is split along three seams that share no state and fired together:
 * core 2.3s, students 4.8s, attendance 5.2s, wall clock about 5s.
 *
 * Heavy either way, so it is fetched once per click on the report (through
 * queryClient.fetchQuery, reusing a copy under five minutes old) and never on
 * dashboard load.
 */
export const dash5ReportSnapshotQuery = queryOptions({
  queryKey: ["dash5", "reportSnapshot"],
  staleTime: 5 * 60_000,
  // Stricter than dashRetry on purpose: three heavy RPCs at once, never rerun.
  retry: false,
  queryFn: async (): Promise<ReportSnapshot> => {
    const [core, students, attendance] = await Promise.all([
      supabase.rpc("dash5_report_core", {}),
      supabase.rpc("dash5_report_students", {}),
      supabase.rpc("dash5_report_attendance", {}),
    ]);
    const failed = core.error ?? students.error ?? attendance.error;
    if (failed) throw failed;

    const c = core.data as unknown as ReportCore;
    const s = students.data as unknown as ReportStudents;
    const a = attendance.data as unknown as ReportAttendance;

    return {
      meta: { ...c.meta, neverTotal: a.neverTotal, neverByWing: a.neverByWing },
      school: c.school,
      subjRollup: c.subjRollup,
      teachers: c.teachers,
      schoolStu: s.schoolStu,
      bands: s.bands,
      atRisk: s.atRisk,
      absentees: a.absentees,
      // The per-wing student roll-up is fetched with the other student
      // figures, so it is stitched back onto its wing here.
      wings: c.wings.map((w) => ({ ...w, stu: s.wingStu[w.id] ?? {} })),
    };
  },
});
