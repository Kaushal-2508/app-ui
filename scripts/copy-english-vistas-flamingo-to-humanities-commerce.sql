-- =============================================================================
-- Copy English-Vistas + English-Flamingo from Class 12 Science
--   to Class 12 Humanities + Class 12 Commerce
--   at Alliance International School.
--
-- ADDITIVE + IDEMPOTENT — re-running is a no-op. Class 12 Science is never
-- touched, so existing teacher uploads / student access there is unaffected.
--
-- Why each class_group needs its OWN subject row
--   Trigger `check_subject_single_class_group` (migration 20260501170000)
--   enforces 1 institution-scoped subject ↔ 1 class_group. So we CLONE:
--     * universal_subjects                      (1 new row per target × subject)
--     * subject_class_group_mappings            (1 new row per clone)
--     * syllabus_topics    (chapters)           (1 new row per chapter × clone)
--     * study_materials    (PDFs / links)       (1 new row per material × new chapter)
--     * topic_class_mappings                    (binds new chapter to target group)
--     * chapter_topics                          (fine-grained AI gen topics)
--
-- Codes are auto-generated with a deterministic -N suffix to satisfy the
-- partial unique index on (institution_id, UPPER(TRIM(code))).
-- File URLs in study_materials are REUSED — no re-upload, same Storage objects.
-- created_by on cloned materials = original uploader (looks identical to a
-- teacher upload).
--
-- HOW TO USE:
--   * Dry-run (no writes): change the final COMMIT to ROLLBACK, paste in
--     Supabase SQL editor, read the RAISE NOTICE counters and verification
--     SELECT, then re-run with COMMIT.
--   * Or run via CLI: `npx supabase db query --linked --file <this file>`
--     (auto-commits — no explicit BEGIN/COMMIT needed since the DO block is
--     itself transactional under the Management API).
-- =============================================================================

DO $$
DECLARE
  v_inst              UUID;
  v_src               UUID;
  v_target            UUID;
  v_subj              RECORD;
  v_new_subject_id    UUID;
  v_new_code          TEXT;
  v_suffix            INT;
  v_old_chapter       RECORD;
  v_new_chapter_id    UUID;
  v_rows              INT;
  v_subj_ins          INT := 0;
  v_chap_ins          INT := 0;
  v_mat_ins           INT := 0;
  v_tcm_ins           INT := 0;
  v_ct_ins            INT := 0;
