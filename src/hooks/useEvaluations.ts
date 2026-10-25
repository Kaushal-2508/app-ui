import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";
import { formatStudentIdLine, sortStudentRoster } from "@/lib/studentIdentity";
import type { 
  StudentAnswerWithEvaluation, 
  AttemptEvaluationStatus 
} from "@/types/exam";

/**
 * The evaluation queue for /ocr-review.
 *
 * This used to run one unbounded query for every submitted attempt on an online
 * exam, then loop over the result issuing THREE more sequential round-trips per
 * attempt (student_answers, then teacher_overrides and ai_evaluations keyed on
 * those answers). At Alliance that is 845 attempts and 2,535 requests in series,
 * so the page sat on skeletons for minutes; Salci National has 29 and finished
 * quickly, which is why it went unnoticed. `attempt_evaluation_queue` does the
 * counting in one call (845 rows in ~1.8s).
 *
 * The RPC is SECURITY INVOKER, so RLS scopes it exactly as the old queries were
 * scoped, and the status ladder and display strings are still derived here, so
 * what the queue MEANS is unchanged.
 */
export function usePendingEvaluations() {
  return useQuery({
    queryKey: ["pending-evaluations"],
    staleTime: 60_000,
    queryFn: async (): Promise<AttemptEvaluationStatus[]> => {
      const { data, error } = await supabase.rpc("attempt_evaluation_queue", { _limit: 1000 });
      if (error) throw error;

      const results: AttemptEvaluationStatus[] = (data ?? []).map((row) => {
        const totalQuestions = row.total_questions ?? 0;
        const teacherReviewedCount = row.teacher_reviewed_count ?? 0;
        const aiEvaluatedCount = row.ai_evaluated_count ?? 0;
        const pendingReviewCount = row.pending_review_count ?? 0;

        // Unchanged ladder, including the quirk that an attempt with no answers
        // reads as ready to finalize (0 === 0). Changing that would change which
        // papers the queue surfaces, which is not what this fix is for.
        let status: AttemptEvaluationStatus["status"] = "pending";
        if (row.is_finalized) status = "finalized";
        else if (teacherReviewedCount === totalQuestions) status = "ready_to_finalize";
        else if (teacherReviewedCount > 0) status = "in_progress";
        else if (pendingReviewCount > 0) status = "needs_review";
        else if (aiEvaluatedCount > 0) status = "ai_processing";

        return {
          attemptId: row.attempt_id,
          studentName: getDisplayName({ full_name: row.student_full_name }),
          studentIdLine: formatStudentIdLine(row.student_roll_number, row.student_admission_number),
          studentRollNumber: row.student_roll_number ?? null,
          examTitle: row.exam_title,
          className: formatClassName(row.class_name, row.class_section),
          submittedAt: row.submitted_at || "",
          totalQuestions,
          objectiveQuestions: 0,
          subjectiveQuestions: 0,
          evaluatedQuestions: teacherReviewedCount,
          aiEvaluatedCount,
          teacherReviewedCount,
          pendingReviewCount,
          status,
          isFinalized: row.is_finalized,
        };
      });

      // One block per exam+class, so each marker's stack of papers is ordered
      // on its own: roll order when that class is fully numbered, alphabetical
      // (ERP order) while roll allocation is still incomplete.
      return sortStudentRoster(results, {
        getRoll: (r) => r.studentRollNumber,
        getName: (r) => r.studentName,
        getGroupKey: (r) => `${r.examTitle} :: ${r.className}`,
      });
    },
  });
}

