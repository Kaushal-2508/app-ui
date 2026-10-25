import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export function useImpersonateSchoolAdmin() {
  return useMutation({
    mutationFn: async (
      input: { oly_school_id: string; reason: string },
    ): Promise<{ magic_link: string; target_email: string }> => {
      return invokeEdgeFunction("oly-impersonate-school-admin", input);
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't generate impersonation link.",
        context: "useImpersonateSchoolAdmin",
      }),
  });
}
