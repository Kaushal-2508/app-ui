import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

type ExamInsert = Database["public"]["Tables"]["exams"]["Insert"];
type ExamSectionInsert = Database["public"]["Tables"]["exam_sections"]["Insert"];
type ExamQuestionInsert = Database["public"]["Tables"]["exam_questions"]["Insert"];

export interface ExamDraftRow {
  id: string;
  title: string;
  description: string | null;
  exam_mode: string;
  scheduled_date: string | null;
  created_at: string;
  updated_at: string;
  total_marks: number | null;
  duration_minutes: number | null;
  created_by: string;
  sectionsCount: number;
  questionsCount: number;
  targetQuestionsCount: number;
  completionPercent: number;
  subjectName: string | null;
}

type SectionLite = {
  id: string;
  exam_questions?: Array<{ id: string }>;
  // Optional hypothetical persisted targets
};

/**
 * Lists the current user's draft exams with computed completion progress.
 * Admins/coordinators also see institution-wide drafts.
 */
export function useExamDrafts() {
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: queryKeys.examDrafts(undefined, institutionId || undefined),
    enabled: !!institutionId,
    queryFn: async (): Promise<ExamDraftRow[]> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("exams")
        .select(
          `id, title, description, exam_mode, scheduled_date, created_at, updated_at,
           total_marks, duration_minutes, created_by,
           exam_sections(id, exam_questions(id)),
           exam_subjects(subject_id, universal_subjects(name))`
        )
        .eq("institution_id", institutionId!)
        .eq("status", "draft")
        .eq("created_by", auth.user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return ((data as unknown as Array<Record<string, unknown>>) || []).map((row) => {
        const sections = (row.exam_sections as SectionLite[]) || [];
        const questionsCount = sections.reduce(
          (sum, s) => sum + (s.exam_questions?.length || 0),
          0
        );
        const sectionsCount = sections.length;
        // Completion proxy: if there's at least one section with >=1 question -> partial
        // We don't currently persist target question counts on the DB, so we approximate.
        const targetQuestionsCount = Math.max(questionsCount, sectionsCount * 5);
        const completionPercent =
          targetQuestionsCount > 0
            ? Math.min(100, Math.round((questionsCount / targetQuestionsCount) * 100))
            : 0;

        const subjects =
          (row.exam_subjects as Array<{ universal_subjects?: { name?: string } }>) || [];
        const subjectName = subjects[0]?.universal_subjects?.name ?? null;

        return {
          id: row.id as string,
          title: row.title as string,
          description: (row.description as string | null) ?? null,
          exam_mode: row.exam_mode as string,
          scheduled_date: (row.scheduled_date as string | null) ?? null,
          created_at: row.created_at as string,
          updated_at: row.updated_at as string,
          total_marks: (row.total_marks as number | null) ?? null,
          duration_minutes: (row.duration_minutes as number | null) ?? null,
          created_by: row.created_by as string,
          sectionsCount,
          questionsCount,
          targetQuestionsCount,
          completionPercent,
          subjectName,
        };
      });
    },
  });
}