// Fetch answers for a specific attempt with evaluation data
export function useAttemptAnswers(attemptId: string | null) {
  return useQuery({
    queryKey: ["attempt-answers", attemptId],
    queryFn: async (): Promise<StudentAnswerWithEvaluation[]> => {
      if (!attemptId) return [];

      const { data: answers, error } = await supabase
        .from("student_answers")
        .select(`
          id,
          attempt_id,
          question_id,
          answer_text,
          answer_options,
          answer_source,
          ocr_extracted_text,
          ocr_confidence,
          ocr_needs_review,
          exam_questions!inner (
            question_text,
            question_type,
            marks,
            options,
            correct_answer,
            image_url
          )
        `)
        .eq("attempt_id", attemptId);

      if (error) throw error;

      // Fetch related evaluations and overrides
      const answerIds = answers?.map(a => a.id) || [];
      
      const [aiEvalsResult, overridesResult, blueprintsResult] = await Promise.all([
        supabase.from("ai_evaluations").select("*").in("answer_id", answerIds),
        supabase.from("teacher_overrides").select("*").in("answer_id", answerIds),
        supabase.from("evaluation_blueprints").select("*").in("question_id", answers?.map(a => a.question_id) || []),
      ]);

      const aiEvals = aiEvalsResult.data || [];
      const overrides = overridesResult.data || [];
      const blueprints = blueprintsResult.data || [];

      // Fetch teacher names for overrides
      const teacherIds = [...new Set(overrides.map(o => o.evaluated_by))];
      const { data: teachers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds);

      return (answers || []).map(answer => {
        const questionData = answer.exam_questions as {
          question_text: string;
          question_type: string;
          marks: number;
          options: Array<{ id: string; text: string }> | null;
          correct_answer: string | null;
          image_url: string | null;
        };
        
        const aiEval = aiEvals.find(e => e.answer_id === answer.id);
        const override = overrides.find(o => o.answer_id === answer.id);
        const blueprint = blueprints.find(b => b.question_id === answer.question_id);
        const teacher = teachers?.find(t => t.id === override?.evaluated_by);

        return {
          id: answer.id,
          attemptId: answer.attempt_id,
          questionId: answer.question_id,
          questionText: questionData.question_text,
          questionImageUrl: questionData.image_url ?? null,
          questionType: questionData.question_type as StudentAnswerWithEvaluation["questionType"],
          answerText: answer.answer_text,
          answerOptions: answer.answer_options as Record<string, unknown> | null,
          answerSource: answer.answer_source as "online" | "offline_ocr",
          ocrExtractedText: answer.ocr_extracted_text,
          ocrConfidence: answer.ocr_confidence,
          ocrNeedsReview: answer.ocr_needs_review || false,
          maxMarks: questionData.marks,
          // NEW: Include options and correct answer for display
          options: questionData.options,
          correctAnswer: questionData.correct_answer,
          blueprint: blueprint ? {
            questionId: blueprint.question_id || "",
            tempQuestionId: "",
            maxMarks: blueprint.max_marks,
            markingScheme: blueprint.marking_scheme || "",
            keywords: blueprint.keywords || [],
            partialMarkingAllowed: blueprint.partial_marking_allowed,
            negativeMarking: blueprint.negative_marking || 0,
            aiEvaluationEnabled: blueprint.ai_evaluation_enabled,
            aiConfidenceThreshold: blueprint.ai_confidence_threshold || 0.75,
            coreConcepts: [],
            expectedStructure: "",
            weightage: [],
          } : null,
          aiEvaluation: aiEval ? {
            id: aiEval.id,
            answerId: aiEval.answer_id,
            suggestedMarks: aiEval.suggested_marks,
            maxMarks: aiEval.max_marks,
            confidenceScore: aiEval.confidence_score,
            matchedKeywords: aiEval.matched_keywords || [],
            evaluationReasoning: aiEval.evaluation_reasoning || "",
            feedbackSuggestion: aiEval.feedback_suggestion || "",
            requiresTeacherReview: aiEval.requires_teacher_review,
            isAccepted: aiEval.is_accepted,
            modelUsed: aiEval.model_used || "",
          } : null,
          teacherOverride: override ? {
            id: override.id,
            answerId: override.answer_id,
            teacherId: override.evaluated_by,
            teacherName: teacher?.full_name,
            previousMarks: null,
            finalMarks: override.final_marks,
            maxMarks: override.max_marks,
            feedbackToStudent: override.teacher_feedback || "",
            internalNotes: override.internal_notes || "",
            isAiAccepted: override.accepted_ai_suggestion || false,
            reviewedAt: override.evaluated_at,
          } : null,
        };
      });
    },
    enabled: !!attemptId,
  });
}

// Submit teacher override
export function useSubmitOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      answerId,
      finalMarks,
      maxMarks,
      feedbackToStudent,
      internalNotes,
      isAiAccepted,
      previousMarks,
    }: {
      answerId: string;
      finalMarks: number;
      maxMarks: number;
      feedbackToStudent: string;
      internalNotes: string;
      isAiAccepted: boolean;
      previousMarks: number | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if override exists
      const { data: existing } = await supabase
        .from("teacher_overrides")
        .select("id")
        .eq("answer_id", answerId)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from("teacher_overrides")
          .update({
            evaluated_by: user.id,
            final_marks: finalMarks,
            max_marks: maxMarks,
            teacher_feedback: feedbackToStudent,
            internal_notes: internalNotes,
            accepted_ai_suggestion: isAiAccepted,
            evaluated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from("teacher_overrides")
          .insert({
            answer_id: answerId,
            evaluated_by: user.id,
            final_marks: finalMarks,
            max_marks: maxMarks,
            teacher_feedback: feedbackToStudent,
            internal_notes: internalNotes,
            accepted_ai_suggestion: isAiAccepted,
          });

        if (error) throw error;
      }

      // If there's an AI evaluation, mark it as accepted/rejected
      if (isAiAccepted) {
        await supabase
          .from("ai_evaluations")
          .update({ is_accepted: true })
          .eq("answer_id", answerId);
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attempt-answers"] });
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      toast.success("Evaluation saved successfully");
    },
    onError: (error) => {
      toast.error("Failed to save evaluation");
      console.error(error);
    },
  });
}

