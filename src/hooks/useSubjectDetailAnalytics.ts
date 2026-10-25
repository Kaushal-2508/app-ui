import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export interface SubjectDetailData {
  subjectName: string;
  totalClasses: number;
  totalTeachers: number;
  schoolAverage: number;
  highestClassAverage: number;
  lowestClassAverage: number;
  classComparison: { className: string; average: number; fill: string }[];
  teacherComparison: { teacherName: string; average: number; students: number }[];
  scoreDistribution: { range: string; count: number; fill: string }[];
  trendLine: { period: string; average: number }[];
  classTeacherMatrix: { className: string; section: string; teacher: string; avgScore: number; passRate: number; studentCount: number }[];
  topStudents: { name: string; className: string; accuracy: number }[];
  bottomStudents: { name: string; className: string; accuracy: number }[];
  grades: string[];
  teachers: string[];
}

const FILLS = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#3B82F6", "#EF4444", "#14B8A6", "#A855F7"];

export function useSubjectDetailAnalytics(subjectId: string | undefined, institutionId: string | null) {
  return useQuery({
    queryKey: ["subject-detail-analytics", subjectId, institutionId],
    queryFn: async (): Promise<SubjectDetailData | null> => {
      if (!subjectId || !institutionId) return null;

      // Get subject name
      const { data: subject } = await supabase.from("universal_subjects").select("name").eq("id", subjectId).single();
      if (!subject) return null;

      // Get all class assignments for this subject in the institution
      const { data: assignments } = await supabase
        .from("class_assignments")
        .select("class_id, user_id, profiles:user_id(full_name), classes:class_id(id, name, section, institution_id)")
        .eq("subject_id", subjectId)
        .eq("role", "teacher");

      // Filter to institution
      const instAssignments = (assignments || []).filter(a => (a.classes as any)?.institution_id === institutionId);
      const classIds = [...new Set(instAssignments.map(a => a.class_id))];
      const teacherIds = [...new Set(instAssignments.map(a => a.user_id))];

      // Get snapshots for classes
      const { data: snapshots } = classIds.length > 0
        ? await supabase.from("student_performance_snapshots").select("*, profiles:student_id(full_name), classes:class_id(name, section)").in("class_id", classIds)
        : { data: [] };

      const allStudents = snapshots || [];
      const allAccuracies = allStudents.map(s => Number(s.accuracy_percent));
      const schoolAverage = allAccuracies.length > 0 ? allAccuracies.reduce((a, b) => a + b, 0) / allAccuracies.length : 0;

      // Class comparison
      const classAverages = classIds.map(cid => {
        const cls = instAssignments.find(a => a.class_id === cid);
        const classStudents = allStudents.filter(s => s.class_id === cid);
        const accs = classStudents.map(s => Number(s.accuracy_percent));
        const avg = accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
        return {
          classId: cid,
          className: formatClassName((cls?.classes as any)?.name || "", (cls?.classes as any)?.section),
          average: avg,
        };
      });

      const classComparison = classAverages.map((c, i) => ({
        className: c.className,
        average: c.average,
        fill: FILLS[i % FILLS.length],
      }));

      const highestClassAverage = classAverages.length > 0 ? Math.max(...classAverages.map(c => c.average)) : 0;
      const lowestClassAverage = classAverages.length > 0 ? Math.min(...classAverages.map(c => c.average)) : 0;

      // Teacher comparison
      const teacherComparison = teacherIds.map(tid => {
        const teacherAssignments = instAssignments.filter(a => a.user_id === tid);
        const teacherClassIds = teacherAssignments.map(a => a.class_id);
        const teacherStudents = allStudents.filter(s => teacherClassIds.includes(s.class_id));
        const accs = teacherStudents.map(s => Number(s.accuracy_percent));
        const avg = accs.length > 0 ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
        return {
          teacherName: getDisplayName(teacherAssignments[0]?.profiles),
          average: avg,
          students: teacherStudents.length,
        };
      });

      // Score distribution
      const buckets = [
        { range: "0-20%", min: 0, max: 20, fill: "#EF4444" },
        { range: "21-40%", min: 21, max: 40, fill: "#F59E0B" },
        { range: "41-60%", min: 41, max: 60, fill: "#F97316" },
        { range: "61-80%", min: 61, max: 80, fill: "#3B82F6" },
        { range: "81-100%", min: 81, max: 100, fill: "#10B981" },
      ];
      const scoreDistribution = buckets.map(b => ({
        range: b.range,
        count: allAccuracies.filter(a => a >= b.min && a <= b.max).length,
        fill: b.fill,
      }));

      // Trend line from aggregates
      const { data: aggs } = classIds.length > 0
        ? await supabase.from("class_aggregates").select("avg_accuracy_percent, computed_at").in("class_id", classIds).eq("subject_name", subject.name).order("computed_at").limit(10)
        : { data: [] };
      const trendLine = (aggs || []).slice(-6).map((a, i) => ({
        period: `Period ${i + 1}`,
        average: Number(a.avg_accuracy_percent),
      }));

      // Class-teacher matrix
      const classTeacherMatrix = instAssignments.map(a => {
        const classStudents = allStudents.filter(s => s.class_id === a.class_id);
        const accs = classStudents.map(s => Number(s.accuracy_percent));
        const avg = accs.length > 0 ? accs.reduce((x, y) => x + y, 0) / accs.length : 0;
        const pr = accs.length > 0 ? (accs.filter(x => x >= 50).length / accs.length) * 100 : 0;
        return {
          className: (a.classes as any)?.name || "",
          section: (a.classes as any)?.section || "A",
          teacher: getDisplayName(a.profiles),
          avgScore: avg,
          passRate: pr,
          studentCount: classStudents.length,
        };
      });

      // Top & bottom students
      const sorted = [...allStudents].sort((a, b) => Number(b.accuracy_percent) - Number(a.accuracy_percent));
      const topStudents = sorted.slice(0, 5).map(s => ({
        name: getDisplayName(s.profiles),
        className: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
        accuracy: Number(s.accuracy_percent),
      }));
      const bottomStudents = sorted.slice(-5).reverse().map(s => ({
        name: getDisplayName(s.profiles),
        className: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
        accuracy: Number(s.accuracy_percent),
      }));

      const grades = [...new Set(instAssignments.map(a => (a.classes as any)?.name || ""))].sort();
      const teachers = [...new Set(instAssignments.map(a => (a.profiles as any)?.full_name || ""))].sort();

      return {
        subjectName: subject.name,
        totalClasses: classIds.length,
        totalTeachers: teacherIds.length,
        schoolAverage,
        highestClassAverage,
        lowestClassAverage,
        classComparison,
        teacherComparison,
        scoreDistribution,
        trendLine,
        classTeacherMatrix,
        topStudents,
        bottomStudents,
        grades,
        teachers,
      };
    },
    enabled: !!subjectId && !!institutionId,
    staleTime: 5 * 60 * 1000,
  });
}
