import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadBatchNoPin = {
  id: string;
  oly_school_id: string;
  grade_level_id: string | null;
  batch_label: string;
  scheduled_at: string;
  pc_count: number;
  pin_expiry_minutes: number;
  pin_first_used_at: string | null;
  is_absentees: boolean;
  status: "draft" | "locked" | "in_progress" | "completed" | "cancelled";
};

export function useOlympiadBatchesNoPin(
  olySchoolId: string | undefined,
  gradeLevelId?: string,
) {
  return useQuery({
    queryKey: ["olympiad", "batches-no-pin", olySchoolId, gradeLevelId],
    queryFn: async (): Promise<OlympiadBatchNoPin[]> => {
      if (!olySchoolId) return [];
      let q = supabase
        .from("oly_batches_no_pin")
        .select(
          "id, oly_school_id, grade_level_id, batch_label, scheduled_at, pc_count, pin_expiry_minutes, pin_first_used_at, is_absentees, status",
        )
        .eq("oly_school_id", olySchoolId)
        .order("scheduled_at");
      if (gradeLevelId) q = q.eq("grade_level_id", gradeLevelId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((b) => ({
        ...b,
        status: b.status as OlympiadBatchNoPin["status"],
      }));
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
