import { useRef, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { StaggerContainer, StaggerItem, AnimatedContainer } from "@/components/ui/animated-container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Users,
  GraduationCap,
  Target,
  TrendingUp,
  AlertTriangle,
  BookOpen,
  Download,
  BarChart3,
  CheckCircle,
  Clock,
  Activity,
  ChevronDown,
} from "lucide-react";
import { useComprehensivePrincipalAnalytics } from "@/hooks/useComprehensivePrincipalAnalytics";
import { InsightCard } from "@/components/reports/InsightCard";
import { StudentPositioningMatrix } from "@/components/reports/StudentPositioningMatrix";
import { TopicHeatmap } from "@/components/reports/TopicHeatmap";
import { AIInsightsTab } from "@/components/dashboards/AIInsightsTab";
import { ComparisonSheet } from "@/components/dashboards/ComparisonSheet";
import { SchoolAdminOnboardingWizard } from "@/components/onboarding/SchoolAdminOnboardingWizard";
import {
  StudentDistributionDonut,
  PassRateGauge,
  ExamStatusPie,
  SubjectRadarChart,
} from "@/components/dashboards/charts";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatNumber } from "@/lib/formatNumber";
import { saveBlob } from "@/lib/native";
import { getDisplaySection } from "@/lib/sectionDisplay";
import { formatClassName } from "@/lib/utils";

interface ComprehensivePrincipalDashboardProps {
  institutionId: string | null;
  institutionName?: string;
}

