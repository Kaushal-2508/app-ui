-- =====================================================================
-- Alliance International School - Class 3: English + English Grammar -> English
--
-- Written : 2026-10-06
-- Institution : 8af718c6-ca11-482b-9d6b-832f2b767928 (AIS)
-- Class group : b1643681-ecec-4545-a331-b1439862d5e6 (Class 3, AY 2026-27, 3 sections)
--
-- WHY THIS ONE IS NOT LIKE THE EARLIER SUBJECT MERGES
-- The Class 9/10/11/12 merges elected a survivor and renamed it. That is
-- IMPOSSIBLE here: both source subjects are GLOBAL (universal_subjects.
-- institution_id IS NULL) and are mapped to six institutions across two
-- academic years. Renaming or deleting either would change the syllabus of
-- five other schools. So instead:
--
--   * a NEW institute-owned subject is created for Alliance only;
--   * Alliance's own rows are MOVED onto it;
--   * the shared global chapters are COPIED (never moved) and every Alliance
--     row pointing at a global chapter is remapped to its copy;
--   * the two global subjects are UNMAPPED from Alliance's Class 3 and are
--     otherwise left completely untouched - not renamed, not deleted.
--
-- Verified on prod 2026-10-06 before writing: of the 37 global chapters,
-- ZERO rows belong to any institution other than Alliance (questions,
-- materials, sequence, progress, lesson plans, hidden-topic rows all 0).
-- Alliance is the only real user; the rows are shared only in principle.
--
-- TWO FACTS THAT DRIVE THE SHAPE OF THIS SCRIPT
--  1. grade_level_id on the new subject MUST be NULL. universal_subjects has
--     UNIQUE (grade_level_id, lower(name)) and both globals sit on the Class 3
--     grade level, so a new "English" carrying that grade level collides at
--     once. Every Alliance subject already uses NULL, so this is also the
--     house pattern, not a workaround.
--  2. Alliance has HIDDEN all 20 global English chapters (it teaches its own
--     17) while keeping all 17 global Grammar chapters. Copying blindly would
--     resurrect 20 chapters the school deliberately removed. The copies of
--     hidden chapters are therefore written with is_active = false, which
--     preserves the decision AND keeps the 22 questions still attached to them.
--
-- ORDERING THAT MATTERS
--   trg_subject_unique_per_class_group refuses a second active subject with
--   the same name in one class group. The globals must be unmapped (step 9)
--   BEFORE the new "English" is mapped (step 10), or the insert raises 23505.
--
-- Reversible from salci_backups.ais_c3_english_merge_20261006_*.
-- Apply with:
--   scripts/run-sql.ps1 -SqlFile scripts/merge-ais-class3-english-20261006.sql
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';

CREATE SCHEMA IF NOT EXISTS salci_backups;

-- ---------------------------------------------------------------------
-- 1. Context: every id this script uses, in one place.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_ctx;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_ctx AS
SELECT
  '8af718c6-ca11-482b-9d6b-832f2b767928'::uuid AS ais,
  'b1643681-ecec-4545-a331-b1439862d5e6'::uuid AS cg3,
  '9af23ace-3f0f-45ce-bf83-39b0dad7333d'::uuid AS eng_global,
  'c7ee1bf3-66f3-45a5-a90d-aaa9576c2173'::uuid AS grm_global,
  gen_random_uuid()                            AS new_subject_id;

