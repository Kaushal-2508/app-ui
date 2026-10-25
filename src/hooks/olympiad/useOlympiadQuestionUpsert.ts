import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type QuestionUpsertInput = {
  id?: string;
  subject_id: string;
  grade_level_id: string;
  topic_id: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
  internal_notes: string | null;
  status: "active" | "inactive";
};

export function useOlympiadQuestionUpsert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuestionUpsertInput) => {
      const { data, error } = await supabase.rpc("oly_questions_upsert", {
        p_payload: input,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: [
          "olympiad",
          "question-bank",
          vars.subject_id,
          vars.grade_level_id,
        ],
      });
      toast.success("Question saved");
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't save question.",
        context: "useOlympiadQuestionUpsert",
      }),
  });
}
