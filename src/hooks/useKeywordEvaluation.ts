import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { evaluateWithKeywords, supportsKeywordEvaluation, type AutoGradeResult } from "@/utils/autoGrading";

interface EvaluationConfig {
  keywords: string[];
  coreConcepts?: string[];
  maxMarks: number;
  partialMarkingAllowed?: boolean;
  minKeywordsForFullMarks?: number;
}

interface AnswerToEvaluate {
  answerId: string;
  studentAnswer: string;
  questionType: string;
  config: EvaluationConfig;
}

/**
 * Hook for keyword-based evaluation of subjective answers
 * Supports: short_answer, long_answer, case_study, comprehension
 */
export function useKeywordEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (answer: AnswerToEvaluate) => {
      // Only evaluate supported question types
      if (!supportsKeywordEvaluation(answer.questionType)) {
        return null;
      }

      // Perform keyword evaluation
      const result = evaluateWithKeywords(answer.studentAnswer, answer.config);

      // Store the AI evaluation result
      const { error: evalError } = await supabase
        .from("ai_evaluations")
        .upsert({
          answer_id: answer.answerId,
          suggested_marks: result.marksAwarded,
          max_marks: result.maxMarks,
          confidence_score: result.confidenceScore || 0,
          matched_keywords: result.keywordsMatched || [],
          feedback_suggestion: result.feedback,
          evaluation_reasoning: `Keyword matching: ${result.keywordsMatched?.length || 0}/${answer.config.keywords.length} keywords found`,
          requires_teacher_review: (result.confidenceScore || 0) < 0.7,
          model_used: "keyword_matching",
          evaluation_metadata: {
            missed_keywords: result.keywordsMissed,
            core_concepts: answer.config.coreConcepts,
          },
        }, { onConflict: "answer_id" });

      if (evalError) {
        console.error("Failed to store evaluation:", evalError);
      }

      return result;
    },
    onError: (error: Error) => {
      console.error("Keyword evaluation error:", error);
    },
  });
}

/**
 * Batch keyword evaluation for offline answer sheets
 * Evaluates all subjective questions in an attempt
 */
export function useBatchKeywordEvaluation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      // Fetch all answers for this attempt with their question blueprints
      const { data: answers, error: answersError } = await supabase
        .from("student_answers")
        .select(`
          id,
          answer_text,
          question_id,
          exam_questions!inner (
            id,
            question_type,
            marks,
            tags,
            correct_answer
          )
        `)
        .eq("attempt_id", attemptId);

      if (answersError) throw answersError;
      if (!answers || answers.length === 0) {
        return { evaluated: 0, total: 0, results: [] };
      }

      // Fetch evaluation blueprints for keywords
      const questionIds = answers.map(a => a.question_id);
      const { data: blueprints } = await supabase
        .from("evaluation_blueprints")
        .select("*")
        .in("question_id", questionIds);

      const blueprintMap = new Map(blueprints?.map(b => [b.question_id, b]) || []);

      const results: Array<{
        answerId: string;
        questionId: string;
        result: AutoGradeResult;
      }> = [];

      for (const answer of answers) {
        const question = answer.exam_questions as {
          id: string;
          question_type: string;
          marks: number;
          tags: string[] | null;
          correct_answer: string | null;
        };

        // Only evaluate subjective questions
        if (!supportsKeywordEvaluation(question.question_type)) continue;

        // Get keywords from blueprint or question tags
        const blueprint = blueprintMap.get(question.id);
        const keywords = blueprint?.keywords || question.tags || [];

        if (keywords.length === 0) {
          // No keywords defined - skip auto-evaluation
          continue;
        }

        const studentAnswer = answer.answer_text || "";
        const result = evaluateWithKeywords(studentAnswer, {
          keywords,
          maxMarks: question.marks,
          partialMarkingAllowed: blueprint?.partial_marking_allowed ?? true,
        });

        // Store AI evaluation
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
            requires_teacher_review: (result.confidenceScore || 0) < 0.7,
            model_used: "keyword_matching",
            evaluation_metadata: {
              missed_keywords: result.keywordsMissed,
              answer_source: "offline",
            },
          }, { onConflict: "answer_id" });

        results.push({
          answerId: answer.id,
          questionId: question.id,
          result,
        });
      }

      return {
        evaluated: results.length,
        total: answers.length,
        results,
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      
      if (data.evaluated > 0) {
        toast.success(`Evaluated ${data.evaluated} subjective answers`);
      }
    },
    onError: (error: Error) => {
      console.error("Batch evaluation error:", error);
      toast.error("Failed to evaluate answers");
    },
  });
}

/**
 * Hook to fetch AI evaluation for an answer
 */
export function useAIEvaluation(answerId: string | null) {
  return {
    queryKey: ["ai-evaluation", answerId],
    queryFn: async () => {
      if (!answerId) return null;

      const { data, error } = await supabase
        .from("ai_evaluations")
        .select("*")
        .eq("answer_id", answerId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!answerId,
  };
}
