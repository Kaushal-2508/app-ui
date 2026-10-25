-- =============================================================================
-- STAGE 1 (additive, non-destructive, idempotent):
-- Fold the chapters of History + Civics + Geography into the EXISTING institute
-- "Social Science" subject of each of Class 6/7/8 at Alliance International.
--
-- * Source subjects are GLOBAL; their chapters are CLONED as Alliance-scoped
--   rows under Social Science (originals untouched -> other schools unaffected).
-- * Each cloned chapter name is PREFIXED by section ("History — ", "Civics — ",
--   "Geography — ") and CLEANED of the stored corruption:
--     - U+FFFD (chr 65533, a mangled en-dash)        -> "-"
--     - stray "Class <digit>" before year digits     -> the digit
--       e.g. "When People Rebel � 1Class 8Class 5Class 7 and After"
--            -> "History — When People Rebel - 1857 and After"
-- * Section blocks are ordered History (1xxx) -> Civics (2xxx) -> Geography (3xxx)
--   via display_order so they stay grouped after the existing SS chapters.
-- * All special characters are built DB-side via chr() — no dependence on the
--   transport encoding.
-- * Every inserted row id is logged to salci_backups.social_science_merge_20260617.
--
-- Verified facts (2026-06-17, prod):
--   institution 8af718c6-ca11-482b-9d6b-832f2b767928  Alliance International School
--   Live targets / groups:
--     C6  Social Science 38147008-dfd1-4a3a-9790-b470bb96e3e0  group d72b5605
--     C7  Social Science 115136e0-a58c-4a00-8120-2317a5d5b7ea  group 11b421bc
--     C8  Social Science 2852f766-52d1-47db-bd3e-66ed8b22e3d5  group 95b8bc81
--   Sources have 0 study_materials, 0 chapter_topics, 0 questions, ~0 teachers;
--   no chapter-name collisions across the three or with existing SS chapters.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS salci_backups;
CREATE TABLE IF NOT EXISTS salci_backups.social_science_merge_20260617 (
  log_id         bigserial PRIMARY KEY,
  kind           text,        -- 'chapter' | 'material' | 'tcm' | 'chapter_topic' | 'unmap_scgm'
  row_id         uuid,
  source_subject uuid,
  target_subject uuid,
  class_group_id uuid,
  old_name       text,
  new_name       text,
  note           text,
  created_at     timestamptz DEFAULT now()
);

