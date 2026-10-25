import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { sortClassRows } from "@/lib/classSort";
import { setClassTeachers } from "@/lib/staffAssignments";

export interface ClassData {
  id: string;
  name: string;
  section: string | null;
  academic_year: string;
  institution_id: string;
  class_group_id: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
  student_count: number;
  teacher_count: number;
}

export function useClasses(institutionId: string | null) {
  return useQuery({
    queryKey: ["classes", institutionId],
    queryFn: async (): Promise<ClassData[]> => {
      if (!institutionId) return [];

      // Fetch classes (active only — archived years like 2025-26 are soft-deleted).
      const { data: classes, error } = await supabase
        .from("classes")
        .select("*")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      if (!classes || classes.length === 0) return [];

      // Re-sort client-side: Nursery → LKG → UKG → Class 1 → … → Class 12,
      // then by section. The DB `.order("name")` only gets us alphabetical.
      const orderedClasses = sortClassRows(classes, (c) => c.name, (c) => c.section);

      // Fetch counts per class using server-side aggregation to bypass row limits
      // Query student and teacher counts separately using count aggregation
      const countPromises = orderedClasses.map(async (cls) => {
        const [studentResult, teacherResult] = await Promise.all([
          supabase
            .from("class_assignments")
            .select("*", { count: "exact", head: true })
            .eq("class_id", cls.id)
            .eq("role", "student"),
          supabase
            .from("class_assignments")
            .select("*", { count: "exact", head: true })
            .eq("class_id", cls.id)
            .eq("role", "teacher"),
        ]);

        return {
          ...cls,
          student_count: studentResult.count || 0,
          teacher_count: teacherResult.count || 0,
        };
      });

      return Promise.all(countPromises);
    },
    enabled: !!institutionId,
  });
}

export function useCreateClass() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      section: string | null;
      academic_year: string;
      institution_id: string;
      is_active: boolean;
      /** class_group_id is required by the DB schema; callers must supply it. */
      class_group_id?: string;
    }) => {
      // KNOWN SCHEMA GAP: class_group_id is required by the DB but callers
      // of useCreateClass don't yet pass it (see AddClassDialog). The cast
      // preserves existing runtime behaviour until callers are updated.
      type ClassInsert = {
        name: string;
        section?: string | null;
        academic_year: string;
        institution_id: string;
        is_active?: boolean | null;
        class_group_id: string;
      };
      const { data: newClass, error } = await supabase
        .from("classes")
        .insert(data as unknown as ClassInsert)
        .select()
        .single();

      if (error) throw error;
      return newClass;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Class created successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't create the class.", context: "createClass" });
    },
  });
}

export function useUpdateClass() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      name: string;
      section: string | null;
      academic_year: string;
      is_active: boolean;
    }) => {
      const { id, ...updates } = data;
      const { data: updatedClass, error } = await supabase
        .from("classes")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return updatedClass;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Class updated successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't update the class.", context: "updateClass" });
    },
  });
}

export function useInstitutionTeachers(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-teachers", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select(`
          id,
          full_name,
          email,
          user_roles!user_roles_user_id_fkey!inner(role)
        `)
        .eq("institution_id", institutionId)
        .eq("user_roles.role", "teacher");

      if (error) throw error;
      return data || [];
    },
    enabled: !!institutionId,
  });
}

export function useClassTeachers(classId: string | null) {
  return useQuery({
    queryKey: ["class-teachers", classId],
    queryFn: async () => {
      if (!classId) return [];

      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id")
        .eq("class_id", classId)
        .eq("role", "teacher");

      if (error) throw error;
      return data?.map(a => a.user_id) || [];
    },
    enabled: !!classId,
  });
}

export function useAssignTeachers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      classId: string;
      teacherIds: string[];
      /** Unused: the RPC derives the actor from the JWT. Kept for call-site compatibility. */
      assignedBy?: string;
    }) => {
      // One transactional RPC (set_class_teachers). The previous client code
      // deleted EVERY teacher row on the class — all teachers, all subjects —
      // and re-inserted the ticked teachers as subject-less rows, so a single
      // save wiped the class's whole teacher-subject map and downgraded the
      // survivors. The RPC diffs instead: teachers who stay keep their subject
      // links untouched, only unticked teachers are removed, and the change is
      // audit-logged.
      return setClassTeachers(data.classId, data.teacherIds);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["class-teachers"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      toast.success(
        result.removed_count > 0
          ? `Teachers updated: ${result.added_count} added, ${result.removed_count} removed`
          : "Teachers assigned successfully",
      );
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't save teacher assignments.", context: "assignTeachers" });
    },
  });
}
