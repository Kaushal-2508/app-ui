-- =====================================================================
-- Alliance International School (AISB) - Social Science becomes SST
-- Institution : 8af718c6-ca11-482b-9d6b-832f2b767928
-- Written     : 2026-09-07
--
-- TWO DIFFERENT JOBS, because the two classes are not in the same state:
--
--   Class 10 (2026-27) really does carry four separate subjects
--            (Geography, History, Civics, Economics). They are merged
--            into ONE subject named "SST".
--
--   Class 9  (2026-27) already carries a single "Social Science" (SOCI9,
--            11 chapters). There is nothing to merge there - it is only
--            renamed to "SST". Its chapters are left exactly as they are.
--
-- Then teachers are reconciled to the roster the school gave us. That
-- step REMOVES two people from sections they hold today - see step 10.
--
-- Reversible from salci_backups.ais_sst_merge_20260907_*.
-- Apply with:
--   scripts/run-sql.ps1 -SqlFile scripts/merge-ais-sst-class9-10-20260907.sql
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';

CREATE SCHEMA IF NOT EXISTS salci_backups;

-- ---------------------------------------------------------------------
-- 1. The Class 10 merge plan. ord = order inside the merged subject.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_map;
CREATE TABLE salci_backups.ais_sst_merge_20260907_map (
  class_group_id uuid    NOT NULL,
  subject_id     uuid    NOT NULL,
  survivor_id    uuid    NOT NULL,
  target_name    text    NOT NULL,
  target_code    text    NOT NULL,
  book_label     text,
  ord            int     NOT NULL,
  is_survivor    boolean NOT NULL
);

INSERT INTO salci_backups.ais_sst_merge_20260907_map
  (class_group_id, subject_id, survivor_id, target_name, target_code, book_label, ord, is_survivor)
VALUES
  -- Class 10 (2026-27). Survivor is Economics: it holds 1,496 of the ~1,656
  -- questions, so electing it moves the fewest rows.
  ('89f0fafe-697f-4965-b22e-afacc0d71e6d','0793973d-0af4-4e3a-93e3-0c265413a3f0','bd32357e-c161-4052-abdf-a267b5139644','SST','SST10','Geography',1,false),
  ('89f0fafe-697f-4965-b22e-afacc0d71e6d','7ecd4218-43e2-4183-b063-db9fc6407920','bd32357e-c161-4052-abdf-a267b5139644','SST','SST10','History',  2,false),
  ('89f0fafe-697f-4965-b22e-afacc0d71e6d','e737ee46-b195-4285-ae69-a5424cc10d58','bd32357e-c161-4052-abdf-a267b5139644','SST','SST10','Civics',   3,false),
  ('89f0fafe-697f-4965-b22e-afacc0d71e6d','bd32357e-c161-4052-abdf-a267b5139644','bd32357e-c161-4052-abdf-a267b5139644','SST','SST10','Economics',4,true );

-- Class 9 is a pure rename, so it is NOT in the merge map. Recorded here
-- only so the rollback manifest carries its original name and code.
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_rename;
CREATE TABLE salci_backups.ais_sst_merge_20260907_rename AS
SELECT us.id AS subject_id, us.name AS old_name, us.code AS old_code,
       'SST'::text AS new_name, 'SST9'::text AS new_code
FROM universal_subjects us
WHERE us.id = '8b420f28-31f5-45e9-9629-5a2cacb4bbde';

