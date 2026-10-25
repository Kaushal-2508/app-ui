import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BankQuestion = {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  topic_id: string | null;
  topic_name: string | null;
  status: "active" | "inactive";
  times_used: number;
  total_correct: number;
  total_attempts: number;
  total_time_seconds: number;
  last_used_at: string | null;
  updated_at: string;
  avg_correct_rate_percent: number | null;
  avg_time_seconds: number | null;
};

export type BankFilters = {
  topicId?: string | null;
  status?: "active" | "inactive" | null;
};

export type BankSort =
  | "last_used_desc"
  | "times_used_desc"
  | "avg_correct_rate_asc";

export function useOlympiadQuestionBank(
  subjectId: string | undefined,
  gradeLevelId: string | undefined,
  filters: BankFilters,
  sort: BankSort,
  page: number,
  pageSize = 25,
) {
  return useQuery({
    queryKey: [
      "olympiad",
      "question-bank",
      subjectId,
      gradeLevelId,
      filters,
      sort,
      page,
      pageSize,
    ],
    queryFn: async (): Promise<{ rows: BankQuestion[]; total: number }> => {
      if (!subjectId || !gradeLevelId) return { rows: [], total: 0 };
      const { data, error } = await supabase.rpc("oly_question_bank_view", {
        p_subject_id: subjectId,
        p_grade_level_id: gradeLevelId,
        p_topic_id: filters.topicId ?? null,
        p_status: filters.status ?? null,
        p_sort: sort,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      const payload = (data ?? {}) as {
        rows?: BankQuestion[];
        total?: number;
      };
      return { rows: payload.rows ?? [], total: payload.total ?? 0 };
    },
    enabled: !!subjectId && !!gradeLevelId,
    staleTime: 30_000,
  });
}