DO $$
DECLARE
  c_inst CONSTANT UUID := '8af718c6-ca11-482b-9d6b-832f2b767928';
  m         RECORD;   -- one (section, rank, source, target, group) mapping
  ch        RECORD;   -- one source chapter
  v_mat     RECORD;
  v_newid   UUID;
  v_matid   UUID;
  v_clean   TEXT;
  v_newname TEXT;
  v_counter INT;
  v_rows    INT;
  v_chap_ins INT := 0;
  v_mat_ins  INT := 0;
  v_tcm_ins  INT := 0;
  v_ct_ins   INT := 0;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      -- section,       rank, source_subject,                          target_subject,                          class_group
      ('History',   1, '90dc57bb-694f-49d3-9df9-5c3ca91dafc7'::uuid, '38147008-dfd1-4a3a-9790-b470bb96e3e0'::uuid, 'd72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
      ('Civics',    2, 'a038b9c1-f0fc-4a6e-bcd0-c6bafe9ebbcf'::uuid, '38147008-dfd1-4a3a-9790-b470bb96e3e0'::uuid, 'd72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
      ('Geography', 3, '0d57ddf5-5fbc-46bf-b0f8-16d42f1fbd4c'::uuid, '38147008-dfd1-4a3a-9790-b470bb96e3e0'::uuid, 'd72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
      ('History',   1, '9d88088f-b314-404c-86a4-d68117dea7da'::uuid, '115136e0-a58c-4a00-8120-2317a5d5b7ea'::uuid, '11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
      ('Civics',    2, '9c1af94d-5c92-47a9-814d-b37f260ec04f'::uuid, '115136e0-a58c-4a00-8120-2317a5d5b7ea'::uuid, '11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
      ('Geography', 3, 'f7e27e1c-7c77-4ddd-b09a-11b8cea09f9a'::uuid, '115136e0-a58c-4a00-8120-2317a5d5b7ea'::uuid, '11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
      ('History',   1, 'bc99f893-2277-4019-af80-d9b74d102707'::uuid, '2852f766-52d1-47db-bd3e-66ed8b22e3d5'::uuid, '95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
      ('Civics',    2, '832e9141-37d6-4ede-98c6-0f81ddca6a0a'::uuid, '2852f766-52d1-47db-bd3e-66ed8b22e3d5'::uuid, '95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
      ('Geography', 3, '58d41ba9-936e-43e6-b2c8-b0697b678ef2'::uuid, '2852f766-52d1-47db-bd3e-66ed8b22e3d5'::uuid, '95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid)
    ) AS t(section, rank, src, tgt, grp)
  LOOP
    -- Guard: target Social Science must be active, Alliance-owned, mapped to grp.
    IF NOT EXISTS (
      SELECT 1 FROM universal_subjects us
      JOIN subject_class_group_mappings x ON x.subject_id = us.id
      WHERE us.id = m.tgt AND us.is_active AND us.institution_id = c_inst
        AND x.class_group_id = m.grp
    ) THEN
      RAISE EXCEPTION 'Target Social Science % not active/Alliance/mapped to group %', m.tgt, m.grp;
    END IF;

    v_counter := 0;

    FOR ch IN
      SELECT id, grade_level_id, topic_name, topic_name_hindi, sub_topics,
             learning_outcomes, difficulty_level, expected_hours, chapter_number,
             nep_aligned, cbse_aligned
      FROM syllabus_topics
      WHERE subject_id = m.src
        AND is_active = true
        AND (institution_id = c_inst OR institution_id IS NULL)
      ORDER BY COALESCE(chapter_number, 9999), topic_name
    LOOP
      v_counter := v_counter + 1;

      -- Clean: FFFD -> '-', strip stray "Class <digit>", collapse spaces.
      v_clean := btrim(
        regexp_replace(
          regexp_replace(
            replace(ch.topic_name, chr(65533), '-'),
          'Class (\d)', '\1', 'g'),
        ' {2,}', ' ', 'g')
      );
      -- Prefix: "<Section> — <clean>"  (em dash built DB-side)
      v_newname := m.section || ' ' || chr(8212) || ' ' || v_clean;

      v_newid := NULL;
      INSERT INTO syllabus_topics (
        grade_level_id, subject_id, topic_name, topic_name_hindi, sub_topics,
        learning_outcomes, difficulty_level, expected_hours, chapter_number,
        display_order, is_active, nep_aligned, cbse_aligned, institution_id
      ) VALUES (
        ch.grade_level_id, m.tgt, v_newname,
        NULLIF(btrim(regexp_replace(regexp_replace(replace(COALESCE(ch.topic_name_hindi,''), chr(65533), '-'), 'Class (\d)', '\1', 'g'), ' {2,}', ' ', 'g')), ''),
        ch.sub_topics, ch.learning_outcomes, ch.difficulty_level, ch.expected_hours,
        ch.chapter_number, m.rank * 1000 + v_counter, true,
        ch.nep_aligned, ch.cbse_aligned, c_inst
      )
      ON CONFLICT (grade_level_id, subject_id, topic_name) DO NOTHING
      RETURNING id INTO v_newid;

      IF v_newid IS NULL THEN
        -- already cloned (idempotent re-run) -> look it up
        SELECT id INTO v_newid FROM syllabus_topics
        WHERE grade_level_id = ch.grade_level_id AND subject_id = m.tgt
          AND topic_name = v_newname;
      ELSE
        v_chap_ins := v_chap_ins + 1;
        INSERT INTO salci_backups.social_science_merge_20260617
          (kind, row_id, source_subject, target_subject, class_group_id, old_name, new_name)
        VALUES ('chapter', v_newid, m.src, m.tgt, m.grp, ch.topic_name, v_newname);
      END IF;

      IF v_newid IS NULL THEN CONTINUE; END IF;  -- defensive

      -- Clone any study_materials on the source chapter (sources have 0 today).
      FOR v_mat IN
        SELECT sm.grade_level_id, sm.title, sm.description, sm.publisher,
               sm.material_type, sm.file_url, sm.external_link, sm.created_by
        FROM study_materials sm
        WHERE sm.topic_id = ch.id AND sm.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM study_materials s2
            WHERE s2.topic_id = v_newid AND s2.subject_id = m.tgt
              AND s2.title = sm.title
              AND COALESCE(s2.file_url,'')      = COALESCE(sm.file_url,'')
              AND COALESCE(s2.external_link,'') = COALESCE(sm.external_link,'')
          )
      LOOP
        INSERT INTO study_materials (
          institution_id, subject_id, grade_level_id, title, description,
          publisher, material_type, file_url, external_link, is_active,
          created_by, topic_id
        ) VALUES (
          c_inst, m.tgt, v_mat.grade_level_id, v_mat.title, v_mat.description,
          v_mat.publisher, v_mat.material_type, v_mat.file_url, v_mat.external_link,
          true, v_mat.created_by, v_newid
        ) RETURNING id INTO v_matid;
        v_mat_ins := v_mat_ins + 1;
        INSERT INTO salci_backups.social_science_merge_20260617
          (kind, row_id, source_subject, target_subject, class_group_id, new_name)
        VALUES ('material', v_matid, m.src, m.tgt, m.grp, v_mat.title);
      END LOOP;

      -- Enable the cloned chapter for the target class_group.
      INSERT INTO topic_class_mappings (topic_id, class_group_id)
      VALUES (v_newid, m.grp)
      ON CONFLICT (class_group_id, topic_id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        v_tcm_ins := v_tcm_ins + 1;
        INSERT INTO salci_backups.social_science_merge_20260617
          (kind, row_id, source_subject, target_subject, class_group_id, note)
        VALUES ('tcm', v_newid, m.src, m.tgt, m.grp, 'topic_class_mapping');
      END IF;

      -- chapter_topics parity clone (sources have 0 today).
      WITH ins AS (
        INSERT INTO chapter_topics (institution_id, class_group_id, subject_id, chapter_id, name)
        SELECT c_inst, m.grp, m.tgt, v_newid, ct.name
        FROM chapter_topics ct
        WHERE ct.chapter_id = ch.id AND ct.subject_id = m.src
        ON CONFLICT (institution_id, class_group_id, subject_id, chapter_id, name) DO NOTHING
        RETURNING id, name
      )
      INSERT INTO salci_backups.social_science_merge_20260617
        (kind, row_id, source_subject, target_subject, class_group_id, new_name)
      SELECT 'chapter_topic', ins.id, m.src, m.tgt, m.grp, ins.name FROM ins;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_ct_ins := v_ct_ins + v_rows;

    END LOOP;
  END LOOP;

  RAISE NOTICE 'STAGE1 inserted: chapters=%, materials=%, tcm=%, chapter_topics=%',
    v_chap_ins, v_mat_ins, v_tcm_ins, v_ct_ins;
END $$;
