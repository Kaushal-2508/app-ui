import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type RemarkCategory = "exam" | "topic" | "behaviour" | "improvement" | "general";

export interface StudentRemark {
  id: string;
  student_id: string;
  teacher_id: string;
  institution_id: string;
  exam_id: string | null;
  subject_id: string | null;
  category: RemarkCategory;
  remark_text: string;
  created_at: string;
  updated_at: string;
  teacher?: { full_name: string };
  subject?: { name: string } | null;
  exam?: { title: string } | null;
}

export function useStudentRemarks(studentId: string | null) {
  return useQuery({
    queryKey: ["student-remarks", studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const { data, error } = await supabase
        .from("student_remarks")
        .select(`
          *,
          teacher:profiles!student_remarks_teacher_id_fkey(full_name),
          subject:universal_subjects!student_remarks_subject_id_fkey(name),
          exam:exams!student_remarks_exam_id_fkey(title)
        `)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as StudentRemark[];
    },
    enabled: !!studentId,
  });
}

export function useExamRemarks(examId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ["exam-remarks", examId, studentId],
    queryFn: async () => {
      if (!examId || !studentId) return [];
      const { data, error } = await supabase
        .from("student_remarks")
        .select(`
          *,
          teacher:profiles!student_remarks_teacher_id_fkey(full_name)
        `)
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as StudentRemark[];
    },
    enabled: !!examId && !!studentId,
  });
}

interface CreateRemarkParams {
  studentId: string;
  institutionId: string;
  examId?: string;
  subjectId?: string;
  category: RemarkCategory;
  remarkText: string;
}

export function useCreateRemark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateRemarkParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("student_remarks")
        .insert({
          student_id: params.studentId,
          teacher_id: user.id,
          institution_id: params.institutionId,
          exam_id: params.examId || null,
          subject_id: params.subjectId || null,
          category: params.category,
          remark_text: params.remarkText,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: ["student-remarks", params.studentId] });
      queryClient.invalidateQueries({ queryKey: ["exam-remarks"] });
      toast.success("Remark added successfully");
    },
    onError: (error) => {
      toast.error(`Failed to add remark: ${error.message}`);
    },
  });
}