-- ---------------------------------------------------------------------
-- 2. The staff roster the school specified, as data.
--    This set IS the spec: step 10 makes reality match it exactly.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_staff_target;
CREATE TABLE salci_backups.ais_sst_merge_20260907_staff_target (
  class_id   uuid NOT NULL,
  subject_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  label      text NOT NULL
);
INSERT INTO salci_backups.ais_sst_merge_20260907_staff_target VALUES
  ('81f44cfa-2e04-434b-b56d-412feabb286c','8b420f28-31f5-45e9-9629-5a2cacb4bbde','9ecfe83b-9234-4487-b1c1-89a2d7243cfa','Class 9 A / Simrat Kaur Narang'),
  ('18e75e53-af3f-4114-86be-7cff85cad8c0','8b420f28-31f5-45e9-9629-5a2cacb4bbde','9a391dde-8abd-4576-876d-4f182be26e30','Class 9 B / Manjit kaur'),
  ('07221029-2c48-479e-afa9-500b2115912f','8b420f28-31f5-45e9-9629-5a2cacb4bbde','9a391dde-8abd-4576-876d-4f182be26e30','Class 9 C / Manjit kaur'),
  ('eed97e1c-4dc4-46e5-aef2-89f9b40f4a72','bd32357e-c161-4052-abdf-a267b5139644','18035ac0-043a-4f48-904a-f69c661c4ca0','Class 10 Golden / Romy Ahuja'),
  ('4c42a97a-3360-415c-b951-19a1ff3d812b','bd32357e-c161-4052-abdf-a267b5139644','9a391dde-8abd-4576-876d-4f182be26e30','Class 10 Silver / Manjit kaur'),
  ('7efe2014-24f8-40cd-a13e-e6378f9f536b','bd32357e-c161-4052-abdf-a267b5139644','9a391dde-8abd-4576-876d-4f182be26e30','Class 10 Gem / Manjit kaur');

-- ---------------------------------------------------------------------
-- 3. Guard rails - refuse to run if reality has drifted from the audit
-- ---------------------------------------------------------------------
DO $guard$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM salci_backups.ais_sst_merge_20260907_map m
  WHERE NOT EXISTS (SELECT 1 FROM universal_subjects us WHERE us.id = m.subject_id);
  IF n > 0 THEN RAISE EXCEPTION 'Aborting: % merge subject(s) no longer exist.', n; END IF;

  SELECT count(*) INTO n FROM salci_backups.ais_sst_merge_20260907_map m
  JOIN universal_subjects us ON us.id = m.subject_id
  WHERE us.institution_id IS DISTINCT FROM '8af718c6-ca11-482b-9d6b-832f2b767928'::uuid;
  IF n > 0 THEN RAISE EXCEPTION 'Aborting: % subject(s) are not Alliance subjects.', n; END IF;

  SELECT count(*) INTO n FROM salci_backups.ais_sst_merge_20260907_map m
  WHERE NOT EXISTS (SELECT 1 FROM subject_class_group_mappings sgm
                    WHERE sgm.subject_id = m.subject_id AND sgm.class_group_id = m.class_group_id);
  IF n > 0 THEN RAISE EXCEPTION 'Aborting: % subject(s) left their expected class group.', n; END IF;

  -- Class 9 must still be the single-subject case this script assumes
  SELECT count(*) INTO n FROM subject_class_group_mappings sgm
  JOIN universal_subjects us ON us.id = sgm.subject_id
  WHERE sgm.class_group_id = '41e0a701-bdda-403b-bf4d-003aaffa605b'
    AND us.name IN ('Geography','History','Civics','Economics');
  IF n > 0 THEN
    RAISE EXCEPTION 'Aborting: Class 9 now has % split social subject(s); it needs a merge, not a rename.', n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM universal_subjects
                 WHERE id='8b420f28-31f5-45e9-9629-5a2cacb4bbde' AND name='Social Science') THEN
    RAISE EXCEPTION 'Aborting: the Class 9 subject is not the "Social Science" row this script expects.';
  END IF;

  -- the target codes must be free (partial unique index on active institute codes)
  SELECT count(*) INTO n FROM universal_subjects
  WHERE institution_id='8af718c6-ca11-482b-9d6b-832f2b767928' AND is_active
    AND upper(btrim(coalesce(code,''))) IN ('SST9','SST10')
    AND id NOT IN ('8b420f28-31f5-45e9-9629-5a2cacb4bbde','bd32357e-c161-4052-abdf-a267b5139644');
  IF n > 0 THEN RAISE EXCEPTION 'Aborting: code SST9/SST10 is already taken by % other subject(s).', n; END IF;

  -- every teacher and section named in the roster must exist
  SELECT count(*) INTO n FROM salci_backups.ais_sst_merge_20260907_staff_target t
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id=t.user_id)
     OR NOT EXISTS (SELECT 1 FROM classes c  WHERE c.id=t.class_id);
  IF n > 0 THEN RAISE EXCEPTION 'Aborting: % roster row(s) name a missing teacher or section.', n; END IF;

  RAISE NOTICE 'Guard rails passed.';