// Finalize an attempt
export function useFinalizeAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all answers and check they all have teacher overrides
      const { data: answers } = await supabase
        .from("student_answers")
        .select("id")
        .eq("attempt_id", attemptId);

      const { data: overrides } = await supabase
        .from("teacher_overrides")
        .select("answer_id, final_marks, max_marks")
        .in("answer_id", answers?.map(a => a.id) || []);

      if (answers?.length !== overrides?.length) {
        throw new Error("All answers must be reviewed before finalizing");
      }

      // Calculate total marks
      const totalMarks = overrides?.reduce((sum, o) => sum + o.final_marks, 0) || 0;
      const maxMarks = overrides?.reduce((sum, o) => sum + o.max_marks, 0) || 0;
      const percentage = maxMarks > 0 ? (totalMarks / maxMarks) * 100 : 0;

      // Update attempt status
      const { error: attemptError } = await supabase
        .from("student_exam_attempts")
        .update({
          is_finalized: true,
          finalized_at: new Date().toISOString(),
          finalized_by: user.id,
          evaluation_status: "finalized",
        })
        .eq("id", attemptId);

      if (attemptError) throw attemptError;

      // Create final result record
      // Note: percentage is a generated column in the database, computed automatically
      const { error: resultError } = await supabase
        .from("final_results")
        .insert({
          attempt_id: attemptId,
          finalized_by: user.id,
          total_marks_obtained: totalMarks,
          total_max_marks: maxMarks,
          is_pass: percentage >= 33, // Configurable threshold
        });

      if (resultError) throw resultError;

      // Trigger compute-aggregates edge function to update analytics
      try {
        const { data: attempt } = await supabase
          .from("student_exam_attempts")
          .select("exam_id, class_id, exams(institution_id)")
          .eq("id", attemptId)
          .single();

        if (attempt) {
          const examData = attempt.exams as { institution_id: string } | null;
          if (examData?.institution_id) {
            await supabase.functions.invoke("compute-aggregates", {
              body: { 
                exam_id: attempt.exam_id,
                institution_id: examData.institution_id 
              },
            });
          }
        }
      } catch (aggregateError) {
        // Don't fail finalization if aggregate computation fails
        console.warn("Failed to compute aggregates:", aggregateError);
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["class-aggregates"] });
      queryClient.invalidateQueries({ queryKey: ["school-aggregates"] });
      toast.success("Attempt finalized successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to finalize");
      console.error(error);
    },
  });
}

// Publish results to student
export function usePublishResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("final_results")
        .update({
          is_published: true,
          published_at: new Date().toISOString(),
          published_by: user.id,
        })
        .eq("attempt_id", attemptId);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      toast.success("Results published! Student can now view their results.");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to publish results");
      console.error(error);
    },
  });
}

// Accept all AI marks as teacher overrides in one click
export function useAcceptAllAIMarks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all answers for this attempt
      const { data: answers, error: answersError } = await supabase
        .from("student_answers")
        .select("id")
        .eq("attempt_id", attemptId);
      if (answersError) throw answersError;

      const answerIds = answers?.map(a => a.id) || [];
      if (answerIds.length === 0) throw new Error("No answers found");

      // Get AI evaluations
      const { data: aiEvals, error: aiError } = await supabase
        .from("ai_evaluations")
        .select("answer_id, suggested_marks, max_marks, feedback_suggestion")
        .in("answer_id", answerIds);
      if (aiError) throw aiError;
      if (!aiEvals || aiEvals.length === 0) throw new Error("No AI evaluations found");

      // Get existing overrides to skip
      const { data: existingOverrides } = await supabase
        .from("teacher_overrides")
        .select("answer_id")
        .in("answer_id", answerIds);
      const existingAnswerIds = new Set(existingOverrides?.map(o => o.answer_id) || []);

      // Create overrides for AI evals that don't have one yet
      const newOverrides = aiEvals
        .filter(e => !existingAnswerIds.has(e.answer_id))
        .map(e => ({
          answer_id: e.answer_id,
          evaluated_by: user.id,
          final_marks: e.suggested_marks,
          max_marks: e.max_marks,
          teacher_feedback: e.feedback_suggestion || "",
          internal_notes: "Accepted AI suggestion",
          accepted_ai_suggestion: true,
        }));

      if (newOverrides.length > 0) {
        const { error: insertError } = await supabase
          .from("teacher_overrides")
          .insert(newOverrides);
        if (insertError) throw insertError;
      }

      // Mark AI evaluations as accepted
      await supabase
        .from("ai_evaluations")
        .update({ is_accepted: true })
        .in("answer_id", answerIds);

      // Update attempt evaluation status
      await supabase
        .from("student_exam_attempts")
        .update({ evaluation_status: "teacher_reviewed" })
        .eq("id", attemptId);

      return { accepted: newOverrides.length, alreadyOverridden: existingAnswerIds.size };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["attempt-answers"] });
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["exam-results-students"] });
      toast.success(`Accepted AI marks for ${data.accepted} answers`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to accept AI marks");
      console.error(error);
    },
  });
}
