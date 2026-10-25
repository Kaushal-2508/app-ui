// src/hooks/olympiad/useOlympiadSalciRoster.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SalciRosterStudent = {
  profile_id: string;
  full_name: string;
  admission_number: string | null;
  section_label: string | null;
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  already_enrolled: boolean;
  enrolled_roll_number: string | null;
};

// Existing-SALCI-school students for a grade, for the cash-enroll student picker.
export function useOlympiadSalciRoster(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["olympiad", "salci-roster", olySchoolId, gradeLevelId],
    queryFn: async (): Promise<SalciRosterStudent[]> => {
      if (!olySchoolId || !gradeLevelId) return [];
      const { data, error } = await supabase.rpc("oly_list_salci_roster_for_grade", {
        p_oly_school_id: olySchoolId,
        p_grade_level_id: gradeLevelId,
      });
      if (error) throw error;
      return (data ?? []) as SalciRosterStudent[];
    },
    enabled: enabled && !!olySchoolId && !!gradeLevelId,
    staleTime: 60_000,
  });
}
