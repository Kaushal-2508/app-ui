import { useMutation } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export function useGenerateCredentialsPdf() {
  return useMutation({
    mutationFn: async ({
      oly_school_id,
      grade_level_id,
    }: {
      oly_school_id: string;
      grade_level_id: string;
    }): Promise<{ signed_url: string | null; student_count: number }> => {
      return invokeEdgeFunction("oly-generate-credentials-pdf", { oly_school_id, grade_level_id });
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't generate credentials PDF.", context: "useGenerateCredentialsPdf" }),
  });
}
