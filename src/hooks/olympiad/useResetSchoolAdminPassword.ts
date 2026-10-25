import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export interface SchoolAdminCredentials {
  admin_email: string;
  temp_password: string;
  institute_code: string;
  login_url: string;
}

export function useResetSchoolAdminPassword() {
  return useMutation({
    mutationFn: async (input: { oly_school_id: string }): Promise<SchoolAdminCredentials> => {
      return invokeEdgeFunction<SchoolAdminCredentials>("oly-school-admin-credentials", input);
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't generate login credentials.",
        context: "resetSchoolAdminPassword",
      }),
  });
}
