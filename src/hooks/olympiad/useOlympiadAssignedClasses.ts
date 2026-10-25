// src/hooks/olympiad/useOlympiadAssignedClasses.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AssignedClass = {
  assignment_id: string;
  oly_school_id: string;
  school_short_code: string;
  institution_name: string;
  grade_level_id: string;
  grade_name: string;
  grade_number: number | null;
  campaign_id: string;
  enrolled_count: number;
};

type SchoolJoin = {
  school_short_code: string;
  institutions: { name: string } | { name: string }[] | null;
} | null;

type GradeJoin = {
  grade_name: string;
  grade_number: number | null;
  display_order: number | null;
} | null;

export function useOlympiadAssignedClasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "my-classes", user?.id],
    queryFn: async (): Promise<AssignedClass[]> => {
      if (!user?.id) return [];
      const { data: assignments, error } = await supabase
        .from("oly_teacher_class_assignments")
        .select(`
          id, oly_school_id, grade_level_id, campaign_id,
          oly_schools ( school_short_code, institutions ( name ) ),
          grade_levels ( grade_name, grade_number, display_order )
        `)
        .eq("teacher_profile_id", user.id)
        .order("assigned_at");
      if (error) throw error;

      const rows = (assignments ?? []).map((a) => {
        const school = (Array.isArray(a.oly_schools) ? a.oly_schools[0] : a.oly_schools) as SchoolJoin;
        const grade = (Array.isArray(a.grade_levels) ? a.grade_levels[0] : a.grade_levels) as GradeJoin;
        const inst = school?.institutions;
        const institutionName = (Array.isArray(inst) ? inst[0] : inst)?.name ?? "(school)";
        return {
          assignment_id: a.id,
          oly_school_id: a.oly_school_id,
          school_short_code: school?.school_short_code ?? "",
          institution_name: institutionName,
          grade_level_id: a.grade_level_id,
          grade_name: grade?.grade_name ?? "",
          grade_number: grade?.grade_number ?? null,
          campaign_id: a.campaign_id,
          enrolled_count: 0,
        };
      });

      // Roll up enrolled counts per (school, grade) — scoped to this campaign
      if (rows.length > 0) {
        const { data: students } = await supabase
          .from("oly_students")
          .select("oly_school_id, grade_level_id")
          .eq("status", "active")
          .eq("campaign_id", rows[0].campaign_id)
          .in("oly_school_id", rows.map((r) => r.oly_school_id))
          .in("grade_level_id", rows.map((r) => r.grade_level_id));
        for (const s of students ?? []) {
          const r = rows.find(
            (row) => row.oly_school_id === s.oly_school_id && row.grade_level_id === s.grade_level_id,
          );
          if (r) r.enrolled_count += 1;
        }
      }
      return rows;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
