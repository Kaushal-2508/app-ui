import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { getDisplayName } from "@/lib/displayName";

export function useSchoolPerformanceOverview(institutionId: string | null) {
  return useQuery({
    queryKey: ["school-performance-overview", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;

      // Get classes with performance data — order client-side so the grade-
      // section heatmap and underperforming-classes list both render in the
      // canonical Nursery → Class 12 sequence.
      const { data: classesRaw } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true);
      const classes = sortClassRows(classesRaw ?? [], (c) => c.name, (c) => c.section);

      // Get class aggregates
      const { data: aggregates } = await supabase
        .from("class_aggregates")
        .select("*")
        .in("class_id", classes.map(c => c.id));

      // Get teachers with their performance
      const { data: teacherRoles } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          profiles!user_roles_user_id_fkey(id, full_name)
        `)
        .eq("institution_id", institutionId)
        .eq("role", "teacher");

      const { data: teacherAggregates } = await supabase
        .from("teacher_aggregates")
        .select("*")
        .eq("institution_id", institutionId);

      // Get school aggregates
      const { data: schoolAggregates } = await supabase
        .from("school_aggregates")
        .select("*")
        .eq("institution_id", institutionId)
        .order("period_end", { ascending: false })
        .limit(1);

      // Get subject-wise performance from exam_subjects
      const { data: exams } = await supabase
        .from("exams")
        .select(`
          id, title, status,
          exam_subjects(subject_id, universal_subjects(name))
        `)
        .eq("institution_id", institutionId)
        .eq("status", "completed");

      // Get student performance snapshots for heatmap data
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select("*")
        .in("class_id", classes.map(c => c.id))
        .order("snapshot_at", { ascending: false })
        .limit(500);

      // Build grade-section heatmap data
      const gradePerformance: Record<string, { 
        name: string;
        avgAccuracy: number;
        avgEfficiency: number;
        studentCount: number;
        examCount: number;
      }> = {};

      classes.forEach(cls => {
        const classSnapshots = snapshots?.filter(s => s.class_id === cls.id) || [];
        const aggregate = aggregates?.find(a => a.class_id === cls.id);
        
        const avgAccuracy = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / classSnapshots.length
          : aggregate?.avg_accuracy_percent || 0;

        const avgEfficiency = classSnapshots.length > 0
          ? classSnapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / classSnapshots.length
          : aggregate?.avg_efficiency_score || 0;

        gradePerformance[cls.id] = {
          name: formatClassName(cls.name, cls.section),
          avgAccuracy: Number(avgAccuracy),
          avgEfficiency: Number(avgEfficiency),
          studentCount: classSnapshots.length,
          examCount: aggregates?.filter(a => a.class_id === cls.id).length || 0,
        };
      });

      // Build teacher effectiveness data
      const teacherEffectiveness = teacherRoles?.map(tr => {
        const agg = teacherAggregates?.find(ta => ta.teacher_id === tr.user_id);
        return {
          id: tr.user_id,
          name: getDisplayName(tr.profiles),
          avgAccuracy: agg?.avg_class_accuracy || 0,
          passRate: agg?.avg_class_pass_rate || 0,
          examsCreated: agg?.total_exams_created || 0,
          evaluationsCompleted: agg?.evaluations_completed || 0,
        };
      }) || [];

      // Identify underperforming classes (below 50% accuracy)
      const underperformingClasses = Object.entries(gradePerformance)
        .filter(([_, data]) => data.avgAccuracy < 50 && data.studentCount > 0)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => a.avgAccuracy - b.avgAccuracy);

      // Subject-wise aggregates
      const subjectPerformance: Record<string, { name: string; avgAccuracy: number; examCount: number }> = {};
      exams?.forEach(exam => {
        (exam.exam_subjects as any[])?.forEach(es => {
          const subjectName = es.universal_subjects?.name || "Unknown";
          if (!subjectPerformance[subjectName]) {
            subjectPerformance[subjectName] = { name: subjectName, avgAccuracy: 0, examCount: 0 };
          }
          subjectPerformance[subjectName].examCount++;
        });
      });

      return {
        gradePerformance: Object.values(gradePerformance),
        teacherEffectiveness,
        underperformingClasses,
        subjectPerformance: Object.values(subjectPerformance),
        schoolAggregate: schoolAggregates?.[0] || null,
        totalClasses: classes?.length || 0,
        totalTeachers: teacherRoles?.length || 0,
      };
    },
    enabled: !!institutionId,
  });
}

export function useSchoolPerformanceDrilldown(institutionId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["school-performance-drilldown", institutionId, classId],
    queryFn: async () => {
      if (!institutionId || !classId) return null;

      // Get class details
      const { data: classData } = await supabase
        .from("classes")
        .select("*")
        .eq("id", classId)
        .single();

      // Get all snapshots for this class
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select(`
          *,
          profiles:student_id(full_name, email)
        `)
        .eq("class_id", classId)
        .order("accuracy_percent", { ascending: false });

      // Get class aggregates
      const { data: aggregates } = await supabase
        .from("class_aggregates")
        .select("*")
        .eq("class_id", classId);

      // Score distribution for histogram
      const scoreDistribution = {
        "0-20": 0,
        "21-40": 0,
        "41-60": 0,
        "61-80": 0,
        "81-100": 0,
      };

      snapshots?.forEach(s => {
        const score = Number(s.accuracy_percent);
        if (score <= 20) scoreDistribution["0-20"]++;
        else if (score <= 40) scoreDistribution["21-40"]++;
        else if (score <= 60) scoreDistribution["41-60"]++;
        else if (score <= 80) scoreDistribution["61-80"]++;
        else scoreDistribution["81-100"]++;
      });

      // Student performance table
      const studentPerformance = snapshots?.map(s => ({
        studentId: s.student_id,
        studentName: getDisplayName(s.profiles),
        accuracy: Number(s.accuracy_percent),
        avgTime: Number(s.avg_time_per_question_seconds),
        efficiency: Number(s.efficiency_score),
        questionsAttempted: s.questions_attempted,
        questionsCorrect: s.questions_correct,
      })) || [];

      return {
        classData,
        studentPerformance,
        scoreDistribution,
        aggregates,
        averageAccuracy: snapshots?.length 
          ? snapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / snapshots.length 
          : 0,
        averageEfficiency: snapshots?.length
          ? snapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / snapshots.length
          : 0,
      };
    },
    enabled: !!institutionId && !!classId,
  });
}