import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { uploadResumableAndGetPublicUrl } from "@/lib/storageUpload";
import { extractGradeNumberFromClassName } from "@/lib/gradeLookup";

// Types
export interface GradeLevel {
  id: string;
  grade_number: number;
  grade_name: string;
  is_active: boolean;
  subject_count?: number;
  topic_count?: number;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  display_order: number | null;
  grade_level_id?: string | null;
  institution_id?: string | null;
  topic_count?: number;
}

export interface Topic {
  id: string;
  topic_name: string;
  topic_name_hindi: string | null;
  difficulty_level: string | null;
  display_order: number;
  is_active: boolean;
  learning_outcomes: string | null;
  sub_topics: string[] | null;
  /** NULL for globally-seeded NCERT chapters. Drives delete-vs-hide routing
   *  in SchoolSyllabusPage's handleDeleteTopic. */
  institution_id: string | null;
  material_count?: number;
}

export interface StudyMaterial {
  id: string;
  title: string;
  publisher: string | null;
  material_type: string;
  file_url: string | null;
  external_link: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

// Tree view types
export interface SyllabusTreeMaterial {
  id: string;
  title: string;
  material_type: string;
  file_url: string | null;
  external_link: string | null;
}

export interface SyllabusTreeTopic {
  id: string;
  topic_name: string;
  topic_name_hindi: string | null;
  difficulty_level: string | null;
  /** NULL means a globally-seeded NCERT chapter shared across schools.
   *  Used to hide the delete affordance for non-platform-super_admins. */
  institution_id: string | null;
  /** True when the caller's institution has hidden this global chapter
   *  via institution_hidden_topics. Always false for institution-owned
   *  rows. SyllabusTreeView uses this to skip rendering by default and
   *  to show the row with an "Unhide" affordance when the Show-hidden
   *  toggle is on. */
  hidden_in_institution: boolean;
  materials: SyllabusTreeMaterial[];
}

export interface SyllabusTreeSubject {
  id: string;
  name: string;
  code: string | null;
  category: string | null;
  institution_id?: string | null;
  topics: SyllabusTreeTopic[];
}

export interface SyllabusTreeData {
  id: string;
  grade_number: number;
  grade_name: string;
  subjects: SyllabusTreeSubject[];
}

// Fetch full syllabus tree for tree view
// Now uses grade-specific subjects (subjects.grade_level_id)
export function useFullSyllabusTree() {
  return useQuery({
    queryKey: ["full-syllabus-tree"],
    queryFn: async () => {
      // Fetch all grades
      const { data: grades, error: gradesError } = await supabase
        .from("grade_levels")
        .select("id, grade_number, grade_name")
        .eq("is_active", true)
        .order("grade_number");

      if (gradesError) throw gradesError;
      if (!grades || grades.length === 0) return [];

      // Fetch ALL subjects with their grade_level_id
      const { data: subjects, error: subjectsError } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category, grade_level_id");

      if (subjectsError) throw subjectsError;

      // Fetch all topics with pagination to avoid 1000-row limit
      let allTopics: { id: string; grade_level_id: string; subject_id: string; topic_name: string; topic_name_hindi: string | null; difficulty_level: string | null; institution_id: string | null }[] = [];
      let topicOffset = 0;
      const topicPageSize = 1000;
      let hasMoreTopics = true;

      while (hasMoreTopics) {
        const { data: topicBatch, error: topicsError } = await supabase
          .from("syllabus_topics")
          .select("id, grade_level_id, subject_id, topic_name, topic_name_hindi, difficulty_level, institution_id")
          .eq("is_active", true)
          .order("display_order")
          .range(topicOffset, topicOffset + topicPageSize - 1);

        if (topicsError) throw topicsError;
        
        if (topicBatch && topicBatch.length > 0) {
          allTopics = [...allTopics, ...topicBatch];
          topicOffset += topicPageSize;
          hasMoreTopics = topicBatch.length === topicPageSize;
        } else {
          hasMoreTopics = false;
        }
      }
      
      const topics = allTopics;

      // Fetch all materials in batches to handle large topic lists
      const topicIds = (topics || []).map(t => t.id);
      let allMaterials: { id: string; topic_id: string | null; title: string; material_type: string; file_url: string | null; external_link: string | null }[] = [];

      // Batch the topic IDs to avoid URL length limits (max ~100 IDs per batch)
      const batchSize = 100;
      for (let i = 0; i < topicIds.length; i += batchSize) {
        const batch = topicIds.slice(i, i + batchSize);
        if (batch.length > 0) {
          const { data: materialsBatch, error: materialsError } = await supabase
            .from("study_materials")
            .select("id, topic_id, title, material_type, file_url, external_link")
            .eq("is_active", true)
            .in("topic_id", batch);
          
          if (materialsError) throw materialsError;
          if (materialsBatch) {
            allMaterials = [...allMaterials, ...materialsBatch];
          }
        }
      }
      
      const materials = allMaterials;

      // Which globally-seeded topics has the caller's institution hidden? RLS
      // scopes this SELECT to the caller's own institution, so we don't need
      // to pass institution_id ourselves. Empty set on cold-start or for
      // users without an institution.
      const { data: hiddenRows } = await supabase
        .from("institution_hidden_topics")
        .select("topic_id");
      const hiddenSet = new Set((hiddenRows ?? []).map((r) => r.topic_id));

      // Build lookup maps
      // Group subjects by grade_level_id (grade-specific subjects)
      const subjectsByGrade = (subjects || []).reduce((acc, s) => {
        if (s.grade_level_id) {
          if (!acc[s.grade_level_id]) acc[s.grade_level_id] = [];
          acc[s.grade_level_id].push(s);
        }
        return acc;
      }, {} as Record<string, typeof subjects>);

      const topicsByGradeSubject = (topics || []).reduce((acc, t) => {
        const key = `${t.grade_level_id}-${t.subject_id}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {} as Record<string, typeof topics>);

      const materialsByTopic = (materials || []).reduce((acc, m) => {
        if (m.topic_id) {
          if (!acc[m.topic_id]) acc[m.topic_id] = [];
          acc[m.topic_id].push(m);
        }
        return acc;
      }, {} as Record<string, typeof materials>);

      // Build tree using grade-specific subjects
      const tree: SyllabusTreeData[] = grades.map(grade => {
        // Get subjects that belong to this specific grade
        const gradeSubjects = subjectsByGrade[grade.id] || [];
        
        const gradeSubjectsFormatted: SyllabusTreeSubject[] = gradeSubjects.map(subject => {
          const key = `${grade.id}-${subject.id}`;
          // Filter hidden globals out at source so `topics.length` reflects
          // what actually renders. Mirrors the same filter in
          // SchoolSyllabusPage's useInstitutionSyllabusTree.
          const subjectTopics = (topicsByGradeSubject[key] || []).filter(
            (t) => !hiddenSet.has(t.id)
          );

          return {
            id: subject.id,
            name: subject.name,
            code: subject.code,
            category: subject.category,
            topics: subjectTopics.map(topic => ({
              id: topic.id,
              topic_name: topic.topic_name,
              topic_name_hindi: topic.topic_name_hindi,
              difficulty_level: topic.difficulty_level,
              institution_id: topic.institution_id,
              hidden_in_institution: false, // filtered above
              materials: (materialsByTopic[topic.id] || []).map(m => ({
                id: m.id,
                title: m.title,
                material_type: m.material_type,
                file_url: m.file_url,
                external_link: m.external_link,
              })),
            })),
          };
        });

        return {
          id: grade.id,
          grade_number: grade.grade_number,
          grade_name: grade.grade_name,
          subjects: gradeSubjectsFormatted,
        };
      });

      return tree;
    },
  });
}

// Fetch all grades with counts
export function useGradesWithCounts() {
  return useQuery({
    queryKey: ["grades-with-counts"],
    queryFn: async () => {
      const { data: grades, error } = await supabase
        .from("grade_levels")
        .select("*")
        .eq("is_active", true)
        .order("grade_number");

      if (error) throw error;

      // Get topic counts per grade with pagination to avoid 1000-row limit
      let allTopicCounts: { grade_level_id: string }[] = [];
      let offset = 0;
      const pageSize = 1000;
      let hasMore = true;
      
      while (hasMore) {
        const { data: topicBatch } = await supabase
          .from("syllabus_topics")
          .select("grade_level_id")
          .eq("is_active", true)
          .range(offset, offset + pageSize - 1);
        
        if (topicBatch && topicBatch.length > 0) {
          allTopicCounts = [...allTopicCounts, ...topicBatch];
          offset += pageSize;
          hasMore = topicBatch.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      const topicCountMap = allTopicCounts.reduce((acc, t) => {
        acc[t.grade_level_id] = (acc[t.grade_level_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get subject counts per grade from universal_subjects.grade_level_id
      const { data: subjectCounts } = await supabase
        .from("universal_subjects")
        .select("grade_level_id")
        .not("grade_level_id", "is", null);

      const subjectCountMap = (subjectCounts || []).reduce((acc, s) => {
        if (s.grade_level_id) {
          acc[s.grade_level_id] = (acc[s.grade_level_id] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      return (grades || []).map((g) => ({
        ...g,
        topic_count: topicCountMap[g.id] || 0,
        subject_count: subjectCountMap[g.id] || 0,
      })) as GradeLevel[];
    },
  });
}

// Fetch subjects for a specific grade (now using grade_level_id on universal_subjects)
export function useSubjectsByGrade(gradeId: string | null) {
  return useQuery({
    queryKey: ["subjects-by-grade", gradeId],
    queryFn: async () => {
      if (!gradeId) return [];

      // Get subjects that belong to this grade directly
      const { data: subjects, error } = await supabase
        .from("universal_subjects")
        .select("*")
        .eq("grade_level_id", gradeId)
        .order("display_order");

      if (error) throw error;

      // If no subjects found, return empty array
      if (!subjects || subjects.length === 0) return [];

      // Get topic counts per subject for this grade
      const { data: topics } = await supabase
        .from("syllabus_topics")
        .select("subject_id")
        .eq("grade_level_id", gradeId)
        .eq("is_active", true);

      const topicCountMap = (topics || []).reduce((acc, t) => {
        acc[t.subject_id] = (acc[t.subject_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return (subjects || []).map((s) => ({
        ...s,
        topic_count: topicCountMap[s.id] || 0,
      })) as Subject[];
    },
    enabled: !!gradeId,
  });
}

// Assign subject to grade - supports both old (subjectId) and new (subjectName) interfaces
export function useAssignSubjectToGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { 
      gradeId: string; 
      subjectId?: string;
      subjectName?: string;
      category?: string;
    }) => {
      // If subjectId is provided (old interface), copy that subject to this grade
      if (params.subjectId) {
        // First get the source subject details
        const { data: sourceSubject } = await supabase
          .from("universal_subjects")
          .select("name, category, code")
          .eq("id", params.subjectId)
          .single();
        
        if (sourceSubject) {
          const { data, error } = await supabase
            .from("universal_subjects")
            .insert({
              name: sourceSubject.name,
              category: sourceSubject.category || 'core',
              code: sourceSubject.code,
              grade_level_id: params.gradeId,
            })
            .select()
            .single();

          if (error) throw error;
          return data;
        }
      }
      
      // New interface - create subject directly with name
      const { data, error } = await supabase
        .from("universal_subjects")
        .insert({
          name: params.subjectName!,
          category: params.category || 'core',
          grade_level_id: params.gradeId,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Subject added to grade");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the subject.", context: "assignSubjectToGrade" });
    },
  });
}

// Remove subject from grade - now deletes the subject record
export function useRemoveSubjectFromGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ subjectId }: { gradeId: string; subjectId: string }) => {
      // Delete the subject (cascades to topics due to FK)
      const { error } = await supabase
        .from("universal_subjects")
        .delete()
        .eq("id", subjectId);

      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Subject removed from grade");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't remove the subject.", context: "removeSubjectFromGrade" });
    },
  });
}

// Get available subjects - returns subjects that could be used as templates
// In the new model, this returns all unique subject names across all grades
export function useAvailableSubjectsForGrade(gradeId: string | null) {
  return useQuery({
    queryKey: ["available-subjects-for-grade", gradeId],
    queryFn: async () => {
      if (!gradeId) return [];

      // Get all existing subjects
      const { data: allSubjects, error: subjectsError } = await supabase
        .from("universal_subjects")
        .select("name, category")
        .order("name");

      if (subjectsError) throw subjectsError;

      // Get subjects already in this grade
      const { data: gradeSubjects, error: gradeError } = await supabase
        .from("universal_subjects")
        .select("name")
        .eq("grade_level_id", gradeId);

      if (gradeError) throw gradeError;

      const existingNames = new Set((gradeSubjects || []).map(s => s.name.toLowerCase()));

      // Return unique subject names not already in this grade
      const uniqueSubjects = new Map<string, { name: string; category: string | null }>();
      (allSubjects || []).forEach(s => {
        const key = s.name.toLowerCase();
        if (!existingNames.has(key) && !uniqueSubjects.has(key)) {
          uniqueSubjects.set(key, { name: s.name, category: s.category });
        }
      });

      return Array.from(uniqueSubjects.values()).map((s, i) => ({
        id: `template-${i}`, // Template IDs
        name: s.name,
        code: null,
        category: s.category,
        display_order: null,
      })) as Subject[];
    },
    enabled: !!gradeId,
  });
}

// Fetch all subjects (for when no grade is selected)
export function useAllSubjects() {
  return useQuery({
    queryKey: ["all-universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("*")
        .order("display_order");

      if (error) throw error;
      return data as Subject[];
    },
  });
}

// Fetch topics for a specific grade and subject
export function useTopicsByGradeAndSubject(gradeId: string | null, subjectId: string | null) {
  return useQuery({
    queryKey: ["topics-by-grade-subject", gradeId, subjectId],
    queryFn: async () => {
      if (!gradeId || !subjectId) return [];

      const { data: topics, error } = await supabase
        .from("syllabus_topics")
        .select("*")
        .eq("grade_level_id", gradeId)
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .order("display_order");

      if (error) throw error;

      // Get material counts per topic
      const topicIds = (topics || []).map((t) => t.id);
      if (topicIds.length === 0) return [];

      const { data: materials } = await supabase
        .from("study_materials")
        .select("topic_id")
        .in("topic_id", topicIds)
        .eq("is_active", true);

      const materialCountMap = (materials || []).reduce((acc, m) => {
        if (m.topic_id) {
          acc[m.topic_id] = (acc[m.topic_id] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);

      return (topics || []).map((t) => ({
        ...t,
        material_count: materialCountMap[t.id] || 0,
      })) as Topic[];
    },
    enabled: !!gradeId && !!subjectId,
  });
}

// Fetch materials for a specific topic
export function useMaterialsByTopic(topicId: string | null) {
  return useQuery({
    queryKey: ["materials-by-topic", topicId],
    queryFn: async () => {
      if (!topicId) return [];

      const { data, error } = await supabase
        .from("study_materials")
        .select("*")
        .eq("topic_id", topicId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as StudyMaterial[];
    },
    enabled: !!topicId,
  });
}

// Add topic mutation
// institutionId: null = global topic (Super Admin), non-null = institute-specific topic
export function useAddTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topic: {
      gradeId: string;
      subjectId: string;
      topicName: string;
      topicNameHindi?: string;
      difficultyLevel?: string;
      displayOrder?: number;
      learningOutcomes?: string;
      institutionId?: string | null; // null = global, otherwise institute-specific
    }) => {
      const { data, error } = await supabase
        .from("syllabus_topics")
        .insert({
          grade_level_id: topic.gradeId,
          subject_id: topic.subjectId,
          topic_name: topic.topicName,
          topic_name_hindi: topic.topicNameHindi || null,
          difficulty_level: topic.difficultyLevel || null,
          display_order: topic.displayOrder || 1,
          learning_outcomes: topic.learningOutcomes || null,
          institution_id: topic.institutionId || null, // Pass institution ID for scoping
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Topic added successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the topic.", context: "addTopic" });
    },
  });
}

// Delete topic mutation
//
// Delete-then-verify: PostgREST's DELETE ... RETURNING is gated by the SELECT
// policy chain, so a permitted DELETE can come back with empty data. We
// re-query the row by id and treat "row gone" as the definitive success
// signal regardless of RETURNING quirks.
export function useDeleteTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicId: string) => {
      const { error: deleteError } = await supabase
        .from("syllabus_topics")
        .delete()
        .eq("id", topicId);
      if (deleteError) throw deleteError;

      const { data: stillThere } = await supabase
        .from("syllabus_topics")
        .select("id, institution_id")
        .eq("id", topicId)
        .maybeSingle();
      if (stillThere) {
        if (stillThere.institution_id === null) {
          throw new Error(
            "You don't have permission to delete this chapter. It's shared across schools. Use 'Hide from your school' instead."
          );
        }
        throw new Error(
          "You don't have permission to delete this chapter. Ask a school admin if you think this is wrong."
        );
      }
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Topic deleted");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the topic.", context: "deleteTopic" });
    },
  });
}

// Bulk delete topics mutation — same delete-then-verify pattern as the
// single delete above, applied to a batch.
export function useBulkDeleteTopics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicIds: string[]) => {
      if (topicIds.length === 0) return { requested: 0, deleted: 0 };

      const { error: deleteError } = await supabase
        .from("syllabus_topics")
        .delete()
        .in("id", topicIds);
      if (deleteError) throw deleteError;

      const { data: stillThere } = await supabase
        .from("syllabus_topics")
        .select("id")
        .in("id", topicIds);
      const survived = stillThere?.length ?? 0;
      const deleted = topicIds.length - survived;
      if (deleted === 0) {
        throw new Error(
          "Couldn't delete those chapters. You may not have permission, or they're shared chapters."
        );
      }
      return { requested: topicIds.length, deleted };
    },
    onSuccess: ({ requested, deleted }) => {
      invalidateSyllabusCache(queryClient);
      if (deleted < requested) {
        toast.success(
          `${deleted} of ${requested} chapters deleted. ${requested - deleted} couldn't be removed.`
        );
      } else {
        toast.success(`${deleted} chapter${deleted > 1 ? "s" : ""} deleted`);
      }
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the selected topics.", context: "bulkDeleteTopics" });
    },
  });
}

// Add material to topic mutation
export function useAddMaterialToTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (material: {
      topicId: string;
      gradeId: string;
      subjectId: string;
      institutionId?: string;
      title: string;
      publisher?: string;
      materialType: string;
      fileUrl?: string;
      externalLink?: string;
      description?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("study_materials")
        .insert({
          topic_id: material.topicId,
          grade_level_id: material.gradeId,
          subject_id: material.subjectId,
          institution_id: material.institutionId || null,
          title: material.title,
          publisher: material.publisher || null,
          material_type: material.materialType,
          file_url: material.fileUrl || null,
          external_link: material.externalLink || null,
          description: material.description || null,
          is_active: true,
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Material added successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the study material.", context: "addMaterialToTopic" });
    },
  });
}

// Delete material mutation
export function useDeleteMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (materialId: string) => {
      const { error } = await supabase
        .from("study_materials")
        .delete()
        .eq("id", materialId);

      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Material deleted");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the material.", context: "deleteMaterial" });
    },
  });
}

