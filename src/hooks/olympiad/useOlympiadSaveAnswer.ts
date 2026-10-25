import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaveAnswerInput = {
  attempt_id: string;
  snapshot_id: string;
  selected: "A" | "B" | "C" | "D" | null;
  marked: boolean;
  time_spent: number;
};

export function useOlympiadSaveAnswer() {
  return useMutation({
    mutationFn: async (input: SaveAnswerInput) => {
      const { data, error } = await supabase.rpc("oly_save_answer", {
        p_attempt_id: input.attempt_id,
        p_snapshot_id: input.snapshot_id,
        p_selected: input.selected,
        p_marked: input.marked,
        p_time_spent: input.time_spent,
      });
      if (error) throw error;
      return data;
    },
    // No onError toast — failures are common (network blips) and the parent
    // component handles retry with exponential backoff. Idempotent on retry.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });
}
