// src/hooks/olympiad/useOlympiadSchool.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Metadata only. Student/payment counts come from oly_school_overview
// (server-aggregated) — never client-counted here, which would silently cap at
// PostgREST's 1000-row limit and contradict the overview tiles.
export type SchoolDetail = {
  id: string;
  campaign_id: string;
  school_short_code: string;
  institution_id: string | null;
  institution_name: string;
  city: string | null;
  state: string | null;
  status: string;
  is_existing_salci_school: boolean;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  created_at: string;
};

export function useOlympiadSchool(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school", olySchoolId],
    queryFn: async (): Promise<SchoolDetail | null> => {
      if (!olySchoolId) return null;
      const { data: school, error } = await supabase
        .from("oly_schools")
        .select("id, campaign_id, school_short_code, institution_id, city, state, status, is_existing_salci_school, primary_contact_name, primary_contact_email, primary_contact_phone, created_at, institutions(name)")
        .eq("id", olySchoolId)
        .single();
      if (error) throw error;
      if (!school) return null;

      const inst = Array.isArray(school.institutions) ? school.institutions[0] : school.institutions;
      return {
        id: school.id,
        campaign_id: school.campaign_id,
        school_short_code: school.school_short_code,
        institution_id: school.institution_id ?? null,
        institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
        city: school.city,
        state: school.state,
        status: school.status,
        is_existing_salci_school: school.is_existing_salci_school,
        primary_contact_name: school.primary_contact_name,
        primary_contact_email: school.primary_contact_email,
        primary_contact_phone: school.primary_contact_phone,
        created_at: school.created_at,
      };
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
