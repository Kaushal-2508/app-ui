import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import {
  generateSubjectCode,
  loadSubjectCodeContext,
  resolveClassGroupIdFromClassId,
} from "@/lib/subjectCode";
import { useUserRole } from "./useUserRole";

const normalizeSubjectName = (value: string) => value.trim().toLowerCase();

export interface CombinedSubject {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  name_hindi: string | null;
  isGlobal: boolean;
  isActive: boolean;
  institutionId: string | null;
  createdBy: string | null;
}

export interface CombinedTopic {
  id: string;
  topic_name: string;
  topic_name_hindi: string | null;
  difficulty_level: string | null;
  learning_outcomes: string | null;
  sub_topics: string[] | null;
  subject_id: string;
  grade_level_id: string;
  isGlobal: boolean;
  isActive: boolean;
  institutionId: string | null;
  createdBy: string | null;
}

// Fetch combined subjects: Global (universal_subjects) + Institute (subjects)
export function useCombinedSubjects(institutionId: string | null | undefined) {
  return useQuery({
    queryKey: ["combined-subjects", institutionId],
    queryFn: async () => {
      // Fetch global subjects
      const { data: globalSubjects, error: globalError } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category, name_hindi, is_active")
        .eq("is_active", true)
        .order("name");

      if (globalError) throw globalError;

      // Fetch institute-specific subjects
      // The `subjects` table only has: id, name, code, description,
      // is_active, institution_id, created_by, universal_subject_id.
      // There is no `category` or `name_hindi` column on this table.
      type InstituteSubjectRow = {
        id: string;
        name: string;
        code: string;
        is_active: boolean | null;
        institution_id: string;
        created_by: string | null;
      };
      let instituteSubjects: InstituteSubjectRow[] = [];
      if (institutionId) {
        const { data, error } = await supabase
          .from("subjects")
          .select("id, name, code, is_active, institution_id, created_by")
          .eq("institution_id", institutionId)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        instituteSubjects = (data ?? []) as InstituteSubjectRow[];
      }

      // Combine and mark source
      const combined: CombinedSubject[] = [
        ...(globalSubjects || []).map(s => ({
          id: s.id,
          name: s.name,
          code: s.code,
          category: s.category,
          name_hindi: s.name_hindi,
          isGlobal: true,
          isActive: s.is_active ?? true,
          institutionId: null,
          createdBy: null,
        })),
        ...instituteSubjects.map(s => ({
          id: s.id,
          name: s.name,
          code: s.code,
          category: null,
          name_hindi: null,
          isGlobal: false,
          isActive: s.is_active ?? true,
          institutionId: s.institution_id,
          createdBy: s.created_by,
        })),
      ];

      return combined;
    },
    enabled: true,
  });
}

// Fetch combined topics: Global + Institute-specific
export function useCombinedTopics(
  gradeId: string | null,
  subjectId: string | null,
  institutionId: string | null | undefined
) {
  return useQuery({
    queryKey: ["combined-topics", gradeId, subjectId, institutionId],
    queryFn: async () => {
      if (!gradeId || !subjectId) return [];

      // Build query to get both global and institute topics
      let query = supabase
        .from("syllabus_topics")
        .select(`
          id,
          topic_name,
          topic_name_hindi,
          difficulty_level,
          learning_outcomes,
          sub_topics,
          subject_id,
          grade_level_id,
          institution_id,
          created_by,
          is_active
        `)
        .eq("grade_level_id", gradeId)
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .order("display_order");

      // Filter: global OR current institution
      if (institutionId) {
        query = query.or(`institution_id.is.null,institution_id.eq.${institutionId}`);
      } else {
        // If no institution, only show global
        query = query.is("institution_id", null);
      }

      const { data, error } = await query;
      if (error) throw error;

      const topics: CombinedTopic[] = (data || []).map(t => ({
        id: t.id,
        topic_name: t.topic_name,
        topic_name_hindi: t.topic_name_hindi,
        difficulty_level: t.difficulty_level,
        learning_outcomes: typeof t.learning_outcomes === 'string' ? t.learning_outcomes : null,
        sub_topics: Array.isArray(t.sub_topics) ? t.sub_topics as string[] : null,
        subject_id: t.subject_id,
        grade_level_id: t.grade_level_id,
        isGlobal: !t.institution_id,
        isActive: t.is_active ?? true,
        institutionId: t.institution_id,
        createdBy: t.created_by,
      }));

      return topics;
    },
    enabled: !!gradeId && !!subjectId,
  });
}