-- ---------------------------------------------------------------------
-- 2. Guard rails - refuse to run if prod has drifted from the audit.
-- ---------------------------------------------------------------------
DO $guard$
DECLARE c record; n int;
BEGIN
  SELECT * INTO c FROM salci_backups.ais_c3_english_merge_20261006_ctx;

  IF NOT EXISTS (SELECT 1 FROM universal_subjects
                  WHERE id = c.eng_global AND institution_id IS NULL AND name = 'English') THEN
    RAISE EXCEPTION 'Aborting: the global English subject is missing or is no longer global.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM universal_subjects
                  WHERE id = c.grm_global AND institution_id IS NULL AND name = 'English Grammar') THEN
    RAISE EXCEPTION 'Aborting: the global English Grammar subject is missing or is no longer global.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM class_groups
                  WHERE id = c.cg3 AND institution_id = c.ais AND is_active) THEN
    RAISE EXCEPTION 'Aborting: Class 3 (2026-27) is missing or inactive.';
  END IF;

  -- Both globals must still be mapped to that group, or there is nothing to unmap.
  SELECT count(*) INTO n FROM subject_class_group_mappings
   WHERE class_group_id = c.cg3 AND subject_id IN (c.eng_global, c.grm_global);
  IF n <> 2 THEN
    RAISE EXCEPTION 'Aborting: expected both globals mapped to Class 3, found %.', n;
  END IF;

  -- The safety claim this whole approach rests on: nobody else uses these chapters.
  SELECT
    (SELECT count(*) FROM question_bank x JOIN syllabus_topics t ON t.id = x.topic_id
      WHERE t.subject_id IN (c.eng_global, c.grm_global) AND t.institution_id IS NULL
        AND x.institution_id <> c.ais)
  + (SELECT count(*) FROM study_materials x JOIN syllabus_topics t ON t.id = x.topic_id
      WHERE t.subject_id IN (c.eng_global, c.grm_global) AND t.institution_id IS NULL
        AND x.institution_id <> c.ais)
  + (SELECT count(*) FROM syllabus_sequence x JOIN syllabus_topics t ON t.id = x.topic_id
      WHERE t.subject_id IN (c.eng_global, c.grm_global) AND t.institution_id IS NULL
        AND x.institution_id <> c.ais)
  + (SELECT count(*) FROM syllabus_progress_events x JOIN syllabus_topics t ON t.id = x.topic_id
      WHERE t.subject_id IN (c.eng_global, c.grm_global) AND t.institution_id IS NULL
        AND x.institution_id <> c.ais)
  + (SELECT count(*) FROM tt_lesson_plans x JOIN syllabus_topics t ON t.id = x.topic_id
      WHERE t.subject_id IN (c.eng_global, c.grm_global) AND t.institution_id IS NULL
        AND x.institution_id <> c.ais)
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: % row(s) on the shared chapters belong to another school. Re-audit before merging.', n;
  END IF;

  -- No other school may own a chapter on these subjects either.
  SELECT count(*) INTO n FROM syllabus_topics
   WHERE subject_id IN (c.eng_global, c.grm_global)
     AND institution_id IS NOT NULL AND institution_id <> c.ais;
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: % chapter(s) on these subjects belong to another school.', n;
  END IF;

  RAISE NOTICE 'Guard rails passed.';
END
$guard$;

-- ---------------------------------------------------------------------
-- 3. Backups, before anything changes.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_topics_before;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_topics_before AS
SELECT st.* FROM syllabus_topics st, salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE st.subject_id IN (c.eng_global, c.grm_global);

DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_scgm;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_scgm AS
SELECT m.* FROM subject_class_group_mappings m, salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE m.subject_id IN (c.eng_global, c.grm_global);

DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_scm;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_scm AS
SELECT m.* FROM subject_class_mappings m, salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE m.subject_id IN (c.eng_global, c.grm_global);

DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_hidden;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_hidden AS
SELECT h.* FROM institution_hidden_topics h, salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE h.topic_id IN (SELECT id FROM syllabus_topics
                      WHERE subject_id IN (c.eng_global, c.grm_global));

-- Ledgers
DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_moves;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_moves (
  tbl text NOT NULL, col text NOT NULL, row_id uuid NOT NULL,
  old_value uuid NOT NULL, new_value uuid NOT NULL
);

DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_deleted;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_deleted (
  tbl text NOT NULL, row_id uuid NOT NULL, reason text NOT NULL, payload jsonb NOT NULL
);

-- ---------------------------------------------------------------------
-- 4. The new institute-owned subject.
--    grade_level_id stays NULL on purpose - see the header.
-- ---------------------------------------------------------------------
INSERT INTO universal_subjects
  (id, name, code, category, is_active, institution_id, grade_level_id, created_at, updated_at)
SELECT c.new_subject_id, 'English', 'ENG3', 'language', true, c.ais, NULL, now(), now()
FROM salci_backups.ais_c3_english_merge_20261006_ctx c;

