-- edit_syllabus_day acceptance suite (migration 20260929120000).
-- Runs as a real teacher against real prod rows, then rolls EVERYTHING back.
-- Assertions RECORD instead of raising, so one failure cannot hide the rest.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-syllabus-day-edit.sql
--
-- Fixture: the first plain teacher (no admin/coordinator reach) who has a past
-- day with TWO completed chapter entries for one class + subject, each holding
-- a "done" period. Picked at run time, never hard-coded.
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

DO $test$
DECLARE
  v_t uuid; v_class uuid; v_subj uuid; v_date date; v_ch1 uuid; v_ch2 uuid;
  v_outsider uuid; v_res jsonb; v_n int; v_s text; v_err text; v_slot uuid;
  v_audit0 int; v_audit1 int; v_future date; v_tz text;
BEGIN
  SELECT e.recorded_by, e.class_id, e.subject_id, e.date
    INTO v_t, v_class, v_subj, v_date
    FROM public.syllabus_progress_events e
    JOIN public.classes c ON c.id = e.class_id
   WHERE e.action = 'completed' AND e.recorded_by IS NOT NULL
     AND e.date < (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND NOT public.tt_user_can_edit_class_slots(e.recorded_by, e.class_id)
     AND (SELECT count(*) FROM public.tt_lesson_plans lp
           WHERE lp.class_id = e.class_id AND lp.subject_id = e.subject_id
             AND lp.date = e.date AND lp.status = 'done' AND NOT lp.is_note_only
             AND lp.topic_id IS NOT NULL) = 2
   GROUP BY e.recorded_by, e.class_id, e.subject_id, e.date
  HAVING count(*) = 2
   ORDER BY e.date DESC
   LIMIT 1;
  PERFORM pg_temp.chk(v_t IS NOT NULL, 'fixture found', format('teacher %s class %s date %s', v_t, v_class, v_date));
  IF v_t IS NULL THEN RETURN; END IF;

  SELECT min(e.topic_id::text)::uuid, max(e.topic_id::text)::uuid INTO v_ch1, v_ch2
    FROM public.syllabus_progress_events e
   WHERE e.class_id = v_class AND e.subject_id = v_subj AND e.date = v_date AND e.action = 'completed';

  SELECT count(*) INTO v_audit0 FROM public.system_audit_logs
   WHERE entity_type IN ('Syllabus log', 'Period note');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);

  -- 1. Completed -> Partial un-marks the period it had marked done.
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[],
             jsonb_build_array(jsonb_build_object('topic_id', v_ch1, 'action', 'partial')));
  SELECT e.action INTO v_s FROM public.syllabus_progress_events e
   WHERE e.class_id = v_class AND e.subject_id = v_subj AND e.date = v_date AND e.topic_id = v_ch1;
  PERFORM pg_temp.chk(v_s = 'partial', 'downgrade: entry is now Partial', v_s);
  SELECT count(*) INTO v_n FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date
     AND lp.topic_id = v_ch1 AND lp.status = 'done';
  PERFORM pg_temp.chk(v_n = 0, 'downgrade: its period is no longer done', format('%s done row(s) left', v_n));

  -- 2. Partial -> Completed puts a done period back.
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[],
             jsonb_build_array(jsonb_build_object('topic_id', v_ch1, 'action', 'completed')));
  SELECT count(*) INTO v_n FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date
     AND lp.topic_id = v_ch1 AND lp.status = 'done';
  PERFORM pg_temp.chk(v_n = 1, 'upgrade: a period is done again', format('%s done row(s)', v_n));

  -- 3. Chapter -> note in ONE call, on a day where every period holds a
  --    delivered chapter: remove both chapters and save a note.
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, ARRAY[v_ch1, v_ch2],
             '[]'::jsonb, 'Unit test instead of teaching');
  SELECT count(*) INTO v_n FROM public.syllabus_progress_events e
   WHERE e.class_id = v_class AND e.subject_id = v_subj AND e.date = v_date;
  PERFORM pg_temp.chk(v_n = 0, 'chapter to note: both entries removed', format('%s entr(y/ies) left', v_n));
  SELECT count(*), min(lp.slot_id::text)::uuid INTO v_n, v_slot FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date AND lp.is_note_only;
  PERFORM pg_temp.chk(v_n = 1, 'chapter to note: exactly one note saved', format('%s note(s)', v_n));
  PERFORM pg_temp.chk((v_res ->> 'removed')::int = 2, 'chapter to note: result counts 2 removals', v_res::text);

  -- 4. Editing the note in place (its period named) does not spill a second one.
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[], '[]'::jsonb,
             'Unit test, edited', v_slot);
  SELECT count(*), max(lp.note) INTO v_n, v_s FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date AND lp.is_note_only;
  PERFORM pg_temp.chk(v_n = 1 AND v_s = 'Unit test, edited', 'note edited in place', format('%s note(s): %s', v_n, v_s));

  -- 5. Note -> chapter in ONE call: clear the note, log a chapter Completed.
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[],
             jsonb_build_array(jsonb_build_object('topic_id', v_ch2, 'action', 'completed')),
             NULL, v_slot, true);
  SELECT count(*) INTO v_n FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date AND lp.is_note_only;
  PERFORM pg_temp.chk(v_n = 0, 'note to chapter: note removed', format('%s note(s) left', v_n));
  SELECT count(*) INTO v_n FROM public.syllabus_progress_events e
   WHERE e.class_id = v_class AND e.subject_id = v_subj AND e.date = v_date
     AND e.topic_id = v_ch2 AND e.action = 'completed';
  PERFORM pg_temp.chk(v_n = 1, 'note to chapter: chapter logged', '');
  SELECT count(*) INTO v_n FROM public.tt_lesson_plans lp
   WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date
     AND lp.topic_id = v_ch2 AND lp.status = 'done';
  PERFORM pg_temp.chk(v_n = 1, 'note to chapter: the freed period is marked done', format('%s done row(s)', v_n));

  -- 6. Clearing a note that is not there is a no-op, not an error (double-tap).
  BEGIN
    v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[], '[]'::jsonb, NULL, NULL, true);
    PERFORM pg_temp.chk((v_res ->> 'note_cleared')::int = 0, 'repeat clear is a no-op', v_res::text);
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(false, 'repeat clear is a no-op', SQLERRM);
  END;

  -- 7. Adding a note while every period holds a delivered chapter, WITHOUT
  --    removing any, is refused with the editor's wording, not "today".
  v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[],
             jsonb_build_array(jsonb_build_object('topic_id', v_ch1, 'action', 'completed')));
  BEGIN
    v_res := public.edit_syllabus_day(v_class, v_subj, v_date, '{}'::uuid[], '[]'::jsonb, 'Should not fit');
    SELECT count(*) INTO v_n FROM public.tt_lesson_plans lp
     WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date AND lp.is_note_only;
    -- Accepted only if a period was genuinely free; then it must not have
    -- displaced a delivered chapter.
    SELECT count(*) INTO v_audit1 FROM public.tt_lesson_plans lp
     WHERE lp.class_id = v_class AND lp.subject_id = v_subj AND lp.date = v_date
       AND lp.status = 'done' AND NOT lp.is_note_only;
    PERFORM pg_temp.chk(v_audit1 = 2, 'note beside chapters never displaces one', format('%s note, %s done chapter periods', v_n, v_audit1));
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(SQLERRM LIKE 'Every period that day%', 'full day refuses a note plainly', SQLERRM);
  END;

  -- 8. A future date is refused.
  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz
    FROM public.institutions i JOIN public.classes c ON c.institution_id = i.id WHERE c.id = v_class;
  v_future := (now() AT TIME ZONE v_tz)::date + 3;
  BEGIN
    v_res := public.edit_syllabus_day(v_class, v_subj, v_future, '{}'::uuid[],
               jsonb_build_array(jsonb_build_object('topic_id', v_ch1, 'action', 'completed')));
    PERFORM pg_temp.chk(false, 'future date refused', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(SQLERRM LIKE 'You can only log a day%', 'future date refused', SQLERRM);
  END;

  -- 9. A teacher with no reach into this class is refused.
  SELECT ur.user_id INTO v_outsider
    FROM public.user_roles ur
    JOIN public.classes c ON c.id = v_class
   WHERE ur.role = 'teacher' AND ur.user_id <> v_t
     AND public.get_user_institution(ur.user_id) = c.institution_id
     AND NOT public.tt_user_can_edit_class_slots(ur.user_id, v_class)
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                      WHERE ca.user_id = ur.user_id AND ca.role = 'teacher' AND ca.class_id = v_class)
     AND NOT EXISTS (SELECT 1 FROM public.tt_slots s
                      WHERE s.teacher_id = ur.user_id AND s.class_id = v_class)
   LIMIT 1;
  IF v_outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
    BEGIN
      v_res := public.edit_syllabus_day(v_class, v_subj, v_date, ARRAY[v_ch1]);
      PERFORM pg_temp.chk(false, 'outsider teacher refused', 'ACCEPTED');
    EXCEPTION WHEN others THEN
      PERFORM pg_temp.chk(SQLERRM LIKE 'You are not allowed%', 'outsider teacher refused', SQLERRM);
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  ELSE
    PERFORM pg_temp.chk(true, 'outsider teacher refused', 'skipped: no outsider teacher in this school');
  END IF;

  -- 10. History: every step above left audit rows.
  SELECT count(*) INTO v_audit1 FROM public.system_audit_logs
   WHERE entity_type IN ('Syllabus log', 'Period note');
  PERFORM pg_temp.chk(v_audit1 - v_audit0 >= 8, 'edits are in the activity log', format('%s new row(s)', v_audit1 - v_audit0));
  SELECT count(*) INTO v_n FROM public.system_audit_logs
   WHERE entity_type = 'Syllabus log' AND action = 'syllabus_log_updated'
     AND entity_name LIKE '%(Completed to Partial)';
  PERFORM pg_temp.chk(v_n >= 1, 'a downgrade is logged as Completed to Partial', format('%s row(s)', v_n));
  SELECT count(*) INTO v_n FROM public.system_audit_logs
   WHERE entity_type = 'Period note' AND action = 'period_note_deleted';
  PERFORM pg_temp.chk(v_n >= 1, 'a removed note is logged', format('%s row(s)', v_n));

  -- 11. The My syllabus function returns each chapter's logged dates.
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(public.dash_teacher_syllabus_chapters(v_class, v_subj) -> 'subjects') s,
         jsonb_array_elements(s -> 'chapters') ch
   WHERE jsonb_array_length(COALESCE(ch -> 'logs', '[]'::jsonb)) > 0;
  PERFORM pg_temp.chk(v_n > 0, 'chapters carry their logged dates', format('%s chapter(s) with logs', v_n));

  -- 12. anon cannot execute the new function or the two old write paths.
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;
  BEGIN
    v_res := public.edit_syllabus_day(v_class, v_subj, v_date);
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'anon cannot execute edit_syllabus_day', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(SQLSTATE = '42501', 'anon cannot execute edit_syllabus_day', SQLSTATE || ' ' || SQLERRM);
  END;
  SET LOCAL ROLE anon;
  BEGIN
    v_res := public.delete_syllabus_progress(v_class, v_subj, v_ch1, v_date);
    RESET ROLE;
    PERFORM pg_temp.chk(false, 'anon cannot execute delete_syllabus_progress', 'ACCEPTED');
  EXCEPTION WHEN others THEN
    RESET ROLE;
    PERFORM pg_temp.chk(SQLSTATE = '42501', 'anon cannot execute delete_syllabus_progress', SQLSTATE || ' ' || SQLERRM);
  END;
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
