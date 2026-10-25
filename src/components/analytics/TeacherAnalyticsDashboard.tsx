import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  FileText, 
  ClipboardCheck,
  Users,
  Clock,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  BarChart3
} from "lucide-react";
import { useTeacherAnalytics } from "@/hooks/useAnalytics";
import { HomeworkAnalyticsSection } from "@/components/analytics/HomeworkAnalyticsSection";

export function TeacherAnalyticsDashboard() {
  const { data: analytics, isLoading } = useTeacherAnalytics();

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  if (!analytics) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No analytics data available yet.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Create and publish your first exam to see analytics here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Exam Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Exams"
          value={analytics.examStats.total}
          icon={FileText}
        />
        <StatCard
          title="Draft"
          value={analytics.examStats.draft}
          icon={FileText}
          variant="secondary"
        />
        <StatCard
          title="Published"
          value={analytics.examStats.published}
          icon={FileText}
          variant="blue"
        />
        <StatCard
          title="Active"
          value={analytics.examStats.active}
          icon={FileText}
          variant="green"
        />
        <StatCard
          title="Completed"
          value={analytics.examStats.completed}
          icon={CheckCircle2}
        />
      </div>

      {/* Homework & Assignment marks — separate block, role-scoped server-side. */}
      <HomeworkAnalyticsSection />

      {/* Pending Workload Alert */}
      {(analytics.pendingWorkload.evaluations > 0 || analytics.pendingWorkload.ocrReviews > 0) && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
              <div className="flex-1">
                <p className="font-medium">Pending Work</p>
                <p className="text-sm text-muted-foreground">
                  {analytics.pendingWorkload.evaluations} evaluations
                  {analytics.pendingWorkload.ocrReviews > 0 && `, ${analytics.pendingWorkload.ocrReviews} OCR reviews`}
                  {analytics.pendingWorkload.tasks > 0 && `, ${analytics.pendingWorkload.tasks} tasks`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evaluation Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Evaluation Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.evaluationProgress.length > 0 ? (
            <div className="space-y-4">
              {analytics.evaluationProgress.map((exam) => (
                <div key={exam.examId}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate max-w-[60%]">
                      {exam.examTitle}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {exam.evaluated}/{exam.totalAttempts} evaluated
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={exam.progress} className="flex-1 h-2" />
                    <Badge 
                      variant={exam.progress === 100 ? "default" : "secondary"}
                      className="w-16 justify-center"
                    >
                      {exam.progress.toFixed(0)}%
                    </Badge>
                  </div>
                  {exam.pending > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      {exam.pending} pending
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No active evaluations.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Class Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Class Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.classPerformance.length > 0 ? (
            <div className="space-y-4">
              {analytics.classPerformance.map((cls, idx) => (
                <div key={idx} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{cls.name}</span>
                    <Badge variant="outline">{cls.attempts} attempts</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Score</p>
                      <p className={`text-lg font-bold ${
                        cls.avgScore >= 70 ? 'text-green-600' : 
                        cls.avgScore >= 50 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {cls.avgScore.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pass Rate</p>
                      <p className={`text-lg font-bold ${
                        cls.passRate >= 70 ? 'text-green-600' : 
                        cls.passRate >= 50 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {cls.passRate.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No class performance data available.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Workload Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workload Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-amber-600">
                {analytics.pendingWorkload.evaluations}
              </p>
              <p className="text-sm text-muted-foreground">Pending Evaluations</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold text-blue-600">
                {analytics.pendingWorkload.ocrReviews}
              </p>
              <p className="text-sm text-muted-foreground">OCR Reviews</p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-2xl font-bold">
                {analytics.pendingWorkload.tasks}
              </p>
              <p className="text-sm text-muted-foreground">Open Tasks</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon,
  variant = "default"
}: { 
  title: string; 
  value: number; 
  icon: typeof FileText;
  variant?: "default" | "secondary" | "blue" | "green";
}) {
  const colors = {
    default: "",
    secondary: "text-muted-foreground",
    blue: "text-blue-600",
    green: "text-green-600",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colors[variant]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}
