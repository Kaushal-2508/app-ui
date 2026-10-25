import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * oly_student_id -> oly_batch_id for the given batches (a student sits in at
 * most one batch — UNIQUE(oly_student_id)). Paginated read (§23).
 */
export function useOlympiadBatchAssignmentMap(batchIds: string[] | undefined) {
  return useQuery({
    queryKey: ["olympiad", "batch-assignment-map", batchIds],
    enabled: !!batchIds?.length,
    queryFn: async (): Promise<Record<string, string>> => {
      const PAGE = 1000;
      const out: Record<string, string> = {};
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("oly_batch_assignments")
          .select("oly_batch_id, oly_student_id")
          .in("oly_batch_id", batchIds!)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const a of data ?? []) out[a.oly_student_id] = a.oly_batch_id;
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      return out;
    },
    staleTime: 60_000,
  });
}
