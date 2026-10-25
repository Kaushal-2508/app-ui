import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface TeacherClassSubject {
  classId: string;
  className: string;
  section: string | null;
  subjects: Array<{ id: string; name: string }>;
}

export interface TeacherAssignment {
  classId: string;
  className: string;
  section: string | null;
  subjectId: string | null;
  subjectName: string | null;
}

/**
 * Hook to fetch a teacher's specific class-subject assignments.
 * Returns grouped data: classes with their assigned subjects.
 * 
 * This is used to:
 * 1. Filter syllabus visibility to only assigned class-subject pairs
 * 2. Group classes in dashboards to avoid duplicate entries
 */
export function useTeacherAssignedSubjects(teacherId?: string | null) {
  const { user } = useAuth();
  const userId = teacherId ?? user?.id;

  return useQuery({
    queryKey: ["teacher-assigned-subjects", userId],
    queryFn: async (): Promise<{
      grouped: TeacherClassSubject[];
      flat: TeacherAssignment[];
      classIds: string[];
      subjectIds: string[];
    }> => {
      if (!userId) {
        return { grouped: [], flat: [], classIds: [], subjectIds: [] };
      }

      // Get teacher's class assignments with class and subject details
      const { data: assignments, error } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          classes!class_assignments_class_id_fkey(id, name, section, academic_year, is_active),
          subjects:subject_id(id, name)
        `)
        .eq("user_id", userId)
        .eq("role", "teacher");

      if (error) throw error;

      // Filter out inactive classes
      const activeAssignments = (assignments || []).filter(
        (a) => (a.classes as any)?.is_active !== false
      );

      // Build flat list of assignments
      const flat: TeacherAssignment[] = activeAssignments.map((a) => ({
        classId: a.class_id,
        className: (a.classes as any)?.name || "Unknown",
        section: (a.classes as any)?.section || null,
        subjectId: a.subject_id,
        subjectName: (a.subjects as any)?.name || null,
      }));

      // Group by class
      const classMap = new Map<string, TeacherClassSubject>();
      
      activeAssignments.forEach((a) => {
        const cls = a.classes as any;
        if (!cls) return;

        if (!classMap.has(a.class_id)) {
          classMap.set(a.class_id, {
            classId: a.class_id,
            className: cls.name || "Unknown",
            section: cls.section || null,
            subjects: [],
          });
        }

        // Add subject if it exists and not already added
        if (a.subject_id) {
          const subject = a.subjects as any;
          const existing = classMap.get(a.class_id)!;
          if (subject && !existing.subjects.find((s) => s.id === a.subject_id)) {
            existing.subjects.push({
              id: a.subject_id,
              name: subject.name || "Unknown",
            });
          }
        }
      });

      const grouped = Array.from(classMap.values());
      const classIds = [...new Set(flat.map((a) => a.classId))];
      const subjectIds = [...new Set(flat.filter((a) => a.subjectId).map((a) => a.subjectId!))] ;

      return { grouped, flat, classIds, subjectIds };
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

/**
 * Hook to check if a teacher has access to a specific class-subject combination.
 */
export function useTeacherHasSubjectAccess(
  teacherId: string | null,
  classId: string | null,
  subjectId: string | null
) {
  const { data } = useTeacherAssignedSubjects(teacherId);

  if (!data || !classId) return true; // Default to true if no data

  // Check if the teacher has this specific class-subject assignment
  return data.flat.some(
    (a) => a.classId === classId && (!subjectId || a.subjectId === subjectId)
  );
}
