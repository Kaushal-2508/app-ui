import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ChapterTopic {
  id: string;
  institution_id: string;
  class_group_id: string;
  subject_id: string;
  chapter_id: string;
  name: string;
  created_at: string;
}

const CHAPTER_TOPIC_SELECT =
  "id, institution_id, class_group_id, subject_id, chapter_id, name, created_at";

async function resolveClassGroupId(classId: string): Promise<string | null> {
  const { data } = await supabase
    .from("classes")
    .select("class_group_id")
    .eq("id", classId)
    .maybeSingle();
  return (data as { class_group_id: string | null } | null)?.class_group_id ?? null;
}

/**
 * Fetch all chapter-topics for a given (institution, class, subject, chapter) tuple.
 * All four params are required — the query is disabled until they are all provided.
 */
export function useChapterTopics(params: {
  institutionId: string | undefined;
  classId: string | undefined;
  subjectId: string | undefined;
  chapterId: string | undefined;
}) {
  const { institutionId, classId, subjectId, chapterId } = params;
  const enabled = !!institutionId && !!classId && !!subjectId && !!chapterId;

  return useQuery({
    queryKey: ["chapter-topics", institutionId, classId, subjectId, chapterId],
    queryFn: async (): Promise<ChapterTopic[]> => {
      const classGroupId = await resolveClassGroupId(classId!);
      if (!classGroupId) return [];

      const { data, error } = await supabase
        .from("chapter_topics")
        .select(CHAPTER_TOPIC_SELECT)
        .eq("institution_id", institutionId!)
        .eq("class_group_id", classGroupId)
        .eq("subject_id", subjectId!)
        .eq("chapter_id", chapterId!)
        .order("name");

      if (error) throw error;
      return (data || []) as ChapterTopic[];
    },
    enabled,
  });
}

/**
 * Fetch all chapter-topics across multiple chapters in one query.
 * Useful when the exam has several chapters selected and you need
 * the topic list for all of them at once (e.g. in the AI generate sheet).
 */
export function useChapterTopicsByChapters(params: {
  institutionId: string | undefined;
  classId: string | undefined;
  subjectId: string | undefined;
  chapterIds: string[];
}) {
  const { institutionId, classId, subjectId, chapterIds } = params;
  const enabled =
    !!institutionId && !!classId && !!subjectId && chapterIds.length > 0;

  return useQuery({
    queryKey: [
      "chapter-topics-multi",
      institutionId,
      classId,
      subjectId,
      chapterIds,
    ],
    queryFn: async (): Promise<ChapterTopic[]> => {
      const classGroupId = await resolveClassGroupId(classId!);
      if (!classGroupId) return [];

      const { data, error } = await supabase
        .from("chapter_topics")
        .select(CHAPTER_TOPIC_SELECT)
        .eq("institution_id", institutionId!)
        .eq("class_group_id", classGroupId)
        .eq("subject_id", subjectId!)
        .in("chapter_id", chapterIds)
        .order("name");

      if (error) throw error;
      return (data || []) as ChapterTopic[];
    },
    enabled,
  });
}

/**
 * Upsert a chapter-topic. If a topic with the same (institution, class_group,
 * subject, chapter, name) already exists (per the unique constraint),
 * return the existing record. Otherwise insert a new one.
 *
 * Callers still pass `classId` — the hook resolves its parent class_group_id.
 */
export function useUpsertChapterTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      institutionId: string;
      classId: string;
      subjectId: string;
      chapterId: string;
      name: string;
    }): Promise<ChapterTopic> => {
      const { institutionId, classId, subjectId, chapterId, name } = params;
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Topic name cannot be empty");

      const classGroupId = await resolveClassGroupId(classId);
      if (!classGroupId) {
        throw new Error("This section isn't attached to a class group yet.");
      }

      const { data: existing } = await supabase
        .from("chapter_topics")
        .select(CHAPTER_TOPIC_SELECT)
        .eq("institution_id", institutionId)
        .eq("class_group_id", classGroupId)
        .eq("subject_id", subjectId)
        .eq("chapter_id", chapterId)
        .eq("name", trimmed)
        .maybeSingle();

      if (existing) return existing as ChapterTopic;

      const { data, error } = await supabase
        .from("chapter_topics")
        .insert({
          institution_id: institutionId,
          class_group_id: classGroupId,
          subject_id: subjectId,
          chapter_id: chapterId,
          name: trimmed,
        })
        .select(CHAPTER_TOPIC_SELECT)
        .single();

      if (error) throw error;
      return data as ChapterTopic;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "chapter-topics",
          variables.institutionId,
          variables.classId,
          variables.subjectId,
          variables.chapterId,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: ["chapter-topics-multi"],
      });
      toast.success("Topic saved");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save topic");
    },
  });
}
