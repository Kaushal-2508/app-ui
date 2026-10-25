import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { EvaluationWorkspace } from "@/components/evaluation/EvaluationWorkspace";
import { getDisplayName } from "@/lib/displayName";
import { formatStudentIdLine } from "@/lib/studentIdentity";

export default function EvaluateAttemptPage() {
  const { examId, attemptId } = useParams<{ examId: string; attemptId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const readOnly = searchParams.get("readonly") === "true";

  const { data: attemptInfo, isLoading } = useQuery({
    queryKey: ["evaluate-attempt-info", attemptId],
    queryFn: async () => {
      if (!attemptId) return null;
      const { data, error } = await supabase
        .from("student_exam_attempts")
        .select(`
          id,
          student_id,
          exam_id,
          profiles!student_exam_attempts_student_id_fkey (full_name, roll_number, admission_number),
          exams!inner (title, exam_mode)
        `)
        .eq("id", attemptId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!attemptId,
  });

  if (!examId || !attemptId) {
    return <div className="text-center py-12 text-muted-foreground">Invalid parameters</div>;
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  const examData = attemptInfo?.exams as { title: string; exam_mode: string } | null;
  const studentData = attemptInfo?.profiles as {
    full_name: string;
    roll_number: string | null;
    admission_number: string | null;
  } | null;

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      <EvaluationWorkspace
        attemptId={attemptId}
        studentName={getDisplayName(studentData)}
        studentIdLine={formatStudentIdLine(studentData?.roll_number, studentData?.admission_number)}
        examTitle={examData?.title || "Exam"}
        isOffline={examData?.exam_mode === "offline"}
        readOnly={readOnly}
        fullPage
        onComplete={() => navigate(`/exams/${examId}/results`)}
      />
    </div>
  );
}
