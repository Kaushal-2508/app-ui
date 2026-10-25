import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import type { ExamFormData, ExamTemplate, TemplateBlueprint } from "@/types/exam";

type ExamTemplateInsert = Database["public"]["Tables"]["exam_templates"]["Insert"];

interface TemplateRow {
  id: string;
  institution_id: string;
  name: string;
  description: string | null;
  subject_id: string | null;
  template_data: unknown;
  created_by: string;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: TemplateRow): ExamTemplate {
  return {
    id: row.id,
    institutionId: row.institution_id,
    name: row.name,
    description: row.description,
    subjectId: row.subject_id,
    templateData: row.template_data as ExamTemplate["templateData"],
    createdBy: row.created_by,
    isShared: row.is_shared,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List exam templates visible to the current user (their own + shared within institution).
 */
export function useExamTemplates() {
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: queryKeys.examTemplates(institutionId || undefined),
    enabled: !!institutionId,
    queryFn: async (): Promise<ExamTemplate[]> => {
      const { data, error } = await supabase
        .from("exam_templates")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return ((data as unknown as TemplateRow[]) || []).map(mapRow);
    },
  });
}

/**
 * Create a template snapshot from the current form state.
 */
export function useSaveExamTemplate() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { institutionId } = useEffectiveInstitution();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      formData,
      isShared,
    }: {
      name: string;
      description?: string;
      formData: ExamFormData;
      isShared?: boolean;
    }): Promise<ExamTemplate> => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");
      if (!institutionId) throw new Error("No institution context");

      // Save only the structural blueprint — no questions, no context (class/subject/institution)
      const blueprint: TemplateBlueprint = {
        examMode: formData.metadata.examMode,
        sections: formData.sections.map((s) => ({
          title: s.title,
          sectionType: s.sectionType,
          allowedQuestionTypes: s.allowedQuestionTypes || [],
          questionTypeCounts: s.questionTypeCounts || {},
          questionTypeMarks: s.questionTypeMarks || {},
          defaultMarks: s.defaultMarks,
          negativeMarking: s.negativeMarking || 0,
          instructions: s.instructions || undefined,
        })),
      };

      const templateInsert: ExamTemplateInsert = {
        institution_id: institutionId,
        name,
        description: description || null,
        subject_id: null,
        template_data: blueprint as unknown as Json,
        created_by: user.user.id,
        is_shared: isShared ?? false,
      };

      const { data, error } = await supabase
        .from("exam_templates")
        .insert(templateInsert)
        .select("*")
        .single();

      if (error) throw error;
      return mapRow(data as unknown as TemplateRow);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates"] });
      toast({ title: "Template saved", description: "You can reuse it in a new exam." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeleteExamTemplate() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from("exam_templates")
        .delete()
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
    },
  });
}
