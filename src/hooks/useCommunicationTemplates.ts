import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CommunicationTemplate {
  id: string;
  institution_id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const TEMPLATE_VARIABLES = [
  { key: "student_name", label: "Student Name" },
  { key: "class_name", label: "Class Name" },
  { key: "parent_name", label: "Parent Name" },
  { key: "teacher_name", label: "Teacher Name" },
  { key: "institution_name", label: "Institution Name" },
  { key: "date", label: "Date" },
  { key: "time", label: "Time" },
];

export function interpolateTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || `{{${key}}}`);
}

export function useCommunicationTemplates(institutionId: string | null) {
  const queryClient = useQueryClient();

  const templatesQuery = useQuery({
    queryKey: ["communication-templates", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("communication_templates" as any)
        .select("*")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as CommunicationTemplate[];
    },
    enabled: !!institutionId,
  });

  const createTemplate = useMutation({
    mutationFn: async (template: {
      institution_id: string;
      name: string;
      channel: string;
      subject?: string;
      body: string;
      variables?: string[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("communication_templates" as any).insert({
        ...template,
        created_by: user.id,
        variables: template.variables || [],
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["communication-templates"] });
      toast.success("Template created");
    },
    onError: (e: Error) => toast.error("Failed: " + e.message),
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; subject?: string; body?: string; channel?: string; variables?: string[]; is_active?: boolean }) => {
      const { error } = await supabase.from("communication_templates" as any).update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["communication-templates"] });
      toast.success("Template updated");
    },
    onError: (e: Error) => toast.error("Failed: " + e.message),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("communication_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["communication-templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error("Failed: " + e.message),
  });

  return {
    templates: templatesQuery.data || [],
    isLoading: templatesQuery.isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
}
