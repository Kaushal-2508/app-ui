-- =============================================================================
-- Split multi-class subjects and soft-delete orphans
-- =============================================================================
--
-- Context
--   The current data has 245/248 institution-scoped subjects mapped to
--   multiple class_groups. The product direction is one subject per
--   class_group ("no subject is mapped for both Class 10 and Class 11").
--
--   This migration takes each multi-class subject, keeps the original row
--   for the OLDEST mapping, and clones a new universal_subjects row for
--   every additional mapping. Class-specific data (chapter_topics,
--   question_bank, class_assignments, timetable_slots, lesson_plans, tt_slots,
--   tt_lesson_plans) is re-pointed from the original to the correct clone
--   based on class_group_id (either directly on the row, or via classes.class_group_id).
--
--   Grade-scoped data (syllabus_topics, study_materials, school_custom_topics,
--   grade_subject_assignments) stays with the primary — it's semantically
--   grade-level and not tied to a specific class_group. Admins can duplicate
--   if they want per-stream topic sets later.
--
--   Cross-class data (exam_subjects, exam_templates, student_remarks,
--   subjects.universal_subject_id) also stays with the primary — exams can
--   span multiple class_groups and we don't want to guess.
--
-- Why the uniqueness triggers are temporarily disabled
--   trg_subject_unique_per_class_group (20260501120000) blocks an INSERT
--   into scgm where another subject in the same class_group has the same
--   normalized name OR code. During the split we may insert a clone with
--   the same code as an existing unrelated subject in the target class_group
--   (e.g. Physics and Physical Education both coded PHYS today). The
--   uniqueness is restored in 20260501170000 after codes are regenerated.
-- =============================================================================

ALTER TABLE public.subject_class_group_mappings
  DISABLE TRIGGER trg_subject_unique_per_class_group;
ALTER TABLE public.subject_class_mappings
  DISABLE TRIGGER trg_subject_unique_per_class;

DO $$
DECLARE
  subj RECORD;
  mapping RECORD;
  is_primary BOOLEAN;
  new_subj_id UUID;
  orphan_count INT := 0;
  split_count  INT := 0;
  created_clones INT := 0;
