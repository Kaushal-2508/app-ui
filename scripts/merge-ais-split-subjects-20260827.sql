-- =====================================================================
-- Alliance International School (AISB) - merge split textbook subjects
--
-- Source of truth : public/report_reference/SUBJECT LIST.pdf
-- Institution     : 8af718c6-ca11-482b-9d6b-832f2b767928
-- Written         : 2026-08-27
--
-- The school entered CBSE textbook PARTS as separate subjects, so one
-- syllabus is split across two entries (e.g. "English Reader : First
-- Flight" and "English : Footprints without feet" instead of one
-- "English"). This folds each pair/triple into ONE subject.
--
-- Per merge group:
--   1. snapshot every affected row into salci_backups.ais_subject_merge_20260827_*
--   2. delete rows that would violate a unique constraint after the merge
--      (same teacher on both halves, one exam/homework citing both halves)
--   3. repoint every subject_id from the absorbed subjects to the survivor
--   4. prefix each chapter title with its book, renumber display_order
--   5. rename the survivor to the merged name
--   6. delete the emptied subject rows (cascade clears their class mappings)
--
-- Reversible from the salci_backups.ais_subject_merge_20260827_* tables.
-- Apply with:
--   scripts/run-sql.ps1 -SqlFile scripts/merge-ais-split-subjects-20260827.sql
-- =====================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';

CREATE SCHEMA IF NOT EXISTS salci_backups;

-- ---------------------------------------------------------------------
-- 1. The merge plan
--    ord = book order inside the merged subject (main text, then reader)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_map;
CREATE TABLE salci_backups.ais_subject_merge_20260827_map (
  grp             text    NOT NULL,
  class_group_id  uuid    NOT NULL,
  subject_id      uuid    NOT NULL,
  survivor_id     uuid    NOT NULL,
  target_name     text    NOT NULL,
  book_label      text,
  ord             int     NOT NULL,
  is_survivor     boolean NOT NULL
);

INSERT INTO salci_backups.ais_subject_merge_20260827_map
  (grp, class_group_id, subject_id, survivor_id, target_name, book_label, ord, is_survivor)
