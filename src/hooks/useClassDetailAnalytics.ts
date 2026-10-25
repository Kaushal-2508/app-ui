import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayName } from "@/lib/displayName";

export interface ClassDetailData {
  className: string;
  section: string;
  classAverage: number;
  passRate: number;
  totalStudents: number;
  totalExams: number;
  atRiskStudents: number;
  scoreDistribution: { range: string; count: number; fill: string }[];
  subjectAverages: { subject: string; average: number; fill: string }[];
  performanceTrend: { exam: string; average: number }[];
  studentDistribution: { name: string; value: number; fill: string }[];
  studentRanks: { rank: number; name: string; studentId: string; accuracy: number; passed: boolean; timePerQuestion: number }[];
  teacherSubjects: { teacherName: string; subject: string; avgScore: number }[];
  examHistory: { title: string; date: string; avgScore: number; passRate: number; status: string }[];
}

const GRADIENT_FILLS = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#3B82F6", "#EF4444"];

export function useClassDetailAnalytics(classId: string | undefined) {
  return useQuery({
    queryKey: ["class-detail-analytics", classId],
    queryFn: async (): Promise<ClassDetailData | null> => {
      if (!classId) return null;

      const [classRes, aggregatesRes, assignmentsRes, examsRes] = await Promise.all([
        supabase.from("classes").select("id, name, section, institution_id").eq("id", classId).single(),
        supabase.from("class_aggregates").select("*").eq("class_id", classId),
        supabase.from("class_assignments").select("user_id, subject_id, role, profiles:user_id(full_name), subjects:subject_id(name)").eq("class_id", classId),
        supabase.from("exam_classes").select("exam_id, exams:exam_id(id, title, status, scheduled_date, total_marks)").eq("class_id", classId),
      ]);

      const cls = classRes.data;
      if (!cls) return null;

      const snapshots = await supabase
        .from("student_performance_snapshots")
        .select("*, profiles:student_id(full_name)")
        .eq("class_id", classId);

      const students = snapshots.data || [];
      const accuracies = students.map(s => Number(s.accuracy_percent));
      const classAverage = accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : 0;
      const passed = accuracies.filter(a => a >= 50).length;
      const passRate = accuracies.length > 0 ? (passed / accuracies.length) * 100 : 0;

      // Score distribution buckets
      const buckets = [
        { range: "0-20%", min: 0, max: 20, fill: "#EF4444" },
        { range: "21-40%", min: 21, max: 40, fill: "#F59E0B" },
        { range: "41-60%", min: 41, max: 60, fill: "#F97316" },
        { range: "61-80%", min: 61, max: 80, fill: "#3B82F6" },
        { range: "81-100%", min: 81, max: 100, fill: "#10B981" },
      ];
      const scoreDistribution = buckets.map(b => ({
        range: b.range,
        count: accuracies.filter(a => a >= b.min && a <= b.max).length,
        fill: b.fill,
      }));

      // Student distribution donut
      let excellent = 0, good = 0, average = 0, atRisk = 0;
      accuracies.forEach(a => {
        if (a >= 80) excellent++;
        else if (a >= 65) good++;
        else if (a >= 50) average++;
        else atRisk++;
      });
      const studentDistribution = [
        { name: "Excellent", value: excellent, fill: "#10B981" },
        { name: "Good", value: good, fill: "#3B82F6" },
        { name: "Average", value: average, fill: "#F59E0B" },
        { name: "At Risk", value: atRisk, fill: "#EF4444" },
      ].filter(d => d.value > 0);

      // Subject averages from aggregates
      const aggs = aggregatesRes.data || [];
      const subjectMap = new Map<string, number[]>();
      aggs.forEach(a => {
        const name = a.subject_name || "General";
        if (!subjectMap.has(name)) subjectMap.set(name, []);
        subjectMap.get(name)!.push(Number(a.avg_accuracy_percent));
      });
      const subjectAverages = Array.from(subjectMap.entries()).map(([subject, accs], i) => ({
        subject,
        average: accs.reduce((a, b) => a + b, 0) / accs.length,
        fill: GRADIENT_FILLS[i % GRADIENT_FILLS.length],
      }));

      // Performance trend from aggregates (last 5 exams)
      const sortedAggs = [...aggs].sort((a, b) => new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime());
      const performanceTrend = sortedAggs.slice(-5).map((a, i) => ({
        exam: `Exam ${i + 1}`,
        average: Number(a.avg_accuracy_percent),
      }));

      // Student ranks
      const studentRanks = students
        .map(s => ({
          rank: 0,
          name: getDisplayName(s.profiles),
          studentId: s.student_id,
          accuracy: Number(s.accuracy_percent),
          passed: Number(s.accuracy_percent) >= 50,
          timePerQuestion: Number(s.avg_time_per_question_seconds) || 0,
        }))
        .sort((a, b) => b.accuracy - a.accuracy)
        .map((s, i) => ({ ...s, rank: i + 1 }));

      // Teacher-subject mapping
      const teachers = (assignmentsRes.data || []).filter(a => a.role === "teacher");
      const teacherSubjects = teachers.map(t => ({
        teacherName: getDisplayName(t.profiles),
        subject: (t.subjects as any)?.name || "General",
        avgScore: classAverage, // simplified
      }));

      // Exam history
      const examHistory = (examsRes.data || []).map(ec => {
        const exam = ec.exams as any;
        if (!exam) return null;
        const examAgg = aggs.find(a => a.exam_id === exam.id);
        return {
          title: exam.title || "Untitled",
          date: exam.scheduled_date || "",
          avgScore: examAgg ? Number(examAgg.avg_accuracy_percent) : 0,
          passRate: examAgg && examAgg.total_students > 0 ? (examAgg.students_passed / examAgg.total_students) * 100 : 0,
          status: exam.status || "draft",
        };
      }).filter(Boolean) as ClassDetailData["examHistory"];

      return {
        className: cls.name,
        section: cls.section || "A",
        classAverage,
        passRate,
        totalStudents: students.length,
        totalExams: examsRes.data?.length || 0,
        atRiskStudents: atRisk,
        scoreDistribution,
        subjectAverages,
        performanceTrend,
        studentDistribution,
        studentRanks,
        teacherSubjects,
        examHistory,
      };
    },
    enabled: !!classId,
    staleTime: 5 * 60 * 1000,
  });
}
