-- Proves the note-only lesson log behaves correctly under real RLS.
--
-- The problem it guards: a teacher who ran a surprise test had no way to log the
-- period, and worse, could not check out. The check-out gate demands a
-- syllabus_progress_events row per (class, subject) taught that day, and that
-- table's topic_id is NOT NULL, so a chapterless day can never satisfy it.
--
-- The suite contains ASSERTIONS ONLY, no DDL, so it always exercises whatever is
-- actually live. To run it before the migration is applied, concatenate the two
-- inside one transaction:
--   BEGIN; <migration>; <this file minus its own BEGIN/ROLLBACK>; ROLLBACK;
-- Deliberately not mirroring the DDL here: a mirrored copy drifts from the
-- migration and then the suite proves the wrong thing.
--
-- Run via scripts/run-sql.ps1. Results come back as a table because the
-- Management API discards RAISE NOTICE/WARNING.
--
-- READING A RED RUN: the fail-loud RAISE at the end aborts the transaction, so
-- the results SELECT never returns and the API answers HTTP 400 with an EMPTY
-- body. That is by design (a green 201 over a red suite is the failure mode it
-- prevents), but it means a red run tells you nothing on its own. To see which
-- cells failed, run a copy with the raise disabled:
--   sed 's/^  IF v_fails > 0 THEN$/  IF false THEN/' scripts/verify-note-only-day.sql > /tmp/dbg.sql
--
-- The fixtures are date-independent: "today" and its weekday are computed at
-- run time and the period structure works all seven days, so the suite does not
-- rot the first time it is run on a Sunday.
BEGIN;

CREATE TEMP TABLE _no_results(seq int, label text, status text) ON COMMIT DROP;

DO $suite$
DECLARE
  v_fails int := 0;
  v_inst   uuid := gen_random_uuid();
  v_teach  uuid := gen_random_uuid();
  v_grp    uuid := gen_random_uuid();
  v_cls    uuid := gen_random_uuid();
  v_subj   uuid;
  v_struct uuid := gen_random_uuid();
  v_ps2    uuid := gen_random_uuid();
  v_slotA  uuid := gen_random_uuid();
  v_slotB  uuid := gen_random_uuid();
  v_ps4    uuid := gen_random_uuid();
  v_ay     text := 'ZZ-NOTEONLY';
  v_date   date;
  v_day    text;
  v_lp     uuid;
  v_cnt    int;
  v_pending jsonb;
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text; r8 text;
  r9 text; r10 text; r11 text; r12 text; r13 text;
  r14 text; r15 text; r16 text; r17 text; r18 text;
  v_admin  uuid := gen_random_uuid();
  v_stu    uuid := gen_random_uuid();
  v_slotC  uuid := gen_random_uuid();
  v_past   date;
  v_export jsonb;
  v_topic  uuid;
