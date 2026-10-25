import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { ArrowLeft, Target, CheckCircle, Users, BookOpen, AlertTriangle, TrendingUp } from "lucide-react";
import { useClassDetailAnalytics } from "@/hooks/useClassDetailAnalytics";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

import { formatNumber } from "@/lib/formatNumber";
import { getDisplaySection } from "@/lib/sectionDisplay";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

export default function ClassDetailPage() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useClassDetailAnalytics(classId);

  if (isLoading) {
    return (
      <>
        <div className="space-y-6 p-6">
          <Skeleton className="h-8 w-64 rounded-xl" />
          <div className="grid grid-cols-5 gap-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
          <div className="grid grid-cols-2 gap-4">{[1,2].map(i => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Class not found.</p>
          <Button variant="ghost" onClick={() => navigate("/dashboard?tab=classes")} className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Classes</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard?tab=classes")} className="rounded-xl">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Classes
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{data.className} - Section {getDisplaySection(data.className, data.section) ?? data.section}</h1>
            <p className="text-muted-foreground">Comprehensive Class Analytics</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <GradientKPICard icon={Target} value={`${data.classAverage.toFixed(1)}%`} label="Class Average" variant="blue" />
          <GradientKPICard icon={CheckCircle} value={`${data.passRate.toFixed(0)}%`} label="Pass Rate" variant="emerald" />
          <GradientKPICard icon={Users} value={formatNumber(data.totalStudents)} label="Total Students" variant="indigo" />
          <GradientKPICard icon={BookOpen} value={formatNumber(data.totalExams)} label="Total Exams" variant="purple" />
          <GradientKPICard icon={AlertTriangle} value={formatNumber(data.atRiskStudents)} label="At-Risk Students" variant="red" />
        </div>

        {/* Charts Row 1 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Score Distribution */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Score Distribution</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.scoreDistribution}>
                    <defs>
                      {data.scoreDistribution.map((d, i) => (
                        <linearGradient key={i} id={`scoreFill${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={d.fill} stopOpacity={0.9} />
                          <stop offset="100%" stopColor={d.fill} stopOpacity={0.5} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip contentStyle={{ borderRadius: "12px" }} />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                      {data.scoreDistribution.map((_, i) => <Cell key={i} fill={`url(#scoreFill${i})`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Student Distribution Donut */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Student Distribution</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.studentDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} label={({ name, value }) => `${name}: ${value}`}>
                      {data.studentDistribution.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Subject-wise Average */}
          {data.subjectAverages.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/40 to-transparent dark:from-cyan-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Subject-wise Average</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.subjectAverages} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis dataKey="subject" type="category" width={80} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                      <Bar dataKey="average" radius={[0, 8, 8, 0]}>
                        {data.subjectAverages.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Performance Trend */}
          {data.performanceTrend.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50/40 to-transparent dark:from-blue-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Performance Trend</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.performanceTrend}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366F1" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#6366F1" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="exam" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                      <Line type="monotone" dataKey="average" stroke="#6366F1" strokeWidth={3} dot={{ fill: "#6366F1", r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Student Rank Table */}
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50/30 to-transparent dark:from-amber-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">Student Rankings</CardTitle><CardDescription>{data.studentRanks.length} students</CardDescription></CardHeader>
          <CardContent className="relative">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">Rank</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Student</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Accuracy</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Avg Time/Q</th>
                  </tr>
                </thead>
                <tbody>
                  {data.studentRanks.slice(0, 20).map(s => (
                    <tr key={s.studentId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 font-bold">{s.rank <= 3 ? ["🥇","🥈","🥉"][s.rank-1] : `#${s.rank}`}</td>
                      <td className="py-2.5 font-medium">{s.name}</td>
                      <td className="py-2.5 text-center">
                        <Badge className={`rounded-lg ${s.accuracy >= 80 ? "bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" : s.accuracy >= 50 ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0" : "bg-gradient-to-r from-rose-500 to-red-600 text-white border-0"}`}>
                          {s.accuracy.toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge variant={s.passed ? "default" : "destructive"} className="rounded-lg">{s.passed ? "Pass" : "Fail"}</Badge>
                      </td>
                      <td className="py-2.5 text-center text-muted-foreground">{s.timePerQuestion.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Teacher-Subject & Exam History */}
        <div className="grid md:grid-cols-2 gap-6">
          {data.teacherSubjects.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-teal-50/30 to-transparent dark:from-teal-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Teachers & Subjects</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="space-y-3">
                  {data.teacherSubjects.map((t, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-teal-500/10 to-cyan-500/10 border border-teal-200/30">
                      <div>
                        <p className="font-medium text-sm">{t.teacherName}</p>
                        <p className="text-xs text-muted-foreground">{t.subject}</p>
                      </div>
                      <Badge className="rounded-lg bg-gradient-to-r from-teal-500 to-cyan-600 text-white border-0">{t.avgScore.toFixed(0)}%</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.examHistory.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 to-transparent dark:from-indigo-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Exam History</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="space-y-3">
                  {data.examHistory.slice(0, 8).map((e, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/30">
                      <div>
                        <p className="font-medium text-sm">{e.title}</p>
                        <p className="text-xs text-muted-foreground">{e.date || "No date"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0">{e.avgScore.toFixed(0)}%</Badge>
                        <Badge variant="outline" className="rounded-lg text-xs capitalize">{e.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
