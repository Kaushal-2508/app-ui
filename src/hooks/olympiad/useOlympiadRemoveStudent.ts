// src/hooks/olympiad/useOlympiadRemoveStudent.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function useOlympiadRemoveStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_student_id, reason }: { oly_student_id: string; reason: string }) => {
      return invokeEdgeFunction<{ ok: true; enrollment_channel: "parent_online" | "teacher_cash" }>(
        "oly-student-remove",
        { oly_student_id, reason },
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "my-classes"] });
      if (data.enrollment_channel === "parent_online") {
        toast.success("Student removed. Refund initiated via gateway.");
      } else {
        toast.success("Student removed. Please return cash to the parent.");
      }
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't remove student.", context: "useOlympiadRemoveStudent" }),
  });
}
