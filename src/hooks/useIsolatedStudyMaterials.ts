import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IsolatedStudyMaterial {
  id: string;
  title: string;
  publisher: string | null;
  material_type: string;
  file_url: string | null;
  external_link: string | null;
  description: string | null;
  subject_id: string;
  grade_level_id: string;
  institution_id: string | null;
  is_active: boolean;
  created_at: string;
  subject_name?: string;
  grade_name?: string;
  grade_number?: number;
}

/**
 * Hook to fetch study materials isolated to the student's specific class and subjects.
 * This prevents data leakage by only showing materials relevant to the student.
 *
 * Subject resolution follows the §22 read-path: class_group_id first
 * (subject_class_group_mappings), section-level (subject_class_mappings)
 * as fallback. Reading only the section-level table missed subjects whose
 * Phase 2 fan-out trigger hadn't materialised a row yet, so the student's
 * "Study Materials" page showed a partial list of materials even though
 * the admin syllabus view showed all the chapters.
 */
// NOTE: no server-side search param. The result set is already bounded to
// 100 rows, and the resolution chain below costs ~10 round trips per run —
// keying the query on a raw search string re-ran the whole chain on every
// keystroke (typing "chemistry" = ~90 queries per student, §23.16). Callers
// filter the cached list client-side instead.
export function useIsolatedStudyMaterials() {
  return useQuery({
    queryKey: ["student-isolated-study-materials"],
    queryFn: async (): Promise<IsolatedStudyMaterial[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // 1. Get student's class assignment (This gives us the SECTION ID)
      const { data: classAssignment } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          classes (
            id,
            institution_id,
            grade_level_id:name
          )
        `)
        .eq("user_id", user.id)
        .eq("role", "student")
        .maybeSingle();

      if (!classAssignment?.class_id) {
        console.log("No class assignment found for student");
        return [];
      }

      // 2. Get the class details — only columns that actually exist on
      //    `classes` (id, institution_id, name, class_group_id). The
      //    grade_level_id column lives on `class_groups`, NOT on
      //    `classes`; selecting it here errors out the whole SELECT and
      //    the function silently returns no materials.
      const { data: classData } = await supabase
        .from("classes")
        .select("id, institution_id, name, class_group_id")
        .eq("id", classAssignment.class_id)
        .single();

      if (!classData) return [];

      const classGroupId =
        (classData as { class_group_id: string | null }).class_group_id ?? null;

      // 3. Resolve grade level. Preferred path: read `grade_level_id`
      //    off the parent class_group (Phase 2 — works for non-numeric
      //    class names like Pre Nursery / LKG / UKG too). Fallback:
      //    digit-regex on the class name for legacy classes whose group
      //    has no FK populated.
      let gradeLevelId: string | null = null;

      if (classGroupId) {
        const { data: groupRow } = await supabase
          .from("class_groups" as never)
          .select("grade_level_id")
          .eq("id", classGroupId)
          .maybeSingle();
        gradeLevelId =
          (groupRow as { grade_level_id: string | null } | null)?.grade_level_id ?? null;
      }

      if (!gradeLevelId) {
        const gradeMatch = classData.name.match(/(\d+)/);
        const gradeNumber = gradeMatch ? parseInt(gradeMatch[1]) : null;
        if (gradeNumber !== null) {
          const { data: gradeLevel } = await supabase
            .from("grade_levels")
            .select("id")
            .eq("grade_number", gradeNumber)
            .maybeSingle();
          gradeLevelId = gradeLevel?.id ?? null;
        }
      }

      // 4. Get subjects mapped to the student's class. Phase 2 stores
      //    subject mappings at the class_group level with a trigger that
      //    fans out to the legacy per-section `subject_class_mappings`
      //    table. Read group-level first, fall back to per-section if
      //    the class has no group or the group-level read returns empty.
      const subjectIdSet = new Set<string>();

      if (classGroupId) {
        const { data: groupRows } = await supabase
          .from("subject_class_group_mappings" as never)
          .select("subject_id")
          .eq("class_group_id", classGroupId);
        for (const row of (groupRows ?? []) as Array<{ subject_id: string }>) {
          subjectIdSet.add(row.subject_id);
        }
      }

      // Always also union the section-level rows. The trigger keeps
      // these in sync, but legacy installs may have section rows the
      // group-level table doesn't, and vice-versa.
      const { data: sectionRows } = await supabase
        .from("subject_class_mappings")
        .select("subject_id")
        .eq("class_id", classAssignment.class_id);
      for (const row of sectionRows ?? []) {
        subjectIdSet.add(row.subject_id);
      }

      const subjectIds = Array.from(subjectIdSet);

      // 4a. Resolve every sibling section in the student's class_group.
      //
      //     Why: study_materials.grade_level_id is overloaded — admins
      //     sometimes upload a material with grade_level_id = grade UUID
      //     (the canonical "tag this for Class 9") and sometimes with
      //     grade_level_id = the SECTION UUID they happened to be in
      //     when uploading (observed for Alliance Class 9: 7 of 9
      //     English Reader PDFs are tagged to Class 9 - B's section
      //     UUID, only 2 to Class 9 - A's, even though they're the same
      //     syllabus). Class 9 - A and Class 9 - B sit under the same
      //     class_group, so the student in either section should see
      //     all 9 — pulling every sibling section from the same
      //     class_group lets the grade filter accept any of those
      //     section UUIDs.
      const siblingSectionIds = new Set<string>([classAssignment.class_id]);
      if (classGroupId) {
        const { data: siblingSections } = await supabase
          .from("classes")
          .select("id")
          .eq("class_group_id" as never, classGroupId);
        for (const row of (siblingSections ?? []) as Array<{ id: string }>) {
          siblingSectionIds.add(row.id);
        }
      }

      // 4b. Expand subject IDs to include every same-named sibling in
      //     this institution.
      //
      //     Why: migration 20260501150000 split multi-class subjects
      //     into per-class_group clones — each clone has the SAME name
      //     and code as the primary, only the UUID differs. The
      //     migration header explicitly notes that `study_materials`
      //     (and `syllabus_topics`) were intentionally NOT re-pointed
      //     during the split. So a chapter material uploaded before the
      //     split still carries the OLD primary subject_id, while the
      //     student's class_group now maps to a CLONE subject_id —
      //     filtering materials purely on the post-split mapping misses
      //     every pre-split chapter (observed: 1/9 English Reader
      //     chapters visible to a Class 9 student).
      //
      //     Pulling in every same-named sibling subject for the
      //     institution covers both the primary and every clone, so
      //     materials uploaded any time, against any class_group's copy
      //     of "English Reader", show up.
      //
      //     We do NOT join via chapter_topics — that table holds
      //     SUB-topics within a chapter (chapter_topics.chapter_id →
      //     syllabus_topics.id) and is sparsely populated; using it as
      //     the join would silently exclude every chapter the admin
      //     never carved sub-topics for.
      const expandedSubjectIdSet = new Set<string>(subjectIds);
      if (subjectIds.length > 0 && classData.institution_id) {
        const { data: namedSubjects } = await supabase
          .from("universal_subjects")
          .select("id, name")
          .in("id", subjectIds);

        const namesToExpand = Array.from(
          new Set(
            (namedSubjects ?? [])
              .map((s) => s.name)
              .filter((n): n is string => Boolean(n)),
          ),
        );

        if (namesToExpand.length > 0) {
          const { data: siblings } = await supabase
            .from("universal_subjects")
            .select("id")
            .eq("institution_id", classData.institution_id)
            .in("name", namesToExpand);
          for (const row of siblings ?? []) {
            expandedSubjectIdSet.add(row.id);
          }
        }
      }
      const expandedSubjectIds = Array.from(expandedSubjectIdSet);

      // 5. Build query for study materials — explicit columns (the exact
      //    IsolatedStudyMaterial shape), never select("*") (§23).
      let query = supabase
        .from("study_materials")
        .select(
          "id, title, publisher, material_type, file_url, external_link, description, subject_id, grade_level_id, institution_id, is_active, created_at"
        )
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      // Filter by institution (include global materials)
      if (classData.institution_id) {
        query = query.or(`institution_id.eq.${classData.institution_id},institution_id.is.null`);
      }

      // Grade-scope filter. Accept materials tagged with:
      //   - the canonical grade UUID (the "right" way), OR
      //   - any sibling section UUID inside the student's class_group
      //     (the overloaded-grade_level_id case described in step 4a).
      // This single .in() covers both shapes without juggling .or().
      const gradeOrSectionIds = new Set<string>(siblingSectionIds);
      if (gradeLevelId) gradeOrSectionIds.add(gradeLevelId);
      const gradeOrSectionList = Array.from(gradeOrSectionIds);
      if (gradeOrSectionList.length > 0) {
        query = query.in("grade_level_id", gradeOrSectionList);
      }

      // Filter by the expanded subject set (covers post-split sibling
      // clones — see step 4b).
      if (expandedSubjectIds.length > 0) {
        query = query.in("subject_id", expandedSubjectIds);
      }

      const { data: materials, error } = await query.limit(100);
      if (error) throw error;
      if (!materials || materials.length === 0) return [];

      // Fetch subject and grade names for display
      const uniqueSubjectIds = [...new Set(materials.map((m) => m.subject_id))];
      // Note: Some IDs might be Sections, so we fetch what we can
      const uniqueGradeIds = [...new Set(materials.map((m) => m.grade_level_id))];

      const [{ data: subjects }, { data: grades }] = await Promise.all([
        supabase.from("universal_subjects").select("id, name").in("id", uniqueSubjectIds),
        supabase.from("grade_levels").select("id, grade_name, grade_number").in("id", uniqueGradeIds),
      ]);

      const subjectMap = new Map(subjects?.map((s) => [s.id, s.name]) || []);
      const gradeMap = new Map(grades?.map((g) => [g.id, g]) || []);

      return materials.map((m) => ({
        ...m,
        subject_name: subjectMap.get(m.subject_id),
        // If the ID matches the student's Section ID, label it nicely
        grade_name: gradeMap.get(m.grade_level_id)?.grade_name || (m.grade_level_id === classAssignment.class_id ? "Section Material" : "Unknown Grade"),
        grade_number: gradeMap.get(m.grade_level_id)?.grade_number,
      }));
    },
  });
}

/**
 * Hook to get subjects that are mapped to the student's class
 */
export function useStudentClassSubjects() {
  return useQuery({
    queryKey: ["student-class-subjects"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: classAssignment } = await supabase
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("role", "student")
        .maybeSingle();

      if (!classAssignment?.class_id) return [];

      const { data: mappings } = await supabase
        .from("subject_class_mappings")
        .select(`
          subject_id,
          subjects (id, name, code)
        `)
        .eq("class_id", classAssignment.class_id);

      if (!mappings) return [];

      // PostgREST returns the joined `subjects` row as either an object
      // or an array depending on the relationship cardinality the
      // generator inferred. Pick the first record either way and type
      // it locally so we don't fall back to `any`.
      type SubjectJoin = { id: string; name: string; code: string | null };
      const pickSubject = (val: unknown): SubjectJoin | null => {
        if (Array.isArray(val)) return (val[0] as SubjectJoin | undefined) ?? null;
        if (val && typeof val === "object") return val as SubjectJoin;
        return null;
      };

      return mappings
        .map((m) => {
          const subject = pickSubject((m as { subjects: unknown }).subjects);
          if (!subject) return null;
          return {
            id: m.subject_id,
            name: subject.name || "Unknown",
            code: subject.code ?? null,
          };
        })
        .filter((row): row is { id: string; name: string; code: string | null } => row !== null);
    },
  });
}