BEGIN
  -- ---------- fixtures (as superuser) ----------
  v_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_day  := public.tt_dow_to_text(v_date);
  v_past := v_date - 1;

  INSERT INTO public.institutions (id, name, code)
  VALUES (v_inst, 'ZZ NoteOnly Inst', 'ZZNOTE');

  -- profiles.id FKs auth.users and handle_new_user pre-creates the profiles
  -- row, so seed auth.users then UPDATE profiles. Never bare-INSERT profiles.
  INSERT INTO auth.users (id, email) VALUES (v_teach, 'zz.note.teach@test.invalid');
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ NoteOnly Teacher'
   WHERE id = v_teach;
  INSERT INTO public.user_roles (user_id, role, institution_id)
  VALUES (v_teach, 'teacher', v_inst);

  -- An admin (the export RPC refuses anyone else) and a student (the leak test).
  INSERT INTO auth.users (id, email) VALUES
    (v_admin, 'zz.note.admin@test.invalid'),
    (v_stu,   'zz.note.stu@test.invalid');
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ NoteOnly Admin'
   WHERE id = v_admin;
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ NoteOnly Student'
   WHERE id = v_stu;
  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES
    (v_admin, 'school_admin', v_inst),
    (v_stu,   'student',      v_inst);

  -- A subject that actually has active chapters: teacher_pending_syllabus_days
  -- skips chapterless subjects entirely, so a subject with none would make the
  -- later cells vacuously green.
  SELECT st.subject_id INTO v_subj
    FROM public.syllabus_topics st
   WHERE st.is_active AND st.subject_id IS NOT NULL
   GROUP BY st.subject_id
   ORDER BY count(*) DESC
   LIMIT 1;

  -- Pick the chapter HERE, as superuser. Selected under the authenticated role
  -- it comes back NULL: syllabus_topics RLS hides another institution's rows
  -- from the fixture teacher, and a NULL topic makes cell 12 fail with
  -- "That chapter does not belong to this subject" instead of what it tests.
  SELECT st.id INTO v_topic FROM public.syllabus_topics st
   WHERE st.subject_id = v_subj AND st.is_active LIMIT 1;

  INSERT INTO public.cal_academic_years (institution_id, code, starts_on, ends_on, is_active)
  VALUES (v_inst, v_ay, v_date - 30, v_date + 30, true);

  INSERT INTO public.class_groups (id, institution_id, name, academic_year)
  VALUES (v_grp, v_inst, 'ZZ Class 4', v_ay);

  INSERT INTO public.classes (id, institution_id, class_group_id, name, section, academic_year, is_active)
  VALUES (v_cls, v_inst, v_grp, 'ZZ Class 4', 'C', v_ay, true);

  INSERT INTO public.class_assignments (user_id, class_id, role)
  VALUES (v_stu, v_cls, 'student');

  -- All seven working days so the suite does not depend on what day it is run.
  INSERT INTO public.tt_period_structures (id, institution_id, name, working_days)
  VALUES (v_struct, v_inst, 'ZZ Struct',
          ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);

  INSERT INTO public.tt_period_slots (id, structure_id, period_number, label, start_time, end_time, kind)
  VALUES (v_ps2, v_struct, 2, 'Period 2', '08:55', '09:30', 'period');

  INSERT INTO public.tt_class_structure (institution_id, class_id, structure_id, academic_year, publish_status)
  VALUES (v_inst, v_cls, v_struct, v_ay, 'published');

  INSERT INTO public.tt_period_slots (id, structure_id, period_number, label, start_time, end_time, kind)
  VALUES (v_ps4, v_struct, 4, 'Period 4', '10:05', '10:40', 'period');

  -- TWO periods of the same class+subject on the same weekday. Needed because
  -- record_syllabus_progress's dual-write picks a free period, and with only one
  -- period the interesting cases collapse into "nowhere to write".
  INSERT INTO public.tt_slots (id, institution_id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id)
  VALUES (v_slotA, v_inst, v_cls, v_ps2, v_day, v_ay, 'theory', v_subj, v_teach),
         (v_slotB, v_inst, v_cls, v_ps4, v_day, v_ay, 'theory', v_subj, v_teach),
         (v_slotC, v_inst, v_cls, v_ps2, public.tt_dow_to_text(v_date - 1), v_ay,
          'theory', v_subj, v_teach);

  -- ---------- schema assertions (still superuser) ----------
  -- 1. The column exists, is NOT NULL, and defaults to false. The default
  --    matters: it is what guarantees no historical row is retroactively
  --    reclassified as note-only when the resolution predicate goes live.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tt_lesson_plans'
        AND column_name = 'is_note_only'
        AND data_type = 'boolean' AND is_nullable = 'NO'
        AND column_default = 'false')
    THEN 'ok' ELSE 'FAIL column missing or wrong shape' END INTO r1;

  -- 2. The CHECK makes "note-only with no note" unrepresentable, so the UI
  --    gate is not the only thing standing between us and an empty record.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tt_lesson_plans'::regclass
      AND conname = 'tt_lesson_plans_note_only_requires_note')
  THEN 'ok' ELSE 'FAIL constraint missing' END INTO r2;

  -- ---------- become a real RLS-subject caller ----------
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teach::text, 'role', 'authenticated')::text, true);

  -- 3. An empty note is rejected. The UI disables Save, but the RPC is the
  --    real boundary and a blank record would be worse than none.
  BEGIN
    PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, '   ', v_slotA);
    r3 := 'FAIL blank note was accepted';
  EXCEPTION WHEN OTHERS THEN
    r3 := CASE WHEN SQLERRM ILIKE '%note is required%' THEN 'ok'
               ELSE 'FAIL wrong error: ' || SQLERRM END;
  END;

  -- 4. An explicit slot writes the canonical row shape. session_type 'other'
  --    plus a NULL topic is what keeps the row out of every coverage filter.
  v_lp := public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  SELECT CASE WHEN lp.is_note_only AND lp.topic_id IS NULL
                   AND lp.session_type = 'other' AND lp.status = 'done'
                   AND lp.note = 'Surprise test' AND lp.owner_teacher_id = v_teach
              THEN 'ok'
              ELSE 'FAIL shape: note_only=' || lp.is_note_only || ' st=' || lp.session_type
                   || ' status=' || lp.status || ' topic=' || coalesce(lp.topic_id::text,'null')
              END
    INTO r4 FROM public.tt_lesson_plans lp WHERE lp.id = v_lp;

  -- 5. Idempotent: a double-tap updates in place rather than raising 23505.
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test v2', v_slotA);
  SELECT count(*) INTO v_cnt FROM public.tt_lesson_plans
   WHERE slot_id = v_slotA AND date = v_date;
  SELECT CASE WHEN v_cnt = 1
                   AND (SELECT note FROM public.tt_lesson_plans WHERE id = v_lp) = 'Surprise test v2'
              THEN 'ok' ELSE 'FAIL rows=' || v_cnt END INTO r5;

  -- 6. Server-side slot resolution. The check-out gate knows only
  --    (class, subject, date), so the RPC has to find the period itself.
  --    Periods A and B are both eligible, so occupy B to make the choice
  --    deterministic. That also pins the ordering: an EMPTY period must win
  --    over one that already holds a lesson. (Asserting "it picked A" with both
  --    free is a coin flip on ORDER BY s.id, which is a random uuid.)
  DELETE FROM public.tt_lesson_plans WHERE class_id = v_cls AND date = v_date;
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, topic_id, is_note_only)
  VALUES (v_inst, v_slotB, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', v_topic, false);
  v_lp := public.tt_record_period_note(v_cls, v_subj, v_date, 'Assembly ran over', NULL);
  SELECT CASE WHEN lp.slot_id = v_slotA AND lp.is_note_only THEN 'ok'
              ELSE 'FAIL resolved slot=' || coalesce(lp.slot_id::text,'null')
                   || ' (expected the empty period A)' END
    INTO r6 FROM public.tt_lesson_plans lp WHERE lp.id = v_lp;

  -- 7. A crafted payload cannot log against a class the slot does not belong to.
  BEGIN
    PERFORM public.tt_record_period_note(gen_random_uuid(), v_subj, v_date, 'x', v_slotA);
    r7 := 'FAIL mismatched class accepted';
  EXCEPTION WHEN OTHERS THEN r7 := 'ok';
  END;

  -- 9. THE CRITICAL ONE. Before this feature a chapterless day could never be
  --    resolved, so the teacher could not check out and the only escape was to
  --    falsify a chapter completion. A note-only row must clear the day.
  DELETE FROM public.tt_lesson_plans WHERE class_id = v_cls AND date = v_date;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  SELECT public.teacher_pending_syllabus_days(true) INTO v_pending;
  SELECT CASE WHEN NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_pending->'days') d
            WHERE (d->>'date')::date = v_date)
         THEN 'ok'
         ELSE 'FAIL day still listed as unlogged' END INTO r9;

  -- 10. REGRESSION GUARD: a lesson plan WITHOUT the flag must NOT resolve the
  --     day. Without this cell the predicate could be widened to "any row" and
  --     every ordinary saved plan would silently satisfy the check-out gate.
  DELETE FROM public.tt_lesson_plans WHERE class_id = v_cls AND date = v_date;
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, note, is_note_only)
  VALUES (v_inst, v_slotA, v_cls, v_subj, v_teach, v_date,
          'other', 'done', 'not flagged', false);
  SELECT public.teacher_pending_syllabus_days(true) INTO v_pending;
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_pending->'days') d
            WHERE (d->>'date')::date = v_date)
         THEN 'ok'
         ELSE 'FAIL an unflagged row wrongly resolved the day' END INTO r10;

  -- 12. No cross-contamination: with a note-only row on period A, a later
  --     chapter completion must land on period B and leave A alone.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date AND class_id = v_cls;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  PERFORM public.record_syllabus_progress(v_cls, v_subj, v_topic, v_date, 'completed', 'checkout');
  SELECT CASE
    WHEN (SELECT lp.is_note_only AND lp.topic_id IS NULL AND lp.note = 'Surprise test'
            FROM public.tt_lesson_plans lp WHERE lp.slot_id = v_slotA AND lp.date = v_date)
     AND (SELECT lp.topic_id = v_topic AND lp.session_type = 'teaching'
            FROM public.tt_lesson_plans lp WHERE lp.slot_id = v_slotB AND lp.date = v_date)
    THEN 'ok' ELSE 'FAIL chapter did not land cleanly on the other period' END INTO r12;

  -- 13. THE CARVE-OUT ITSELF. The picker's original guard skipped periods that
  --     already held a status='done' row, which protects a note-only row only
  --     BECAUSE we happen to write those as 'done'. That is incidental, not
  --     semantic: the day someone writes a note-only row as 'planned' (a future
  --     period, say), the clobber comes back and silently rewrites the
  --     teacher's note into a chapter-tagged teaching row.
  --     So force exactly that state and prove the guard still holds.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date AND class_id = v_cls;
  -- Period B taken by a real chapter, so it is not a candidate either and the
  -- test cannot pass by accident of ORDER BY s.id.
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, topic_id, is_note_only)
  VALUES (v_inst, v_slotB, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', v_topic, false);
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, topic_id, note, is_note_only)
  VALUES (v_inst, v_slotA, v_cls, v_subj, v_teach, v_date,
          'other', 'planned', NULL, 'Surprise test, not yet done', true);
  PERFORM public.record_syllabus_progress(v_cls, v_subj, v_topic, v_date, 'completed', 'checkout');
  SELECT CASE WHEN lp.is_note_only AND lp.topic_id IS NULL
                   AND lp.note = 'Surprise test, not yet done'
              THEN 'ok'
              ELSE 'FAIL a non-done note-only row was clobbered: st='
                   || lp.session_type || ' topic=' || coalesce(lp.topic_id::text,'null') END
    INTO r13 FROM public.tt_lesson_plans lp WHERE lp.slot_id = v_slotA AND lp.date = v_date;

  -- 17. A PLANNED chapter is an intention, not a delivery, and must not block
  --     the note. Prod 2026-09-11: a teacher had planned a chapter on the day's
  --     only period from the timetable dialog, nothing was delivered, the
  --     check-out sheet listed the group as unfilled, and the note path refused
  --     with "Every period ... already has a lesson logged". Period B holds a
  --     DELIVERED chapter so A (planned) is the only candidate; the note must
  --     replace the plan on A and leave B untouched.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date AND class_id = v_cls;
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, topic_id, is_note_only)
  VALUES (v_inst, v_slotB, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', v_topic, false),
         (v_inst, v_slotA, v_cls, v_subj, v_teach, v_date,
          'teaching', 'planned', v_topic, false);
  BEGIN
    v_lp := public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test instead', NULL);
    SELECT CASE
      WHEN lp.slot_id = v_slotA AND lp.is_note_only AND lp.topic_id IS NULL
           AND lp.status = 'done' AND lp.note = 'Surprise test instead'
           AND (SELECT b.topic_id = v_topic AND b.status = 'done' AND NOT b.is_note_only
                  FROM public.tt_lesson_plans b WHERE b.slot_id = v_slotB AND b.date = v_date)
      THEN 'ok'
      ELSE 'FAIL note landed on ' || lp.slot_id || ' note_only=' || lp.is_note_only
           || ' topic=' || coalesce(lp.topic_id::text, 'null') END
      INTO r17 FROM public.tt_lesson_plans lp WHERE lp.id = v_lp;
  EXCEPTION WHEN OTHERS THEN
    r17 := 'FAIL a planned chapter blocked the note: ' || SQLERRM;
  END;

  -- 18. REGRESSION GUARD for the protection cell 17 narrowed: when every period
  --     holds a DELIVERED chapter the note is still refused rather than silently
  --     overwriting the coverage mirror. The sheet cannot reach this state on
  --     its own (a delivered chapter fills the group) but the RPC is the
  --     boundary, not the UI.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date AND class_id = v_cls;
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, topic_id, is_note_only)
  VALUES (v_inst, v_slotA, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', v_topic, false),
         (v_inst, v_slotB, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', v_topic, false);
  BEGIN
    PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'x', NULL);
    r18 := 'FAIL a delivered chapter was overwritten';
  EXCEPTION WHEN OTHERS THEN
    r18 := CASE WHEN SQLERRM ILIKE '%already has a lesson logged%' THEN 'ok'
                ELSE 'FAIL wrong error: ' || SQLERRM END;
  END;

  -- 14. A logged surprise test is real work but it is not a lesson, so it must
  --     not credit the lessons-taught badge ladder, which filters on status
  --     only. Checked against the live definition because calling the evaluator
  --     needs the whole badge catalogue seeded.
  SELECT CASE WHEN pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure)
                     LIKE '%lp.status = ''done''%AND lp.session_type = ''teaching''%'
              THEN 'ok' ELSE 'FAIL badge metric still counts note-only rows' END INTO r14;

  -- 15. The coordinator export must NAME the gap. A note-only row already
  --     reports as Filled with the note in the notes column, which is what we
  --     want; only the chapter cell was blank, which reads like missing data.
  --     Exercised through a real export call as an admin, on a PAST date: the
  --     export deliberately reports only days strictly before today.
  DELETE FROM public.tt_lesson_plans WHERE class_id = v_cls;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_past, 'Surprise test', v_slotC);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  SELECT public.tt_lesson_plan_export('year', NULL, NULL, NULL, NULL, NULL) INTO v_export;
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_export->'delivery_log') e
            WHERE e->>'chapter' = 'No chapter (activity logged)'
              AND e->>'fill_status' = 'Filled'
              AND e->>'notes' LIKE '%Surprise test%')
         THEN 'ok'
         ELSE 'FAIL export row: ' || coalesce((
           SELECT e::text FROM jsonb_array_elements(v_export->'delivery_log') e
            WHERE e->>'notes' LIKE '%Surprise test%' LIMIT 1), 'not found') END INTO r15;

  -- 16. THE LEAK TEST. RLS cannot restrict columns, so the student read policy
  --     handed out the whole row including note. No student code path selects
  --     it, but "pop quiz tomorrow" is exactly the note that must not be
  --     readable over raw PostgREST. The teaching row staying visible is what
  --     proves the policy was narrowed rather than simply broken.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teach::text, 'role', 'authenticated')::text, true);
  DELETE FROM public.tt_lesson_plans WHERE class_id = v_cls;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Pop quiz tomorrow', v_slotA);
  PERFORM public.record_syllabus_progress(v_cls, v_subj, v_topic, v_date, 'completed', 'checkout');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stu::text, 'role', 'authenticated')::text, true);
  SELECT CASE
    WHEN (SELECT count(*) FROM public.tt_lesson_plans
           WHERE class_id = v_cls AND is_note_only) = 0
     AND (SELECT count(*) FROM public.tt_lesson_plans
           WHERE class_id = v_cls AND NOT is_note_only) = 1
    THEN 'ok'
    ELSE 'FAIL student sees note_only='
         || (SELECT count(*) FROM public.tt_lesson_plans WHERE class_id = v_cls AND is_note_only)
         || ' teaching='
         || (SELECT count(*) FROM public.tt_lesson_plans WHERE class_id = v_cls AND NOT is_note_only)
    END INTO r16;

  PERFORM set_config('request.jwt.claims', NULL, true);
  EXECUTE 'RESET ROLE';

  -- 8. anon must not hold EXECUTE. Supabase's ALTER DEFAULT PRIVILEGES grants it
  --    on every new public function and REVOKE FROM PUBLIC does not strip it.
  --    Only meaningful in the live variant, where the real grants are in force.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' AND routine_name = 'tt_record_period_note'
      AND grantee = 'anon')
  THEN 'ok' ELSE 'FAIL anon holds EXECUTE' END INTO r8;

  -- 11. The two predicates must never diverge. A teacher who resolved a day in
  --     the UI but is still SY1-flagged for admins is the exact failure this
  --     pins: both functions have to carry the note-only branch.
  SELECT CASE
    WHEN pg_get_functiondef('public.teacher_pending_syllabus_days(boolean)'::regprocedure)
           LIKE '%is_note_only%'
     AND pg_get_functiondef('public.dash_evaluate_syllabus_flags(uuid)'::regprocedure)
           LIKE '%is_note_only%'
    THEN 'ok' ELSE 'FAIL the two predicates are out of lockstep' END INTO r11;

  -- ---------- report (back as superuser) ----------
  INSERT INTO _no_results VALUES
    (1,  'is_note_only column exists, NOT NULL, default false', r1),
    (2,  'note-only rows require a non-empty note (CHECK)',     r2),
    (3,  'blank note is rejected',                              r3),
    (4,  'explicit slot writes the canonical row shape',        r4),
    (5,  'second call updates in place (idempotent)',           r5),
    (6,  'server resolves the slot when none is given',         r6),
    (7,  'mismatched class/slot pair is refused',               r7),
    (8,  'anon has no EXECUTE on tt_record_period_note',        r8),
    (9,  'note-only row RESOLVES the day (unblocks check-out)', r9),
    (10, 'a plan WITHOUT the flag does not resolve the day',    r10),
    (11, 'both "day logged" predicates carry the note branch',  r11),
    (12, 'chapter completion lands on the OTHER period',        r12),
    (13, 'note-only guard is semantic, not incidental to status', r13),
    (14, 'note-only rows do not credit the lessons-taught badge', r14),
    (15, 'export names the chapter cell for note-only rows',     r15),
    (16, 'a STUDENT cannot read a note-only row (leak test)',    r16),
    (17, 'a PLANNED chapter does not block the note (replaced)', r17),
    (18, 'a DELIVERED chapter on every period still refuses',    r18);

  SELECT count(*) INTO v_fails FROM _no_results WHERE status <> 'ok';
  INSERT INTO _no_results VALUES
    (99, 'SUMMARY', CASE WHEN v_fails = 0
                         THEN 'ALL NOTE-ONLY ASSERTIONS PASSED'
                         ELSE v_fails || ' ASSERTION(S) FAILED' END);

  -- Fail loud: a suite that returns HTTP 201 while red reads as success.
  IF v_fails > 0 THEN
    RAISE EXCEPTION '% note-only assertion(s) FAILED', v_fails;
  END IF;
END $suite$;

SELECT seq, label, status FROM _no_results ORDER BY seq;

ROLLBACK;
