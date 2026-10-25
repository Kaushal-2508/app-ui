import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StageSchoolRow {
  id: string; institution_name: string; school_short_code: string;
  city: string | null; state: string | null; status: string;
  is_existing: boolean; enrolled_count: number; derived_stage: string; created_at: string;
}

type Cursor = { ts: string; id: string } | null;

const PAGE = 50;

export function useOlympiadSchoolsByStage(
  campaignId: string | undefined,
  bucket: "in_progress" | "done",
  schoolType: "all" | "new" | "existing",
) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "schools-by-stage", campaignId, bucket, schoolType],
    enabled: !!campaignId,
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<StageSchoolRow[]> => {
      const { data, error } = await supabase.rpc("oly_schools_by_stage", {
        p_campaign_id: campaignId as string,
        p_bucket: bucket,
        p_school_type: schoolType,
        p_limit: PAGE,
        p_cursor: pageParam?.ts ?? null,
        p_cursor_id: pageParam?.id ?? null,
      });
      if (error) throw error;
      return (data ?? []) as unknown as StageSchoolRow[];
    },
    getNextPageParam: (last): Cursor | undefined =>
      last.length === PAGE
        ? { ts: last[last.length - 1].created_at, id: last[last.length - 1].id }
        : undefined,
    staleTime: 30_000,
  });
}
