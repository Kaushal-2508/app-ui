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
interface ExamEmbed { title: string | null; scheduled_date: string | null }

interface ClassOverviewEntry {
  id: string;
  name: string;
  studentCount: number;
  avgAccuracy: number;
  avgEfficiency: number;
}

export interface ScoreDistributionItem {
  range: string;
  count: number;
  color: string;
  students: string[];
}

export interface UnderperformingStudent {
  studentId: string;
  studentName: string;
  accuracy: number;
  avgTime: number;
  classAvgAccuracy: number;
  classAvgTime: number;
  issue: "low_accuracy" | "slow" | "both";
}

export interface SubjectBreakdown {
  subject: string;
  avgAccuracy: number;
  avgTime: number;
  efficiency: number;
  classAvg: number;
  isHighTime: boolean;
}

export function useTeacherClassOverview(teacherId: string | null, classId?: string | null) {
  return useQuery({
    queryKey: ["teacher-class-overview", teacherId, classId],
    queryFn: async () => {
      const userId = teacherId;
      if (!userId) return null;

      // Get teacher's assigned classes
      const { data: assignments } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          classes!class_assignments_class_id_fkey!inner(id, name, section, academic_year, institution_id),
          subjects:subject_id(id, name)
        `)
        .eq("user_id", userId)
        .eq("role", "teacher")
        // AY rollover leaves last year's class rows inactive; a stale
        // assignment would list the class twice in the dashboard picker.
        .eq("classes.is_active", true);

      const classIds = classId 
        ? [classId] 
        : assignments?.map(a => a.class_id) || [];

      if (classIds.length === 0) {
        return {
          classes: [],
          overallAccuracy: 0,
          overallAvgTime: 0,
          overallEfficiency: 0,
          studentPerformance: [],
          scatterData: [],
          scoreDistribution: [],
          underperformers: [],
          subjectBreakdown: [],
          topperAccuracy: 0,
          totalStudents: 0,
        };
      }

      // Get student performance snapshots for these classes
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select(`
          *,
          profiles:student_id(id, full_name, email),
          classes:class_id(name)
        `)
        .in("class_id", classIds);

      // Get class aggregates
      const { data: aggregates } = await supabase
        .from("class_aggregates")
        .select("*")
        .in("class_id", classIds);

      // Calculate overall metrics
      const totalSnapshots = snapshots?.length || 0;
      const overallAccuracy = totalSnapshots > 0
        ? snapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / totalSnapshots
        : 0;
      const overallAvgTime = totalSnapshots > 0
        ? snapshots.reduce((sum, s) => sum + Number(s.avg_time_per_question_seconds), 0) / totalSnapshots
        : 0;
      const overallEfficiency = totalSnapshots > 0
        ? snapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / totalSnapshots
        : 0;

      // Find topper
      const topperAccuracy = snapshots && snapshots.length > 0
        ? Math.max(...snapshots.map(s => Number(s.accuracy_percent)))
        : 0;

      // Build student performance table
      const studentPerformance = snapshots?.map(s => ({
        studentId: s.student_id,
        studentName: getDisplayName(s.profiles),
        className: embedOne<ClassEmbed>(s.classes)?.name || "",
        accuracy: Number(s.accuracy_percent),
        avgTime: Number(s.avg_time_per_question_seconds),
        efficiency: Number(s.efficiency_score),
        questionsAttempted: s.questions_attempted,
        questionsCorrect: s.questions_correct,
        questionsSkipped: s.questions_skipped,
        totalTime: s.total_time_seconds,
        deviation: Number(s.accuracy_percent) - overallAccuracy,
      })).sort((a, b) => b.accuracy - a.accuracy) || [];

      // Build scatter plot data (Time vs Accuracy)
      const scatterData = snapshots?.map(s => ({
        name: embedOne<ProfileEmbed>(s.profiles)?.full_name?.split(" ")[0] || "Student",
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

      const scoreDistribution: ScoreDistributionItem[] = scoreRanges.map(sr => {
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

      // Identify underperformers
      const underperformers: UnderperformingStudent[] = studentPerformance
        .filter(s => {
          const lowAccuracy = s.accuracy < (overallAccuracy - 10) || s.accuracy < 50;
          const slow = s.avgTime > (overallAvgTime * 1.2);
          return lowAccuracy || slow;
        })
        .map(s => ({
          studentId: s.studentId,
          studentName: s.studentName,
          accuracy: s.accuracy,
          avgTime: s.avgTime,
          classAvgAccuracy: overallAccuracy,
          classAvgTime: overallAvgTime,
          issue: (s.accuracy < (overallAccuracy - 10) && s.avgTime > overallAvgTime * 1.2) 
            ? "both" as const
            : s.accuracy < (overallAccuracy - 10) 
              ? "low_accuracy" as const 
              : "slow" as const,
        }));

      // Subject breakdown (from assignments)
      const subjectBreakdown: SubjectBreakdown[] = [];
      const subjectMap: Record<string, { accuracy: number; time: number; count: number }> = {};
      
      assignments?.forEach(a => {
        const subjectName = embedOne<SubjectEmbed>(a.subjects)?.name || "General";
        const classSnapshots = snapshots?.filter(s => s.class_id === a.class_id) || [];
        
        if (!subjectMap[subjectName]) {
          subjectMap[subjectName] = { accuracy: 0, time: 0, count: 0 };
        }
        
        classSnapshots.forEach(cs => {
          subjectMap[subjectName].accuracy += Number(cs.accuracy_percent);
          subjectMap[subjectName].time += Number(cs.avg_time_per_question_seconds);
          subjectMap[subjectName].count++;
        });
      });

      Object.entries(subjectMap).forEach(([subject, data]) => {
        if (data.count > 0) {
          const avgAccuracy = data.accuracy / data.count;
          const avgTime = data.time / data.count;
          subjectBreakdown.push({
            subject,
            avgAccuracy,
            avgTime,
            efficiency: avgTime > 0 ? avgAccuracy / avgTime : 0,
            classAvg: overallAccuracy,
            isHighTime: avgTime > overallAvgTime * 1.2 && avgAccuracy < 60,
          });
        }
      });

      // Build classes list with aggregates - group by class_id to avoid duplicates
      const classDataMap = new Map<string, ClassOverviewEntry>();

      assignments?.forEach(a => {
        const cls = embedOne<ClassEmbed>(a.classes);
        if (!cls || classDataMap.has(a.class_id)) return;
        
        const classSnapshots = snapshots?.filter(s => s.class_id === a.class_id) || [];
        const agg = aggregates?.find(ag => ag.class_id === a.class_id);
        
        classDataMap.set(a.class_id, {
          id: a.class_id,
          name: cls?.name ? formatClassName(cls.name, cls?.section) : "Unknown",
          studentCount: classSnapshots.length,
          avgAccuracy: classSnapshots.length > 0
            ? classSnapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / classSnapshots.length
            : agg?.avg_accuracy_percent || 0,
          avgEfficiency: classSnapshots.length > 0
            ? classSnapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / classSnapshots.length
            : agg?.avg_efficiency_score || 0,
        });
      });
      
      const classData = Array.from(classDataMap.values());

      return {
        classes: classData,
        overallAccuracy,
        overallAvgTime,
        overallEfficiency,
        studentPerformance,
        scatterData,
        scoreDistribution,
        underperformers,
        subjectBreakdown,
        topperAccuracy,
        totalStudents: totalSnapshots,
      };
    },
    enabled: !!teacherId,
  });
}

export function useStudentDrilldown(studentId: string | null) {
  return useQuery({
    queryKey: ["teacher-student-drilldown", studentId],
    queryFn: async () => {
      if (!studentId) return null;

      // Get student profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", studentId)
        .single();

      // Get all performance snapshots for this student
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select(`
          *,
          exams:exam_id(title, scheduled_date)
        `)
        .eq("student_id", studentId)
        .order("snapshot_at", { ascending: true });

      // Get topic performance
      const { data: topicPerformance } = await supabase
        .from("student_topic_performance")
        .select("*")
        .eq("student_id", studentId);

      // Build performance trend
      const trendData = snapshots?.map((s, idx) => ({
        examNumber: idx + 1,
        examTitle: embedOne<ExamEmbed>(s.exams)?.title || `Exam ${idx + 1}`,
        accuracy: Number(s.accuracy_percent),
        efficiency: Number(s.efficiency_score),
        avgTime: Number(s.avg_time_per_question_seconds),
        date: embedOne<ExamEmbed>(s.exams)?.scheduled_date || s.snapshot_at,
      })) || [];

      // Calculate subject strengths and weaknesses
      const topicAggregates: Record<string, { 
        topic: string; 
        accuracy: number; 
        avgTime: number; 
        count: number;
      }> = {};

      topicPerformance?.forEach(tp => {
        if (!topicAggregates[tp.topic_tag]) {
          topicAggregates[tp.topic_tag] = { topic: tp.topic_tag, accuracy: 0, avgTime: 0, count: 0 };
        }
        topicAggregates[tp.topic_tag].accuracy += Number(tp.accuracy_percentage) || 0;
        topicAggregates[tp.topic_tag].avgTime += Number(tp.avg_time_per_question_seconds) || 0;
        topicAggregates[tp.topic_tag].count++;
      });

      const subjectPerformance = Object.values(topicAggregates).map(ta => ({
        topic: ta.topic,
        accuracy: ta.count > 0 ? ta.accuracy / ta.count : 0,
        avgTime: ta.count > 0 ? ta.avgTime / ta.count : 0,
      })).sort((a, b) => b.accuracy - a.accuracy);

      const strengths = subjectPerformance.filter(s => s.accuracy >= 70);
      const weaknesses = subjectPerformance.filter(s => s.accuracy < 50);

      // Calculate efficiency trend
      const efficiencyTrend = trendData.map(t => t.efficiency);
      const isImproving = efficiencyTrend.length >= 2 
        ? efficiencyTrend[efficiencyTrend.length - 1] > efficiencyTrend[0]
        : false;

      // Overall stats
      const totalAttempts = snapshots?.length || 0;
      const overallAccuracy = totalAttempts > 0
        ? snapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / totalAttempts
        : 0;
      const overallEfficiency = totalAttempts > 0
        ? snapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / totalAttempts
        : 0;

      // Generate remedial suggestions
      const suggestions: string[] = [];
      if (weaknesses.length > 0) {
        suggestions.push(`Focus on improving ${weaknesses.map(w => w.topic).join(", ")}`);
      }
      if (overallAccuracy < 50) {
        suggestions.push("Consider additional practice sessions for core concepts");
      }
      if (!isImproving && totalAttempts >= 3) {
        suggestions.push("Performance trend is stagnant - review study methods");
      }

      return {
        profile,
        trendData,
        subjectPerformance,
        strengths,
        weaknesses,
        overallAccuracy,
        overallEfficiency,
        totalAttempts,
        isImproving,
        suggestions,
      };
    },
    enabled: !!studentId,
  });
}