import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface YearReportMeta {
  academic_year: string | null;
  from: string;
  to: string;
  /** True when the school has no cal_academic_years row and the window is a
   *  trailing 12 months. The report says so rather than inventing a year label. */
  window_is_synthetic: boolean;
  generated_at: string;
  timezone: string;
}

export interface YearReportSnapshot {
  n_assessments: number;
  my_avg: number | null;
  class_avg: number | null;
  pass_count: number;
  pass_unknown: number;
  /** NULL below 3 assessments. */
  consistency: number | null;
}

export interface YearReportStanding {
  cohort_n: number;
  /** All four are NULL below 5 classmates (see the migration's privacy floors). */
  percentile: number | null;
  ahead_of: number | null;
  peers: number | null;
  topper_avg: number | null;
  histogram: { bin: string; count: number }[] | null;
}

export interface YearReportExam {
  exam_id: string;
  title: string;
  exam_type: string | null;
  exam_date: string;
  my_pct: number;
  obtained: number | null;
  out_of: number | null;
  is_pass: boolean | null;
  class_avg: number | null;
  n_students: number;
}

export interface YearReportSubject {
  subject: string;
  student_avg: number;
  n_tests: number;
  class_avg: number | null;
  class_high: number | null;
  n_students: number;
}

export interface YearReportChapter {
  chapter_id: string;
  chapter: string;
  subject: string | null;
  chapter_number: number | null;
  student_avg: number;
  n_tests: number;
  class_avg: number | null;
  n_students: number;
}

export interface YearReportAttendance {
  present: number;
  absent: number;
  excused: number;
  holiday: number;
  graded_days: number;
  percentage: number | null;
}

export interface YearReportBadge {
  name: string;
  icon: string | null;
  tier: string | null;
  earned_at: string;
}

export interface YearReport {
  meta: YearReportMeta;
  snapshot: YearReportSnapshot;
  standing: YearReportStanding;
  series: YearReportExam[];
  subjects: YearReportSubject[];
  chapters: YearReportChapter[];
  attendance: YearReportAttendance;
  engagement: { points: number; badge_count: number; badges: YearReportBadge[] };
  coverage: { n_results: number; n_no_subject: number; n_no_chapter: number };
}

/**
 * Imperative fetch for the one-shot download action. The report is built when
 * the user clicks, so there is no query to subscribe to.
 *
 * Passing a studentId switches to the staff RPC, which is authorised
 * server-side by can_edit_student_details (migration 20260824120000): same
 * institution, coordinators wing-scoped, teachers must actually teach the
 * student, super_admin exempt. Both RPCs are thin wrappers over ONE shared
 * implementation, so a student and their teacher always see identical numbers.
 */
export async function fetchStudentYearReport(studentId?: string | null): Promise<YearReport> {
  const { data, error } = studentId
    ? await supabase.rpc("student_year_report_for", { p_student_id: studentId })
    : await supabase.rpc("student_year_report");
  if (error) throw error;
  return data as unknown as YearReport;
}

/**
 * Everything the downloadable year report prints, in ONE call
 * (migration 20260817120000).
 *
 * Deliberately one RPC rather than composing the half-dozen existing student
 * RPCs: those answer different questions over different windows (all-time vs
 * rolling vs academic year), so stitching them would let two sections of the
 * same PDF disagree about which tests were counted.
 *
 * Not fetched on mount — the report is only built when the student asks for it.
 */
export function useStudentYearReport(enabled: boolean, studentId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    // studentId is part of the key: a staff member viewing two students in a
    // row must not be served the first one's cached report.
    queryKey: ["student-year-report", user?.id, studentId ?? "self"],
    enabled: enabled && !!user?.id,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchStudentYearReport(studentId),
  });
}
