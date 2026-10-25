import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  PlayCircle,
  Clock,
  FileText,
  BookOpen,
  Timer,
} from "lucide-react";
import { useStudentExams } from "@/hooks/useDashboardData";
import { format, differenceInSeconds, differenceInMinutes, differenceInHours, differenceInDays } from "date-fns";
import { useNavigate } from "react-router-dom";
import { UpcomingExamSheet } from "@/components/student/UpcomingExamSheet";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";

interface StudentExamRow {
  exam_id: string;
  class_id: string;
  title: string;
  class_name?: string;
  exam_mode: string;
  scheduled_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  total_marks?: number | null;
  attempt_status: string;
  is_submitted?: boolean;
  attempt_submitted_at?: string | null;
  study_materials?: Array<{ id: string; title: string; url: string; type: string }>;
}

function ExamCountdown({ startTime }: { startTime: string }) {
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const start = new Date(startTime);
      const diffSeconds = differenceInSeconds(start, now);

      if (diffSeconds <= 0) {
        setTimeLeft("Live Now!");
        setIsLive(true);
        return;
      }

      const days = differenceInDays(start, now);
      const hours = differenceInHours(start, now) % 24;
      const minutes = differenceInMinutes(start, now) % 60;

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
      setIsLive(false);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${isLive ? "text-emerald-600" : "text-brand-primary"}`}>
      <Timer className="h-3.5 w-3.5" />
      <span>{timeLeft}</span>
    </div>
  );
}

export default function StudentExamsPage() {
  const navigate = useNavigate();
  const { data: exams, isLoading } = useStudentExams();
  const [selectedExam, setSelectedExam] = useState<StudentExamRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const rows = (exams ?? []) as StudentExamRow[];
  const upcomingExams = rows.filter(e =>
    e.attempt_status === "available" || e.attempt_status === "not_started"
  );
  const inProgressExams = rows.filter(e => e.attempt_status === "in_progress");
  const completedExams = rows.filter(e => e.is_submitted);
  const missedExams = rows.filter(e => e.attempt_status === "expired" && !e.is_submitted);

  const handleExamClick = (exam: StudentExamRow) => {
    setSelectedExam(exam);
    setSheetOpen(true);
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell>
      <PageHeader
        icon={<Calendar className="h-5 w-5" />}
        title="My Exams"
        subtitle="View and attempt your scheduled exams"
      />

      <StatTileGrid cols={3} mdCols={3}>
        <StatTile
          label="Upcoming"
          value={upcomingExams.length}
          icon={<Calendar className="h-5 w-5" />}
          tone="sky"
        />
        <StatTile
          label="In Progress"
          value={inProgressExams.length}
          icon={<Clock className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label="Completed"
          value={completedExams.length}
          icon={<FileText className="h-5 w-5" />}
          tone="mint"
        />
      </StatTileGrid>

      {inProgressExams.length > 0 && (
        <div className="surface-card frosted-shadow rounded-2xl p-4 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-ink-900">You have exams in progress</p>
            <p className="text-xs text-ink-600">
              {inProgressExams.length} exam(s) started but not submitted
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              const inProgressExam = inProgressExams[0];
              if (inProgressExam) {
                navigate(`/student/exams/${inProgressExam.exam_id}/attempt?classId=${inProgressExam.class_id}`);
              }
            }}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Continue
          </Button>
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold text-ink-900 mb-3">Upcoming Exams</h2>
        {upcomingExams.length > 0 ? (
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcomingExams.map(exam => (
              <Card
                key={exam.exam_id}
                className="surface-card frosted-shadow rounded-2xl border-0 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => handleExamClick(exam)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base group-hover:text-brand-primary transition-colors">
                      {exam.title}
                    </CardTitle>
                    <AttemptStatusBadge status={exam.attempt_status} />
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {exam.class_name && <Badge variant="outline" className="text-xs">{exam.class_name}</Badge>}
                    {exam.exam_mode && <Badge variant="secondary" className="text-xs capitalize">{exam.exam_mode}</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {exam.scheduled_date && (
                    <div className="flex items-center gap-2 text-sm text-ink-600">
                      <Calendar className="h-4 w-4" />
                      <span>{format(new Date(exam.scheduled_date), "EEE, MMM d, yyyy")}</span>
                    </div>
                  )}

                  {exam.start_time && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm text-ink-600 min-w-0">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span className="truncate">{format(new Date(exam.start_time), "h:mm a")}</span>
                        {exam.duration_minutes && (
                          <span className="text-xs">({exam.duration_minutes} min)</span>
                        )}
                      </div>
                      <ExamCountdown startTime={exam.start_time} />
                    </div>
                  )}

                  {exam.total_marks && (
                    <div className="flex items-center gap-2 text-sm text-ink-600">
                      <FileText className="h-4 w-4" />
                      <span>Total Marks: {exam.total_marks}</span>
                    </div>
                  )}

                  {exam.study_materials && exam.study_materials.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-brand-primary">
                      <BookOpen className="h-4 w-4" />
                      <span>{exam.study_materials.length} study material(s) attached</span>
                    </div>
                  )}

                  <div className="text-xs text-ink-500 text-center pt-2 border-t border-ink-200/30">
                    Tap for details &amp; study materials
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Calendar className="h-7 w-7" />}
            title="No upcoming exams"
            description="Check back later for new exam schedules."
          />
        )}
      </section>

      {missedExams.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-ink-900 mb-3">Missed Exams</h2>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {missedExams.map(exam => (
              <article
                key={exam.exam_id}
                className="surface-card frosted-shadow rounded-2xl p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-ink-900 leading-tight">{exam.title}</h3>
                  <Badge className="bg-rose-500/10 text-rose-700 border border-rose-200 text-xs shrink-0">
                    Missed
                  </Badge>
                </div>
                {exam.class_name && (
                  <Badge variant="outline" className="text-xs w-fit">{exam.class_name}</Badge>
                )}
                <p className="text-sm text-ink-600">
                  {exam.scheduled_date
                    ? `Scheduled: ${format(new Date(exam.scheduled_date), "MMM d, yyyy")}`
                    : exam.end_time
                      ? `Ended: ${format(new Date(exam.end_time), "MMM d, yyyy h:mm a")}`
                      : "Exam window closed"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {completedExams.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-ink-900 mb-3">Completed Exams</h2>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedExams.slice(0, 6).map(exam => (
              <article
                key={exam.exam_id}
                className="surface-card frosted-shadow rounded-2xl p-4 space-y-2 opacity-90"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-ink-900 leading-tight">{exam.title}</h3>
                  <Badge variant="outline" className="text-xs">Submitted</Badge>
                </div>
                <p className="text-sm text-ink-600">
                  Submitted {exam.attempt_submitted_at ? format(new Date(exam.attempt_submitted_at), "MMM d, yyyy") : "N/A"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <UpcomingExamSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        exam={selectedExam}
      />
    </PageShell>
  );
}

function AttemptStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    available: { variant: "default", label: "Available Now" },
    not_started: { variant: "secondary", label: "Upcoming" },
    in_progress: { variant: "default", label: "In Progress" },
    submitted: { variant: "outline", label: "Submitted" },
    expired: { variant: "destructive", label: "Missed" },
  };

  const { variant, label } = config[status] || config.not_started;

  return <Badge variant={variant} className="text-xs">{label}</Badge>;
}

function PageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        icon={<Calendar className="h-5 w-5" />}
        title="My Exams"
        subtitle="View and attempt your scheduled exams"
      />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-3 mt-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </PageShell>
  );
}
