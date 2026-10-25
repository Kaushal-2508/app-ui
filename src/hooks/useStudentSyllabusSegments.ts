import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Read-only student view of syllabus parts, grouped by subject. Resolves the
// student's class_group the same way useIsolatedStudyMaterials does, then reads
// parts + their chapter names. No progress or completion metrics, by design.

export interface StudentChapterMaterial {
  id: string;
  title: string;
  materialType: string;
  /** Openable URL (external link preferred, else stored file). */
  url: string | null;
}

export interface StudentSegmentChapter {
  id: string;
  name: string;
  /** Study materials (PDFs / links / videos) attached to this chapter. */
  materials: StudentChapterMaterial[];
}

export interface StudentSegment {
  id: string;
  name: string;
  chapters: StudentSegmentChapter[];
}

export interface StudentSubjectSegments {
  subjectId: string;
  subjectName: string;
  segments: StudentSegment[];
}

export function useStudentSyllabusSegments(enabled: boolean) {
  return useQuery({
    queryKey: ["student-syllabus-segments-v2"],
    queryFn: async (): Promise<StudentSubjectSegments[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      // 1. Student's section -> class_group.
      const { data: assignment } = await supabase
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("role", "student")
        .maybeSingle();
      if (!assignment?.class_id) return [];

      const { data: cls } = await supabase
        .from("classes")
        .select("class_group_id")
        .eq("id", assignment.class_id)
        .maybeSingle();
      const classGroupId = cls?.class_group_id ?? null;
      if (!classGroupId) return [];

      // 2. Parts for the whole class_group (RLS restricts this to the student's
      //    own class_group).
      const { data: segs, error } = await supabase
        .from("syllabus_segments")
        .select("id, name, display_order, subject_id")
        .eq("class_group_id", classGroupId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true })
        .range(0, 499);
      if (error) throw error;
      const segments = segs ?? [];
      if (segments.length === 0) return [];

      const segmentIds = segments.map((s) => s.id);
      const subjectIds = [...new Set(segments.map((s) => s.subject_id))];

      // 3. Subject names.
      const { data: subjectRows } = await supabase
        .from("universal_subjects")
        .select("id, name")
        .in("id", subjectIds)
        .range(0, 499);
      const subjectName = new Map(
        (subjectRows ?? []).map((r) => [r.id, r.name]),
      );

      // 4. Chapter links + chapter names.
      const { data: links } = await supabase
        .from("syllabus_segment_chapters")
        .select("segment_id, chapter_id")
        .in("segment_id", segmentIds)
        .range(0, 9999);
      const chapterIds = [
        ...new Set((links ?? []).map((l) => l.chapter_id)),
      ];

      const chapterInfo = new Map<
        string,
        { name: string; order: number; number: number | null }
      >();
      if (chapterIds.length > 0) {
        const { data: chapterRows } = await supabase
          .from("syllabus_topics")
          .select("id, topic_name, chapter_number, display_order")
          .in("id", chapterIds)
          .range(0, 9999);
        for (const c of chapterRows ?? []) {
          chapterInfo.set(c.id, {
            name: c.topic_name,
            order: c.display_order ?? 0,
            number: c.chapter_number,
          });
        }
      }

      const chaptersBySegment = new Map<string, string[]>();
      for (const link of links ?? []) {
        const arr = chaptersBySegment.get(link.segment_id) ?? [];
        arr.push(link.chapter_id);
        chaptersBySegment.set(link.segment_id, arr);
      }

      // 4b. Study materials attached to these chapters (via study_materials.topic_id).
      //     RLS scopes this to the student's institution, and the chapters are
      //     their own class_group's, so this only surfaces their own resources.
      const materialsByChapter = new Map<string, StudentChapterMaterial[]>();
      if (chapterIds.length > 0) {
        const { data: mats } = await supabase
          .from("study_materials")
          .select("id, title, material_type, file_url, external_link, topic_id")
          .in("topic_id", chapterIds)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .range(0, 999);
        for (const m of mats ?? []) {
          if (!m.topic_id) continue;
          const arr = materialsByChapter.get(m.topic_id) ?? [];
          arr.push({
            id: m.id,
            title: m.title,
            materialType: m.material_type ?? "link",
            url: m.external_link || m.file_url || null,
          });
          materialsByChapter.set(m.topic_id, arr);
        }
      }

      // 5. Assemble: subject -> ordered parts -> ordered chapters.
      const bySubject = new Map<string, StudentSubjectSegments>();
      for (const seg of segments) {
        if (!bySubject.has(seg.subject_id)) {
          bySubject.set(seg.subject_id, {
            subjectId: seg.subject_id,
            subjectName: subjectName.get(seg.subject_id) ?? "Subject",
            segments: [],
          });
        }
        const chapterList = (chaptersBySegment.get(seg.id) ?? [])
          .map((id) => ({ id, info: chapterInfo.get(id) }))
          .filter((c): c is { id: string; info: { name: string; order: number; number: number | null } } => !!c.info)
          .sort((a, b) => {
            if (a.info.order !== b.info.order) return a.info.order - b.info.order;
            if ((a.info.number ?? 0) !== (b.info.number ?? 0)) {
              return (a.info.number ?? 0) - (b.info.number ?? 0);
            }
            return a.info.name.localeCompare(b.info.name);
          })
          .map((c) => ({
            id: c.id,
            name: c.info.name,
            materials: materialsByChapter.get(c.id) ?? [],
          }));

        bySubject.get(seg.subject_id)!.segments.push({
          id: seg.id,
          name: seg.name,
          chapters: chapterList,
        });
      }

      return [...bySubject.values()].sort((a, b) =>
        a.subjectName.localeCompare(b.subjectName),
      );
    },
    enabled,
    staleTime: 60_000,
  });
}
