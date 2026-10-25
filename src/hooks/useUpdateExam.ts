import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchExamEligibleStudentIds } from "@/lib/examEligibility";
import { useToast } from "@/hooks/use-toast";
import type { ExamFormData } from "@/types/exam";
import { toDbQuestionType, resolveResultVisibility } from "@/types/exam";
import type { TablesInsert } from "@/integrations/supabase/types";
import { examScheduleColumns } from "@/lib/examSchedule";

interface UpdateExamOptions {
  examId: string;
  formData: ExamFormData;
  deletedSectionIds: string[];
  deletedQuestionIds: string[];
  publish?: boolean;
}

interface UpdateExamResult {
  examId: string;
  status: "draft" | "published";
}

export function useUpdateExam() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      examId,
      formData,
      deletedSectionIds,
      deletedQuestionIds,
      publish = false,
    }: UpdateExamOptions): Promise<UpdateExamResult> => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      // 1. Delete removed questions first (before sections to avoid FK issues)
      if (deletedQuestionIds.length > 0) {
        // First delete related blueprints
        await supabase
          .from("evaluation_blueprints")
          .delete()
          .in("question_id", deletedQuestionIds);

        const { error: deleteQError } = await supabase
          .from("exam_questions")
          .delete()
          .in("id", deletedQuestionIds);
        if (deleteQError) throw deleteQError;
      }

      // 2. Delete removed sections
      if (deletedSectionIds.length > 0) {
        const { error: deleteSError } = await supabase
          .from("exam_sections")
          .delete()
          .in("id", deletedSectionIds);
        if (deleteSError) throw deleteSError;
      }

      // 3. Calculate total marks first to compute pass marks from percentage
      const totalMarks = formData.sections.reduce(
        (sum, section) =>
          sum + section.questions.reduce((qSum, q) => qSum + q.marks, 0),
        0
      );

      // Convert passing percentage to actual pass marks
      const passMarks = formData.metadata.passMarks && totalMarks > 0
        ? Math.round((formData.metadata.passMarks / 100) * totalMarks)
        : null;

      // 4. Update exam metadata
      const { error: examError } = await supabase
        .from("exams")
        .update({
          title: formData.metadata.title,
          description: formData.metadata.description || null,
          exam_mode: formData.metadata.examMode,
          exam_type: formData.metadata.examType ?? "unspecified",
          scheduled_date: formData.metadata.scheduledDate?.toISOString() || null,
          // Mirrors useSaveExam (CLAUDE.md §10): start / end / availability /
          // late_entry_minutes all come from the one helper, so end_time always
          // equals start + late entry + duration.
          ...examScheduleColumns({
            scheduledDate: formData.metadata.scheduledDate,
            startTime: formData.metadata.startTime,
            durationMinutes: formData.metadata.durationMinutes,
            lateEntryMinutes: formData.metadata.lateEntryMinutes,
          }),
          duration_minutes: formData.metadata.durationMinutes || null,
          pass_marks: passMarks,
          total_marks: totalMarks,
          instructions: formData.metadata.instructions || null,
          result_visibility: resolveResultVisibility(
            formData.metadata.examMode,
            formData.metadata.resultVisibility,
          ),
          ocr_confidence_threshold: formData.metadata.ocrConfidenceThreshold / 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", examId);

      if (examError) throw examError;

      // 4. Update class assignments - delete old, upsert new.
      // Mirrors useSaveExam (CLAUDE.md §10). The DELETE is silently rejected by
      // RLS for a teacher who isn't the exam's creator (PostgREST reports
      // success with zero rows removed, §6), so a plain insert then collided
      // with the surviving row: "duplicate key value violates unique constraint
      // exam_classes_exam_id_class_id_key". Upserting on the unique key is safe
      // whether or not the delete landed, and absorbs duplicate ids too.
      await supabase.from("exam_classes").delete().eq("exam_id", examId);
      const uniqueClassIds = Array.from(
        new Set(formData.context.classIds.filter((id) => id && id.trim() !== "")),
      );
      if (uniqueClassIds.length > 0) {
        const classLinks = uniqueClassIds.map((classId) => ({
          exam_id: examId,
          class_id: classId,
        }));
        const { error: classError } = await supabase
          .from("exam_classes")
          .upsert(classLinks, {
            onConflict: "exam_id,class_id",
            ignoreDuplicates: true,
          });
        if (classError) throw classError;
      }

      // 5. Update subject assignments (same idempotent treatment)
      await supabase.from("exam_subjects").delete().eq("exam_id", examId);
      const validSubjectIds = Array.from(
        new Set(formData.context.subjectIds.filter(id => id && id.trim() !== "")),
      );
      if (validSubjectIds.length > 0) {
        const subjectLinks = validSubjectIds.map((subjectId) => ({
          exam_id: examId,
          subject_id: subjectId,
        }));
        const { error: subjectError } = await supabase
          .from("exam_subjects")
          .upsert(subjectLinks, {
            onConflict: "exam_id,subject_id",
            ignoreDuplicates: true,
          });
        if (subjectError) throw subjectError;
      }

      // 6. Update sections and questions
      const questionIdMap = new Map<string, string>();

      for (const section of formData.sections) {
        let sectionId = section.id;

        if (section.id) {
          // Update existing section
          const { error: updateSectionError } = await supabase
            .from("exam_sections")
            .update({
              title: section.title,
              description: section.description || null,
              instructions: section.instructions || null,
              section_order: section.sectionOrder,
              section_type: section.sectionType === "checkbox" ? "mcq" : section.sectionType,
              default_marks: section.defaultMarks,
              negative_marking: section.negativeMarking,
              updated_at: new Date().toISOString(),
            })
            .eq("id", section.id);
          if (updateSectionError) throw updateSectionError;
        } else {
          // Insert new section
          const { data: newSection, error: insertSectionError } = await supabase
            .from("exam_sections")
            .insert({
              exam_id: examId,
              title: section.title,
              description: section.description || null,
              instructions: section.instructions || null,
              section_order: section.sectionOrder,
              section_type: section.sectionType === "checkbox" ? "mcq" : section.sectionType,
              default_marks: section.defaultMarks,
              negative_marking: section.negativeMarking,
            })
            .select("id")
            .single();
          if (insertSectionError) throw insertSectionError;
          sectionId = newSection.id;
        }

        // Process questions for this section
        for (let i = 0; i < section.questions.length; i++) {
          const question = section.questions[i];

          if (question.id) {
            // Update existing question
            const { error: updateQError } = await supabase
              .from("exam_questions")
              .update({
                question_text: question.questionText,
                question_type: toDbQuestionType(question.questionType),
                marks: question.marks,
                negative_marks: question.negativeMarks || 0,
                options: question.options ? JSON.parse(JSON.stringify(question.options)) : null,
                correct_answer: question.correctAnswer || null,
                explanation: question.explanation || null,
                difficulty_level: question.difficultyLevel,
                tags: question.tags.length > 0 ? question.tags : null,
                question_order: i + 1,
                image_url: question.imageUrl || null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", question.id);
            if (updateQError) throw updateQError;
            questionIdMap.set(question.tempId, question.id);
          } else {
            // Insert new question
            const questionInsert: TablesInsert<"exam_questions"> = {
              section_id: sectionId!,
              question_text: question.questionText,
              question_type: toDbQuestionType(question.questionType),
              marks: question.marks,
              negative_marks: question.negativeMarks || 0,
              options: question.options ? JSON.parse(JSON.stringify(question.options)) : null,
              correct_answer: question.correctAnswer || null,
              explanation: question.explanation || null,
              difficulty_level: question.difficultyLevel,
              tags: question.tags.length > 0 ? question.tags : null,
              question_order: i + 1,
              image_url: question.imageUrl || null,
            };
            const { data: newQuestion, error: insertQError } = await supabase
              .from("exam_questions")
              .insert(questionInsert)
              .select("id")
              .single();
            if (insertQError) throw insertQError;
            questionIdMap.set(question.tempId, newQuestion.id);
          }
        }
      }

      // 7. Update blueprints - delete old, insert new (with auto-fill)
      // See `useSaveExam.ts` comment for rationale — the mobile flow has
      // no blueprint editor, so we must synthesize defaults for every
      // subjective question or the publish trigger rejects the exam.
      await supabase.from("evaluation_blueprints").delete().eq("exam_id", examId);

      const subjectiveTypes = ["short_answer", "long_answer", "comprehension", "case_study"];
      const allQuestions = formData.sections.flatMap(s => s.questions);
      const subjectiveQuestions = allQuestions.filter(q => subjectiveTypes.includes(q.questionType));

      const configuredBlueprintTempIds = new Set(
        formData.blueprints
          .filter((bp) => questionIdMap.has(bp.tempQuestionId) || bp.questionId)
          .map((bp) => bp.tempQuestionId)
      );

      const blueprintsToInsert = [
        ...formData.blueprints
          .filter((bp) => questionIdMap.has(bp.tempQuestionId) || bp.questionId)
          .map((bp) => ({
            exam_id: examId,
            question_id: questionIdMap.get(bp.tempQuestionId) || bp.questionId,
            max_marks: bp.maxMarks,
            marking_scheme: bp.markingScheme || null,
            keywords: bp.keywords.length > 0 ? bp.keywords : null,
            partial_marking_allowed: bp.partialMarkingAllowed,
            negative_marking: bp.negativeMarking,
            ai_evaluation_enabled: bp.aiEvaluationEnabled,
            ai_confidence_threshold: bp.aiConfidenceThreshold,
            created_by: user.user.id,
          })),
        ...subjectiveQuestions
          .filter(
            (q) =>
              !configuredBlueprintTempIds.has(q.tempId) &&
              questionIdMap.has(q.tempId)
          )
          .map((q) => ({
            exam_id: examId,
            question_id: questionIdMap.get(q.tempId)!,
            max_marks: q.marks,
            marking_scheme: null,
            keywords: null,
            partial_marking_allowed: true,
            negative_marking: 0,
            ai_evaluation_enabled: true,
            ai_confidence_threshold: 0.75,
            created_by: user.user.id,
          })),
      ];

      if (blueprintsToInsert.length > 0) {
        const { error: blueprintError } = await supabase
          .from("evaluation_blueprints")
          .insert(blueprintsToInsert);
        if (blueprintError) throw blueprintError;
      }

      // 8. Determine blueprint readiness
      const blueprintReady = subjectiveQuestions.length === 0 ||
        (blueprintsToInsert.length >= subjectiveQuestions.length);

      const { error: updateError } = await supabase
        .from("exams")
        .update({
          is_blueprint_ready: blueprintReady,
        })
        .eq("id", examId);

      if (updateError) throw updateError;

      // 8b. Mirror useSaveExam.ts: keep hybrid_exam_settings in sync with mode.
      if (formData.metadata.examMode === "hybrid" && formData.metadata.hybridSettings) {
        const hs = formData.metadata.hybridSettings;
        const { error: hybridError } = await supabase
          .from("hybrid_exam_settings")
          .upsert(
            {
              exam_id: examId,
              institution_id: formData.context.institutionId,
              grace_window_minutes: hs.graceWindowMinutes,
              max_pages: hs.maxPages,
              require_camera: hs.requireCamera,
              sheet_numbering_instruction: hs.sheetNumberingInstruction,
            },
            { onConflict: "exam_id" }
          );
        if (hybridError) throw hybridError;
      } else {
        await supabase
          .from("hybrid_exam_settings")
          .delete()
          .eq("exam_id", examId);
      }

      // 9. Publish if requested
      if (publish) {
        const { error: publishError } = await supabase
          .from("exams")
          .update({ 
            status: "published",
            published_at: new Date().toISOString(),
          })
          .eq("id", examId);

        if (publishError) throw publishError;
      }

      return {
        examId,
        status: publish ? "published" : "draft",
      };
    },
    onSuccess: async (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["exam-editor"] });
      queryClient.invalidateQueries({ queryKey: ["exam-for-edit"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: result.status === "published" ? "Exam Published" : "Changes Saved",
        description:
          result.status === "published"
            ? "The exam is now available to students"
            : "Your changes have been saved",
      });

      // Send exam_published notifications to assigned students
      if (result.status === "published" && variables.publish) {
        try {
          // Get all students assigned to the exam's classes
          const { data: classAssignments } = await supabase
            .from("exam_classes")
            .select("class_id")
            .eq("exam_id", result.examId);

          if (classAssignments && classAssignments.length > 0) {
            const classIds = classAssignments.map((ca) => ca.class_id);
            const { data: students } = await supabase
              .from("class_assignments")
              .select("user_id")
              .in("class_id", classIds)
              .eq("role", "student")
              // Explicit bound: PostgREST truncates at 1000 silently.
              .range(0, 999);

            if (students && students.length > 0) {
              // Only tell the pupils who actually sit this paper. The list used
              // to be the whole class, so an optional-subject exam pushed a
              // "New Exam Published" notification to every classmate — the one
              // leak the student exam list itself already filtered out, which
              // made the notification the loudest wrong signal in the product.
              const eligibleIds = await fetchExamEligibleStudentIds(result.examId);
              const uniqueStudentIds = [
                ...new Set(students.map((s) => s.user_id)),
              ].filter((id) => eligibleIds.has(id as string));
              const notifications = uniqueStudentIds.map((studentId) => ({
                user_id: studentId,
                type: "exam_published",
                title: "New Exam Published",
                message: `A new exam "${variables.formData.metadata.title}" has been published. Check the schedule and prepare accordingly.`,
                link: "/exams",
                metadata: { exam_id: result.examId },
              }));

              await supabase.from("notifications").insert(notifications);
            }
          }
        } catch (e) {
          console.error("Failed to send exam_published notifications:", e);
        }
      }
    },
    onError: (error) => {
      console.error("Failed to update exam:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to update exam",
        variant: "destructive",
      });
    },
  });
}

// Schedule math lives in @/lib/examSchedule (shared with useSaveExam).
