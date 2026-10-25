import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

/**
 * PostgREST types a to-one embed as `T | T[]`; normalise before reading it.
 * `as any` here silently yields undefined when the embed arrives as an array.
 */
function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

type AssignedClass = {
  id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  institution_id: string | null;
};
type AssignedSubject = { id: string; name: string; code: string | null };
import { sortClassRows, compareClassNames } from "@/lib/classSort";

/**
 * Delete an exam and everything hanging off it.
 *
 * ONE statement, deliberately. Every child table cascades from `exams`
 * (verified against prod pg_constraint: exam_sections, exam_classes,
 * exam_subjects, exam_topics, evaluation_blueprints are ON DELETE CASCADE, and
 * exam_questions cascades from exam_sections), so the server does the whole
 * chain inside a single transaction.
 *
 * This used to issue those six child deletes by hand. Each supabase-js call is
 * its own HTTP request and therefore its own transaction, so for the ~11% of
 * exams sitting behind a blocking FK (ocr_uploads is RESTRICT; class_aggregates
 * and student_performance_snapshots are NO ACTION - 174 of 1,500 exams on prod)
 * the six child deletes COMMITTED and only the final statement failed. The exam
 * row survived with zero questions, sections, classes and subjects, and nothing
 * rolled back. One statement means it either all happens or none of it does.
 */
export function useDeleteExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (examId: string) => {
      const { data, error } = await supabase
        .from("exams")
        .delete()
        .eq("id", examId)
        .select("id");

      if (error) {
        // A dependent row blocks the delete. Nothing was destroyed - the whole
        // statement rolled back - so say what actually happened.
        if ((error as { code?: string }).code === "23503") {
          throw new Error(
            "This exam has scanned uploads or saved analytics attached, so it can't be deleted.",
          );
        }
        throw error;
      }

      // A DELETE blocked by RLS returns success with an empty body, which is
      // byte-identical to a real delete (§6). "Row gone" is the only signal we
      // can trust, so treat "nothing came back" as the failure it is.
      if (!data || data.length === 0) {
        throw new Error("You don't have permission to delete this exam.");
      }

      return examId;
    },
    onSuccess: () => {
      // Invalidate all exam-related queries. "coordinator-exams" matters now
      // that ExamsPage feeds coordinators from it; without it a deleted row
      // lingers on their grid.
      queryClient.invalidateQueries({ queryKey: ["teacher-my-exams"] });
      queryClient.invalidateQueries({ queryKey: ["school-exams"] });
      queryClient.invalidateQueries({ queryKey: ["coordinator-exams"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast.success("Exam deleted successfully");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete this exam.", context: "deleteExam" }),
  });
}

// Fetch institutions for super admin, or user's institution
export function useInstitutions() {
  return useQuery({
    queryKey: ["institutions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      
      if (error) throw error;
      return data;
    },
  });
}

// Fetch classes for a given institution
export function useClasses(institutionId: string | null) {
  return useQuery({
    queryKey: ["classes", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });
}

// Fetch classes user is assigned to (for teachers/coordinators)
export function useAssignedClasses() {
  return useQuery({
    queryKey: ["assigned-classes"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          role,
          classes:class_id (
            id,
            name,
            section,
            academic_year,
            institution_id
          ),
          subjects:subject_id (
            id,
            name,
            code
          )
        `)
        .eq("user_id", user.id)
        .in("role", ["teacher", "coordinator"]);
      
      if (error) throw error;
      
      // Return unique classes with their assigned subjects
      const classMap = new Map<string, {
        class: AssignedClass | null;
        subjects: AssignedSubject[];
        role: string;
      }>();

      ((data ?? []) as unknown as Array<{
        class_id: string;
        role: string;
        classes: AssignedClass | AssignedClass[] | null;
        subjects: AssignedSubject | AssignedSubject[] | null;
      }>).forEach(d => {
        const cls = pickOne(d.classes);
        if (!cls) return;
        const subject = pickOne(d.subjects);
        const existing = classMap.get(d.class_id);
        if (existing) {
          if (subject) {
            existing.subjects.push(subject);
          }
        } else {
          classMap.set(d.class_id, {
            class: cls,
            subjects: subject ? [subject] : [],
            role: d.role,
          });
        }
      });

      return Array.from(classMap.values()).sort((a, b) => {
        const byName = compareClassNames(a.class?.name, b.class?.name);
        if (byName !== 0) return byName;
        return (a.class?.section ?? "").localeCompare(b.class?.section ?? "");
      });
    },
  });
}

// Fetch subjects assigned to teacher for specific classes
export function useAssignedSubjects(classIds: string[]) {
  return useQuery({
    queryKey: ["assigned-subjects", classIds],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || classIds.length === 0) return [];

      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          subject_id,
          subjects:subject_id (
            id,
            name,
            code
          )
        `)
        .eq("user_id", user.id)
        .in("class_id", classIds)
        .not("subject_id", "is", null);
      
      if (error) throw error;
      
      // Get unique subjects
      const subjectMap = new Map<string, AssignedSubject>();
      ((data ?? []) as unknown as Array<{
        subject_id: string | null;
        subjects: AssignedSubject | AssignedSubject[] | null;
      }>).forEach(d => {
        const subject = pickOne(d.subjects);
        if (subject && d.subject_id) {
          subjectMap.set(d.subject_id, subject);
        }
      });
      
      return Array.from(subjectMap.values());
    },
    enabled: classIds.length > 0,
  });
}

// Fetch subjects for an institution
export function useSubjects(institutionId: string | null) {
  return useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category")
        .eq("is_active", true)
        .order("display_order");
      
      if (error) throw error;
      return data;
    },
  });
}

// Fetch user's institution
export function useUserInstitution() {
  return useQuery({
    queryKey: ["user-institution"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("institution_id, institutions:institution_id(id, name, code)")
        .eq("id", user.id)
        .single();
      
      if (error) throw error;
      return data;
    },
  });
}

// Fetch user roles
export function useUserRoles() {
  return useQuery({
    queryKey: ["user-roles"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", user.id);
      
      if (error) throw error;
      return data;
    },
  });
}

// Check if user is super admin
export function useIsSuperAdmin() {
  const { data: roles } = useUserRoles();
  return roles?.some(r => r.role === "super_admin") ?? false;
}
