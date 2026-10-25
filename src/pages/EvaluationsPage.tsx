import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ClipboardCheck,
  FileText,
  User,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Search,
  Bot,
  ArrowLeft,
  Monitor,
  FileImage,
  Sparkles,
  Camera,
  UserX,
  Inbox,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePendingEvaluations, useFinalizeAttempt, usePublishResults } from "@/hooks/useEvaluations";
import { useUserRole } from "@/hooks/useUserRole";
import { EvaluationWorkspace } from "@/components/evaluation/EvaluationWorkspace";
import { ExamCheckingDashboard } from "@/components/exam-checking/ExamCheckingDashboard";
import { formatDistanceToNow } from "date-fns";
import { ScanAnswerSheetsModal, ProcessingStatusCard } from "@/components/offline-scan";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";

export default function EvaluationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: evaluations, isLoading, isError, refetch } = usePendingEvaluations();
  const { data: roleInfo } = useUserRole();
  const canScanSheets = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;
  const finalizeAttempt = useFinalizeAttempt();
  const publishResults = usePublishResults();

  const [activeTab, setActiveTab] = useState<string>("online");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [scanModalOpen, setScanModalOpen] = useState(false);

  // Auto-open scan modal if ?scan=true
  useEffect(() => {
    if (searchParams.get("scan") === "true") {
      setScanModalOpen(true);
      searchParams.delete("scan");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [selectedAttempt, setSelectedAttempt] = useState<{
    id: string;
    studentName: string;
    studentIdLine: string;
    examTitle: string;
    isOffline?: boolean;
  } | null>(null);

  // Filter evaluations
  const filteredEvaluations = evaluations?.filter(e => {
    const matchesSearch =
      e.examTitle.toLowerCase().includes(search.toLowerCase()) ||
      e.studentName.toLowerCase().includes(search.toLowerCase()) ||
      // Markers routinely look a student up by roll or admission number.
      e.studentIdLine.toLowerCase().includes(search.toLowerCase()) ||
      e.className.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === "all" || e.status === statusFilter;

    return matchesSearch && matchesStatus;
  }) || [];

  // Stats
  const stats = {
    pending: evaluations?.filter(e => e.status === "pending").length ?? 0,
    needsReview: evaluations?.filter(e => e.status === "needs_review").length ?? 0,
    inProgress: evaluations?.filter(e => e.status === "in_progress").length ?? 0,
    readyToFinalize: evaluations?.filter(e => e.status === "ready_to_finalize").length ?? 0,
  };

  // Tab counts for student list status filter
  const allCount = evaluations?.length ?? 0;
  const pendingCount = evaluations?.filter(e => e.status === "pending").length ?? 0;
  const needsReviewCount = evaluations?.filter(e => e.status === "needs_review").length ?? 0;
  const inProgressCount = evaluations?.filter(e => e.status === "in_progress").length ?? 0;
  const readyCount = evaluations?.filter(e => e.status === "ready_to_finalize").length ?? 0;

  const handleFinalize = async (attemptId: string) => {
    await finalizeAttempt.mutateAsync(attemptId);
  };

  const handlePublish = async (attemptId: string) => {
    await publishResults.mutateAsync(attemptId);
    setSelectedAttempt(null);
  };

  function getInitials(name: string): string {
    return name
      .split(" ")
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  if (isLoading) {
    return <PageSkeleton />;
  }

  // Error state BEFORE the empty state (CLAUDE.md section 6). A failed queue
  // query used to fall through to "No submissions found", which reads as an
  // empty marking pile rather than a page that could not load one.
  if (isError) {
    return (
      <PageShell>
        <PageHeader title="Evaluations" subtitle="Review and grade student submissions" />
        <div className="mt-4">
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load the evaluation queue"
            description="Nothing here means the list is unavailable, not that there is nothing to mark."
            tone="rose"
            action={{ label: "Try again", onClick: () => void refetch() }}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Evaluations"
        subtitle="Review and grade student submissions"
        primaryAction={
          canScanSheets
            ? {
                label: "Scan Sheets",
                onClick: () => navigate("/scan-sheets"),
                icon: <Camera className="h-4 w-4" />,
              }
            : undefined
        }
      />

      {/* Processing Status Card */}
      <ProcessingStatusCard />

      {/* Stat Tiles */}
      <StatTileGrid mdCols={4} className="mt-4">
        <StatTile
          label="Pending AI"
          value={stats.pending}
          icon={<Clock className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label="Needs Review"
          value={stats.needsReview}
          icon={<UserX className="h-5 w-5" />}
          tone="rose"
        />
        <StatTile
          label="In Progress"
          value={stats.inProgress}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
        />
        <StatTile
          label="Ready to Finalize"
          value={stats.readyToFinalize}
          icon={<AlertCircle className="h-5 w-5" />}
          tone="violet"
        />
      </StatTileGrid>

      {/* Main content card */}
      <div className="mt-6 surface-card frosted-shadow rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-base font-semibold text-ink-900">Submissions</h2>
        </div>

        {/* Top-level mode tabs (Online / Auto-Check) */}
        <MobileTabs
          value={activeTab}
          onValueChange={setActiveTab}
          options={[
            { value: "online", label: "Online Exams", count: allCount },
            { value: "auto-check", label: "Auto-Check" },
          ]}
        />

        {activeTab === "online" && (
          <>
            {/* Search bar */}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <Input
                placeholder="Search by exam, student, or class..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Status filter tabs */}
            <MobileTabs
              value={statusFilter}
              onValueChange={setStatusFilter}
              density="compact"
              className="mt-3"
              options={[
                { value: "all", label: "All", count: allCount },
                { value: "pending", label: "Pending", count: pendingCount },
                { value: "needs_review", label: "Needs Review", count: needsReviewCount },
                { value: "in_progress", label: "In Progress", count: inProgressCount },
                { value: "ready_to_finalize", label: "Ready", count: readyCount },
              ]}
            />

            {/* Mobile list */}
            <div className="mt-3 lg:hidden">
              {filteredEvaluations.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-7 w-7" />}
                  title="No submissions found"
                  description="No pending evaluations matching your filters."
                />
              ) : (
                <ul className="list-none p-0 space-y-2">
                  {filteredEvaluations.map((evaluation) => (
                    <ListRow
                      key={evaluation.attemptId}
                      as="li"
                      leading={
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">
                          {getInitials(evaluation.studentName)}
                        </span>
                      }
                      title={evaluation.examTitle}
                      subtitle={[evaluation.studentName, evaluation.studentIdLine, evaluation.className]
                        .filter(Boolean)
                        .join(" · ")}
                      trailing={<EvaluationStatusBadge status={evaluation.status} />}
                      onClick={() =>
                        setSelectedAttempt({
                          id: evaluation.attemptId,
                          studentName: evaluation.studentName,
                          studentIdLine: evaluation.studentIdLine,
                          examTitle: evaluation.examTitle,
                          isOffline: false,
                        })
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Desktop list */}
            <div className="mt-3 hidden lg:block">
              {filteredEvaluations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
                  <h3 className="text-lg font-medium mb-2">All caught up!</h3>
                  <p className="text-muted-foreground text-center">
                    No pending online evaluations matching your filters.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {filteredEvaluations.map((evaluation) => (
                    <div
                      key={evaluation.attemptId}
                      className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedAttempt({
                        id: evaluation.attemptId,
                        studentName: evaluation.studentName,
                        studentIdLine: evaluation.studentIdLine,
                        examTitle: evaluation.examTitle,
                        isOffline: false,
                      })}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{evaluation.examTitle}</span>
                            <EvaluationStatusBadge status={evaluation.status} />
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {evaluation.studentName}
                            </span>
                            {evaluation.studentIdLine && (
                              <span className="font-mono text-xs">{evaluation.studentIdLine}</span>
                            )}
                            <span>{evaluation.className}</span>
                            {evaluation.submittedAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDistanceToNow(new Date(evaluation.submittedAt), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-muted-foreground">
                                Teacher reviewed: {evaluation.teacherReviewedCount}/{evaluation.totalQuestions}
                              </span>
                              {evaluation.aiEvaluatedCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-blue-600">
                                  <Bot className="h-3 w-3" />
                                  {evaluation.aiEvaluatedCount} AI evaluated
                                </span>
                              )}
                            </div>
                            <Progress
                              value={(evaluation.teacherReviewedCount / evaluation.totalQuestions) * 100}
                              className="h-2"
                            />
                          </div>
                        </div>
                        <Button variant="ghost" size="icon">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "auto-check" && (
          <div className="mt-4 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Monitor className="h-4 w-4 text-ink-500" />
                <h3 className="text-sm font-semibold text-ink-700">Online Exam Auto-Checking</h3>
              </div>
              <ExamCheckingDashboard examMode="online" />
            </div>

            <Separator />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileImage className="h-4 w-4 text-ink-500" />
                <h3 className="text-sm font-semibold text-ink-700">Offline Exam OCR Checking</h3>
              </div>
              <ExamCheckingDashboard examMode="offline" />
            </div>
          </div>
        )}
      </div>

      {/* Evaluation Workspace Sheet */}
      <Sheet open={!!selectedAttempt} onOpenChange={(open) => !open && setSelectedAttempt(null)}>
        <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedAttempt(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              Evaluate Submission
              {selectedAttempt?.isOffline && (
                <Badge variant="outline">Offline</Badge>
              )}
            </SheetTitle>
          </SheetHeader>
          {selectedAttempt && (
            <div className="mt-6">
              <EvaluationWorkspace
                attemptId={selectedAttempt.id}
                studentName={selectedAttempt.studentName}
                studentIdLine={selectedAttempt.studentIdLine}
                examTitle={selectedAttempt.examTitle}
                isOffline={selectedAttempt.isOffline}
                onComplete={async () => {
                  await handleFinalize(selectedAttempt.id);
                  await handlePublish(selectedAttempt.id);
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Scan Answer Sheets Modal */}
      <ScanAnswerSheetsModal
        open={scanModalOpen}
        onOpenChange={setScanModalOpen}
      />
    </PageShell>
  );
}

function EvaluationStatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; icon: typeof AlertCircle }> = {
    pending: { variant: "secondary", label: "Pending", icon: Clock },
    ai_processing: { variant: "secondary", label: "AI Processing", icon: Bot },
    needs_review: { variant: "default", label: "Needs Review", icon: AlertCircle },
    in_progress: { variant: "outline", label: "In Progress", icon: FileText },
    ready_to_finalize: { variant: "outline", label: "Ready", icon: CheckCircle2 },
    finalized: { variant: "secondary", label: "Finalized", icon: CheckCircle2 },
  };

  const { variant, label, icon: Icon } = config[status] ?? config.pending;

  return (
    <Badge variant={variant} className="text-xs">
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    </PageShell>
  );
}
