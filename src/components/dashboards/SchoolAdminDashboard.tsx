import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { 
  GraduationCap, 
  Users, 
  FileText,
  Calendar,
  AlertTriangle,
  School,
  BarChart3,
  ClipboardList,
  Plus,
  RefreshCw,
  TrendingUp,
  Percent
} from "lucide-react";
import { useSchoolAdminStats, useSchoolExams } from "@/hooks/useDashboardData";
import { useSchoolPerformanceMetrics } from "@/hooks/useSchoolPerformanceMetrics";
import { SchoolPerformanceDashboard } from "./SchoolPerformanceDashboard";
import { PerformanceRatingCard } from "./PerformanceRatingCard";
import { CreateTaskDialog } from "@/components/tms/CreateTaskDialog";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatNumber } from "@/lib/formatNumber";

interface SchoolAdminDashboardProps {
  institutionId: string | null;
}

export function SchoolAdminDashboard({ institutionId }: SchoolAdminDashboardProps) {
  const { data: stats, isLoading: statsLoading } = useSchoolAdminStats(institutionId);
  const { data: exams, isLoading: examsLoading } = useSchoolExams(institutionId);
  const { data: performanceMetrics, isLoading: metricsLoading } = useSchoolPerformanceMetrics(institutionId);
  const navigate = useNavigate();
  const [isRecomputing, setIsRecomputing] = useState(false);

  const handleRecomputeAnalytics = async () => {
    if (!institutionId) return;
    setIsRecomputing(true);
    try {
      await supabase.functions.invoke("compute-aggregates", {
        body: { institution_id: institutionId },
      });
      toast.success("Analytics recomputed successfully");
    } catch (error) {
      console.error("Failed to recompute analytics:", error);
      toast.error("Failed to recompute analytics");
    } finally {
      setIsRecomputing(false);
    }
  };

  if (statsLoading) {
    return <DashboardSkeleton />;
  }

  if (!institutionId) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
        <h3 className="font-medium">No Institution Assigned</h3>
        <p className="text-muted-foreground">Please contact support to be assigned to an institution.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <School className="h-5 w-5 sm:h-6 sm:w-6" />
            School Admin Dashboard
          </h2>
          <p className="text-sm text-muted-foreground">Institution overview, analytics, and management</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleRecomputeAnalytics}
            disabled={isRecomputing}
            className="flex-1 sm:flex-none"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRecomputing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRecomputing ? 'Recomputing...' : 'Refresh Analytics'}</span>
            <span className="sm:hidden">{isRecomputing ? '...' : 'Refresh'}</span>
          </Button>
          <CreateTaskDialog 
            institutionId={institutionId}
            trigger={
              <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                <ClipboardList className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Assign Task</span>
              </Button>
            } 
          />
          <Button size="sm" onClick={() => navigate("/exams/create")} className="flex-1 sm:flex-none">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Create Exam</span>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4 sm:space-y-6">
        <TabsList className="w-full grid grid-cols-2 sm:inline-flex sm:w-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="students" className="text-xs sm:text-sm">Students</TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs sm:text-sm">Tasks</TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs sm:text-sm">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 sm:space-y-6">
          {/* Performance Rating + Key Stats */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            <PerformanceRatingCard
              avgScorePercent={performanceMetrics?.avgScorePercent || 0}
              passRate={performanceMetrics?.passRate || 0}
              improvementRate={performanceMetrics?.improvementRate || 0}
              totalExamsEvaluated={performanceMetrics?.totalExamsEvaluated || 0}
              isLoading={metricsLoading}
            />
            <StatCard
              title="Total Exams"
              value={stats?.totalExams || 0}
              icon={FileText}
            />
            <StatCard
              title="Upcoming"
              value={stats?.upcomingExams || 0}
              icon={Calendar}
              variant="blue"
            />
            <StatCard
              title="Teachers"
              value={stats?.totalTeachers || 0}
              icon={Users}
            />
            <StatCard
              title="Students"
              value={stats?.totalStudents || 0}
              icon={GraduationCap}
            />
          </div>

          {/* Quick Performance Metrics */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Average Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  (performanceMetrics?.avgScorePercent || 0) >= 70 ? 'text-green-600' : 
                  (performanceMetrics?.avgScorePercent || 0) >= 50 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {(performanceMetrics?.avgScorePercent || 0).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across {formatNumber(performanceMetrics?.totalStudentsEvaluated || 0)} evaluations
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  Pass Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  (performanceMetrics?.passRate || 0) >= 70 ? 'text-green-600' : 
                  (performanceMetrics?.passRate || 0) >= 50 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {(performanceMetrics?.passRate || 0).toFixed(0)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Students meeting pass criteria
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  {(performanceMetrics?.improvementRate || 0) >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  Trend (30 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${
                  (performanceMetrics?.improvementRate || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {(performanceMetrics?.improvementRate || 0) >= 0 ? '+' : ''}
                  {(performanceMetrics?.improvementRate || 0).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  vs previous period
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Exam Status */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Exam Status Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <StatusRow label="Draft" count={stats?.examsByStatus.draft || 0} color="gray" />
                <StatusRow label="Published" count={stats?.examsByStatus.published || 0} color="blue" />
                <StatusRow label="Active" count={stats?.examsByStatus.active || 0} color="green" />
                <StatusRow label="Completed" count={stats?.examsByStatus.completed || 0} color="gray" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active Classes</span>
                  <span className="font-semibold">{formatNumber(stats?.totalClasses || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Pending Evaluation</span>
                  <span className="font-semibold text-amber-600">{formatNumber(stats?.pendingEvaluation || 0)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Exams */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Exams</CardTitle>
            </CardHeader>
            <CardContent>
              {examsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : exams && exams.length > 0 ? (
                <div className="space-y-2">
                  {exams.slice(0, 5).map((exam: any) => (
                    <div 
                      key={exam.id} 
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{exam.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs capitalize">
                            {exam.exam_mode}
                          </Badge>
                          {exam.scheduled_date && (
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(exam.scheduled_date), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                      <ExamStatusBadge status={exam.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">No exams found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="students">
          <StudentsSectionView institutionId={institutionId} />
        </TabsContent>

        <TabsContent value="tasks">
          <TasksSectionView institutionId={institutionId} />
        </TabsContent>

        <TabsContent value="analytics">
          {/* School Performance Dashboard with analytics */}
          <SchoolPerformanceDashboard institutionId={institutionId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Students Section View for School Admin Dashboard
function StudentsSectionView({ institutionId }: { institutionId: string }) {
  const navigate = useNavigate();
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Students Overview
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Manage student enrollment and view performance
          </p>
        </div>
        <Button onClick={() => navigate("/school/students")}>
          <Users className="h-4 w-4 mr-2" />
          Manage Students
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="p-4 border rounded-lg text-center">
            <GraduationCap className="h-8 w-8 mx-auto text-primary mb-2" />
            <p className="text-2xl font-bold">-</p>
            <p className="text-sm text-muted-foreground">Total Students</p>
          </div>
          <div className="p-4 border rounded-lg text-center">
            <FileText className="h-8 w-8 mx-auto text-blue-500 mb-2" />
            <p className="text-2xl font-bold">-</p>
            <p className="text-sm text-muted-foreground">Exams Attempted</p>
          </div>
          <div className="p-4 border rounded-lg text-center">
            <BarChart3 className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <p className="text-2xl font-bold">-</p>
            <p className="text-sm text-muted-foreground">Avg. Performance</p>
          </div>
        </div>
        <div className="mt-4 text-center">
          <Button variant="link" onClick={() => navigate("/school/students")}>
            View all students and their performance →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Tasks Section View for School Admin Dashboard
function TasksSectionView({ institutionId }: { institutionId: string }) {
  const navigate = useNavigate();
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Task Management System
          </h3>
          <p className="text-sm text-muted-foreground">
            Track and manage tasks across your institution
          </p>
        </div>
        <div className="flex gap-2">
          <CreateTaskDialog 
            institutionId={institutionId}
            trigger={
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Task
              </Button>
            } 
          />
        </div>
      </div>
      
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">-</p>
            <p className="text-sm text-muted-foreground">Open Tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">-</p>
            <p className="text-sm text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">-</p>
            <p className="text-sm text-muted-foreground">Pending Review</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">-</p>
            <p className="text-sm text-muted-foreground">Completed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-8 text-center">
          <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground mb-4">
            View and manage all tasks from the dedicated Task Management page
          </p>
          <Button onClick={() => navigate("/tasks")}>
            Go to Task Management
          </Button>
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
  variant?: "default" | "blue" | "green" | "amber";
}) {
  const colorClasses = {
    default: "",
    blue: "text-blue-600",
    green: "text-green-600",
    amber: "text-amber-600",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-1 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground truncate">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className={`text-xl sm:text-2xl font-bold ${colorClasses[variant]}`}>{formatNumber(value)}</div>
      </CardContent>
    </Card>
  );
}

function StatusRow({ label, count, color }: { label: string; count: number; color: string }) {
  const colorClasses: Record<string, string> = {
    gray: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <span className={`px-2 py-0.5 rounded text-sm font-medium ${colorClasses[color]}`}>
        {formatNumber(count)}
      </span>
    </div>
  );
}

function ExamStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "secondary",
    published: "default",
    active: "default",
    completed: "outline",
  };

  return (
    <Badge variant={variants[status] || "secondary"} className="capitalize text-xs">
      {status}
    </Badge>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Skeleton className="h-7 sm:h-8 w-48 sm:w-64" />
        <Skeleton className="h-4 w-40 sm:w-48 mt-2" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-20 sm:h-24" />
        ))}
      </div>
    </div>
  );
}