END
$guard$;

-- ---------------------------------------------------------------------
-- 4. Backups, taken BEFORE anything changes
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_subjects;
CREATE TABLE salci_backups.ais_sst_merge_20260907_subjects AS
SELECT us.* FROM universal_subjects us
WHERE us.id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map)
   OR us.id = '8b420f28-31f5-45e9-9629-5a2cacb4bbde';

DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_scgm;
CREATE TABLE salci_backups.ais_sst_merge_20260907_scgm AS
SELECT * FROM subject_class_group_mappings
WHERE subject_id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map);

DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_scm;
CREATE TABLE salci_backups.ais_sst_merge_20260907_scm AS
SELECT * FROM subject_class_mappings
WHERE subject_id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map);

-- Every teacher row on any affected subject, so step 10 is reversible.
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_staff_before;
CREATE TABLE salci_backups.ais_sst_merge_20260907_staff_before AS
SELECT ca.*, p.full_name, c.name AS class_name, c.section, us.name AS subject_name
FROM class_assignments ca
JOIN profiles p ON p.id = ca.user_id
JOIN classes c  ON c.id = ca.class_id
JOIN universal_subjects us ON us.id = ca.subject_id
WHERE ca.subject_id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map)
   OR ca.subject_id = '8b420f28-31f5-45e9-9629-5a2cacb4bbde';

-- Chapter plan. Captured now because the book label depends on the ORIGINAL
-- owning subject. Class 10 chapters carry no chapter_number and their
-- display_order is 1 almost everywhere, so created_at is the only reliable
-- within-book order.
DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_topics;
CREATE TABLE salci_backups.ais_sst_merge_20260907_topics AS
SELECT st.id            AS topic_id,
       st.subject_id    AS old_subject_id,
       m.survivor_id,
       m.ord,
       m.book_label,
       st.topic_name    AS old_topic_name,
       st.display_order AS old_display_order,
       row_number() OVER (PARTITION BY m.survivor_id
                          ORDER BY m.ord, st.created_at, st.topic_name)::int AS new_display_order
FROM salci_backups.ais_sst_merge_20260907_map m
JOIN syllabus_topics st ON st.subject_id = m.subject_id;

DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_moves;
CREATE TABLE salci_backups.ais_sst_merge_20260907_moves (
  tbl text NOT NULL, col text NOT NULL, row_id uuid NOT NULL,
  old_subject_id uuid NOT NULL, new_subject_id uuid NOT NULL
);

DROP TABLE IF EXISTS salci_backups.ais_sst_merge_20260907_deleted;
CREATE TABLE salci_backups.ais_sst_merge_20260907_deleted (
  tbl text NOT NULL, row_id uuid NOT NULL, subject_id uuid NOT NULL,
  reason text NOT NULL, payload jsonb NOT NULL
);

-- ---------------------------------------------------------------------
-- 5. Suspend the two publish/edit-lock guards for this transaction.
--    They reject any subject_id change on a locked exam or on homework
--    already visible to students. Both exist to stop teachers rewriting
--    published work; neither can tell that apart from an administrative
--    subject merge. Nothing about the exams or homework themselves
--    changes - only the subject row they point at.
--    Step 11 restores them; step 12 refuses to commit if either is off.
--    NOT session_replication_role, which would also silence the fanout
--    trigger that step 9's cascade cleanup depends on.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        DISABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments DISABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 6. Retitle the Class 10 chapters IN PLACE, before the repoint.
--    Prefixing first makes every title globally unique, so the repoint in
--    step 8 cannot trip uq(grade_level_id, subject_id, topic_name) even
--    transiently.
-- ---------------------------------------------------------------------
UPDATE syllabus_topics st
   SET topic_name = CASE
         WHEN t.book_label IS NULL OR btrim(t.book_label) = '' THEN t.old_topic_name
         ELSE t.book_label || ' - ' || t.old_topic_name
       END,
       display_order = t.new_display_order
  FROM salci_backups.ais_sst_merge_20260907_topics t
 WHERE st.id = t.topic_id;

