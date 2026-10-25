-- =============================================================================
-- Merge Economics chapters + PDFs from Class 11 Humanities into the EXISTING
-- Economics subject of Class 11 Commerce at Alliance International School.
--
-- Chapter-level merge (no subject is created): the 8 Humanities chapters and
-- their study_materials are cloned UNDER the existing Commerce Economics
-- subject. file_url is REUSED — same Storage objects, no re-upload.
-- ADDITIVE + IDEMPOTENT — re-running is a no-op. Humanities is never touched.
--
-- Verified facts (2026-06-12, prod):
--   institution   8af718c6-ca11-482b-9d6b-832f2b767928  Alliance International School
--   source group  39d541c1-06d5-4a6b-a951-b98e04602d38  Class 11 Humanities (active)
--   target group  e2b02115-c8db-490b-831c-a3e1ed7005eb  Class 11 Commerce  (active)
--   source subj   fe08f5da-f0df-4adf-af7d-8892007fd9f2  Economics ECON11  (8 ch / 8 files, grade 11)
--   target subj   0d3befd5-9a06-4b82-aabb-c9c47849b44c  Economics ECONO11 (2 ch / 2 files, grade 11)
--   no chapter-name collisions; no inactive chapters; no chapter_topics;
--   no materials with NULL topic_id on either subject.
--   Expected result: Commerce Economics = 10 chapters / 10 materials.
--
-- Inserted row ids are logged to salci_backups.c11_syllabus_copy_20260611
-- (same table as the 2026-06-11 English/PE copy; distinguish by created_at).
-- =============================================================================

DO $$
DECLARE
  c_src_subj CONSTANT UUID := 'fe08f5da-f0df-4adf-af7d-8892007fd9f2'; -- Humanities Economics
  c_tgt_subj CONSTANT UUID := '0d3befd5-9a06-4b82-aabb-c9c47849b44c'; -- Commerce Economics
  c_tgt_grp  CONSTANT UUID := 'e2b02115-c8db-490b-831c-a3e1ed7005eb'; -- Class 11 Commerce
  c_inst     CONSTANT UUID := '8af718c6-ca11-482b-9d6b-832f2b767928';
  v_old_chapter     RECORD;
  v_mat             RECORD;
  v_new_chapter_id  UUID;
  v_new_mat_id      UUID;
  v_rows            INT;
  v_chap_ins        INT := 0;
  v_mat_ins         INT := 0;
  v_tcm_ins         INT := 0;
  v_ct_ins          INT := 0;
