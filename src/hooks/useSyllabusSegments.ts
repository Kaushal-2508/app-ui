import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Syllabus segmentation ("Parts"): optional named parts of a subject's syllabus
// (PA1, Term 1, ...) scoped to a class_group + subject, so they apply to every
// section of that class. See migration 20260708120000_syllabus_segments.sql.
// All writes go through the SECURITY DEFINER RPCs (create/rename/delete/reorder/
// set_segment_chapters); the tables are read-only to the client.

export interface SyllabusSegment {
  id: string;
  name: string;
  displayOrder: number;
  chapterIds: string[];
}

export interface SubjectChapter {
  id: string;
  name: string;
  chapterNumber: number | null;
  displayOrder: number;
}

export const syllabusSegmentsKey = (
  classGroupId: string | null,
  subjectId: string | null,
) => ["syllabus-segments-v1", classGroupId, subjectId] as const;

/**
 * Resolve the parent class_group for a section (`classes.id`). The syllabus tab
 * works in terms of section rows, but segments live at the class_group level, so
 * every entry point resolves the section to its class_group first.
 */
export function useClassGroupId(classId: string | null) {
  return useQuery({
    queryKey: ["class-group-of-class", classId],
    queryFn: async (): Promise<string | null> => {
      if (!classId) return null;
      const { data, error } = await supabase
        .from("classes")
        .select("class_group_id")
        .eq("id", classId)
        .maybeSingle();
      if (error) throw error;
      return data?.class_group_id ?? null;
    },
    enabled: !!classId,
    staleTime: 5 * 60_000,
  });
}

/**
 * The chapters shown for a subject on the syllabus tab: `syllabus_topics` filtered
 * by subject, active, and institution-or-global. This is the exact list a part's
 * chapters are chosen from, so the picker always matches what the tab displays.
 */
export function useSubjectChapters(
  subjectId: string | null,
  institutionId: string | null,
) {
  return useQuery({
    queryKey: ["subject-chapters-for-segments-v1", subjectId, institutionId],
    queryFn: async (): Promise<SubjectChapter[]> => {
      if (!subjectId) return [];
      let query = supabase
        .from("syllabus_topics")
        .select("id, topic_name, chapter_number, display_order")
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .range(0, 999);
      if (institutionId) {
        query = query.or(
          `institution_id.eq.${institutionId},institution_id.is.null`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.topic_name,
        chapterNumber: r.chapter_number,
        displayOrder: r.display_order ?? 0,
      }));
    },
    enabled: !!subjectId,
    staleTime: 60_000,
  });
}

/** Parts for a (class_group, subject), ordered by the shared sequence. */
export function useSyllabusSegments(
  classGroupId: string | null,
  subjectId: string | null,
) {
  return useQuery({
    queryKey: syllabusSegmentsKey(classGroupId, subjectId),
    queryFn: async (): Promise<SyllabusSegment[]> => {
      if (!classGroupId || !subjectId) return [];

      const { data: segs, error } = await supabase
        .from("syllabus_segments")
        .select("id, name, display_order")
        .eq("class_group_id", classGroupId)
        .eq("subject_id", subjectId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true })
        .range(0, 199);
      if (error) throw error;

      const segments = segs ?? [];
      if (segments.length === 0) return [];

      const segmentIds = segments.map((s) => s.id);
      const { data: links, error: linkErr } = await supabase
        .from("syllabus_segment_chapters")
        .select("segment_id, chapter_id")
        .in("segment_id", segmentIds)
        .range(0, 4999);
      if (linkErr) throw linkErr;

      const bySegment = new Map<string, string[]>();
      for (const link of links ?? []) {
        const arr = bySegment.get(link.segment_id) ?? [];
        arr.push(link.chapter_id);
        bySegment.set(link.segment_id, arr);
      }

      return segments.map((s) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.display_order ?? 0,
        chapterIds: bySegment.get(s.id) ?? [],
      }));
    },
    enabled: !!classGroupId && !!subjectId,
    staleTime: 60_000,
  });
}

/**
 * The five write paths, all routed through the gated SECURITY DEFINER RPCs. Each
 * mutation is single-flight via its own `isPending`; the reorder and membership
 * writes are one transaction server-side. Callers await `mutateAsync` inside a
 * try/catch so they can drive the confirmation flow and surface errors through
 * `toastError`.
 */
export function useSegmentMutations(
  classGroupId: string | null,
  subjectId: string | null,
) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: syllabusSegmentsKey(classGroupId, subjectId),
    });

  const create = useMutation({
    mutationFn: async (name: string): Promise<string> => {
      if (!classGroupId || !subjectId) {
        throw new Error("Choose a class and subject first.");
      }
      const { data, error } = await supabase.rpc("create_syllabus_segment", {
        _class_group_id: classGroupId,
        _subject_id: subjectId,
        _name: name,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: async ({
      segmentId,
      name,
    }: {
      segmentId: string;
      name: string;
    }): Promise<void> => {
      const { error } = await supabase.rpc("rename_syllabus_segment", {
        _segment_id: segmentId,
        _name: name,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (segmentId: string): Promise<void> => {
      const { error } = await supabase.rpc("delete_syllabus_segment", {
        _segment_id: segmentId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      if (!classGroupId || !subjectId) {
        throw new Error("Choose a class and subject first.");
      }
      const { error } = await supabase.rpc("reorder_syllabus_segments", {
        _class_group_id: classGroupId,
        _subject_id: subjectId,
        _ordered_ids: orderedIds,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setChapters = useMutation({
    mutationFn: async ({
      segmentId,
      chapterIds,
    }: {
      segmentId: string;
      chapterIds: string[];
    }): Promise<void> => {
      const { error } = await supabase.rpc("set_segment_chapters", {
        _segment_id: segmentId,
        _chapter_ids: chapterIds,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, rename, remove, reorder, setChapters };
}
