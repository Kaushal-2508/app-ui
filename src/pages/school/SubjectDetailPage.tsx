import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BookOpen, Users, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useSubjectDetailAnalytics } from "@/hooks/useSubjectDetailAnalytics";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";

import { formatNumber } from "@/lib/formatNumber";
import { getDisplaySection } from "@/lib/sectionDisplay";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, Cell,
} from "recharts";

export default function SubjectDetailPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { institutionId } = useEffectiveInstitution();
  const { data, isLoading } = useSubjectDetailAnalytics(subjectId, institutionId);
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [teacherFilter, setTeacherFilter] = useState<string | null>(null);

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
          <p className="text-muted-foreground">Subject not found.</p>
          <Button variant="ghost" onClick={() => navigate("/dashboard?tab=subjects")} className="mt-4"><ArrowLeft className="h-4 w-4 mr-2" />Back to Subjects</Button>
        </div>
      </>
    );
  }

  // Apply filters
  const filteredMatrix = data.classTeacherMatrix.filter(m => {
    if (gradeFilter && m.className !== gradeFilter) return false;
    if (teacherFilter && m.teacher !== teacherFilter) return false;
    return true;
  });

  return (
    <>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard?tab=subjects")} className="rounded-xl">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Subjects
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{data.subjectName}</h1>
              <p className="text-muted-foreground">Subject Performance Analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={gradeFilter || "all"} onValueChange={v => setGradeFilter(v === "all" ? null : v)}>
              <SelectTrigger className="w-[140px] rounded-xl text-xs h-8"><SelectValue placeholder="All Grades" /></SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">All Grades</SelectItem>
                {data.grades.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={teacherFilter || "all"} onValueChange={v => setTeacherFilter(v === "all" ? null : v)}>
              <SelectTrigger className="w-[160px] rounded-xl text-xs h-8"><SelectValue placeholder="All Teachers" /></SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">All Teachers</SelectItem>
                {data.teachers.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <GradientKPICard icon={BookOpen} value={formatNumber(data.totalClasses)} label="Total Classes" variant="purple" />
          <GradientKPICard icon={Users} value={formatNumber(data.totalTeachers)} label="Total Teachers" variant="indigo" />
          <GradientKPICard icon={Target} value={`${data.schoolAverage.toFixed(1)}%`} label="School Average" variant="blue" />
          <GradientKPICard icon={TrendingUp} value={`${data.highestClassAverage.toFixed(1)}%`} label="Highest Class" variant="emerald" />
          <GradientKPICard icon={TrendingDown} value={`${data.lowestClassAverage.toFixed(1)}%`} label="Lowest Class" variant="red" />
        </div>

        {/* Charts Row 1 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Class Comparison */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Class Comparison</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.classComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="className" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                    <Bar dataKey="average" radius={[8, 8, 0, 0]}>
                      {data.classComparison.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Teacher Comparison */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/40 to-transparent dark:from-cyan-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Teacher Comparison</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.teacherComparison} layout="vertical">
                    <defs>
                      <linearGradient id="subjTeacherGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis dataKey="teacherName" type="category" width={90} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                    <Bar dataKey="average" fill="url(#subjTeacherGrad)" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Score Distribution */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-50/30 to-transparent dark:from-amber-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base">Score Distribution</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.scoreDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip contentStyle={{ borderRadius: "12px" }} />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                      {data.scoreDistribution.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Trend Line */}
          {data.trendLine.length > 0 && (
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10" />
              <CardHeader className="relative"><CardTitle className="text-base">Performance Trend</CardTitle></CardHeader>
              <CardContent className="relative">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trendLine}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ borderRadius: "12px" }} />
                      <Line type="monotone" dataKey="average" stroke="#10B981" strokeWidth={3} dot={{ fill: "#10B981", r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Class-Teacher Matrix */}
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 to-transparent dark:from-blue-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">Class-Teacher Matrix</CardTitle><CardDescription>{filteredMatrix.length} entries</CardDescription></CardHeader>
          <CardContent className="relative">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">Class</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Section</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Teacher</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Students</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Avg Score</th>
                    <th className="text-center py-2 font-medium text-muted-foreground">Pass Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.map((m, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 font-medium">{m.className}</td>
                      <td className="py-2.5">{getDisplaySection(m.className, m.section) ?? m.section}</td>
                      <td className="py-2.5">{m.teacher}</td>
                      <td className="py-2.5 text-center">{m.studentCount}</td>
                      <td className="py-2.5 text-center">
                        <Badge className={`rounded-lg border-0 text-white ${m.avgScore >= 70 ? "bg-gradient-to-r from-emerald-500 to-green-600" : m.avgScore >= 50 ? "bg-gradient-to-r from-blue-500 to-indigo-600" : "bg-gradient-to-r from-rose-500 to-red-600"}`}>
                          {m.avgScore.toFixed(0)}%
                        </Badge>
                      </td>
                      <td className="py-2.5 text-center">{m.passRate.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Top & Bottom Students */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base text-emerald-700 dark:text-emerald-400">🏆 Top 5 Students</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="space-y-2">
                {data.topStudents.map((s, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-200/30">
                    <div>
                      <p className="font-medium text-sm">{["🥇","🥈","🥉","4️⃣","5️⃣"][i]} {s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.className}</p>
                    </div>
                    <Badge className="rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0">{s.accuracy.toFixed(0)}%</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-rose-50/30 to-transparent dark:from-rose-950/10" />
            <CardHeader className="relative"><CardTitle className="text-base text-rose-700 dark:text-rose-400">⚠️ Bottom 5 Students</CardTitle></CardHeader>
            <CardContent className="relative">
              <div className="space-y-2">
                {data.bottomStudents.map((s, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-gradient-to-r from-rose-500/10 to-red-500/10 border border-rose-200/30">
                    <div>
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.className}</p>
                    </div>
                    <Badge className="rounded-lg bg-gradient-to-r from-rose-500 to-red-600 text-white border-0">{s.accuracy.toFixed(0)}%</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
