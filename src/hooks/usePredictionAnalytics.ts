import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { formatClassName } from "@/lib/utils";

// Linear regression: returns slope per data point
function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function movingAverage(values: number[], window = 3): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function predictNext(values: number[]): number {
  if (values.length === 0) return 0;
  const slope = linearSlope(values);
  const last = values[values.length - 1];
  return Math.max(0, Math.min(100, last + slope));
}

function getTrend(slope: number): "improving" | "stable" | "declining" {
  if (slope > 1.5) return "improving";
  if (slope < -1.5) return "declining";
  return "stable";
}

function getConfidence(dataPoints: number): "high" | "medium" | "low" {
  if (dataPoints >= 5) return "high";
  if (dataPoints >= 3) return "medium";
  return "low";
}

export interface ClassPrediction {
  classId: string;
  className: string;
  grade: string;
  section: string;
  currentAvg: number;
  predictedAvg: number;
  trend: "improving" | "stable" | "declining";
  confidence: "high" | "medium" | "low";
  dataPoints: number;
  historicalAvgs: number[];
}

export interface StudentPrediction {
  studentId: string;
  studentName: string;
  className: string;
  currentScore: number;
  predictedScore: number;
  trend: "improving" | "stable" | "declining";
  confidence: "high" | "medium" | "low";
  scoreBucket: string;
}

export interface TeacherTrend {
  teacherId: string;
  teacherName: string;
  currentAvg: number;
  predictedAvg: number;
  trend: "improving" | "stable" | "declining";
  classCount: number;
  classes: string[];
}

export interface SubjectForecast {
  subjectId: string;
  subjectName: string;
  currentAvg: number;
  predictedAvg: number;
  riskLevel: "stable" | "watch" | "decline";
  classBreakdown: { className: string; avg: number; predicted: number }[];
}

export interface AIEnhancedPredictions {
  classes: { classId: string; predictedAvg: number; confidence: string; reasoning: string }[];
  atRiskStudents: { studentId: string; predictedScore: number; riskFactors: string[]; suggestion: string }[];
  teacherInsights: { teacherId: string; trend: string; recommendation: string }[];
  subjectAlerts: { subjectId: string; riskLevel: string; reasoning: string; intervention: string }[];
  overallOutlook: string;
  confidenceScore: number;
}

