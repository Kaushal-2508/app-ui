import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-exam result progress for the My Exams status filter.
 *
 * `exams.status` is NOT a reliable results signal — measured on prod, 320 exams
 * sitting at status='published' already had published results, so filtering
 * "Result Published" on status='completed' would have hidden almost all of them.
 * The authoritative flag is final_results.is_published, which hangs off
 * student_exam_attempts, so the counts are aggregated by the
 * get_exam_result_progress RPC (SECURITY INVOKER — RLS still scopes the caller)
 * rather than by pulling attempt rows down and counting them here (§23).
 */
export interface ExamResultProgress {
  submittedAttempts: number;
  publishedResults: number;
}

export function useExamResultProgress(examIds: string[]) {
  // Stable key: the same set of exams in any order is the same query.
  const sortedIds = [...new Set(examIds)].sort();

  return useQuery({
    queryKey: ["exam-result-progress", sortedIds],
    enabled: sortedIds.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Record<string, ExamResultProgress>> => {
      const { data, error } = await supabase.rpc("get_exam_result_progress", {
        _exam_ids: sortedIds,
      });
      if (error) throw error;

      const out: Record<string, ExamResultProgress> = {};
      ((data ?? []) as Array<{
        exam_id: string;
        submitted_attempts: number | string;
        published_results: number | string;
      }>).forEach((row) => {
        out[row.exam_id] = {
          submittedAttempts: Number(row.submitted_attempts) || 0,
          publishedResults: Number(row.published_results) || 0,
        };
      });
      return out;
    },
  });
}