import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SchoolPerformanceMetrics {
  avgScorePercent: number;
  passRate: number;
  improvementRate: number;
  totalExamsEvaluated: number;
  totalStudentsEvaluated: number;
}

export function useSchoolPerformanceMetrics(institutionId: string | null) {
  return useQuery({
    queryKey: ["school-performance-metrics", institutionId],
    queryFn: async (): Promise<SchoolPerformanceMetrics> => {
      if (!institutionId) {
        return {
          avgScorePercent: 0,
          passRate: 0,
          improvementRate: 0,
          totalExamsEvaluated: 0,
          totalStudentsEvaluated: 0,
        };
      }

      // Get finalized results for this institution's exams
      const { data: results, error } = await supabase
        .from("final_results")
        .select(`
          id,
          percentage,
          is_pass,
          created_at,
          student_exam_attempts!inner (
            exam_id,
            exams!inner (
              institution_id,
              scheduled_date
            )
          )
        `)
        .eq("student_exam_attempts.exams.institution_id", institutionId);

      if (error) throw error;

      if (!results || results.length === 0) {
        return {
          avgScorePercent: 0,
          passRate: 0,
          improvementRate: 0,
          totalExamsEvaluated: 0,
          totalStudentsEvaluated: 0,
        };
      }

      // Calculate metrics
      const totalStudents = results.length;
      const avgScore = results.reduce((sum, r) => sum + (r.percentage || 0), 0) / totalStudents;
      const passCount = results.filter(r => r.is_pass).length;
      const passRate = (passCount / totalStudents) * 100;

      // Calculate improvement: compare recent results (last 30 days) vs older
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentResults = results.filter(r => new Date(r.created_at) >= thirtyDaysAgo);
      const olderResults = results.filter(r => new Date(r.created_at) < thirtyDaysAgo);

      let improvementRate = 0;
      if (recentResults.length > 0 && olderResults.length > 0) {
        const recentAvg = recentResults.reduce((sum, r) => sum + (r.percentage || 0), 0) / recentResults.length;
        const olderAvg = olderResults.reduce((sum, r) => sum + (r.percentage || 0), 0) / olderResults.length;
        improvementRate = recentAvg - olderAvg;
      }

      // Count unique exams
      const uniqueExamIds = new Set(
        results.map((r: any) => r.student_exam_attempts?.exam_id).filter(Boolean)
      );

      return {
        avgScorePercent: avgScore,
        passRate,
        improvementRate,
        totalExamsEvaluated: uniqueExamIds.size,
        totalStudentsEvaluated: totalStudents,
      };
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
