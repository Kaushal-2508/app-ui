import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

// PostgREST to-one embeds can come back as an object or a single-element
// array depending on the join path — normalize before reading fields.
function embedOne<T>(v: unknown): T | null {
  const e = v as T | T[] | null | undefined;
  if (e == null) return null;
  return Array.isArray(e) ? (e[0] ?? null) : e;
}
interface ClassEmbed { name: string | null; section: string | null }
interface ProfileEmbed { full_name: string | null }
interface SubjectEmbed { name: string | null }

export interface ClassPerformance {
  classId: string;
  className: string;
  section: string;
  studentCount: number;
  avgAccuracy: number;
  avgTime: number;
  efficiency: number;
  passRate: number;
  needsAttention: number;
  developing: number;
  stable: number;
}

export interface StudentPerformanceRow {
  studentId: string;
  studentName: string;
  className: string;
  overallPercent: number;
  subjectScores: Record<string, number>;
  avgTime: number;
  efficiency: number;
  deviation: number;
  status: "Needs Attention" | "Developing" | "Stable";
  trend: "improving" | "declining" | "stable";
}

export interface TopicGap {
  topic: string;
  classAvg: number;
  studentsAffected: number;
  classes: string[];
  severity: "Critical" | "Moderate" | "Low";
}

export interface TeachingRecommendation {
  id: string;
  type: "performance" | "topic_gap" | "differentiation" | "time_allocation" | "methodology";
  title: string;
  message: string;
  badge: "Needs Attention" | "Developing" | "Stable" | "Guide";
  icon: string;
  references: {
    metric: string;
    value: string;
    detail?: string;
  }[];
  studentList?: string[];
}

export interface SectionDivision {
  sectionName: string;
  criteria: string;
  count: number;
  students: { id: string; name: string; accuracy: number }[];
  color: string;
}

export interface ComprehensiveTeacherData {
  profile: { name: string; subjects: string[]; classCount: number };
  classes: ClassPerformance[];
  overallMetrics: {
    totalStudents: number;
    overallAccuracy: number;
    avgTimePerQuestion: number;
    efficiency: number;
    topperAccuracy: number;
    needsAttentionCount: number;
    developingCount: number;
    stableCount: number;
  };
  studentPerformance: StudentPerformanceRow[];
  topicGaps: TopicGap[];
  recommendations: TeachingRecommendation[];
  sectionDivisions: SectionDivision[];
  scatterData: { name: string; x: number; y: number; studentId: string }[];
  scoreDistribution: { range: string; count: number; color: string; students: string[] }[];
  crossClassComparison: { className: string; accuracy: number; efficiency: number; needsAttention: number }[];
}

