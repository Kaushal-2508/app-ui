import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SubjectPerfRow = {
  subject_name: string;
  pct_correct: number;
  correct: number;
  total: number;
};
export type WeakTopicRow = {
  topic_name: string;
  subject_name: string;
  pct_correct: number;
  questions: number;
};

type Stats = { subject_performance: SubjectPerfRow[]; weak_topics: WeakTopicRow[] };

/**
 * Filtered Subject performance / Weakest chapters for the Analytics tab's
 * per-card filters (RPC oly_school_subject_topic_stats, migration
 * 20260612090000). Only enabled when a filter is active — the unfiltered
 * numbers already arrive with oly_school_report.
 */
export function useOlympiadSubjectTopicStats(
  olySchoolId: string | undefined,
  gradeLevelId: string | null,
  subjectId: string | null,
) {
  const hasFilter = !!gradeLevelId || !!subjectId;
  return useQuery({
    queryKey: ["olympiad", "subject-topic-stats", olySchoolId, gradeLevelId, subjectId],
    enabled: !!olySchoolId && hasFilter,
    queryFn: async (): Promise<Stats> => {
      const { data, error } = await supabase.rpc("oly_school_subject_topic_stats", {
        p_oly_school_id: olySchoolId!,
        p_grade_level_id: gradeLevelId ?? undefined,
        p_subject_id: subjectId ?? undefined,
      });
      if (error) throw error;
      const d = data as unknown as Partial<Stats> | null;
      return {
        subject_performance: d?.subject_performance ?? [],
        weak_topics: d?.weak_topics ?? [],
      };
    },
    staleTime: 60_000,
  });
}