-- ---------------------------------------------------------------------
-- 7. Dedupe. Remove rows that would collide on a unique constraint once
--    all four subjects point at the survivor. Keeper preference: the
--    survivor's own row, else the lowest book order.
-- ---------------------------------------------------------------------
DO $dedupe$
DECLARE
  d record;
  n bigint;
BEGIN
  FOR d IN
    SELECT * FROM (VALUES
      ('class_assignments',            'subject_id', 'c.user_id, c.class_id'),
      ('exam_subjects',                'subject_id', 'c.exam_id'),
      ('homework_assignment_subjects', 'subject_id', 'c.homework_assignment_id'),
      ('student_optional_enrollments', 'subject_id', 'c.student_id'),
      ('optional_group_subjects',      'subject_id', 'c.group_id'),
      ('syllabus_sequence',            'subject_id', 'c.class_id, c.topic_id'),
      ('syllabus_progress_events',     'subject_id', 'c.class_id, c.topic_id, c.date')
    ) AS x(tbl, col, keycols)
  LOOP
    EXECUTE format($f$
      WITH ranked AS (
        SELECT c.id,
               c.%1$I      AS subject_id,
               to_jsonb(c) AS payload,
               row_number() OVER (
                 PARTITION BY %2$s
                 ORDER BY m.is_survivor DESC, m.ord
               ) AS rn
          FROM public.%3$I c
          JOIN salci_backups.ais_sst_merge_20260907_map m ON m.subject_id = c.%1$I
      ), doomed AS (
        SELECT id, subject_id, payload FROM ranked WHERE rn > 1
      ), logged AS (
        INSERT INTO salci_backups.ais_sst_merge_20260907_deleted
          (tbl, row_id, subject_id, reason, payload)
        SELECT %4$L, id, subject_id, 'duplicate after merge', payload FROM doomed
        RETURNING row_id
      )
      DELETE FROM public.%3$I c USING logged l WHERE c.id = l.row_id
    $f$, d.col, d.keycols, d.tbl, d.tbl);

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'dedupe: removed % row(s) from %', n, d.tbl; END IF;
  END LOOP;
END
$dedupe$;

-- ---------------------------------------------------------------------
-- 8. Repoint every reference from the absorbed subjects to the survivor.
--    subject_class_group_mappings / subject_class_mappings are deliberately
--    NOT repointed: the survivor already owns its rows, and the absorbed
--    subjects' rows are cleared by cascade in step 9.
-- ---------------------------------------------------------------------
DO $repoint$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('syllabus_topics','subject_id'),              ('chapter_topics','subject_id'),
      ('question_bank','subject_id'),                ('study_materials','subject_id'),
      ('exam_subjects','subject_id'),                ('homework_assignments','subject_id'),
      ('homework_assignment_subjects','subject_id'), ('class_assignments','subject_id'),
      ('tt_slots','subject_id'),                     ('tt_lesson_plans','subject_id'),
      ('syllabus_progress_events','subject_id'),     ('syllabus_sequence','subject_id'),
      ('student_optional_enrollments','subject_id'), ('exam_templates','subject_id'),
      ('syllabus_segments','subject_id'),            ('optional_batches','subject_id'),
      ('optional_group_subjects','subject_id'),      ('school_custom_topics','subject_id'),
      ('grade_subject_assignments','subject_id'),    ('passport_subject_capabilities','subject_id'),
      ('student_remarks','subject_id'),              ('subjects','universal_subject_id'),
      ('class_aggregates','subject_id'),             ('concept_mastery','subject_id'),
      ('learning_actions','subject_id'),             ('task_links','subject_id')
    ) AS x(tbl, col)
  LOOP
    EXECUTE format($f$
      WITH upd AS (
        UPDATE public.%1$I c
           SET %2$I = m.survivor_id
          FROM salci_backups.ais_sst_merge_20260907_map m
         WHERE c.%2$I = m.subject_id
           AND m.subject_id <> m.survivor_id
        RETURNING c.id, m.subject_id AS old_id, m.survivor_id AS new_id
      )
      INSERT INTO salci_backups.ais_sst_merge_20260907_moves
        (tbl, col, row_id, old_subject_id, new_subject_id)
      SELECT %3$L, %4$L, id, old_id, new_id FROM upd
    $f$, t.tbl, t.col, t.tbl, t.col);

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'repointed % row(s) in %.%', n, t.tbl, t.col; END IF;
  END LOOP;
