import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type SubjectClassMapping = Tables<"subject_class_mappings">;

export interface SubjectClassMappingWithDetails extends SubjectClassMapping {
  class_name?: string;
  class_section?: string;
  subject_name?: string;
}

export function useSubjectClassMappings(institutionId: string | null) {
  return useQuery({
    queryKey: ["subject-class-mappings", institutionId],
    queryFn: async (): Promise<SubjectClassMappingWithDetails[]> => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("subject_class_mappings")
        .select(`
          *,
          classes:class_id (name, section),
          subjects:subject_id (name)
        `)
        .eq("institution_id", institutionId);

      if (error) throw error;

      return (data || []).map((item: any) => ({
        ...item,
        class_name: item.classes?.name,
        class_section: item.classes?.section,
        subject_name: item.subjects?.name,
      }));
    },
    enabled: !!institutionId,
  });
}

export function useSubjectsByClass(classId: string | null) {
  return useQuery({
    queryKey: ["subjects-by-class", classId],
    queryFn: async () => {
      if (!classId) return [];

      const { data, error } = await supabase
        .from("subject_class_mappings")
        .select(`
          subject_id,
          subjects:subject_id (id, name)
        `)
        .eq("class_id", classId);

      if (error) throw error;

      return (data || []).map((item: any) => item.subjects).filter(Boolean);
    },
    enabled: !!classId,
  });
}

export function useCreateSubjectClassMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      institution_id: string;
      class_id: string;
      subject_id: string;
    }) => {
      const { data: mapping, error } = await supabase
        .from("subject_class_mappings")
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return mapping;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["subjects-by-class"] });
      toast.success("Subject assigned to class successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("This subject is already assigned to this class");
      } else {
        toast.error("Failed to assign subject: " + error.message);
      }
    },
  });
}

export function useBulkCreateSubjectClassMappings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mappings: {
      institution_id: string;
      class_id: string;
      subject_id: string;
    }[]) => {
      if (mappings.length === 0) return [];

      const { data, error } = await supabase
        .from("subject_class_mappings")
        .upsert(mappings, { onConflict: "class_id,subject_id" })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["subjects-by-class"] });
      toast.success("Subjects assigned to classes successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to assign subjects: " + error.message);
    },
  });
}

export function useDeleteSubjectClassMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("subject_class_mappings")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["subjects-by-class"] });
      toast.success("Subject removed from class");
    },
    onError: (error: Error) => {
      toast.error("Failed to remove subject: " + error.message);
    },
  });
}
