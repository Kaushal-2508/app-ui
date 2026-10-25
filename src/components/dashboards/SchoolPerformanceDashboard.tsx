import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  School, 
  Users, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  BarChart3,
  ArrowRight,
  BookOpen
} from "lucide-react";
import { useSchoolPerformanceOverview, useSchoolPerformanceDrilldown } from "@/hooks/useSchoolPerformance";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { formatClassName } from "@/lib/utils";

interface SchoolPerformanceDashboardProps {
  institutionId: string | null;
  institutionName?: string;
}

export function SchoolPerformanceDashboard({ institutionId, institutionName }: SchoolPerformanceDashboardProps) {
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const { data: overview, isLoading } = useSchoolPerformanceOverview(institutionId);
  const { data: drilldown } = useSchoolPerformanceDrilldown(institutionId, selectedClassId);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!institutionId || !overview) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <School className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Select an institution to view School Performance.</p>
        </CardContent>
      </Card>
    );
  }

  const getHeatmapColor = (accuracy: number) => {
    if (accuracy >= 80) return "bg-green-500";
    if (accuracy >= 60) return "bg-green-400";
    if (accuracy >= 50) return "bg-amber-400";
    if (accuracy >= 40) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <School className="h-5 w-5" />
            School Performance Overview
          </h2>
          {institutionName && (
            <p className="text-muted-foreground">{institutionName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{overview.totalClasses} Classes</Badge>
          <Badge variant="outline">{overview.totalTeachers} Teachers</Badge>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="drilldown" disabled={!selectedClassId}>
            Class Drilldown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Grade-Section Performance Heatmap */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Grade-Section Performance Heatmap
              </CardTitle>
              <CardDescription>Click a class to drill down</CardDescription>
            </CardHeader>
            <CardContent>
              {overview.gradePerformance.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {overview.gradePerformance.map((cls, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedClassId(Object.keys(cls)[0] || null)}
                      className={`p-4 rounded-lg text-white text-center transition-transform hover:scale-105 ${getHeatmapColor(cls.avgAccuracy)}`}
                    >
                      <p className="font-bold text-lg">{cls.avgAccuracy.toFixed(0)}%</p>
                      <p className="text-xs opacity-90">{cls.name}</p>
                      <p className="text-xs opacity-75">{cls.studentCount} students</p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No performance data available yet.
                </p>
              )}
              <div className="flex items-center justify-center gap-4 mt-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-500" />
                  <span>≥80%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-green-400" />
                  <span>60-79%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-amber-400" />
                  <span>50-59%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-amber-500" />
                  <span>40-49%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-red-500" />
                  <span>&lt;40%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Teacher Effectiveness Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Teacher Effectiveness Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overview.teacherEffectiveness.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Teacher</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Accuracy</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Pass Rate</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Exams Created</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Evaluations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.teacherEffectiveness.map((teacher) => (
                        <tr key={teacher.id} className="border-b last:border-0">
                          <td className="py-3 font-medium">{teacher.name}</td>
                          <td className="py-3 text-center">
                            <Badge variant={Number(teacher.avgAccuracy) >= 70 ? "default" : "secondary"}>
                              {Number(teacher.avgAccuracy).toFixed(0)}%
                            </Badge>
                          </td>
                          <td className="py-3 text-center">{Number(teacher.passRate).toFixed(0)}%</td>
                          <td className="py-3 text-center text-muted-foreground">{teacher.examsCreated}</td>
                          <td className="py-3 text-center text-muted-foreground">{teacher.evaluationsCompleted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No teacher data available.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Underperforming Classes Alert */}
          {overview.underperformingClasses.length > 0 && (
            <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  Underperforming Classes
                </CardTitle>
                <CardDescription className="text-red-600/80 dark:text-red-400/80">
                  Classes with accuracy below 50% require attention
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {overview.underperformingClasses.map((cls) => (
                    <div 
                      key={cls.id} 
                      className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-background"
                    >
                      <div>
                        <p className="font-medium">{cls.name}</p>
                        <p className="text-sm text-muted-foreground">{cls.studentCount} students</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-red-600">{cls.avgAccuracy.toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">accuracy</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedClassId(cls.id)}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Subject-wise Overview */}
          {overview.subjectPerformance.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Subject-wise Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {overview.subjectPerformance.map((subject, idx) => (
                    <div key={idx} className="p-4 rounded-lg bg-muted/50 text-center">
                      <p className="font-medium">{subject.name}</p>
                      <p className="text-sm text-muted-foreground">{subject.examCount} exams</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="drilldown" className="space-y-6">
          {drilldown && (
            <>
              {/* Class Header */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold">
                        {formatClassName(drilldown.classData?.name || "", drilldown.classData?.section)}
                      </h3>
                      <p className="text-muted-foreground">{drilldown.classData?.academic_year}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold">{drilldown.averageAccuracy.toFixed(0)}%</p>
                        <p className="text-xs text-muted-foreground">Avg Accuracy</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{drilldown.averageEfficiency.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Efficiency</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Score Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Score Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(drilldown.scoreDistribution).map(([range, count]) => ({
                        range,
                        count,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="hsl(var(--primary))">
                          {Object.entries(drilldown.scoreDistribution).map(([range], index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={
                                range === "81-100" ? "hsl(142 76% 36%)" :
                                range === "61-80" ? "hsl(142 76% 46%)" :
                                range === "41-60" ? "hsl(47 96% 53%)" :
                                range === "21-40" ? "hsl(32 95% 55%)" :
                                "hsl(0 84% 60%)"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Student Performance Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Student Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-sm font-medium text-muted-foreground">Student</th>
                          <th className="text-center py-2 text-sm font-medium text-muted-foreground">Accuracy</th>
                          <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Time</th>
                          <th className="text-center py-2 text-sm font-medium text-muted-foreground">Efficiency</th>
                          <th className="text-center py-2 text-sm font-medium text-muted-foreground">Q. Attempted</th>
                          <th className="text-center py-2 text-sm font-medium text-muted-foreground">Correct</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldown.studentPerformance.map((student) => (
                          <tr key={student.studentId} className="border-b last:border-0">
                            <td className="py-3 font-medium">{student.studentName}</td>
                            <td className="py-3 text-center">
                              <Badge variant={student.accuracy >= 70 ? "default" : student.accuracy >= 50 ? "secondary" : "destructive"}>
                                {student.accuracy.toFixed(0)}%
                              </Badge>
                            </td>
                            <td className="py-3 text-center text-muted-foreground">{student.avgTime.toFixed(1)}s</td>
                            <td className="py-3 text-center text-muted-foreground">{student.efficiency.toFixed(2)}</td>
                            <td className="py-3 text-center text-muted-foreground">{student.questionsAttempted}</td>
                            <td className="py-3 text-center text-muted-foreground">{student.questionsCorrect}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Button variant="outline" onClick={() => setSelectedClassId(null)}>
                ← Back to Overview
              </Button>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}