export function useComprehensiveTeacherAnalytics(teacherId: string | null, selectedClassId?: string | null) {
  return useQuery({
    queryKey: ["comprehensive-teacher-analytics", teacherId, selectedClassId],
    queryFn: async (): Promise<ComprehensiveTeacherData | null> => {
      if (!teacherId) return null;

      // Get teacher profile
      // Every read below THROWS on error rather than destructuring `data`
      // alone. A swallowed error made `assignments` null, which is
      // indistinguishable from "teacher has no classes", and the queryFn then
      // RESOLVED with an all-zero report that React Query marked a success -
      // the teacher was shown "0 Classes / 0.0% average" as fact.
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", teacherId)
        .single();
      if (profileErr) throw profileErr;

      // Get teacher's class assignments
      const { data: assignments, error: assignErr } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          classes!class_assignments_class_id_fkey!inner(id, name, section, academic_year, institution_id),
          subjects:subject_id(id, name)
        `)
        .eq("user_id", teacherId)
        .eq("role", "teacher")
        // AY rollover leaves last year's class rows inactive; a stale
        // assignment would list the class twice in the dashboard picker.
        .eq("classes.is_active", true);
      if (assignErr) throw assignErr;

      const classIds = selectedClassId 
        ? [selectedClassId] 
        : assignments?.map(a => a.class_id) || [];

      if (classIds.length === 0) {
        return {
          profile: { name: profile?.full_name || "Teacher", subjects: [], classCount: 0 },
          classes: [],
          overallMetrics: {
            totalStudents: 0,
            overallAccuracy: 0,
            avgTimePerQuestion: 0,
            efficiency: 0,
            topperAccuracy: 0,
            needsAttentionCount: 0,
            developingCount: 0,
            stableCount: 0,
          },
          studentPerformance: [],
          topicGaps: [],
          recommendations: [],
          sectionDivisions: [],
          scatterData: [],
          scoreDistribution: [],
          crossClassComparison: [],
        };
      }

      // Get student performance snapshots
      const { data: snapshotsRaw, error: snapshotsErr } = await supabase
        .from("student_performance_snapshots")
        .select(`
          *,
          profiles:student_id(id, full_name),
          classes:class_id(id, name, section)
        `)
        .in("class_id", classIds);
      if (snapshotsErr) throw snapshotsErr;

      // Subject-scoped roster (policy 2026-08-26): every count and metric in
      // this report covers only students of the teacher's own subjects. The
      // RPC's caller guard admits the teacher themself plus admins and
      // coordinators viewing the report on their behalf.
      const { data: allowedRows, error: allowedErr } = await supabase.rpc(
        "teacher_roster_student_ids",
        { _teacher: teacherId, _class_ids: classIds },
      );
      if (allowedErr) throw allowedErr;
      const rosterSet = new Set((allowedRows ?? []).map((r) => r.student_id));
      const snapshots = (snapshotsRaw ?? []).filter((s) => rosterSet.has(s.student_id));

      // Per-class headcount of the teacher's OWN students: one paginated fetch
      // (replaces the old per-class head-count fan-out) intersected with the
      // subject-scoped roster.
      const enrolledStudentMap = new Map<string, number>();
      {
        const PAGE = 1000;
        for (let from = 0; ; from += PAGE) {
          const { data: rows, error: rowsErr } = await supabase
            .from("class_assignments")
            .select("user_id, class_id")
            .eq("role", "student")
            .in("class_id", classIds)
            .range(from, from + PAGE - 1);
          if (rowsErr) throw rowsErr;
          for (const r of rows ?? []) {
            if (rosterSet.has(r.user_id)) {
              enrolledStudentMap.set(r.class_id, (enrolledStudentMap.get(r.class_id) ?? 0) + 1);
            }
          }
          if (!rows || rows.length < PAGE) break;
        }
      }

      // Get class aggregates
      const { data: aggregates, error: aggregatesErr } = await supabase
        .from("class_aggregates")
        .select("*")
        .in("class_id", classIds);
      if (aggregatesErr) throw aggregatesErr;

      // Get topic performance for all students in these classes
      const studentIds = [...new Set(snapshots?.map(s => s.student_id) || [])];
      const { data: topicPerformance, error: topicErr } = studentIds.length > 0
        ? await supabase
            .from("student_topic_performance")
            .select("*")
            .in("student_id", studentIds)
        : { data: [], error: null };
      if (topicErr) throw topicErr;

      // Get unique subjects
      const subjects = [...new Set(assignments?.map(a => embedOne<SubjectEmbed>(a.subjects)?.name).filter(Boolean))] as string[];

      // Calculate overall metrics
      const totalSnapshots = snapshots?.length || 0;
      const overallAccuracy = totalSnapshots > 0
        ? snapshots!.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / totalSnapshots
        : 0;
      const avgTimePerQuestion = totalSnapshots > 0
        ? snapshots!.reduce((sum, s) => sum + Number(s.avg_time_per_question_seconds), 0) / totalSnapshots
        : 0;
      const efficiency = totalSnapshots > 0
        ? snapshots!.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / totalSnapshots
        : 0;
      const topperAccuracy = snapshots && snapshots.length > 0
        ? Math.max(...snapshots.map(s => Number(s.accuracy_percent)))
        : 0;

      // Count students by status
      let needsAttentionCount = 0;
      let developingCount = 0;
      let stableCount = 0;

      snapshots?.forEach(s => {
        const acc = Number(s.accuracy_percent);
        if (acc < 50) needsAttentionCount++;
        else if (acc < 65) developingCount++;
        else stableCount++;
      });

      // Build class performance data - group by class_id to avoid duplicates
      type AssignmentRow = NonNullable<typeof assignments>[number];
      const classMap = new Map<string, {
        assignment: AssignmentRow;
        subjects: string[];
      }>();

      assignments?.forEach(a => {
        const cls = embedOne<ClassEmbed>(a.classes);
        if (!cls) return;
        
        if (!classMap.has(a.class_id)) {
          classMap.set(a.class_id, { 
            assignment: a, 
            subjects: [] 
          });
        }
        
        const subjectName = embedOne<SubjectEmbed>(a.subjects)?.name;
        if (subjectName && !classMap.get(a.class_id)!.subjects.includes(subjectName)) {
          classMap.get(a.class_id)!.subjects.push(subjectName);
        }
      });

      const classes: ClassPerformance[] = Array.from(classMap.values()).map(({ assignment: a }) => {
        const cls = embedOne<ClassEmbed>(a.classes);
        const classSnapshots = snapshots?.filter(s => s.class_id === a.class_id) || [];
        const classAgg = aggregates?.find(ag => ag.class_id === a.class_id);

        let na = 0, dev = 0, stable = 0;
        classSnapshots.forEach(s => {
          const acc = Number(s.accuracy_percent);
          if (acc < 50) na++;
          else if (acc < 65) dev++;
          else stable++;
        });

        const avgAcc = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / classSnapshots.length
          : classAgg?.avg_accuracy_percent || 0;
        const avgTime = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.avg_time_per_question_seconds), 0) / classSnapshots.length
          : classAgg?.avg_time_per_question_seconds || 0;
        const eff = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / classSnapshots.length
          : classAgg?.avg_efficiency_score || 0;
        
        const passed = classSnapshots.filter(s => Number(s.accuracy_percent) >= 50).length;
        const passRate = classSnapshots.length > 0 ? (passed / classSnapshots.length) * 100 : 0;

        return {
          classId: a.class_id,
          className: cls?.name || "Unknown",
          section: cls?.section || "A",
          studentCount: enrolledStudentMap.get(a.class_id) || 0,
          avgAccuracy: Number(avgAcc),
          avgTime: Number(avgTime),
          efficiency: Number(eff),
          passRate,
          needsAttention: na,
          developing: dev,
          stable: stable,
        };
      });

      // Build student performance table
      const studentPerformance: StudentPerformanceRow[] = snapshots?.map(s => {
        const acc = Number(s.accuracy_percent);
        let status: StudentPerformanceRow["status"] = "Stable";
        if (acc < 50) status = "Needs Attention";
        else if (acc < 65) status = "Developing";

        return {
          studentId: s.student_id,
          studentName: getDisplayName(s.profiles),
          className: formatClassName(embedOne<ClassEmbed>(s.classes)?.name || "", embedOne<ClassEmbed>(s.classes)?.section),
          overallPercent: acc,
          subjectScores: {},
          avgTime: Number(s.avg_time_per_question_seconds),
          efficiency: Number(s.efficiency_score),
          deviation: acc - overallAccuracy,
          status,
          trend: "stable" as const,
        };
      }).sort((a, b) => b.overallPercent - a.overallPercent) || [];

      // Identify topic gaps across classes
      const topicAggregates: Map<string, { 
        totalAccuracy: number; 
        count: number; 
        studentsAffected: number;
        classes: Set<string>;
      }> = new Map();

      topicPerformance?.forEach(tp => {
        const topic = tp.topic_tag || "General";
        if (!topicAggregates.has(topic)) {
          topicAggregates.set(topic, { totalAccuracy: 0, count: 0, studentsAffected: 0, classes: new Set() });
        }
        const data = topicAggregates.get(topic)!;
        data.totalAccuracy += Number(tp.accuracy_percentage) || 0;
        data.count++;
        if ((Number(tp.accuracy_percentage) || 0) < 50) {
          data.studentsAffected++;
        }
        // Find which class this student belongs to
        const studentSnapshot = snapshots?.find(s => s.student_id === tp.student_id);
        if (studentSnapshot) {
          const cls = embedOne<ClassEmbed>(studentSnapshot.classes);
          data.classes.add(formatClassName(cls?.name || "", cls?.section));
        }
      });

      const topicGaps: TopicGap[] = Array.from(topicAggregates.entries())
        .map(([topic, data]) => {
          const avg = data.count > 0 ? data.totalAccuracy / data.count : 0;
          let severity: TopicGap["severity"] = "Low";
          if (avg < 40) severity = "Critical";
          else if (avg < 60) severity = "Moderate";
          
          return {
            topic,
            classAvg: avg,
            studentsAffected: data.studentsAffected,
            classes: Array.from(data.classes),
            severity,
          };
        })
        .filter(tg => tg.classAvg < 60)
        .sort((a, b) => a.classAvg - b.classAvg);

      // Generate teaching recommendations
      const recommendations: TeachingRecommendation[] = [];

      // Cross-class performance recommendation
      if (classes.length > 1) {
        const bestClass = classes.reduce((a, b) => a.avgAccuracy > b.avgAccuracy ? a : b);
        const worstClass = classes.reduce((a, b) => a.avgAccuracy < b.avgAccuracy ? a : b);
        
        if (bestClass.avgAccuracy - worstClass.avgAccuracy > 10) {
          recommendations.push({
            id: "cross-class",
            type: "performance",
            title: "Cross-Class Performance Gap",
            message: `${formatClassName(worstClass.className, worstClass.section)} is performing ${(bestClass.avgAccuracy - worstClass.avgAccuracy).toFixed(1)}% below ${formatClassName(bestClass.className, bestClass.section)}. Consider reviewing teaching approach.`,
            badge: "Needs Attention",
            icon: "📊",
            references: [
              { metric: "Best Class", value: `${bestClass.className} - ${bestClass.avgAccuracy.toFixed(1)}%` },
              { metric: "Needs Focus", value: `${worstClass.className} - ${worstClass.avgAccuracy.toFixed(1)}%` },
              { metric: "Gap", value: `${(bestClass.avgAccuracy - worstClass.avgAccuracy).toFixed(1)}%` },
            ],
          });
        }
      }

      // Topic gaps recommendation
      const criticalGaps = topicGaps.filter(tg => tg.severity === "Critical");
      if (criticalGaps.length > 0) {
        recommendations.push({
          id: "critical-topics",
          type: "topic_gap",
          title: "Critical Topic Gaps Identified",
          message: `${criticalGaps.length} topics need immediate attention across multiple classes. Consider reteaching these concepts.`,
          badge: "Needs Attention",
          icon: "🎯",
          references: criticalGaps.slice(0, 3).map(g => ({
            metric: g.topic,
            value: `${g.classAvg.toFixed(1)}% avg`,
            detail: `${g.studentsAffected} students affected`,
          })),
        });
      }

      // Differentiated instruction recommendation
      if (needsAttentionCount > 0 && stableCount > 0) {
        const naStudents = studentPerformance.filter(s => s.status === "Needs Attention").slice(0, 5);
        recommendations.push({
          id: "differentiation",
          type: "differentiation",
          title: "Differentiated Instruction Needed",
          message: `${needsAttentionCount} students need additional support while ${stableCount} students are performing well. Consider grouping for targeted instruction.`,
          badge: "Developing",
          icon: "👥",
          references: [
            { metric: "Needs Attention", value: `${needsAttentionCount} students (<50%)` },
            { metric: "Developing", value: `${developingCount} students (50-65%)` },
            { metric: "Stable", value: `${stableCount} students (>65%)` },
          ],
          studentList: naStudents.map(s => s.studentName),
        });
      }

      // Time allocation recommendation
      const slowTopics = topicGaps.filter(tg => tg.classAvg < 50);
      if (slowTopics.length > 0) {
        recommendations.push({
          id: "time-allocation",
          type: "time_allocation",
          title: "Time Allocation Suggestions",
          message: `Focus more time on weak topics: ${slowTopics.slice(0, 3).map(t => t.topic).join(", ")}`,
          badge: "Guide",
          icon: "⏱️",
          references: slowTopics.slice(0, 3).map(t => ({
            metric: t.topic,
            value: `${t.classAvg.toFixed(1)}% avg`,
            detail: "Needs more class time",
          })),
        });
      }

      // Section divisions for remedial grouping
      const sectionDivisions: SectionDivision[] = [
        {
          sectionName: "Section A",
          criteria: "Needs Attention (<60%)",
          count: studentPerformance.filter(s => s.overallPercent < 60).length,
          students: studentPerformance.filter(s => s.overallPercent < 60).slice(0, 10).map(s => ({
            id: s.studentId,
            name: s.studentName,
            accuracy: s.overallPercent,
          })),
          color: "hsl(0, 84%, 60%)",
        },
        {
          sectionName: "Section B",
          criteria: "Developing (60-85%)",
          count: studentPerformance.filter(s => s.overallPercent >= 60 && s.overallPercent < 85).length,
          students: studentPerformance.filter(s => s.overallPercent >= 60 && s.overallPercent < 85).slice(0, 10).map(s => ({
            id: s.studentId,
            name: s.studentName,
            accuracy: s.overallPercent,
          })),
          color: "hsl(48, 96%, 53%)",
        },
        {
          sectionName: "Section C",
          criteria: "Advanced (>85%)",
          count: studentPerformance.filter(s => s.overallPercent >= 85).length,
          students: studentPerformance.filter(s => s.overallPercent >= 85).slice(0, 10).map(s => ({
            id: s.studentId,
            name: s.studentName,
            accuracy: s.overallPercent,
          })),
          color: "hsl(142, 76%, 36%)",
        },
      ];

      // Scatter data
      const scatterData = snapshots?.map(s => ({
        name: (embedOne<ProfileEmbed>(s.profiles)?.full_name || "Student").split(" ")[0],
        x: Number(s.avg_time_per_question_seconds),
        y: Number(s.accuracy_percent),
        studentId: s.student_id,
      })) || [];

      // Score distribution
      const scoreRanges = [
        { range: "0-30%", min: 0, max: 30, color: "hsl(0, 84%, 60%)" },
        { range: "31-50%", min: 31, max: 50, color: "hsl(38, 92%, 50%)" },
        { range: "51-70%", min: 51, max: 70, color: "hsl(48, 96%, 53%)" },
        { range: "71-85%", min: 71, max: 85, color: "hsl(142, 71%, 45%)" },
        { range: "86-100%", min: 86, max: 100, color: "hsl(142, 76%, 36%)" },
      ];

      const scoreDistribution = scoreRanges.map(sr => {
        const studentsInRange = snapshots?.filter(s => {
          const acc = Number(s.accuracy_percent);
          return acc >= sr.min && acc <= sr.max;
        }) || [];
        return {
          range: sr.range,
          count: studentsInRange.length,
          color: sr.color,
          students: studentsInRange.map(s => getDisplayName(s.profiles)),
        };
      });

      // Cross-class comparison
      const crossClassComparison = classes.map(c => ({
        className: formatClassName(c.className, c.section),
        accuracy: c.avgAccuracy,
        efficiency: c.efficiency,
        needsAttention: c.needsAttention,
      }));

      return {
        profile: {
          name: profile?.full_name || "Teacher",
          subjects,
          classCount: classes.length,
        },
        classes,
        overallMetrics: {
          totalStudents: Array.from(enrolledStudentMap.values()).reduce((sum, count) => sum + count, 0),
          overallAccuracy,
          avgTimePerQuestion,
          efficiency,
          topperAccuracy,
          needsAttentionCount,
          developingCount,
          stableCount,
        },
        studentPerformance,
        topicGaps,
        recommendations,
        sectionDivisions,
        scatterData,
        scoreDistribution,
        crossClassComparison,
      };
    },
    enabled: !!teacherId,
  });
}
