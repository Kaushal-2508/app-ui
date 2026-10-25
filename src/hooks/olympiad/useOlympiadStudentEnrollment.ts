import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type OlympiadStudentEnrollment = {
  id: string;
  oly_school_id: string;
  roll_number: string;
  full_name: string;
  is_olympiad_only: boolean;
};

export function useOlympiadStudentEnrollment() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "my-enrollment", user?.id],
    queryFn: async (): Promise<OlympiadStudentEnrollment | null> => {
      if (!user?.id) return null;
      // §23.1: explicit columns. RLS lets the student see their own row.
      const { data, error } = await supabase
        .from("oly_students")
        .select("id, oly_school_id, roll_number, full_name, profile_id, auth_user_id")
        .or(`auth_user_id.eq.${user.id},profile_id.eq.${user.id}`)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        oly_school_id: data.oly_school_id,
        roll_number: data.roll_number,
        full_name: data.full_name,
        is_olympiad_only: data.profile_id == null,
      };
    },
    enabled: !!user?.id,
    // §23.2: aggressive caching — sidebar reads this on every page
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
