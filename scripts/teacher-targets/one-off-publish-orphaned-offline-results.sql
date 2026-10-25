-- ONE-OFF, 2026-09-16. Publish the offline results that were never published.
--
-- WHY. The "Already Created" results-upload flow saves marks with a
-- "Publish results now" toggle that DEFAULTS TO OFF on every reopen, and the only
-- other publish surface (ExamCheckingDashboard, which does support
-- examMode='offline') is unreachable: EvaluationsPage lost its own routes and
-- survives only at /ocr-review, which excludes teachers. So a teacher can enter
-- every mark, press Save, get a success toast, and the students never see it.
--
-- MEASURED AT ALLIANCE before this ran: zero fully-unpublished exams before
-- July 2026, then 14 in July, 54 in August, 76 in September, and every single one
-- is_results_only. Of the 51 teachers using the flow, 13 always published, 24
-- were inconsistent, and 14 NEVER published once.
--
-- SCOPE. Only the exams belonging to those 14 never-published teachers: the
-- clearest signal of "did not know the toggle existed" rather than "chose to
-- withhold". 54 exams, 1,696 result rows, 619 students. The other ~90
-- fully-unpublished exams belong to teachers who publish sometimes, so intent
-- cannot be inferred and they are deliberately left alone.
--
-- Authorised by Tushar 2026-09-16.
--
-- REVERSIBLE. Every touched row is recorded first in
-- salci_backups.tgt_bulk_publish_20260916 with its previous state. To undo:
--   UPDATE final_results fr SET is_published = b.prev_is_published,
--          published_at = b.prev_published_at, published_by = b.prev_published_by
--   FROM salci_backups.tgt_bulk_publish_20260916 b WHERE fr.id = b.final_result_id;

CREATE SCHEMA IF NOT EXISTS salci_backups;

CREATE TABLE IF NOT EXISTS salci_backups.tgt_bulk_publish_20260916 (
  final_result_id   uuid PRIMARY KEY,
  exam_id           uuid,
  attempt_id        uuid,
  student_id        uuid,
  prev_is_published boolean,
  prev_published_at timestamptz,
  prev_published_by uuid,
  backed_up_at      timestamptz NOT NULL DEFAULT now()
);

-- 1. Record the previous state of every row this will touch.
WITH ro AS (
  SELECT e.id, e.created_by,
         EXISTS (SELECT 1 FROM public.final_results f
                   JOIN public.student_exam_attempts a ON a.id = f.attempt_id
                  WHERE a.exam_id = e.id AND f.is_published) AS any_published
  FROM public.exams e
  JOIN public.institutions i ON i.id = e.institution_id
  WHERE i.name = 'Alliance International School'
    AND e.is_results_only
    AND EXISTS (SELECT 1 FROM public.final_results f
                  JOIN public.student_exam_attempts a ON a.id = f.attempt_id
                 WHERE a.exam_id = e.id)
),
never_pub AS (
  SELECT created_by FROM ro GROUP BY created_by
  HAVING count(*) FILTER (WHERE any_published) = 0
),
targets AS (
  SELECT ro.id FROM ro JOIN never_pub n ON n.created_by = ro.created_by
  WHERE NOT ro.any_published
)
INSERT INTO salci_backups.tgt_bulk_publish_20260916
  (final_result_id, exam_id, attempt_id, student_id,
   prev_is_published, prev_published_at, prev_published_by)
SELECT fr.id, a.exam_id, a.id, a.student_id,
       fr.is_published, fr.published_at, fr.published_by
FROM public.final_results fr
JOIN public.student_exam_attempts a ON a.id = fr.attempt_id
WHERE a.exam_id IN (SELECT id FROM targets)
ON CONFLICT (final_result_id) DO NOTHING;

-- 2. Make them visible to students. published_by keeps any existing value and
--    otherwise credits the teacher whose marks these are.
UPDATE public.final_results fr
SET is_published = true,
    published_at = COALESCE(fr.published_at, now()),
    published_by = COALESCE(fr.published_by, e.created_by)
FROM salci_backups.tgt_bulk_publish_20260916 b
JOIN public.exams e ON e.id = b.exam_id
WHERE fr.id = b.final_result_id
  AND fr.is_published IS NOT TRUE;

-- 3. Prove it.
SELECT (SELECT count(*) FROM salci_backups.tgt_bulk_publish_20260916)        AS rows_backed_up,
       (SELECT count(*) FROM salci_backups.tgt_bulk_publish_20260916 b
          JOIN public.final_results fr ON fr.id = b.final_result_id
         WHERE fr.is_published)                                             AS rows_now_published,
       (SELECT count(DISTINCT b.exam_id) FROM salci_backups.tgt_bulk_publish_20260916 b) AS exams,
       (SELECT count(DISTINCT b.student_id) FROM salci_backups.tgt_bulk_publish_20260916 b) AS students;
