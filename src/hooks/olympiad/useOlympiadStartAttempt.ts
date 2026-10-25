import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

export type StartAttemptResult = { ok: true; attempt_id: string; resumed: boolean };

export function useOlympiadStartAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<StartAttemptResult> => {
      const { data, error } = await supabase.rpc("oly_start_attempt");
      if (error) throw error;
      return data as StartAttemptResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "student-dashboard"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't start exam. Please contact your school.", context: "useOlympiadStartAttempt" }),
  });
}
