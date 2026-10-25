import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Clock,
  Play,
  Send,
  FileCheck,
  Loader2,
  AlertTriangle,
  Users,
  Bot,
  Sparkles,
  Ban,
} from "lucide-react";
import { useAutoGradeExam, useBulkPublishResults, useGradingProgress } from "@/hooks/useAutoGrading";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { ExamWindowStatus, useCanPublishResults } from "./ExamWindowStatus";

interface ExamCheckingDashboardProps {
  examMode: "online" | "offline";
}

export function ExamCheckingDashboard({ examMode }: ExamCheckingDashboardProps) {
  const [selectedExamId, setSelectedExamId] = useState("");
  const autoGrade = useAutoGradeExam();
  const bulkPublish = useBulkPublishResults();
  const gradingProgress = useGradingProgress(selectedExamId);
  const publishStatus = useCanPublishResults(selectedExamId || null);

  // Fetch exams based on mode.
  //
  // institution_id is filtered explicitly rather than left to RLS alone, and the
  // list is bounded: PostgREST silently truncates an unranged select at 1000
  // rows, and Alliance alone has 800+ exams, so the oldest would simply vanish
  // from the picker with no error (CLAUDE.md 23).
  const { institutionId } = useEffectiveInstitution();
  const { data: exams, isLoading: examsLoading, error: examsError } = useQuery({
    queryKey: ["exams-for-checking", examMode, institutionId],
    enabled: !!institutionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select("id, title, scheduled_date, status")
        .eq("institution_id", institutionId as string)
        .eq("exam_mode", examMode)
        .in("status", ["published", "active", "completed"])
        .order("scheduled_date", { ascending: false })
        .range(0, 1999);

      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  // Fetch detailed stats for selected exam
  const { data: examStats, isLoading: statsLoading } = useQuery({
    queryKey: ["exam-checking-stats", selectedExamId],
    queryFn: async () => {
      if (!selectedExamId) return null;

      // Get attempts
      const { data: attempts } = await supabase
        .from("student_exam_attempts")
        .select("id, is_submitted, is_finalized, evaluation_status")
        .eq("exam_id", selectedExamId)
        .eq("is_submitted", true);

      // Get results
      const { data: results } = await supabase
        .from("final_results")
        .select("id, is_published, attempt_id")
        .in("attempt_id", attempts?.map(a => a.id) || []);

      const totalSubmissions = attempts?.length || 0;
      const pendingGrading = attempts?.filter(a => 
        a.evaluation_status === "pending" || a.evaluation_status === "ai_evaluated"
      ).length || 0;
      const finalized = attempts?.filter(a => a.is_finalized).length || 0;
      const published = results?.filter(r => r.is_published).length || 0;

      return {
        totalSubmissions,
        pendingGrading,
        finalized,
        published,
        readyToPublish: finalized - published,
      };
    },
    enabled: !!selectedExamId,
  });

  const handleStartAutoGrade = () => {
    if (selectedExamId) {
      autoGrade.mutate(selectedExamId);
    }
  };

  const handlePublishAll = () => {
    if (selectedExamId) {
      bulkPublish.mutate(selectedExamId);
    }
  };

  return (
    <div className="space-y-6">
      {/* Exam Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Select {examMode === "online" ? "Online" : "Offline"} Exam to Check
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SearchableSelect
            value={selectedExamId}
            onValueChange={setSelectedExamId}
            placeholder="Choose an exam..."
            searchPlaceholder="Search exams..."
            options={exams?.map(e => ({
              value: e.id,
              label: e.title,
            })) || []}
          />
        </CardContent>
      </Card>

      {selectedExamId && (
        <>
          {/* Stats Overview */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard
              title="Total Submissions"
              value={examStats?.totalSubmissions || 0}
              icon={<Users className="h-4 w-4" />}
              isLoading={statsLoading}
            />
            <StatCard
              title="Pending Grading"
              value={examStats?.pendingGrading || 0}
              icon={<Clock className="h-4 w-4" />}
              variant="amber"
              isLoading={statsLoading}
            />
            <StatCard
              title="Finalized"
              value={examStats?.finalized || 0}
              icon={<FileCheck className="h-4 w-4" />}
              variant="blue"
              isLoading={statsLoading}
            />
            <StatCard
              title="Published"
              value={examStats?.published || 0}
              icon={<Send className="h-4 w-4" />}
              variant="green"
              isLoading={statsLoading}
            />
          </div>

          {/* Auto-Grading Section (Online only) */}
          {examMode === "online" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  Automatic Grading
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {gradingProgress && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Grading Progress</span>
                      <span className="font-medium">
                        {gradingProgress.gradedAttempts}/{gradingProgress.totalAttempts} attempts
                      </span>
                    </div>
                    <Progress 
                      value={(gradingProgress.gradedAttempts / gradingProgress.totalAttempts) * 100} 
                    />
                    {gradingProgress.status === "grading" && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>
                          Estimated time: ~{gradingProgress.estimatedTimeMinutes} minutes remaining
                        </span>
                      </div>
                    )}
                    {gradingProgress.status === "completed" && (
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Auto-grading complete!</span>
                      </div>
                    )}
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Start Auto-Grading</p>
                    <p className="text-sm text-muted-foreground">
                      Automatically grades MCQs, True/False, and fills. Flags subjective for review.
                    </p>
                  </div>
                  <Button
                    onClick={handleStartAutoGrade}
                    disabled={autoGrade.isPending || examStats?.pendingGrading === 0}
                    className="gap-2"
                  >
                    {autoGrade.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Grading...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Start Auto-Grade
                      </>
                    )}
                  </Button>
                </div>

                {(examStats?.pendingGrading || 0) > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3 rounded-lg text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-800 dark:text-amber-200">
                          {examStats?.pendingGrading} submissions need grading
                        </p>
                        <p className="text-amber-700 dark:text-amber-300">
                          Objective questions will be auto-graded. Subjective questions require manual review.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Exam Window Status */}
          <ExamWindowStatus examId={selectedExamId} />

          {/* Publish Results Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-5 w-5 text-green-600" />
                Publish Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Publish Block Warning */}
              {publishStatus && !publishStatus.canPublish && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 p-3 rounded-lg text-sm">
                  <div className="flex items-start gap-2">
                    <Ban className="h-4 w-4 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-800 dark:text-red-200">
                        Publishing is blocked
                      </p>
                      <p className="text-red-700 dark:text-red-300">
                        {publishStatus.isOfflineExam && !publishStatus.allGraded
                          ? `Please complete grading for ${publishStatus.pendingGradingCount} submission(s) before publishing`
                          : publishStatus.reason}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">One-Click Publish</p>
                  <p className="text-sm text-muted-foreground">
                    Publish all finalized results to students. They will see their scores immediately.
                  </p>
                </div>
                <Button
                  onClick={handlePublishAll}
                  disabled={
                    bulkPublish.isPending || 
                    (examStats?.readyToPublish || 0) === 0 ||
                    !publishStatus?.canPublish
                  }
                  variant="default"
                  className="gap-2 bg-green-600 hover:bg-green-700"
                >
                  {bulkPublish.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Publish All ({examStats?.readyToPublish || 0})
                    </>
                  )}
                </Button>
              </div>

              {(examStats?.readyToPublish || 0) > 0 && publishStatus?.canPublish && (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 p-3 rounded-lg text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-200">
                        {examStats?.readyToPublish} results ready to publish
                      </p>
                      <p className="text-green-700 dark:text-green-300">
                        Student reports and dashboards will be updated automatically.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  variant = "default",
  isLoading,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "amber" | "blue" | "green";
  isLoading?: boolean;
}) {
  const colors = {
    default: "text-foreground",
    amber: "text-amber-600",
    blue: "text-blue-600",
    green: "text-green-600",
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
        {isLoading ? (
          <div className="h-8 w-12 bg-muted animate-pulse rounded" />
        ) : (
          <div className={`text-2xl font-bold ${colors[variant]}`}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}