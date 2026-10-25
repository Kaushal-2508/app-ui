import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StudentHybridResultRow {
  attempt_id: string;
  exam_title: string;
  evaluated_at: string | null;
  total_marks_awarded: number | null;
  total_max_marks: number | null;
  percent: number | null;
}

/**
 * Evaluated hybrid attempts for the currently signed-in student.
 * Distinct from useStudentResults (final_results) because hybrid stores
 * results on its own data plane — see CLAUDE.md / hybrid migration notes.
 */
export function useStudentHybridResults() {
  return useQuery({
    queryKey: ["student-hybrid-results"],
    queryFn: async (): Promise<StudentHybridResultRow[]> => {
      const { data: userResult } = await supabase.auth.getUser();
      const userId = userResult.user?.id;
      if (!userId) return [];
      const { data, error } = await supabase
        .from("hybrid_exam_attempts")
        .select(
          `id, evaluated_at, total_marks_awarded, total_max_marks,
           exams ( title )`,
        )
        .eq("student_id", userId)
        .eq("status", "evaluated")
        .order("evaluated_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{
        id: string;
        evaluated_at: string | null;
        total_marks_awarded: number | null;
        total_max_marks: number | null;
        exams: { title: string | null } | Array<{ title: string | null }>;
      }>).map((row) => {
        const examRow = Array.isArray(row.exams) ? row.exams[0] : row.exams;
        const awarded = row.total_marks_awarded === null ? null : Number(row.total_marks_awarded);
        const max = row.total_max_marks === null ? null : Number(row.total_max_marks);
        const percent =
          awarded !== null && max !== null && max > 0 ? (awarded / max) * 100 : null;
        return {
          attempt_id: row.id,
          exam_title: examRow?.title ?? "Hybrid exam",
          evaluated_at: row.evaluated_at,
          total_marks_awarded: awarded,
          total_max_marks: max,
          percent,
        };
      });
    },
  });
}
