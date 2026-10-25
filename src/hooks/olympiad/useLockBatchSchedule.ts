import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

/** One batch to persist. `grade_level_id` is null for a mixed (multi-class) batch. */
export type LockBatch = {
  scheduled_at: string;
  grade_level_id: string | null;
  student_ids: string[];
  pc_count: number;
  batch_label: string;
  pin_expiry_minutes?: number;
  is_absentees?: boolean;
};

export function useLockBatchSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      oly_school_id,
      batches,
    }: {
      oly_school_id: string;
      batches: LockBatch[];
    }) => {
      return invokeEdgeFunction<{ batch_ids: string[] }>("oly-lock-batch-schedule", {
        oly_school_id,
        batches,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(`Locked ${data.batch_ids.length} batches with PINs generated`);
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't lock schedule.",
        context: "useLockBatchSchedule",
      }),
  });
}