// Add institute-specific subject
// Per schema: school-specific subjects go into universal_subjects with institution_id set
// AND must be mapped at the class-group level (subject_class_group_mappings) so the
// Phase 2 trigger fans it out to every section (subject_class_mappings). See §22.
export function useAddInstituteSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      category?: string;
      institutionId: string;
      /** If provided, resolves class_group_id and writes at group level. */
      classId?: string;
      /** Direct group-level write (preferred when caller already knows it). */
      classGroupId?: string;
      /** Mark the subject optional for this class group (default compulsory). */
      isOptional?: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Institution-scoped subjects must attach to a class_group (product rule:
      // no orphan subjects, and one class_group per subject — enforced by the
      // 20260501170000 triggers).
      let classGroupId: string | null = params.classGroupId ?? null;
      if (!classGroupId && params.classId) {
        classGroupId = await resolveClassGroupIdFromClassId(params.classId);
      }
      if (!classGroupId) {
        throw new Error("Pick a class before adding a subject.");
      }

      const normalizedName = normalizeSubjectName(params.name);

      // Preflight name check inside this class_group so the user gets a clean
      // message before we write anything. The DB trigger would reject this too,
      // but preflight avoids an orphaned universal_subjects row.
      const { data: existing, error: existingError } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("subject_id, universal_subjects!inner(name, is_active)")
        .eq("class_group_id", classGroupId);
      if (existingError) throw existingError;

      for (const row of (existing ?? []) as Array<{
        universal_subjects: { name: string; is_active: boolean } | null;
      }>) {
        const us = row.universal_subjects;
        if (!us || !us.is_active) continue;
        if (normalizeSubjectName(us.name) === normalizedName) {
          throw new Error("A subject with this name already exists in this class. Use a different name.");
        }
      }

      // Generate the code from name + grade_number, unique within the institution.
      const ctx = await loadSubjectCodeContext({
        institutionId: params.institutionId,
        classGroupId,
      });
      if (!ctx) {
        throw new Error("Can't read the class's grade. Ask your admin to check the class setup.");
      }
      const code = generateSubjectCode({
        name: params.name,
        gradeNumber: ctx.gradeNumber,
        gradeName: ctx.gradeName,
        existingCodes: ctx.existingCodes,
      });

      // Insert into universal_subjects with institution_id for school-specific subjects
      const { data, error } = await supabase
        .from("universal_subjects")
        .insert({
          name: params.name.trim(),
          code,
          category: params.category || null,
          institution_id: params.institutionId,
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Group-level mapping only — classGroupId is guaranteed non-null by the
      // guard above, and the single-class trigger (20260501170000) rejects
      // multi-mapping anyway. The fanout trigger materializes one
      // subject_class_mappings row per section automatically.
      const { error: groupMapError } = await supabase
        .from("subject_class_group_mappings" as never)
        .insert({
          class_group_id: classGroupId,
          subject_id: data.id,
          institution_id: params.institutionId,
          is_optional: params.isOptional ?? false,
        } as never);
      if (groupMapError) throw groupMapError;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combined-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["institution-subjects"] });
      toast.success("Subject created successfully");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't create subject.", context: "addInstituteSubject" }),
  });
}

// Add institute-specific topic
export function useAddInstituteTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      topicName: string;
      topicNameHindi?: string;
      difficultyLevel?: string;
      learningOutcomes?: string;
      subjectId: string;
      gradeId: string;
      institutionId: string | null; // null for global (super admin)
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("syllabus_topics")
        .insert({
          topic_name: params.topicName,
          topic_name_hindi: params.topicNameHindi || null,
          difficulty_level: params.difficultyLevel || null,
          learning_outcomes: params.learningOutcomes || null,
          subject_id: params.subjectId,
          grade_level_id: params.gradeId,
          institution_id: params.institutionId,
          created_by: user.id,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combined-topics"] });
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus"] });
      toast.success("Topic added successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add topic");
    },
  });
}

// Check if user can add topics (based on role and class assignment)
export function useCanAddTopics(classId?: string | null) {
  const { data: userRole } = useUserRole();

  return useQuery({
    queryKey: ["can-add-topics", classId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !userRole) return false;
      
      // Super admin and school admin can always add
      if (userRole.isSuperAdmin || userRole.isSchoolAdmin) return true;
      
      // If no class specified, check if user has any class permission
      if (!classId) {
        // Teachers and coordinators need class context
        return userRole.isTeacher || userRole.isCoordinator;
      }

      // Check specific class permission via RPC
      const { data, error } = await supabase.rpc("can_add_topics_to_class", {
        _user_id: user.id,
        _class_id: classId,
      });

      if (error) {
        console.error("Error checking topic permission:", error);
        return false;
      }

      return data === true;
    },
    enabled: !!userRole,
  });
}

// Delete/soft-delete subject (institute only)
export function useDeleteInstituteSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subjectId: string) => {
      const { error } = await supabase
        .from("subjects")
        .update({ is_active: false })
        .eq("id", subjectId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combined-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      toast.success("Subject archived");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to archive subject");
    },
  });
}

// Delete/soft-delete topic
export function useDeleteInstituteTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicId: string) => {
      const { error } = await supabase
        .from("syllabus_topics")
        .update({ is_active: false })
        .eq("id", topicId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["combined-topics"] });
      queryClient.invalidateQueries({ queryKey: ["topics"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus"] });
      toast.success("Topic archived");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to archive topic");
    },
  });
}
