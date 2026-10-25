import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Users,
  GraduationCap,
  BookOpen,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  Line,
  ComposedChart,
} from "recharts";
import { usePredictionAnalytics } from "@/hooks/usePredictionAnalytics";
import { toast } from "sonner";

interface PredictionsTabProps {
  institutionId: string | null;
}

export function PredictionsTab({ institutionId }: PredictionsTabProps) {
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");

  const {
    data,
    isLoading,
    aiPredictions,
    isLoadingAI,
    aiError,
    fetchAIInsights,
  } = usePredictionAnalytics(
    institutionId,
    gradeFilter !== "all" ? gradeFilter : null,
    sectionFilter !== "all" ? sectionFilter : null,
    subjectFilter !== "all" ? subjectFilter : null
  );

  const handleAIInsights = () => {
    if (!data?.classPredictions?.length) {
      toast.error("No data available to generate AI insights");
      return;
    }
    fetchAIInsights();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const filterOptions = data?.filterOptions || { grades: [], sections: [], subjects: [] };
  const classPredictions = data?.classPredictions || [];
  const studentPredictions = data?.studentPredictions || [];
  const teacherTrends = data?.teacherTrends || [];
  const subjectForecasts = data?.subjectForecasts || [];
  const scoreBuckets = data?.scoreBuckets || { "0-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };

  const atRiskStudents = studentPredictions.filter(s => s.trend === "declining").slice(0, 8);
  const improvingStudents = studentPredictions.filter(s => s.trend === "improving").slice(0, 8);

  const classChartData = classPredictions.map(c => ({
    name: c.className.length > 10 ? c.className.slice(0, 10) + "…" : c.className,
    fullName: c.className,
    Current: Math.round(c.currentAvg * 10) / 10,
    Predicted: Math.round(c.predictedAvg * 10) / 10,
    trend: c.trend,
  }));

  const bucketData = [
    { bucket: "0-40", count: scoreBuckets["0-40"], fill: "hsl(0 84% 60%)" },
    { bucket: "40-60", count: scoreBuckets["40-60"], fill: "hsl(38 92% 50%)" },
    { bucket: "60-80", count: scoreBuckets["60-80"], fill: "hsl(200 95% 50%)" },
    { bucket: "80-100", count: scoreBuckets["80-100"], fill: "hsl(152 68% 45%)" },
  ];

  const subjectChartData = subjectForecasts.map(s => ({
    name: s.subjectName.length > 12 ? s.subjectName.slice(0, 12) + "…" : s.subjectName,
    fullName: s.subjectName,
    Current: Math.round(s.currentAvg * 10) / 10,
    Predicted: Math.round(s.predictedAvg * 10) / 10,
    riskLevel: s.riskLevel,
  }));

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === "improving") return <TrendingUp className="h-4 w-4 text-emerald-500" />;
    if (trend === "declining") return <TrendingDown className="h-4 w-4 text-rose-500" />;
    return <Minus className="h-4 w-4 text-amber-500" />;
  };

  const ConfidenceDot = ({ confidence }: { confidence: string }) => {
    const color = confidence === "high" ? "bg-emerald-500" : confidence === "medium" ? "bg-amber-500" : "bg-rose-500";
    return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} title={`${confidence} confidence`} />;
  };

  const RiskBadge = ({ level }: { level: string }) => {
    if (level === "decline") return <Badge variant="destructive" className="text-[10px] px-1.5">Decline</Badge>;
    if (level === "watch") return <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 text-[10px] px-1.5">Watch</Badge>;
    return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 text-[10px] px-1.5">Stable</Badge>;
  };

  const noData = !classPredictions.length && !studentPredictions.length;

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <Card className="rounded-2xl">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Filters:</span>
            </div>
            <Select value={gradeFilter} onValueChange={(v) => { setGradeFilter(v); setSectionFilter("all"); setSubjectFilter("all"); }}>
              <SelectTrigger className="w-[140px] rounded-xl">
                <SelectValue placeholder="Grade" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">All Grades</SelectItem>
                {filterOptions.grades.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sectionFilter} onValueChange={(v) => { setSectionFilter(v); setSubjectFilter("all"); }}>
              <SelectTrigger className="w-[140px] rounded-xl">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">All Sections</SelectItem>
                {filterOptions.sections.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="w-[160px] rounded-xl">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all">All Subjects</SelectItem>
                {filterOptions.subjects.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="ml-auto">
              <Button
                onClick={handleAIInsights}
                disabled={isLoadingAI || noData}
                className="rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white"
              >
                {isLoadingAI ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {isLoadingAI ? "Analyzing…" : "Get AI Insights"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Outlook Banner */}
      {aiPredictions?.overallOutlook && (
        <Card className="rounded-2xl border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-violet-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm text-violet-700 dark:text-violet-300">AI Outlook</p>
                <p className="text-sm text-muted-foreground mt-1">{aiPredictions.overallOutlook}</p>
              </div>
              <Badge className="ml-auto shrink-0 bg-violet-500/10 text-violet-600 border-violet-200">
                Confidence: {Math.round((aiPredictions.confidenceScore || 0) * 100)}%
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {noData ? (
        <Card className="rounded-2xl">
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No exam data available yet to generate predictions.</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Predictions will appear once exams have been evaluated.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* 1. Class Performance Forecast */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/40 to-transparent dark:from-blue-950/10" />
            <CardHeader className="relative">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 text-white">
                  <BarChart3 className="h-3.5 w-3.5" />
                </div>
                Class Performance Forecast
              </CardTitle>
              <CardDescription>Current vs predicted averages per class</CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {classChartData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={classChartData}>
                      <defs>
                        <linearGradient id="currentGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(220 90% 56%)" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="hsl(220 90% 56%)" stopOpacity={0.5} />
                        </linearGradient>
                        <linearGradient id="predictedGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(258 89% 66%)" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="hsl(258 89% 66%)" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number, name: string) => [`${value}%`, name]}
                        labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fullName || label}
                      />
                      <Legend />
                      <Bar dataKey="Current" fill="url(#currentGrad)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Predicted" fill="url(#predictedGrad)" radius={[4, 4, 0, 0]} strokeDasharray="5 5" stroke="hsl(258 89% 66%)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No class data</p>
              )}
              {/* Risk badges */}
              <div className="flex flex-wrap gap-2 mt-3">
                {classPredictions.filter(c => c.trend === "declining").map(c => (
                  <Badge key={c.classId} variant="destructive" className="text-xs gap-1">
                    <AlertTriangle className="h-3 w-3" /> {c.className}
                  </Badge>
                ))}
              </div>
              {/* AI reasoning */}
              {aiPredictions?.classes?.length ? (
                <div className="mt-4 space-y-2">
                  {aiPredictions.classes.slice(0, 3).map((ac, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs bg-violet-50 dark:bg-violet-950/20 p-2 rounded-lg">
                      <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 shrink-0" />
                      <span className="text-muted-foreground">{ac.reasoning}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* 2. Student Marks Prediction */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/10" />
            <CardHeader className="relative">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white">
                  <Users className="h-3.5 w-3.5" />
                </div>
                Student Marks Prediction
              </CardTitle>
              <CardDescription>Predicted score distribution & at-risk students</CardDescription>
            </CardHeader>
            <CardContent className="relative space-y-4">
              {/* Score bucket chart */}
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bucketData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))" }} />
                    <Bar dataKey="count" name="Students" radius={[6, 6, 0, 0]}>
                      {bucketData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* At-risk table */}
              {atRiskStudents.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2 text-rose-600">
                    <ArrowDownRight className="h-3.5 w-3.5" /> At Risk of Declining ({atRiskStudents.length})
                  </h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {atRiskStudents.map(s => (
                      <div key={s.studentId} className="flex items-center justify-between text-xs bg-rose-50/50 dark:bg-rose-950/10 p-2 rounded-lg">
                        <div className="flex items-center gap-2">
                          <ConfidenceDot confidence={s.confidence} />
                          <span className="font-medium">{s.studentName}</span>
                          <span className="text-muted-foreground">{s.className}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{s.currentScore.toFixed(0)}%</span>
                          <TrendingDown className="h-3 w-3 text-rose-500" />
                          <span className="font-semibold text-rose-600">{s.predictedScore.toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {improvingStudents.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-2 text-emerald-600">
                    <ArrowUpRight className="h-3.5 w-3.5" /> Likely to Improve ({improvingStudents.length})
                  </h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {improvingStudents.map(s => (
                      <div key={s.studentId} className="flex items-center justify-between text-xs bg-emerald-50/50 dark:bg-emerald-950/10 p-2 rounded-lg">
                        <div className="flex items-center gap-2">
                          <ConfidenceDot confidence={s.confidence} />
                          <span className="font-medium">{s.studentName}</span>
                          <span className="text-muted-foreground">{s.className}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{s.currentScore.toFixed(0)}%</span>
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                          <span className="font-semibold text-emerald-600">{s.predictedScore.toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Teacher Effectiveness Trend */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10" />
            <CardHeader className="relative">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                  <GraduationCap className="h-3.5 w-3.5" />
                </div>
                Teacher Effectiveness Trend
              </CardTitle>
              <CardDescription>Current vs projected student outcomes per teacher</CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {teacherTrends.length > 0 ? (
                <div className="space-y-3">
                  {teacherTrends.slice(0, 8).map(t => {
                    const diff = t.predictedAvg - t.currentAvg;
                    const aiInsight = aiPredictions?.teacherInsights?.find(ti => ti.teacherId === t.teacherId);
                    return (
                      <div key={t.teacherId} className="p-3 rounded-xl bg-card border">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TrendIcon trend={t.trend} />
                            <span className="font-medium text-sm">{t.teacherName}</span>
                            <span className="text-xs text-muted-foreground">({t.classCount} classes)</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span>{t.currentAvg.toFixed(1)}%</span>
                            <span className="text-muted-foreground">→</span>
                            <span className={`font-semibold ${diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {t.predictedAvg.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{t.classes.join(", ")}</div>
                        {aiInsight && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs bg-violet-50 dark:bg-violet-950/20 p-2 rounded-lg">
                            <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 shrink-0" />
                            <span>{aiInsight.recommendation}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No teacher data</p>
              )}
            </CardContent>
          </Card>

          {/* 4. Subject Risk Forecast */}
          <Card className="rounded-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-rose-50/40 to-transparent dark:from-rose-950/10" />
            <CardHeader className="relative">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-rose-400 to-red-500 text-white">
                  <BookOpen className="h-3.5 w-3.5" />
                </div>
                Subject Risk Forecast
              </CardTitle>
              <CardDescription>Subjects ranked by predicted risk of decline</CardDescription>
            </CardHeader>
            <CardContent className="relative">
              {subjectChartData.length > 0 ? (
                <>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={subjectChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" domain={[0, 100]} />
                        <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))" }}
                          formatter={(value: number, name: string) => [`${value}%`, name]}
                          labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fullName || label}
                        />
                        <Legend />
                        <Bar dataKey="Current" fill="hsl(200 95% 50%)" radius={[0, 4, 4, 0]} barSize={14} />
                        <Bar dataKey="Predicted" fill="hsl(258 89% 66%)" radius={[0, 4, 4, 0]} barSize={14} opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {subjectForecasts.map(s => (
                      <div key={s.subjectId} className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{s.subjectName}</span>
                        <RiskBadge level={s.riskLevel} />
                      </div>
                    ))}
                  </div>
                  {/* Class breakdown for selected subject */}
                  {subjectFilter !== "all" && subjectForecasts.length > 0 && subjectForecasts[0].classBreakdown.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      <h4 className="text-xs font-semibold text-muted-foreground mb-2">Class Breakdown</h4>
                      {subjectForecasts[0].classBreakdown.map((cb, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                          <span className="font-medium">{cb.className}</span>
                          <div className="flex items-center gap-2">
                            <span>{cb.avg.toFixed(1)}%</span>
                            <span className="text-muted-foreground">→</span>
                            <span className={`font-semibold ${cb.predicted >= cb.avg ? "text-emerald-600" : "text-rose-600"}`}>
                              {cb.predicted.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* AI reasoning */}
                  {aiPredictions?.subjectAlerts?.length ? (
                    <div className="mt-4 space-y-2">
                      {aiPredictions.subjectAlerts.slice(0, 3).map((sa, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs bg-violet-50 dark:bg-violet-950/20 p-2 rounded-lg">
                          <Sparkles className="h-3 w-3 text-violet-500 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-medium">{sa.reasoning}</span>
                            {sa.intervention && <p className="text-muted-foreground mt-0.5">💡 {sa.intervention}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No subject data</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
