import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useCloseEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { olySchoolId: string; mode: "schedule" | "now" | "cancel"; closesAt?: string }) => {
      return invokeEdgeFunction<{ ok: true }>("oly-close-enrollment", {
        oly_school_id: input.olySchoolId,
        mode: input.mode,
        closes_at: input.closesAt,
      });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(
        vars.mode === "schedule" ? "Closing date scheduled"
        : vars.mode === "cancel" ? "Scheduled close cancelled"
        : "Enrollment closed",
      );
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update enrollment.", context: "useCloseEnrollment" }),
  });
}
