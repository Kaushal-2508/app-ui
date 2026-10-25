-- =============================================================================
-- One-time cleanup: merge existing duplicate subjects within the same class_group
-- =============================================================================
--
-- Context
--   Before 20260501120000 added the uniqueness trigger, useAddInstituteSubject
--   let admins create multiple universal_subjects rows with identical
--   (institution_id, normalized name, normalized code) and map all of them
--   to the same class_group. Sections of the group ended up showing the same
--   subject two or three times in the teacher picker, and teachers in
--   different sections of the same class were assigned to different "copies".
--
-- Scope (per product ask)
--   * Only institution-scoped subjects (institution_id IS NOT NULL).
--   * Only merge subjects with the SAME normalized name AND code.
--     Name-only or code-only collisions are left alone — they might be
--     intentional variants.
--   * Only merge subjects that share at least one class_group mapping.
--     Two duplicates that somehow ended up in completely separate class_groups
--     are left alone (not the "in the same class" scenario the user asked about).
--
-- Algorithm
--   Survivor  = oldest created_at, tiebreaker = lowest uuid.
--   For each loser:
--     (a) Delete rows in tables with UNIQUE constraints containing subject_id
--         that would collide with an existing survivor row (so the UPDATE
--         doesn't trip the index).
--     (b) UPDATE every FK table from loser → survivor.
--     (c) Delete loser's mapping rows in subject_class_group_mappings +
--         subject_class_mappings (survivor already has them; the Phase 2
--         fanout trigger will cascade section-level deletes).
--     (d) Delete the loser universal_subjects row (hard delete).
--
-- Idempotent
--   On re-run, no duplicate groups remain, so the loop body runs zero times.
-- =============================================================================

DO $$
DECLARE
  survivor_id   UUID;
  loser_id      UUID;
  merged_count  INT := 0;
  skipped_count INT := 0;
BEGIN
  FOR survivor_id, loser_id IN
    WITH ranked AS (
      SELECT
        us.id,
        FIRST_VALUE(us.id) OVER w AS survivor,
        ROW_NUMBER()       OVER w AS rn
      FROM public.universal_subjects us
      WHERE us.institution_id IS NOT NULL
        AND us.is_active = true
      WINDOW w AS (
        PARTITION BY
          us.institution_id,
          TRIM(LOWER(us.name)),
          NULLIF(TRIM(UPPER(COALESCE(us.code, ''))), '')
        ORDER BY us.created_at ASC, us.id ASC
      )
    )
    SELECT r.survivor, r.id
    FROM ranked r
    WHERE r.rn > 1
      AND EXISTS (
        SELECT 1
        FROM public.subject_class_group_mappings scgm_l
        JOIN public.subject_class_group_mappings scgm_s USING (class_group_id)
        WHERE scgm_l.subject_id = r.id
          AND scgm_s.subject_id = r.survivor
      )
  LOOP
    ----------------------------------------------------------------
    -- GUARD: if the loser is linked to any NON-draft exam via
    -- exam_subjects, the prevent_exam_structure_change trigger will
    -- refuse every change. Skip this loser rather than abort the
    -- whole batch — the admin can reconcile those exams manually.
    ----------------------------------------------------------------
    IF EXISTS (
      SELECT 1
      FROM public.exam_subjects es
      JOIN public.exams e ON e.id = es.exam_id
      WHERE es.subject_id = loser_id
        AND e.status IS DISTINCT FROM 'draft'
    ) THEN
      RAISE NOTICE 'Skipping subject % — linked to non-draft exam(s). Reconcile manually.', loser_id;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    ----------------------------------------------------------------
    -- (a) + (b) Re-point FK tables, deleting conflicts first where
    -- a UNIQUE constraint on subject_id would otherwise block UPDATE.
    ----------------------------------------------------------------

    -- class_assignments: UNIQUE (user_id, class_id, subject_id)
    DELETE FROM public.class_assignments ca
     WHERE ca.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.class_assignments ca2
          WHERE ca2.subject_id = survivor_id
            AND ca2.user_id    = ca.user_id
            AND ca2.class_id   = ca.class_id
       );
    UPDATE public.class_assignments
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- chapter_topics: UNIQUE (institution_id, class_group_id, subject_id, chapter_id, name)
    DELETE FROM public.chapter_topics ct
     WHERE ct.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.chapter_topics ct2
          WHERE ct2.subject_id     = survivor_id
            AND ct2.institution_id = ct.institution_id
            AND ct2.class_group_id = ct.class_group_id
            AND ct2.chapter_id     = ct.chapter_id
            AND ct2.name           = ct.name
       );
    UPDATE public.chapter_topics
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- syllabus_topics: UNIQUE (grade_level_id, subject_id, topic_name)
    DELETE FROM public.syllabus_topics st
     WHERE st.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.syllabus_topics st2
          WHERE st2.subject_id     = survivor_id
            AND st2.grade_level_id = st.grade_level_id
            AND st2.topic_name     = st.topic_name
       );
    UPDATE public.syllabus_topics
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- question_bank (subject_id, no UNIQUE on subject_id)
    UPDATE public.question_bank
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- study_materials (SET NULL FK, no UNIQUE)
    UPDATE public.study_materials
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- lesson_plans (SET NULL FK, no UNIQUE)
    UPDATE public.lesson_plans
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- timetable_slots (SET NULL FK, no UNIQUE on subject_id)
    UPDATE public.timetable_slots
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- exam_templates (SET NULL FK, no UNIQUE on subject_id)
    UPDATE public.exam_templates
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- tt_slots / tt_lesson_plans (new greenfield timetable; guard for dev envs
    -- where they may not exist yet)
    IF to_regclass('public.tt_slots') IS NOT NULL THEN
      UPDATE public.tt_slots
         SET subject_id = survivor_id
       WHERE subject_id = loser_id;
    END IF;

    IF to_regclass('public.tt_lesson_plans') IS NOT NULL THEN
      UPDATE public.tt_lesson_plans
         SET subject_id = survivor_id
       WHERE subject_id = loser_id;
    END IF;

    -- subjects.universal_subject_id (legacy local subjects table)
    UPDATE public.subjects
       SET universal_subject_id = survivor_id
     WHERE universal_subject_id = loser_id;

    -- exam_subjects: UNIQUE (exam_id, subject_id).
    -- By the guard above we know none of these are non-draft exams, so the
    -- structure-change trigger will not block. Delete conflicts then update.
    DELETE FROM public.exam_subjects es
     WHERE es.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.exam_subjects es2
          WHERE es2.subject_id = survivor_id
            AND es2.exam_id    = es.exam_id
       );
    UPDATE public.exam_subjects
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- student_remarks (no cascade, no UNIQUE on subject_id)
    UPDATE public.student_remarks
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- school_custom_topics: UNIQUE (institution_id, subject_id, grade_level_id, topic_name)
    DELETE FROM public.school_custom_topics sct
     WHERE sct.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.school_custom_topics sct2
          WHERE sct2.subject_id     = survivor_id
            AND sct2.institution_id = sct.institution_id
            AND sct2.grade_level_id = sct.grade_level_id
            AND sct2.topic_name     = sct.topic_name
       );
    UPDATE public.school_custom_topics
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    -- grade_subject_assignments: UNIQUE (grade_level_id, subject_id)
    DELETE FROM public.grade_subject_assignments gsa
     WHERE gsa.subject_id = loser_id
       AND EXISTS (
         SELECT 1 FROM public.grade_subject_assignments gsa2
          WHERE gsa2.subject_id     = survivor_id
            AND gsa2.grade_level_id = gsa.grade_level_id
       );
    UPDATE public.grade_subject_assignments
       SET subject_id = survivor_id
     WHERE subject_id = loser_id;

    ----------------------------------------------------------------
    -- (c) Delete loser mapping rows.
    -- Survivor already has the same class_group mapping, so the
    -- loser's scgm/scm rows are redundant. The Phase 2 AFTER DELETE
    -- trigger on subject_class_group_mappings handles the per-section
    -- fanout, and the explicit scm DELETE below catches legacy
    -- fallback rows (classes with NULL class_group_id).
    ----------------------------------------------------------------
    DELETE FROM public.subject_class_group_mappings WHERE subject_id = loser_id;
    DELETE FROM public.subject_class_mappings       WHERE subject_id = loser_id;

    ----------------------------------------------------------------
    -- (d) Hard-delete the loser universal_subjects row.
    ----------------------------------------------------------------
    DELETE FROM public.universal_subjects WHERE id = loser_id;

    merged_count := merged_count + 1;
  END LOOP;

  RAISE NOTICE 'merge_duplicate_subjects: merged %, skipped % (linked to non-draft exams).', merged_count, skipped_count;
END
$$;