BEGIN
  -- Guards: both subjects must be active, institution-owned, and mapped to
  -- their expected class_groups.
  IF NOT EXISTS (
    SELECT 1 FROM universal_subjects us
    JOIN subject_class_group_mappings m ON m.subject_id = us.id
    WHERE us.id = c_src_subj AND us.is_active AND us.institution_id = c_inst
      AND m.class_group_id = '39d541c1-06d5-4a6b-a951-b98e04602d38'
  ) THEN
    RAISE EXCEPTION 'Source Economics subject % not active/mapped to Class 11 Humanities', c_src_subj;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM universal_subjects us
    JOIN subject_class_group_mappings m ON m.subject_id = us.id
    WHERE us.id = c_tgt_subj AND us.is_active AND us.institution_id = c_inst
      AND m.class_group_id = c_tgt_grp
  ) THEN
    RAISE EXCEPTION 'Target Economics subject % not active/mapped to Class 11 Commerce', c_tgt_subj;
  END IF;

  FOR v_old_chapter IN
    SELECT id, grade_level_id, topic_name, topic_name_hindi, sub_topics,
           learning_outcomes, difficulty_level, expected_hours, chapter_number,
           display_order, nep_aligned, cbse_aligned
    FROM syllabus_topics
    WHERE subject_id = c_src_subj
      AND is_active = true
      AND (institution_id = c_inst OR institution_id IS NULL)
  LOOP

    v_new_chapter_id := NULL;

    INSERT INTO syllabus_topics (
      grade_level_id, subject_id, topic_name, topic_name_hindi, sub_topics,
      learning_outcomes, difficulty_level, expected_hours, chapter_number,
      display_order, is_active, nep_aligned, cbse_aligned, institution_id
    ) VALUES (
      v_old_chapter.grade_level_id, c_tgt_subj, v_old_chapter.topic_name,
      v_old_chapter.topic_name_hindi, v_old_chapter.sub_topics, v_old_chapter.learning_outcomes,
      v_old_chapter.difficulty_level, v_old_chapter.expected_hours, v_old_chapter.chapter_number,
      v_old_chapter.display_order, true, v_old_chapter.nep_aligned,
      v_old_chapter.cbse_aligned, c_inst
    )
    ON CONFLICT (grade_level_id, subject_id, topic_name) DO NOTHING
    RETURNING id INTO v_new_chapter_id;

    IF v_new_chapter_id IS NULL THEN
      -- already existed (re-run) — look it up
      SELECT id INTO v_new_chapter_id
      FROM syllabus_topics
      WHERE grade_level_id = v_old_chapter.grade_level_id
        AND subject_id     = c_tgt_subj
        AND topic_name     = v_old_chapter.topic_name;
    ELSE
      v_chap_ins := v_chap_ins + 1;
      INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
      VALUES ('chapter', v_new_chapter_id, c_tgt_grp, 'Economics merge :: ' || v_old_chapter.topic_name);
    END IF;

    IF v_new_chapter_id IS NULL THEN
      CONTINUE; -- defensive; shouldn't happen
    END IF;

    -- Clone study_materials; file_url reused, created_by = original uploader.
    FOR v_mat IN
      SELECT sm.institution_id, sm.grade_level_id, sm.title, sm.description,
             sm.publisher, sm.material_type, sm.file_url, sm.external_link,
             sm.created_by
      FROM study_materials sm
      WHERE sm.topic_id = v_old_chapter.id
        AND sm.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM study_materials sm2
          WHERE sm2.topic_id    = v_new_chapter_id
            AND sm2.subject_id  = c_tgt_subj
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
        v_mat.institution_id, c_tgt_subj, v_mat.grade_level_id, v_mat.title,
        v_mat.description, v_mat.publisher, v_mat.material_type, v_mat.file_url,
        v_mat.external_link, true, v_mat.created_by, v_new_chapter_id
      )
      RETURNING id INTO v_new_mat_id;
      v_mat_ins := v_mat_ins + 1;
      INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
      VALUES ('material', v_new_mat_id, c_tgt_grp, v_mat.title);
    END LOOP;

    -- Enable the chapter for the Commerce class_group
    INSERT INTO topic_class_mappings (topic_id, class_group_id)
    VALUES (v_new_chapter_id, c_tgt_grp)
    ON CONFLICT (class_group_id, topic_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
      VALUES ('tcm', v_new_chapter_id, c_tgt_grp, 'topic_class_mapping');
    END IF;
    v_tcm_ins := v_tcm_ins + v_rows;

    -- chapter_topics parity clone (source has 0 today)
    WITH ins AS (
      INSERT INTO chapter_topics (institution_id, class_group_id, subject_id, chapter_id, name)
      SELECT c_inst, c_tgt_grp, c_tgt_subj, v_new_chapter_id, ct.name
      FROM chapter_topics ct
      WHERE ct.chapter_id = v_old_chapter.id
        AND ct.subject_id = c_src_subj
      ON CONFLICT (institution_id, class_group_id, subject_id, chapter_id, name) DO NOTHING
      RETURNING id, name
    )
    INSERT INTO salci_backups.c11_syllabus_copy_20260611 (kind, row_id, target_group, note)
    SELECT 'chapter_topic', ins.id, c_tgt_grp, ins.name FROM ins;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_ct_ins := v_ct_ins + v_rows;

  END LOOP;

  IF v_chap_ins = 0 AND v_mat_ins = 0 AND v_tcm_ins = 0 THEN
    RAISE NOTICE 'Nothing inserted — already merged (idempotent re-run).';
  END IF;

  RAISE NOTICE 'Inserted: chapters=%, materials=%, tcm=%, chapter_topics=%',
    v_chap_ins, v_mat_ins, v_tcm_ins, v_ct_ins;
END $$;
