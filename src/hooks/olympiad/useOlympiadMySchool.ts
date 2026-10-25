import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

export type MyOlympiadSchool = {
  id: string;
  campaign_id: string;
  school_short_code: string;
  status: "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";
  is_existing_salci_school: boolean;
  participating_grade_level_ids: string[];
  institution_name: string;
  enrollment_closes_at: string | null;
  pc_count: number | null;
  /** Per-lab PC breakdown; pc_count is the authoritative total. */
  lab_pc_counts: number[] | null;
};

export function useOlympiadMySchool() {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["olympiad", "my-school", institutionId],
    queryFn: async (): Promise<MyOlympiadSchool | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, school_short_code, status, is_existing_salci_school, participating_grade_level_ids, enrollment_closes_at, pc_count, lab_pc_counts, institutions(name)")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const inst = Array.isArray(data.institutions) ? data.institutions[0] : data.institutions;
      return {
        id: data.id,
        campaign_id: data.campaign_id,
        school_short_code: data.school_short_code,
        status: data.status as MyOlympiadSchool["status"],
        is_existing_salci_school: data.is_existing_salci_school,
        participating_grade_level_ids: data.participating_grade_level_ids ?? [],
        institution_name: (inst as { name?: string } | null)?.name ?? "(school)",
        enrollment_closes_at: data.enrollment_closes_at ?? null,
        pc_count: data.pc_count ?? null,
        lab_pc_counts: Array.isArray(data.lab_pc_counts)
          ? (data.lab_pc_counts as unknown[]).filter((n): n is number => typeof n === "number")
          : null,
      };
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}
