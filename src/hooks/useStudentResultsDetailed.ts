import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Detailed own-published-results feed for the My Results page.
 *
 * This is the filter/trajectory-aware companion to the lighter `useStudentResults`
 * (src/hooks/useDashboardData.ts). It carries — per result — the data the My Results
 * filters and the per-subject trajectory need that the lighter hook doesn't:
 *   - exam_type (term / unit / weekly / unspecified) so a quiz is never averaged
 *     into a term exam,
 *   - the exam date (scheduled_date, falling back to the result publish date) so the
 *     time-range filter and the trajectory can order tests chronologically,
 *   - the subject name(s) for the exam (a multi-subject exam carries several).
 *
 * §23-safe: reads the user from useAuth (no JWT-less getUser), explicit column
 * lists (no select("*")), own published rows only (RLS-safe — never scans
 * classmates), staleTime 60s.
 */

export interface DetailedStudentResult {
  id: string;
  attempt_id: string;
  exam_id: string | null;
  exam_title: string;
  exam_type: string;
  /** Best-effort test date: exam scheduled_date, else the result publish date. */
  exam_date: string;
  published_at: string;
  is_pass: boolean;
  /** Student did not sit this exam. Check before showing percentage/marks:
   *  both are 0 for an absentee and otherwise read as a genuine zero. */
  is_absent: boolean;
  percentage: number | null;
  total_marks_obtained: number;
  total_max_marks: number;
  grade: string | null;
  rank_in_class: number | null;
  /** Subject names for the exam — empty array if the exam has no mapped subjects. */
  subjects: string[];
}

/** Shape of the joined attempt row from the explicit select below. */
interface AttemptJoinRow {
  id: string;
  exam_id: string | null;
  submitted_at: string | null;
  exams: {
    title: string | null;
    total_marks: number | null;
    exam_type: string | null;
    scheduled_date: string | null;
    exam_subjects: { universal_subjects: { name: string | null } | null }[] | null;
  } | null;
}

interface FinalResultRow {
  id: string;
  attempt_id: string;
  is_pass: boolean | null;
  is_absent: boolean | null;
  percentage: number | null;
  total_marks_obtained: number;
  total_max_marks: number;
  grade: string | null;
  rank_in_class: number | null;
  published_at: string | null;
}

export function useStudentResultsDetailed() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-results-detailed", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<DetailedStudentResult[]> => {
      if (!user?.id) return [];

      // 1. Own submitted attempts + their exam metadata + mapped subjects.
      const { data: attemptsRaw, error: attemptsError } = await supabase
        .from("student_exam_attempts")
        .select(
          `
          id,
          exam_id,
          submitted_at,
          exams (
            title,
            total_marks,
            exam_type,
            scheduled_date,
            exam_subjects (
              universal_subjects ( name )
            )
          )
        `,
        )
        .eq("student_id", user.id)
        .eq("is_submitted", true);

      if (attemptsError) throw attemptsError;

      const attempts = (attemptsRaw ?? []) as unknown as AttemptJoinRow[];
      if (attempts.length === 0) return [];

      const attemptById = new Map(attempts.map((a) => [a.id, a]));

      // 2. Published final_results for those attempts (explicit columns).
      const { data: resultsRaw, error: resultsError } = await supabase
        .from("final_results")
        .select(
          "id, attempt_id, is_pass, is_absent, percentage, total_marks_obtained, total_max_marks, grade, rank_in_class, published_at",
        )
        .in(
          "attempt_id",
          attempts.map((a) => a.id),
        )
        .eq("is_published", true);

      if (resultsError) throw resultsError;

      const results = (resultsRaw ?? []) as FinalResultRow[];

      return results.map((r) => {
        const attempt = attemptById.get(r.attempt_id);
        const exam = attempt?.exams ?? null;
        const subjects = (exam?.exam_subjects ?? [])
          .map((es) => es.universal_subjects?.name)
          .filter((name): name is string => !!name);
        const publishedAt = r.published_at ?? attempt?.submitted_at ?? new Date().toISOString();

        return {
          id: r.id,
          attempt_id: r.attempt_id,
          exam_id: attempt?.exam_id ?? null,
          exam_title: exam?.title ?? "Unknown Exam",
          exam_type: exam?.exam_type ?? "unspecified",
          exam_date: exam?.scheduled_date ?? attempt?.submitted_at ?? publishedAt,
          published_at: publishedAt,
          is_pass: !!r.is_pass,
          is_absent: !!r.is_absent,
          percentage: r.percentage,
          total_marks_obtained: r.total_marks_obtained,
          total_max_marks: r.total_max_marks,
          grade: r.grade,
          rank_in_class: r.rank_in_class,
          subjects,
        } satisfies DetailedStudentResult;
      });
    },
  });
}
