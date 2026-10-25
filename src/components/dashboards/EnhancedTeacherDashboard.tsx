import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Users, 
  Target, 
  Clock, 
  Zap,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ArrowRight,
  Lightbulb,
  BookOpen,
  AlertTriangle,
  Award
} from "lucide-react";
import { useTeacherClassOverview, useStudentDrilldown } from "@/hooks/useTeacherDashboard";
import { PerformanceDistributionChart } from "@/components/charts/PerformanceDistributionChart";
import { QuadrantScatterPlot } from "@/components/charts/QuadrantScatterPlot";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

interface EnhancedTeacherDashboardProps {
  teacherId: string | null;
  teacherName?: string;
}

export function EnhancedTeacherDashboard({ teacherId, teacherName }: EnhancedTeacherDashboardProps) {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const { data: overview, isLoading } = useTeacherClassOverview(teacherId, selectedClassId);
  const { data: studentDrilldown } = useStudentDrilldown(selectedStudentId);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!teacherId || !overview) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Select a teacher to view their dashboard.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Teacher Dashboard
          </h2>
          {teacherName && <p className="text-muted-foreground">{teacherName}</p>}
        </div>
        <div className="flex items-center gap-3">
          {overview.classes.length > 1 && (
            <Select value={selectedClassId || "all"} onValueChange={(v) => setSelectedClassId(v === "all" ? null : v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {overview.classes.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge variant="outline">{overview.classes.length} Classes</Badge>
          <Badge variant="outline">{overview.totalStudents} Students</Badge>
        </div>
      </div>

      <Tabs defaultValue="class-overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="class-overview">Class Overview</TabsTrigger>
          <TabsTrigger value="student-drilldown" disabled={!selectedStudentId}>
            Student Drilldown
          </TabsTrigger>
        </TabsList>

        <TabsContent value="class-overview" className="space-y-6">
          {/* Summary Cards - Now includes Topper */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Class Accuracy</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${
                  overview.overallAccuracy >= 70 ? "text-green-600" :
                  overview.overallAccuracy >= 50 ? "text-amber-600" : "text-red-600"
                }`}>
                  {overview.overallAccuracy.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">across all students</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Time/Question</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {overview.overallAvgTime.toFixed(1)}s
                </div>
                <p className="text-xs text-muted-foreground">average response time</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Top Performer</CardTitle>
                <Award className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">
                  {overview.topperAccuracy.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">highest accuracy</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Class Efficiency</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${
                  overview.overallEfficiency >= 3 ? "text-green-600" : 
                  overview.overallEfficiency >= 2 ? "text-amber-600" : "text-red-600"
                }`}>
                  {overview.overallEfficiency.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">accuracy / time ratio</p>
              </CardContent>
            </Card>
          </div>

          {/* Score Distribution Chart */}
          {overview.scoreDistribution.length > 0 && (
            <PerformanceDistributionChart
              data={overview.scoreDistribution}
              title="Performance Distribution"
              description="Click a bar to see student names in that range"
            />
          )}

          {/* Time vs Accuracy Quadrant Scatter Plot */}
          {overview.scatterData.length > 0 && (
            <QuadrantScatterPlot
              data={overview.scatterData}
              title="Time vs Accuracy Analysis"
              description="Click on a dot to view student details"
              xLabel="Avg Time (seconds)"
              yLabel="Accuracy %"
              xMidline={overview.overallAvgTime}
              yMidline={overview.overallAccuracy}
              onPointClick={(point) => {
                if (point.id) setSelectedStudentId(point.id);
              }}
            />
          )}

          {/* Subject-wise Breakdown */}
          {overview.subjectBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Subject-Wise Breakdown
                </CardTitle>
                <CardDescription>Performance by subject with efficiency metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Subject</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Accuracy</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Time</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Efficiency</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.subjectBreakdown.map((subject, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-3 font-medium">{subject.subject}</td>
                          <td className="py-3 text-center">
                            <Badge variant={subject.avgAccuracy >= 70 ? "default" : subject.avgAccuracy >= 50 ? "secondary" : "destructive"}>
                              {subject.avgAccuracy.toFixed(1)}%
                            </Badge>
                          </td>
                          <td className="py-3 text-center text-muted-foreground">
                            {subject.avgTime.toFixed(1)}s
                          </td>
                          <td className="py-3 text-center text-muted-foreground">
                            {subject.efficiency.toFixed(2)}
                          </td>
                          <td className="py-3 text-center">
                            {subject.isHighTime ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-600">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                High Time
                              </Badge>
                            ) : subject.avgAccuracy >= subject.classAvg ? (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                Good
                              </Badge>
                            ) : (
                              <Badge variant="outline">Average</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Underperformers Table */}
          {overview.underperformers.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30 dark:bg-amber-950/10">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  Students Needing Attention ({overview.underperformers.length})
                </CardTitle>
                <CardDescription>
                  Students with accuracy 10% below class average OR taking 20% more time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Student</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Accuracy</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Time</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Issue</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.underperformers.map((student, idx) => (
                        <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-3 font-medium">{student.studentName}</td>
                          <td className="py-3 text-center">
                            <span className={student.accuracy < student.classAvgAccuracy - 10 ? "text-red-600" : ""}>
                              {student.accuracy.toFixed(1)}%
                            </span>
                            <span className="text-xs text-muted-foreground ml-1">
                              (avg: {student.classAvgAccuracy.toFixed(0)}%)
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            <span className={student.avgTime > student.classAvgTime * 1.2 ? "text-amber-600" : ""}>
                              {student.avgTime.toFixed(1)}s
                            </span>
                            <span className="text-xs text-muted-foreground ml-1">
                              (avg: {student.classAvgTime.toFixed(0)}s)
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            <Badge variant={student.issue === "both" ? "destructive" : student.issue === "low_accuracy" ? "destructive" : "secondary"}>
                              {student.issue === "both" ? "Accuracy & Speed" : 
                               student.issue === "low_accuracy" ? "Low Accuracy" : "Slow"}
                            </Badge>
                          </td>
                          <td className="py-3 text-center">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => setSelectedStudentId(student.studentId)}
                            >
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Student Performance Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Students</CardTitle>
              <CardDescription>Click a row to drill down into student details</CardDescription>
            </CardHeader>
            <CardContent>
              {overview.studentPerformance.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Student</th>
                        <th className="text-left py-2 text-sm font-medium text-muted-foreground">Class</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Accuracy</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Avg Time</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Efficiency</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">vs Class</th>
                        <th className="text-center py-2 text-sm font-medium text-muted-foreground">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.studentPerformance.map((student) => (
                        <tr 
                          key={student.studentId} 
                          className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                          onClick={() => setSelectedStudentId(student.studentId)}
                        >
                          <td className="py-3 font-medium">{student.studentName}</td>
                          <td className="py-3 text-muted-foreground">{student.className}</td>
                          <td className="py-3 text-center">
                            <Badge variant={
                              student.accuracy >= 70 ? "default" : 
                              student.accuracy >= 50 ? "secondary" : "destructive"
                            }>
                              {student.accuracy.toFixed(0)}%
                            </Badge>
                          </td>
                          <td className="py-3 text-center text-muted-foreground">{student.avgTime.toFixed(1)}s</td>
                          <td className="py-3 text-center text-muted-foreground">{student.efficiency.toFixed(2)}</td>
                          <td className="py-3 text-center">
                            <span className={student.deviation >= 0 ? "text-green-600" : "text-red-600"}>
                              {student.deviation >= 0 ? "+" : ""}{student.deviation.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 text-center">
                            <Button variant="ghost" size="sm">
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No student performance data available yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student-drilldown" className="space-y-6">
          {studentDrilldown && (
            <>
              {/* Student Header */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <h3 className="text-lg font-bold">{studentDrilldown.profile?.full_name}</h3>
                      <p className="text-muted-foreground">{studentDrilldown.profile?.email}</p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <p className={`text-2xl font-bold ${
                          studentDrilldown.overallAccuracy >= 70 ? "text-green-600" :
                          studentDrilldown.overallAccuracy >= 50 ? "text-amber-600" : "text-red-600"
                        }`}>
                          {studentDrilldown.overallAccuracy.toFixed(0)}%
                        </p>
                        <p className="text-xs text-muted-foreground">Accuracy</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{studentDrilldown.overallEfficiency.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Efficiency</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Class Avg: {overview.overallAccuracy.toFixed(0)}%</p>
                        <p className={`text-sm font-medium ${
                          studentDrilldown.overallAccuracy >= overview.overallAccuracy ? "text-green-600" : "text-red-600"
                        }`}>
                          {studentDrilldown.overallAccuracy >= overview.overallAccuracy ? "+" : ""}
                          {(studentDrilldown.overallAccuracy - overview.overallAccuracy).toFixed(1)}% deviation
                        </p>
                      </div>
                      <div className="text-center flex items-center gap-1">
                        {studentDrilldown.isImproving ? (
                          <TrendingUp className="h-5 w-5 text-green-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-red-600" />
                        )}
                        <span className="text-xs text-muted-foreground">Trend</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Performance Trend Chart */}
              {studentDrilldown.trendData.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Performance Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={studentDrilldown.trendData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="examNumber" tick={{ fontSize: 12 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                          <Tooltip 
                            formatter={(value: number, name: string) => [
                              name === "accuracy" ? `${value.toFixed(1)}%` : value.toFixed(2),
                              name === "accuracy" ? "Accuracy" : "Efficiency"
                            ]}
                            labelFormatter={(label, payload) => payload[0]?.payload?.examTitle || `Exam ${label}`}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="accuracy" 
                            stroke="hsl(var(--primary))" 
                            strokeWidth={2}
                            dot={{ fill: "hsl(var(--primary))" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Strengths & Weaknesses */}
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-green-600">
                      <TrendingUp className="h-4 w-4" />
                      Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {studentDrilldown.strengths.length > 0 ? (
                      <div className="space-y-3">
                        {studentDrilldown.strengths.map((s, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span>{s.topic}</span>
                              <span className="font-medium text-green-600">{s.accuracy.toFixed(0)}%</span>
                            </div>
                            <Progress value={s.accuracy} className="h-2" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No strong areas identified yet.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                      <TrendingDown className="h-4 w-4" />
                      Needs Improvement
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {studentDrilldown.weaknesses.length > 0 ? (
                      <div className="space-y-3">
                        {studentDrilldown.weaknesses.map((w, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span>{w.topic}</span>
                              <span className="font-medium text-amber-600">{w.accuracy.toFixed(0)}%</span>
                            </div>
                            <Progress value={w.accuracy} className="h-2" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Great job! No weak areas identified.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Remedial Suggestions */}
              {studentDrilldown.suggestions.length > 0 && (
                <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-blue-700 dark:text-blue-400">
                      <Lightbulb className="h-4 w-4" />
                      Suggested Remedial Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {studentDrilldown.suggestions.map((suggestion, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-300">
                          <span className="font-bold">•</span>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Button variant="outline" onClick={() => setSelectedStudentId(null)}>
                ← Back to Class Overview
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
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-80" />
      <Skeleton className="h-48" />
    </div>
  );
}
