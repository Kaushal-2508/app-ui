import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import {
  ArrowLeft,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  UserX,
  FileText,
  Flag,
  Bot,
  Download,
  Loader2,
} from "lucide-react";
import { formatClassName } from "@/lib/utils";
import {
  useExamResultsStudents,
  useExamClasses,
  useExamDetails,
  useExamWindowStatus,
  useValidateExamResults,
  useValidatedResults,
  useExamResultsSummary,
  useCloseStaleAttempts,
  type ExamResultStudent,
} from "@/hooks/useExamResults";
import { useExamAnalytics } from "@/hooks/useExamAnalytics";
import { useAutoGradeExam } from "@/hooks/useAutoGrading";
import { ExamReportPDF } from "./ExamReportPDF";
import { StudentReportPDF } from "./StudentReportPDF";
import { ValidatedResultsTable } from "./ValidatedResultsTable";

type FilterTab = "all" | "not_checked" | "checked" | "not_attempted";

export function ExamResultsView({ examId }: { examId: string }) {
  const navigate = useNavigate();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const { data: exam, isLoading: examLoading } = useExamDetails(examId);
  const { data: classes, isLoading: classesLoading } = useExamClasses(examId);
  const effectiveClassId = selectedClassId || classes?.[0]?.id || null;
  const { data: students = [], isLoading: studentsLoading } = useExamResultsStudents(examId, effectiveClassId);
  const windowStatus = useExamWindowStatus(examId);
  const validateMutation = useValidateExamResults(examId, effectiveClassId);
  const { data: validatedResults = [] } = useValidatedResults(examId, effectiveClassId);
  const summary = useExamResultsSummary(students);
  const { data: analytics } = useExamAnalytics(examId);
  const autoGradeExam = useAutoGradeExam();
  const closeStaleAttempts = useCloseStaleAttempts(examId);
  const autoCloseKickedRef = useRef<string | null>(null);

  const isWindowClosed = windowStatus.data?.is_window_closed || false;
  const activeAttempts = windowStatus.data?.active_attempt_count || 0;
  const isResultsPublished = exam?.status === "completed" && validatedResults.length > 0;

  // Can validate when all attempted are checked, window is closed, no active attempts
  const canValidate =
    summary.notChecked === 0 &&
    summary.attempted > 0 &&
    isWindowClosed &&
    activeAttempts === 0 &&
    !isResultsPublished;

  const filteredStudents = students.filter((s) => {
    if (activeFilter === "all") return true;
    return s.status === activeFilter;
  });

  const filterCounts = {
    all: students.length,
    not_checked: summary.notChecked,
    checked: summary.checked,
    not_attempted: summary.notAttempted,
  };

  const handleStudentClick = (student: ExamResultStudent) => {
    if (student.status === "not_checked" && student.attemptId) {
      navigate(`/exams/${examId}/evaluate/${student.attemptId}`);
    } else if (student.status === "checked" && student.attemptId) {
      navigate(`/exams/${examId}/evaluate/${student.attemptId}?readonly=true`);
    }
  };

  const handleBulkAIEvaluate = () => {
    autoGradeExam.mutate(examId);
  };

  // Abandoned attempts (opened, never submitted, student's clock expired) are
  // closed by a 5-min server cron; kick it once per exam on open so the report
  // reflects it immediately instead of waiting for the sweep. Silent: the RPC
  // no-ops for students still within their time, and that must not toast.
  const closeStaleMutate = closeStaleAttempts.mutate;
  useEffect(() => {
    if (!examId || !isWindowClosed || activeAttempts <= 0) return;
    if (autoCloseKickedRef.current === examId) return;
    autoCloseKickedRef.current = examId;
    closeStaleMutate({ silent: true });
  }, [examId, isWindowClosed, activeAttempts, closeStaleMutate]);

  if (examLoading || classesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{exam?.title || "Exam Results"}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="capitalize text-xs">
                {exam?.exam_mode}
              </Badge>
              <Badge
                variant={exam?.status === "completed" ? "secondary" : "default"}
                className="capitalize text-xs"
              >
                {exam?.status}
              </Badge>
              {!isWindowClosed && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                  <Clock className="h-3 w-3 mr-1" />
                  Window Open
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Exam Report Download - prominently placed */}
        <div className="flex items-center gap-3">
          {analytics && <ExamReportPDF analytics={analytics} />}
        </div>

        {/* Class Selector */}
        {classes && classes.length > 1 && (
          <Select
            value={effectiveClassId || ""}
            onValueChange={setSelectedClassId}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select Class" />
            </SelectTrigger>
            <SelectContent>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {formatClassName(c.name, c.section)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <GradientKPICard
          icon={Users}
          value={summary.totalStudents}
          label="Total Students"
          variant="blue"
        />
        <GradientKPICard
          icon={ClipboardCheck}
          value={summary.checked}
          label="Checked"
          variant="emerald"
        />
        <GradientKPICard
          icon={Clock}
          value={summary.notChecked}
          label="Pending Review"
          variant="orange"
        />
        <GradientKPICard
          icon={UserX}
          value={summary.notAttempted}
          label="Not Attempted"
          variant="slate"
        />
      </div>

      {/* Show validated results if published */}
      {isResultsPublished ? (
        <ValidatedResultsTable
          results={validatedResults}
          examId={examId}
          examTitle={exam?.title || ""}
          isOnline={exam?.exam_mode === "online"}
        />
      ) : (
        <>
          {/* Filter Tabs + Action Buttons */}
          <DashboardSection
            title="Student List"
            icon={FileText}
            iconGradient="from-indigo-400 to-purple-500"
            filter={
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex gap-1 bg-muted/40 rounded-xl p-1">
                  {(["all", "not_checked", "checked", "not_attempted"] as FilterTab[]).map((tab) => (
                    <Button
                      key={tab}
                      variant={activeFilter === tab ? "default" : "ghost"}
                      size="sm"
                      className="rounded-lg text-xs capitalize"
                      onClick={() => setActiveFilter(tab)}
                    >
                      {tab.replace("_", " ")} ({filterCounts[tab]})
                    </Button>
                  ))}
                </div>
                {/* AI Evaluate All */}
                {summary.notChecked > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkAIEvaluate}
                    disabled={autoGradeExam.isPending}
                    className="text-purple-700 border-purple-300 hover:bg-purple-50"
                  >
                    {autoGradeExam.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4 mr-1" />
                    )}
                    {autoGradeExam.isPending ? "AI Evaluating..." : "AI Evaluate All"}
                  </Button>
                )}
              </div>
            }
          >
            {studentsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No students in this category
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll No</TableHead>
                    <TableHead>Admission No</TableHead>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Progress</TableHead>
                    {exam?.exam_mode === "online" && <TableHead>Flags</TableHead>}
                    <TableHead className="w-[60px]">Report</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.map((student) => (
                    <TableRow
                      key={student.studentId}
                      className={
                        student.status === "not_checked" || student.status === "checked"
                          ? "cursor-pointer hover:bg-muted/60"
                          : ""
                      }
                      onClick={() => handleStudentClick(student)}
                    >
                      <TableCell className="font-mono text-sm">
                        {student.rollNo || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {student.admissionNo || "-"}
                      </TableCell>
                      <TableCell className="font-medium">{student.studentName}</TableCell>
                      <TableCell>
                        <StudentStatusBadge status={student.status} isWindowClosed={isWindowClosed} />
                      </TableCell>
                      <TableCell>
                        {student.status === "checked" ? (
                          <span className="font-semibold">
                            {student.totalScore}/{student.maxMarks}
                          </span>
                        ) : student.status === "not_checked" ? (
                          <span className="text-muted-foreground text-sm">Pending</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {student.status !== "not_attempted" ? (
                          <span className="text-xs text-muted-foreground">
                            {student.evaluatedAnswers}/{student.totalAnswers} evaluated
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {isWindowClosed ? "Not Attempted" : "Yet to Attempt"}
                          </span>
                        )}
                      </TableCell>
                      {exam?.exam_mode === "online" && (
                        <TableCell>
                          {student.proctoringFlags > 0 ? (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              <Flag className="h-3 w-3 mr-1" />
                              {student.proctoringFlags}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {student.status === "checked" && analytics ? (
                          <StudentReportPDF analytics={analytics} studentId={student.studentId} iconOnly />
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DashboardSection>

          {/* Validate Button */}
          <div className="flex items-center justify-between rounded-2xl bg-muted/30 p-4">
            <div className="text-sm text-muted-foreground">
              {!isWindowClosed && (
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Exam window is still open. Wait for it to close before validating.
                </span>
              )}
              {isWindowClosed && activeAttempts > 0 && (
                <span className="flex items-center gap-1">
                  {closeStaleAttempts.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                      Closing unsubmitted attempts...
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4 text-amber-500" />
                      {activeAttempts} student(s) are still within their exam time. Their attempts close automatically when their time is up.
                    </>
                  )}
                </span>
              )}
              {isWindowClosed && activeAttempts === 0 && summary.notChecked > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-amber-500" />
                  {summary.notChecked} student(s) still need evaluation.
                </span>
              )}
              {canValidate && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  All checks complete. Ready to validate and publish results.
                </span>
              )}
            </div>
            <Button
              onClick={() => validateMutation.mutate()}
              disabled={!canValidate || validateMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <ShieldCheck className="h-4 w-4 mr-2" />
              {validateMutation.isPending ? "Validating..." : "Validate Results"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StudentStatusBadge({ status, isWindowClosed }: { status: string; isWindowClosed: boolean }) {
  switch (status) {
    case "checked":
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Checked
        </Badge>
      );
    case "not_checked":
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
          <Clock className="h-3 w-3 mr-1" />
          Not Checked
        </Badge>
      );
    case "not_attempted":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          {isWindowClosed ? "Not Attempted" : "Yet to Attempt"}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