// =============================================================
// Class-scoped chapter create — used by the teacher's lesson plan
// dialog where we have a class_id (not a grade_level_id) and the
// teacher wants to add a missing chapter on the fly.
//
// Encapsulates the school-side resolution pattern from
// AddSchoolTopicDialog: class name → /\d+/ → grade_levels lookup,
// then insert into syllabus_topics scoped to the institution.
// `useChaptersForExam` falls back to all subject chapters when no
// `topic_class_mappings` rows exist, so the new row shows up
// without a separate mapping insert.
// =============================================================
export interface AddChapterForClassInput {
  classId: string;
  subjectId: string;
  institutionId: string;
  topicName: string;
}

export function useAddChapterForClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddChapterForClassInput) => {
      const trimmedName = input.topicName.trim();
      if (!trimmedName) throw new Error("Chapter name is required.");

      const { data: classRow, error: classErr } = await supabase
        .from("classes")
        .select("name")
        .eq("id", input.classId)
        .maybeSingle();
      if (classErr) throw classErr;

      const className = (classRow as { name: string } | null)?.name ?? "";
      const gradeNumber = extractGradeNumberFromClassName(className);
      if (gradeNumber === null) {
        throw new Error("Couldn't figure out the grade from this class name.");
      }

      const { data: gradeRow } = await supabase
        .from("grade_levels")
        .select("id")
        .eq("grade_number", gradeNumber)
        .maybeSingle();
      const gradeId = (gradeRow as { id: string } | null)?.id ?? null;
      if (!gradeId) {
        throw new Error(
          `Grade ${gradeNumber} isn't set up yet. Ask your admin to add it before creating chapters.`,
        );
      }

      // Duplicate guard — global + institution-specific scope, like
      // AddSchoolTopicDialog. Case-insensitive.
      const { data: existingTopics } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name")
        .eq("grade_level_id", gradeId)
        .eq("subject_id", input.subjectId)
        .or(`institution_id.eq.${input.institutionId},institution_id.is.null`);
      const dup = (existingTopics ?? []).find(
        (t) => t.topic_name.toLowerCase() === trimmedName.toLowerCase(),
      );
      if (dup) return { id: dup.id, topicName: dup.topic_name };

      const { data: topic, error: insErr } = await supabase
        .from("syllabus_topics")
        .insert({
          grade_level_id: gradeId,
          subject_id: input.subjectId,
          topic_name: trimmedName,
          institution_id: input.institutionId,
          is_active: true,
          display_order: 1,
        })
        .select("id, topic_name")
        .single();
      if (insErr) throw insErr;
      return { id: topic.id, topicName: topic.topic_name };
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      // Also bust the chapters-for-exam query so the dropdown picks up
      // the new row immediately on next render.
      queryClient.invalidateQueries({ queryKey: ["chapters-for-exam"] });
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the chapter.", context: "addChapterForClass" });
    },
  });
}

