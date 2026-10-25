import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useScopedStudentId } from "@/contexts/StudentScopeContext";

/**
 * Hooks over the student-facing class-comparison RPCs
 * (migration 20260622120000_student_class_comparison_rpcs.sql).
 *
 * These are SECURITY DEFINER and return ONLY de-identified class aggregates —
 * they replace the fabricated multiplier numbers (avg*0.95 etc.) the dashboard
 * used to show. All §23-compliant: read user from useAuth (no JWT-less getUser),
 * staleTime 60s, server-side aggregation (no raw class rows pulled client-side).
 */

export interface SubjectComparisonRow {
  subject: string;
  /** The student's average % in this subject (null if none). */
  student_avg: number | null;
  /** The class average % in this subject (null if no classmates). */
  class_avg: number | null;
  n_tests: number;
  n_students: number;
}

export interface SubjectComparison {
  has_data: boolean;
  subjects: SubjectComparisonRow[];
}

/** Per-subject: the student's average vs the class average, weakest-first. */
export function useStudentSubjectComparison() {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-subject-comparison", user?.id, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<SubjectComparison> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_subject_class_comparison_for", { p_student_id: scopedId })
        : await supabase.rpc("student_subject_class_comparison");
      if (error) throw error;
      return (data as unknown as SubjectComparison) ?? { has_data: false, subjects: [] };
    },
  });
}

export interface ScoreTrendPoint {
  exam_id: string;
  title: string;
  exam_type: string;
  exam_date: string;
  percentage: number;
}

/**
 * The student's own score trend — last `limit` published results, chronological.
 * Drives the single-line trend chart, the "average of last 5 tests" tile, and
 * the "improved/declined since last test" label.
 */
export function useStudentScoreTrend(limit = 8) {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-score-trend", user?.id, limit, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ScoreTrendPoint[]> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_score_trend_for", { p_student_id: scopedId, p_limit: limit })
        : await supabase.rpc("student_score_trend", { p_limit: limit });
      if (error) throw error;
      return (data as unknown as ScoreTrendPoint[]) ?? [];
    },
  });
}

export interface ChapterPerformanceRow {
  subject: string;
  chapter: string;
  avg_pct: number | null;
  n_tests: number;
}

/**
 * Per-chapter scores for the calling student (migration 20260805150000).
 *
 * Chapters aren't stored on individual questions — they're what the TEACHER tags
 * the exam with at creation time (`exam_topics`), so a chapter's score is the
 * average of the student's results on exams covering it. Lets the dashboard point
 * at the exact chapter to revise rather than only the subject.
 */
export function useStudentChapterPerformance() {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-chapter-performance", user?.id, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ChapterPerformanceRow[]> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_chapter_performance_for", { p_student_id: scopedId })
        : await supabase.rpc("student_chapter_performance");
      if (error) throw error;
      return (data as unknown as ChapterPerformanceRow[]) ?? [];
    },
  });
}

export interface ChapterAnalysisRow {
  chapter_id: string;
  chapter: string;
  /** Syllabus chapter number when the school records one, else null. */
  chapter_number: number | null;
  student_avg: number | null;
  /** NULL when fewer than 3 classmates have published results (suppressed server-side). */
  class_avg: number | null;
  n_students: number;
  n_tests: number;
}

export interface ChapterAnalysis {
  has_data: boolean;
  /** Tests matching the filters, whether or not their chapters were tagged. Lets
   *  the UI tell "no tests here" apart from "nobody tagged the chapters". */
  n_exams: number;
  chapters: ChapterAnalysisRow[];
}

export interface ChapterAnalysisFilters {
  subject: string | null;
  /** 'term' | 'unit' | 'weekly' | 'unspecified'; null = every type. */
  examType?: string | null;
  /** Inclusive window start as yyyy-MM-dd; null = all time. */
  from?: string | null;
  /** "Most recent N tests"; null = no cap. */
  lastN?: number | null;
}

/**
 * Per-chapter scores for ONE subject with the class average alongside
 * (migration 20260814120000), for the My Results chapter chart.
 *
 * Takes the same filter triplet the results page applies to its list and
 * trajectory, so the two charts always describe the same set of tests — a bar
 * chart silently covering a wider window than the line above it is the kind of
 * mismatch that makes a dashboard untrustworthy.
 */
export function useStudentChapterAnalysis({
  subject,
  examType = null,
  from = null,
  lastN = null,
}: ChapterAnalysisFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-chapter-analysis", user?.id, subject, examType, from, lastN],
    enabled: !!user?.id && !!subject,
    staleTime: 60_000,
    queryFn: async (): Promise<ChapterAnalysis> => {
      // Omit rather than null the optional params so each falls back to its SQL
      // default instead of being pinned to NULL by the request body.
      const args: {
        p_subject: string;
        p_exam_type?: string;
        p_from?: string;
        p_last_n?: number;
      } = { p_subject: subject ?? "" };
      if (examType) args.p_exam_type = examType;
      if (from) args.p_from = from;
      if (lastN && lastN > 0) args.p_last_n = lastN;

      const { data, error } = await supabase.rpc("student_chapter_analysis", args);
      if (error) throw error;
      return (
        (data as unknown as ChapterAnalysis) ?? { has_data: false, n_exams: 0, chapters: [] }
      );
    },
  });
}

