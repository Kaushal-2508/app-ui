import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExamPaperQuestion {
  id: string;
  subject_id: string;
  subject_name: string;
  topic_name: string | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  image_url: string | null;
}

const PAGE = 100;

/**
 * Class-wise question pool for the school "View Exam" page (RPC
 * oly_school_exam_paper, migration 20260612130000 — school staff can't read
 * oly_questions directly). Paginated with .range() over the set-returning
 * function; available at every exam stage.
 */
export function useOlympiadExamPaper(
  olySchoolId: string | undefined,
  gradeLevelId: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "exam-paper", olySchoolId, gradeLevelId],
    enabled: !!olySchoolId && !!gradeLevelId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ExamPaperQuestion[]> => {
      const from = pageParam * PAGE;
      const { data, error } = await supabase
        .rpc("oly_school_exam_paper", {
          p_oly_school_id: olySchoolId as string,
          p_grade_level_id: gradeLevelId as string,
        })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      return (data ?? []) as ExamPaperQuestion[];
    },
    getNextPageParam: (last, _all, lastPageParam) =>
      last.length === PAGE ? lastPageParam + 1 : undefined,
    staleTime: 60_000,
  });
}