END
$repoint$;

-- ---------------------------------------------------------------------
-- 9a. Rename. Class 10's survivor and Class 9's existing subject both
--     become "SST", with codes that match.
-- ---------------------------------------------------------------------
UPDATE universal_subjects us
   SET name = m.target_name, code = m.target_code
  FROM (SELECT DISTINCT survivor_id, target_name, target_code
          FROM salci_backups.ais_sst_merge_20260907_map) m
 WHERE us.id = m.survivor_id;

UPDATE universal_subjects
   SET name = 'SST', code = 'SST9'
 WHERE id = '8b420f28-31f5-45e9-9629-5a2cacb4bbde';

-- ---------------------------------------------------------------------
-- 9b. Delete the emptied subjects. The FK cascade clears
--     subject_class_group_mappings, whose AFTER DELETE trigger
--     (fanout_subject_class_group_mapping) clears subject_class_mappings.
-- ---------------------------------------------------------------------
DELETE FROM universal_subjects us
 WHERE us.id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map
                  WHERE NOT is_survivor);

-- ---------------------------------------------------------------------
-- 10. Teacher reconciliation - make reality match the roster in step 2.
--     Scoped strictly to the six (section, SST) pairs, so no other
--     subject's staffing can be touched.
--
--     This REMOVES people. On today's data that is:
--       Ms Renu Yadav  loses Class 10 Silver (she keeps 4 rows elsewhere)
--       Komal          loses Class 10 Gem    (she keeps 3 rows elsewhere)
--     and ADDS Manjit kaur to Class 9 C, which has no SST teacher at all.
--     Every DELETE is captured automatically by the existing
--     trg_log_class_assignment_deletion into class_assignment_deletions.
-- ---------------------------------------------------------------------
DELETE FROM class_assignments ca
 WHERE ca.role = 'teacher'
   AND EXISTS (SELECT 1 FROM salci_backups.ais_sst_merge_20260907_staff_target t
                WHERE t.class_id = ca.class_id AND t.subject_id = ca.subject_id)
   AND NOT EXISTS (SELECT 1 FROM salci_backups.ais_sst_merge_20260907_staff_target t
                    WHERE t.class_id = ca.class_id AND t.subject_id = ca.subject_id
                      AND t.user_id = ca.user_id);

INSERT INTO class_assignments (user_id, class_id, subject_id, role)
SELECT t.user_id, t.class_id, t.subject_id, 'teacher'
  FROM salci_backups.ais_sst_merge_20260907_staff_target t
 WHERE NOT EXISTS (SELECT 1 FROM class_assignments ca
                    WHERE ca.user_id = t.user_id AND ca.class_id = t.class_id
                      AND ca.subject_id = t.subject_id);

