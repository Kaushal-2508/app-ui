// src/hooks/useStudentPersonalDetails.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type StudentPersonalDetails = {
  date_of_birth: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
};

// The signed-in student's stored DOB + guardian contact (read-only, school-managed).
export function useStudentPersonalDetails() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-personal-details", user?.id],
    queryFn: async (): Promise<StudentPersonalDetails | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("student_personal_details")
        .select("date_of_birth, guardian_name, guardian_phone, guardian_email")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
