import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export type CreateOlympiadTeacherInput = {
  oly_school_id: string;
  full_name: string;
  email: string;
  phone: string;
  grade_level_ids: string[];
};

export type CreateOlympiadTeacherResult = {
  teacher_profile_id: string;
  email: string;
  temp_password: string;
};

export function useCreateOlympiadTeacher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOlympiadTeacherInput) => {
      return invokeEdgeFunction<CreateOlympiadTeacherResult>("oly-create-teacher", input);
    },
    onSuccess: () => {
      // No toast — the caller surfaces the login credentials in a success
      // panel so the admin can hand them to the teacher directly.
      queryClient.invalidateQueries({ queryKey: ["olympiad", "teachers"] });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't create teacher.", context: "useCreateOlympiadTeacher" }),
  });
}