-- ---------------------------------------------------------------------
-- 5. The chapter plan.
--    Global chapters get a fresh id (they are COPIED). Alliance chapters keep
--    their id (they are MOVED). Grammar chapters gain a "Grammar: " label.
--    Order: English first, active before hidden, then Grammar.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_c3_english_merge_20261006_chapters;
CREATE TABLE salci_backups.ais_c3_english_merge_20261006_chapters AS
SELECT
  st.id                                        AS old_topic_id,
  st.subject_id                                AS old_subject_id,
  (st.subject_id = c.grm_global)               AS is_grammar,
  (st.institution_id IS NULL)                  AS was_global,
  EXISTS (SELECT 1 FROM institution_hidden_topics h
           WHERE h.topic_id = st.id AND h.institution_id = c.ais) AS was_hidden,
  CASE WHEN st.institution_id IS NULL THEN gen_random_uuid() ELSE st.id END AS new_topic_id,
  CASE WHEN st.subject_id = c.grm_global THEN 'Grammar: ' || st.topic_name
       ELSE st.topic_name END                  AS new_topic_name,
  st.topic_name                                AS old_topic_name,
  row_number() OVER (
    ORDER BY (st.subject_id = c.grm_global),
             EXISTS (SELECT 1 FROM institution_hidden_topics h
                      WHERE h.topic_id = st.id AND h.institution_id = c.ais),
             coalesce(st.display_order, 999999),
             coalesce(st.chapter_number, 999999),
             st.created_at, st.topic_name
  )::int                                       AS new_display_order
FROM syllabus_topics st, salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE st.subject_id IN (c.eng_global, c.grm_global)
  AND (st.institution_id IS NULL OR st.institution_id = c.ais);

-- ---------------------------------------------------------------------
-- 6. COPY the shared global chapters onto the new subject.
--    A chapter Alliance had hidden is copied inactive, so the school's own
--    decision survives and the 22 questions on it keep a valid parent.
-- ---------------------------------------------------------------------
INSERT INTO syllabus_topics
  (id, grade_level_id, subject_id, topic_name, topic_name_hindi, sub_topics,
   learning_outcomes, difficulty_level, expected_hours, chapter_number, display_order,
   is_active, nep_aligned, cbse_aligned, created_at, updated_at, created_by, institution_id)
SELECT p.new_topic_id, st.grade_level_id, c.new_subject_id, p.new_topic_name,
       st.topic_name_hindi, st.sub_topics, st.learning_outcomes, st.difficulty_level,
       st.expected_hours, st.chapter_number, p.new_display_order,
       CASE WHEN p.was_hidden THEN false ELSE st.is_active END,
       st.nep_aligned, st.cbse_aligned, st.created_at, now(), st.created_by, c.ais
FROM salci_backups.ais_c3_english_merge_20261006_chapters p
JOIN syllabus_topics st ON st.id = p.old_topic_id
CROSS JOIN salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE p.was_global;

-- ---------------------------------------------------------------------
-- 7. MOVE Alliance's own chapters onto the new subject.
-- ---------------------------------------------------------------------
UPDATE syllabus_topics st
   SET subject_id    = c.new_subject_id,
       topic_name    = p.new_topic_name,
       display_order = p.new_display_order,
       updated_at    = now()
FROM salci_backups.ais_c3_english_merge_20261006_chapters p,
     salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE st.id = p.old_topic_id AND NOT p.was_global;

-- ---------------------------------------------------------------------
-- 7b. Suspend the two publish/edit-lock guards for this transaction.
--
--     exam_subjects.prevent_subject_link_change_after_publish refuses ANY
--     change to a locked exam's subject links, and
--     homework_assignments.homework_assignments_edit_lock refuses a subject_id
--     change on homework already visible to students. Both exist to stop a
--     teacher rewriting published work; neither can tell that apart from an
--     administrative subject merge.
--
--     Nothing about the exam or the homework changes here: questions, marks,
--     attempts, sections, attachments and due dates are untouched. Only the
--     subject row they point at is swapped for the merged one.
--
--     ALTER TABLE is transactional, so a later failure restores these with the
--     rollback. Step 11b restores them explicitly and step 12 refuses to commit
--     unless both are enabled again. Never reach for session_replication_role:
--     it would also silence the fanout trigger step 10 and 11 depend on.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        DISABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments DISABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 8. Remap every Alliance row that pointed at a GLOBAL chapter onto its copy.
--    Without this the copies would be empty shells and the originals would
--    keep Alliance's work attached to a subject Alliance no longer uses.
-- ---------------------------------------------------------------------
DO $remap$
DECLARE
  c record; t record; n bigint;
