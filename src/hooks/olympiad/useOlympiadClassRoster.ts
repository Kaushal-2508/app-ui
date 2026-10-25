// src/hooks/olympiad/useOlympiadClassRoster.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RosterStudent = {
  id: string;
  roll_number: string;
  full_name: string;
  date_of_birth: string;
  section_label: string | null;
  subject_ids: string[];
  enrollment_channel: "parent_online" | "teacher_cash";
  enrolled_at: string;
  status: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string | null;
  admission_number: string | null;
  class_label: string;
  grade_level_id: string;
};

export type RosterFilters = {
  channel?: "parent_online" | "teacher_cash" | null;
  status?: "active" | "removed" | null;
};

export function useOlympiadClassRoster(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
  filters: RosterFilters,
) {
  return useQuery({
    queryKey: ["olympiad", "class-roster", olySchoolId, gradeLevelId, filters],
    queryFn: async (): Promise<RosterStudent[]> => {
      if (!olySchoolId || !gradeLevelId) return [];
      let query = supabase
        .from("oly_students")
        .select(
          "id, roll_number, full_name, date_of_birth, section_label, subject_ids, enrollment_channel, enrolled_at, status, parent_name, parent_phone, parent_email, admission_number, class_label, grade_level_id",
        )
        .eq("oly_school_id", olySchoolId)
        .eq("grade_level_id", gradeLevelId)
        .order("roll_number");
      if (filters.channel) query = query.eq("enrollment_channel", filters.channel);
      if (filters.status) query = query.eq("status", filters.status);
      else query = query.in("status", ["active", "removed"]);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as RosterStudent[];
    },
    enabled: !!olySchoolId && !!gradeLevelId,
    staleTime: 30_000,
  });
}

/**
 * School-wide enrolled-students roster (all grades) for the school-admin
 * Olympiad students view. School admins have `school_admin all own school` RLS
 * on oly_students, so this reads every enrolled student for the school.
 */
export function useOlympiadSchoolStudents(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "school-students", olySchoolId],
    queryFn: async (): Promise<RosterStudent[]> => {
      if (!olySchoolId) return [];
      const { data, error } = await supabase
        .from("oly_students")
        .select(
          "id, roll_number, full_name, date_of_birth, section_label, subject_ids, enrollment_channel, enrolled_at, status, parent_name, parent_phone, parent_email, admission_number, class_label, grade_level_id",
        )
        .eq("oly_school_id", olySchoolId)
        .in("status", ["active", "removed"])
        .order("class_label")
        .order("roll_number");
      if (error) throw error;
      return (data ?? []) as RosterStudent[];
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
