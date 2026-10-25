import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { dashRetry } from "./dashRetry";

/**
 * Coordinator Console data layer.
 *
 * The console reuses the whole of `useDash5` for its analytics: since
 * migration 20260922100000 every dash5_* function clamps itself to
 * dash5_caller_wing(), so the same hook returns the school for a principal and
 * one wing for a coordinator with no argument changing. What lives HERE is only
 * what a coordinator has and an admin does not: their desk, their timetable,
 * their staff, and the tasks pushed down to them.
 *
 * None of these take a wing. The wing is resolved from auth.uid() server-side,
 * which is both the security boundary and the reason there is nothing to pass.
 *
 * Every hook holds an explicit staleTime (CLAUDE.md 23) and every aggregate is
 * computed in SQL; the client never fetches rows to count them.
 */

/** Everything on the page is one wing, and this says which. */
export interface CoordScope {
  wing_id: string;
  wing_name: string;
  /** `wings.description`, e.g. "6th to 8th". Null when nobody filled it in. */
  wing_span: string | null;
  institution_id: string;
  institution_name: string;
  today: string;
  ay_code: string | null;
  ay_start: string;
  ay_end: string;
  classes: number;
  students: number;
  subject_pairs: number;
  teachers: number;
  /** Non-empty only for someone assigned to more than one wing. */
  other_wings: { id: string; name: string }[];
}

export interface CoordCards {
  today: string;
  students: {
    present: number; marked: number; roll: number;
    /** Null before anyone has taken a register today, never a zero. */
    pct: number | null;
    school_pct: number | null;
  };
  teachers: { present: number; marked: number; roll: number; pct: number | null };
  score: { wing: number | null; school: number | null; delta: number | null };
  /**
   * Lesson plans updated today, over the periods that have ENDED (`due`),
   * not over the whole day's `total`: at 10:00 the day has only taught its
   * first few periods. Same definition as the lesson-plan day grid.
   */
  periods: { logged: number; due: number; total: number; pct: number | null };
}

export interface CoordDesk {
  tasks: { count: number; overdue: number; high: number };
  leave: { count: number; oldest_days: number; oldest_class: string | null };
  rechecks: { count: number; classes: number; oldest_days: number };
  grading: { count: number; classes: number };
}

export interface CoordClassRow {
  class_id: string;
  label: string;
  teachers: number;
  teacher_sample: string | null;
  /** Null where no teacher holds a subjectless row for the class. */
  class_teacher: string | null;
  students: number;
  attendance: number | null;
  marked_today: boolean;
  at_risk: number;
  under75: number;
  never_in: number;
}

export interface CoordClasses {
  today: string;
  total: number;
  unmarked: number;
  rows: CoordClassRow[];
}

export type CoordStaffStatus = "present" | "late" | "absent" | "on_leave" | "unmarked";

export interface CoordStaffRow {
  id: string;
  name: string;
  avatar_path: string | null;
  status: CoordStaffStatus;
  /** True when the absence was written by the cron, not by a person. */
  auto: boolean;
  check_in: string | null;
  classes: number;
}

export interface CoordStaff {
  today: string;
  present: number;
  on_leave: number;
  absent: number;
  /** A real state, not a zero: nobody has checked in yet before the cutoff. */
  unmarked: number;
  total: number;
  rows: CoordStaffRow[];
  leave_pending: number;
}

export interface CoordLeaveRow {
  id: string;
  student_id: string;
  student: string;
  class_id: string;
  class_label: string;
  leave_type: string | null;
  reason: string | null;
  start_date: string;
  end_date: string;
  days: number;
  waiting_days: number;
}

export interface CoordTaskRow {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  task_type: string;
  /** tasks.priority: 1 High, 2 Medium, 3 Low. LOWER is more urgent. */
  priority: number | null;
  due_date: string | null;
  due_in_days: number | null;
  from: string;
  auto: boolean;
}

export interface CoordRecheckRow {
  id: string;
  student: string;
  class_label: string;
  class_id: string;
  exam: string;
  exam_id: string;
  reason: string | null;
  days: number;
  was_pct: number | null;
}

export interface CoordCoverRow {
  slot_id: string;
  /** Null for a slot nobody was ever assigned to. */
  sub_id: string | null;
  reason: "absent" | "unassigned";
  sub_reason: string | null;
  class_id: string;
  class_label: string;
  period: number;
  period_label: string | null;
  start_time: string | null;
  end_time: string | null;
  subject: string | null;
  teacher_id: string | null;
  teacher: string | null;
  free_teachers: number;
}

export interface CoordCover {
  date: string;
  day: string;
  total: number;
  absent: number;
  unassigned: number;
  rows: CoordCoverRow[];
}