BEGIN
  SELECT * INTO c FROM salci_backups.ais_c3_english_merge_20261006_ctx;

  FOR t IN
    SELECT * FROM (VALUES
      ('question_bank',            'topic_id',   'institution_id'),
      ('study_materials',          'topic_id',   'institution_id'),
      ('syllabus_sequence',        'topic_id',   'institution_id'),
      ('syllabus_progress_events', 'topic_id',   'institution_id'),
      ('tt_lesson_plans',          'topic_id',   'institution_id'),
      ('concept_mastery',          'topic_id',   'institution_id'),
      ('learning_actions',         'topic_id',   'institution_id'),
      ('chapter_topics',           'chapter_id', 'institution_id')
    ) AS x(tbl, col, instcol)
  LOOP
    EXECUTE format($f$
      WITH upd AS (
        UPDATE public.%1$I r
           SET %2$I = p.new_topic_id
          FROM salci_backups.ais_c3_english_merge_20261006_chapters p
         WHERE r.%2$I = p.old_topic_id
           AND p.was_global
           AND r.%3$I = %4$L::uuid
        RETURNING r.id, p.old_topic_id, p.new_topic_id
      )
      INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
      SELECT %5$L, %6$L, id, old_topic_id, new_topic_id FROM upd
    $f$, t.tbl, t.col, t.instcol, c.ais, t.tbl, t.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'remapped % chapter ref(s) in %.%', n, t.tbl, t.col; END IF;
  END LOOP;

  -- exam_topics has no institution_id; scope through its exam.
  WITH upd AS (
    UPDATE exam_topics et
       SET topic_id = p.new_topic_id
      FROM salci_backups.ais_c3_english_merge_20261006_chapters p,
           exams e
     WHERE et.topic_id = p.old_topic_id
       AND p.was_global
       AND e.id = et.exam_id
       AND e.institution_id = c.ais
    RETURNING et.id, p.old_topic_id, p.new_topic_id
  )
  INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
  SELECT 'exam_topics','topic_id', id, old_topic_id, new_topic_id FROM upd;
END
$remap$;

-- ---------------------------------------------------------------------
-- 9. Dedupe, then repoint subject_id.
--    Reena Makkar Kataria teaches both subjects in 3A and 3B and Veenu Koshal
--    in 3C, so three class_assignments rows collide the moment both subjects
--    become one. Same for one exam and three homework links.
--    The English row is kept and the Grammar row dropped.
-- ---------------------------------------------------------------------
DO $dedupe$
DECLARE c record; n bigint;
BEGIN
  SELECT * INTO c FROM salci_backups.ais_c3_english_merge_20261006_ctx;

  -- class_assignments: UNIQUE (user_id, class_id, subject_id)
  WITH ranked AS (
    SELECT ca.id, to_jsonb(ca) AS payload,
           row_number() OVER (PARTITION BY ca.user_id, ca.class_id
                              ORDER BY (ca.subject_id = c.grm_global)) AS rn
      FROM class_assignments ca
      JOIN classes cl ON cl.id = ca.class_id
     WHERE ca.subject_id IN (c.eng_global, c.grm_global)
       AND cl.institution_id = c.ais
  ), doomed AS (SELECT id, payload FROM ranked WHERE rn > 1),
     logged AS (
       INSERT INTO salci_backups.ais_c3_english_merge_20261006_deleted(tbl,row_id,reason,payload)
       SELECT 'class_assignments', id, 'same teacher held both subjects in this section', payload FROM doomed
       RETURNING row_id)
  DELETE FROM class_assignments x USING logged l WHERE x.id = l.row_id;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'dedupe: class_assignments %', n;

  -- exam_subjects: UNIQUE (exam_id, subject_id)
  WITH ranked AS (
    SELECT es.id, to_jsonb(es) AS payload,
           row_number() OVER (PARTITION BY es.exam_id
                              ORDER BY (es.subject_id = c.grm_global)) AS rn
      FROM exam_subjects es JOIN exams e ON e.id = es.exam_id
     WHERE es.subject_id IN (c.eng_global, c.grm_global) AND e.institution_id = c.ais
  ), doomed AS (SELECT id, payload FROM ranked WHERE rn > 1),
     logged AS (
       INSERT INTO salci_backups.ais_c3_english_merge_20261006_deleted(tbl,row_id,reason,payload)
       SELECT 'exam_subjects', id, 'one exam cited both subjects', payload FROM doomed
       RETURNING row_id)
  DELETE FROM exam_subjects x USING logged l WHERE x.id = l.row_id;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'dedupe: exam_subjects %', n;

  -- homework_assignment_subjects: UNIQUE (homework_assignment_id, subject_id)
  WITH ranked AS (
    SELECT hs.id, to_jsonb(hs) AS payload,
           row_number() OVER (PARTITION BY hs.homework_assignment_id
                              ORDER BY (hs.subject_id = c.grm_global)) AS rn
      FROM homework_assignment_subjects hs
      JOIN homework_assignments h ON h.id = hs.homework_assignment_id
     WHERE hs.subject_id IN (c.eng_global, c.grm_global) AND h.institution_id = c.ais
  ), doomed AS (SELECT id, payload FROM ranked WHERE rn > 1),
     logged AS (
       INSERT INTO salci_backups.ais_c3_english_merge_20261006_deleted(tbl,row_id,reason,payload)
       SELECT 'homework_assignment_subjects', id, 'one homework cited both subjects', payload FROM doomed
       RETURNING row_id)
  DELETE FROM homework_assignment_subjects x USING logged l WHERE x.id = l.row_id;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'dedupe: homework_assignment_subjects %', n;
END
$dedupe$;

DO $repoint$
DECLARE c record; t record; n bigint;
BEGIN
  SELECT * INTO c FROM salci_backups.ais_c3_english_merge_20261006_ctx;

  -- Tables carrying institution_id: scope directly.
  FOR t IN
    SELECT * FROM (VALUES
      ('question_bank'), ('study_materials'), ('homework_assignments'),
      ('tt_slots'), ('tt_lesson_plans'), ('syllabus_progress_events'),
      ('syllabus_sequence'), ('chapter_topics'), ('exam_templates'),
      ('school_custom_topics'), ('student_optional_enrollments')
    ) AS x(tbl)
  LOOP
    -- tgt is snapshotted BEFORE the update so the ledger keeps the real old
    -- subject_id; reading it from RETURNING would only ever give the new one.
    EXECUTE format($f$
      WITH tgt AS (
        SELECT r.id, r.subject_id AS old_sid
          FROM public.%1$I r
         WHERE r.subject_id IN (%3$L::uuid, %4$L::uuid)
           AND r.institution_id = %5$L::uuid
      ), upd AS (
        UPDATE public.%1$I r SET subject_id = %2$L::uuid
          FROM tgt WHERE r.id = tgt.id
        RETURNING r.id
      )
      INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
      SELECT %6$L, 'subject_id', tgt.id, tgt.old_sid, %2$L::uuid FROM tgt
    $f$, t.tbl, c.new_subject_id, c.eng_global, c.grm_global, c.ais, t.tbl);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'repointed % row(s) in %', n, t.tbl; END IF;
  END LOOP;

  -- The three tables below carry no institution_id, so each is scoped through
  -- its parent. Each snapshots its targets first, for the same ledger reason.

  -- class_assignments: scope through classes.
  WITH tgt AS (
    SELECT ca.id, ca.subject_id AS old_sid
      FROM class_assignments ca JOIN classes cl ON cl.id = ca.class_id
     WHERE cl.institution_id = c.ais AND ca.subject_id IN (c.eng_global, c.grm_global)
  ), upd AS (
    UPDATE class_assignments ca SET subject_id = c.new_subject_id
      FROM tgt WHERE ca.id = tgt.id RETURNING ca.id
  )
  INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
  SELECT 'class_assignments','subject_id', tgt.id, tgt.old_sid, c.new_subject_id FROM tgt;

  -- exam_subjects: scope through exams.
  WITH tgt AS (
    SELECT es.id, es.subject_id AS old_sid
      FROM exam_subjects es JOIN exams e ON e.id = es.exam_id
     WHERE e.institution_id = c.ais AND es.subject_id IN (c.eng_global, c.grm_global)
  ), upd AS (
    UPDATE exam_subjects es SET subject_id = c.new_subject_id
      FROM tgt WHERE es.id = tgt.id RETURNING es.id
  )
  INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
  SELECT 'exam_subjects','subject_id', tgt.id, tgt.old_sid, c.new_subject_id FROM tgt;

  -- homework_assignment_subjects: scope through homework_assignments.
  WITH tgt AS (
    SELECT hs.id, hs.subject_id AS old_sid
      FROM homework_assignment_subjects hs
      JOIN homework_assignments h ON h.id = hs.homework_assignment_id
     WHERE h.institution_id = c.ais AND hs.subject_id IN (c.eng_global, c.grm_global)
  ), upd AS (
    UPDATE homework_assignment_subjects hs SET subject_id = c.new_subject_id
      FROM tgt WHERE hs.id = tgt.id RETURNING hs.id
  )
  INSERT INTO salci_backups.ais_c3_english_merge_20261006_moves(tbl,col,row_id,old_value,new_value)
  SELECT 'homework_assignment_subjects','subject_id', tgt.id, tgt.old_sid, c.new_subject_id FROM tgt;
END
$repoint$;

-- ---------------------------------------------------------------------
-- 10. Unmap the two globals from Alliance's Class 3 (2026-27 ONLY).
--     The AFTER DELETE fanout trigger clears subject_class_mappings for the
--     three sections. The global universal_subjects rows are NOT touched, so
--     the other five schools keep both subjects exactly as they are.
--     The 2025-26 mapping is deliberately left in place.
-- ---------------------------------------------------------------------
DELETE FROM subject_class_group_mappings m
USING salci_backups.ais_c3_english_merge_20261006_ctx c
WHERE m.class_group_id = c.cg3
  AND m.subject_id IN (c.eng_global, c.grm_global);

-- ---------------------------------------------------------------------
-- 11. Map the new subject to Class 3. Must come after step 10.
-- ---------------------------------------------------------------------
INSERT INTO subject_class_group_mappings (institution_id, class_group_id, subject_id, is_optional)
SELECT c.ais, c.cg3, c.new_subject_id, false
FROM salci_backups.ais_c3_english_merge_20261006_ctx c;

-- ---------------------------------------------------------------------
-- 11b. Restore the guards suspended in step 7b.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        ENABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments ENABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 12. Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  c record; n int; chapters int; sections int;
BEGIN
  SELECT * INTO c FROM salci_backups.ais_c3_english_merge_20261006_ctx;

  -- Never commit with a safety trigger left disabled.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('prevent_subject_link_change_after_publish','homework_assignments_edit_lock')
     AND tgenabled <> 'O';
  IF n > 0 THEN
    RAISE EXCEPTION 'Verify failed: % edit-lock trigger(s) are still disabled.', n;
  END IF;

  -- The globals must survive untouched and still serve the other schools.
  IF NOT EXISTS (SELECT 1 FROM universal_subjects
                  WHERE id = c.eng_global AND institution_id IS NULL AND name = 'English') THEN
    RAISE EXCEPTION 'Verify failed: the global English subject was altered.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM universal_subjects
                  WHERE id = c.grm_global AND institution_id IS NULL AND name = 'English Grammar') THEN
    RAISE EXCEPTION 'Verify failed: the global English Grammar subject was altered.';
  END IF;

  -- Compared against the pre-change backup rather than a hardcoded number, so
  -- the check stays correct if a school is added or removed later.
  SELECT count(*) INTO n FROM subject_class_group_mappings m
   JOIN class_groups g ON g.id = m.class_group_id
   WHERE m.subject_id IN (c.eng_global, c.grm_global) AND g.institution_id <> c.ais;
  SELECT count(*) INTO sections FROM salci_backups.ais_c3_english_merge_20261006_scgm b
   JOIN class_groups g ON g.id = b.class_group_id
   WHERE g.institution_id <> c.ais;
  IF n <> sections THEN
    RAISE EXCEPTION 'Verify failed: other schools held % mappings before and % after.', sections, n;
  END IF;

  -- Alliance must no longer reference either global anywhere that matters.
  SELECT (SELECT count(*) FROM question_bank WHERE subject_id IN (c.eng_global,c.grm_global) AND institution_id = c.ais)
       + (SELECT count(*) FROM syllabus_topics WHERE subject_id IN (c.eng_global,c.grm_global) AND institution_id = c.ais)
       + (SELECT count(*) FROM homework_assignments WHERE subject_id IN (c.eng_global,c.grm_global) AND institution_id = c.ais)
       + (SELECT count(*) FROM study_materials WHERE subject_id IN (c.eng_global,c.grm_global) AND institution_id = c.ais)
       + (SELECT count(*) FROM tt_slots WHERE subject_id IN (c.eng_global,c.grm_global) AND institution_id = c.ais)
    INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Verify failed: % Alliance row(s) still point at a global subject.', n;
  END IF;

  -- The merged subject exists, is mapped, and the fanout reached all sections.
  SELECT count(*) INTO n FROM subject_class_group_mappings
   WHERE class_group_id = c.cg3 AND subject_id = c.new_subject_id;
  IF n <> 1 THEN RAISE EXCEPTION 'Verify failed: new subject not mapped to Class 3.'; END IF;

  SELECT count(*) INTO sections FROM subject_class_mappings scm
    JOIN classes cl ON cl.id = scm.class_id
   WHERE scm.subject_id = c.new_subject_id AND cl.class_group_id = c.cg3;
  IF sections <> (SELECT count(*) FROM classes WHERE class_group_id = c.cg3) THEN
    RAISE EXCEPTION 'Verify failed: fanout reached % of % sections.',
      sections, (SELECT count(*) FROM classes WHERE class_group_id = c.cg3);
  END IF;

  -- Every planned chapter landed exactly once.
  SELECT count(*) INTO chapters FROM syllabus_topics WHERE subject_id = c.new_subject_id;
  IF chapters <> (SELECT count(*) FROM salci_backups.ais_c3_english_merge_20261006_chapters) THEN
    RAISE EXCEPTION 'Verify failed: merged subject holds % chapters, plan had %.',
      chapters, (SELECT count(*) FROM salci_backups.ais_c3_english_merge_20261006_chapters);
  END IF;

  -- No Alliance row may still point at a shared chapter.
  SELECT count(*) INTO n FROM question_bank q
   WHERE q.institution_id = c.ais
     AND q.topic_id IN (SELECT old_topic_id FROM salci_backups.ais_c3_english_merge_20261006_chapters
                         WHERE was_global);
  IF n > 0 THEN
    RAISE EXCEPTION 'Verify failed: % Alliance question(s) still sit on a shared chapter.', n;
  END IF;

  -- Teachers kept their access: one row per section, nobody dropped.
  SELECT count(DISTINCT ca.user_id) INTO n FROM class_assignments ca
    JOIN classes cl ON cl.id = ca.class_id
   WHERE ca.subject_id = c.new_subject_id AND cl.class_group_id = c.cg3;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Verify failed: expected 2 teachers on the merged subject, found %.', n;
  END IF;

  -- display_order must be a clean 1..n run.
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM syllabus_topics WHERE subject_id = c.new_subject_id
     GROUP BY subject_id
    HAVING count(*) <> max(display_order) OR count(DISTINCT display_order) <> count(*)) x;
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: chapter ordering is broken.'; END IF;

  RAISE NOTICE 'Verified: % chapters, % sections, globals intact.', chapters, sections;
END
$verify$;

COMMIT;
