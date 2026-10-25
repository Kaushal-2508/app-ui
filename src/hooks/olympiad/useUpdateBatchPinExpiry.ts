import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useUpdateBatchPinExpiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, minutes }: { batchId: string; minutes: number }) => {
      const { error } = await supabase
        .from("oly_batches")
        .update({ pin_expiry_minutes: minutes })
        .eq("id", batchId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "batches"] });
      toast.success("PIN expiry updated");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update PIN expiry.", context: "useUpdateBatchPinExpiry" }),
  });
}
