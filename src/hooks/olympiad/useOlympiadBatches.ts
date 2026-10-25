import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadBatch = {
  id: string;
  campaign_id: string;
  oly_school_id: string;
  grade_level_id: string | null;
  batch_label: string;
  scheduled_at: string;
  pc_count: number;
  pin: string | null;
  pin_expiry_minutes: number;
  pin_first_used_at: string | null;
  is_absentees: boolean;
  status: "draft" | "locked" | "in_progress" | "completed" | "cancelled";
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  enrolled_count?: number;
};

export function useOlympiadBatches(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "batches", olySchoolId],
    queryFn: async (): Promise<OlympiadBatch[]> => {
      if (!olySchoolId) return [];
      const { data: batches, error } = await supabase
        .from("oly_batches")
        .select(
          "id, campaign_id, oly_school_id, grade_level_id, batch_label, scheduled_at, pc_count, pin, pin_expiry_minutes, pin_first_used_at, is_absentees, status, locked_at, created_at, updated_at",
        )
        .eq("oly_school_id", olySchoolId)
        .order("scheduled_at");
      if (error) throw error;

      // Roll up assignment counts
      // NOTE: PostgREST silently caps reads at 1000 rows (§23.1). For schools with
      // >1000 student-batch assignments, enrolled_count will under-count. Acceptable
      // at Phase 3b scale; promote to a server-side RPC if a school crosses ~500 enrollments.
      const ids = (batches ?? []).map((b) => b.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: assignments } = await supabase
          .from("oly_batch_assignments")
          .select("oly_batch_id")
          .in("oly_batch_id", ids);
        for (const a of assignments ?? []) {
          counts[a.oly_batch_id] = (counts[a.oly_batch_id] ?? 0) + 1;
        }
      }

      return (batches ?? []).map((b) => ({
        ...b,
        status: b.status as OlympiadBatch["status"],
        enrolled_count: counts[b.id] ?? 0,
      }));
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