/** The five windows offered by the dashboard time pickers. `tm` is the calendar
 *  month to date — the same window the "Attendance this month" status tile
 *  counts, so the tile and the Attendance card can be made to agree. Every other
 *  option is a trailing window measured back from today. */
export type TrendRange = "tm" | "1m" | "3m" | "6m" | "ay";

/** Single source of truth for the time-picker options, shared by the Performance
 *  Overview and Attendance cards so the two dropdowns never drift apart.
 *  Ordered shortest window first. */
export const TREND_RANGE_OPTIONS: { value: TrendRange; label: string }[] = [
  { value: "tm", label: "This month" },
  { value: "1m", label: "Last 1 month" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "ay", label: "Last academic year" },
];

/** Short phrase for sentence labels, e.g. "Attendance is on track in the last month". */
export const TREND_RANGE_PHRASE: Record<TrendRange, string> = {
  tm: "this month",
  "1m": "in the last month",
  "3m": "in the last 3 months",
  "6m": "in the last 6 months",
  ay: "this academic year",
};

export interface PerformanceTrendPoint {
  exam_id: string;
  /** final_results.id — the deep-link target for /student/results/:resultId.
   *  Added by migration 20260814130000; null for any cached older payload. */
  result_id: string | null;
  title: string;
  exam_type: string;
  exam_date: string;
  percentage: number;
}

export interface PerformanceTrend {
  has_data: boolean;
  range: TrendRange;
  /** The normalised subject the chart is filtered to; null = all subjects. */
  subject: string | null;
  academic_year: string | null;
  from: string;
  to: string | null;
  /** Every subject the student has a published result in (all-time), for the picker. */
  subjects: string[];
  points: PerformanceTrendPoint[];
}

const EMPTY_TREND: PerformanceTrend = {
  has_data: false,
  range: "3m",
  subject: null,
  academic_year: null,
  from: "",
  to: null,
  subjects: [],
  points: [],
};

/**
 * Subject- and time-filtered performance trend for the dashboard chart.
 *
 * One RPC returns both the picker options and the filtered points, so switching a
 * filter is a single round trip. `placeholderData` keeps the previous payload on
 * screen while the next one loads, so the dropdowns never blank out mid-refetch.
 *
 * Per-subject note: the schema has no per-subject mark (final_results holds one
 * percentage per exam), so a subject filter selects the EXAMS that included that
 * subject — the same derivation My Results' subject trajectory uses.
 */
export function useStudentPerformanceTrend(subject: string | null, range: TrendRange) {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-performance-trend", user?.id, subject, range, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<PerformanceTrend> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_performance_trend_for", {
            p_student_id: scopedId,
            p_subject: subject ?? undefined,
            p_range: range,
          })
        : await supabase.rpc("student_performance_trend", {
            p_subject: subject ?? undefined,
            p_range: range,
          });
      if (error) throw error;
      return (data as unknown as PerformanceTrend) ?? EMPTY_TREND;
    },
  });
}

export interface ExamComparison {
  has_data: boolean;
  student_percentage?: number;
  class_average?: number;
  class_high?: number;
  /** cume_dist × 100 (0–100); null if cohort size is 1. */
  student_percentile?: number | null;
  cohort_size?: number;
}

/**
 * Class comparison for ONE finalised test the student took (by attempt id):
 * class average, class high, and the student's percentile. Only call for a
 * published result; the RPC verifies the attempt belongs to the caller.
 */
export function useStudentExamComparison(attemptId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-exam-comparison", user?.id, attemptId],
    enabled: !!user?.id && !!attemptId,
    staleTime: 60_000,
    queryFn: async (): Promise<ExamComparison> => {
      const { data, error } = await supabase.rpc("student_exam_class_comparison", {
        p_attempt_id: attemptId as string,
      });
      if (error) throw error;
      return (data as unknown as ExamComparison) ?? { has_data: false };
    },
  });
}

/**
 * The same comparison for a HYBRID attempt. Hybrid exams are sat by the whole
 * class too, but they live on their own data plane (`hybrid_exam_attempts`), so
 * they need their own SECURITY DEFINER aggregate (migration 20260805140000).
 * The payload shape is identical, so the UI is shared.
 */
export function useStudentHybridExamComparison(attemptId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-hybrid-exam-comparison", user?.id, attemptId],
    enabled: !!user?.id && !!attemptId,
    staleTime: 60_000,
    queryFn: async (): Promise<ExamComparison> => {
      const { data, error } = await supabase.rpc("student_hybrid_class_comparison", {
        p_attempt_id: attemptId as string,
      });
      if (error) throw error;
      return (data as unknown as ExamComparison) ?? { has_data: false };
    },
  });
}

export interface ClassStanding {
  has_data: boolean;
  /** cume_dist × 100 (0–100) of the student's OVERALL average among classmates. */
  student_percentile?: number | null;
  cohort_size?: number;
  student_avg?: number;
  class_avg?: number;
}

/**
 * The student's overall class standing — their percentile (by overall average
 * across published results) among classmates. Drives the dashboard "Class
 * standing" tile via percentileToBand().
 */
export function useStudentClassStanding() {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-class-standing", user?.id, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ClassStanding> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_overall_class_standing_for", { p_student_id: scopedId })
        : await supabase.rpc("student_overall_class_standing");
      if (error) throw error;
      return (data as unknown as ClassStanding) ?? { has_data: false };
    },
  });
}
