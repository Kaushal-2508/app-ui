import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useOlympiadQuestionBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: "active" | "inactive";
    }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("oly_questions")
        .update({ status })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "question-bank"] });
      toast.success(
        `${vars.ids.length} question${vars.ids.length === 1 ? "" : "s"} updated`,
      );
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't update questions.",
        context: "useOlympiadQuestionBulkAction",
      }),
  });
}
