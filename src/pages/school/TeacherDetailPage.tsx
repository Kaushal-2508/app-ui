import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { ArrowLeft, Users, GraduationCap, Target, CheckCircle, BookOpen, AlertTriangle } from "lucide-react";
import { useTeacherDetailAnalytics } from "@/hooks/useTeacherDetailAnalytics";

import { formatNumber } from "@/lib/formatNumber";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell,
} from "recharts";

const COLORS = ["#10B981", "#3B82F6", "#F59E0B", "#EF4444"];

export default function TeacherDetailPage() {
  const { teacherId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useTeacherDetailAnalytics(teacherId);

  if (isLoading) {
    return (
      <>
        <div className="space-y-6 p-6">
          <Skeleton className="h-8 w-64 rounded-xl" />
          <div className="grid grid-cols-5 gap-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Teacher not found.</p>
          <Button variant="ghost" onClick={() => navigate("/dashboard?tab=teachers")} className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Teachers</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard?tab=teachers")} className="rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Teachers
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{data.teacherName}</h1>
            <p className="text-muted-foreground">Teacher Performance Analytics</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <GradientKPICard icon={GraduationCap} value={formatNumber(data.classesTeaching)} label="Classes Teaching" variant="purple" />
          <GradientKPICard icon={Users} value={formatNumber(data.totalStudents)} label="Total Students" variant="indigo" />
          <GradientKPICard icon={Target} value={`${data.averageAccuracy.toFixed(1)}%`} label="Average Accuracy" variant="blue" />
          <GradientKPICard icon={CheckCircle} value={`${data.passRate.toFixed(0)}%`} label="Pass Rate" variant="emerald" />
          <GradientKPICard icon={BookOpen} value={formatNumber(data.examsCreated)} label="Exams Created" variant="orange" />
        </div>

        {/* Charts Row 1 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Class-wise Performance */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/40 to-transparent dark:from-blue-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Class-wise Performance</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.classPerformance}>
                    <defs>
                      <linearGradient id="tcAccGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366F1" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#818CF8" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="tcPrGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#34D399" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="className" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                    <Legend />
                    <Bar dataKey="accuracy" name="Accuracy" fill="url(#tcAccGrad)" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="passRate" name="Pass Rate" fill="url(#tcPrGrad)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Subject Radar */}
          {data.subjectRadar.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-50/40 to-transparent dark:from-purple-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Subject Expertise</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={data.subjectRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar dataKey="average" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.3} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Charts Row 2 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Student Distribution */}
          {data.studentDistribution.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Student Distribution by Class</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.studentDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="className" tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip contentStyle={{ borderRadius: "12px" }} />
                      <Legend />
                      <Bar dataKey="excellent" name="Excellent" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="good" name="Good" stackId="a" fill="#3B82F6" />
                      <Bar dataKey="average" name="Average" stackId="a" fill="#F59E0B" />
                      <Bar dataKey="atRisk" name="At Risk" stackId="a" fill="#EF4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Performance Trend */}
          {data.performanceTrend.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/30 to-transparent dark:from-cyan-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Performance Trend</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.performanceTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="exam" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                      <Line type="monotone" dataKey="average" stroke="#06B6D4" strokeWidth={3} dot={{ fill: "#06B6D4", r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Class Breakdown Table */}
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 to-transparent dark:from-indigo-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">Class Breakdown</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">Class</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Subject</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Students</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Avg Score</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Pass Rate</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.classBreakdown.map((c, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 font-medium">{c.className}</td>
                      <td className="py-2.5">{c.subject}</td>
                      <td className="py-2.5 text-center">{c.students}</td>
                      <td className="py-2.5 text-center">
                        <Badge className={`rounded-lg border-0 text-white ${c.avgScore >= 70 ? "bg-gradient-to-r from-emerald-500 to-green-600" : c.avgScore >= 50 ? "bg-gradient-to-r from-blue-500 to-indigo-600" : "bg-gradient-to-r from-rose-500 to-red-600"}`}>
                          {c.avgScore.toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="py-2.5 text-center">{c.passRate.toFixed(0)}%</td>
                      <td className="py-2.5 text-center">
                        <Badge variant="outline" className="rounded-lg text-xs">{c.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* At-Risk Students */}
        {data.atRiskStudents.length > 0 && (
          <Card className="rounded-2xl border-rose-200/50 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-rose-50/40 to-transparent dark:from-rose-950/10" />
            <CardHeader className="relative">
              <CardTitle className="text-base flex items-center gap-2 text-rose-700 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4" /> At-Risk Students
              </CardTitle>
            </CardHeader>
            <CardContent className="relative">
              <div className="grid md:grid-cols-2 gap-3">
                {data.atRiskStudents.map((s, i) => (
                  <div key={i} className="p-3 rounded-xl bg-gradient-to-r from-rose-500/10 to-red-500/10 border border-rose-200/30">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.className}</p>
                      </div>
                      <Badge className="rounded-lg bg-gradient-to-r from-rose-500 to-red-600 text-white border-0">{s.accuracy.toFixed(0)}%</Badge>
                    </div>
                    <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{s.issues}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
