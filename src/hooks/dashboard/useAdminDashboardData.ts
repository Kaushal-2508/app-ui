import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { dashRetry } from "./dashRetry";

/**
 * Hooks for the five blueprint data sources added in
 * supabase/migrations/20260822101200_dash_admin_blueprint_rpcs.sql.
 *
 * Every one holds an explicit `staleTime` (§23) and every aggregate is computed
 * in SQL — the client never fetches rows to count them.
 *
 * These are admin-only surfaces, so unlike the shared `dash_*` hooks there is
 * no `dash_scoped_*` sibling: a coordinator's dashboard does not render roster
 * counts or wing accountability.
 */

/* ------------------------------------------------------------- shapes ------ */

export interface RosterCounts {
  students: { count: number; new_30d: number };
  staff: { count: number };
  /** `marked_today` = classes that have taken a register today, not all classes. */
  classes: { count: number; wings: number; marked_today: number };
  students_present: {
    present: number;
    /** Every student marked today, students on leave included. */
    total: number;
    marked: boolean;
    pct: number | null;
    absent: number;
    on_leave: number;
  };
  staff_present: {
    present: number;
    total: number;
    marked: boolean;
    pct: number | null;
  };
}

export interface PortalAdoptionLaggard {
  student_id: string;
  name: string;
  class: string | null;
  last_sign_in_at: string | null;
}

export interface PortalAdoption {
  total: number;
  never_signed_in: number;
  active_7d: number;
  active_30d: number;
  pct_active_7d: number | null;
  pct_active_30d: number | null;
  never_list: PortalAdoptionLaggard[];
}

export interface WingPerformanceRow {
  wing_id: string;
  wing_name: string;
  coordinators: string | null;
  classes: number;
  students: number;
  avg_pct: number | null;
}

export interface AttendanceComplianceRow {
  class_id: string;
  class_name: string;
  days_marked: number;
  days_expected: number;
  pct: number | null;
  last_marked: string | null;
}

export interface DashEventRow {
  event_id: string;
  title: string;
  kind: string;
  starts_on: string;
  ends_on: string | null;
  is_upcoming: boolean;
}

/* -------------------------------------------------------------- hooks ------ */

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** `pct` is legitimately null when nothing is marked, so it is NOT coerced to 0
 *  the way the counts are: a real 0% and "no basis to compute one" are different
 *  answers and the tiles render them differently. */
const pct = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Turn the RPC's untyped jsonb into a `RosterCounts` whose numbers are numbers.
 *
 * `data as unknown as RosterCounts` is an assertion, not a check: typegen widens
 * a jsonb return to `Json`, so TypeScript is trusting a network payload it has
 * never seen. Any key the server does not send arrives as `undefined`, and the
 * Command Center calls `.toLocaleString()` on several of these — which throws
 * and blanks the ENTIRE page rather than the one tile. That is the failure mode
 * a stale deploy or a rolled-back migration produces, so the payload is
 * normalised once here, at the boundary where the lie is told, instead of every
 * call site guarding itself.
 */
function normalizeRosterCounts(raw: unknown): RosterCounts {
  const r = (raw ?? {}) as Partial<RosterCounts>;
  const students = r.students;
  const staff = r.staff;
  const classes = r.classes;
  const sp = r.students_present;
  const tp = r.staff_present;

  return {
    students: { count: num(students?.count), new_30d: num(students?.new_30d) },
    staff: { count: num(staff?.count) },
    classes: {
      count: num(classes?.count),
      wings: num(classes?.wings),
      marked_today: num(classes?.marked_today),
    },
    students_present: {
      present: num(sp?.present),
      total: num(sp?.total),
      absent: num(sp?.absent),
      on_leave: num(sp?.on_leave),
      marked: sp?.marked === true,
      pct: pct(sp?.pct),
    },
    staff_present: {
      present: num(tp?.present),
      total: num(tp?.total),
      marked: tp?.marked === true,
      pct: pct(tp?.pct),
    },
  };
}

