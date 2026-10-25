import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Shield,
  AlertTriangle,
  ChevronRight,
  FileText,
  Layers,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { ProctoringEmptyState } from "@/components/proctoring/ProctoringEmptyState";
import { ProctoringSessionCard } from "@/components/proctoring/ProctoringSessionCard";
import { ProctoringSessionDetail } from "@/components/proctoring/ProctoringSessionDetail";
import { ProctoringFlagReference } from "@/components/proctoring/ProctoringFlagReference";

interface ClassWithProctoring {
  id: string;
  name: string;
  section: string | null;
  session_count: number;
  flagged_count: number;
}

interface ExamWithProctoring {
  id: string;
  title: string;
  status: string;
  scheduled_date: string | null;
  session_count: number;
  flagged_count: number;
}

interface ProctoringSession {
  id: string;
  attempt_id: string;
  started_at: string;
  ended_at: string | null;
  total_events: number;
  high_severity_events: number;
  medium_severity_events: number;
  low_severity_events: number;
  requires_review: boolean;
  review_status: string;
  review_notes: string | null;
  student_exam_attempts: {
    student_id: string;
    exam_id: string;
    profiles: {
      full_name: string;
      email: string;
    };
    exams: {
      title: string;
    };
  };
}

export default function ProctoringReviewPage() {
  const { institutionId } = useEffectiveInstitution();

  // Drill-down state
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProctoringSession | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Count total exam attempts for context
  const { data: totalAttempts } = useQuery({
    queryKey: ["total-exam-attempts", institutionId],
    queryFn: async () => {
      if (!institutionId) return 0;
      
      const { count, error } = await supabase
        .from("student_exam_attempts")
        .select("id, exams!inner(institution_id)", { count: "exact", head: true })
        .eq("exams.institution_id", institutionId);
      
      if (error) return 0;
      return count || 0;
    },
    enabled: !!institutionId,
  });

  // Fetch all classes for the institution
  const { data: allClasses, isLoading: classesLoading } = useQuery({
    queryKey: ["institution-classes-for-proctoring", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });

  // Fetch proctoring sessions with counts grouped by class
  const { data: proctoringData, isLoading: proctoringLoading } = useQuery({
    queryKey: ["proctoring-data-by-class", institutionId],
    queryFn: async () => {
      if (!institutionId) return { sessionsByClass: new Map(), sessionsByExam: new Map() };

      // Get all proctoring sessions with their related data
      const { data: sessions, error } = await supabase
        .from("proctoring_sessions")
        .select(`
          id,
          requires_review,
          high_severity_events,
          student_exam_attempts!inner (
            exam_id,
            exams!inner (
              id,
              title,
              institution_id,
              status,
              scheduled_date,
              exam_classes (class_id)
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Aggregate sessions by class and exam
      const sessionsByClass = new Map<string, { count: number; flagged: number }>();
      const sessionsByExam = new Map<string, { count: number; flagged: number }>();

      sessions?.forEach((session: any) => {
        const exam = session.student_exam_attempts?.exams;
        if (!exam || exam.institution_id !== institutionId) return;

        const examId = exam.id;
        const isFlagged = session.requires_review || session.high_severity_events > 0;

        // Count by exam
        const examData = sessionsByExam.get(examId) || { count: 0, flagged: 0 };
        examData.count++;
        if (isFlagged) examData.flagged++;
        sessionsByExam.set(examId, examData);

        // Count by class
        exam.exam_classes?.forEach((ec: any) => {
          const classData = sessionsByClass.get(ec.class_id) || { count: 0, flagged: 0 };
          classData.count++;
          if (isFlagged) classData.flagged++;
          sessionsByClass.set(ec.class_id, classData);
        });
      });

      return { sessionsByClass, sessionsByExam, rawSessions: sessions };
    },
    enabled: !!institutionId,
  });

  // Merge class data with proctoring counts
  const classesWithProctoring: ClassWithProctoring[] = (allClasses || [])
    .map((cls) => {
      const data = proctoringData?.sessionsByClass.get(cls.id);
      return {
        id: cls.id,
        name: cls.name,
        section: cls.section,
        session_count: data?.count || 0,
        flagged_count: data?.flagged || 0,
      };
    })
    .filter((cls) => cls.session_count > 0)
    .sort((a, b) => b.flagged_count - a.flagged_count);

  // Fetch exams for selected class
  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ["proctoring-exams-for-class", selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return [];

      const { data, error } = await supabase
        .from("exams")
        .select(`
          id,
          title,
          status,
          scheduled_date,
          exam_classes!inner (class_id)
        `)
        .eq("exam_classes.class_id", selectedClassId)
        .order("scheduled_date", { ascending: false });

      if (error) throw error;

      // Merge with proctoring counts
      return (data || []).map((exam) => {
        const stats = proctoringData?.sessionsByExam.get(exam.id);
        return {
          id: exam.id,
          title: exam.title,
          status: exam.status,
          scheduled_date: exam.scheduled_date,
          session_count: stats?.count || 0,
          flagged_count: stats?.flagged || 0,
        };
      }).filter((exam) => exam.session_count > 0);
    },
    enabled: !!selectedClassId,
  });

  // Fetch sessions for selected exam
  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["proctoring-sessions-for-exam", selectedExamId, statusFilter],
    queryFn: async () => {
      if (!selectedExamId) return [];

      let query = supabase
        .from("proctoring_sessions")
        .select(`
          *,
          student_exam_attempts!inner (
            student_id,
            exam_id,
            profiles!student_exam_attempts_student_id_fkey!inner (full_name, email),
            exams!inner (title)
          )
        `)
        .eq("student_exam_attempts.exam_id", selectedExamId)
        .order("started_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("review_status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ProctoringSession[];
    },
    enabled: !!selectedExamId,
  });

  // Get breadcrumb info
  const selectedClass = classesWithProctoring.find((c) => c.id === selectedClassId);
  const selectedExam = exams?.find((e) => e.id === selectedExamId);

  // Handle back navigation
  const handleBack = () => {
    if (selectedExamId) {
      setSelectedExamId(null);
    } else if (selectedClassId) {
      setSelectedClassId(null);
    }
  };

  // Loading state
  if (classesLoading || proctoringLoading) {
    return <LoadingSkeleton />;
  }

  // Check if there's any proctoring data at all
  const hasAnyProctoringData = classesWithProctoring.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Proctoring Review
          </h1>
          <p className="text-muted-foreground">
            Review flagged exam sessions for suspicious activities
          </p>
        </div>
        <ProctoringFlagReference />
      </div>

      {/* Breadcrumb Navigation */}
      {(selectedClassId || selectedExamId) && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <span className="text-muted-foreground">/</span>
          <span
            className={
              selectedClassId && !selectedExamId
                ? "font-medium"
                : "text-muted-foreground cursor-pointer hover:underline"
            }
            onClick={() => selectedExamId && setSelectedExamId(null)}
          >
            {selectedClass?.name ? formatClassName(selectedClass.name, selectedClass.section) : ""}
          </span>
          {selectedExamId && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{selectedExam?.title}</span>
            </>
          )}
        </div>
      )}

      {/* No Data State */}
      {!hasAnyProctoringData && !selectedClassId && <ProctoringEmptyState totalExamAttempts={totalAttempts || 0} />}

      {/* Step 1: Class Selection */}
      {hasAnyProctoringData && !selectedClassId && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Select a Class
          </h2>

          {/* Summary Stats */}
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            <SummaryCard
              title="Total Classes with Sessions"
              value={classesWithProctoring.length}
              icon={<Users className="h-4 w-4" />}
            />
            <SummaryCard
              title="Sessions Pending Review"
              value={classesWithProctoring.reduce((sum, c) => sum + c.flagged_count, 0)}
              icon={<Clock className="h-4 w-4" />}
              variant="warning"
            />
            <SummaryCard
              title="Total Sessions Recorded"
              value={classesWithProctoring.reduce((sum, c) => sum + c.session_count, 0)}
              icon={<Shield className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {classesWithProctoring.map((cls) => (
              <Card
                key={cls.id}
                className={`cursor-pointer hover:border-primary transition-colors ${
                  cls.flagged_count > 0 ? "border-amber-200 dark:border-amber-800" : ""
                }`}
                onClick={() => setSelectedClassId(cls.id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    {formatClassName(cls.name, cls.section)}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{cls.session_count} sessions</Badge>
                      {cls.flagged_count > 0 && (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {cls.flagged_count} flagged
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Exam Selection */}
      {selectedClassId && !selectedExamId && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Select an Exam
          </h2>

          {examsLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : exams?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">
                  No exams with proctoring data for this class
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {exams?.map((exam) => (
                <Card
                  key={exam.id}
                  className={`cursor-pointer hover:border-primary transition-colors ${
                    exam.flagged_count > 0 ? "border-amber-200 dark:border-amber-800" : ""
                  }`}
                  onClick={() => setSelectedExamId(exam.id)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {exam.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{exam.status}</Badge>
                        <Badge variant="secondary">{exam.session_count} sessions</Badge>
                        {exam.flagged_count > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {exam.flagged_count}
                          </Badge>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    {exam.scheduled_date && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {format(new Date(exam.scheduled_date), "MMM d, yyyy")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Sessions List */}
      {selectedExamId && (
        <div className="space-y-4">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatsCard
              title="Total Sessions"
              value={sessions?.length || 0}
              icon={<Shield className="h-4 w-4" />}
            />
            <StatsCard
              title="Pending Review"
              value={
                sessions?.filter(
                  (s) => s.review_status === "pending" && s.requires_review
                ).length || 0
              }
              variant="warning"
              icon={<Clock className="h-4 w-4" />}
            />
            <StatsCard
              title="Cleared"
              value={sessions?.filter((s) => s.review_status === "cleared").length || 0}
              variant="success"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <StatsCard
              title="Flagged"
              value={sessions?.filter((s) => s.review_status === "flagged").length || 0}
              variant="destructive"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          </div>

          {/* Filter */}
          <div className="flex items-center gap-4">
            <h3 className="font-medium">Filter by Status:</h3>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="flagged">Flagged</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sessions List */}
          {sessionsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : sessions?.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No sessions match your filter</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessions?.map((session) => (
                <ProctoringSessionCard
                  key={session.id}
                  session={session}
                  onView={setSelectedSession}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session Detail Dialog */}
      <ProctoringSessionDetail
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  variant = "default",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "warning" | "success";
}) {
  const variantClasses = {
    default: "",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    success: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
  };

  return (
    <Card className={variantClasses[variant]}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatsCard({
  title,
  value,
  icon,
  variant = "default",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "warning" | "success" | "destructive";
}) {
  const valueClasses = {
    default: "",
    warning: "text-amber-600",
    success: "text-green-600",
    destructive: "text-destructive",
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
        <div className={`text-2xl font-bold ${valueClasses[variant]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    </div>
  );
}