export function usePredictionAnalytics(
  institutionId: string | null,
  gradeFilter?: string | null,
  sectionFilter?: string | null,
  subjectFilter?: string | null
) {
  const [aiPredictions, setAiPredictions] = useState<AIEnhancedPredictions | null>(null);

  const dataQuery = useQuery({
    queryKey: ["prediction-analytics", institutionId, gradeFilter, sectionFilter, subjectFilter],
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      // Fetch classes
      let classQuery = supabase
        .from("classes")
        .select("id, name, section, institution_id")
        .eq("institution_id", institutionId!)
        .eq("is_active", true);

      if (gradeFilter && gradeFilter !== "all") {
        classQuery = classQuery.eq("name", gradeFilter);
      }
      if (sectionFilter && sectionFilter !== "all") {
        classQuery = classQuery.eq("section", sectionFilter);
      }

      const { data: classes } = await classQuery;
      if (!classes?.length) return emptyResult();

      const classIds = classes.map(c => c.id);

      // Fetch class aggregates for all exams for these classes
      const { data: aggregates } = await supabase
        .from("class_aggregates")
        .select("class_id, exam_id, avg_score_percent, subject_id, subject_name, students_attempted, students_passed, created_at")
        .in("class_id", classIds)
        .order("created_at", { ascending: true });

      // Fetch student performance snapshots
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select("student_id, class_id, exam_id, accuracy_percent, efficiency_score, created_at")
        .in("class_id", classIds)
        .order("created_at", { ascending: true });

      // Fetch profiles for student/teacher names
      const studentIds = [...new Set(snapshots?.map(s => s.student_id) || [])];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", studentIds.slice(0, 500));

      const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]) || []);

      // Fetch teacher assignments
      const { data: teacherAssignments } = await supabase
        .from("class_assignments")
        .select("user_id, class_id, role")
        .in("class_id", classIds)
        .eq("role", "teacher");

      const teacherIds = [...new Set(teacherAssignments?.map(t => t.user_id) || [])];
      const { data: teacherProfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", teacherIds.slice(0, 200));

      const teacherMap = new Map(teacherProfiles?.map(p => [p.id, p.full_name]) || []);

      // Fetch subjects if filter applied
      let subjectIds: string[] = [];
      if (subjectFilter && subjectFilter !== "all") {
        subjectIds = [subjectFilter];
      }

      // === Compute Class Predictions ===
      const classMap = new Map(classes.map(c => [c.id, c]));
      const classAggByClass = new Map<string, number[]>();
      (aggregates || []).forEach(a => {
        if (subjectIds.length && a.subject_id && !subjectIds.includes(a.subject_id)) return;
        const arr = classAggByClass.get(a.class_id) || [];
        arr.push(a.avg_score_percent);
        classAggByClass.set(a.class_id, arr);
      });

      const classPredictions: ClassPrediction[] = [];
      classAggByClass.forEach((avgs, classId) => {
        const cls = classMap.get(classId);
        if (!cls) return;
        const slope = linearSlope(avgs);
        classPredictions.push({
          classId,
          className: formatClassName(cls.name, cls.section),
          grade: cls.name,
          section: cls.section || "",
          currentAvg: avgs[avgs.length - 1] || 0,
          predictedAvg: predictNext(avgs),
          trend: getTrend(slope),
          confidence: getConfidence(avgs.length),
          dataPoints: avgs.length,
          historicalAvgs: avgs,
        });
      });

      // === Compute Student Predictions ===
      const studentByKey = new Map<string, number[]>();
      (snapshots || []).forEach(s => {
        const arr = studentByKey.get(s.student_id) || [];
        arr.push(s.accuracy_percent);
        studentByKey.set(s.student_id, arr);
      });

      const studentPredictions: StudentPrediction[] = [];
      studentByKey.forEach((scores, studentId) => {
        const slope = linearSlope(scores);
        const predicted = predictNext(scores);
        const bucket = predicted < 40 ? "0-40" : predicted < 60 ? "40-60" : predicted < 80 ? "60-80" : "80-100";
        const snap = (snapshots || []).find(s => s.student_id === studentId);
        const cls = snap ? classMap.get(snap.class_id) : null;
        studentPredictions.push({
          studentId,
          studentName: profileMap.get(studentId) || "Unknown",
          className: cls ? formatClassName(cls.name, cls.section) : "",
          currentScore: scores[scores.length - 1] || 0,
          predictedScore: predicted,
          trend: getTrend(slope),
          confidence: getConfidence(scores.length),
          scoreBucket: bucket,
        });
      });

      // === Compute Teacher Trends ===
      const teacherClassMap = new Map<string, string[]>();
      (teacherAssignments || []).forEach(ta => {
        const arr = teacherClassMap.get(ta.user_id) || [];
        const cls = classMap.get(ta.class_id);
        if (cls) arr.push(formatClassName(cls.name, cls.section));
        teacherClassMap.set(ta.user_id, arr);
      });

      const teacherTrends: TeacherTrend[] = [];
      const teacherClassIds = new Map<string, string[]>();
      (teacherAssignments || []).forEach(ta => {
        const arr = teacherClassIds.get(ta.user_id) || [];
        arr.push(ta.class_id);
        teacherClassIds.set(ta.user_id, arr);
      });

      teacherClassIds.forEach((tClassIds, teacherId) => {
        const avgs: number[] = [];
        tClassIds.forEach(cid => {
          const cAvgs = classAggByClass.get(cid);
          if (cAvgs?.length) avgs.push(movingAverage(cAvgs));
        });
        if (avgs.length === 0) return;
        const overall = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        const predicted = Math.max(0, Math.min(100, overall + linearSlope(avgs)));
        teacherTrends.push({
          teacherId,
          teacherName: teacherMap.get(teacherId) || "Unknown",
          currentAvg: overall,
          predictedAvg: predicted,
          trend: getTrend(linearSlope(avgs)),
          classCount: tClassIds.length,
          classes: teacherClassMap.get(teacherId) || [],
        });
      });

      // === Compute Subject Forecasts ===
      const subjectAggMap = new Map<string, { name: string; avgs: number[]; classBreakdown: Map<string, number[]> }>();
      (aggregates || []).forEach(a => {
        if (!a.subject_id || !a.subject_name) return;
        if (subjectIds.length && !subjectIds.includes(a.subject_id)) return;
        if (!subjectAggMap.has(a.subject_id)) {
          subjectAggMap.set(a.subject_id, { name: a.subject_name, avgs: [], classBreakdown: new Map() });
        }
        const entry = subjectAggMap.get(a.subject_id)!;
        entry.avgs.push(a.avg_score_percent);
        const cls = classMap.get(a.class_id);
        const className = cls ? formatClassName(cls.name, cls.section) : a.class_id;
        const cb = entry.classBreakdown.get(className) || [];
        cb.push(a.avg_score_percent);
        entry.classBreakdown.set(className, cb);
      });

      const subjectForecasts: SubjectForecast[] = [];
      subjectAggMap.forEach((entry, subjectId) => {
        const predicted = predictNext(entry.avgs);
        const current = entry.avgs[entry.avgs.length - 1] || 0;
        const diff = predicted - current;
        const riskLevel: "stable" | "watch" | "decline" = diff < -5 ? "decline" : diff < -1 ? "watch" : "stable";
        const classBreakdown: { className: string; avg: number; predicted: number }[] = [];
        entry.classBreakdown.forEach((avgs, className) => {
          classBreakdown.push({
            className,
            avg: avgs[avgs.length - 1] || 0,
            predicted: predictNext(avgs),
          });
        });
        subjectForecasts.push({
          subjectId,
          subjectName: entry.name,
          currentAvg: current,
          predictedAvg: predicted,
          riskLevel,
          classBreakdown,
        });
      });

      // Derive filter options
      const grades = [...new Set(classes.map(c => c.name))].sort();
      const sections = gradeFilter && gradeFilter !== "all"
        ? [...new Set(classes.filter(c => c.name === gradeFilter).map(c => c.section || ""))].filter(Boolean).sort()
        : [...new Set(classes.map(c => c.section || ""))].filter(Boolean).sort();

      // Get subject options from aggregates
      const subjectOptions = [...subjectAggMap.entries()].map(([id, v]) => ({ id, name: v.name }));

      // Score distribution for students
      const scoreBuckets = { "0-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
      studentPredictions.forEach(s => {
        scoreBuckets[s.scoreBucket as keyof typeof scoreBuckets]++;
      });

      return {
        classPredictions,
        studentPredictions,
        teacherTrends,
        subjectForecasts,
        scoreBuckets,
        filterOptions: { grades, sections, subjects: subjectOptions },
      };
    },
  });

  const aiMutation = useMutation({
    mutationFn: async () => {
      if (!dataQuery.data) throw new Error("No data to enhance");
      const { data, error } = await supabase.functions.invoke("generate-predictions", {
        body: {
          classPredictions: dataQuery.data.classPredictions.slice(0, 20),
          studentPredictions: dataQuery.data.studentPredictions
            .filter(s => s.trend === "declining")
            .slice(0, 15),
          teacherTrends: dataQuery.data.teacherTrends.slice(0, 15),
          subjectForecasts: dataQuery.data.subjectForecasts.slice(0, 15),
          scoreBuckets: dataQuery.data.scoreBuckets,
        },
      });
      if (error) throw error;
      return data as AIEnhancedPredictions;
    },
    onSuccess: (data) => setAiPredictions(data),
  });

  return {
    ...dataQuery,
    aiPredictions,
    isLoadingAI: aiMutation.isPending,
    aiError: aiMutation.error,
    fetchAIInsights: () => aiMutation.mutate(),
  };
}

function emptyResult() {
  return {
    classPredictions: [] as ClassPrediction[],
    studentPredictions: [] as StudentPrediction[],
    teacherTrends: [] as TeacherTrend[],
    subjectForecasts: [] as SubjectForecast[],
    scoreBuckets: { "0-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 },
    filterOptions: { grades: [] as string[], sections: [] as string[], subjects: [] as { id: string; name: string }[] },
  };
}
