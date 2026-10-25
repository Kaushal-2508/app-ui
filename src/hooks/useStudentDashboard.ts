import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TestDrilldownData {
  examId: string;
  examTitle: string;
  date: string;
  score: number;
  maxScore: number;
  percentage: number;
  accuracy: number;
  avgTimePerQuestion: number;
  efficiency: number;
  classAvg: number;
  topperPercent: number;
  
  subjectBreakdown: {
    subject: string;
    accuracy: number;
    timePercent: number;
    questionsAttempted: number;
    questionsCorrect: number;
  }[];
  
  suggestions: string[];
}

export function useStudentTestDrilldown(attemptId: string | null) {
  return useQuery({
    queryKey: ["student-test-drilldown", attemptId],
    queryFn: async () => {
      if (!attemptId) return null;

      // Get attempt details
      const { data: attempt } = await supabase
        .from("student_exam_attempts")
        .select(`
          *,
          exams:exam_id(id, title, scheduled_date, total_marks),
          classes:class_id(id, name)
        `)
        .eq("id", attemptId)
        .single();

      if (!attempt) return null;

      // Get final result
      const { data: result } = await supabase
        .from("final_results")
        .select("*")
        .eq("attempt_id", attemptId)
        .maybeSingle();

      // Get performance snapshot
      const { data: snapshot } = await supabase
        .from("student_performance_snapshots")
        .select("*")
        .eq("attempt_id", attemptId)
        .maybeSingle();

      // Get class aggregate for this exam
      const { data: classAgg } = await supabase
        .from("class_aggregates")
        .select("*")
        .eq("class_id", attempt.class_id)
        .eq("exam_id", attempt.exam_id)
        .maybeSingle();

      // Get topic performance for this exam
      const { data: topicPerf } = await supabase
        .from("student_topic_performance")
        .select("*")
        .eq("student_id", attempt.student_id)
        .eq("exam_id", attempt.exam_id);

      const examData = attempt.exams as any;
      
      const percentage = result?.percentage || 0;
      const accuracy = snapshot ? Number(snapshot.accuracy_percent) : percentage;
      const avgTimePerQuestion = snapshot ? Number(snapshot.avg_time_per_question_seconds) : 0;
      const efficiency = snapshot ? Number(snapshot.efficiency_score) : 0;
      
      const classAvg = classAgg ? Number(classAgg.avg_accuracy_percent) : accuracy;
      const topperPercent = classAgg?.topper_accuracy_percent 
        ? Number(classAgg.topper_accuracy_percent) 
        : accuracy;

      const subjectBreakdown = topicPerf?.map(tp => ({
        subject: tp.topic_tag || "General",
        accuracy: Number(tp.accuracy_percentage) || 0,
        timePercent: tp.avg_time_per_question_seconds 
          ? (Number(tp.avg_time_per_question_seconds) / avgTimePerQuestion) * 100 
          : 0,
        questionsAttempted: tp.questions_attempted || 0,
        questionsCorrect: tp.questions_correct || 0,
      })) || [];

      // Generate suggestions
      const suggestions: string[] = [];
      
      if (accuracy < classAvg - 10) {
        suggestions.push(`You scored ${(classAvg - accuracy).toFixed(1)}% below class average. Review weak topics.`);
      }
      
      if (avgTimePerQuestion > 60) {
        suggestions.push("Try to solve questions faster. Practice with timer.");
      }
      
      const weakTopics = subjectBreakdown.filter(s => s.accuracy < 50);
      if (weakTopics.length > 0) {
        suggestions.push(`Revise: ${weakTopics.map(t => t.subject).join(", ")}`);
      }
      
      if (efficiency < 2) {
        suggestions.push("Work on balancing speed and accuracy for better efficiency.");
      }

      return {
        examId: attempt.exam_id,
        examTitle: examData?.title || "Exam",
        date: examData?.scheduled_date || attempt.submitted_at,
        score: result?.total_marks_obtained || 0,
        maxScore: result?.total_max_marks || examData?.total_marks || 0,
        percentage,
        accuracy,
        avgTimePerQuestion,
        efficiency,
        classAvg,
        topperPercent,
        subjectBreakdown,
        suggestions,
      } as TestDrilldownData;
    },
    enabled: !!attemptId,
  });
}
