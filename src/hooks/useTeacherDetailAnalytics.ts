import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export interface TeacherDetailData {
  teacherName: string;
  classesTeaching: number;
  totalStudents: number;
  averageAccuracy: number;
  passRate: number;
  examsCreated: number;
  classPerformance: { className: string; accuracy: number; passRate: number; students: number }[];
  subjectRadar: { subject: string; average: number; fullMark: number }[];
  studentDistribution: { className: string; excellent: number; good: number; average: number; atRisk: number }[];
  performanceTrend: { exam: string; average: number }[];
  classBreakdown: { className: string; subject: string; students: number; avgScore: number; passRate: number; status: string }[];
  atRiskStudents: { name: string; className: string; accuracy: number; issues: string }[];
  examHistory: { title: string; date: string; status: string; classCount: number }[];
}

export function useTeacherDetailAnalytics(teacherId: string | undefined) {
  return useQuery({
    queryKey: ["teacher-detail-analytics", teacherId],
    queryFn: async (): Promise<TeacherDetailData | null> => {
      if (!teacherId) return null;

      const [profileRes, assignmentsRes, examsRes] = await Promise.all([
        supabase.from("profiles").select("full_name, institution_id").eq("id", teacherId).single(),
        supabase.from("class_assignments").select("class_id, subject_id, classes:class_id(id, name, section), subjects:subject_id(name)").eq("user_id", teacherId).eq("role", "teacher"),
        supabase.from("exams").select("id, title, status, scheduled_date").eq("created_by", teacherId),
      ]);

      const profile = profileRes.data;
      if (!profile) return null;

      const assignments = assignmentsRes.data || [];
      const classIds = [...new Set(assignments.map(a => a.class_id))];

      // Get snapshots for all assigned classes
      const { data: snapshots } = classIds.length > 0
        ? await supabase.from("student_performance_snapshots").select("*, profiles:student_id(full_name), classes:class_id(name, section)").in("class_id", classIds)
        : { data: [] };

      const allStudents = snapshots || [];
      const allAccuracies = allStudents.map(s => Number(s.accuracy_percent));
      const avgAccuracy = allAccuracies.length > 0 ? allAccuracies.reduce((a, b) => a + b, 0) / allAccuracies.length : 0;
      const passCount = allAccuracies.filter(a => a >= 50).length;
      const passRate = allAccuracies.length > 0 ? (passCount / allAccuracies.length) * 100 : 0;

      // Class-wise performance
      const classPerformance = classIds.map(cid => {
        const cls = assignments.find(a => a.class_id === cid);
        const classStudents = allStudents.filter(s => s.class_id === cid);
        const accs = classStudents.map(s => Number(s.accuracy_percent));
        const avg = accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
        const pr = accs.length > 0 ? (accs.filter(a => a >= 50).length / accs.length) * 100 : 0;
        return {
          className: formatClassName((cls?.classes as any)?.name || "", (cls?.classes as any)?.section),
          accuracy: avg,
          passRate: pr,
          students: classStudents.length,
        };
      });

      // Subject radar
      const subjectMap = new Map<string, number[]>();
      assignments.forEach(a => {
        const subjectName = (a.subjects as any)?.name || "General";
        const classStudents = allStudents.filter(s => s.class_id === a.class_id);
        if (!subjectMap.has(subjectName)) subjectMap.set(subjectName, []);
        classStudents.forEach(s => subjectMap.get(subjectName)!.push(Number(s.accuracy_percent)));
      });
      const subjectRadar = Array.from(subjectMap.entries()).slice(0, 8).map(([subject, accs]) => ({
        subject: subject.length > 8 ? subject.slice(0, 8) + "…" : subject,
        average: accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : 0,
        fullMark: 100,
      }));

      // Student distribution per class
      const studentDistribution = classIds.map(cid => {
        const cls = assignments.find(a => a.class_id === cid);
        const classStudents = allStudents.filter(s => s.class_id === cid);
        let excellent = 0, good = 0, average = 0, atRisk = 0;
        classStudents.forEach(s => {
          const acc = Number(s.accuracy_percent);
          if (acc >= 80) excellent++;
          else if (acc >= 65) good++;
          else if (acc >= 50) average++;
          else atRisk++;
        });
        return {
          className: formatClassName((cls?.classes as any)?.name || "", (cls?.classes as any)?.section),
          excellent, good, average, atRisk,
        };
      });

      // Class breakdown table
      const classBreakdown = assignments.map(a => {
        const classStudents = allStudents.filter(s => s.class_id === a.class_id);
        const accs = classStudents.map(s => Number(s.accuracy_percent));
        const avg = accs.length > 0 ? accs.reduce((x, y) => x + y, 0) / accs.length : 0;
        const pr = accs.length > 0 ? (accs.filter(x => x >= 50).length / accs.length) * 100 : 0;
        let status = "Average";
        if (avg >= 80) status = "Excellent";
        else if (avg >= 65) status = "Good";
        else if (avg < 50) status = "At Risk";
        return {
          className: formatClassName((a.classes as any)?.name || "", (a.classes as any)?.section),
          subject: (a.subjects as any)?.name || "General",
          students: classStudents.length,
          avgScore: avg,
          passRate: pr,
          status,
        };
      });

      // At-risk students
      const atRiskStudents = allStudents
        .filter(s => Number(s.accuracy_percent) < 50)
        .sort((a, b) => Number(a.accuracy_percent) - Number(b.accuracy_percent))
        .slice(0, 10)
        .map(s => ({
          name: getDisplayName(s.profiles),
          className: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
          accuracy: Number(s.accuracy_percent),
          issues: Number(s.accuracy_percent) < 30 ? "Critical - Needs Immediate Attention" : "Below Passing Threshold",
        }));

      // Exam history
      const examHistory = (examsRes.data || []).slice(0, 10).map(e => ({
        title: e.title,
        date: e.scheduled_date || "",
        status: e.status,
        classCount: classIds.length,
      }));

      // Performance trend (simplified from aggregates)
      const { data: aggs } = classIds.length > 0
        ? await supabase.from("class_aggregates").select("avg_accuracy_percent, computed_at").in("class_id", classIds).order("computed_at", { ascending: true }).limit(10)
        : { data: [] };
      const performanceTrend = (aggs || []).slice(-5).map((a, i) => ({
        exam: `Period ${i + 1}`,
        average: Number(a.avg_accuracy_percent),
      }));

      return {
        teacherName: getDisplayName(profile),
        classesTeaching: classIds.length,
        totalStudents: allStudents.length,
        averageAccuracy: avgAccuracy,
        passRate,
        examsCreated: examsRes.data?.length || 0,
        classPerformance,
        subjectRadar,
        studentDistribution,
        performanceTrend,
        classBreakdown,
        atRiskStudents,
        examHistory,
      };
    },
    enabled: !!teacherId,
    staleTime: 5 * 60 * 1000,
  });
}