BEGIN
  -----------------------------------------------------------------
  -- 1. Orphans — no class_group mapping. Soft-delete per §21 UX
  --    (is_active = false). They still appear in FK references so
  --    hard delete would cascade / NULL data unexpectedly.
  -----------------------------------------------------------------
  WITH orphans AS (
    UPDATE public.universal_subjects us
       SET is_active = false
     WHERE us.institution_id IS NOT NULL
       AND us.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM public.subject_class_group_mappings scgm
          WHERE scgm.subject_id = us.id
       )
     RETURNING us.id
  )
  SELECT COUNT(*) INTO orphan_count FROM orphans;
  RAISE NOTICE '[split] soft-deleted % orphan subject(s)', orphan_count;

  -----------------------------------------------------------------
  -- 2. For every multi-class subject, clone-per-extra-mapping.
  -----------------------------------------------------------------
  FOR subj IN
    SELECT us.id, us.name, us.code, us.category, us.name_hindi,
           us.institution_id, us.created_by, us.display_order
      FROM public.universal_subjects us
     WHERE us.institution_id IS NOT NULL
       AND us.is_active = true
       AND (SELECT COUNT(*)
              FROM public.subject_class_group_mappings scgm
             WHERE scgm.subject_id = us.id) > 1
  LOOP
    is_primary := TRUE;
    split_count := split_count + 1;

    FOR mapping IN
      SELECT scgm.id AS mapping_id,
             scgm.class_group_id,
             scgm.created_at
        FROM public.subject_class_group_mappings scgm
       WHERE scgm.subject_id = subj.id
       ORDER BY scgm.created_at ASC, scgm.id ASC
    LOOP
      IF is_primary THEN
        -- Oldest mapping keeps the original row.
        is_primary := FALSE;
        CONTINUE;
      END IF;

      -- Clone the universal_subjects row.
      INSERT INTO public.universal_subjects
        (name, code, category, name_hindi,
         institution_id, is_active, created_by, display_order)
      VALUES
        (subj.name, subj.code, subj.category, subj.name_hindi,
         subj.institution_id, true, subj.created_by, subj.display_order)
      RETURNING id INTO new_subj_id;

      -- Move this mapping onto the clone.
      DELETE FROM public.subject_class_group_mappings WHERE id = mapping.mapping_id;
      INSERT INTO public.subject_class_group_mappings (institution_id, class_group_id, subject_id)
      VALUES (subj.institution_id, mapping.class_group_id, new_subj_id);

      -- ---- Re-point class-specific FK data ----

      -- class_assignments: (user_id, class_id, subject_id) unique
      DELETE FROM public.class_assignments ca
       WHERE ca.subject_id = subj.id
         AND EXISTS (SELECT 1 FROM public.classes c
                      WHERE c.id = ca.class_id
                        AND c.class_group_id = mapping.class_group_id)
         AND EXISTS (SELECT 1 FROM public.class_assignments ca2
                      WHERE ca2.subject_id = new_subj_id
                        AND ca2.user_id    = ca.user_id
                        AND ca2.class_id   = ca.class_id);
      UPDATE public.class_assignments ca
         SET subject_id = new_subj_id
       WHERE ca.subject_id = subj.id
         AND EXISTS (SELECT 1 FROM public.classes c
                      WHERE c.id = ca.class_id
                        AND c.class_group_id = mapping.class_group_id);

      -- chapter_topics: (institution_id, class_group_id, subject_id, chapter_id, name) unique
      DELETE FROM public.chapter_topics ct
       WHERE ct.subject_id     = subj.id
         AND ct.class_group_id = mapping.class_group_id
         AND EXISTS (SELECT 1 FROM public.chapter_topics ct2
                      WHERE ct2.subject_id     = new_subj_id
                        AND ct2.institution_id = ct.institution_id
                        AND ct2.class_group_id = ct.class_group_id
                        AND ct2.chapter_id     = ct.chapter_id
                        AND ct2.name           = ct.name);
      UPDATE public.chapter_topics
         SET subject_id = new_subj_id
       WHERE subject_id = subj.id
         AND class_group_id = mapping.class_group_id;

      -- question_bank (class_group_id directly)
      UPDATE public.question_bank
         SET subject_id = new_subj_id
       WHERE subject_id     = subj.id
         AND class_group_id = mapping.class_group_id;

      -- timetable_slots (via class_id → classes.class_group_id)
      UPDATE public.timetable_slots ts
         SET subject_id = new_subj_id
       WHERE ts.subject_id = subj.id
         AND EXISTS (SELECT 1 FROM public.classes c
                      WHERE c.id = ts.class_id
                        AND c.class_group_id = mapping.class_group_id);

      -- lesson_plans (via class_id)
      UPDATE public.lesson_plans lp
         SET subject_id = new_subj_id
       WHERE lp.subject_id = subj.id
         AND EXISTS (SELECT 1 FROM public.classes c
                      WHERE c.id = lp.class_id
                        AND c.class_group_id = mapping.class_group_id);

      -- tt_slots (new timetable, via class_id)
      IF to_regclass('public.tt_slots') IS NOT NULL THEN
        UPDATE public.tt_slots tts
           SET subject_id = new_subj_id
         WHERE tts.subject_id = subj.id
           AND EXISTS (SELECT 1 FROM public.classes c
                        WHERE c.id = tts.class_id
                          AND c.class_group_id = mapping.class_group_id);
      END IF;

      -- tt_lesson_plans (new timetable, via class_id)
      IF to_regclass('public.tt_lesson_plans') IS NOT NULL THEN
        UPDATE public.tt_lesson_plans tlp
           SET subject_id = new_subj_id
         WHERE tlp.subject_id = subj.id
           AND EXISTS (SELECT 1 FROM public.classes c
                        WHERE c.id = tlp.class_id
                          AND c.class_group_id = mapping.class_group_id);
      END IF;

      -- Intentionally NOT moved (grade-scoped or class-agnostic):
      --   syllabus_topics, study_materials, school_custom_topics,
      --   grade_subject_assignments, exam_subjects, exam_templates,
      --   student_remarks, subjects.universal_subject_id
      -- These remain on the primary row.

      created_clones := created_clones + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '[split] processed % multi-class subject(s), created % clone(s)',
               split_count, created_clones;
END
$$;

ALTER TABLE public.subject_class_group_mappings
  ENABLE TRIGGER trg_subject_unique_per_class_group;
ALTER TABLE public.subject_class_mappings
  ENABLE TRIGGER trg_subject_unique_per_class;
