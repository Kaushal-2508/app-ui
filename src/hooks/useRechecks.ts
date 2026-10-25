import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface RecheckRequest {
  id: string;
  resultId: string;
  examTitle: string;
  questionId: string | null;
  questionNumber: number | null;
  questionText: string | null;
  requestReason: string;
  status: "pending" | "completed" | "rejected";
  requestedAt: string;
  previousMarks: number | null;
  newMarks: number | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  marksChanged: boolean | null;
}

export interface StudentResult {
  resultId: string;
  examId: string;
  examTitle: string;
  attemptId: string;
  totalMarks: number;
  maxMarks: number;
  percentage: number;
  isPublished: boolean;
}

export function useStudentRechecks() {
  return useQuery({
    queryKey: ["student-rechecks"],
    queryFn: async (): Promise<RecheckRequest[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("recheck_requests")
        .select(`
          id,
          result_id,
          question_id,
          request_reason,
          status,
          requested_at,
          previous_marks,
          new_marks,
          resolved_at,
          resolved_by,
          resolution_notes,
          marks_changed,
          exam_questions(question_text, question_order),
          final_results!inner(
            attempt_id,
            student_exam_attempts!inner(
              exam_id,
              exams(title)
            )
          )
        `)
        .eq("requested_by", user.id)
        .order("requested_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((r: any) => {
        const attempt = r.final_results?.student_exam_attempts;
        const exam = attempt?.exams;
        const question = r.exam_questions;

        return {
          id: r.id,
          resultId: r.result_id,
          examTitle: exam?.title || "Unknown Exam",
          questionId: r.question_id,
          questionNumber: question?.question_order || null,
          questionText: question?.question_text || null,
          requestReason: r.request_reason,
          status: r.status as "pending" | "completed" | "rejected",
          requestedAt: r.requested_at,
          previousMarks: r.previous_marks,
          newMarks: r.new_marks,
          resolvedAt: r.resolved_at,
          resolvedBy: r.resolved_by,
          resolutionNotes: r.resolution_notes,
          marksChanged: r.marks_changed,
        };
      });
    },
  });
}

export function useStudentPublishedResults() {
  return useQuery({
    queryKey: ["student-published-results"],
    queryFn: async (): Promise<StudentResult[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("final_results")
        .select(`
          id,
          attempt_id,
          total_marks_obtained,
          total_max_marks,
          percentage,
          is_published,
          student_exam_attempts!inner(
            exam_id,
            student_id,
            exams(title)
          )
        `)
        .eq("is_published", true)
        // Server-side student scope. Filtering client-side pulled EVERY
        // published final_results row visible to the caller (silently capped
        // at 1000) just to keep this student's few — during a results-publish
        // rush that's an institution-wide scan per student view (§23).
        .eq("student_exam_attempts.student_id", user.id)
        .limit(200);

      if (error) throw error;

      return (data || [])
        .map((r: any) => ({
          resultId: r.id,
          examId: r.student_exam_attempts?.exam_id,
          examTitle: r.student_exam_attempts?.exams?.title || "Unknown Exam",
          attemptId: r.attempt_id,
          totalMarks: r.total_marks_obtained,
          maxMarks: r.total_max_marks,
          percentage: r.percentage,
          isPublished: r.is_published,
        }));
    },
  });
}

export function useSubmitRecheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      resultId,
      questionId,
      reason,
    }: {
      resultId: string;
      questionId?: string | null;
      reason: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Check if there's already a pending recheck for this result/question
      const { data: existing } = await supabase
        .from("recheck_requests")
        .select("id")
        .eq("result_id", resultId)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        throw new Error("You already have a pending recheck request for this exam");
      }

      const { error } = await supabase.from("recheck_requests").insert({
        result_id: resultId,
        question_id: questionId || null,
        request_reason: reason,
        requested_by: user.id,
        status: "pending",
      });

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-rechecks"] });
      toast.success("Recheck request submitted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to submit recheck request");
    },
  });
}
