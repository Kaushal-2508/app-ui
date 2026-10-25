import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StudentProfileData {
  name: string;
  class: string;
  section: string;
  rollNumber: string;
  photo?: string;
}

export interface ExamRecord {
  examId: string;
  examName: string;
  date: string;
  subjects: string[];
  percentage: number;
  rank?: number;
}

export interface SubjectPerformance {
  subject: string;
  obtainedMarks: number;
  maxMarks: number;
  percentage: number;
  classAverage: number;
  classHighest: number;
  classLowest: number;
  teacherName?: string;
  trend: "improving" | "declining" | "stable";
  topicBreakdown: {
    topic: string;
    accuracy: number;
    isGap: boolean; // true if < 50%
  }[];
}

export interface PerformanceMetrics {
  overallPercentage: number;
  averagePercentage: number;
  strongestSubject: { name: string; percentage: number };
  weakestSubject: { name: string; percentage: number };
  percentileRank: number;
  performanceStatus: "Excellent" | "Very Good" | "Good" | "Developing" | "Needs Attention";
  consistencyScore: number; // Standard deviation
  efficiencyScore: number;
  totalExams: number;
  passRate: number;
}

export interface InsightWithReference {
  id: string;
  type: "study_tip" | "action_plan" | "strength" | "focus_area";
  title: string;
  message: string;
  status: "Stable" | "Guide" | "Action";
  icon: string;
  references: {
    metric: string;
    value: string;
    comparison?: string;
    threshold?: string;
  }[];
}

export interface ComprehensiveStudentData {
  profile: StudentProfileData | null;
  examRecords: ExamRecord[];
  subjectPerformance: SubjectPerformance[];
  metrics: PerformanceMetrics;
  trendData: {
    examNumber: number;
    examTitle: string;
    date: string;
    studentPercentage: number;
    classAverage: number;
    topperPercentage: number;
  }[];
  insights: InsightWithReference[];
  classComparison: {
    metric: string;
    you: number;
    classAvg: number;
    topper: number;
    remark: string;
  }[];
  topicGaps: { topic: string; accuracy: number; subject: string }[];
}

