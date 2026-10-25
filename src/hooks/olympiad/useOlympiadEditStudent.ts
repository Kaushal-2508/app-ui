// src/hooks/olympiad/useOlympiadEditStudent.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type EditStudentInput = {
  oly_student_id: string;
  updates: Partial<{
    full_name: string;
    section_label: string | null;
    parent_name: string;
    parent_phone: string;
    parent_email: string | null;
  }>;
};

export function useOlympiadEditStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditStudentInput) => {
      return invokeEdgeFunction<{ ok: true }>("oly-student-edit", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      toast.success("Student updated");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update student.", context: "useOlympiadEditStudent" }),
  });
}
