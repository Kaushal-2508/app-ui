import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type AssignTeachersInput = {
  oly_school_id: string;
  assignments: Array<{ teacher_profile_id: string; grade_level_ids: string[] }>;
};

export function useAssignOlympiadTeachers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignTeachersInput) => {
      return invokeEdgeFunction<{ ok: true; processed: number }>(
        "oly-assign-existing-teachers",
        input,
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "teachers"] });
      toast.success(
        `Updated ${data.processed} teacher${data.processed === 1 ? "" : "s"}`,
      );
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't assign teachers.",
        context: "useAssignOlympiadTeachers",
      }),
  });
}
