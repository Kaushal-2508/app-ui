import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AttemptQuestion = {
  snapshot_id: string;
  subject_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
  selected_answer: "A" | "B" | "C" | "D" | null;
  marked_for_review: boolean;
  time_spent_seconds: number;
};

export function useOlympiadAttemptQuestions(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "attempt-questions", attemptId],
    queryFn: async (): Promise<AttemptQuestion[]> => {
      if (!attemptId) return [];
      const { data, error } = await supabase.rpc("oly_get_attempt_questions", { p_attempt_id: attemptId });
      if (error) throw error;
      return ((data as { questions: AttemptQuestion[] })?.questions ?? []) as AttemptQuestion[];
    },
    enabled: !!attemptId,
    // §23.2: questions snapshot is frozen at start — no need to refetch
    staleTime: Infinity,
    gcTime: 60 * 60_000,  // keep in cache for 1 hour
  });
}
