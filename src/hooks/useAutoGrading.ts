import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useState, useEffect } from "react";

export interface GradingProgress {
  examId: string;
  examTitle: string;
  totalAttempts: number;
  gradedAttempts: number;
  totalQuestions: number;
  gradedQuestions: number;
  estimatedTimeMinutes: number;
  status: "pending" | "grading" | "completed" | "error";
  startedAt?: string;
  completedAt?: string;
}

// Fetch grading progress for an exam
export function useGradingProgress(examId: string | null) {
  const [progress, setProgress] = useState<GradingProgress | null>(null);

  useEffect(() => {
    if (!examId) {
      setProgress(null);
      return;
    }

    const fetchProgress = async () => {
      // Get exam info
      const { data: exam } = await supabase
        .from("exams")
        .select("id, title, total_marks")
        .eq("id", examId)
        .single();

      if (!exam) return;

      // Get all attempts for this exam
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id, is_submitted, is_finalized, evaluation_status")
        .eq("exam_id", examId)
        .eq("is_submitted", true);

      if (!attempts) return;

      // Count graded vs total
      const totalAttempts = attempts.length;
      const gradedAttempts = attempts.filter(a => 
        a.evaluation_status === "finalized" || a.is_finalized
      ).length;

      // Get question counts
      const { data: sections } = await supabase
        .from("exam_sections")
        .select("id")
        .eq("exam_id", examId);

      const sectionIds = sections?.map(s => s.id) || [];

      const { count: totalQuestions } = await supabase
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .in("section_id", sectionIds);

      // Estimate grading: ~2 seconds per question per attempt for AI, ~10 seconds for subjective
      const estimatedTimeSeconds = (totalQuestions || 0) * (totalAttempts - gradedAttempts) * 3;
      const estimatedTimeMinutes = Math.ceil(estimatedTimeSeconds / 60);

      setProgress({
        examId,
        examTitle: exam.title,
        totalAttempts,
        gradedAttempts,
        totalQuestions: totalQuestions || 0,
        gradedQuestions: 0, // Would need to calculate from answers
        estimatedTimeMinutes,
        status: gradedAttempts === totalAttempts ? "completed" : gradedAttempts > 0 ? "grading" : "pending",
      });
    };

    fetchProgress();

    // Poll every 10 seconds while grading
    const interval = setInterval(fetchProgress, 10000);
    return () => clearInterval(interval);
  }, [examId]);

  return progress;
}

// Auto-grade an entire exam
export function useAutoGradeExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (examId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get all submitted attempts that haven't been graded
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id")
        .eq("exam_id", examId)
        .eq("is_submitted", true)
        .neq("evaluation_status", "finalized");

      if (!attempts || attempts.length === 0) {
        return { success: true, message: "No attempts to grade", gradedCount: 0 };
      }

      // Call the edge function for each attempt
      let gradedCount = 0;
      let errorCount = 0;

      for (const attempt of attempts) {
        try {
          const { error } = await supabase.functions.invoke("auto-grade-submission", {
            body: { attempt_id: attempt.id, grader_id: user.id },
          });

          if (error) {
            console.error("Auto-grade error for attempt:", attempt.id, error);
            errorCount++;
          } else {
            gradedCount++;
          }
        } catch (err) {
          console.error("Failed to invoke auto-grade:", err);
          errorCount++;
        }
      }

      return { success: true, gradedCount, errorCount };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["grading-progress"] });
      queryClient.invalidateQueries({ queryKey: ["exam-checking-stats"] });
      // Exam results report page: refresh the student list, KPI cards and
      // analytics so evaluation results appear without a manual reload.
      queryClient.invalidateQueries({ queryKey: ["exam-results-students"] });
      queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
      queryClient.invalidateQueries({ queryKey: ["exam-window-status"] });
      queryClient.invalidateQueries({ queryKey: ["attempt-answers"] });
      if (data.errorCount && data.errorCount > 0 && !data.gradedCount) {
        toastError(new Error("All attempts failed to auto-grade"), {
          fallback: "AI evaluation failed. Please try again in a moment.",
          context: "autoGradeExam",
        });
      } else if (data.errorCount && data.errorCount > 0) {
        toast.success(`Auto-grading complete! ${data.gradedCount} processed, ${data.errorCount} errors.`);
      } else {
        toast.success(`Auto-grading complete! ${data.gradedCount || 0} attempts processed.`);
      }
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Auto-grading failed.", context: "autoGradeExam" });
    },
  });
}

// Auto-grade a single attempt (for use on submission)
export function useAutoGradeAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (attemptId: string) => {
      const { data, error } = await supabase.functions.invoke("auto-grade-submission", {
        body: { attempt_id: attemptId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      // Keep the exam results report in sync after a single-attempt AI pass.
      queryClient.invalidateQueries({ queryKey: ["exam-results-students"] });
      queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
    },
    onError: (error: Error) => {
      console.error("Auto-grade attempt failed:", error);
      // Don't show toast - this runs automatically on submission
    },
  });
}

// Finalize and publish all graded attempts for an exam
export function useBulkPublishResults() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (examId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if exam window is closed and no active students
      const { data: exam } = await supabase
        .from("exams")
        .select("end_time")
        .eq("id", examId)
        .single();

      if (exam?.end_time && new Date(exam.end_time) > new Date()) {
        throw new Error("Cannot publish: Exam window is still active");
      }

      const { count: activeCount } = await supabase
        .from("student_exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("is_submitted", false);

      if ((activeCount || 0) > 0) {
        throw new Error(`Cannot publish: ${activeCount} student(s) are still taking the exam`);
      }

      // Get all finalized attempts without published results
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id, student_id")
        .eq("exam_id", examId)
        .eq("is_finalized", true);

      if (!attempts || attempts.length === 0) {
        throw new Error("No finalized attempts to publish");
      }

      let publishedCount = 0;

      for (const attempt of attempts) {
        // Check if result exists
        const { data: existingResult } = await supabase
          .from("final_results")
          .select("id, is_published")
          .eq("attempt_id", attempt.id)
          .maybeSingle();

        if (existingResult && !existingResult.is_published) {
          await supabase
            .from("final_results")
            .update({
              is_published: true,
              published_at: new Date().toISOString(),
              published_by: user.id,
            })
            .eq("id", existingResult.id);
          publishedCount++;
          
          // Trigger AI learning action generation for this student
          try {
            console.log("Triggering learning actions for student:", attempt.student_id);
            await supabase.functions.invoke("generate-learning-actions", {
              body: {
                attempt_id: attempt.id,
                exam_id: examId,
                student_id: attempt.student_id,
              },
            });
          } catch (err) {
            console.error("Failed to generate learning actions:", err);
            // Don't fail the publish if learning actions fail
          }
        }
      }

      return { success: true, publishedCount };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pending-evaluations"] });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      queryClient.invalidateQueries({ queryKey: ["learning-actions"] });
      queryClient.invalidateQueries({ queryKey: ["exam-checking-stats"] });
      toast.success(`Published ${data.publishedCount} results and generated learning actions!`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to publish results");
    },
  });
}