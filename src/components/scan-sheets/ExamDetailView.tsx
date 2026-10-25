import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Camera,
  Sparkles,
  Send,
  Users,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StudentScoreTable } from "./StudentScoreTable";
import { MarkInterventionDialog } from "./MarkInterventionDialog";
import { BulkEvaluateProgress } from "./BulkEvaluateProgress";
import { ScanAnswerSheetsModal } from "@/components/offline-scan";
import {
  useExamStudentsWithScores,
  useBulkAIEvaluate,
  usePublishOfflineResults,
} from "@/hooks/useScanSheetsData";
import { supabase } from "@/integrations/supabase/client";
import { openExternal } from "@/lib/native";

interface ExamDetailViewProps {
  examId: string;
  classId: string;
  examTitle: string;
  className: string;
  onBack: () => void;
}

interface StudentWithScore {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  admission_number: string | null;
  scan_status: "not_scanned" | "pending_ocr" | "ocr_complete" | "ai_graded" | "teacher_reviewed";
  upload_id: string | null;
  attempt_id: string | null;
  ai_score: number | null;
  max_marks: number | null;
  avg_confidence: number | null;
  is_finalized: boolean;
}

export function ExamDetailView({
  examId,
  classId,
  examTitle,
  className,
  onBack,
}: ExamDetailViewProps) {
  const { data: students, isLoading } = useExamStudentsWithScores(examId, classId);
  const bulkEvaluate = useBulkAIEvaluate();
  const publishResults = usePublishOfflineResults();

  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [evaluateProgressOpen, setEvaluateProgressOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentWithScore | null>(null);
  const [interventionOpen, setInterventionOpen] = useState(false);

  // Calculate stats
  const stats = {
    total: students?.length || 0,
    scanned: students?.filter((s) => s.scan_status !== "not_scanned").length || 0,
    evaluated: students?.filter(
      (s) => s.scan_status === "ai_graded" || s.scan_status === "teacher_reviewed"
    ).length || 0,
    finalized: students?.filter((s) => s.is_finalized).length || 0,
  };

  const canEvaluate = stats.scanned > 0 && stats.scanned > stats.evaluated;
  const canPublish = stats.evaluated > 0 && stats.evaluated === stats.scanned;

  const handleViewSheet = async (uploadId: string) => {
    const { data } = await supabase
      .from("ocr_uploads")
      .select("file_url")
      .eq("id", uploadId)
      .single();

    if (data?.file_url) {
      openExternal(data.file_url);
    }
  };

  const handleEditMarks = (student: StudentWithScore) => {
    setSelectedStudent(student);
    setInterventionOpen(true);
  };

  const handleBulkEvaluate = () => {
    setEvaluateProgressOpen(true);
    bulkEvaluate.mutate({ examId, classId });
  };

  const handlePublish = async () => {
    publishResults.mutate({ examId, classId }, {
      onSuccess: async () => {
        // Send results_available notifications to students who have attempts
        try {
          const { data: attempts } = await supabase
            .from("student_exam_attempts")
            .select("student_id")
            .eq("exam_id", examId)
            .eq("is_submitted", true);

          if (attempts && attempts.length > 0) {
            const uniqueStudentIds = [...new Set(attempts.map((a) => a.student_id))];
            const notifications = uniqueStudentIds.map((studentId) => ({
              user_id: studentId,
              type: "results_available",
              title: "Results Available",
              message: `Results for "${examTitle}" are now available. Check your performance report.`,
              link: "/exams",
              metadata: { exam_id: examId },
            }));

            await supabase.from("notifications").insert(notifications);
          }
        } catch (e) {
          console.error("Failed to send results_available notifications:", e);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{examTitle}</h2>
            <p className="text-muted-foreground">{className}</p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setScanModalOpen(true)} variant="outline" className="gap-2">
          <Camera className="h-4 w-4" />
          Scan More Sheets
        </Button>
        <Button
          onClick={handleBulkEvaluate}
          disabled={!canEvaluate || bulkEvaluate.isPending}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Evaluate by AI
        </Button>
        <Button
          onClick={handlePublish}
          disabled={!canPublish || publishResults.isPending}
          variant="default"
          className="gap-2 bg-green-600 hover:bg-green-700"
        >
          <Send className="h-4 w-4" />
          {publishResults.isPending ? "Publishing..." : "Publish Results"}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Students"
          value={stats.total}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          title="Sheets Scanned"
          value={stats.scanned}
          icon={<Camera className="h-4 w-4" />}
          variant={stats.scanned === stats.total ? "green" : "amber"}
        />
        <StatCard
          title="AI Evaluated"
          value={stats.evaluated}
          icon={<Sparkles className="h-4 w-4" />}
          variant={stats.evaluated === stats.scanned ? "green" : "blue"}
        />
        <StatCard
          title="Finalized"
          value={stats.finalized}
          icon={<CheckCircle2 className="h-4 w-4" />}
          variant={stats.finalized === stats.total ? "green" : "default"}
        />
      </div>

      {/* Students Table */}
      {students && students.length > 0 ? (
        <StudentScoreTable
          students={students}
          onViewSheet={handleViewSheet}
          onEditMarks={handleEditMarks}
        />
      ) : (
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium text-lg">No Students Found</h3>
            <p className="text-muted-foreground mt-1">
              No students are assigned to this class.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Scan Modal */}
      <ScanAnswerSheetsModal
        open={scanModalOpen}
        onOpenChange={setScanModalOpen}
        preSelectedExamId={examId}
        preSelectedClassId={classId}
      />

      {/* Bulk Evaluate Progress */}
      <BulkEvaluateProgress
        open={evaluateProgressOpen}
        onOpenChange={setEvaluateProgressOpen}
        isPending={bulkEvaluate.isPending}
        isSuccess={bulkEvaluate.isSuccess}
        isError={bulkEvaluate.isError}
        errorMessage={bulkEvaluate.error?.message}
        results={bulkEvaluate.data}
      />

      {/* Mark Intervention Dialog */}
      <MarkInterventionDialog
        student={selectedStudent}
        open={interventionOpen}
        onOpenChange={setInterventionOpen}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  variant = "default",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "green" | "amber" | "blue";
}) {
  const colors = {
    default: "text-foreground",
    green: "text-green-600",
    amber: "text-amber-600",
    blue: "text-blue-600",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colors[variant]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
