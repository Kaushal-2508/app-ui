import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sortClassRows } from "@/lib/classSort";
import { getDisplayName } from "@/lib/displayName";

export type ViewPerspective = "school_admin" | "teacher" | "student";

interface OmnivisibilityState {
  institutionId: string | null;
  perspective: ViewPerspective;
  selectedUserId: string | null;
  selectedClassId: string | null;
}

export function useOmnivisibility() {
  const [state, setState] = useState<OmnivisibilityState>({
    institutionId: null,
    perspective: "school_admin",
    selectedUserId: null,
    selectedClassId: null,
  });

  // Fetch all institutions for selector
  const { data: institutions, isLoading: institutionsLoading } = useQuery({
    queryKey: ["omnivisibility-institutions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("institutions")
        .select("id, name, code, is_active")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch teachers for selected institution
  const { data: teachers, isLoading: teachersLoading } = useQuery({
    queryKey: ["omnivisibility-teachers", state.institutionId],
    queryFn: async () => {
      if (!state.institutionId) return [];
      const { data } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          profiles!user_roles_user_id_fkey(id, full_name, email)
        `)
        .eq("institution_id", state.institutionId)
        .eq("role", "teacher");
      
      return (data || []).map(d => ({
        id: (d.profiles as any)?.id,
        name: getDisplayName(d.profiles),
        email: (d.profiles as any)?.email || "",
      }));
    },
    enabled: !!state.institutionId && state.perspective === "teacher",
  });

  // Fetch students for selected institution
  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ["omnivisibility-students", state.institutionId, state.selectedClassId],
    queryFn: async () => {
      if (!state.institutionId) return [];
      
      let query = supabase
        .from("class_assignments")
        .select(`
          user_id,
          class_id,
          profiles!class_assignments_user_id_fkey(id, full_name, email),
          classes!class_assignments_class_id_fkey(id, name)
        `)
        .eq("role", "student");

      if (state.selectedClassId) {
        query = query.eq("class_id", state.selectedClassId);
      }

      const { data } = await query;
      
      return (data || []).map(d => ({
        id: (d.profiles as any)?.id,
        name: getDisplayName(d.profiles),
        email: (d.profiles as any)?.email || "",
        className: (d.classes as any)?.name || "",
      }));
    },
    enabled: !!state.institutionId && state.perspective === "student",
  });

  // Fetch classes for selected institution
  const { data: classes, isLoading: classesLoading } = useQuery({
    queryKey: ["omnivisibility-classes", state.institutionId],
    queryFn: async () => {
      if (!state.institutionId) return [];
      const { data } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", state.institutionId)
        .eq("is_active", true)
        .order("name");
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!state.institutionId,
  });

  const setInstitution = useCallback((institutionId: string | null) => {
    setState(prev => ({
      ...prev,
      institutionId,
      selectedUserId: null,
      selectedClassId: null,
    }));
  }, []);

  const setPerspective = useCallback((perspective: ViewPerspective) => {
    setState(prev => ({
      ...prev,
      perspective,
      selectedUserId: null,
    }));
  }, []);

  const setSelectedUser = useCallback((userId: string | null) => {
    setState(prev => ({ ...prev, selectedUserId: userId }));
  }, []);

  const setSelectedClass = useCallback((classId: string | null) => {
    setState(prev => ({ ...prev, selectedClassId: classId }));
  }, []);

  const reset = useCallback(() => {
    setState({
      institutionId: null,
      perspective: "school_admin",
      selectedUserId: null,
      selectedClassId: null,
    });
  }, []);

  return {
    ...state,
    institutions,
    teachers,
    students,
    classes,
    isLoading: institutionsLoading || teachersLoading || studentsLoading || classesLoading,
    setInstitution,
    setPerspective,
    setSelectedUser,
    setSelectedClass,
    reset,
    // Helper to get currently selected institution name
    currentInstitutionName: institutions?.find(i => i.id === state.institutionId)?.name || null,
    // Helper to get currently selected user name
    currentUserName: state.perspective === "teacher"
      ? teachers?.find(t => t.id === state.selectedUserId)?.name
      : students?.find(s => s.id === state.selectedUserId)?.name,
  };
}

// Hook for fetching data as a specific user (for omnivisibility views)
export function useAsUser<T>(
  userId: string | null,
  queryKey: string[],
  queryFn: (userId: string) => Promise<T>,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: [...queryKey, userId],
    queryFn: () => queryFn(userId!),
    enabled: !!userId && enabled,
  });
}