/**
 * The state of one period's lesson plan, from dash5_coord_lesson_plans.
 * "Updated" = done, note or skipped. "Not updated" = no_plan, not_updated or
 * pending. The last three are still ahead, or excused.
 */
export type CoordPlanState =
  | "done" | "note" | "skipped"
  | "no_plan" | "not_updated" | "pending"
  | "planned" | "unplanned" | "holiday";

export interface CoordPlanItem {
  subject: string | null;
  teacher: string | null;
  state: CoordPlanState;
  /** The chapter the plan is for. Null on a note, or a plan with no chapter. */
  topic: string | null;
  /** The teacher's note, on a note-only period (a test, an activity). */
  note: string | null;
  marked_at: string | null;
  /** From an optional-group (basket) period, which carries several subjects. */
  basket: boolean;
}

export interface CoordLessonPlans {
  /** Null only when the wing has no classes at all. */
  class_id: string | null;
  class_label?: string;
  /** Always a Monday. */
  week_start?: string;
  today: string;
  /** Institution-local HH:MM the "over" line was drawn at. */
  now?: string;
  periods: { period: number; label: string | null; start_time: string; end_time: string }[];
  days: {
    idx: number; date: string; dow: string;
    /** False on a day the class's period structure does not run. */
    working: boolean;
    holiday: { title: string; kind: "holiday" | "exam_block" } | null;
  }[];
  summary?: Record<CoordPlanState, number> & {
    teaching: number;
    updated: number;
    /** Periods that have already happened; the honest denominator. */
    over: number;
    /** Updated among `over`. What the headline and the KPI both print. */
    updated_over: number;
  };
  cells: { day: number; period: number; items: CoordPlanItem[] }[];
}

export interface CoordBacklog {
  week_start: string;
  today: string;
  total: number;
  teachers: number;
  rows: {
    teacher_id: string; name: string;
    periods: number; classes: number;
    oldest: string; oldest_days: number;
  }[];
}

export interface CoordAttendanceByClass {
  today: string;
  days_in_window: number;
  wing_pct: number | null;
  unmarked_today: number;
  rows: {
    class_id: string; label: string; students: number;
    pct: number | null; marked: number; present: number;
    days_marked: number; marked_today: boolean;
  }[];
}

export interface CoordSuggestion {
  code: string;
  title: string;
  detail: string;
  priority: number;
  task_type: string;
  due_days: number;
  due_date: string;
  assignee_id: string;
  assignee: string;
  class_id: string | null;
}

export interface CoordSubjectRow {
  subject_id: string;
  subject_key: string;
  name: string;
  /** Null on a subject nobody has examined: "not assessed", never a zero. */
  accuracy: number | null;
  coverage: number | null;
  classes: number;
  papers: number;
  attempts: number;
  pending_grading: number;
  teachers: number;
  teacher: string | null;
}

export interface CoordSubjects {
  scope: "wing" | "class";
  class_id: string | null;
  class_label: string | null;
  wing_avg: number | null;
  total: number;
  assessed: number;
  rows: CoordSubjectRow[];
}

export interface CoordCommunication {
  notices: {
    total: number; sent: number; opened: number; acknowledged: number;
    recent: { id: string; title: string; published_at: string; scope: string; priority: string }[];
  };
  ptm: { total: number; bookings: number };
}

/* ------------------------------------------------------------- the calls -- */

/**
 * One RPC, one hook, one shape. `enabled` is never conditional: the console
 * only mounts for a coordinator, and a coordinator without a wing gets a
 * server-side refusal that the card renders as an error, which is the honest
 * answer and the one a silent empty state would hide.
 */
function coordQuery<T>(key: string, fn: () => Promise<T>, staleMs = 60_000) {
  return {
    queryKey: ["dash5", "coord", key] as const,
    staleTime: staleMs,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: fn,
  };
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  // The generated RPC map is keyed by literal names; every one of these was
  // spliced in by hand (never regenerate types.ts wholesale, it has silently
  // dropped schema before).
  const { data, error } = await supabase.rpc(
    // `as never` like args: rpc's signature instantiated over all 500+ generated names sits
    // at TypeScript's limit, and one more spliced function tips it into TS2589.
    name as never,
    args as never,
  );
  if (error) throw error;
  return data as unknown as T;
}

export function useCoordScope() {
  // The wing and its size change when somebody edits the school, not while a
  // dashboard is open.
  return useQuery(coordQuery("scope", () => rpc<CoordScope>("dash5_coord_scope"), 5 * 60_000));
}

