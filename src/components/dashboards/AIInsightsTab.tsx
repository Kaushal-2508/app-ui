import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { Sparkles, Target, AlertTriangle, TrendingUp, Zap, ArrowRight, Clock, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import {
  RadialBarChart, RadialBar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ScatterChart, Scatter, ZAxis,
  AreaChart, Area,
} from "recharts";

interface AIInsightsTabProps {
  institutionId: string;
  metrics: any;
  classPerformance: any[];
  teacherActions: any[];
  subjectRisks: any[];
}

interface AIInsights {
  executiveSummary: {
    healthScore: number;
    trend: string;
    keyFindings: string[];
  };
  interventions: {
    entity: string;
    type: string;
    severity: number;
    impact: number;
    description: string;
  }[];
  actions: {
    title: string;
    assignTo: string;
    priority: "urgent" | "high" | "medium";
    expectedImpact: number;
    timeline: string;
  }[];
  forecasts: {
    predictedAvg: number;
    predictedAtRisk: number;
    decliningSubjects: string[];
  };
}

export function AIInsightsTab({ institutionId, metrics, classPerformance, teacherActions, subjectRisks }: AIInsightsTabProps) {
  const { data: insights, isLoading, refetch } = useQuery({
    queryKey: ["principal-ai-insights", institutionId],
    queryFn: async (): Promise<AIInsights> => {
      const { data, error } = await supabase.functions.invoke("generate-principal-ai-insights", {
        body: {
          institutionId,
          metrics: {
            schoolAverage: metrics.schoolAverage,
            totalStudents: metrics.totalStudents,
            totalClasses: metrics.totalClasses,
            passRate: metrics.passRate,
          },
          classPerformance: classPerformance.slice(0, 15).map(c => ({
            name: formatClassName(c.grade, c.section),
            average: c.average,
            passRate: c.passRate,
            students: c.studentCount,
            status: c.status,
          })),
          teacherData: teacherActions.slice(0, 10).map(t => ({
            name: t.teacherName,
            subjects: t.subjects,
            atRiskStudents: t.studentsNeedingAttention,
          })),
          subjectRisks: subjectRisks.slice(0, 10).map(s => ({
            name: s.subjectName,
            average: s.average,
            riskLevel: s.riskLevel,
            studentsAffected: s.studentsAffected,
          })),
        },
      });

      if (error) throw error;
      return data as AIInsights;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!insights) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground mb-4">AI insights could not be generated.</p>
          <Button onClick={() => refetch()} className="rounded-xl">Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  const healthColor = insights.executiveSummary.healthScore >= 70 ? "#10B981" : insights.executiveSummary.healthScore >= 50 ? "#F59E0B" : "#EF4444";
  const healthGaugeData = [{ name: "Health", value: insights.executiveSummary.healthScore, fill: healthColor }];

  const priorityColors: Record<string, string> = { urgent: "#EF4444", high: "#F59E0B", medium: "#3B82F6" };
  const priorityBg: Record<string, string> = {
    urgent: "bg-gradient-to-r from-rose-500 to-red-600",
    high: "bg-gradient-to-r from-amber-400 to-orange-500",
    medium: "bg-gradient-to-r from-blue-500 to-indigo-600",
  };

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GradientKPICard icon={Target} value={`${insights.executiveSummary.healthScore}%`} label="School Health Score" variant={insights.executiveSummary.healthScore >= 70 ? "emerald" : insights.executiveSummary.healthScore >= 50 ? "orange" : "red"} />
        <GradientKPICard icon={TrendingUp} value={insights.executiveSummary.trend} label="Monthly Trend" variant="blue" />
        <GradientKPICard icon={AlertTriangle} value={formatNumber(insights.forecasts.predictedAtRisk)} label="Predicted At-Risk" variant="red" />
        <GradientKPICard icon={Sparkles} value={`${insights.forecasts.predictedAvg.toFixed(1)}%`} label="Predicted Average" variant="purple" />
      </div>

      {/* Health Gauge + Key Findings */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">Overall Health Gauge</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={healthGaugeData} startAngle={180} endAngle={0}>
                  <RadialBar dataKey="value" cornerRadius={12} background={{ fill: "hsl(var(--muted))" }} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-center text-4xl font-bold mt-[-60px]" style={{ color: healthColor }}>{insights.executiveSummary.healthScore}%</p>
            <p className="text-center text-xs text-muted-foreground mt-1">School Health Index</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/30 to-transparent dark:from-indigo-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">🔍 Key Findings</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="space-y-3">
              {insights.executiveSummary.keyFindings.map((finding, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/30">
                  <span className="text-lg">{["📊", "⚡", "🎯", "💡", "📈"][i % 5]}</span>
                  <p className="text-sm">{finding}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Intervention Priority Matrix */}
      {insights.interventions.length > 0 && (
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50/30 to-transparent dark:from-amber-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">🎯 Intervention Priority Matrix</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="severity" name="Severity" domain={[0, 10]} label={{ value: "Severity →", position: "bottom", fontSize: 11 }} />
                  <YAxis type="number" dataKey="impact" name="Impact" domain={[0, 10]} label={{ value: "Impact →", angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <ZAxis type="number" range={[100, 400]} />
                  <Tooltip content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-background border rounded-xl p-3 shadow-lg text-sm">
                        <p className="font-bold">{d.entity}</p>
                        <p className="text-muted-foreground">{d.description}</p>
                        <p className="text-xs mt-1">Type: {d.type} | Severity: {d.severity} | Impact: {d.impact}</p>
                      </div>
                    );
                  }} />
                  <Scatter data={insights.interventions} fill="#8B5CF6">
                    {insights.interventions.map((d, i) => (
                      <Cell key={i} fill={d.severity >= 7 ? "#EF4444" : d.severity >= 4 ? "#F59E0B" : "#10B981"} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Actions */}
      {insights.actions.length > 0 && (
        <Card className="rounded-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 to-transparent dark:from-blue-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base">🚀 Recommended Actions</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="grid md:grid-cols-2 gap-4">
              {insights.actions.map((action, i) => (
                <div key={i} className={`p-4 rounded-2xl text-white shadow-md relative overflow-hidden ${priorityBg[action.priority]}`}>
                  <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-4 translate-x-4" />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <Badge className="rounded-lg bg-white/20 text-white border-0 text-xs uppercase">{action.priority}</Badge>
                      <div className="flex items-center gap-1 text-xs text-white/70"><Clock className="h-3 w-3" /> {action.timeline}</div>
                    </div>
                    <h4 className="font-bold text-sm mb-1">{action.title}</h4>
                    <p className="text-xs text-white/70 mb-3">Assign to: {action.assignTo}</p>
                    <div className="w-full bg-white/20 rounded-full h-2">
                      <div className="bg-white rounded-full h-2 transition-all" style={{ width: `${action.expectedImpact}%` }} />
                    </div>
                    <p className="text-[10px] text-white/60 mt-1">Expected Impact: {action.expectedImpact}%</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Declining Subjects Forecast */}
      {insights.forecasts.decliningSubjects.length > 0 && (
        <Card className="rounded-2xl border-amber-200/50 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/10" />
          <CardHeader className="relative"><CardTitle className="text-base text-amber-700 dark:text-amber-400">📉 Subjects Likely to Decline</CardTitle></CardHeader>
          <CardContent className="relative">
            <div className="flex flex-wrap gap-2">
              {insights.forecasts.decliningSubjects.map((s, i) => (
                <Badge key={i} className="rounded-xl px-4 py-2 bg-gradient-to-r from-amber-400 to-orange-500 text-white border-0 text-sm font-medium">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-muted-foreground">
          <Sparkles className="h-4 w-4 mr-2" /> Regenerate Insights
        </Button>
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}
