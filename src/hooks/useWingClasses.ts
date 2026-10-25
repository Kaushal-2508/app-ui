import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** PostgREST typegen widens a to-one embed to `T | T[]`; narrow before reading. */
function pickOne<T>(embedded: unknown): T | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  return (row as T | null | undefined) ?? null;
}

type EmbeddedClass = { id: string; name: string; section: string | null; academic_year: string };
type EmbeddedWing = { id: string; name: string };
import { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { sortClassRows } from "@/lib/classSort";

export type WingClassMapping = Tables<"wing_class_mappings">;

export interface WingClassMappingWithDetails extends WingClassMapping {
  class_name?: string;
  class_section?: string;
}

export function useWingClasses(wingId: string | null) {
  return useQuery({
    queryKey: ["wing-classes", wingId],
    queryFn: async (): Promise<WingClassMappingWithDetails[]> => {
      if (!wingId) return [];

      const { data, error } = await supabase
        .from("wing_class_mappings")
        .select(`
          *,
          classes:class_id (id, name, section, academic_year)
        `)
        .eq("wing_id", wingId);

      if (error) throw error;

      return (data || []).map((item) => {
        const cls = pickOne<EmbeddedClass>(item.classes);
        return {
          ...item,
          class_name: cls?.name,
          class_section: cls?.section,
        };
      });
    },
    enabled: !!wingId,
  });
}

export function useAssignClassToWing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wingId, classId }: { wingId: string; classId: string }) => {
      const { data, error } = await supabase
        .from("wing_class_mappings")
        .insert({ wing_id: wingId, class_id: classId })
        .select()
        .single();

      if (error) throw error;

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["wing-classes", variables.wingId] });
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast.success("Class assigned to wing successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("This class is already assigned to this wing");
      } else {
        toast.error("Failed to assign class: " + error.message);
      }
    },
  });
}

export function useBulkAssignClassesToWing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wingId, classIds }: { wingId: string; classIds: string[] }) => {
      // Upsert: insert new classes, ignore duplicates
      if (classIds.length > 0) {
        // Use upsert with onConflict to prevent duplicates
        const { error } = await supabase
          .from("wing_class_mappings")
          .upsert(
            classIds.map(classId => ({ wing_id: wingId, class_id: classId })),
            { onConflict: "wing_id,class_id", ignoreDuplicates: true }
          );

        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["wing-classes", variables.wingId] });
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast.success("Classes assigned to wing successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to assign classes: " + error.message);
    },
  });
}

export function useRemoveClassFromWing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wingId, classId }: { wingId: string; classId: string }) => {
      const { error } = await supabase
        .from("wing_class_mappings")
        .delete()
        .eq("wing_id", wingId)
        .eq("class_id", classId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["wing-classes", variables.wingId] });
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast.success("Class removed from wing");
    },
    onError: (error: Error) => {
      toast.error("Failed to remove class: " + error.message);
    },
  });
}

// Get all classes not assigned to any wing (for selection)
export function useUnassignedClasses(institutionId: string | null) {
  return useQuery({
    queryKey: ["unassigned-classes", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      // Get all classes in institution
      const { data: allClasses, error: classesError } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (classesError) throw classesError;

      // Get all assigned class IDs
      const { data: assigned, error: assignedError } = await supabase
        .from("wing_class_mappings")
        .select("class_id");

      if (assignedError) throw assignedError;

      const assignedIds = new Set(assigned?.map(a => a.class_id) || []);

      // Return only unassigned classes
      const unassigned = (allClasses || []).filter(c => !assignedIds.has(c.id));
      return sortClassRows(unassigned, (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });
}

// Get all classes in institution (for wing assignment)
export function useInstitutionClasses(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-classes", institutionId],
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

// Get classes accessible to a user based on their wing assignments
export function useUserWingClasses(userId: string | null) {
  return useQuery({
    queryKey: ["user-wing-classes", userId],
    queryFn: async () => {
      if (!userId) return { wingIds: [], classIds: [], wings: [] };

      // Get user's wing assignments
      const { data: wingAssignments, error: wingError } = await supabase
        .from("wing_assignments")
        .select(`
          wing_id,
          wings:wing_id (id, name, description)
        `)
        .eq("user_id", userId);

      if (wingError) throw wingError;

      const wingIds = wingAssignments?.map((a) => a.wing_id) || [];
      const wings = (wingAssignments ?? [])
        .map((a) => pickOne<EmbeddedWing>(a.wings))
        .filter((w): w is EmbeddedWing => w !== null);

      if (wingIds.length === 0) {
        return { wingIds: [], classIds: [], wings: [] };
      }

      // Get classes from wing_class_mappings
      const { data: classMappings, error: classError } = await supabase
        .from("wing_class_mappings")
        .select("class_id")
        .in("wing_id", wingIds);

      if (classError) throw classError;

      const classIds = [...new Set(classMappings?.map((c) => c.class_id) || [])];

      return { wingIds, classIds, wings };
    },
    enabled: !!userId,
  });
}

// Get user's wing assignments (for displaying in tables)
export function useUserWings(userId: string | null) {
  return useQuery({
    queryKey: ["user-wings-list", userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from("wing_assignments")
        .select(`
          wing_id,
          wings:wing_id (id, name)
        `)
        .eq("user_id", userId);

      if (error) throw error;
      return (data ?? [])
        .map((a) => pickOne<EmbeddedWing>(a.wings))
        .filter((w): w is EmbeddedWing => w !== null);
    },
    enabled: !!userId,
  });
}
