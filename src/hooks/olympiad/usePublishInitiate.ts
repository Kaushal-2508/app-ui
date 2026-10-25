import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type PublishInitiateArgs = {
  oly_school_id: string;
  /** Scope: omit both for the final whole-school publish. */
  grade_level_ids?: string[];
  batch_ids?: string[];
};

export function usePublishInitiate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id, grade_level_ids, batch_ids }: PublishInitiateArgs) => {
      const { data, error } = await supabase.rpc("oly_publish_initiate", {
        p_oly_school_id: oly_school_id,
        ...(grade_level_ids?.length ? { p_grade_level_ids: grade_level_ids } : {}),
        ...(batch_ids?.length ? { p_batch_ids: batch_ids } : {}),
      });
      if (error) throw error;
      const result = data as { ok: true; job_id: string; total_students: number; scoped: boolean };
      // Fire-and-forget the orchestrator — client polls for status via useOlympiadPublishJob
      invokeEdgeFunction<{ ok: true }>("oly-publish-school-results", {
        job_id: result.job_id,
        oly_school_id,
      }).catch(() => {
        /* server keeps running; client polls for status */
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success(
        result.scoped
          ? "Publish initiated for the selected scope. Later publishes will merge automatically."
          : "Publish initiated. Results will be available shortly.",
      );
    },
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't initiate publish.",
        context: "usePublishInitiate",
      }),
  });
}