BEGIN
  -- 1. Resolve institution
  SELECT id INTO v_inst
  FROM institutions
  WHERE name ILIKE '%alliance international%'
  LIMIT 1;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Institution not found (Alliance International School)';
  END IF;

  -- 2. Resolve source class_group (Class 12 Science)
  SELECT id INTO v_src
  FROM class_groups
  WHERE institution_id = v_inst
    AND name = 'Class 12 Science'
    AND is_active = true
  ORDER BY academic_year DESC
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Source class_group not found (Class 12 Science, active)';
  END IF;

  -- 3. Loop over each target class_group (Class 12 Humanities, Class 12 Commerce)
  FOR v_target IN
    SELECT id FROM class_groups
    WHERE institution_id = v_inst
      AND name IN ('Class 12 Humanities', 'Class 12 Commerce')
      AND is_active = true
  LOOP

    -- 4. Loop over each source subject mapped to Class 12 Science that
    --    matches our two English subjects.
    FOR v_subj IN
      SELECT us.id, us.name, us.code, us.name_hindi, us.category, us.display_order
      FROM subject_class_group_mappings scgm
      JOIN universal_subjects us ON us.id = scgm.subject_id
      WHERE scgm.class_group_id = v_src
        AND us.is_active = true
        AND (
          us.code IN ('ENGLI12', 'ENGLIS12')
          OR us.name ILIKE '%vistas%'
          OR us.name ILIKE '%flamingo%'
        )
    LOOP

      -- 4a. Idempotency: if this target already has a subject with the
      --     same name owned by this institution, reuse it.
      v_new_subject_id := NULL;
      SELECT us2.id INTO v_new_subject_id
      FROM universal_subjects us2
      JOIN subject_class_group_mappings scgm2 ON scgm2.subject_id = us2.id
      WHERE us2.institution_id = v_inst
        AND us2.is_active = true
        AND us2.name = v_subj.name
        AND scgm2.class_group_id = v_target
      LIMIT 1;

      IF v_new_subject_id IS NULL THEN
        -- 4b. Generate a unique code: original, then -2, -3, ... until free
        v_suffix  := 1;
        v_new_code := v_subj.code;
        WHILE EXISTS (
          SELECT 1 FROM universal_subjects us3
          WHERE us3.institution_id = v_inst
            AND us3.is_active = true
            AND us3.code IS NOT NULL
            AND UPPER(TRIM(us3.code)) = UPPER(TRIM(v_new_code))
        ) LOOP
          v_suffix   := v_suffix + 1;
          v_new_code := v_subj.code || '-' || v_suffix;
        END LOOP;

        -- 4c. Insert the cloned subject
        INSERT INTO universal_subjects (
          name, name_hindi, code, category, institution_id, display_order, is_active
        ) VALUES (
          v_subj.name, v_subj.name_hindi, v_new_code, v_subj.category,
          v_inst, v_subj.display_order, true
        )
        RETURNING id INTO v_new_subject_id;
        v_subj_ins := v_subj_ins + 1;

        -- 4d. Create the class_group mapping (trigger fans out to per-section)
        INSERT INTO subject_class_group_mappings (institution_id, class_group_id, subject_id)
        VALUES (v_inst, v_target, v_new_subject_id);
      END IF;

      -- 5. Clone every chapter (syllabus_topics row) from the source subject
      --    to the new subject. Re-runs are no-ops via ON CONFLICT.
      FOR v_old_chapter IN
        SELECT id, grade_level_id, topic_name, topic_name_hindi, sub_topics,
               learning_outcomes, difficulty_level, expected_hours, chapter_number,
               display_order, is_active, nep_aligned, cbse_aligned
        FROM syllabus_topics
        WHERE subject_id = v_subj.id
          AND is_active = true
          AND (institution_id = v_inst OR institution_id IS NULL)
      LOOP

        v_new_chapter_id := NULL;

        INSERT INTO syllabus_topics (
          grade_level_id, subject_id, topic_name, topic_name_hindi, sub_topics,
          learning_outcomes, difficulty_level, expected_hours, chapter_number,
          display_order, is_active, nep_aligned, cbse_aligned, institution_id
        ) VALUES (
          v_old_chapter.grade_level_id, v_new_subject_id, v_old_chapter.topic_name,
          v_old_chapter.topic_name_hindi, v_old_chapter.sub_topics, v_old_chapter.learning_outcomes,
          v_old_chapter.difficulty_level, v_old_chapter.expected_hours, v_old_chapter.chapter_number,
          v_old_chapter.display_order, true, v_old_chapter.nep_aligned,
          v_old_chapter.cbse_aligned, v_inst
        )
        ON CONFLICT (grade_level_id, subject_id, topic_name) DO NOTHING
        RETURNING id INTO v_new_chapter_id;

        -- If skipped (re-run), look up the existing chapter id
        IF v_new_chapter_id IS NULL THEN
          SELECT id INTO v_new_chapter_id
          FROM syllabus_topics
          WHERE grade_level_id = v_old_chapter.grade_level_id
            AND subject_id     = v_new_subject_id
            AND topic_name     = v_old_chapter.topic_name;
        ELSE
          v_chap_ins := v_chap_ins + 1;
        END IF;

        IF v_new_chapter_id IS NULL THEN
          CONTINUE; -- defensive; shouldn't happen
        END IF;

        -- 6. Clone study_materials (PDFs / links) for this chapter.
        --    Idempotency via NOT EXISTS on (new chapter, file_url, title).
        --    file_url is REUSED — no re-upload, same Supabase Storage object.
        INSERT INTO study_materials (
          institution_id, subject_id, grade_level_id, title, description,
          publisher, material_type, file_url, external_link, is_active,
          created_by, topic_id
        )
        SELECT
          sm.institution_id, v_new_subject_id, sm.grade_level_id, sm.title, sm.description,
          sm.publisher, sm.material_type, sm.file_url, sm.external_link, sm.is_active,
          sm.created_by, v_new_chapter_id
        FROM study_materials sm
        WHERE sm.topic_id = v_old_chapter.id
          AND sm.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM study_materials sm2
            WHERE sm2.topic_id    = v_new_chapter_id
              AND sm2.subject_id  = v_new_subject_id
              AND sm2.title       = sm.title
              AND COALESCE(sm2.file_url, '')      = COALESCE(sm.file_url, '')
              AND COALESCE(sm2.external_link, '') = COALESCE(sm.external_link, '')
          );
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_mat_ins := v_mat_ins + v_rows;

        -- 7. Enable the new chapter for the target class_group
        INSERT INTO topic_class_mappings (topic_id, class_group_id)
        VALUES (v_new_chapter_id, v_target)
        ON CONFLICT (class_group_id, topic_id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_tcm_ins := v_tcm_ins + v_rows;

        -- 8. Clone chapter_topics (fine-grained AI-gen topic rows)
        INSERT INTO chapter_topics (institution_id, class_group_id, subject_id, chapter_id, name)
        SELECT v_inst, v_target, v_new_subject_id, v_new_chapter_id, ct.name
        FROM chapter_topics ct
        WHERE ct.chapter_id = v_old_chapter.id
          AND ct.subject_id = v_subj.id
        ON CONFLICT (institution_id, class_group_id, subject_id, chapter_id, name) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_ct_ins := v_ct_ins + v_rows;

      END LOOP; -- chapters
    END LOOP; -- subjects
  END LOOP; -- targets

  RAISE NOTICE
    'Inserted this run: subjects=%, chapters=%, materials=%, topic_class_mappings=%, chapter_topics=%',
    v_subj_ins, v_chap_ins, v_mat_ins, v_tcm_ins, v_ct_ins;
END $$;
