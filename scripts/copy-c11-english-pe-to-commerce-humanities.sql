-- =============================================================================
-- Copy English - Snapshot-11 + English - Hornbill + Physical Education
--   from Class 11 Science to Class 11 Commerce + Class 11 Humanities
--   at Alliance International School.
--
-- Adapted from scripts/copy-english-vistas-flamingo-to-humanities-commerce.sql
-- (the proven Class 12 run). ADDITIVE + IDEMPOTENT — re-running is a no-op.
-- Class 11 Science is never touched.
--
-- Verified facts (2026-06-11, prod):
--   institution  8af718c6-ca11-482b-9d6b-832f2b767928  Alliance International School
--   source group 483b1354-8601-4496-bef2-11ed31313f4f  Class 11 Science (2026-27)
--   targets      e2b02115-c8db-490b-831c-a3e1ed7005eb  Class 11 Commerce (2026-27)
--                39d541c1-06d5-4a6b-a951-b98e04602d38  Class 11 Humanities (2026-27)
--   subjects     12a69dd2-b8b1-4b19-b8b5-bc1a3a700442  English - Hornbill   ENGL11  (12 ch / 12 files)
--                714e0da1-45cf-4524-b39a-699af5086bc5  English - Snapshot-11 ENG11  ( 5 ch /  5 files)
--                d7d8b220-2d84-4d11-9e19-d64c0217d7e7  Physical Education  PHYSI11  (11 ch / 11 files)
--
-- Name-collision behavior (intentional):
--   * "Physical Education" already exists in BOTH targets (Commerce PHYSICA11
--     empty; Humanities PHYSICALE11 with 2 manual chapters) → REUSED, the 11
--     chapters merge into the existing subject. No duplicate PE subject.
--   * "English - Hornbill"/"English - Snapshot-11" match nothing → new
--     subject rows cloned per target (trigger trg_subject_single_class_group
--     forbids sharing one institution subject across class_groups).
--
-- Every inserted row id is logged to salci_backups.c11_syllabus_copy_20260611
-- for precise rollback (the operation is inserts-only).
-- File URLs in study_materials are REUSED — same Storage objects, no re-upload.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS salci_backups;
CREATE TABLE IF NOT EXISTS salci_backups.c11_syllabus_copy_20260611 (
  kind         TEXT NOT NULL,         -- subject | scgm | chapter | material | tcm | chapter_topic
  row_id       UUID,
  target_group UUID,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  v_mat               RECORD;
  v_new_mat_id        UUID;
  v_rows              INT;
  v_targets_done      INT := 0;
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

  IF v_inst IS NULL OR v_inst <> '8af718c6-ca11-482b-9d6b-832f2b767928'::uuid THEN
    RAISE EXCEPTION 'Institution mismatch (got %)', v_inst;
  END IF;

  -- 2. Resolve source class_group (Class 11 Science, active)
  SELECT id INTO v_src
  FROM class_groups
  WHERE institution_id = v_inst
    AND name = 'Class 11 Science'
    AND is_active = true
  ORDER BY academic_year DESC
  LIMIT 1;

  IF v_src IS NULL OR v_src <> '483b1354-8601-4496-bef2-11ed31313f4f'::uuid THEN
    RAISE EXCEPTION 'Source class_group mismatch (got %)', v_src;
  END IF;

  -- 3. Loop over each target class_group — pinned by UUID (verified 2026-06-11)
  FOR v_target IN
    SELECT id FROM class_groups
    WHERE institution_id = v_inst
      AND id IN ('e2b02115-c8db-490b-831c-a3e1ed7005eb',   -- Class 11 Commerce
                 '39d541c1-06d5-4a6b-a951-b98e04602d38')   -- Class 11 Humanities
      AND is_active = true
    ORDER BY name
  LOOP
    v_targets_done := v_targets_done + 1;

    -- 4. Loop over the three pinned source subjects (must be mapped to source)
    FOR v_subj IN
      SELECT us.id, us.name, us.code, us.name_hindi, us.category, us.display_order
      FROM subject_class_group_mappings scgm
      JOIN universal_subjects us ON us.id = scgm.subject_id
      WHERE scgm.class_group_id = v_src
        AND us.is_active = true
        AND us.id IN (
          '12a69dd2-b8b1-4b19-b8b5-bc1a3a700442',  -- English - Hornbill
          '714e0da1-45cf-4524-b39a-699af5086bc5',  -- English - Snapshot-11
          'd7d8b220-2d84-4d11-9e19-d64c0217d7e7'   -- Physical Education
        )
    LOOP

      -- 4a. Idempotency/merge: same-named institution subject already mapped
      --     to this target → reuse it (this is how PE merges).
      v_new_subject_id := NULL;
      SELECT us2.id INTO v_new_subject_id
      FROM universal_subjects us2
      JOIN subject_class_group_mappings scgm2 ON scgm2.subject_id = us2.id
      WHERE us2.institution_id = v_inst
        AND us2.is_active = true
        AND us2.name = v_subj.name
        AND scgm2.class_group_id = v_target
      ORDER BY us2.created_at
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
        INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
        VALUES ('subject', v_new_subject_id, v_target, v_subj.name || ' / ' || v_new_code);

        -- 4d. Create the class_group mapping (trigger fans out to per-section)
        INSERT INTO subject_class_group_mappings (institution_id, class_group_id, subject_id)
        VALUES (v_inst, v_target, v_new_subject_id);
        INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
        VALUES ('scgm', v_new_subject_id, v_target, 'mapping for ' || v_subj.name);
      END IF;

      -- 5. Clone every chapter (syllabus_topics row) from the source subject
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

        IF v_new_chapter_id IS NULL THEN
          -- already existed (re-run) — look it up
          SELECT id INTO v_new_chapter_id
          FROM syllabus_topics
          WHERE grade_level_id = v_old_chapter.grade_level_id
            AND subject_id     = v_new_subject_id
            AND topic_name     = v_old_chapter.topic_name;
        ELSE
          v_chap_ins := v_chap_ins + 1;
          INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
          VALUES ('chapter', v_new_chapter_id, v_target, v_subj.name || ' :: ' || v_old_chapter.topic_name);
        END IF;

        IF v_new_chapter_id IS NULL THEN
          CONTINUE; -- defensive; shouldn't happen
        END IF;

        -- 6. Clone study_materials (PDFs / links) for this chapter.
        --    file_url is REUSED — same Supabase Storage object, no re-upload.
        FOR v_mat IN
          SELECT sm.institution_id, sm.grade_level_id, sm.title, sm.description,
                 sm.publisher, sm.material_type, sm.file_url, sm.external_link,
                 sm.is_active, sm.created_by
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
            )
        LOOP
          INSERT INTO study_materials (
            institution_id, subject_id, grade_level_id, title, description,
            publisher, material_type, file_url, external_link, is_active,
            created_by, topic_id
          ) VALUES (
            v_mat.institution_id, v_new_subject_id, v_mat.grade_level_id, v_mat.title,
            v_mat.description, v_mat.publisher, v_mat.material_type, v_mat.file_url,
            v_mat.external_link, v_mat.is_active, v_mat.created_by, v_new_chapter_id
          )
          RETURNING id INTO v_new_mat_id;
          v_mat_ins := v_mat_ins + 1;
          INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
          VALUES ('material', v_new_mat_id, v_target, v_mat.title);
        END LOOP;

        -- 7. Enable the new chapter for the target class_group
        INSERT INTO topic_class_mappings (topic_id, class_group_id)
        VALUES (v_new_chapter_id, v_target)
        ON CONFLICT (class_group_id, topic_id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
          VALUES ('tcm', v_new_chapter_id, v_target, 'topic_class_mapping');
        END IF;
        v_tcm_ins := v_tcm_ins + v_rows;

        -- 8. Clone chapter_topics (fine-grained AI-gen topic rows; source has 0
        --    today — kept for parity / future re-runs)
        WITH ins AS (
          INSERT INTO chapter_topics (institution_id, class_group_id, subject_id, chapter_id, name)
          SELECT v_inst, v_target, v_new_subject_id, v_new_chapter_id, ct.name
          FROM chapter_topics ct
          WHERE ct.chapter_id = v_old_chapter.id
            AND ct.subject_id = v_subj.id
          ON CONFLICT (institution_id, class_group_id, subject_id, chapter_id, name) DO NOTHING
          RETURNING id, name
        )
        INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
        SELECT 'chapter_topic', ins.id, v_target, ins.name FROM ins;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_ct_ins := v_ct_ins + v_rows;

      END LOOP; -- chapters
    END LOOP; -- subjects
  END LOOP; -- targets

  IF v_targets_done <> 2 THEN
    RAISE EXCEPTION 'Expected 2 target class_groups, processed % — aborting (transaction rolls back)', v_targets_done;
  END IF;

  RAISE NOTICE
    'Inserted this run: subjects=%, chapters=%, materials=%, topic_class_mappings=%, chapter_topics=%',
    v_subj_ins, v_chap_ins, v_mat_ins, v_tcm_ins, v_ct_ins;
END $$;
