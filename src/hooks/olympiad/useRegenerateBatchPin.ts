import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useRegenerateBatchPin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId }: { batchId: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("oly_regenerate_batch_pin", { p_batch_id: batchId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newPin) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "batches"] });
      toast.success(`New PIN: ${newPin}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't regenerate PIN.", context: "useRegenerateBatchPin" }),
  });
}