// =============================================================
// Class-scoped study material upload — uploads the file to the
// `study-materials` storage bucket, mirrors the existing path
// scheme used by AddSchoolStudyMaterialDialog, and inserts the
// study_materials row keyed to the chosen chapter (topic_id).
// =============================================================
export interface UploadStudyMaterialForChapterInput {
  topicId: string;
  classId: string;
  subjectId: string;
  institutionId: string;
  file: File;
  /** Optional override; defaults to the file's basename. */
  title?: string;
}

const MATERIAL_TYPE_BY_EXT: Record<string, string> = {
  pdf: "pdf",
  doc: "document",
  docx: "document",
  ppt: "presentation",
  pptx: "presentation",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
};

export function useUploadStudyMaterialForChapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadStudyMaterialForChapterInput) => {
      const fileExt = input.file.name.split(".").pop()?.toLowerCase() ?? "";
      const materialType = MATERIAL_TYPE_BY_EXT[fileExt] ?? "document";
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `materials/${input.institutionId}/${fileName}`;

      // Resumable (TUS) upload — the standard POST endpoint hard-caps the
      // request body at 50 MB regardless of bucket file_size_limit, so any
      // attempt to upload a > 50 MB lesson plan or material via the regular
      // path silently fails on Supabase's hosted gateway.
      const publicUrl = await uploadResumableAndGetPublicUrl({
        bucket: "study-materials",
        path: filePath,
        file: input.file,
        contentType: input.file.type || undefined,
      });

      // Resolve grade_level_id so study_materials.grade_level_id stays
      // consistent with the chapter's grade — the syllabus tree filters
      // on this column when rendering materials per grade.
      const { data: classRow } = await supabase
        .from("classes")
        .select("name")
        .eq("id", input.classId)
        .maybeSingle();
      const className = (classRow as { name: string } | null)?.name ?? "";
      const gradeNumber = extractGradeNumberFromClassName(className);
      let gradeId: string | null = null;
      if (gradeNumber !== null) {
        const { data: gradeRow } = await supabase
          .from("grade_levels")
          .select("id")
          .eq("grade_number", gradeNumber)
          .maybeSingle();
        gradeId = (gradeRow as { id: string } | null)?.id ?? null;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const title = (input.title?.trim() || input.file.name).slice(0, 200);
      const { data, error } = await supabase
        .from("study_materials")
        .insert({
          topic_id: input.topicId,
          grade_level_id: gradeId,
          subject_id: input.subjectId,
          institution_id: input.institutionId,
          title,
          material_type: materialType,
          file_url: publicUrl,
          is_active: true,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't upload the material.", context: "uploadStudyMaterialForChapter" });
    },
  });
}

// Delete subject mutation (deletes the grade-specific subject)
export function useDeleteSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subjectId: string) => {
      const { error } = await supabase
        .from("universal_subjects")
        .delete()
        .eq("id", subjectId);

      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Subject deleted");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the subject.", context: "deleteSubject" });
    },
  });
}
