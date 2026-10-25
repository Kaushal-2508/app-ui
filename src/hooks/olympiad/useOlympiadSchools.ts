// src/hooks/olympiad/useOlympiadSchools.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadSchoolRow = {
  id: string;
  campaign_id: string;
  institution_id: string;
  institution_name: string;
  school_short_code: string;
  city: string | null;
  state: string | null;
  status: "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";
  is_existing_salci_school: boolean;
  enrolled_count: number;
  created_at: string;
};

export function useOlympiadSchools(campaignId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "schools", campaignId],
    queryFn: async (): Promise<OlympiadSchoolRow[]> => {
      if (!campaignId) return [];
      const { data: schools, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, institution_id, school_short_code, city, state, status, is_existing_salci_school, created_at, institutions(name)")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const ids = (schools ?? []).map((s) => s.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: students } = await supabase
          .from("oly_students")
          .select("oly_school_id")
          .in("oly_school_id", ids)
          .eq("status", "active");
        for (const s of students ?? []) {
          counts[s.oly_school_id] = (counts[s.oly_school_id] ?? 0) + 1;
        }
      }

      return (schools ?? []).map((s) => {
        const inst = Array.isArray(s.institutions) ? s.institutions[0] : s.institutions;
        return {
          id: s.id,
          campaign_id: s.campaign_id,
          institution_id: s.institution_id,
          institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
          school_short_code: s.school_short_code,
          city: s.city,
          state: s.state,
          status: s.status as OlympiadSchoolRow["status"],
          is_existing_salci_school: s.is_existing_salci_school,
          enrolled_count: counts[s.id] ?? 0,
          created_at: s.created_at,
        };
      });
    },
    enabled: !!campaignId,
    staleTime: 30_000,
  });
}
