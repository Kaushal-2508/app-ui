import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { ExamFormData } from "@/types/exam";
import { toDbQuestionType, resolveResultVisibility } from "@/types/exam";
import type { TablesInsert, Json } from "@/integrations/supabase/types";

/** Normalise a JSON option value (string or {text} object) in-place during save. */
function normalizeOption(opt: unknown): unknown {
  if (typeof opt === "string") return normalizeText(opt);
  if (opt && typeof opt === "object" && "text" in opt) {
    const o = opt as Record<string, unknown>;
    return { ...o, text: normalizeText(String(o.text ?? "")) };
  }
  return opt;
}
import { useAutoBadgeAward } from "./useAutoBadgeAward";
import { normalizeText } from "@/lib/textNormalization";
import { examScheduleColumns } from "@/lib/examSchedule";

interface SaveExamResult {
  examId: string;
  status: "draft" | "published";
  userId: string;
  institutionId: string;
}

// Validate minimum requirements for saving an exam
function validateExamRequirements(formData: ExamFormData, publish: boolean): string | null {
  if (!formData.context.institutionId) {
    return "Institution is required";
  }
  if (formData.context.classIds.length === 0) {
    return "At least one class must be selected";
  }
  if (!formData.metadata.title.trim()) {
    return "Exam title is required";
  }
  if (formData.metadata.examMode === "hybrid") {
    const hs = formData.metadata.hybridSettings;
    if (!hs) return "Hybrid settings are required for hybrid exams";
    if (hs.graceWindowMinutes < 3 || hs.graceWindowMinutes > 15) {
      return "Hybrid upload window must be between 3 and 15 minutes";
    }
    if (hs.maxPages < 1 || hs.maxPages > 50) {
      return "Hybrid max pages must be between 1 and 50";
    }
    if (!hs.sheetNumberingInstruction.trim()) {
      return "Sheet numbering instruction is required for hybrid exams";
    }
  }

  // For publishing, require sections and questions — EXCEPT the results-only
  // path (already-conducted offline exam: no questions, one synthetic section).
  if (publish && formData.metadata.isResultsOnly !== true) {
    if (formData.sections.length === 0) {
      return "At least one section is required to publish";
    }
    const totalQuestions = formData.sections.reduce((sum, s) => sum + s.questions.length, 0);
    if (totalQuestions === 0) {
      return "At least one question is required to publish";
    }
  }
  if (publish && formData.metadata.isResultsOnly === true) {
    if (!formData.metadata.totalMarksOverride || formData.metadata.totalMarksOverride <= 0) {
      return "Total marks are required for an already-created exam";
    }
  }

  return null;
}

/** Single-flight key: callers ask `queryClient.isMutating({ mutationKey })`,
 * which is live, instead of a render-time `isPending` a stale closure holds. */
export const SAVE_EXAM_MUTATION_KEY = ["save-exam"] as const;

