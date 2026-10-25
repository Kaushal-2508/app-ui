import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReviewQuestion = {
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
  correct_answer: "A" | "B" | "C" | "D";
};

export function useOlympiadReviewQuestions(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "review-questions", attemptId],
    queryFn: async (): Promise<ReviewQuestion[]> => {
      if (!attemptId) return [];
      // Direct SELECT on oly_questions_snapshot (RLS lets student SELECT own via attempt ownership)
      const { data, error } = await supabase
        .from("oly_questions_snapshot")
        .select(
          "id, subject_id, position_in_subject, question_text, option_a, option_b, option_c, option_d, correct_answer, marks",
        )
        .eq("oly_attempt_id", attemptId)
        .order("subject_id")
        .order("position_in_subject");
      if (error) throw error;

      const snapshotIds = (data ?? []).map((q) => q.id);
      if (snapshotIds.length === 0) return [];

      const { data: answers } = await supabase
        .from("oly_answers")
        .select("oly_question_snapshot_id, selected_answer")
        .in("oly_question_snapshot_id", snapshotIds);

      const answerMap = new Map<string, string | null>();
      for (const a of answers ?? []) answerMap.set(a.oly_question_snapshot_id, a.selected_answer);

      return (data ?? []).map((q) => ({
        snapshot_id: q.id,
        subject_id: q.subject_id,
        position: q.position_in_subject,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        marks: q.marks,
        selected_answer: (answerMap.get(q.id) ?? null) as "A" | "B" | "C" | "D" | null,
        correct_answer: q.correct_answer as "A" | "B" | "C" | "D",
      }));
    },
    enabled: !!attemptId,
    staleTime: 5 * 60_000, // immutable post-publish — aggressive caching
  });
}
