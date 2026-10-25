import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudentSubjectScore = {
  subject_id: string;
  subject_name: string;
  correct: number;
  total: number;
  marks_obtained: number;
  marks_max: number;
  percentage: number;
};

export type StudentResultRow = {
  oly_student_id: string;
  percentage: number;
  total_marks_obtained: number;
  total_max_marks: number;
  subject_scores: StudentSubjectScore[];
  class_rank: number | null;
  class_total: number | null;
  certificate_tier: "gold" | "silver" | "bronze" | "participation" | "absent";
};

/**
 * Published results keyed by oly_student_id — powers the Students page's
 * Appeared/Absent filter and the per-subject Report view. Empty object until
 * results are published. Paginated read (PostgREST caps at 1000 rows, §23).
 */
export function useOlympiadStudentResults(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "student-results", olySchoolId],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<Record<string, StudentResultRow>> => {
      const PAGE = 1000;
      const out: Record<string, StudentResultRow> = {};
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("oly_results")
          .select(
            "oly_student_id, percentage, total_marks_obtained, total_max_marks, subject_scores, class_rank, class_total, certificate_tier",
          )
          .eq("oly_school_id", olySchoolId as string)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of data ?? []) {
          out[r.oly_student_id] = {
            oly_student_id: r.oly_student_id,
            percentage: Number(r.percentage),
            total_marks_obtained: Number(r.total_marks_obtained),
            total_max_marks: Number(r.total_max_marks),
            subject_scores: Array.isArray(r.subject_scores)
              ? (r.subject_scores as unknown as StudentSubjectScore[])
              : [],
            class_rank: r.class_rank,
            class_total: r.class_total,
            certificate_tier: r.certificate_tier as StudentResultRow["certificate_tier"],
          };
        }
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      return out;
    },
    staleTime: 60_000,
  });
}