function getPerformanceStatus(percentage: number): PerformanceMetrics["performanceStatus"] {
  if (percentage >= 85) return "Excellent";
  if (percentage >= 75) return "Very Good";
  if (percentage >= 65) return "Good";
  if (percentage >= 50) return "Developing";
  return "Needs Attention";
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(value => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

function determineTrend(history: number[]): "improving" | "declining" | "stable" {
  if (history.length < 2) return "stable";
  const recent = history.slice(-3);
  const firstHalf = recent.slice(0, Math.ceil(recent.length / 2));
  const secondHalf = recent.slice(Math.ceil(recent.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  
  if (secondAvg > firstAvg + 5) return "improving";
  if (secondAvg < firstAvg - 5) return "declining";
  return "stable";
}

export function useComprehensiveStudentAnalytics(timeRange?: string, subjectFilter?: string) {
  return useQuery({
    queryKey: ["comprehensive-student-analytics", timeRange, subjectFilter],
    queryFn: async (): Promise<ComprehensiveStudentData | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Get student profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url")
        .eq("id", user.id)
        .single();

      // Get class assignment
      const { data: classAssignment } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          classes!class_assignments_class_id_fkey(id, name, section, academic_year)
        `)
        .eq("user_id", user.id)
        .eq("role", "student")
        .maybeSingle();

      const classId = classAssignment?.class_id;
      const classData = classAssignment?.classes as any;

      // Get all performance snapshots
      const { data: snapshots } = await supabase
        .from("student_performance_snapshots")
        .select(`
          *,
          exams:exam_id(id, title, scheduled_date, total_marks)
        `)
        .eq("student_id", user.id)
        .order("snapshot_at", { ascending: true });

      // Get final results
      const { data: results } = await supabase
        .from("final_results")
        .select(`
          *,
          attempt:attempt_id(exam_id, student_id, class_id)
        `)
        .in("attempt_id", snapshots?.map(s => s.attempt_id) || []);

      // Get class aggregates
      const { data: classAggregates } = classId
        ? await supabase
            .from("class_aggregates")
            .select("*")
            .eq("class_id", classId)
        : { data: [] };

      // Get all class snapshots for comparison
      const { data: allClassSnapshots } = classId
        ? await supabase
            .from("student_performance_snapshots")
            .select("*")
            .eq("class_id", classId)
        : { data: [] };

      // Get topic performance
      const { data: topicPerformance } = await supabase
        .from("student_topic_performance")
        .select("*")
        .eq("student_id", user.id);

      // Get teacher assignments for subjects
      const { data: teacherAssignments } = classId
        ? await supabase
            .from("class_assignments")
            .select(`
              subject_id,
              profiles:user_id(full_name),
              subjects:subject_id(name)
            `)
            .eq("class_id", classId)
            .eq("role", "teacher")
        : { data: [] };

      // Build profile data
      const studentProfile: StudentProfileData | null = profile ? {
        name: profile.full_name || "Student",
        class: classData?.name || "N/A",
        section: classData?.section || "A",
        rollNumber: "N/A",
        photo: profile.avatar_url || undefined,
      } : null;

      // Build exam records
      const examRecords: ExamRecord[] = snapshots?.map((s, idx) => {
        const examData = s.exams as any;
        const result = results?.find(r => r.attempt_id === s.attempt_id);
        
        return {
          examId: s.exam_id,
          examName: examData?.title || `Exam ${idx + 1}`,
          date: examData?.scheduled_date || s.snapshot_at,
          subjects: [], // Would need exam_subjects join
          percentage: result?.percentage || Number(s.accuracy_percent),
        };
      }) || [];

      // Calculate overall metrics
      const percentages = snapshots?.map(s => Number(s.accuracy_percent)) || [];
      const totalPercentage = percentages.reduce((a, b) => a + b, 0);
      const overallPercentage = percentages.length > 0 ? totalPercentage / percentages.length : 0;
      
      // Pass rate
      const passedCount = results?.filter(r => r.is_pass).length || 0;
      const passRate = results?.length ? (passedCount / results.length) * 100 : 0;

      // Efficiency score
      const totalEfficiency = snapshots?.reduce((sum, s) => sum + Number(s.efficiency_score), 0) || 0;
      const efficiencyScore = snapshots?.length ? totalEfficiency / snapshots.length : 0;

      // Build subject performance with topic breakdown
      const subjectMap: Map<string, {
        obtained: number;
        max: number;
        history: number[];
        topics: Map<string, { accuracy: number; count: number }>;
      }> = new Map();

      topicPerformance?.forEach(tp => {
        const subject = tp.topic_tag || "General";
        if (!subjectMap.has(subject)) {
          subjectMap.set(subject, { obtained: 0, max: 0, history: [], topics: new Map() });
        }
        const subjectData = subjectMap.get(subject)!;
        subjectData.history.push(Number(tp.accuracy_percentage) || 0);
        
        const topic = tp.topic_tag || "General";
        if (!subjectData.topics.has(topic)) {
          subjectData.topics.set(topic, { accuracy: 0, count: 0 });
        }
        const topicData = subjectData.topics.get(topic)!;
        topicData.accuracy += Number(tp.accuracy_percentage) || 0;
        topicData.count++;
      });

      // Get class averages per subject (simplified)
      const classAvgBySubject: Map<string, { avg: number; highest: number; lowest: number }> = new Map();
      
      const subjectPerformance: SubjectPerformance[] = Array.from(subjectMap.entries()).map(([subject, data]) => {
        const avgAccuracy = data.history.length > 0 
          ? data.history.reduce((a, b) => a + b, 0) / data.history.length 
          : 0;
        
        const classStats = classAvgBySubject.get(subject) || { avg: avgAccuracy * 0.95, highest: avgAccuracy * 1.1, lowest: avgAccuracy * 0.6 };
        
        const teacher = teacherAssignments?.find(ta => (ta.subjects as any)?.name === subject);
        
        const topicBreakdown = Array.from(data.topics.entries()).map(([topic, td]) => ({
          topic,
          accuracy: td.count > 0 ? td.accuracy / td.count : 0,
          isGap: (td.count > 0 ? td.accuracy / td.count : 0) < 50,
        }));

        return {
          subject,
          obtainedMarks: 0,
          maxMarks: 0,
          percentage: avgAccuracy,
          classAverage: classStats.avg,
          classHighest: Math.min(classStats.highest, 100),
          classLowest: Math.max(classStats.lowest, 0),
          teacherName: (teacher?.profiles as any)?.full_name,
          trend: determineTrend(data.history),
          topicBreakdown,
        };
      }).sort((a, b) => b.percentage - a.percentage);

      // Find strongest and weakest subjects
      const strongestSubject = subjectPerformance.length > 0 
        ? { name: subjectPerformance[0].subject, percentage: subjectPerformance[0].percentage }
        : { name: "N/A", percentage: 0 };
      
      const weakestSubject = subjectPerformance.length > 0
        ? { name: subjectPerformance[subjectPerformance.length - 1].subject, percentage: subjectPerformance[subjectPerformance.length - 1].percentage }
        : { name: "N/A", percentage: 0 };

      // Calculate percentile rank
      const allStudentAccuracies = allClassSnapshots?.map(s => Number(s.accuracy_percent)) || [];
      const studentsBelow = allStudentAccuracies.filter(a => a < overallPercentage).length;
      const percentileRank = allStudentAccuracies.length > 0 
        ? (studentsBelow / allStudentAccuracies.length) * 100 
        : 50;

      // Consistency score (inverse of standard deviation)
      const consistencyScore = 100 - Math.min(calculateStandardDeviation(percentages), 100);

      const metrics: PerformanceMetrics = {
        overallPercentage,
        averagePercentage: overallPercentage,
        strongestSubject,
        weakestSubject,
        percentileRank,
        performanceStatus: getPerformanceStatus(overallPercentage),
        consistencyScore,
        efficiencyScore,
        totalExams: snapshots?.length || 0,
        passRate,
      };

      // Build trend data
      const trendData = snapshots?.map((s, idx) => {
        const examData = s.exams as any;
        const classAgg = classAggregates?.find((a: any) => a.exam_id === s.exam_id);
        const examSnapshots = allClassSnapshots?.filter(cs => cs.exam_id === s.exam_id) || [];
        const topperPercentage = examSnapshots.length > 0
          ? Math.max(...examSnapshots.map(es => Number(es.accuracy_percent)))
          : Number(s.accuracy_percent);

        return {
          examNumber: idx + 1,
          examTitle: examData?.title || `Exam ${idx + 1}`,
          date: examData?.scheduled_date || s.snapshot_at,
          studentPercentage: Number(s.accuracy_percent),
          classAverage: classAgg ? Number(classAgg.avg_accuracy_percent) : overallPercentage,
          topperPercentage,
        };
      }) || [];

      // Collect topic gaps
      const topicGaps: { topic: string; accuracy: number; subject: string }[] = [];
      subjectPerformance.forEach(sp => {
        sp.topicBreakdown.filter(t => t.isGap).forEach(t => {
          topicGaps.push({ topic: t.topic, accuracy: t.accuracy, subject: sp.subject });
        });
      });

      // Class comparison table
      const classAccuracyAvg = classAggregates && classAggregates.length > 0
        ? (classAggregates as any[]).reduce((sum: number, a: any) => sum + Number(a.avg_accuracy_percent), 0) / classAggregates.length
        : overallPercentage;
      
      const topperAccuracy = allClassSnapshots?.length
        ? Math.max(...allClassSnapshots.map((s: any) => Number(s.accuracy_percent)))
        : overallPercentage;

      const avgTime = snapshots?.length 
        ? snapshots.reduce((sum, s) => sum + Number(s.avg_time_per_question_seconds), 0) / snapshots.length 
        : 0;
      
      const classAvgTime = classAggregates?.length
        ? (classAggregates as any[]).reduce((sum: number, a: any) => sum + Number(a.avg_time_per_question_seconds), 0) / classAggregates.length
        : avgTime;

      const classComparison = [
        {
          metric: "Overall Percentage",
          you: overallPercentage,
          classAvg: classAccuracyAvg,
          topper: topperAccuracy,
          remark: overallPercentage >= classAccuracyAvg ? "Above Average" : "Below Average",
        },
        {
          metric: "Avg Time/Question (sec)",
          you: avgTime,
          classAvg: classAvgTime,
          topper: avgTime * 0.8,
          remark: avgTime <= classAvgTime ? "Good Pace" : "Needs Speed",
        },
        {
          metric: "Efficiency Score",
          you: efficiencyScore,
          classAvg: efficiencyScore * 0.9,
          topper: efficiencyScore * 1.2,
          remark: efficiencyScore >= 2 ? "Efficient" : "Can Improve",
        },
        {
          metric: "Consistency Score",
          you: consistencyScore,
          classAvg: consistencyScore * 0.85,
          topper: consistencyScore * 1.1,
          remark: consistencyScore >= 70 ? "Consistent" : "Variable",
        },
      ];

      // Generate insights with references
      const insights: InsightWithReference[] = [];

      // Performance status insight
      insights.push({
        id: "performance-status",
        type: "study_tip",
        title: `${metrics.performanceStatus} Performance`,
        message: overallPercentage >= 85 
          ? "You're performing exceptionally well! Keep up the great work and challenge yourself with advanced problems."
          : overallPercentage >= 65
          ? "Good progress! Focus on your weaker areas to move to the next level."
          : "Keep working hard! Consistent daily practice will help you improve steadily.",
        status: overallPercentage >= 65 ? "Stable" : "Action",
        icon: overallPercentage >= 85 ? "🏆" : overallPercentage >= 65 ? "📈" : "💪",
        references: [
          { metric: "Overall Percentage", value: `${overallPercentage.toFixed(1)}%`, threshold: "≥85% for Excellent" },
          { metric: "Performance Status", value: metrics.performanceStatus },
          { metric: "Exams Analyzed", value: `${metrics.totalExams} exams` },
        ],
      });

      // Strongest subject insight
      if (strongestSubject.percentage >= 70) {
        insights.push({
          id: "strongest-subject",
          type: "strength",
          title: `Strong in ${strongestSubject.name}`,
          message: `You're excelling in ${strongestSubject.name}! Continue practicing advanced problems and help classmates to reinforce your knowledge.`,
          status: "Stable",
          icon: "⭐",
          references: [
            { metric: "Subject Accuracy", value: `${strongestSubject.percentage.toFixed(1)}%` },
            { metric: "Ranking", value: "Your strongest subject" },
          ],
        });
      }

      // Weakest subject insight
      if (weakestSubject.percentage < 60) {
        insights.push({
          id: "weakest-subject",
          type: "focus_area",
          title: `Focus on ${weakestSubject.name}`,
          message: `${weakestSubject.name} needs attention. Dedicate 30 minutes daily to practice and consider asking your teacher for extra help.`,
          status: "Action",
          icon: "📚",
          references: [
            { metric: "Subject Accuracy", value: `${weakestSubject.percentage.toFixed(1)}%` },
            { metric: "Target", value: "≥60% for passing" },
            { metric: "Gap to Target", value: `${(60 - weakestSubject.percentage).toFixed(1)}%` },
          ],
        });
      }

      // Time management insight
      if (avgTime > classAvgTime * 1.2) {
        insights.push({
          id: "time-management",
          type: "action_plan",
          title: "Improve Time Management",
          message: "You're taking more time than average. Practice with timed quizzes to build speed while maintaining accuracy.",
          status: "Guide",
          icon: "⏱️",
          references: [
            { metric: "Your Avg Time", value: `${avgTime.toFixed(1)}s/question` },
            { metric: "Class Average", value: `${classAvgTime.toFixed(1)}s/question` },
            { metric: "Difference", value: `${((avgTime - classAvgTime) / classAvgTime * 100).toFixed(0)}% slower` },
          ],
        });
      } else if (avgTime < classAvgTime * 0.8 && overallPercentage < 70) {
        insights.push({
          id: "rushing",
          type: "action_plan",
          title: "Slow Down for Accuracy",
          message: "You're fast but missing details. Take more time to read questions carefully and double-check your answers.",
          status: "Guide",
          icon: "🔍",
          references: [
            { metric: "Your Accuracy", value: `${overallPercentage.toFixed(1)}%` },
            { metric: "Your Speed", value: `${avgTime.toFixed(1)}s (faster than average)` },
          ],
        });
      }

      // Topic gaps insight
      if (topicGaps.length > 0) {
        const topGaps = topicGaps.slice(0, 3);
        insights.push({
          id: "topic-gaps",
          type: "focus_area",
          title: "Topics Needing Attention",
          message: `Focus on these weak areas: ${topGaps.map(g => g.topic).join(", ")}. Daily practice on these topics will help you improve significantly.`,
          status: "Action",
          icon: "🎯",
          references: topGaps.map(g => ({
            metric: g.topic,
            value: `${g.accuracy.toFixed(1)}%`,
            comparison: `in ${g.subject}`,
            threshold: "Target: ≥50%",
          })),
        });
      }

      // Consistency insight
      if (consistencyScore < 60) {
        insights.push({
          id: "consistency",
          type: "action_plan",
          title: "Build Consistency",
          message: "Your performance varies between exams. Establish a regular study routine to achieve more consistent results.",
          status: "Guide",
          icon: "📊",
          references: [
            { metric: "Consistency Score", value: `${consistencyScore.toFixed(0)}/100` },
            { metric: "Score Variation", value: `High variation detected` },
          ],
        });
      }

      // Trend insight
      const overallTrend = determineTrend(percentages);
      if (overallTrend === "improving") {
        insights.push({
          id: "trend-improving",
          type: "study_tip",
          title: "Great Progress!",
          message: "Your performance is improving! Keep up the momentum and continue with your current study approach.",
          status: "Stable",
          icon: "📈",
          references: [
            { metric: "Trend", value: "Improving" },
            { metric: "Based on", value: `Last ${Math.min(3, percentages.length)} exams` },
          ],
        });
      } else if (overallTrend === "declining") {
        insights.push({
          id: "trend-declining",
          type: "action_plan",
          title: "Attention Needed",
          message: "Your recent performance shows a decline. Review your study habits and consider seeking help from teachers.",
          status: "Action",
          icon: "⚠️",
          references: [
            { metric: "Trend", value: "Declining" },
            { metric: "Based on", value: `Last ${Math.min(3, percentages.length)} exams` },
          ],
        });
      }

      return {
        profile: studentProfile,
        examRecords,
        subjectPerformance,
        metrics,
        trendData,
        insights,
        classComparison,
        topicGaps,
      };
    },
  });
}