export function useDuplicateExamDraft() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (examId: string): Promise<string> => {
      // Fetch the full exam shape
      const { data: exam, error: examErr } = await supabase
        .from("exams")
        .select(
          `*,
           exam_sections(*, exam_questions(*)),
           exam_classes(class_id),
           exam_subjects(subject_id),
           exam_topics(topic_id, custom_topic_id)`
        )
        .eq("id", examId)
        .single();
      if (examErr || !exam) throw examErr || new Error("Exam not found");

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not authenticated");

      const {
        id: _oldId,
        created_at: _ca,
        updated_at: _ua,
        published_at: _pa,
        published_by: _pb,
        exam_sections,
        exam_classes,
        exam_subjects,
        exam_topics,
        title,
        ...examFields
      } = exam as unknown as Record<string, unknown> & {
        exam_sections: Array<Record<string, unknown> & { exam_questions: Array<Record<string, unknown>> }>;
        exam_classes: Array<{ class_id: string }>;
        exam_subjects: Array<{ subject_id: string }>;
        exam_topics: Array<{ topic_id: string | null; custom_topic_id: string | null }>;
        title: string;
      };
      void _oldId; void _ca; void _ua; void _pa; void _pb;

      const examInsert = {
        ...(examFields as Partial<ExamInsert>),
        title: `${title} (copy)`,
        status: "draft",
        // Duplicating a PUBLISHED exam copies its whole row, so this flag would
        // ride along and leave the new draft flagged visible to students.
        visible_to_students: false,
        is_locked_for_edits: false,
        locked_at: null,
        current_version: 1,
        created_by: auth.user.id,
      } as ExamInsert;

      const { data: newExam, error: newErr } = await supabase
        .from("exams")
        .insert(examInsert)
        .select("id")
        .single();
      if (newErr || !newExam) throw newErr;
      const newExamId = newExam.id as string;

      // Re-link classes, subjects & chapters. Deduped: exam_classes and
      // exam_subjects each carry a UNIQUE (exam_id, *_id) key, so a source exam
      // with a repeated link would otherwise fail the copy with 23505.
      const classIds = [...new Set(exam_classes.map((c) => c.class_id).filter(Boolean))];
      if (classIds.length) {
        await supabase
          .from("exam_classes")
          .insert(classIds.map((class_id) => ({ exam_id: newExamId, class_id })));
      }
      const subjectIds = [...new Set(exam_subjects.map((s) => s.subject_id).filter(Boolean))];
      if (subjectIds.length) {
        await supabase
          .from("exam_subjects")
          .insert(subjectIds.map((subject_id) => ({ exam_id: newExamId, subject_id })));
      }
      // Chapters were previously not copied, so a duplicate lost its syllabus
      // scope and reopened with an empty Chapters picker.
      const topicLinks = (exam_topics ?? [])
        .filter((t) => t.topic_id || t.custom_topic_id)
        .map((t) => ({
          exam_id: newExamId,
          topic_id: t.topic_id,
          custom_topic_id: t.custom_topic_id,
        }));
      if (topicLinks.length) {
        await supabase.from("exam_topics").insert(topicLinks);
      }

      // Re-create sections + questions
      for (const section of exam_sections) {
        const { exam_questions, id: _sid, exam_id: _eid, created_at: _sca, updated_at: _sua, ...sectionFields } =
          section as unknown as Record<string, unknown> & { exam_questions: Array<Record<string, unknown>> };
        void _sid; void _eid; void _sca; void _sua;

        const sectionInsert = {
          ...(sectionFields as Partial<ExamSectionInsert>),
          exam_id: newExamId,
        } as ExamSectionInsert;

        const { data: newSection, error: sErr } = await supabase
          .from("exam_sections")
          .insert(sectionInsert)
          .select("id")
          .single();
        if (sErr || !newSection) throw sErr;

        if (exam_questions.length) {
          const rows: ExamQuestionInsert[] = exam_questions.map((q) => {
            const { id: _qid, section_id: _ssid, created_at: _qca, updated_at: _qua, ...qFields } = q as Record<
              string,
              unknown
            >;
            void _qid; void _ssid; void _qca; void _qua;
            return {
              ...(qFields as Partial<ExamQuestionInsert>),
              section_id: newSection.id,
            } as ExamQuestionInsert;
          });
          await supabase.from("exam_questions").insert(rows);
        }
      }

      return newExamId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-my-exams"] });
      toast({
        title: "Duplicate created",
        description:
          "A copy has been saved to your drafts. Open Drafts to rename it and publish.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't duplicate the exam", description: err.message, variant: "destructive" });
    },
  });
}

export function useDeleteExamDraft() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (examId: string) => {
      const { error } = await supabase.from("exams").delete().eq("id", examId).eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "Draft deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete draft", description: err.message, variant: "destructive" });
    },
  });
}
