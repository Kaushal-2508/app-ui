import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export interface SchoolOverviewMetrics {
  totalStudents: number;
  totalClasses: number;
  totalTeachers: number;
  schoolAverage: number;
  attendanceRate: number;
  performanceRating: number;
  improvementTrend: number;
  passRate: number;
}

export interface ClassPerformanceItem {
  classId: string;
  grade: string;
  section: string;
  average: number;
  studentCount: number;
  teacherName: string;
  passRate: number;
  needsAttention: number;
  developing: number;
  stable: number;
  status: "Excellent" | "Good" | "Average" | "At Risk";
}

export interface StudentPositioningMatrix {
  needsAttention: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
  developing: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
  stable: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
}

export interface SubjectRiskIndicator {
  subjectId: string;
  subjectName: string;
  average: number;
  riskLevel: "High" | "Moderate" | "Stable";
  studentsAffected: number;
  classesAffected: string[];
  teacherResponsible: string;
  trend: "improving" | "declining" | "stable";
}

export interface TeacherActionSuggestion {
  teacherId: string;
  teacherName: string;
  subjects: string[];
  classes: string[];
  studentsNeedingAttention: number;
  actionItems: string[];
  references: { metric: string; value: string }[];
}

export interface StudentAttentionSignal {
  studentId: string;
  studentName: string;
  className: string;
  priority: "Immediate" | "High" | "Monitor";
  issues: string[];
  subjectsOfConcern: { subject: string; accuracy: number }[];
  recommendations: string[];
}

export interface TopicHeatmapCell {
  studentId: string;
  studentName: string;
  topic: string;
  accuracy: number;
  status: "Strong" | "Average" | "Weak";
}

export interface PrincipalInsight {
  id: string;
  type: "executive" | "risk" | "action" | "prediction";
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  icon: string;
  references: { metric: string; value: string; detail?: string }[];
}

export interface ExamStatusItem {
  name: string;
  value: number;
  color: string;
}

export interface SubjectRadarItem {
  subject: string;
  average: number;
  fullMark: number;
}

export interface ComprehensivePrincipalData {
  metrics: SchoolOverviewMetrics;
  classPerformance: ClassPerformanceItem[];
  studentPositioning: StudentPositioningMatrix;
  subjectRisks: SubjectRiskIndicator[];
  teacherActions: TeacherActionSuggestion[];
  studentAttention: StudentAttentionSignal[];
  topicHeatmap: TopicHeatmapCell[];
  insights: PrincipalInsight[];
  gradeHeatmap: { grade: string; sections: { section: string; average: number; classId: string }[] }[];
  crossClassComparison: { className: string; accuracy: number; passRate: number; efficiency: number }[];
  examStatusDistribution: ExamStatusItem[];
  subjectRadarData: SubjectRadarItem[];
}