// Toasts belong to the caller (ExamCreationFlow): this hook used to raise its
// own success toast and a raw error.message toast on top of the caller's
// translated one, so every result appeared twice (CLAUDE.md §19). The one
// exception: when the caller has already unmounted (browser Back during a
// multi-second publish), TanStack drops its per-call callbacks, so the hook
// reports the outcome itself rather than leave it silent.
export function useSaveExam(options?: { isCallerMounted?: () => boolean }) {
  const queryClient = useQueryClient();
  const { checkAndAwardBadges } = useAutoBadgeAward();
  const callerGone = () => options?.isCallerMounted?.() === false;

  return useMutation({
    mutationKey: SAVE_EXAM_MUTATION_KEY,
    mutationFn: async ({
      formData,
      publish = false,
      onDraftCreated,
    }: {
      formData: ExamFormData;
      publish?: boolean;
      /** Called as soon as a NEW draft row exists, before the remaining writes.
       * If a later step fails (e.g. the slot guard refuses the publish), the
       * caller still learns the id and a retry updates that draft instead of
       * inserting another one. */
      onDraftCreated?: (examId: string) => void;
    }): Promise<SaveExamResult> => {
      // Validate requirements
      const validationError = validateExamRequirements(formData, publish);
      if (validationError) {
        throw new Error(validationError);
      }
      
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const resolvedResultVisibility = resolveResultVisibility(
        formData.metadata.examMode,
        formData.metadata.resultVisibility,
      );

      // 1. Total marks: results-only uses the entered override; otherwise sum of question marks.
      const totalMarks =
        formData.metadata.isResultsOnly && formData.metadata.totalMarksOverride != null
          ? formData.metadata.totalMarksOverride
          : formData.sections.reduce(
              (sum, section) =>
                sum + section.questions.reduce((qSum, q) => qSum + q.marks, 0),
              0,
            );

      // Convert passing percentage to actual pass marks. Clamp the percentage
      // to 100 and the result to total_marks so an out-of-range pass % can never
      // violate the exams `valid_pass_marks` CHECK (pass_marks <= total_marks)
      // and abort the whole save.
      const passMarks = formData.metadata.passMarks && totalMarks > 0
        ? Math.min(
            totalMarks,
            Math.round((Math.min(formData.metadata.passMarks, 100) / 100) * totalMarks),
          )
        : null;

      let examId = formData.examId;
      
      // Check if we're updating an existing draft or creating a new one
      if (examId) {
        // UPDATE existing draft - verify it still exists and is a draft
        const { data: existingExam, error: checkError } = await supabase
          .from("exams")
          .select("id, status")
          .eq("id", examId)
          .single();
        
        if (checkError || !existingExam) {
          console.warn("Existing exam not found, creating new one");
          examId = undefined;
        } else if (existingExam.status !== "draft") {
          throw new Error("Cannot modify a published exam. Please create a new exam.");
        }
      }

      if (examId) {
        // Update existing exam
        const { error: updateError } = await supabase
          .from("exams")
          .update({
            title: normalizeText(formData.metadata.title),
            description: normalizeText(formData.metadata.description || "") || null,
            exam_mode: formData.metadata.examMode,
            exam_type: formData.metadata.examType ?? "unspecified",
            scheduled_date: formData.metadata.scheduledDate?.toISOString() || null,
            // start / end / availability / late_entry_minutes all derive from
            // the one helper so the entry window and the exam end can't drift
            // apart again (end = start + late entry + duration).
            ...examScheduleColumns({
              scheduledDate: formData.metadata.scheduledDate,
              startTime: formData.metadata.startTime,
              durationMinutes: formData.metadata.durationMinutes,
              lateEntryMinutes: formData.metadata.lateEntryMinutes,
            }),
            duration_minutes: formData.metadata.durationMinutes || null,
            pass_marks: passMarks,
            total_marks: totalMarks,
            instructions: normalizeText(formData.metadata.instructions || "") || null,
            ocr_confidence_threshold: formData.metadata.ocrConfidenceThreshold / 100,
            proctoring_config: formData.metadata.proctoringConfig
              ? (formData.metadata.proctoringConfig as unknown as Record<string, unknown>)
              : undefined,
            result_visibility: resolvedResultVisibility,
            visible_to_students: publish,
            template_id: formData.metadata.templateId || null,
            is_results_only: formData.metadata.isResultsOnly ?? false,
            source_paper_files: formData.metadata.sourcePaperFiles ?? null,
          } as unknown as Record<string, unknown>)
          .eq("id", examId);

        if (updateError) throw updateError;

        // Delete existing related data to replace with new data
        await Promise.all([
          supabase.from("exam_classes").delete().eq("exam_id", examId),
          supabase.from("exam_subjects").delete().eq("exam_id", examId),
          supabase.from("exam_topics").delete().eq("exam_id", examId),
          supabase.from("evaluation_blueprints").delete().eq("exam_id", examId),
        ]);

        // Delete existing sections (cascades to questions)
        await supabase.from("exam_sections").delete().eq("exam_id", examId);
      } else {
        // Create new exam
        const { data: exam, error: examError } = await supabase
          .from("exams")
          .insert({
            title: normalizeText(formData.metadata.title),
            description: normalizeText(formData.metadata.description || "") || null,
            institution_id: formData.context.institutionId,
            exam_mode: formData.metadata.examMode,
            exam_type: formData.metadata.examType ?? "unspecified",
            scheduled_date: formData.metadata.scheduledDate?.toISOString() || null,
            // start / end / availability / late_entry_minutes all derive from
            // the one helper so the entry window and the exam end can't drift
            // apart again (end = start + late entry + duration).
            ...examScheduleColumns({
              scheduledDate: formData.metadata.scheduledDate,
              startTime: formData.metadata.startTime,
              durationMinutes: formData.metadata.durationMinutes,
              lateEntryMinutes: formData.metadata.lateEntryMinutes,
            }),
            duration_minutes: formData.metadata.durationMinutes || null,
            pass_marks: passMarks,
            total_marks: totalMarks,
            instructions: normalizeText(formData.metadata.instructions || "") || null,
            ocr_confidence_threshold: formData.metadata.ocrConfidenceThreshold / 100,
            created_by: user.user.id,
            status: "draft",
            proctoring_config: formData.metadata.proctoringConfig
              ? (formData.metadata.proctoringConfig as unknown as Record<string, unknown>)
              : undefined,
            result_visibility: resolvedResultVisibility,
            visible_to_students: publish,
            template_id: formData.metadata.templateId || null,
            is_results_only: formData.metadata.isResultsOnly ?? false,
            source_paper_files: formData.metadata.sourcePaperFiles ?? null,
          } as unknown as TablesInsert<"exams">)
          .select("id")
          .single();

        if (examError) throw examError;
        examId = exam.id;
        onDraftCreated?.(exam.id);
      }

      // 2. Link classes
      // Link classes — idempotent on purpose.
      //
      // The preceding "delete all links, then re-insert" only works when the
      // caller may delete them. The RLS DELETE policy on exam_classes allows
      // the exam's CREATOR (or a school admin), while the UI lets any teacher
      // assigned to the exam's class+subject edit it. For that teacher the
      // DELETE is silently rejected — PostgREST reports success with zero rows
      // removed (CLAUDE.md §6) — the old row survives, and the re-insert then
      // died with "duplicate key value violates unique constraint
      // exam_classes_exam_id_class_id_key" (23505 / HTTP 409), aborting the
      // publish. Upserting against the unique key makes the write safe whether
      // or not the delete landed, and also absorbs duplicates in the payload.
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

      // 3. Link subjects - filter out empty/invalid subject IDs
      // Same idempotent treatment as exam_classes above — exam_subjects also
      // carries a UNIQUE (exam_id, subject_id) key.
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

      // 3b. Link chapters (syllabus_topics) via exam_topics
      // exam_topics has NO unique key, so it can't be upserted on conflict —
      // dedupe the payload instead. A blocked DELETE here duplicates rows
      // rather than erroring, which the edit loader de-duplicates on read.
      const chapterIds = Array.from(new Set(formData.context.chapterIds || []));
      if (chapterIds.length > 0) {
        const topicLinks = chapterIds.map((topicId) => ({
          exam_id: examId,
          topic_id: topicId,
        }));
        const { error: topicError } = await supabase
          .from("exam_topics")
          .insert(topicLinks);
        if (topicError) throw topicError;
      }

      // 4. Create sections and questions
      const sectionIdMap = new Map<string, string>();
      const questionIdMap = new Map<string, string>();

      for (const section of formData.sections) {
        const { data: sectionData, error: sectionError } = await supabase
          .from("exam_sections")
          .insert({
            exam_id: examId,
            title: normalizeText(section.title),
            description: normalizeText(section.description || "") || null,
            instructions: normalizeText(section.instructions || "") || null,
            section_order: section.sectionOrder,
            total_marks:
              section.totalMarks ??
              section.questions.reduce((a, q) => a + q.marks, 0),
            randomize_order: section.randomizeOrder ?? false,
            partial_marks_allowed: section.partialMarksAllowed ?? false,
            negative_marking_enabled: section.negativeMarkingEnabled ?? false,
          } as TablesInsert<"exam_sections">)
          .select("id")
          .single();

        if (sectionError) throw sectionError;
        sectionIdMap.set(section.tempId, sectionData.id);

        // Create questions for this section
        for (let i = 0; i < section.questions.length; i++) {
          const question = section.questions[i];
          
          // For matching questions, serialize matchingData into options
          let optionsToSave: unknown = question.options ? JSON.parse(JSON.stringify(question.options)) : null;
          if (question.questionType === "matching" && question.matchingData) {
            optionsToSave = JSON.parse(JSON.stringify({
              columnA: question.matchingData.columnA,
              columnB: question.matchingData.columnB,
            }));
          }

          // Normalize text in options
          if (Array.isArray(optionsToSave)) {
            optionsToSave = optionsToSave.map(normalizeOption);
          }

          const questionInsert: TablesInsert<"exam_questions"> = {
            section_id: sectionData.id,
            question_text: normalizeText(question.questionText),
            question_type: toDbQuestionType(question.questionType),
            marks: question.marks,
            negative_marks: question.negativeMarks || 0,
            options: optionsToSave as Json,
            correct_answer: normalizeText(question.correctAnswer || "") || null,
            explanation: normalizeText(question.explanation || "") || null,
            difficulty_level: question.difficultyLevel,
            tags: question.tags.length > 0 ? question.tags : null,
            question_order: i + 1,
            image_url: question.imageUrl || null,
          };
          const { data: questionData, error: questionError } = await supabase
            .from("exam_questions")
            .insert(questionInsert)
            .select("id")
            .single();

          if (questionError) throw questionError;
          questionIdMap.set(question.tempId, questionData.id);
          
          // Save sub-questions for comprehension/case_study
          if (question.subQuestions && question.subQuestions.length > 0) {
            for (let j = 0; j < question.subQuestions.length; j++) {
              const subQ = question.subQuestions[j];
              let subOptions: unknown = subQ.options ? JSON.parse(JSON.stringify(subQ.options)) : null;
              if (Array.isArray(subOptions)) {
                subOptions = subOptions.map(normalizeOption);
              }
              const subInsert: TablesInsert<"exam_questions"> = {
                section_id: sectionData.id,
                question_text: normalizeText(subQ.questionText),
                question_type: toDbQuestionType(subQ.questionType || "short_answer"),
                marks: subQ.marks || 2,
                negative_marks: subQ.negativeMarks || 0,
                options: subOptions as Json,
                correct_answer: normalizeText(subQ.correctAnswer || "") || null,
                explanation: normalizeText(subQ.explanation || "") || null,
                difficulty_level: subQ.difficultyLevel || question.difficultyLevel,
                tags: subQ.tags && subQ.tags.length > 0 ? subQ.tags : null,
                question_order: (i + 1) * 100 + (j + 1),
                parent_question_id: questionData.id,
                image_url: subQ.imageUrl || null,
              };
              const { data: subData, error: subError } = await supabase
                .from("exam_questions")
                .insert(subInsert)
                .select("id")
                .single();
              if (subError) throw subError;
              if (subQ.tempId) {
                questionIdMap.set(subQ.tempId, subData.id);
              }
            }
          }
        }
      }

      // 5. Create evaluation blueprints
      // Start from user-configured blueprints, then auto-fill defaults for
      // any subjective question missing one. The new mobile flow has no
      // blueprint-editor UI, so without these defaults the DB trigger
      // (`validate_exam_status` -> validate_exam_status_transition) blocks publish with
      // "Cannot publish exam without evaluation blueprint".
      const subjectiveTypes = ["short_answer", "long_answer", "comprehension", "case_study"];
      const allQuestions = formData.sections.flatMap(s => s.questions);
      const subjectiveQuestions = allQuestions.filter(q => subjectiveTypes.includes(q.questionType));

      const configuredBlueprintTempIds = new Set(
        formData.blueprints
          .filter((bp) => questionIdMap.has(bp.tempQuestionId))
          .map((bp) => bp.tempQuestionId)
      );

      const blueprintsToInsert = [
        ...formData.blueprints
          .filter((bp) => questionIdMap.has(bp.tempQuestionId))
          .map((bp) => ({
            exam_id: examId,
            question_id: questionIdMap.get(bp.tempQuestionId)!,
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

      // 6. Determine blueprint readiness (totalMarks already calculated above)
      // With auto-fill above, every subjective question now has a blueprint,
      // so this reduces to a safety check.
      const blueprintReady =
        subjectiveQuestions.length === 0 ||
        blueprintsToInsert.length >= subjectiveQuestions.length;

      const { error: updateError } = await supabase
        .from("exams")
        .update({
          total_marks: totalMarks,
          is_blueprint_ready: blueprintReady,
        })
        .eq("id", examId);

      if (updateError) throw updateError;

      // 6b. Upsert hybrid settings (only for hybrid mode); delete any
      // stale row when the mode was switched away from hybrid.
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

      // 7. Publish if requested. This UPDATE is where the exams_slot_guard
      // trigger (migration 20260928170000) refuses a time that overlaps another
      // live exam for any of these sections: P0001 with HINT
      // 'exam_slot_conflict', thrown unwrapped so the caller can tell it apart.
      // The exam stays a draft with everything above saved.
      if (publish) {
        const { error: publishError } = await supabase
          .from("exams")
          .update({ status: "published" })
          .eq("id", examId);

        if (publishError) throw publishError;
      }

      return {
        examId,
        status: publish ? "published" : "draft",
        userId: user.user.id,
        institutionId: formData.context.institutionId,
      };
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (result.status === "published") {
        // A new booking: any open schedule sheet must see it.
        queryClient.invalidateQueries({ queryKey: ["exam-slot-bookings"] });
        if (callerGone()) toast.success("Exam published");
      }

      // Award badges for exam creation (teacher badge)
      if (result.userId && result.institutionId) {
        try {
          await checkAndAwardBadges(
            result.userId,
            result.institutionId,
            "exam_created",
            { examId: result.examId }
          );
          console.log("Badge check triggered for exam creation");
        } catch (error) {
          console.error("Error checking badges:", error);
        }
      }
    },
    onError: (error, variables) => {
      console.error("Failed to save exam:", error);
      if (callerGone()) {
        toastError(error, {
          fallback: variables.publish ? "Couldn't publish the exam." : "Couldn't save the draft.",
          context: "saveExam",
        });
      }
    },
  });
}

// Schedule math lives in @/lib/examSchedule — shared with useUpdateExam so the
// two hooks can't drift (CLAUDE.md §10). The old local helpers computed
// availability_end from a "legacy values win" branch, which made editing the
// late-entry window a silent no-op on any exam that already had one.
