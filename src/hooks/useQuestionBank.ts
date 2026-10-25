import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logCreation } from "@/lib/creationLog";
import { useToast } from "@/hooks/use-toast";
import type { Database, Json } from "@/integrations/supabase/types";

type QuestionType = Database["public"]["Enums"]["question_type"];

export interface QuestionBankItem {
  id: string;
  institution_id: string | null;
  subject_id: string | null;
  topic_id: string | null;
  grade_level_id: string | null;
  question_text: string;
  question_type: QuestionType;
  options: Json | null;
  correct_answer: string | null;
  explanation: string | null;
  marks: number;
  difficulty_level: number;
  tags: string[];
  is_approved: boolean;
  created_by: string | null;
  created_at: string;
  source: string;
  /** Diagram attached to the question, if any. */
  image_url?: string | null;
  subject?: { name: string } | null;
  grade?: { grade_name: string } | null;
  topic?: { topic_name: string } | null;
  creator?: { full_name: string } | null;
}

export interface QuestionBankResult {
  data: QuestionBankItem[];
  count: number;
}

export function useQuestionBank(filters?: {
  institutionId?: string;
  subjectId?: string;
  subjectIds?: string[];
  /** Chapter reference — filters question_bank.topic_id (→ syllabus_topics). */
  topicId?: string;
  /** Fine-grained topic within chapter — filters question_bank.chapter_topic_id. */
  chapterTopicId?: string;
  /** Class-group reference — filters question_bank.class_group_id (Phase 3). */
  classGroupId?: string;
  /** Multiple class_group ids, used when the UI maps a single class label
   * (e.g. "Class 12") to several stream-specific class_groups (Commerce /
   * Science / Humanities). When non-empty, takes precedence over classGroupId. */
  classGroupIds?: string[];
  /** Multiple DB question_type values — used when the UI label collapses
   * several DB enum values into one chip (e.g. "Match Column" filters on
   * both `matching` and `match_column`). Takes precedence over questionType. */
  questionTypes?: QuestionType[];
  /** When true, narrow to long_answer parents that hold sub-questions —
   * the "Case Study" UI variant. case_study isn't a DB enum value
   * (toDbQuestionType maps it to long_answer); the marker is
   * `sub_question_count IS NOT NULL` on a parent row. */
  caseStudyOnly?: boolean;
  /** When true, exclude case-study parent rows from a long_answer query so
   * the "Long Answer" UI chip only returns plain essays, not case studies. */
  excludeCaseStudy?: boolean;
  /** Exclude child rows (comprehension/case-study sub-questions). */
  excludeSubQuestions?: boolean;
  gradeId?: string;
  questionType?: QuestionType;
  isApproved?: boolean;
  globalOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  /** Only rows this user created, generated or uploaded — the "Your
   *  Questions" tab on the Question Bank page. */
  createdBy?: string;
}, options?: {
  /** Kept out of the query key; lets a page run only its visible tab. */
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["question-bank", filters],
    // Bank contents change only when someone authors or imports a question,
    // and those paths invalidate ["question-bank"] explicitly. 60s keeps tab
    // toggles and dialog closes from re-running a 99k-row scan (CLAUDE.md §23).
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<QuestionBankResult> => {
      const page = filters?.page || 1;
      const pageSize = filters?.pageSize || 50;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("question_bank")
        .select(`
          *,
          subject:universal_subjects(name),
          grade:grade_levels(grade_name),
          topic:syllabus_topics(topic_name),
          creator:profiles!created_by(full_name)
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (filters?.globalOnly) {
        query = query.is("institution_id", null);
      } else if (filters?.institutionId) {
        query = query.eq("institution_id", filters.institutionId);
      }
      if (filters?.createdBy) {
        query = query.eq("created_by", filters.createdBy);
      }
      if (filters?.search) {
        query = query.ilike("question_text", `%${filters.search}%`);
      }
      if (filters?.subjectId) {
        query = query.eq("subject_id", filters.subjectId);
      } else if (filters?.subjectIds && filters.subjectIds.length > 0) {
        query = query.in("subject_id", filters.subjectIds);
      }
      if (filters?.topicId) {
        query = query.eq("topic_id", filters.topicId);
      }
      if (filters?.chapterTopicId) {
        query = query.eq("chapter_topic_id", filters.chapterTopicId);
      }
      if (filters?.classGroupIds && filters.classGroupIds.length > 0) {
        query = query.in("class_group_id" as never, filters.classGroupIds);
      } else if (filters?.classGroupId) {
        query = query.eq("class_group_id" as never, filters.classGroupId);
      }
      if (filters?.excludeSubQuestions) {
        query = query.is("parent_question_id", null);
      }
      if (filters?.gradeId) {
        query = query.eq("grade_level_id", filters.gradeId);
      }
      if (filters?.questionTypes && filters.questionTypes.length > 0) {
        query = query.in("question_type", filters.questionTypes);
      } else if (filters?.questionType) {
        query = query.eq("question_type", filters.questionType);
      }
      if (filters?.caseStudyOnly) {
        // Case Study is stored as long_answer parent + N short_answer
        // children; the marker is sub_question_count IS NOT NULL on the
        // parent row (parent_question_id IS NULL is enforced separately
        // via excludeSubQuestions on the call site).
        query = query
          .eq("question_type", "long_answer")
          .not("sub_question_count", "is", null);
      } else if (filters?.excludeCaseStudy) {
        query = query.is("sub_question_count", null);
      }
      if (filters?.isApproved !== undefined) {
        query = query.eq("is_approved", filters.isApproved);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return {
        data: (data || []) as unknown as QuestionBankItem[],
        count: count || 0,
      };
    },
  });
}

export interface QuestionBankStats {
  totalQuestions: number;
  distinctTypes: number;
  avgMarks: number;
}

/**
 * Bank-wide (filter-aware) KPI aggregate for the Question Bank page.
 *
 * The page previously derived "Question Types" and "Average Marks" from the
 * 50-row page slice on screen, so the tiles showed page-local values. This
 * hook calls the server-side `get_question_bank_stats` RPC (CLAUDE.md §23.1 —
 * aggregate server-side, never reduce raw rows on the client) so the tiles
 * reflect the whole pool the user can see, and respond to the same filters as
 * the list. Mirror every filter field used by `useQuestionBank` so the numbers
 * stay consistent with the list + its Total count.
 */
export function useQuestionBankStats(filters?: {
  institutionId?: string;
  globalOnly?: boolean;
  subjectId?: string;
  subjectIds?: string[];
  topicId?: string;
  classGroupIds?: string[];
  questionTypes?: QuestionType[];
  caseStudyOnly?: boolean;
  excludeCaseStudy?: boolean;
  excludeSubQuestions?: boolean;
  search?: string;
  /** Author scope, the "Your Questions" tab (migration 20261008120000). */
  createdBy?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["question-bank-stats", filters],
    // Stats are derived from the same data as the list; a short stale window
    // avoids a duplicate round trip on every keystroke/tab toggle while still
    // refreshing after mutations invalidate the key.
    staleTime: 60_000,
    enabled: filters?.enabled ?? true,
    queryFn: async (): Promise<QuestionBankStats> => {
      // get_question_bank_stats is not yet in the generated Supabase types
      // (migration 20260608130000). Cast through unknown to satisfy the rpc
      // overload — same pattern as useExamLockStatus / usePacingTracker.
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>)("get_question_bank_stats", {
        p_institution_id: filters?.institutionId ?? undefined,
        p_global_only: filters?.globalOnly ?? false,
        p_subject_id: filters?.subjectId ?? undefined,
        p_subject_ids:
          filters?.subjectIds && filters.subjectIds.length > 0
            ? filters.subjectIds
            : undefined,
        p_topic_id: filters?.topicId ?? undefined,
        p_class_group_ids:
          filters?.classGroupIds && filters.classGroupIds.length > 0
            ? filters.classGroupIds
            : undefined,
        p_question_types:
          filters?.questionTypes && filters.questionTypes.length > 0
            ? filters.questionTypes
            : undefined,
        p_case_study_only: filters?.caseStudyOnly ?? false,
        p_exclude_case_study: filters?.excludeCaseStudy ?? false,
        p_exclude_sub_questions: filters?.excludeSubQuestions ?? true,
        p_search: filters?.search ?? undefined,
        p_created_by: filters?.createdBy ?? undefined,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { total_questions: number; distinct_types: number; avg_marks: number }
        | undefined;
      return {
        totalQuestions: Number(row?.total_questions ?? 0),
        distinctTypes: Number(row?.distinct_types ?? 0),
        avgMarks: Number(row?.avg_marks ?? 0),
      };
    },
  });
}

export function useAddQuestionToBank() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (question: {
      institutionId?: string;
      subjectId?: string;
      topicId?: string;
      gradeId?: string;
      /** Phase 3: container above section. See CLAUDE.md §22. */
      classGroupId?: string;
      questionText: string;
      questionType: QuestionType;
      options?: Json;
      correctAnswer?: string;
      explanation?: string;
      marks?: number;
      difficultyLevel?: number;
      tags?: string[];
      source?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("question_bank")
        .insert({
          institution_id: question.institutionId || null,
          subject_id: question.subjectId || null,
          topic_id: question.topicId || null,
          grade_level_id: question.gradeId || null,
          class_group_id: question.classGroupId || null,
          question_text: question.questionText,
          question_type: question.questionType,
          options: question.options || null,
          correct_answer: question.correctAnswer || null,
          explanation: question.explanation || null,
          marks: question.marks || 1,
          difficulty_level: question.difficultyLevel || 3,
          tags: question.tags || [],
          created_by: user.id,
          is_approved: true,
          source: question.source || 'manual',
        } as never)
        .select()
        .single();

      if (error) throw error;
      void logCreation({
        entityType: "Question",
        entityId: (data as { id?: string } | null)?.id,
        entityName: question.questionText.slice(0, 120),
        institutionId: question.institutionId ?? null,
        newValues: {
          question_type: question.questionType,
          marks: question.marks ?? 1,
          difficulty_level: question.difficultyLevel ?? 3,
          subject_id: question.subjectId ?? null,
          class_group_id: question.classGroupId ?? null,
          source: question.source ?? "manual",
        },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast({ title: "Question added to bank" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add question", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateQuestionBank() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, updates }: { 
      id: string; 
      updates: Partial<{
        question_text: string;
        question_type: QuestionType;
        options: Json | null;
        correct_answer: string | null;
        explanation: string | null;
        marks: number;
        difficulty_level: number;
        tags: string[];
        is_approved: boolean;
      }>;
    }) => {
      const { error } = await supabase
        .from("question_bank")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast({ title: "Question updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update question", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteQuestionBank() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("question_bank")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast({ title: "Question deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete question", description: error.message, variant: "destructive" });
    },
  });
}

const BATCH_SIZE = 500;

export function useBulkAddQuestionsToBank() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ questions, onProgress }: {
      questions: Array<{
        institutionId?: string;
        subjectId?: string;
        topicId?: string;
        gradeId?: string;
        questionText: string;
        questionType: QuestionType;
        options?: Json;
        correctAnswer?: string;
        explanation?: string;
        marks?: number;
        difficultyLevel?: number;
        tags?: string[];
        source?: string;
      }>;
      onProgress?: (imported: number, total: number) => void;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const insertData = questions.map(q => ({
        institution_id: q.institutionId || null,
        subject_id: q.subjectId || null,
        topic_id: q.topicId || null,
        grade_level_id: q.gradeId || null,
        question_text: q.questionText,
        question_type: q.questionType,
        options: q.options || null,
        correct_answer: q.correctAnswer || null,
        explanation: q.explanation || null,
        marks: q.marks || 1,
        difficulty_level: q.difficultyLevel || 3,
        tags: q.tags || [],
        created_by: user.id,
        is_approved: true,
        source: q.source || 'manual',
      }));

      // Batch insert
      const batches: typeof insertData[] = [];
      for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
        batches.push(insertData.slice(i, i + BATCH_SIZE));
      }

      let imported = 0;
      for (const batch of batches) {
        const { error } = await supabase
          .from("question_bank")
          .insert(batch);

        if (error) throw error;
        imported += batch.length;
        onProgress?.(imported, insertData.length);
        // Yield to UI between batches
        await new Promise(r => setTimeout(r, 50));
      }

      return { count: imported };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
      toast({ title: `${result.count} questions added to bank` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add questions", description: error.message, variant: "destructive" });
    },
  });
}
