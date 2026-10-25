import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export type ResetOlympiadTeacherPasswordInput = {
  oly_school_id: string;
  teacher_profile_id: string;
};

export type ResetOlympiadTeacherPasswordResult = {
  email: string;
  temp_password: string;
};

export function useResetOlympiadTeacherPassword() {
  return useMutation({
    mutationFn: async (input: ResetOlympiadTeacherPasswordInput) =>
      invokeEdgeFunction<ResetOlympiadTeacherPasswordResult>(
        "oly-reset-teacher-password",
        input,
      ),
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't reset the teacher's password.",
        context: "useResetOlympiadTeacherPassword",
      }),
  });
}