export function useRosterCounts() {
  return useQuery({
    queryKey: ["dash", "admin", "rosterCounts"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<RosterCounts> => {
      const { data, error } = await supabase.rpc("dash_admin_roster_counts", {});
      if (error) throw error;
      return normalizeRosterCounts(data);
    },
  });
}

/** The blueprint's hero shape: dated tiles, sparkline, engagement, wing split. */
export interface AdoptionMetricRow {
  n: number;
  pct: number;
}
export interface AdoptionWingRow {
  wing_id: string;
  wing_name: string;
  students: number;
  pct: number | null;
}
export interface AdminPortalAdoption {
  has_data: boolean;
  total_students: number;
  never_logged_in: { count: number; names: string[] };
  today: AdoptionMetricRow;
  yesterday: AdoptionMetricRow;
  avg_7: AdoptionMetricRow;
  avg_30: AdoptionMetricRow;
  delta_pp: number;
  trend: "up" | "down" | "flat";
  sparkline: { d: string; n: number; pct: number }[];
  engagement: { homework_pct: number | null; tests_pct: number | null };
  wings: AdoptionWingRow[];
}

export function useAdminPortalAdoption(classId?: string | null) {
  return useQuery({
    queryKey: ["dash", "admin", "adoptionHero", classId ?? null],
    // Sign-in rollups move once a day, so this is the one dashboard query that
    // genuinely does not need a 60s window.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AdminPortalAdoption> => {
      const { data, error } = await supabase.rpc("dash_admin_portal_adoption", {
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as AdminPortalAdoption;
    },
  });
}

export function usePortalAdoption(classId?: string | null) {
  return useQuery({
    // The class is part of the key, so switching classes refetches rather than
    // leaving the previous class's names on screen.
    queryKey: ["dash", "admin", "portalAdoption", classId ?? null],
    staleTime: 5 * 60_000, // sign-in counts move slowly; no need to re-poll often
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PortalAdoption> => {
      const { data, error } = await supabase.rpc("dash_student_portal_adoption", {
        p_class_id: classId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as PortalAdoption;
    },
  });
}

export function useWingPerformance() {
  return useQuery({
    queryKey: ["dash", "admin", "wingPerformance"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<WingPerformanceRow[]> => {
      const { data, error } = await supabase.rpc("dash_wing_performance", {});
      if (error) throw error;
      return (data ?? []) as unknown as WingPerformanceRow[];
    },
  });
}

export function useAttendanceCompliance(days = 14) {
  return useQuery({
    queryKey: ["dash", "admin", "attendanceCompliance", days],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AttendanceComplianceRow[]> => {
      const { data, error } = await supabase.rpc("dash_attendance_compliance", {
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as unknown as AttendanceComplianceRow[];
    },
  });
}

export function useDashEvents(limit = 6) {
  return useQuery({
    queryKey: ["dash", "admin", "events", limit],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<DashEventRow[]> => {
      const { data, error } = await supabase.rpc("dash_recent_events", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as unknown as DashEventRow[];
    },
  });
}

export interface SchoolSubjectRow {
  subject_id: string;
  subject_name: string;
  school_avg: number | null;
  results: number;
}

/**
 * School-wide subject averages, weakest first.
 *
 * NOT dash_subject_performance: that one requires a class id and RAISES
 * 'dashboard: class not in institution' when passed NULL, because
 * EXISTS(... WHERE id = NULL) is false. The blueprint's card is school-wide.
 */
export function useSchoolSubjectPerformance() {
  return useQuery({
    queryKey: ["dash", "admin", "schoolSubjects"],
    // Year-level subject averages move with marks, not minute to minute.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<SchoolSubjectRow[]> => {
      const { data, error } = await supabase.rpc("dash_school_subject_performance", {});
      if (error) throw error;
      return (data ?? []) as unknown as SchoolSubjectRow[];
    },
  });
}

export interface DigestBullet {
  code: string;
  severity: "high" | "medium" | "low";
  headline: string;
  detail: string | null;
  link_url: string | null;
}

/**
 * The dashboard digest.
 *
 * Derived in SQL from thresholds over data already on the page rather than
 * generated by a model. The blueprint calls the card "AI insights", but every
 * bullet it shows is an observation about a number ("adoption dropped 7pp",
 * "Mathematics is weakest at 58%"), so computing them is deterministic,
 * explainable, instant and free -- and cannot invent a statistic about a real
 * child. Rules that do not fire return nothing, so a quiet week is a short list.
 */
export function useAdminDigest() {
  return useQuery({
    queryKey: ["dash", "admin", "digest"],
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: dashRetry,
    queryFn: async (): Promise<DigestBullet[]> => {
      const { data, error } = await supabase.rpc("dash_admin_digest", {});
      if (error) throw error;
      return (data ?? []) as unknown as DigestBullet[];
    },
  });
}

export interface ClassPerformanceRow {
  class_id: string;
  class_name: string;
  students: number;
  avg_pct: number | null;
  results: number;
  exams: number;
  attendance_30d: number | null;
}

/**
 * Class averages over the academic year, weakest first.
 *
 * NOT dash_classes_table: its `recent_avg` only counts the last 60 days, which
 * on prod leaves 1 of 8 classes with a number — a ranking rendered from that
 * shows a single bar and reads as broken. Right window for a "what happened
 * lately" table, wrong one for "who is behind".
 */
export function useClassPerformance(wingId?: string | null) {
  return useQuery({
    // The wing is part of the key, so switching wings refetches rather than
    // re-ranking the previous wing's classes.
    queryKey: ["dash", "admin", "classPerformance", wingId ?? null],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ClassPerformanceRow[]> => {
      const { data, error } = await supabase.rpc("dash_class_performance", {
        p_wing_id: wingId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ClassPerformanceRow[];
    },
  });
}

export type DistributionBandKey = "doing_well" | "catching_up" | "needs_help";

export interface BandStudentRow {
  student_id: string;
  name: string;
  roll: string | null;
  class_name: string | null;
  latest_pct: number | null;
}

/**
 * The students behind one donut segment.
 *
 * Uses the same banding as `dash_student_distribution` (latest result per
 * student; >70 / 50-70 / <50), so the list length always equals the number the
 * segment showed. Verified against prod: 15 / 134 / 103 both ways.
 */
export function useStudentsInBand(
  band: DistributionBandKey | null,
  classId?: string | null,
) {
  return useQuery({
    queryKey: ["dash", "admin", "studentsInBand", band, classId ?? null],
    enabled: band !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<BandStudentRow[]> => {
      if (!band) return [];
      const { data, error } = await supabase.rpc("dash_students_in_band", {
        p_band: band,
        p_class_id: classId ?? undefined,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as unknown as BandStudentRow[];
    },
  });
}
