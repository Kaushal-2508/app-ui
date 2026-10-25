import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

function getAcademicYear(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export interface PacingEntry {
  topic_id: string;
  topic_name: string;
  topic_name_local: string | null;
  periods_taught: number;
  periods_missed: number;
  target_periods: number | null;
  pacing_status: "on_track" | "behind" | "ahead" | "no_target";
}

export function usePacingTracker(classId?: string | null) {
  const { institutionId } = useEffectiveInstitution();
  const academicYear = getAcademicYear();

  return useQuery({
    queryKey: ["pacing", institutionId, classId, academicYear],
    queryFn: async (): Promise<PacingEntry[]> => {
      // NOTE: get_pacing_summary is not yet in the generated types (migration
      // pending on prod). Cast through unknown to satisfy the rpc overload.
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>)("get_pacing_summary", {
        p_institution_id: institutionId!,
        p_class_id: classId!,
        p_academic_year: academicYear,
      });
      if (error) throw error;
      return (data as PacingEntry[]) || [];
    },
    enabled: !!institutionId && !!classId,
    staleTime: 60 * 1000,
  });
}
