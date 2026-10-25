import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { autoGradeQuestion, isAutoGradable, evaluateWithKeywords, supportsKeywordEvaluation } from "@/utils/autoGrading";

interface AnswerToGrade {
  answerId: string;
  questionId: string;
  questionType: string;
  studentAnswer: string | Record<string, unknown> | null | undefined;
  correctAnswer: string | null;
  options: Record<string, unknown> | null;
  maxMarks: number;
  negativeMarks?: number;
}

/**
 * Hook to auto-grade objective questions on exam submit
 */
export function useAutoGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      // 1. Get all answers for this attempt
      const { data: answers, error: answersError } = await supabase
        .from("student_answers")
        .select(`
          id,
          question_id,
          answer_text,
          answer_options,
          exam_questions!inner (
            id,
            question_type,
            marks,
            negative_marks,
            correct_answer,
            options,
            tags
          )
        `)
        .eq("attempt_id", attemptId);

      if (answersError) throw answersError;
      if (!answers || answers.length === 0) {
        return { autoGraded: 0, total: 0 };
      }

      // 2. Filter to auto-gradable questions and grade them
      const gradedAnswers: Array<{
        answerId: string;
        finalMarks: number;
        maxMarks: number;
        feedback: string;
        isCorrect: boolean;
      }> = [];

      for (const answer of answers) {
        const question = answer.exam_questions as {
          id: string;
          question_type: string;
          marks: number;
          negative_marks: number | null;
          correct_answer: string | null;
          options: Record<string, unknown> | null;
          tags: string[] | null;
        };

        const studentAnswer = answer.answer_text || answer.answer_options as string | Record<string, unknown> | null;

        // Auto-grade objective questions
        if (isAutoGradable(question.question_type)) {
          const result = autoGradeQuestion(
            question.question_type,
            studentAnswer,
            question.correct_answer,
            question.options as Record<string, unknown> | null,
            question.marks,
            question.negative_marks || 0
          );

          if (result) {
            gradedAnswers.push({
              answerId: answer.id,
              finalMarks: Math.max(0, result.marksAwarded),
              maxMarks: result.maxMarks,
              feedback: result.feedback,
              isCorrect: result.isCorrect,
            });
          }
        }
        // Keyword evaluation for subjective questions
        else if (supportsKeywordEvaluation(question.question_type)) {
          const keywords = question.tags || [];
          if (keywords.length > 0 && typeof studentAnswer === "string" && studentAnswer.trim()) {
            const result = evaluateWithKeywords(studentAnswer, {
              keywords,
              maxMarks: question.marks,
              partialMarkingAllowed: true,
            });

            // Store as AI evaluation (requires teacher review)
            await supabase
              .from("ai_evaluations")
              .upsert({
                answer_id: answer.id,
                suggested_marks: result.marksAwarded,
                max_marks: result.maxMarks,
                confidence_score: result.confidenceScore || 0,
                matched_keywords: result.keywordsMatched || [],
                feedback_suggestion: result.feedback,
                evaluation_reasoning: `Keyword matching: ${result.keywordsMatched?.length || 0}/${keywords.length} keywords found`,
                requires_teacher_review: true, // Always require review for subjective
                model_used: "keyword_matching",
              }, { onConflict: "answer_id" });
          }
        }
      }

      // 3. Insert teacher_overrides for auto-graded answers
      if (gradedAnswers.length > 0) {
        const overrides = gradedAnswers.map((g) => ({
          answer_id: g.answerId,
          evaluated_by: null, // System auto-grade
          final_marks: g.finalMarks,
          max_marks: g.maxMarks,
          teacher_feedback: g.feedback,
          internal_notes: "Auto-graded by system",
          is_auto_graded: true,
          accepted_ai_suggestion: false,
        }));

        const { error: overrideError } = await supabase
          .from("teacher_overrides")
          .upsert(overrides, { onConflict: "answer_id" });

        if (overrideError) {
          console.error("Failed to insert auto-grade overrides:", overrideError);
          // Don't throw - continue with submit even if grading fails
        }
      }

      return {
        autoGraded: gradedAnswers.length,
        total: answers.length,
        correct: gradedAnswers.filter((g) => g.isCorrect).length,
      };
    },
    onSuccess: (data) => {
      if (data.autoGraded > 0) {
        queryClient.invalidateQueries({ queryKey: ["attempt-answers"] });
        queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      }
    },
    onError: (error) => {
      console.error("Auto-grade error:", error);
      // Don't show error to user - auto-grading is optional
    },
  });
}

/**
 * Hook to manually trigger auto-grading for a specific answer
 */
export function useAutoGradeAnswer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: AnswerToGrade) => {
      if (!isAutoGradable(params.questionType)) {
        return null;
      }

      const result = autoGradeQuestion(
        params.questionType,
        params.studentAnswer,
        params.correctAnswer,
        params.options,
        params.maxMarks,
        params.negativeMarks || 0
      );

      if (!result) return null;

      // Insert/update teacher override
      const { error } = await supabase
        .from("teacher_overrides")
        .upsert({
          answer_id: params.answerId,
          evaluated_by: null,
          final_marks: Math.max(0, result.marksAwarded),
          max_marks: result.maxMarks,
          teacher_feedback: result.feedback,
          internal_notes: "Auto-graded by system",
          is_auto_graded: true,
          accepted_ai_suggestion: false,
        }, { onConflict: "answer_id" });

      if (error) throw error;

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attempt-answers"] });
    },
  });
}
