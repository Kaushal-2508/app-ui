import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TeacherClass {
  id: string;
  name: string;
  section: string | null;
  institution_id: string;
  academic_year: string;
}

export function useTeacherClasses(teacherId: string | null) {
  return useQuery({
    queryKey: ["teacher-classes", teacherId],
    queryFn: async (): Promise<TeacherClass[]> => {
      if (!teacherId) return [];

      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          classes!inner(
            id,
            name,
            section,
            institution_id,
            academic_year
          )
        `)
        .eq("user_id", teacherId)
        .eq("role", "teacher")
        .eq("classes.is_active", true);

      if (error) throw error;
      return (data || []).map((d) => d.classes as unknown as TeacherClass);
    },
    enabled: !!teacherId,
  });
}

// Hook to get subjects mapped to specific classes
export function useSubjectsForClasses(classIds: string[]) {
  return useQuery({
    queryKey: ["subjects-for-classes", classIds],
    queryFn: async () => {
      if (classIds.length === 0) return [];

      const { data, error } = await supabase
        .from("subject_class_mappings")
        .select(`
          id,
          class_id,
          subject_id,
          subjects(id, name)
        `)
        .in("class_id", classIds);

      if (error) throw error;

      // Get unique subjects
      const subjectsMap = new Map<string, { id: string; name: string }>();
      data?.forEach((mapping: any) => {
        if (mapping.subjects) {
          subjectsMap.set(mapping.subjects.id, mapping.subjects);
        }
      });

      return Array.from(subjectsMap.values());
    },
    enabled: classIds.length > 0,
  });
}

// Hook to get grade level from class
export function useGradeLevelFromClass(classId: string | null) {
  return useQuery({
    queryKey: ["grade-from-class", classId],
    queryFn: async () => {
      if (!classId) return null;

      // Get the class name
      const { data: cls, error: clsError } = await supabase
        .from("classes")
        .select("name")
        .eq("id", classId)
        .single();

      if (clsError || !cls) return null;

      // Try to find a matching grade level by name
      const { data: grades, error: gradeError } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number")
        .eq("is_active", true);

      if (gradeError) return null;

      // Match by partial name (e.g., "Grade 5" matches "Grade 5 - A")
      const matchedGrade = grades?.find((g) =>
        cls.name.toLowerCase().includes(g.grade_name.toLowerCase()) ||
        g.grade_name.toLowerCase().includes(cls.name.toLowerCase())
      );

      return matchedGrade || null;
    },
    enabled: !!classId,
  });
}