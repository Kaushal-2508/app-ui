import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClipboardCheck,
  Users,
  BookOpen,
  Layers,
  ClipboardList,
  BarChart3,
  Trophy,
  Award,
  FilePlus2,
} from "lucide-react";
import { useTeacherStats } from "@/hooks/useDashboardData";
import { useProfileData } from "@/hooks/useProfileData";
import { SuggestedActionsCard } from "@/components/learning/SuggestedActionsCard";
import { BadgeShowcase } from "@/components/badges";
import { formatNumber } from "@/lib/formatNumber";

import { PageShell, PageHeader } from "@/components/shared/page";
import { HeroSummaryCard, FeatureTile } from "@/components/shared/surfaces";

export function TeacherDashboard() {
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = useTeacherStats();
  const { data: profile, isLoading: profileLoading } = useProfileData();

  if (statsLoading || profileLoading) {
    return <DashboardSkeleton />;
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const institutionName = profile?.institution?.name;
  const openTasksCount = stats?.openTasks ?? 0;

  return (
    <PageShell>
      <PageHeader
        title={`Hello, ${firstName} 👋`}
        subtitle={institutionName ? `${institutionName} · Teacher` : "Teacher"}
      />

      <HeroSummaryCard
        eyebrow="This week"
        value={formatNumber(openTasksCount)}
        metric="Open Tasks"
        link={{ label: "View all", to: "/tasks" }}
      />

      <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">WORK</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/teacher/students"
          icon={<Users className="h-5 w-5" />}
          title="My Students"
          description="Students in your classes"
          tone="teal"
        />
        <FeatureTile
          to="/school/syllabus"
          icon={<BookOpen className="h-5 w-5" />}
          title="Syllabus"
          description="Curriculum & syllabus mapping"
          tone="teal"
        />
        <FeatureTile
          to="/question-bank"
          icon={<Layers className="h-5 w-5" />}
          title="Question Bank"
          description="Browse & manage question pool"
          tone="teal"
        />
        <FeatureTile
          to="/exams/create"
          icon={<FilePlus2 className="h-5 w-5" />}
          title="Create Exam"
          description="Author a new exam from scratch"
          tone="teal"
        />
        <FeatureTile
          to="/tasks"
          icon={<ClipboardList className="h-5 w-5" />}
          title="Tasks"
          description="Track assigned work items"
          tone="teal"
        />
        <FeatureTile
          to="/reports"
          icon={<BarChart3 className="h-5 w-5" />}
          title="Reports"
          description="Generate & view reports"
          tone="teal"
        />
      </div>

      <p className="mt-8 text-xs font-medium uppercase tracking-wider text-ink-400">GROWTH</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FeatureTile
          to="/achievements"
          icon={<Trophy className="h-5 w-5" />}
          title="Achievements"
          description="Badges & milestones earned"
          tone="peach"
        />
        <FeatureTile
          to="/leaderboard"
          icon={<Award className="h-5 w-5" />}
          title="Leaderboard"
          description="Rankings & standings"
          tone="peach"
        />
      </div>

      {/* Badge Showcase */}
      <BadgeShowcase maxDisplay={6} showStats={true} />

      {/* Learning Actions Section */}
      <SuggestedActionsCard />

      {/* Pending Work Alert */}
      {(stats?.pendingEvaluations || stats?.ocrReviewsPending) ? (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                <ClipboardCheck className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Work Pending</p>
                <p className="text-sm text-muted-foreground">
                  You have {stats?.pendingEvaluations || 0} evaluations
                  {stats?.ocrReviewsPending ? ` and ${stats.ocrReviewsPending} OCR reviews` : ""} pending.
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/evaluations")}>
                Start Evaluating
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
      <div>
        <Skeleton className="h-7 sm:h-8 w-48 sm:w-64" />
        <Skeleton className="h-4 w-40 sm:w-48 mt-2" />
      </div>
      <Skeleton className="h-36 w-full rounded-3xl" />
      <div className="grid gap-3 grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
