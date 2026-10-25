import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { Clock, Users, AlertTriangle, CheckCircle2, FileText } from "lucide-react";

interface ExamWindowStatusProps {
  examId: string;
}

export function ExamWindowStatus({ examId }: ExamWindowStatusProps) {
  const { data: examDetails } = useQuery({
    queryKey: ["exam-details-for-window", examId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select("id, title, start_time, end_time, status, exam_mode")
        .eq("id", examId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!examId,
  });

  const { data: activeAttempts } = useQuery({
    queryKey: ["active-attempts", examId],
    queryFn: async () => {
      const { count } = await supabase
        .from("student_exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("is_submitted", false);
      return count || 0;
    },
    enabled: !!examId,
    refetchInterval: 30000,
  });

  // For offline exams: check if all submitted attempts are finalized
  const { data: pendingGradingCount } = useQuery({
    queryKey: ["pending-grading-count", examId],
    queryFn: async () => {
      const { count } = await supabase
        .from("student_exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("is_submitted", true)
        .eq("is_finalized", false);
      return count || 0;
    },
    enabled: !!examId && examDetails?.exam_mode === "offline",
    refetchInterval: 30000,
  });

  if (!examDetails) return null;

  const now = new Date();
  const startTime = examDetails.start_time ? new Date(examDetails.start_time) : null;
  const endTime = examDetails.end_time ? new Date(examDetails.end_time) : null;
  const isOfflineExam = examDetails.exam_mode === "offline";

  const isWindowOpen = startTime && startTime <= now && (!endTime || endTime > now);
  const isWindowClosed = endTime && endTime <= now;
  const isUpcoming = startTime && startTime > now;
  const hasActiveStudents = (activeAttempts || 0) > 0;
  const allGraded = (pendingGradingCount || 0) === 0;

  const getStatusConfig = () => {
    // Handle offline exams first
    if (isOfflineExam) {
      if (hasActiveStudents) {
        return {
          variant: "secondary" as const,
          icon: <FileText className="h-4 w-4 text-blue-600" />,
          label: "Offline Exam",
          description: `${activeAttempts} submission(s) in progress`,
          color: "border-blue-200 bg-blue-50 dark:bg-blue-950/20",
        };
      }
      if (!allGraded) {
        return {
          variant: "secondary" as const,
          icon: <Clock className="h-4 w-4 text-amber-600" />,
          label: "Offline Exam",
          description: `${pendingGradingCount} submission(s) need grading`,
          color: "border-amber-200 bg-amber-50 dark:bg-amber-950/20",
        };
      }
      return {
        variant: "default" as const,
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
        label: "Offline Exam",
        description: "All submissions graded. Ready to publish results.",
        color: "border-green-200 bg-green-50 dark:bg-green-950/20",
      };
    }

    // Online exam logic (unchanged)
    if (isWindowClosed && !hasActiveStudents) {
      return {
        variant: "default" as const,
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
        label: "Window Closed",
        description: "Exam window has ended. Results can be published.",
        color: "border-green-200 bg-green-50 dark:bg-green-950/20",
      };
    }
    if (hasActiveStudents) {
      return {
        variant: "destructive" as const,
        icon: <Users className="h-4 w-4" />,
        label: `${activeAttempts} Active Student${activeAttempts !== 1 ? "s" : ""}`,
        description: "Students are currently taking this exam. Cannot publish results.",
        color: "border-amber-200 bg-amber-50 dark:bg-amber-950/20",
      };
    }
    if (isWindowOpen) {
      return {
        variant: "secondary" as const,
        icon: <Clock className="h-4 w-4 text-blue-600" />,
        label: "Window Open",
        description: endTime
          ? `Closes ${formatDistanceToNow(endTime, { addSuffix: true })}`
          : "No end time set",
        color: "border-blue-200 bg-blue-50 dark:bg-blue-950/20",
      };
    }
    if (isUpcoming && startTime) {
      return {
        variant: "outline" as const,
        icon: <Clock className="h-4 w-4 text-muted-foreground" />,
        label: "Upcoming",
        description: `Starts ${formatDistanceToNow(startTime, { addSuffix: true })}`,
        color: "border-muted",
      };
    }
    return {
      variant: "secondary" as const,
      icon: <AlertTriangle className="h-4 w-4 text-muted-foreground" />,
      label: "No Schedule",
      description: "No start/end time configured",
      color: "border-muted",
    };
  };

  const config = getStatusConfig();
  
  // For offline exams: allow publishing when all graded and no active students
  // For online exams: require window closed and no active students
  const canPublish = isOfflineExam 
    ? (!hasActiveStudents && allGraded)
    : (isWindowClosed && !hasActiveStudents);

  return (
    <Card className={config.color}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {config.icon}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{config.label}</span>
                <Badge variant={config.variant} className="text-xs">
                  {canPublish ? "Ready to Publish" : "Publishing Blocked"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{config.description}</p>
            </div>
          </div>
          {!isOfflineExam && (
            <div className="text-right text-xs text-muted-foreground">
              {startTime && (
                <div>Start: {format(startTime, "MMM d, h:mm a")}</div>
              )}
              {endTime && (
                <div>End: {format(endTime, "MMM d, h:mm a")}</div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function useCanPublishResults(examId: string | null) {
  const { data: windowStatus } = useQuery({
    queryKey: ["exam-publish-status", examId],
    queryFn: async () => {
      if (!examId) return null;

      // Get exam details including exam_mode
      const { data: exam, error: examError } = await supabase
        .from("exams")
        .select("end_time, exam_mode")
        .eq("id", examId)
        .single();

      if (examError) throw examError;

      const isOfflineExam = exam.exam_mode === "offline";

      // Get active attempts count (not submitted)
      const { count: activeCount } = await supabase
        .from("student_exam_attempts")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", examId)
        .eq("is_submitted", false);

      const hasActiveStudents = (activeCount || 0) > 0;

      // For offline exams: check if all submitted attempts are finalized
      if (isOfflineExam) {
        const { count: pendingGradingCount } = await supabase
          .from("student_exam_attempts")
          .select("id", { count: "exact", head: true })
          .eq("exam_id", examId)
          .eq("is_submitted", true)
          .eq("is_finalized", false);

        const allGraded = (pendingGradingCount || 0) === 0;

        return {
          canPublish: !hasActiveStudents && allGraded,
          isWindowClosed: true, // Always consider "closed" for offline exams
          hasActiveStudents,
          activeCount: activeCount || 0,
          isOfflineExam: true,
          allGraded,
          pendingGradingCount: pendingGradingCount || 0,
          reason: hasActiveStudents
            ? `${activeCount} submission(s) still in progress`
            : !allGraded
            ? `${pendingGradingCount} submission(s) still need grading`
            : null,
        };
      }

      // Online exam logic (unchanged)
      const endTime = exam.end_time ? new Date(exam.end_time) : null;
      const isWindowClosed = endTime ? endTime <= new Date() : false;

      return {
        canPublish: isWindowClosed && !hasActiveStudents,
        isWindowClosed,
        hasActiveStudents,
        activeCount: activeCount || 0,
        isOfflineExam: false,
        allGraded: true,
        pendingGradingCount: 0,
        reason: hasActiveStudents
          ? `${activeCount} student(s) are still taking the exam`
          : !isWindowClosed
          ? "Exam window is still active"
          : null,
      };
    },
    enabled: !!examId,
    refetchInterval: 30000,
  });

  return windowStatus;
}
