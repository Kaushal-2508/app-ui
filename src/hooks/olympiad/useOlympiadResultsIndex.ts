import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StudentResultStatus = "appeared" | "absent";

/**
 * Per-student published-result status for the school (appeared vs absent),
 * keyed by oly_student_id. Empty object until results are published — the
 * Students page only shows its Appeared/Absent filter once this has entries.
 * Paginated read (PostgREST caps at 1000 rows, §23).
 */
export function useOlympiadResultsIndex(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "results-index", olySchoolId],
    enabled: !!olySchoolId,
    queryFn: async (): Promise<Record<string, StudentResultStatus>> => {
      const PAGE = 1000;
      const out: Record<string, StudentResultStatus> = {};
      let from = 0;
      for (;;) {
        const { data, error } = await supabase
          .from("oly_results")
          .select("oly_student_id, certificate_tier")
          .eq("oly_school_id", olySchoolId as string)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of data ?? []) {
          out[r.oly_student_id] = r.certificate_tier === "absent" ? "absent" : "appeared";
        }
        if ((data ?? []).length < PAGE) break;
        from += PAGE;
      }
      return out;
    },
    staleTime: 60_000,
  });
}
