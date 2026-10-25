import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChapterOption {
  id: string;
  topicName: string;
  chapterNumber: number | null;
  displayOrder: number | null;
}

/**
 * Fetch chapters (syllabus_topics) available for a given class + subject.
 *
 * Strategy:
 * 1. Resolve the class's class_group_id and query `topic_class_mappings`
 *    at the group level — one list per class container covers all sections.
 * 2. Fall back to all active chapters for the subject so the teacher
 *    isn't blocked if no explicit mapping exists yet.
 */
export function useChaptersForExam(params: {
  classId: string | undefined;
  subjectId: string | undefined;
}) {
  const { classId, subjectId } = params;
  const enabled = !!classId && !!subjectId;

  return useQuery({
    queryKey: ["chapters-for-exam", classId, subjectId],
    queryFn: async (): Promise<ChapterOption[]> => {
      type TopicRow = {
        id: string;
        topic_name: string;
        chapter_number: number | null;
        display_order: number | null;
        is_active: boolean | null;
        subject_id: string;
      };

      const toOption = (t: TopicRow): ChapterOption => ({
        id: t.id,
        topicName: t.topic_name,
        chapterNumber: t.chapter_number ?? null,
        displayOrder: t.display_order ?? null,
      });

      const sortByOrder = (a: ChapterOption, b: ChapterOption) =>
        (a.displayOrder ?? 999) - (b.displayOrder ?? 999);

      const { data: classRow } = await supabase
        .from("classes")
        .select("class_group_id")
        .eq("id", classId!)
        .maybeSingle();

      const classGroupId =
        (classRow as { class_group_id: string | null } | null)?.class_group_id ?? null;

      if (classGroupId) {
        const { data: groupMapped, error: groupErr } = await supabase
          .from("topic_class_mappings")
          .select(
            "topic_id, syllabus_topics!inner(id, topic_name, chapter_number, display_order, is_active, subject_id)"
          )
          .eq("class_group_id", classGroupId);

        if (!groupErr && groupMapped && groupMapped.length > 0) {
          const groupScoped = (groupMapped as unknown as Array<{ syllabus_topics: TopicRow }>)
            .map((row) => row.syllabus_topics)
            .filter((t) => t && t.is_active && t.subject_id === subjectId)
            .map(toOption);

          if (groupScoped.length > 0) return groupScoped.sort(sortByOrder);
        }
      }

      // Final fallback: all active chapters for this subject.
      const { data: allTopics, error: allError } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name, chapter_number, display_order")
        .eq("subject_id", subjectId!)
        .eq("is_active", true)
        .order("display_order");

      if (allError) throw allError;

      return (allTopics || []).map(
        (t): ChapterOption => ({
          id: t.id,
          topicName: t.topic_name,
          chapterNumber: t.chapter_number ?? null,
          displayOrder: t.display_order ?? null,
        })
      );
    },
    enabled,
    // §23: newly exercised on the login/check-out lesson gate hot path; keep a
    // fresh window so per-row remounts don't re-run the two-hop chapter lookup.
    staleTime: 60_000,
  });
}
