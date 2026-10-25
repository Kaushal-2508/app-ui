import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TeacherClassReport = {
  found: boolean;
  results_available: boolean;
  results_published: boolean;
  enrolled: number;
  appeared: number;
  absent: number;
  avg_percentage: number;
  max_percentage: number;
  avg_marks: number;
  channel: { online: number; cash: number };
  subject_performance: { subject_name: string; pct_correct: number; correct: number; total: number }[];
  weak_topics: { topic_name: string; subject_name: string; pct_correct: number; questions: number }[];
  score_distribution: { bucket: string; count: number }[];
  tier_distribution: {
    gold: number;
    silver: number;
    bronze: number;
    participation: number;
    absent: number;
  };
};

/**
 * Class-scoped analytics for the teacher's results panel — RPC
 * oly_teacher_class_report (migration 20260616120000). Auth is grade-scoped via
 * oly_is_teacher_for_class and revenue is omitted; this must NEVER be swapped for
 * oly_school_report, whose institution-membership gate would leak the WHOLE school
 * (other grades + revenue). One server-aggregated round-trip (§23).
 */
export function useTeacherOlympiadClassReport(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
) {
  return useQuery({
    queryKey: ["olympiad", "teacher-class-report", olySchoolId, gradeLevelId],
    enabled: !!olySchoolId && !!gradeLevelId,
    queryFn: async (): Promise<TeacherClassReport | null> => {
      if (!olySchoolId || !gradeLevelId) return null;
      const { data, error } = await supabase.rpc("oly_teacher_class_report", {
        p_oly_school_id: olySchoolId,
        p_grade_level_id: gradeLevelId,
      });
      if (error) throw error;
      return data as unknown as TeacherClassReport;
    },
    staleTime: 60_000,
    retry: false,
  });
}
