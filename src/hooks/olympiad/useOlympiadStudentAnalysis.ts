import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TopicStat = {
  topic_name: string;
  subject_name: string;
  questions: number;
  attempted: number;
  correct: number;
  pct_correct: number;
  avg_time_seconds: number;
};

export type StudentAnalysis =
  | {
      ok: true;
      topics: TopicStat[];
      time: {
        total_seconds: number;
        questions: number;
        attempted: number;
        unanswered: number;
        avg_seconds_per_question: number | null;
        avg_seconds_correct: number | null;
        avg_seconds_incorrect: number | null;
      };
      benchmark: {
        student_pct: number;
        class_avg_pct: number | null;
        school_avg_pct: number | null;
      };
    }
  | { ok: false; reason: string };

/**
 * Per-topic (competency) accuracy, time intelligence and class/school
 * benchmark for a published attempt (RPC oly_student_performance_analysis,
 * migration 20260612120000). Self-lookup by default; pass a studentId for
 * the school-admin view (the RPC gates via oly_student_can_read).
 */
export function useOlympiadStudentAnalysis(enabled: boolean, studentId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "student-analysis", user?.id, studentId ?? "self"],
    enabled: enabled && !!user?.id,
    queryFn: async (): Promise<StudentAnalysis> => {
      const { data, error } = await supabase.rpc(
        "oly_student_performance_analysis",
        studentId ? { p_student_id: studentId } : {},
      );
      if (error) throw error;
      return data as unknown as StudentAnalysis;
    },
    staleTime: 60_000,
  });
}
