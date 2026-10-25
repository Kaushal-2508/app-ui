import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Building2, 
  Users,
  FileText,
  TrendingUp,
  BarChart3,
  Activity,
  PieChart,
  ShieldCheck,
  AlertTriangle
} from "lucide-react";
import { useSuperAdminAnalytics } from "@/hooks/useAnalytics";

export function SuperAdminAnalyticsDashboard() {
  const { data: analytics, isLoading } = useSuperAdminAnalytics();

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }

  if (!analytics) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No analytics data available.</p>
        <p className="text-sm text-muted-foreground mt-2">
          Analytics will appear once institutions, users, and exams are created.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* System Usage Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <StatCard
          title="Institutions"
          value={analytics.systemUsage.totalInstitutions}
          subtitle={`${analytics.systemUsage.activeInstitutions} active`}
          icon={Building2}
        />
        <StatCard
          title="Total Users"
          value={analytics.systemUsage.totalUsers}
          icon={Users}
        />
        <StatCard
          title="Total Exams"
          value={analytics.systemUsage.totalExams}
          icon={FileText}
        />
        <StatCard
          title="Attempts"
          value={analytics.systemUsage.totalAttempts}
          icon={Activity}
        />
        <StatCard
          title="Evaluated"
          value={analytics.systemUsage.completedEvaluations}
          icon={TrendingUp}
        />
        <StatCard
          title="Active Rate"
          value={`${analytics.systemUsage.activeRate?.toFixed(0) || 0}%`}
          icon={BarChart3}
        />
      </div>

      {/* Role Distribution & Integrity Metrics */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Role Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              User Role Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-center">
              <RoleCard label="Super Admins" count={analytics.roleDistribution.super_admin} color="purple" />
              <RoleCard label="School Admins" count={analytics.roleDistribution.school_admin} color="blue" />
              <RoleCard label="Coordinators" count={analytics.roleDistribution.coordinator} color="cyan" />
              <RoleCard label="Teachers" count={analytics.roleDistribution.teacher} color="green" />
              <RoleCard label="Students" count={analytics.roleDistribution.student} color="amber" />
            </div>
          </CardContent>
        </Card>

        {/* System Integrity Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              System Integrity
            </CardTitle>
            <CardDescription>Proctoring metrics across all institutions</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.integrityMetrics && analytics.integrityMetrics.totalProctoringSessions > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xl font-bold">{analytics.integrityMetrics.totalProctoringSessions}</p>
                    <p className="text-xs text-muted-foreground">Total Sessions</p>
                  </div>
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                    <p className="text-xl font-bold text-amber-600">{analytics.integrityMetrics.flaggedSessions}</p>
                    <p className="text-xs text-muted-foreground">Flagged</p>
                  </div>
                  <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                    <p className="text-xl font-bold text-green-600">{analytics.integrityMetrics.reviewedSessions}</p>
                    <p className="text-xs text-muted-foreground">Reviewed</p>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <p className="text-xl font-bold text-blue-600">
                      {analytics.integrityMetrics.flagRate?.toFixed(1) || 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">Flag Rate</p>
                  </div>
                </div>
                {analytics.integrityMetrics.totalHighSeverity > 0 && (
                  <div className="mt-3 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <span className="text-xs text-red-700 dark:text-red-400">
                      {analytics.integrityMetrics.totalHighSeverity} high severity events system-wide
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No proctoring sessions yet.</p>
                <p className="text-xs mt-1">Proctoring data will appear when exams with proctoring are taken.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Growth Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Monthly Growth (Last 6 Months)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-sm font-medium text-muted-foreground">Month</th>
                  <th className="text-center py-2 text-sm font-medium text-muted-foreground">New Institutions</th>
                  <th className="text-center py-2 text-sm font-medium text-muted-foreground">New Users</th>
                  <th className="text-center py-2 text-sm font-medium text-muted-foreground">New Exams</th>
                </tr>
              </thead>
              <tbody>
                {analytics.monthlyGrowth.map((month, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-3 font-medium">{month.month}</td>
                    <td className="py-3 text-center">
                      <Badge variant={month.institutions > 0 ? "default" : "secondary"}>
                        +{month.institutions}
                      </Badge>
                    </td>
                    <td className="py-3 text-center">
                      <Badge variant={month.users > 0 ? "default" : "secondary"}>
                        +{month.users}
                      </Badge>
                    </td>
                    <td className="py-3 text-center">
                      <Badge variant={month.exams > 0 ? "default" : "secondary"}>
                        +{month.exams}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Institution Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Institution Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.institutionStats.length > 0 ? (
            <div className="space-y-3">
              {analytics.institutionStats.map((inst) => (
                <div key={inst.id} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{inst.name}</span>
                    </div>
                    <Badge variant={inst.isActive ? "default" : "secondary"}>
                      {inst.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-lg font-bold">{inst.userCount}</p>
                      <p className="text-xs text-muted-foreground">Users</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{inst.teacherCount}</p>
                      <p className="text-xs text-muted-foreground">Teachers</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{inst.studentCount}</p>
                      <p className="text-xs text-muted-foreground">Students</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{inst.examCount}</p>
                      <p className="text-xs text-muted-foreground">Exams</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No institutions registered yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  subtitle,
  icon: Icon
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: typeof Building2;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RoleCard({ label, count, color }: { label: string; count: number; color: string }) {
  const bgColors: Record<string, string> = {
    purple: "bg-purple-50 dark:bg-purple-950/20",
    blue: "bg-blue-50 dark:bg-blue-950/20",
    cyan: "bg-cyan-50 dark:bg-cyan-950/20",
    green: "bg-green-50 dark:bg-green-950/20",
    amber: "bg-amber-50 dark:bg-amber-950/20",
  };

  const textColors: Record<string, string> = {
    purple: "text-purple-600",
    blue: "text-blue-600",
    cyan: "text-cyan-600",
    green: "text-green-600",
    amber: "text-amber-600",
  };

  return (
    <div className={`p-3 rounded-lg ${bgColors[color]}`}>
      <p className={`text-xl font-bold ${textColors[color]}`}>{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}
