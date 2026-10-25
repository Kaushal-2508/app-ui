import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type RefundInput = {
  scope: "per_student" | "school_wide";
  oly_student_id?: string;
  oly_school_id?: string;
  reason: string;
};

export function useOlympiadRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefundInput) => {
      return invokeEdgeFunction<{ ok: true; processed: number }>("oly-refund-issue", input);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(`Refund processed for ${data.processed} student${data.processed === 1 ? "" : "s"}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't issue refund.", context: "useOlympiadRefund" }),
  });
}