export function useComprehensivePrincipalAnalytics(institutionId: string | null) {
  return useQuery({
    queryKey: ["comprehensive-principal-analytics", institutionId],
    queryFn: async (): Promise<ComprehensivePrincipalData | null> => {
      if (!institutionId) return null;

      // Get all classes
      const { data: classes } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true);

      const classIds = classes?.map(c => c.id) || [];

      // Get class aggregates
      const { data: aggregates } = classIds.length > 0
        ? await supabase.from("class_aggregates").select("*").in("class_id", classIds)
        : { data: [] };

      // Get exam status counts
      const { data: exams } = await supabase
        .from("exams")
        .select("id, status")
        .eq("institution_id", institutionId);

      // Get all student snapshots
      const { data: snapshots } = classIds.length > 0
        ? await supabase
            .from("student_performance_snapshots")
            .select(`*, profiles:student_id(id, full_name), classes:class_id(id, name, section)`)
            .in("class_id", classIds)
        : { data: [] };

      // Get teacher assignments
      const { data: teacherAssignments } = await supabase
        .from("class_assignments")
        .select(`
          class_id, subject_id, user_id,
          profiles:user_id(id, full_name),
          subjects:subject_id(id, name)
        `)
        .in("class_id", classIds)
        .eq("role", "teacher");

      // Get all teachers
      const { data: teachers } = await supabase
        .from("user_roles")
        .select("user_id, profiles:user_id(id, full_name)")
        .eq("institution_id", institutionId)
        .eq("role", "teacher");

      // Get topic performance
      const studentIds = [...new Set(snapshots?.map(s => s.student_id) || [])];
      const { data: topicPerformance } = studentIds.length > 0
        ? await supabase.from("student_topic_performance").select("*").in("student_id", studentIds)
        : { data: [] };

      // Calculate school-wide metrics
      const allAccuracies = snapshots?.map(s => Number(s.accuracy_percent)) || [];
      const schoolAverage = allAccuracies.length > 0
        ? allAccuracies.reduce((a, b) => a + b, 0) / allAccuracies.length
        : 0;
      
      const passCount = allAccuracies.filter(a => a >= 50).length;
      const passRate = allAccuracies.length > 0 ? (passCount / allAccuracies.length) * 100 : 0;

      let naCount = 0, devCount = 0, stableCount = 0;
      snapshots?.forEach(s => {
        const acc = Number(s.accuracy_percent);
        if (acc < 50) naCount++;
        else if (acc < 65) devCount++;
        else stableCount++;
      });

      const metrics: SchoolOverviewMetrics = {
        totalStudents: snapshots?.length || 0,
        totalClasses: classes?.length || 0,
        totalTeachers: teachers?.length || 0,
        schoolAverage,
        attendanceRate: 92, // Would need attendance data
        performanceRating: Math.min(5, schoolAverage / 20),
        improvementTrend: 0,
        passRate,
      };

      // Build class performance
      const classPerformance: ClassPerformanceItem[] = classes?.map(cls => {
        const classSnapshots = snapshots?.filter(s => s.class_id === cls.id) || [];
        const classAggs = aggregates?.filter(a => a.class_id === cls.id) || [];
        
        const avg = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / classSnapshots.length
          : classAggs.length > 0 ? Number(classAggs[0].avg_accuracy_percent) : 0;
        
        const teacher = teacherAssignments?.find(t => t.class_id === cls.id);
        
        let na = 0, dev = 0, stable = 0;
        classSnapshots.forEach(s => {
          const acc = Number(s.accuracy_percent);
          if (acc < 50) na++;
          else if (acc < 65) dev++;
          else stable++;
        });

        const passed = classSnapshots.filter(s => Number(s.accuracy_percent) >= 50).length;
        const pr = classSnapshots.length > 0 ? (passed / classSnapshots.length) * 100 : 0;

        let status: ClassPerformanceItem["status"] = "Average";
        if (avg >= 80) status = "Excellent";
        else if (avg >= 65) status = "Good";
        else if (avg < 50) status = "At Risk";

        return {
          classId: cls.id,
          grade: cls.name,
          section: cls.section || "A",
          average: avg,
          studentCount: classSnapshots.length,
          teacherName: teacher ? getDisplayName(teacher.profiles, "Unassigned") : "Unassigned",
          passRate: pr,
          needsAttention: na,
          developing: dev,
          stable: stable,
          status,
        };
      }) || [];

      // Student positioning matrix
      const naStudents = snapshots?.filter(s => Number(s.accuracy_percent) < 50).map(s => ({
        id: s.student_id,
        name: getDisplayName(s.profiles),
        class: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
        accuracy: Number(s.accuracy_percent),
      })) || [];

      const devStudents = snapshots?.filter(s => {
        const acc = Number(s.accuracy_percent);
        return acc >= 50 && acc < 65;
      }).map(s => ({
        id: s.student_id,
        name: getDisplayName(s.profiles),
        class: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
        accuracy: Number(s.accuracy_percent),
      })) || [];

      const stableStudents = snapshots?.filter(s => Number(s.accuracy_percent) >= 65).map(s => ({
        id: s.student_id,
        name: getDisplayName(s.profiles),
        class: formatClassName((s.classes as any)?.name || "", (s.classes as any)?.section),
        accuracy: Number(s.accuracy_percent),
      })) || [];

      const total = snapshots?.length || 1;
      const studentPositioning: StudentPositioningMatrix = {
        needsAttention: {
          count: naCount,
          percentage: (naCount / total) * 100,
          students: naStudents.sort((a, b) => a.accuracy - b.accuracy).slice(0, 20),
        },
        developing: {
          count: devCount,
          percentage: (devCount / total) * 100,
          students: devStudents.sort((a, b) => a.accuracy - b.accuracy).slice(0, 20),
        },
        stable: {
          count: stableCount,
          percentage: (stableCount / total) * 100,
          students: stableStudents.sort((a, b) => b.accuracy - a.accuracy).slice(0, 20),
        },
      };

      // Subject risk indicators
      const subjectMap: Map<string, { 
        totalAcc: number; count: number; studentsAffected: number; classes: Set<string>; teacher: string;
      }> = new Map();

      teacherAssignments?.forEach(ta => {
        const subjectName = (ta.subjects as any)?.name || "General";
        const subjectId = ta.subject_id || "";
        const teacherName = getDisplayName(ta.profiles);
        const cls = classes?.find(c => c.id === ta.class_id);
        
        if (!subjectMap.has(subjectId)) {
          subjectMap.set(subjectId, { totalAcc: 0, count: 0, studentsAffected: 0, classes: new Set(), teacher: teacherName });
        }
        
        const data = subjectMap.get(subjectId)!;
        const classSnapshots = snapshots?.filter(s => s.class_id === ta.class_id) || [];
        classSnapshots.forEach(s => {
          data.totalAcc += Number(s.accuracy_percent);
          data.count++;
          if (Number(s.accuracy_percent) < 50) data.studentsAffected++;
        });
        if (cls) data.classes.add(formatClassName(cls.name, cls.section));
      });

      const subjectRisks: SubjectRiskIndicator[] = Array.from(subjectMap.entries())
        .filter(([id]) => id)
        .map(([subjectId, data]) => {
          const avg = data.count > 0 ? data.totalAcc / data.count : 0;
          let riskLevel: SubjectRiskIndicator["riskLevel"] = "Stable";
          if (avg < 60) riskLevel = "High";
          else if (avg < 75) riskLevel = "Moderate";

          const subject = teacherAssignments?.find(ta => ta.subject_id === subjectId);
          
          return {
            subjectId,
            subjectName: (subject?.subjects as any)?.name || "Unknown",
            average: avg,
            riskLevel,
            studentsAffected: data.studentsAffected,
            classesAffected: Array.from(data.classes),
            teacherResponsible: data.teacher,
            trend: "stable" as const,
          };
        })
        .sort((a, b) => a.average - b.average);

      // Teacher action suggestions
      const teacherMap: Map<string, {
        name: string; subjects: Set<string>; classes: Set<string>; studentsNA: number; 
      }> = new Map();

      teacherAssignments?.forEach(ta => {
        const teacherId = ta.user_id;
        const teacherName = getDisplayName(ta.profiles);
        const subjectName = (ta.subjects as any)?.name || "";
        const cls = classes?.find(c => c.id === ta.class_id);
        
        if (!teacherMap.has(teacherId)) {
          teacherMap.set(teacherId, { name: teacherName, subjects: new Set(), classes: new Set(), studentsNA: 0 });
        }
        
        const data = teacherMap.get(teacherId)!;
        if (subjectName) data.subjects.add(subjectName);
        if (cls) data.classes.add(formatClassName(cls.name, cls.section));
        
        const classSnapshots = snapshots?.filter(s => s.class_id === ta.class_id) || [];
        data.studentsNA += classSnapshots.filter(s => Number(s.accuracy_percent) < 50).length;
      });

      const teacherActions: TeacherActionSuggestion[] = Array.from(teacherMap.entries()).map(([teacherId, data]) => {
        const actionItems: string[] = [];
        if (data.studentsNA > 0) {
          actionItems.push(`Conduct remedial sessions for ${data.studentsNA} underperforming students`);
        }
        if (data.studentsNA > 5) {
          actionItems.push("Schedule parent-teacher meetings for struggling students");
        }
        actionItems.push("Review teaching methodology for weak topics");

        return {
          teacherId,
          teacherName: data.name,
          subjects: Array.from(data.subjects),
          classes: Array.from(data.classes),
          studentsNeedingAttention: data.studentsNA,
          actionItems,
          references: [
            { metric: "Students Needing Attention", value: `${data.studentsNA}` },
            { metric: "Classes Assigned", value: `${data.classes.size}` },
          ],
        };
      }).sort((a, b) => b.studentsNeedingAttention - a.studentsNeedingAttention);

      // Student attention signals
      const studentAttention: StudentAttentionSignal[] = naStudents.slice(0, 20).map(s => {
        const studentTopics = topicPerformance?.filter(tp => tp.student_id === s.id) || [];
        const weakSubjects = studentTopics.filter(tp => (Number(tp.accuracy_percentage) || 0) < 50);
        
        let priority: StudentAttentionSignal["priority"] = "Monitor";
        const issues: string[] = [];
        
        if (s.accuracy < 40 || weakSubjects.length >= 2) {
          priority = "Immediate";
          issues.push("Overall performance critically low");
          if (weakSubjects.length >= 2) issues.push("Failing multiple subjects");
        } else if (s.accuracy < 50) {
          priority = "High";
          issues.push("Below passing threshold");
        }

        return {
          studentId: s.id,
          studentName: s.name,
          className: s.class,
          priority,
          issues,
          subjectsOfConcern: weakSubjects.slice(0, 3).map(w => ({
            subject: w.topic_tag || "Unknown",
            accuracy: Number(w.accuracy_percentage) || 0,
          })),
          recommendations: [
            "Schedule one-on-one tutoring sessions",
            "Assign additional practice materials",
            priority === "Immediate" ? "Notify parents for intervention" : "Monitor progress weekly",
          ],
        };
      });

      // Topic heatmap (simplified)
      const topicHeatmap: TopicHeatmapCell[] = [];
      topicPerformance?.slice(0, 100).forEach(tp => {
        const student = snapshots?.find(s => s.student_id === tp.student_id);
        const acc = Number(tp.accuracy_percentage) || 0;
        let status: TopicHeatmapCell["status"] = "Average";
        if (acc >= 75) status = "Strong";
        else if (acc < 50) status = "Weak";
        
        topicHeatmap.push({
          studentId: tp.student_id,
          studentName: getDisplayName(student?.profiles),
          topic: tp.topic_tag || "Unknown",
          accuracy: acc,
          status,
        });
      });

      // Generate insights
      const insights: PrincipalInsight[] = [];

      // Executive summary
      insights.push({
        id: "executive-summary",
        type: "executive",
        title: "School Performance Overview",
        message: `School average is ${schoolAverage.toFixed(1)}% with ${passRate.toFixed(0)}% pass rate. ${naCount} students need immediate attention.`,
        severity: schoolAverage >= 65 ? "info" : schoolAverage >= 50 ? "warning" : "critical",
        icon: "📊",
        references: [
          { metric: "School Average", value: `${schoolAverage.toFixed(1)}%` },
          { metric: "Pass Rate", value: `${passRate.toFixed(0)}%` },
          { metric: "Students at Risk", value: `${naCount}` },
        ],
      });

      // At-risk classes
      const atRiskClasses = classPerformance.filter(c => c.status === "At Risk");
      if (atRiskClasses.length > 0) {
        insights.push({
          id: "at-risk-classes",
          type: "risk",
          title: "Classes Requiring Intervention",
          message: `${atRiskClasses.length} classes are performing below acceptable levels and require immediate intervention.`,
          severity: "critical",
          icon: "⚠️",
          references: atRiskClasses.slice(0, 3).map(c => ({
            metric: formatClassName(c.grade, c.section),
            value: `${c.average.toFixed(1)}%`,
            detail: `Teacher: ${c.teacherName}`,
          })),
        });
      }

      // High-risk subjects
      const highRiskSubjects = subjectRisks.filter(s => s.riskLevel === "High");
      if (highRiskSubjects.length > 0) {
        insights.push({
          id: "high-risk-subjects",
          type: "risk",
          title: "Subjects Needing Focus",
          message: `${highRiskSubjects.length} subjects are showing concerning performance levels across multiple classes.`,
          severity: "warning",
          icon: "📚",
          references: highRiskSubjects.slice(0, 3).map(s => ({
            metric: s.subjectName,
            value: `${s.average.toFixed(1)}%`,
            detail: `${s.studentsAffected} students affected`,
          })),
        });
      }

      // Teacher support needed
      const teachersNeedingSupport = teacherActions.filter(t => t.studentsNeedingAttention > 5);
      if (teachersNeedingSupport.length > 0) {
        insights.push({
          id: "teacher-support",
          type: "action",
          title: "Teachers Needing Support",
          message: `${teachersNeedingSupport.length} teachers have significant numbers of struggling students and may need additional resources or training.`,
          severity: "warning",
          icon: "👨‍🏫",
          references: teachersNeedingSupport.slice(0, 3).map(t => ({
            metric: t.teacherName,
            value: `${t.studentsNeedingAttention} students`,
            detail: t.subjects.join(", "),
          })),
        });
      }

      // Predicted attention
      if (devCount > naCount) {
        insights.push({
          id: "predicted-attention",
          type: "prediction",
          title: "Preventive Action Recommended",
          message: `${devCount} students in the "Developing" category are at risk of declining. Early intervention can prevent them from falling into "Needs Attention".`,
          severity: "info",
          icon: "🔮",
          references: [
            { metric: "Developing Students", value: `${devCount}` },
            { metric: "Potential Risk", value: "May decline without support" },
          ],
        });
      }

      // Grade heatmap
      const gradeMap: Map<string, { section: string; average: number; classId: string }[]> = new Map();
      classPerformance.forEach(cp => {
        if (!gradeMap.has(cp.grade)) {
          gradeMap.set(cp.grade, []);
        }
        gradeMap.get(cp.grade)!.push({ section: cp.section, average: cp.average, classId: cp.classId });
      });

      const gradeHeatmap = Array.from(gradeMap.entries()).map(([grade, sections]) => ({
        grade,
        sections: sections.sort((a, b) => a.section.localeCompare(b.section)),
      }));

      // Cross-class comparison
      const crossClassComparison = classPerformance.map(cp => ({
        className: formatClassName(cp.grade, cp.section),
        accuracy: cp.average,
        passRate: cp.passRate,
        efficiency: 0,
      }));

      // Exam status distribution
      const statusCounts: Record<string, number> = {};
      exams?.forEach(e => {
        statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
      });
      const examStatusDistribution: ExamStatusItem[] = [
        { name: "Draft", value: statusCounts["draft"] || 0, color: "#94A3B8" },
        { name: "Published", value: statusCounts["published"] || 0, color: "#3B82F6" },
        { name: "Active", value: statusCounts["active"] || 0, color: "#F59E0B" },
        { name: "Completed", value: statusCounts["completed"] || 0, color: "#10B981" },
        { name: "Archived", value: statusCounts["archived"] || 0, color: "#8B5CF6" },
      ];

      // Subject radar data
      const subjectRadarData: SubjectRadarItem[] = subjectRisks.map(s => ({
        subject: s.subjectName.length > 12 ? s.subjectName.slice(0, 12) + "…" : s.subjectName,
        average: Math.round(s.average * 10) / 10,
        fullMark: 100,
      }));

      return {
        metrics,
        classPerformance,
        studentPositioning,
        subjectRisks,
        teacherActions,
        studentAttention,
        topicHeatmap,
        insights,
        gradeHeatmap,
        crossClassComparison,
        examStatusDistribution,
        subjectRadarData,
      };
    },
    enabled: !!institutionId,
  });
}