export function ComprehensivePrincipalDashboard({
  institutionId,
  institutionName,
}: ComprehensivePrincipalDashboardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportRef = useRef<HTMLDivElement>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedHeatmapGrade, setSelectedHeatmapGrade] = useState<string>("all");
  const [selectedSubjectClass, setSelectedSubjectClass] = useState<string | null>(null);
  const [selectedSubjectName, setSelectedSubjectName] = useState<string | null>(null);
  const [selectedTeacherGrade, setSelectedTeacherGrade] = useState<string | null>(null);
  const [selectedSubjectRiskGrade, setSelectedSubjectRiskGrade] = useState<string | null>(null);
  const [selectedClassGrade, setSelectedClassGrade] = useState<string | null>(null);
  const [showAllTeachers, setShowAllTeachers] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading } = useComprehensivePrincipalAnalytics(institutionId);

  // Auto-select first class/grade for all filters once data loads
  const firstClassId = data?.classPerformance?.[0]?.classId ?? null;
  const firstGrade = data?.gradeHeatmap?.[0]?.grade ?? null;
  const firstClassGrade = data?.classPerformance ? [...new Set(data.classPerformance.map(c => c.grade))].sort()[0] ?? null : null;
  const firstTeacherGrade = data?.teacherActions ? [...new Set(data.teacherActions.flatMap(t => t.classes))].sort()[0] ?? null : null;
  const firstSubjectRiskGrade = data?.subjectRisks ? [...new Set(data.subjectRisks.flatMap(s => s.classesAffected))].sort()[0] ?? null : null;
  // Pick senior-most class (highest numeric grade) as default for subject tab
  const seniorMostClass = data?.subjectRisks
    ? [...new Set(data.subjectRisks.flatMap(s => s.classesAffected))]
        .sort((a, b) => {
          const gradeA = parseInt(a.match(/\d+/)?.[0] || '0');
          const gradeB = parseInt(b.match(/\d+/)?.[0] || '0');
          return gradeB - gradeA || b.localeCompare(a);
        })[0] ?? null
    : null;
  const firstSubjectClass = seniorMostClass;

  useEffect(() => {
    if (selectedClassId === null && firstClassId) setSelectedClassId(firstClassId);
    if (selectedHeatmapGrade === "all" && firstGrade) setSelectedHeatmapGrade(firstGrade);
    if (selectedClassGrade === null && firstClassGrade) setSelectedClassGrade(firstClassGrade);
    if (selectedTeacherGrade === null && firstTeacherGrade) setSelectedTeacherGrade(firstTeacherGrade);
    if (selectedSubjectRiskGrade === null && firstSubjectRiskGrade) setSelectedSubjectRiskGrade(firstSubjectRiskGrade);
    if (selectedSubjectClass === null && firstSubjectClass) setSelectedSubjectClass(firstSubjectClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstClassId, firstGrade, firstClassGrade, firstTeacherGrade, firstSubjectRiskGrade, firstSubjectClass]);

  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    const opt = {
      margin: 0.5,
      filename: `principal_report_${new Date().toISOString().split("T")[0]}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    };
    try {
      // Lazy: html2pdf.js pulls in html2canvas + jspdf (~1 MB), so the
      // dashboard route must not pay for it until the export is clicked (§23).
      const { default: html2pdf } = await import("html2pdf.js");
      const blob: Blob = await html2pdf().set(opt).from(reportRef.current).outputPdf("blob");
      saveBlob(blob, opt.filename);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!institutionId || !data) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-12 text-center">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Select an institution to view analytics.</p>
        </CardContent>
      </Card>
    );
  }

  const { metrics, classPerformance, studentPositioning, subjectRisks, teacherActions, studentAttention, topicHeatmap, insights, gradeHeatmap, crossClassComparison, examStatusDistribution, subjectRadarData } = data;

  const classComparisonData = crossClassComparison.map((c) => ({
    name: c.className.length > 12 ? c.className.slice(0, 12) + "..." : c.className,
    fullName: c.className,
    Accuracy: c.accuracy,
    "Pass Rate": c.passRate,
  }));

  const subjectComparisonData = subjectRisks.map((s) => ({
    name: s.subjectName.length > 10 ? s.subjectName.slice(0, 10) + "..." : s.subjectName,
    fullName: s.subjectName,
    Average: s.average,
    riskLevel: s.riskLevel,
  }));

  // Unique grades for heatmap filter
  const uniqueGrades = gradeHeatmap.map(g => g.grade);
  const filteredHeatmap = selectedHeatmapGrade === "all"
    ? gradeHeatmap
    : gradeHeatmap.filter(g => g.grade === selectedHeatmapGrade);

  // Unique grades for teacher actions filter
  const teacherGrades = [...new Set(teacherActions.flatMap(t => t.classes))].sort();
  const filteredTeachers = selectedTeacherGrade
    ? teacherActions.filter(t => t.classes.some(c => c.includes(selectedTeacherGrade)))
    : teacherActions;

  // (subject risk filtering now handled inline in the Subjects tab)

  // Students needing attention percentage
  const atRiskPercent = metrics.totalStudents > 0
    ? ((studentPositioning.needsAttention.count / metrics.totalStudents) * 100).toFixed(0)
    : "0";

  return (
    <div className="space-y-6">
      <SchoolAdminOnboardingWizard />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            School Dashboard
          </h1>
          {institutionName && <p className="text-muted-foreground mt-1">{institutionName}</p>}
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={selectedClassId || "all"}
            onValueChange={(v) => setSelectedClassId(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-[180px] rounded-xl">
              <SelectValue placeholder="All Classes" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all">All Classes</SelectItem>
              {classPerformance.map((c) => (
                <SelectItem key={c.classId} value={c.classId}>
                  {formatClassName(c.grade, c.section)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleExportPDF} disabled={isExporting} className="rounded-xl">
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? "Exporting..." : "Download Report"}
          </Button>
        </div>
      </div>

      {/* Printable Content */}
      <div ref={reportRef} className="space-y-6">
        {/* Key Metrics - Colorful Gradient Cards */}
        <StaggerContainer className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StaggerItem className="h-full">
            <GradientKPICard
              icon={Target}
              value={`${metrics.schoolAverage.toFixed(1)}%`}
              label="School Average"
              variant="blue"
              infoTooltip="Weighted average of all evaluated students' scores across every class and subject in the institution."
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            <GradientKPICard
              icon={Activity}
              value={formatNumber(metrics.totalStudents)}
              label="Evaluated Students"
              variant="indigo"
              infoTooltip="Total number of unique students who have at least one exam score recorded in the system."
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            <GradientKPICard
              icon={GraduationCap}
              value={formatNumber(metrics.totalClasses)}
              label="Active Classes"
              variant="purple"
              infoTooltip="Count of classes that have students with recorded exam results."
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            <GradientKPICard
              icon={AlertTriangle}
              value={studentPositioning.needsAttention.count}
              label={`Need Attention (${atRiskPercent}%)`}
              variant="red"
              infoTooltip="Students scoring below 40% average across their subjects. Percentage shown is relative to total evaluated students."
            />
          </StaggerItem>
          <StaggerItem className="h-full">
            <GradientKPICard
              icon={TrendingUp}
              label="Above School Average"
              value={`${classPerformance.filter(c => c.average > metrics.schoolAverage).length} / ${classPerformance.length}`}
              variant="emerald"
              subLabel={`School avg: ${metrics.schoolAverage.toFixed(1)}%`}
              infoTooltip="Number of classes whose class average exceeds the overall school average. Helps identify high-performing vs underperforming classes."
            />
          </StaggerItem>
        </StaggerContainer>


        <Tabs defaultValue={searchParams.get("tab") || "overview"} className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="classes">Classes</TabsTrigger>
            <TabsTrigger value="teachers">Teachers</TabsTrigger>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="subjects">Subjects</TabsTrigger>
            <TabsTrigger value="ai-suggestions">AI Suggestions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Visual Charts Row */}
            <StaggerContainer className="grid md:grid-cols-3 gap-4" whileInView>
              <StaggerItem className="[&>*]:rounded-2xl">
                <StudentDistributionDonut
                  needsAttention={studentPositioning.needsAttention.count}
                  developing={studentPositioning.developing.count}
                  stable={studentPositioning.stable.count}
                />
              </StaggerItem>
              <StaggerItem className="[&>*]:rounded-2xl">
                <PassRateGauge passRate={metrics.passRate} />
              </StaggerItem>
              <StaggerItem className="[&>*]:rounded-2xl">
                <ExamStatusPie distribution={examStatusDistribution} />
              </StaggerItem>
            </StaggerContainer>

            {/* Removed duplicate radar chart — available in Subjects tab */}

            {/* Student Positioning Matrix */}
            <AnimatedContainer variant="scaleIn" whileInView className="[&>*]:rounded-2xl">
              <StudentPositioningMatrix data={studentPositioning} />
            </AnimatedContainer>

            {/* Grade-Section Heatmap with Filter */}
            {gradeHeatmap.length > 0 && (
              <AnimatedContainer variant="fadeUp" whileInView>
              <Card className="rounded-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-teal-50/40 to-transparent dark:from-teal-950/10" />
                <CardHeader className="relative">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 text-white">
                          <BarChart3 className="h-3.5 w-3.5" />
                        </div>
                        Grade-Section Heatmap
                      </CardTitle>
                      <CardDescription className="mt-1">Click a grade to filter, or use the dropdown</CardDescription>
                    </div>
                    <Select
                      value={selectedHeatmapGrade}
                      onValueChange={(v) => setSelectedHeatmapGrade(v)}
                    >
                      <SelectTrigger className="w-[140px] rounded-xl">
                        <SelectValue placeholder="All Grades" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="all">All Grades</SelectItem>
                        {uniqueGrades.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="relative">
                  <div className="space-y-3">
                    {filteredHeatmap.map((grade, gradeIdx) => (
                      <div key={gradeIdx} className="flex items-center gap-3">
                        <button
                          onClick={() => setSelectedHeatmapGrade(
                            selectedHeatmapGrade === grade.grade ? "all" : grade.grade
                          )}
                          className={`w-24 px-3 py-1.5 rounded-xl text-sm font-semibold text-center transition-all ${
                            selectedHeatmapGrade === grade.grade
                              ? "bg-teal-500 text-white shadow-md"
                              : "bg-muted hover:bg-teal-100 dark:hover:bg-teal-900/30"
                          }`}
                        >
                          {grade.grade}
                        </button>
                        <div className="flex gap-2 flex-wrap">
                          {grade.sections.map((section, sectionIdx) => {
                            const pct = section.average;
                            const bg = pct >= 80
                              ? "bg-gradient-to-br from-emerald-400 to-green-500"
                              : pct >= 70
                              ? "bg-gradient-to-br from-green-400 to-emerald-500"
                              : pct >= 50
                              ? "bg-gradient-to-br from-amber-400 to-orange-500"
                              : "bg-gradient-to-br from-rose-400 to-red-500";
                            const displaySection = getDisplaySection(grade.grade, section.section) ?? section.section;
                            return (
                              <button
                                key={sectionIdx}
                                className={`px-4 py-2.5 rounded-xl text-white font-semibold text-sm shadow-sm hover:shadow-md hover:scale-105 transition-all ${bg}`}
                                onClick={() => setSelectedClassId(section.classId)}
                                title={`${grade.grade} ${displaySection}: ${section.average.toFixed(1)}%`}
                              >
                                <span className="block text-white/70 text-[10px] font-normal">Sec {displaySection}</span>
                                {section.average.toFixed(0)}%
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              </AnimatedContainer>
            )}

            {/* Cross-Class Comparison */}
            {classComparisonData.length > 0 && (
              <AnimatedContainer variant="fadeUp" whileInView>
              <Card className="rounded-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 to-transparent dark:from-blue-950/10" />
                <CardHeader className="relative">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 text-white">
                      <BarChart3 className="h-3.5 w-3.5" />
                    </div>
                    Cross-Class Comparison
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={classComparisonData}>
                        <defs>
                          <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366F1" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#818CF8" stopOpacity={0.6} />
                          </linearGradient>
                          <linearGradient id="passRateGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10B981" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#34D399" stopOpacity={0.6} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} />
                        <Tooltip
                          formatter={(value: number) => `${value.toFixed(1)}%`}
                          labelFormatter={(_, payload) => payload[0]?.payload?.fullName}
                          contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                        />
                        <Legend />
                        <Bar dataKey="Accuracy" fill="url(#accuracyGrad)" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="Pass Rate" fill="url(#passRateGrad)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              </AnimatedContainer>
            )}
          </TabsContent>

          <TabsContent value="classes" className="space-y-6">
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/10" />
              <CardHeader className="relative">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 text-white">
                        <GraduationCap className="h-3.5 w-3.5" />
                      </div>
                      Class Performance Overview
                    </CardTitle>
                    <CardDescription>
                      {(() => {
                        const filtered = selectedClassGrade
                          ? classPerformance.filter(c => c.grade === selectedClassGrade)
                          : classPerformance;
                        return `${filtered.length} classes`;
                      })()}
                    </CardDescription>
                  </div>
                  <Select
                    value={selectedClassGrade || "none"}
                    onValueChange={(v) => setSelectedClassGrade(v === "none" ? null : v)}
                  >
                    <SelectTrigger className="w-[160px] rounded-xl text-xs h-8">
                      <SelectValue placeholder="Select Grade" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="none">All Grades</SelectItem>
                      {[...new Set(classPerformance.map(c => c.grade))].sort().map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(selectedClassGrade
                    ? classPerformance.filter(c => c.grade === selectedClassGrade)
                    : classPerformance
                  ).map((cls, idx) => {
                    const isExcellent = cls.status === "Excellent";
                    const isGood = cls.status === "Good";
                    const isAtRisk = cls.status === "At Risk";
                    const cardBg = isExcellent
                      ? "border-0 bg-gradient-to-br from-emerald-500 to-green-600 text-white"
                      : isGood
                      ? "border-0 bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
                      : isAtRisk
                      ? "border-0 bg-gradient-to-br from-rose-500 to-red-600 text-white"
                      : "border-0 bg-gradient-to-br from-amber-400 to-orange-500 text-white";
                    return (
                      <div
                        key={idx}
                        onClick={() => navigate(`/school/class/${cls.classId}`)}
                        className={`p-4 rounded-2xl shadow-md transition-all hover:shadow-lg hover:scale-[1.02] relative overflow-hidden cursor-pointer ${cardBg}`}
                      >
                        <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -translate-y-6 translate-x-6" />
                        <div className="relative">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h4 className="font-bold text-base">{formatClassName(cls.grade, cls.section)}</h4>
                              <p className="text-xs text-white/70">{cls.studentCount} students</p>
                            </div>
                            <Badge className="rounded-lg bg-white/20 text-white border-0 text-xs">
                              {cls.status}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 rounded-xl bg-white/15 backdrop-blur-sm">
                              <div className="text-xl font-bold">{cls.average.toFixed(1)}%</div>
                              <p className="text-[10px] text-white/70">Average</p>
                            </div>
                            <div className="p-2 rounded-xl bg-white/15 backdrop-blur-sm">
                              <div className="text-xl font-bold">{cls.passRate.toFixed(0)}%</div>
                              <p className="text-[10px] text-white/70">Pass Rate</p>
                            </div>
                          </div>
                          <p className="text-xs text-white/70 mt-2">👨‍🏫 {cls.teacherName}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* At-Risk Classes */}
            {(selectedClassGrade ? classPerformance.filter(c => c.grade === selectedClassGrade && c.status === "At Risk") : classPerformance.filter(c => c.status === "At Risk")).length > 0 && (
              <Card className="rounded-2xl border-rose-200/50 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-rose-50/60 to-transparent dark:from-rose-950/20" />
                <CardHeader className="relative">
                  <CardTitle className="text-base flex items-center gap-2 text-rose-700 dark:text-rose-400">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-rose-400 to-red-500 text-white">
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </div>
                    Classes Requiring Intervention
                  </CardTitle>
                </CardHeader>
                <CardContent className="relative">
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(selectedClassGrade ? classPerformance.filter(c => c.grade === selectedClassGrade && c.status === "At Risk") : classPerformance.filter(c => c.status === "At Risk")).map((cls, idx) => (
                      <div key={idx} className="p-3 rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/30 dark:to-background shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-sm">{formatClassName(cls.grade, cls.section)}</span>
                          <Badge variant="destructive" className="rounded-lg">{cls.average.toFixed(0)}%</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">👨‍🏫 {cls.teacherName}</p>
                        <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-1">⚠ {cls.needsAttention} students need attention</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="teachers" className="space-y-6">
            <Card className="rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/40 to-transparent dark:from-cyan-950/10" />
              <CardHeader className="relative">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 text-white">
                        <Users className="h-3.5 w-3.5" />
                      </div>
                      Teacher Action Suggestions
                    </CardTitle>
                    <CardDescription>{filteredTeachers.length} teachers</CardDescription>
                  </div>
                  <Select
                    value={selectedTeacherGrade || "none"}
                    onValueChange={(v) => setSelectedTeacherGrade(v === "none" ? null : v)}
                  >
                    <SelectTrigger className="w-[160px] rounded-xl text-xs h-8">
                      <SelectValue placeholder="Select Grade" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="none">All Grades</SelectItem>
                      {teacherGrades.map((g) => (
                        <SelectItem key={g} value={g}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="relative">
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(showAllTeachers ? filteredTeachers : filteredTeachers.slice(0, 6)).map((teacher, idx) => {
                    const urgency = teacher.studentsNeedingAttention > 5;
                    const cardBg = urgency
                      ? "border-0 bg-gradient-to-br from-rose-500 to-red-600 text-white"
                      : "border-0 bg-gradient-to-br from-sky-500 to-blue-600 text-white";
                    return (
                      <div key={idx} onClick={() => navigate(`/school/teacher/${teacher.teacherId}`)} className={`p-4 rounded-2xl shadow-md transition-all hover:shadow-lg hover:scale-[1.02] relative overflow-hidden cursor-pointer ${cardBg}`}>
                        <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-4 translate-x-4" />
                        <div className="relative">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-sm truncate">{teacher.teacherName}</h4>
                            <Badge className="rounded-lg bg-white/20 text-white border-0 text-[10px] shrink-0">
                              {teacher.studentsNeedingAttention} at risk
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {teacher.subjects.slice(0, 2).map((s, i) => (
                              <Badge key={i} className="text-[10px] rounded-lg bg-white/15 text-white border-0">{s}</Badge>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {teacher.classes.slice(0, 3).map((c, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/15 text-white/80">{c}</span>
                            ))}
                            {teacher.classes.length > 3 && (
                              <span className="text-[10px] text-white/60">+{teacher.classes.length - 3}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filteredTeachers.length > 6 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllTeachers(!showAllTeachers)}
                    className="w-full mt-3 text-muted-foreground"
                  >
                    <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${showAllTeachers ? "rotate-180" : ""}`} />
                    {showAllTeachers ? "Show Less" : `Show ${filteredTeachers.length - 6} More`}
                  </Button>
                )}
                {filteredTeachers.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No teachers match the selected filter</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="students" className="space-y-6">
            {studentAttention.length > 0 && (
              <Card className="rounded-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-rose-50/40 to-transparent dark:from-rose-950/10" />
                <CardHeader className="relative">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-rose-400 to-orange-500 text-white">
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </div>
                    Student Attention Signals
                  </CardTitle>
                  <CardDescription>{studentAttention.length} students requiring attention</CardDescription>
                </CardHeader>
                <CardContent className="relative">
                  <StudentAttentionList students={studentAttention} />
                </CardContent>
              </Card>
            )}

            {topicHeatmap.length > 0 && (
              <div className="[&>*]:rounded-2xl">
                <TopicHeatmap data={topicHeatmap} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="subjects" className="space-y-6">
            {(() => {
              // Unique class names from subject risks, sorted by grade number descending
              const subjectClasses = [...new Set(subjectRisks.flatMap(s => s.classesAffected))].sort((a, b) => {
                const gradeA = parseInt(a.match(/\d+/)?.[0] || '0');
                const gradeB = parseInt(b.match(/\d+/)?.[0] || '0');
                return gradeB - gradeA || b.localeCompare(a);
              });

              const activeClass = selectedSubjectClass || subjectClasses[0] || null;

              const subjectNames = [...new Set(
                subjectRisks
                  .filter(s => !activeClass || s.classesAffected.includes(activeClass))
                  .map(s => s.subjectName)
              )].sort();

              const filteredSubjects = subjectRisks.filter(s => {
                if (activeClass && !s.classesAffected.includes(activeClass)) return false;
                if (selectedSubjectName && s.subjectName !== selectedSubjectName) return false;
                return true;
              });

              const filteredChartData = filteredSubjects.map(s => ({
                name: s.subjectName.length > 10 ? s.subjectName.slice(0, 10) + "..." : s.subjectName,
                fullName: s.subjectName,
                Average: s.average,
              }));

              // Risk indicators also filtered by the active class
              const classFilteredRisks = subjectRisks.filter(s =>
                !activeClass || s.classesAffected.includes(activeClass)
              );

              return (
                <>
                  {/* Class filter bar */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                        <BookOpen className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-sm font-semibold">Subject Performance Report</span>
                    </div>
                    <Select
                      value={activeClass || "all"}
                      onValueChange={(v) => {
                        setSelectedSubjectClass(v === "all" ? null : v);
                        setSelectedSubjectName(null);
                      }}
                    >
                      <SelectTrigger className="w-[160px] rounded-xl text-xs h-8">
                        <SelectValue placeholder="Select Class" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="all">All Classes</SelectItem>
                        {subjectClasses.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedSubjectName || "all"}
                      onValueChange={(v) => setSelectedSubjectName(v === "all" ? null : v)}
                    >
                      <SelectTrigger className="w-[160px] rounded-xl text-xs h-8">
                        <SelectValue placeholder="All Subjects" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="all">All Subjects</SelectItem>
                        {subjectNames.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Subject Performance Chart — always visible */}
                  <Card className="rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10" />
                    <CardHeader className="relative">
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 text-white">
                          <BarChart3 className="h-3.5 w-3.5" />
                        </div>
                        Subject Performance Comparison
                        {activeClass && (
                          <Badge variant="secondary" className="ml-2 text-xs rounded-lg">{activeClass}</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    {filteredChartData.length > 0 ? (
                      <CardContent className="relative">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={filteredChartData} layout="vertical">
                              <defs>
                                <linearGradient id="subjectGrad" x1="0" y1="0" x2="1" y2="0">
                                  <stop offset="0%" stopColor="#10B981" stopOpacity={0.9} />
                                  <stop offset="100%" stopColor="#34D399" stopOpacity={0.7} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis type="number" domain={[0, 100]} />
                              <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 11 }} />
                              <Tooltip
                                formatter={(value: number) => `${value.toFixed(1)}%`}
                                labelFormatter={(_, payload) => payload[0]?.payload?.fullName}
                                contentStyle={{ borderRadius: "12px", fontSize: "12px" }}
                              />
                              <Bar dataKey="Average" fill="url(#subjectGrad)" radius={[0, 8, 8, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent className="relative py-8 text-center">
                        <p className="text-muted-foreground text-sm">No data for selected filters</p>
                      </CardContent>
                    )}
                  </Card>

                  {/* Subject Risk Indicators — filtered by class */}
                  <Card className="rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/10" />
                    <CardHeader className="relative">
                      <CardTitle className="text-base flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                          <BookOpen className="h-3.5 w-3.5" />
                        </div>
                        Subject Risk Indicators
                        {activeClass && (
                          <Badge variant="secondary" className="ml-2 text-xs rounded-lg">{activeClass}</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{classFilteredRisks.length} subjects</CardDescription>
                    </CardHeader>
                    <CardContent className="relative">
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {classFilteredRisks.map((subject, idx) => {
                          const isHigh = subject.riskLevel === "High";
                          const isMod = subject.riskLevel === "Moderate";
                          const cardBg = isHigh
                            ? "border-0 bg-gradient-to-br from-rose-500 to-red-600 text-white"
                            : isMod
                            ? "border-0 bg-gradient-to-br from-amber-400 to-orange-500 text-white"
                            : "border-0 bg-gradient-to-br from-emerald-500 to-green-600 text-white";
                          return (
                            <div
                              key={idx}
                              onClick={() => navigate(`/school/subject/${subject.subjectId}`)}
                              className={`p-4 rounded-2xl shadow-md transition-all hover:shadow-lg hover:scale-[1.02] relative overflow-hidden cursor-pointer ${cardBg}`}
                            >
                              <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-4 translate-x-4" />
                              <div className="relative">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="font-bold text-sm">{subject.subjectName}</h4>
                                  <Badge className="rounded-lg bg-white/20 text-white border-0 text-xs">
                                    {subject.riskLevel}
                                  </Badge>
                                </div>
                                <div className="text-3xl font-bold mb-1">{subject.average.toFixed(1)}%</div>
                                <p className="text-xs text-white/70">{formatNumber(subject.studentsAffected)} students affected</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {classFilteredRisks.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground py-8">No subjects match the selected filter</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </TabsContent>

          <TabsContent value="ai-suggestions" className="space-y-6">
            <AIInsightsTab
              institutionId={institutionId}
              metrics={metrics}
              classPerformance={classPerformance}
              teacherActions={teacherActions}
              subjectRisks={subjectRisks}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StudentAttentionList({ students }: { students: any[] }) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? students : students.slice(0, 6);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {visible.map((student, idx) => {
        const isImmediate = student.priority === "Immediate";
        const isHigh = student.priority === "High";
        const cardBg = isImmediate
          ? "border-0 bg-gradient-to-br from-rose-500 to-red-600 text-white"
          : isHigh
          ? "border-0 bg-gradient-to-br from-amber-400 to-orange-500 text-white"
          : "border-0 bg-gradient-to-br from-slate-400 to-slate-500 text-white";
        return (
          <div
            key={idx}
            onClick={() => navigate(`/school/student/${student.studentId}`)}
            className={`p-4 rounded-2xl shadow-md transition-all hover:shadow-lg hover:scale-[1.02] relative overflow-hidden cursor-pointer ${cardBg}`}
          >
            <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -translate-y-4 translate-x-4" />
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="font-bold text-sm">{student.studentName}</h4>
                  <p className="text-xs text-white/70">{student.className}</p>
                </div>
                <Badge className="rounded-lg bg-white/20 text-white border-0 text-xs">
                  {student.priority}
                </Badge>
              </div>
              {student.subjectsOfConcern.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {student.subjectsOfConcern.map((s: any, i: number) => (
                    <Badge key={i} className="text-xs rounded-lg bg-white/15 text-white border-0">
                      {s.subject}: {s.accuracy.toFixed(0)}%
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {students.length > 6 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAll(!showAll)}
          className="w-full text-muted-foreground"
        >
          <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${showAll ? "rotate-180" : ""}`} />
          {showAll ? "Show Less" : `Show ${students.length - 6} More`}
        </Button>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <Skeleton className="h-8 w-64 rounded-xl" />
          <Skeleton className="h-4 w-40 mt-1 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40 rounded-xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
