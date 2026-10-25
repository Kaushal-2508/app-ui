-- Repair lesson-plan rows that claim "done" with nothing logged (2026-09-29).
--
-- Every "lessons taught / marked done" reader (coordinator console, Command
-- Center activity and composite, teacher tables, teacher badges, coverage)
-- trusts tt_lesson_plans.status = 'done' on a teaching row. Since the syllabus
-- log went live (2026-07-04) such a row is only true when the log has an entry
-- for that class + subject + day. Two kinds were not:
--
--   A. 'done' teaching rows with NO syllabus entry that day (148 on 2026-09-29).
--      Most were period notes ("Holiday due to Innovista", "PTM") saved back as
--      teaching rows that kept the note's status (useUpsertLessonPlan copied the
--      prior status; fixed in the frontend the same day).
--        A1. still carrying the note text, no chapter -> back to a note-only row
--            (what the teacher wrote; the day then counts as logged)
--        A2. the rest -> 'planned' (nothing records a delivery)
--   B. 'done' rows naming a chapter the log does not show completed that day
--      (1 row). Re-pointed to the chapter the log DOES show completed that day
--      when that chapter has no done period of its own, else -> 'planned'.
--
-- Backup first: salci_backups.lesson_plans_false_done_20260929 holds every
-- touched row as it was. Rollback:
--   UPDATE public.tt_lesson_plans lp SET status = b.status, session_type = b.session_type,
--          is_note_only = b.is_note_only, topic_id = b.topic_id, updated_at = b.updated_at
--     FROM salci_backups.lesson_plans_false_done_20260929 b WHERE lp.id = b.id;
--
-- The period-note audit trigger records each A1 row as a note created by
-- "system", which is true: the repair restored it.

CREATE SCHEMA IF NOT EXISTS salci_backups;

CREATE TEMP TABLE _fix ON COMMIT DROP AS
WITH done_rows AS (
  SELECT lp.* FROM public.tt_lesson_plans lp
   WHERE lp.status = 'done' AND lp.session_type = 'teaching' AND NOT lp.is_note_only
     AND lp.date >= '2026-07-04'
)
SELECT d.id,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                           WHERE e.class_id = d.class_id AND e.subject_id = d.subject_id AND e.date = d.date)
         THEN CASE WHEN d.topic_id IS NULL AND d.chapter_topic_id IS NULL
                        AND d.note IS NOT NULL AND btrim(d.note) <> '' THEN 'A1_note' ELSE 'A2_planned' END
         WHEN d.topic_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                           WHERE e.class_id = d.class_id AND e.subject_id = d.subject_id AND e.date = d.date
                             AND e.topic_id = d.topic_id AND e.action = 'completed')
         THEN 'B_wrong_chapter'
       END AS kind
  FROM done_rows d;
DELETE FROM _fix WHERE kind IS NULL;

DROP TABLE IF EXISTS salci_backups.lesson_plans_false_done_20260929;
CREATE TABLE salci_backups.lesson_plans_false_done_20260929 AS
  SELECT lp.*, f.kind AS repair_kind FROM public.tt_lesson_plans lp JOIN _fix f ON f.id = lp.id;
REVOKE ALL ON salci_backups.lesson_plans_false_done_20260929 FROM PUBLIC, anon, authenticated;

-- A1: back to the note the teacher wrote.
UPDATE public.tt_lesson_plans lp
   SET is_note_only = true, session_type = 'other', topic_id = NULL, chapter_topic_id = NULL,
       updated_at = now()
  FROM _fix f WHERE f.id = lp.id AND f.kind = 'A1_note';

-- A2: nothing records a delivery.
UPDATE public.tt_lesson_plans lp
   SET status = 'planned', updated_at = now()
  FROM _fix f WHERE f.id = lp.id AND f.kind = 'A2_planned';

-- B: point at the chapter the log shows completed that day, if that chapter
-- has no done period of its own; otherwise the row claims nothing.
UPDATE public.tt_lesson_plans lp
   SET topic_id = x.completed_topic, updated_at = now()
  FROM (
    SELECT f.id,
           (SELECT e.topic_id FROM public.syllabus_progress_events e
             WHERE e.class_id = l.class_id AND e.subject_id = l.subject_id AND e.date = l.date
               AND e.action = 'completed'
               AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans o
                                WHERE o.class_id = l.class_id AND o.subject_id = l.subject_id
                                  AND o.date = l.date AND o.status = 'done' AND NOT o.is_note_only
                                  AND o.topic_id = e.topic_id)
             ORDER BY e.created_at LIMIT 1) AS completed_topic
      FROM _fix f JOIN public.tt_lesson_plans l ON l.id = f.id
     WHERE f.kind = 'B_wrong_chapter') x
 WHERE x.id = lp.id AND x.completed_topic IS NOT NULL;
UPDATE public.tt_lesson_plans lp
   SET status = 'planned', updated_at = now()
  FROM _fix f
 WHERE f.id = lp.id AND f.kind = 'B_wrong_chapter'
   AND NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                    WHERE e.class_id = lp.class_id AND e.subject_id = lp.subject_id AND e.date = lp.date
                      AND e.topic_id = lp.topic_id AND e.action = 'completed');

-- Proof: no 'done' teaching row since the log went live claims more than the log.
SELECT jsonb_build_object(
  'repaired', (SELECT jsonb_object_agg(kind, n) FROM (SELECT kind, count(*) n FROM _fix GROUP BY 1) k),
  'backup_rows', (SELECT count(*) FROM salci_backups.lesson_plans_false_done_20260929),
  'left_done_nothing_logged', (SELECT count(*) FROM public.tt_lesson_plans lp
     WHERE lp.status = 'done' AND lp.session_type = 'teaching' AND NOT lp.is_note_only AND lp.date >= '2026-07-04'
       AND NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                        WHERE e.class_id = lp.class_id AND e.subject_id = lp.subject_id AND e.date = lp.date)),
  'left_done_wrong_chapter', (SELECT count(*) FROM public.tt_lesson_plans lp
     WHERE lp.status = 'done' AND lp.session_type = 'teaching' AND NOT lp.is_note_only AND lp.date >= '2026-07-04'
       AND lp.topic_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                        WHERE e.class_id = lp.class_id AND e.subject_id = lp.subject_id AND e.date = lp.date
                          AND e.topic_id = lp.topic_id AND e.action = 'completed')),
  'notes_restored_sample', (SELECT jsonb_agg(left(lp.note, 50)) FROM (SELECT lp.note FROM public.tt_lesson_plans lp
       JOIN _fix f ON f.id = lp.id WHERE f.kind = 'A1_note' LIMIT 5) lp),
  'audit_rows_written', (SELECT count(*) FROM public.system_audit_logs a
       WHERE a.entity_type = 'Period note' AND a.created_at >= now() - interval '1 minute')
) AS result;