VALUES
  -- Class 10 : English Reader : First Flight + English : Footprints  ->  English
  ('C10-ENG', '89f0fafe-697f-4965-b22e-afacc0d71e6d', 'e5dc4c66-de53-40e9-b58b-0d74721393b5', '098e09f3-c873-4ada-a489-45a9b6aff536', 'English',           'First Flight',                  1, false),
  ('C10-ENG', '89f0fafe-697f-4965-b22e-afacc0d71e6d', '098e09f3-c873-4ada-a489-45a9b6aff536', '098e09f3-c873-4ada-a489-45a9b6aff536', 'English',           'Footprints',                    2, true ),

  -- Class 10 : Hindi Sparsh + Hindi Sanchayan  ->  Hindi
  ('C10-HIN', '89f0fafe-697f-4965-b22e-afacc0d71e6d', 'c5439c1f-8e65-4e66-8c5e-9865b4eb1f8d', 'c5439c1f-8e65-4e66-8c5e-9865b4eb1f8d', 'Hindi',             'स्पर्श',                          1, true ),
  ('C10-HIN', '89f0fafe-697f-4965-b22e-afacc0d71e6d', '7da5645d-0dca-4653-9e93-cc3c50ad43dc', 'c5439c1f-8e65-4e66-8c5e-9865b4eb1f8d', 'Hindi',             'संचयन',                          2, false),

  -- Class 11 Commerce : Hornbill + Snapshots + English  ->  English Core
  ('C11C-ENG', 'e2b02115-c8db-490b-831c-a3e1ed7005eb', '5b220e18-b2c2-4586-bbe8-c6a760af5439', '4f000d23-23cd-4265-8af1-820486ebf576', 'English Core',     'Hornbill',                      1, false),
  ('C11C-ENG', 'e2b02115-c8db-490b-831c-a3e1ed7005eb', '10677e1f-4b22-4061-982b-6c357ee57e6e', '4f000d23-23cd-4265-8af1-820486ebf576', 'English Core',     'Snapshots',                     2, false),
  ('C11C-ENG', 'e2b02115-c8db-490b-831c-a3e1ed7005eb', '4f000d23-23cd-4265-8af1-820486ebf576', '4f000d23-23cd-4265-8af1-820486ebf576', 'English Core',     NULL,                            3, true ),

  -- Class 11 Humanities : Hornbill + Snapshots + English  ->  English Core
  ('C11H-ENG', '39d541c1-06d5-4a6b-a951-b98e04602d38', '5fcc0c24-36fa-4795-af9d-5ec13e6dada0', '4bbf7d9a-0951-4525-b6a8-45d96850ec24', 'English Core',     'Hornbill',                      1, false),
  ('C11H-ENG', '39d541c1-06d5-4a6b-a951-b98e04602d38', 'aafd6ae9-d78b-432f-9c5d-ea1c66639b1b', '4bbf7d9a-0951-4525-b6a8-45d96850ec24', 'English Core',     'Snapshots',                     2, false),
  ('C11H-ENG', '39d541c1-06d5-4a6b-a951-b98e04602d38', '4bbf7d9a-0951-4525-b6a8-45d96850ec24', '4bbf7d9a-0951-4525-b6a8-45d96850ec24', 'English Core',     NULL,                            3, true ),

  -- Class 11 Science : Hornbill + Snapshots  ->  English Core
  ('C11S-ENG', '483b1354-8601-4496-bef2-11ed31313f4f', '12a69dd2-b8b1-4b19-b8b5-bc1a3a700442', '12a69dd2-b8b1-4b19-b8b5-bc1a3a700442', 'English Core',     'Hornbill',                      1, true ),
  ('C11S-ENG', '483b1354-8601-4496-bef2-11ed31313f4f', '714e0da1-45cf-4524-b39a-699af5086bc5', '12a69dd2-b8b1-4b19-b8b5-bc1a3a700442', 'English Core',     'Snapshots',                     2, false),

  -- Class 11 Humanities : Indian Constitution at Work + Political Theory  ->  Political Science
  ('C11H-POL', '39d541c1-06d5-4a6b-a951-b98e04602d38', 'bb6693a7-d12e-4606-9f42-a58062d9759c', 'bb6693a7-d12e-4606-9f42-a58062d9759c', 'Political Science', 'Indian Constitution at Work',  1, true ),
  ('C11H-POL', '39d541c1-06d5-4a6b-a951-b98e04602d38', 'bec8c928-fcf5-48c0-9135-71c58c9f3888', 'bb6693a7-d12e-4606-9f42-a58062d9759c', 'Political Science', 'Political Theory',             2, false),

  -- Class 12 Commerce : Flamingo + Vistas + English Core  ->  English Core
  ('C12C-ENG', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', '78877ddd-e938-40f9-b5a6-0b722ef86e11', 'f1946e0e-32ca-4cf0-86d5-134ac543faa5', 'English Core',     'Flamingo',                      1, false),
  ('C12C-ENG', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', 'f1946e0e-32ca-4cf0-86d5-134ac543faa5', 'f1946e0e-32ca-4cf0-86d5-134ac543faa5', 'English Core',     'Vistas',                        2, true ),
  ('C12C-ENG', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', '406fefae-5c70-427f-bd37-e74c0d278f15', 'f1946e0e-32ca-4cf0-86d5-134ac543faa5', 'English Core',     NULL,                            3, false),

  -- Class 12 Humanities : Flamingo + Vistas + English  ->  English Core
  ('C12H-ENG', '0fc2b68d-55ca-4916-9321-e27dfb03346c', 'cdbda82d-068a-449c-8e9e-afe7c544008a', '5003271f-5ac0-433c-95e9-bbaa70f78a40', 'English Core',     'Flamingo',                      1, false),
  ('C12H-ENG', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '5003271f-5ac0-433c-95e9-bbaa70f78a40', '5003271f-5ac0-433c-95e9-bbaa70f78a40', 'English Core',     'Vistas',                        2, true ),
  ('C12H-ENG', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '516fe67d-329b-406b-bd10-dcedfa545e3c', '5003271f-5ac0-433c-95e9-bbaa70f78a40', 'English Core',     NULL,                            3, false),

  -- Class 12 Science : Flamingo + Vistas  ->  English Core
  ('C12S-ENG', 'e410f000-b23b-4f01-a2b0-10343e0ac69d', '5f6057bd-11a6-43a2-adf8-dcc3829771ad', 'bb6742cb-1c84-4926-b885-b353f4f34ec1', 'English Core',     'Flamingo',                      1, false),
  ('C12S-ENG', 'e410f000-b23b-4f01-a2b0-10343e0ac69d', 'bb6742cb-1c84-4926-b885-b353f4f34ec1', 'bb6742cb-1c84-4926-b885-b353f4f34ec1', 'English Core',     'Vistas',                        2, true ),

  -- Class 12 Commerce : Accountancy (Partnership) + Company Accounts  ->  Accountancy
  ('C12C-ACC', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', '7802427f-010e-4e17-a23a-5c0ba2838d4d', '7802427f-010e-4e17-a23a-5c0ba2838d4d', 'Accountancy',      'Part 1',                        1, true ),
  ('C12C-ACC', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', '6450f32d-43c9-463b-9c45-ff1f4aab26f8', '7802427f-010e-4e17-a23a-5c0ba2838d4d', 'Accountancy',      'Part 2',                        2, false),

  -- Class 12 Commerce : Business Studies part 1 + part 2  ->  Business Studies
  ('C12C-BUS', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', '7312315f-29b3-4ca1-beed-c95dfb06e604', '7312315f-29b3-4ca1-beed-c95dfb06e604', 'Business Studies', 'Part 1',                        1, true ),
  ('C12C-BUS', '4b2248fa-831d-47df-8ee2-e7a1722b39f6', 'dcb69e0e-1ba6-4337-b4bf-f3c657b12a05', '7312315f-29b3-4ca1-beed-c95dfb06e604', 'Business Studies', 'Part 2',                        2, false),

  -- Class 12 Humanities : Contemporary World Politics + Politics in India  ->  Political Science
  ('C12H-POL', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '94bbb22d-45e3-409b-9996-d8d286857462', '9c605771-d1ab-43e0-80a8-d8545cb81214', 'Political Science', 'Contemporary World Politics',  1, false),
  ('C12H-POL', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '9c605771-d1ab-43e0-80a8-d8545cb81214', '9c605771-d1ab-43e0-80a8-d8545cb81214', 'Political Science', 'Politics in India',            2, true ),

  -- Class 12 Humanities : Indian Society + Social Change and Development  ->  Sociology
  ('C12H-SOC', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '0267d26c-4a8e-4bd5-9324-304df47d695e', '0267d26c-4a8e-4bd5-9324-304df47d695e', 'Sociology',        'Indian Society',                1, true ),
  ('C12H-SOC', '0fc2b68d-55ca-4916-9321-e27dfb03346c', '08994969-2cdc-42ef-b94a-843d7084c2db', '0267d26c-4a8e-4bd5-9324-304df47d695e', 'Sociology',        'Social Change and Development', 2, false);

-- ---------------------------------------------------------------------
-- 2. Guard rails - refuse to run if reality has drifted from the audit
-- ---------------------------------------------------------------------
DO $guard$
DECLARE
  missing   int;
  wrong_ins int;
  wrong_cg  int;
  bad_surv  int;
BEGIN
  SELECT count(*) INTO missing
  FROM salci_backups.ais_subject_merge_20260827_map m
  WHERE NOT EXISTS (SELECT 1 FROM universal_subjects us WHERE us.id = m.subject_id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'Aborting: % subject(s) in the merge plan no longer exist.', missing;
  END IF;

  SELECT count(*) INTO wrong_ins
  FROM salci_backups.ais_subject_merge_20260827_map m
  JOIN universal_subjects us ON us.id = m.subject_id
  WHERE us.institution_id IS DISTINCT FROM '8af718c6-ca11-482b-9d6b-832f2b767928'::uuid;
  IF wrong_ins > 0 THEN
    RAISE EXCEPTION 'Aborting: % subject(s) do not belong to Alliance International School.', wrong_ins;
  END IF;

  SELECT count(*) INTO wrong_cg
  FROM salci_backups.ais_subject_merge_20260827_map m
  WHERE NOT EXISTS (
    SELECT 1 FROM subject_class_group_mappings sgm
    WHERE sgm.subject_id = m.subject_id AND sgm.class_group_id = m.class_group_id);
  IF wrong_cg > 0 THEN
    RAISE EXCEPTION 'Aborting: % subject(s) are no longer mapped to their expected class group.', wrong_cg;
  END IF;

  SELECT count(*) INTO bad_surv FROM (
    SELECT grp FROM salci_backups.ais_subject_merge_20260827_map
    GROUP BY grp
    HAVING count(*) FILTER (WHERE is_survivor) <> 1
        OR count(DISTINCT survivor_id) <> 1
  ) x;
  IF bad_surv > 0 THEN
    RAISE EXCEPTION 'Aborting: % merge group(s) have a malformed survivor.', bad_surv;
  END IF;

  RAISE NOTICE 'Guard rails passed: % subjects across % merge groups.',
    (SELECT count(*) FROM salci_backups.ais_subject_merge_20260827_map),
    (SELECT count(DISTINCT grp) FROM salci_backups.ais_subject_merge_20260827_map);
END
$guard$;

-- ---------------------------------------------------------------------
-- 3. Backups, taken BEFORE anything changes
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_subjects;
CREATE TABLE salci_backups.ais_subject_merge_20260827_subjects AS
SELECT us.* FROM universal_subjects us
WHERE us.id IN (SELECT subject_id FROM salci_backups.ais_subject_merge_20260827_map);

DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_scgm;
CREATE TABLE salci_backups.ais_subject_merge_20260827_scgm AS
SELECT * FROM subject_class_group_mappings
WHERE subject_id IN (SELECT subject_id FROM salci_backups.ais_subject_merge_20260827_map);

DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_scm;
CREATE TABLE salci_backups.ais_subject_merge_20260827_scm AS
SELECT * FROM subject_class_mappings
WHERE subject_id IN (SELECT subject_id FROM salci_backups.ais_subject_merge_20260827_map);

-- Chapter plan. Captured now because the book label depends on the ORIGINAL
-- owning subject, which step 5 overwrites. created_at is the only reliable
-- within-book order: display_order is 1 almost everywhere and chapter_number
-- is NULL for all 216 chapters in scope.
DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_topics;
CREATE TABLE salci_backups.ais_subject_merge_20260827_topics AS
SELECT st.id            AS topic_id,
       st.subject_id    AS old_subject_id,
       m.survivor_id,
       m.grp,
       m.ord,
       m.book_label,
       st.topic_name    AS old_topic_name,
       st.display_order AS old_display_order,
       row_number() OVER (PARTITION BY m.survivor_id
                          ORDER BY m.ord, st.created_at, st.topic_name)::int AS new_display_order
FROM salci_backups.ais_subject_merge_20260827_map m
JOIN syllabus_topics st ON st.subject_id = m.subject_id;

DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_moves;
CREATE TABLE salci_backups.ais_subject_merge_20260827_moves (
  tbl            text NOT NULL,
  col            text NOT NULL,
  row_id         uuid NOT NULL,
  old_subject_id uuid NOT NULL,
  new_subject_id uuid NOT NULL
);

DROP TABLE IF EXISTS salci_backups.ais_subject_merge_20260827_deleted;
CREATE TABLE salci_backups.ais_subject_merge_20260827_deleted (
  tbl        text  NOT NULL,
  row_id     uuid  NOT NULL,
  subject_id uuid  NOT NULL,
  reason     text  NOT NULL,
  payload    jsonb NOT NULL
);

-- ---------------------------------------------------------------------
-- 3b. Suspend the two publish/edit-lock guards for this transaction.
--
--     exam_subjects.prevent_subject_link_change_after_publish blocks ANY
--     change to a locked exam's subject links, and
--     homework_assignments.homework_assignments_edit_lock blocks subject_id
--     changes on homework already visible to students. Both exist to stop
--     teachers rewriting published work; neither can tell the difference
--     between that and an administrative subject merge.
--
--     Nothing about the exam or the homework itself changes here: questions,
--     marks, sections, attachments, due dates and attempts are untouched.
--     Only the subject row they point at is folded into its merged twin.
--
--     These are ALTER TABLE statements, so they are transactional: if any
--     later step raises, the triggers come back with the rollback. Step 8b
--     restores them explicitly and step 9 refuses to commit unless both are
--     enabled again. Do NOT reach for session_replication_role here - it
--     would silence every trigger on every table, including the fanout that
--     step 8 depends on.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        DISABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments DISABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 4. Dedupe. Remove rows that would collide on a unique constraint once
--    both halves point at the same subject. Keeper preference: the
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
      ('optional_group_subjects',      'subject_id', 'c.group_id')
    ) AS x(tbl, col, keycols)
  LOOP
    EXECUTE format($f$
      WITH ranked AS (
        SELECT c.id,
               c.%1$I      AS subject_id,
               to_jsonb(c) AS payload,
               row_number() OVER (
                 PARTITION BY m.grp, %2$s
                 ORDER BY m.is_survivor DESC, m.ord
               ) AS rn
          FROM public.%3$I c
          JOIN salci_backups.ais_subject_merge_20260827_map m
            ON m.subject_id = c.%1$I
      ), doomed AS (
        SELECT id, subject_id, payload FROM ranked WHERE rn > 1
      ), logged AS (
        INSERT INTO salci_backups.ais_subject_merge_20260827_deleted
          (tbl, row_id, subject_id, reason, payload)
        SELECT %4$L, id, subject_id, 'duplicate after merge', payload FROM doomed
        RETURNING row_id
      )
      DELETE FROM public.%3$I c USING logged l WHERE c.id = l.row_id
    $f$, d.col, d.keycols, d.tbl, d.tbl);

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'dedupe: removed % duplicate row(s) from %', n, d.tbl;
    END IF;
  END LOOP;
END
$dedupe$;

-- ---------------------------------------------------------------------
-- 5. Repoint every reference from the absorbed subjects to the survivor.
--    subject_class_group_mappings / subject_class_mappings are deliberately
--    NOT repointed: the survivor already owns its rows, and the absorbed
--    subjects' rows are cleared by cascade in step 8.
-- ---------------------------------------------------------------------
DO $repoint$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('syllabus_topics',              'subject_id'),
      ('chapter_topics',               'subject_id'),
      ('question_bank',                'subject_id'),
      ('study_materials',              'subject_id'),
      ('exam_subjects',                'subject_id'),
      ('homework_assignments',         'subject_id'),
      ('homework_assignment_subjects', 'subject_id'),
      ('class_assignments',            'subject_id'),
      ('tt_slots',                     'subject_id'),
      ('tt_lesson_plans',              'subject_id'),
      ('syllabus_progress_events',     'subject_id'),
      ('syllabus_sequence',            'subject_id'),
      ('student_optional_enrollments', 'subject_id'),
      ('exam_templates',               'subject_id'),
      ('syllabus_segments',            'subject_id'),
      ('optional_batches',             'subject_id'),
      ('optional_group_subjects',      'subject_id'),
      ('school_custom_topics',         'subject_id'),
      ('grade_subject_assignments',    'subject_id'),
      ('passport_subject_capabilities','subject_id'),
      ('student_remarks',              'subject_id'),
      ('subjects',                     'universal_subject_id'),
      ('class_aggregates',             'subject_id'),
      ('concept_mastery',              'subject_id'),
      ('learning_actions',             'subject_id'),
      ('task_links',                   'subject_id')
    ) AS x(tbl, col)
  LOOP
    EXECUTE format($f$
      WITH upd AS (
        UPDATE public.%1$I c
           SET %2$I = m.survivor_id
          FROM salci_backups.ais_subject_merge_20260827_map m
         WHERE c.%2$I = m.subject_id
           AND m.subject_id <> m.survivor_id
        RETURNING c.id, m.subject_id AS old_id, m.survivor_id AS new_id
      )
      INSERT INTO salci_backups.ais_subject_merge_20260827_moves
        (tbl, col, row_id, old_subject_id, new_subject_id)
      SELECT %3$L, %4$L, id, old_id, new_id FROM upd
    $f$, t.tbl, t.col, t.tbl, t.col);

    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'repointed % row(s) in %.%', n, t.tbl, t.col;
    END IF;
  END LOOP;
END
$repoint$;

-- ---------------------------------------------------------------------
-- 6. Chapter titles and ordering.
--    Chapters from a named textbook become "<Book> - <original title>".
--    Chapters from a generically named subject keep their title as-is,
--    because there is no book name to attribute them to.
-- ---------------------------------------------------------------------
UPDATE syllabus_topics st
   SET topic_name = CASE
         WHEN t.book_label IS NULL OR btrim(t.book_label) = '' THEN t.old_topic_name
         ELSE t.book_label || ' - ' || t.old_topic_name
       END,
       display_order = t.new_display_order
  FROM salci_backups.ais_subject_merge_20260827_topics t
 WHERE st.id = t.topic_id;

-- ---------------------------------------------------------------------
-- 7. Rename the survivors to the merged subject name
-- ---------------------------------------------------------------------
UPDATE universal_subjects us
   SET name = m.target_name
  FROM (SELECT DISTINCT survivor_id, target_name
          FROM salci_backups.ais_subject_merge_20260827_map) m
 WHERE us.id = m.survivor_id
   AND us.name IS DISTINCT FROM m.target_name;

-- ---------------------------------------------------------------------
-- 8. Delete the emptied subjects. The FK cascade clears
--    subject_class_group_mappings, whose AFTER DELETE trigger
--    (fanout_subject_class_group_mapping) clears subject_class_mappings.
-- ---------------------------------------------------------------------
DELETE FROM universal_subjects us
 WHERE us.id IN (
   SELECT subject_id FROM salci_backups.ais_subject_merge_20260827_map
    WHERE NOT is_survivor
 );

-- ---------------------------------------------------------------------
-- 8b. Restore the publish/edit-lock guards suspended in step 3b.
-- ---------------------------------------------------------------------
ALTER TABLE public.exam_subjects        ENABLE TRIGGER prevent_subject_link_change_after_publish;
ALTER TABLE public.homework_assignments ENABLE TRIGGER homework_assignments_edit_lock;

-- ---------------------------------------------------------------------
-- 9. Post-conditions. Any failure rolls the whole transaction back.
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  leftovers int;
  dup_names int;
  unmapped  int;
  bad_order int;
  orphan_scm int;
  off_triggers int;
BEGIN
  -- never commit with a safety trigger left disabled
  SELECT count(*) INTO off_triggers
  FROM pg_trigger t
  WHERE t.tgname IN ('prevent_subject_link_change_after_publish',
                     'homework_assignments_edit_lock')
    AND t.tgenabled <> 'O';
  IF off_triggers > 0 THEN
    RAISE EXCEPTION 'Verify failed: % edit-lock trigger(s) are still disabled.', off_triggers;
  END IF;

  SELECT count(*) INTO leftovers
  FROM universal_subjects us
  JOIN salci_backups.ais_subject_merge_20260827_map m ON m.subject_id = us.id
  WHERE NOT m.is_survivor;
  IF leftovers > 0 THEN
    RAISE EXCEPTION 'Verify failed: % absorbed subject(s) still exist.', leftovers;
  END IF;

  -- no class group may end up with two active subjects sharing a name
  SELECT count(*) INTO dup_names FROM (
    SELECT sgm.class_group_id, lower(us.name)
      FROM subject_class_group_mappings sgm
      JOIN universal_subjects us ON us.id = sgm.subject_id
     WHERE us.is_active
       AND sgm.class_group_id IN (
             SELECT DISTINCT class_group_id FROM salci_backups.ais_subject_merge_20260827_map)
     GROUP BY sgm.class_group_id, lower(us.name)
    HAVING count(*) > 1
  ) x;
  IF dup_names > 0 THEN
    RAISE EXCEPTION 'Verify failed: % duplicate subject name(s) inside a class group.', dup_names;
  END IF;

  -- every survivor must still be mapped to its class group
  SELECT count(*) INTO unmapped FROM (
    SELECT DISTINCT m.survivor_id, m.class_group_id
      FROM salci_backups.ais_subject_merge_20260827_map m
     WHERE NOT EXISTS (
       SELECT 1 FROM subject_class_group_mappings sgm
        WHERE sgm.subject_id = m.survivor_id AND sgm.class_group_id = m.class_group_id)
  ) x;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'Verify failed: % survivor(s) lost their class group mapping.', unmapped;
  END IF;

  -- the fanout trigger must have cleared the absorbed subjects' section rows
  SELECT count(*) INTO orphan_scm
  FROM subject_class_mappings scm
  WHERE scm.subject_id IN (
    SELECT subject_id FROM salci_backups.ais_subject_merge_20260827_map WHERE NOT is_survivor);
  IF orphan_scm > 0 THEN
    RAISE EXCEPTION 'Verify failed: % stale subject_class_mappings row(s) remain.', orphan_scm;
  END IF;

  -- display_order must be a clean 1..n run inside each merged subject
  SELECT count(*) INTO bad_order FROM (
    SELECT st.subject_id
      FROM syllabus_topics st
     WHERE st.subject_id IN (
             SELECT DISTINCT survivor_id FROM salci_backups.ais_subject_merge_20260827_map)
     GROUP BY st.subject_id
    HAVING count(*) <> max(st.display_order)
        OR count(DISTINCT st.display_order) <> count(*)
  ) x;
  IF bad_order > 0 THEN
    RAISE EXCEPTION 'Verify failed: % merged subject(s) have a broken chapter order.', bad_order;
  END IF;

  RAISE NOTICE 'Verified: % merged subjects, % chapters, % rows repointed, % duplicate rows removed.',
    (SELECT count(DISTINCT survivor_id) FROM salci_backups.ais_subject_merge_20260827_map),
    (SELECT count(*) FROM salci_backups.ais_subject_merge_20260827_topics),
    (SELECT count(*) FROM salci_backups.ais_subject_merge_20260827_moves),
    (SELECT count(*) FROM salci_backups.ais_subject_merge_20260827_deleted);
END
$verify$;

COMMIT;
