import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffectiveInstitution } from "./useEffectiveInstitution";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export interface RecheckRequestAdmin {
  id: string;
  resultId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  examId: string;
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
  resolverName: string | null;
  resolutionNotes: string | null;
  marksChanged: boolean | null;
  className: string | null;
}

export function useInstitutionRechecks() {
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: ["institution-rechecks", effectiveInstitutionId],
    queryFn: async (): Promise<RecheckRequestAdmin[]> => {
      if (!effectiveInstitutionId) return [];

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
          requested_by,
          exam_questions(question_text, question_order),
          final_results!inner(
            attempt_id,
            student_exam_attempts!inner(
              exam_id,
              student_id,
              exams!inner(title, institution_id)
            )
          )
        `)
        .order("requested_at", { ascending: false });

      if (error) throw error;

      // Filter by institution and fetch student details
      const institutionRechecks = (data || []).filter((r: any) => {
        const exam = r.final_results?.student_exam_attempts?.exams;
        return exam?.institution_id === effectiveInstitutionId;
      });

      // Fetch student profiles
      const studentIds = [...new Set(institutionRechecks.map((r: any) => 
        r.final_results?.student_exam_attempts?.student_id
      ).filter(Boolean))];

      const resolverIds = [...new Set(institutionRechecks.map((r: any) => r.resolved_by).filter(Boolean))];

      const { data: students } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", studentIds.length > 0 ? studentIds : ['none']);

      const { data: resolvers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", resolverIds.length > 0 ? resolverIds : ['none']);

      // Fetch class assignments for students
      const { data: classAssignments } = await supabase
        .from("class_assignments")
        .select("user_id, classes(name, section)")
        .eq("role", "student")
        .in("user_id", studentIds.length > 0 ? studentIds : ['none']);

      const studentMap = new Map((students || []).map(s => [s.id, s]));
      const resolverMap = new Map((resolvers || []).map(r => [r.id, r]));
      const classMap = new Map((classAssignments || []).map((ca: any) => [
        ca.user_id,
        ca.classes ? formatClassName(ca.classes.name, ca.classes.section) : null
      ]));

      return institutionRechecks.map((r: any) => {
        const attempt = r.final_results?.student_exam_attempts;
        const exam = attempt?.exams;
        const question = r.exam_questions;
        const studentId = attempt?.student_id;
        const student = studentMap.get(studentId);
        const resolver = resolverMap.get(r.resolved_by);

        return {
          id: r.id,
          resultId: r.result_id,
          studentId: studentId || "",
          studentName: getDisplayName(student),
          studentEmail: student?.email || "",
          examId: attempt?.exam_id || "",
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
          resolverName: resolver?.full_name || null,
          resolutionNotes: r.resolution_notes,
          marksChanged: r.marks_changed,
          className: classMap.get(studentId) || null,
        };
      });
    },
    enabled: !!effectiveInstitutionId,
  });
}

export function useResolveRecheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recheckId,
      status,
      newMarks,
      resolutionNotes,
    }: {
      recheckId: string;
      status: "completed" | "rejected";
      newMarks?: number | null;
      resolutionNotes?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get current recheck to know previous marks
      const { data: recheck, error: fetchError } = await supabase
        .from("recheck_requests")
        .select("previous_marks")
        .eq("id", recheckId)
        .single();

      if (fetchError) throw fetchError;

      const marksChanged = status === "completed" && 
        newMarks !== undefined && 
        newMarks !== null && 
        newMarks !== recheck.previous_marks;

      const { error } = await supabase
        .from("recheck_requests")
        .update({
          status,
          new_marks: newMarks ?? null,
          resolution_notes: resolutionNotes || null,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          marks_changed: marksChanged,
        })
        .eq("id", recheckId);

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-rechecks"] });
      toast.success("Recheck request resolved");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to resolve recheck");
    },
  });
}