-- ---------------------------------------------------------------------
-- 11. Restore the publish/edit-lock guards suspended in step 5.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        ENABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments ENABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 12. Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('prevent_subject_link_change_after_publish','homework_assignments_edit_lock')
     AND tgenabled <> 'O';
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % edit-lock trigger(s) still disabled.', n; END IF;

  SELECT count(*) INTO n FROM universal_subjects us
   JOIN salci_backups.ais_sst_merge_20260907_map m ON m.subject_id = us.id
  WHERE NOT m.is_survivor;
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % absorbed subject(s) still exist.', n; END IF;

  SELECT count(*) INTO n FROM subject_class_mappings scm
   WHERE scm.subject_id IN (SELECT subject_id FROM salci_backups.ais_sst_merge_20260907_map
                             WHERE NOT is_survivor);
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % stale subject_class_mappings row(s).', n; END IF;

  -- both classes must now expose exactly one subject named SST
  SELECT count(*) INTO n FROM (
    SELECT sgm.class_group_id
      FROM subject_class_group_mappings sgm
      JOIN universal_subjects us ON us.id = sgm.subject_id
     WHERE us.is_active AND us.name = 'SST'
       AND sgm.class_group_id IN ('89f0fafe-697f-4965-b22e-afacc0d71e6d',
                                  '41e0a701-bdda-403b-bf4d-003aaffa605b')
     GROUP BY sgm.class_group_id) x;
  IF n <> 2 THEN RAISE EXCEPTION 'Verify failed: expected SST in 2 class groups, found %.', n; END IF;

  -- no class group may hold two active subjects sharing a name
  SELECT count(*) INTO n FROM (
    SELECT sgm.class_group_id, lower(us.name)
      FROM subject_class_group_mappings sgm
      JOIN universal_subjects us ON us.id = sgm.subject_id
     WHERE us.is_active
       AND sgm.class_group_id IN ('89f0fafe-697f-4965-b22e-afacc0d71e6d',
                                  '41e0a701-bdda-403b-bf4d-003aaffa605b')
     GROUP BY sgm.class_group_id, lower(us.name) HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % duplicate subject name(s) in a class group.', n; END IF;

  -- Class 10 SST must have a clean 1..n chapter order
  SELECT count(*) INTO n FROM (
    SELECT st.subject_id FROM syllabus_topics st
     WHERE st.subject_id = 'bd32357e-c161-4052-abdf-a267b5139644'
     GROUP BY st.subject_id
    HAVING count(*) <> max(st.display_order) OR count(DISTINCT st.display_order) <> count(*)) x;
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: Class 10 SST chapter order is broken.'; END IF;

  -- staffing must match the roster EXACTLY on the six pairs
  SELECT count(*) INTO n FROM salci_backups.ais_sst_merge_20260907_staff_target t
   WHERE NOT EXISTS (SELECT 1 FROM class_assignments ca
                      WHERE ca.user_id=t.user_id AND ca.class_id=t.class_id
                        AND ca.subject_id=t.subject_id AND ca.role='teacher');
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % roster row(s) were not applied.', n; END IF;

  SELECT count(*) INTO n FROM class_assignments ca
   WHERE ca.role='teacher'
     AND EXISTS (SELECT 1 FROM salci_backups.ais_sst_merge_20260907_staff_target t
                  WHERE t.class_id=ca.class_id AND t.subject_id=ca.subject_id)
     AND NOT EXISTS (SELECT 1 FROM salci_backups.ais_sst_merge_20260907_staff_target t
                      WHERE t.class_id=ca.class_id AND t.subject_id=ca.subject_id
                        AND t.user_id=ca.user_id);
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % unexpected teacher row(s) survived.', n; END IF;

  -- nobody may be left with a teacher role and zero subject rows (§25:
  -- a subject-less teacher sees an entirely empty portal)
  SELECT count(*) INTO n FROM (
    SELECT DISTINCT sb.user_id
      FROM salci_backups.ais_sst_merge_20260907_staff_before sb
     WHERE NOT EXISTS (SELECT 1 FROM class_assignments ca
                        WHERE ca.user_id = sb.user_id AND ca.subject_id IS NOT NULL
                          AND ca.role = 'teacher')) x;
  IF n > 0 THEN RAISE EXCEPTION 'Verify failed: % teacher(s) left with no subject at all.', n; END IF;

  RAISE NOTICE 'Verified.';
END
$verify$;

COMMIT;