/*
 * Cards, desk and suggestions resolve the wing from auth.uid() and take no
 * argument, so the console prefetches them in parallel with dash5_coord_scope
 * instead of waiting for the scope gate to mount their cards. The options
 * objects are shared by the prefetch and the hook, so the key and the queryFn
 * cannot drift apart.
 */
export const coordCardsQuery = queryOptions(
  coordQuery("cards", () => rpc<CoordCards>("dash5_coord_cards")));

export const coordDeskQuery = queryOptions(
  coordQuery("desk", () => rpc<CoordDesk>("dash5_coord_desk")));

export const coordSuggestionsQuery = queryOptions(
  coordQuery("suggestions", () =>
    rpc<{ pace: number; total: number; rows: CoordSuggestion[] }>("dash5_coord_task_suggestions")));

export function useCoordCards() {
  return useQuery(coordCardsQuery);
}

export function useCoordDesk() {
  return useQuery(coordDeskQuery);
}

export function useCoordClasses() {
  return useQuery(coordQuery("classes", () => rpc<CoordClasses>("dash5_coord_classes")));
}

export function useCoordStaff() {
  return useQuery(coordQuery("staff", () => rpc<CoordStaff>("dash5_coord_staff")));
}

/** The list behind the desk tile. Only fetched once the drawer opens. */
export function useCoordLeave(enabled: boolean) {
  return useQuery({
    ...coordQuery("leave", () =>
      rpc<{ total: number; rows: CoordLeaveRow[] }>("dash5_coord_leave", { p_limit: 50 })),
    enabled,
  });
}

export function useCoordRechecks(enabled: boolean) {
  return useQuery({
    ...coordQuery("rechecks", () =>
      rpc<{ total: number; rows: CoordRecheckRow[] }>("dash5_coord_rechecks", { p_limit: 50 })),
    enabled,
  });
}

export function useCoordMyTasks() {
  return useQuery(coordQuery("myTasks", () =>
    rpc<{ total: number; overdue: number; high: number; rows: CoordTaskRow[] }>(
      "dash5_coord_my_tasks", { p_limit: 40 })));
}

export function useCoordCover(date?: string) {
  return useQuery({
    ...coordQuery("cover", () => rpc<CoordCover>("dash5_coord_cover", { p_date: date ?? undefined })),
    queryKey: ["dash5", "coord", "cover", date ?? "today"] as const,
    // Substitution is the one thing on this page that turns over during the
    // day, so it is the one thing that goes stale in a minute rather than five.
    staleTime: 60_000,
  });
}

/**
 * One class's week of lesson plans. `classId` null lets the server pick the
 * wing's first class; `weekStart` null means this week, both resolved in the
 * institution's timezone. The server accepts four months back and two ahead.
 */
export function useCoordLessonPlans(classId: string | null, weekStart: string | null) {
  return useQuery({
    ...coordQuery("lessonPlans", () =>
      rpc<CoordLessonPlans>("dash5_coord_lesson_plans", {
        p_class_id: classId ?? undefined,
        p_week_start: weekStart ?? undefined,
      })),
    queryKey: ["dash5", "coord", "lessonPlans", classId, weekStart ?? "this-week"] as const,
    // Today's cells move from "still ahead" to "not updated" as periods end,
    // so a minute, not five.
    staleTime: 60_000,
  });
}

export function useCoordBacklog() {
  return useQuery(coordQuery("backlog", () => rpc<CoordBacklog>("dash5_coord_log_backlog")));
}

export function useCoordAttendanceByClass(days = 20) {
  return useQuery({
    ...coordQuery("attByClass", () =>
      rpc<CoordAttendanceByClass>("dash5_coord_attendance_by_class", { p_days: days })),
    queryKey: ["dash5", "coord", "attByClass", days] as const,
  });
}

export function useCoordSuggestions() {
  return useQuery(coordSuggestionsQuery);
}

/**
 * Subject-wise performance for the wing, or for one class inside it.
 *
 * Its own RPC because the card's admin data source (dash_school_subject_
 * performance / dash_subject_performance) is gated on dash_resolve_institution
 * and raises for a coordinator. Built on the same atoms as the performance
 * tree, so a subject's bar and its row in the tree cannot disagree.
 */
export function useCoordSubjects(classId: string | null) {
  return useQuery({
    ...coordQuery("subjects", () =>
      rpc<CoordSubjects>("dash5_coord_subjects", { p_class_id: classId ?? undefined })),
    queryKey: ["dash5", "coord", "subjects", classId] as const,
    // Year-level subject averages move with marks, not minute to minute.
    staleTime: 5 * 60_000,
  });
}

export function useCoordCommunication() {
  return useQuery(coordQuery("communication", () =>
    rpc<CoordCommunication>("dash5_coord_communication"), 5 * 60_000));
}
