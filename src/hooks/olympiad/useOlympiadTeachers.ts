import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TeacherWithClasses = {
  teacher_profile_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  grade_level_ids: string[];
  grade_names: string[];
};

export function useOlympiadTeachers(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "teachers", olySchoolId],
    queryFn: async (): Promise<TeacherWithClasses[]> => {
      if (!olySchoolId) return [];

      const { data: rows, error } = await supabase
        .from("oly_teacher_class_assignments")
        .select(`
          teacher_profile_id, grade_level_id,
          profiles!teacher_profile_id ( id, full_name, email, phone ),
          grade_levels ( grade_name )
        `)
        .eq("oly_school_id", olySchoolId);
      if (error) throw error;

      // Group by teacher
      const byTeacher = new Map<string, TeacherWithClasses>();
      for (const r of rows ?? []) {
        const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        const grade = Array.isArray(r.grade_levels) ? r.grade_levels[0] : r.grade_levels;
        if (!prof) continue;
        let entry = byTeacher.get(r.teacher_profile_id);
        if (!entry) {
          entry = {
            teacher_profile_id: r.teacher_profile_id,
            full_name: (prof as { full_name?: string }).full_name ?? "",
            email: (prof as { email?: string | null }).email ?? null,
            phone: (prof as { phone?: string | null }).phone ?? null,
            grade_level_ids: [],
            grade_names: [],
          };
          byTeacher.set(r.teacher_profile_id, entry);
        }
        entry.grade_level_ids.push(r.grade_level_id);
        entry.grade_names.push((grade as { grade_name?: string } | null)?.grade_name ?? "?");
      }
      return Array.from(byTeacher.values());
    },
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
