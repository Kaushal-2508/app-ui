-- Note-only lesson log: a period that had no chapter delivery (surprise test,
-- class activity, assembly that ate the period) becomes a first-class,
-- RESOLVABLE log entry.
--
-- Design: docs/superpowers/specs/2026-09-02-lesson-plan-note-only-day-design.md
-- Verified by: scripts/verify-note-only-day-live.sql (15 assertions, real RLS)
--
-- Why this is more than a new column. Before this migration a chapterless day
-- TRAPPED the teacher: teacher_pending_syllabus_days decides a day is logged
-- only when a syllabus_progress_events row exists for (class, subject, date),
-- CheckOutLessonGate refuses to check the teacher out until every group is
-- filled, and dash_evaluate_syllabus_flags raises SY1 after three such days.
-- A jar event cannot rescue them because syllabus_progress_events.topic_id is
-- NOT NULL. The only escape was to falsify a chapter completion in order to go
-- home. So the predicate itself has to change, in two places, in lockstep.
--
-- Row shape: is_note_only=true + topic_id NULL + session_type 'other' +
-- status 'done'. The last three already exclude the row from every
-- syllabus-coverage filter for free; is_note_only is the unambiguous
-- discriminator for the two predicates below. Never branch on
-- session_type = 'other' alone.

-- ---------------------------------------------------------------
-- 1. Column, constraint, index
-- ---------------------------------------------------------------
ALTER TABLE public.tt_lesson_plans
  ADD COLUMN IF NOT EXISTS is_note_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tt_lesson_plans.is_note_only IS
  'True when the teacher logged this period with a free-text note instead of a '
  'chapter. Written only by tt_record_period_note. Resolves the day for '
  'teacher_pending_syllabus_days and dash_evaluate_syllabus_flags.';

ALTER TABLE public.tt_lesson_plans
  DROP CONSTRAINT IF EXISTS tt_lesson_plans_note_only_requires_note;
ALTER TABLE public.tt_lesson_plans
  ADD CONSTRAINT tt_lesson_plans_note_only_requires_note
  CHECK (NOT is_note_only OR btrim(COALESCE(note, '')) <> '');

-- Backs the EXISTS added to teacher_pending_syllabus_days and
-- dash_evaluate_syllabus_flags. Partial, so it stays tiny next to the table:
-- the existing idx_tt_lesson_plans_class_subject has no date column and cannot
-- serve that lookup, and the pending-days RPC is a per-login hot query.
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_note_only_group
  ON public.tt_lesson_plans (class_id, subject_id, date)
  WHERE is_note_only;

-- ---------------------------------------------------------------
-- 2. tt_record_period_note — the single write path for note-only logs.
--
-- Two callers with different knowledge:
--   * the Lesson Plan dialog knows the exact period, and passes p_slot_id;
--   * the check-out gate and the backlog sheet know only
--     (class, subject, date), because they are organised per group, so the
--     server resolves the period.
-- Keeping both in one function is what stops slot resolution and the row shape
-- from drifting apart between the two surfaces.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_record_period_note(
  p_class_id   uuid,
  p_subject_id uuid,
  p_date       date,
  p_note       text,
  p_slot_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_note  text := btrim(COALESCE(p_note, ''));
  v_slot  uuid;
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'A note is required.'; END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'That note is too long. Keep it under 2000 characters.';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;

  SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
   WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  IF v_ay IS NULL THEN RAISE EXCEPTION 'no active academic year'; END IF;

  IF p_slot_id IS NOT NULL THEN
    -- Dialog path. Verify BOTH that the period really belongs to this
    -- (class, subject) pair and that the caller may write it, so a crafted
    -- payload cannot log against someone else's class.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
     WHERE s.id = p_slot_id
       AND s.class_id = p_class_id
       AND s.subject_id IS NOT DISTINCT FROM p_subject_id
       AND (s.teacher_id = v_uid OR public.tt_user_can_edit_class_slots(v_uid, s.class_id));
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'That period does not match this class, or you cannot edit it.';
    END IF;
  ELSE
    -- Gate path. Prefer a period with nothing logged, then one already
    -- note-only (so re-saving edits it rather than spilling onto a second
    -- period). A period holding a chapter is never a candidate.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
      LEFT JOIN public.tt_lesson_plans lp
             ON lp.slot_id = s.id AND lp.date = p_date
     WHERE s.class_id = p_class_id
       AND s.subject_id IS NOT DISTINCT FROM p_subject_id
       AND s.academic_year = v_ay
       AND s.slot_type IN ('theory','practical')
       AND s.day = public.tt_dow_to_text(p_date)
       AND s.teacher_id = v_uid
     ORDER BY (lp.id IS NULL) DESC, lp.is_note_only DESC NULLS LAST, s.id
     LIMIT 1;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'You have no period for this class on that day.';
    END IF;
    -- Every period already carries a chapter: refuse rather than destroy one.
    IF EXISTS (
      SELECT 1 FROM public.tt_lesson_plans lp
       WHERE lp.slot_id = v_slot AND lp.date = p_date
         AND NOT lp.is_note_only AND lp.topic_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Every period for this class today already has a lesson logged.';
    END IF;
  END IF;

  INSERT INTO public.tt_lesson_plans (
    institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
    session_type, status, topic_id, chapter_topic_id, note, is_note_only,
    created_by, updated_by
  ) VALUES (
    -- owner is the SLOT's teacher, so an admin logging on someone's behalf
    -- does not steal ownership of the period.
    v_inst, v_slot, p_class_id, p_subject_id, COALESCE(v_owner, v_uid), p_date,
    'other', 'done', NULL, NULL, v_note, true,
    v_uid, v_uid
  )
  ON CONFLICT (slot_id, date) DO UPDATE SET
    session_type     = 'other',
    status           = 'done',
    topic_id         = NULL,
    chapter_topic_id = NULL,
    note             = EXCLUDED.note,
    is_note_only     = true,
    updated_by       = EXCLUDED.updated_by,
    updated_at       = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- public function, and REVOKE FROM PUBLIC does NOT strip it (CLAUDE.md §11).
-- Revoke from anon BY NAME and verify in information_schema.routine_privileges.
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) TO authenticated;

-- ---------------------------------------------------------------
-- 3. The shared "was this day logged?" predicate.
--
-- Duplicated across teacher_pending_syllabus_days (drives the teacher's
-- "N days unlogged" chip AND the blocking check-out gate) and
-- dash_evaluate_syllabus_flags (drives the SY1 admin flag). They MUST stay
-- identical: a teacher who resolved a day in the UI but is still flagged for
-- their principal is the failure this pair exists to avoid.
--
-- Base body copied verbatim from
-- 20260704150000_pending_syllabus_days_skip_chapterless.sql; the ONLY change is
-- the OR branch in the grps CTE.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_pending_syllabus_days(p_include_today boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_inst   uuid;
  v_tz     text;
  v_today  date;
  v_ay     text;
  v_start  date;
  v_end    date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT ay.code, ay.starts_on, ay.ends_on INTO v_ay, v_start, v_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true
  LIMIT 1;
  IF v_ay IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tt_slots s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb);
  END IF;

  v_end := LEAST(v_end, CASE WHEN p_include_today THEN v_today ELSE v_today - 1 END);
  v_start := GREATEST(v_start, v_today - 60);
  IF v_start > v_end THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  WITH days AS (
    SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') AS g(d)
  ),
  slots AS (
    SELECT s.class_id, s.subject_id, s.day,
           trim(c.name || COALESCE(' ' || c.section, '')) AS class_name,
           us.name AS subject_name,
           cs.structure_id
    FROM public.tt_slots s
    JOIN public.classes c              ON c.id = s.class_id
    JOIN public.universal_subjects us  ON us.id = s.subject_id
    JOIN public.tt_class_structure cs  ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
      AND s.subject_id IS NOT NULL
      -- Trap-freedom: a subject with no active chapters can never be filled --
      -- never demand it. (Chapter-set resolution falls back to all active
      -- subject topics, so "has any chapter" <=> this EXISTS.)
      AND EXISTS (
        SELECT 1 FROM public.syllabus_topics st
        WHERE st.subject_id = s.subject_id AND st.is_active = true
      )
  ),
  occ AS (
    SELECT DISTINCT sl.class_id, sl.class_name, sl.subject_id, sl.subject_name, dd.d
    FROM slots sl
    JOIN public.tt_period_structures ps ON ps.id = sl.structure_id
    JOIN days dd ON public.tt_dow_to_text(dd.d) = sl.day
                AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block')
        AND dd.d BETWEEN ce.starts_on AND ce.ends_on
    )
  ),
  grps AS (
    SELECT o.*,
           (
             EXISTS (
               SELECT 1 FROM public.syllabus_progress_events e
               WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
             )
             -- A chapterless period (surprise test, activity) logged as a note
             -- resolves the group too. Without this the teacher cannot check
             -- out, and the only escape is to falsify a chapter completion.
             -- KEEP IN LOCKSTEP with dash_evaluate_syllabus_flags below.
             OR EXISTS (
               SELECT 1 FROM public.tt_lesson_plans lp
               WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
                 AND lp.date = o.d AND lp.is_note_only
             )
           ) AS filled
    FROM occ o
  ),
  by_day AS (
    SELECT g.d,
           bool_and(g.filled) AS all_filled,
           jsonb_agg(jsonb_build_object(
             'class_id', g.class_id, 'class_name', g.class_name,
             'subject_id', g.subject_id, 'subject_name', g.subject_name,
             'filled', g.filled
           ) ORDER BY g.class_name, g.subject_name) AS groups
    FROM grps g
    GROUP BY g.d
  ),
  pending AS (
    SELECT * FROM by_day WHERE NOT all_filled
  )
  SELECT jsonb_build_object(
    'unresolved_day_count', (SELECT count(*) FROM pending),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(p.d, 'YYYY-MM-DD'),
        'is_today', (p.d = v_today),
        'groups', p.groups) ORDER BY p.d)
      FROM (SELECT * FROM pending ORDER BY (d = v_today) DESC, d ASC LIMIT 30) p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_pending_syllabus_days(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_pending_syllabus_days(boolean) TO authenticated;

-- Base body copied verbatim from 20260706160000_sy1_review_fixes.sql; the ONLY
-- change is the second NOT EXISTS in the unfilled CTE.
CREATE OR REPLACE FUNCTION public.dash_evaluate_syllabus_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay text; v_ay_end date; v_start date; v_end date;
  v_detected int := 0; v_resolved int := 0;
BEGIN
  -- Always authorize: dash_resolve_institution re-checks user_roles even when
  -- an explicit institution id is supplied (mirrors dash_evaluate_flags).
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT ay.code, GREATEST(ay.starts_on, v_today - 60), ay.ends_on INTO v_ay, v_start, v_ay_end
  FROM cal_academic_years ay WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  -- Clamp to the AY end: a lapsed-but-still-active year (pre-rollover weeks)
  -- must not accrue unfilled days, or the whole staff gets falsely flagged.
  v_end := LEAST(v_today - 1, v_ay_end);
  IF v_ay IS NULL OR v_start > v_end THEN
    RETURN jsonb_build_object('detected', 0, 'resolved', 0);
  END IF;

  DROP TABLE IF EXISTS _sy;
  CREATE TEMP TABLE _sy ON COMMIT DROP AS
  WITH dd AS (SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') g(d)),
  slots AS (
    SELECT DISTINCT s.teacher_id, s.class_id, s.subject_id, s.day, cs.structure_id
    FROM tt_slots s
    JOIN tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.institution_id = v_inst AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
      AND s.subject_id IS NOT NULL AND s.teacher_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM syllabus_topics st WHERE st.subject_id = s.subject_id AND st.is_active = true)
  ),
  occ AS (
    SELECT DISTINCT sl.teacher_id, sl.class_id, sl.subject_id, dd.d
    FROM slots sl
    JOIN tt_period_structures ps ON ps.id = sl.structure_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = sl.day AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block') AND dd.d BETWEEN ce.starts_on AND ce.ends_on)
  ),
  unfilled AS (
    SELECT o.teacher_id, o.d FROM occ o
    WHERE NOT EXISTS (SELECT 1 FROM syllabus_progress_events e
      WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d)
      -- KEEP IN LOCKSTEP with teacher_pending_syllabus_days above. A teacher who
      -- resolved a day by logging a note must not still be SY1-flagged to their
      -- principal for a day the product told them was done.
      AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
        WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
          AND lp.date = o.d AND lp.is_note_only)
  )
  SELECT u.teacher_id, count(DISTINCT u.d)::int AS n
  FROM unfilled u GROUP BY u.teacher_id HAVING count(DISTINCT u.d) > 3;

  INSERT INTO dashboard_flags (institution_id, flag_code, category, severity, subject_type, subject_key,
                               title, description, metric_value, link_url, status, first_detected_at, last_evaluated_at)
  SELECT v_inst, 'SY1', 'syllabus', 'warning', 'teacher', sy.teacher_id::text,
         'Syllabus logging is behind',
         COALESCE(p.full_name, p.email, 'A teacher') || ' has ' || sy.n || ' recent school days with unlogged syllabus progress.',
         sy.n, '/school/timetable', 'red', now(), now()
  FROM _sy sy LEFT JOIN profiles p ON p.id = sy.teacher_id
  ON CONFLICT (institution_id, flag_code, subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at = now(), metric_value = EXCLUDED.metric_value, description = EXCLUDED.description;

  SELECT count(*) INTO v_detected FROM _sy;

  UPDATE dashboard_flags df SET resolved_at = now()
  WHERE df.institution_id = v_inst AND df.resolved_at IS NULL AND df.flag_code = 'SY1'
    AND NOT EXISTS (SELECT 1 FROM _sy s WHERE s.teacher_id::text = df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object('detected', v_detected, 'resolved', v_resolved);
END $$;

REVOKE ALL ON FUNCTION public.dash_evaluate_syllabus_flags(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.dash_evaluate_syllabus_flags(uuid) TO authenticated;

-- ---------------------------------------------------------------
-- 4. record_syllabus_progress must not clobber a note-only period.
--
-- Its dual-write picks a free period of this class+subject on that weekday and
-- upserts a 'done' teaching row, with ON CONFLICT rewriting session_type and
-- topic_id. The original guard skipped periods that already held a
-- status='done' row, which protects a note-only row only BECAUSE we happen to
-- write those as 'done'. That protection is incidental, not semantic: write a
-- note-only row as 'planned' for a future period and the clobber returns,
-- silently converting the teacher's note into a chapter-tagged teaching row
-- (the note text survives, since it is not in the SET list, which is worse than
-- losing it). The error is swallowed too, so nothing surfaces.
--
-- Base body copied verbatim from 20260704141000_syllabus_progress_rpcs.sql; the
-- ONLY changes are the picker guard and is_note_only in the ON CONFLICT list.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_syllabus_progress(
  p_class_id uuid, p_subject_id uuid, p_topic_id uuid,
  p_date date, p_action text, p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_slot  uuid;
  v_event uuid;
  v_lp    boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF p_action NOT IN ('completed','partial') OR p_source NOT IN ('checkout','checkin','correction') THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.syllabus_topics st
                 WHERE st.id = p_topic_id AND st.subject_id = p_subject_id) THEN
    RAISE EXCEPTION 'That chapter does not belong to this subject.';
  END IF;

  INSERT INTO public.syllabus_progress_events
    (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
  VALUES (v_inst, p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source, v_uid)
  ON CONFLICT (class_id, subject_id, topic_id, date)
  DO UPDATE SET action = EXCLUDED.action, source = EXCLUDED.source,
                recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_event;

  -- Coverage dual-write (best-effort — never blocks the event write): upgrade
  -- or create ONE tt_lesson_plans done row on a slot of this class+subject on
  -- p_date's weekday that doesn't already carry a done row for p_date.
  IF p_action = 'completed' THEN
    BEGIN
      SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
      WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;

      IF v_ay IS NOT NULL THEN
        SELECT s.id INTO v_slot
        FROM public.tt_slots s
        WHERE s.class_id = p_class_id AND s.subject_id = p_subject_id
          AND s.academic_year = v_ay
          AND s.slot_type IN ('theory','practical')
          AND s.day = public.tt_dow_to_text(p_date)
          -- is_note_only is checked explicitly rather than leaning on
          -- status='done': the teacher's record of what actually happened in a
          -- period is never a candidate to be overwritten, whatever its status.
          AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                          WHERE lp.slot_id = s.id AND lp.date = p_date
                            AND (lp.status = 'done' OR lp.is_note_only))
        ORDER BY s.id
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', p_topic_id, v_uid, now())
          ON CONFLICT (slot_id, date)
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, is_note_only = false,
                        updated_by = EXCLUDED.updated_by, updated_at = now();
          v_lp := true;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lp := false;  -- swallow: the event row above is the source of truth
    END;
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'lesson_plan_written', v_lp);
END;
$$;

REVOKE ALL ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) TO authenticated;

-- ---------------------------------------------------------------
-- 5. Badge metric and coordinator export.
--
-- Both are surgical one-clause edits inside long functions (evaluate_teacher_badges
-- is ~200 lines of unrelated badge logic; tt_lesson_plan_export ~200 lines of
-- two-sheet reporting). Rather than restate those bodies here, where a
-- transcription slip in untouched logic would ship silently, patch the LIVE
-- definition and fail loudly if the anchor is not found. Each block is
-- idempotent: re-running detects the patch and skips.
-- ---------------------------------------------------------------

-- 5a. 'Lessons taught' means chapter delivery. A logged surprise test is real
--     work but it is not a lesson, and the metric filters on status only.
DO $patch$
DECLARE
  v_def text;
  v_old text := E'  SELECT count(*)::int INTO v_lessons\n  FROM tt_lesson_plans lp\n  WHERE lp.owner_teacher_id = _user_id AND lp.status = ''done'';';
  v_new text := E'  SELECT count(*)::int INTO v_lessons\n  FROM tt_lesson_plans lp\n  WHERE lp.owner_teacher_id = _user_id AND lp.status = ''done''\n    AND lp.session_type = ''teaching'';';
BEGIN
  v_def := pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure);
  IF position(v_new in v_def) > 0 THEN
    RAISE NOTICE 'evaluate_teacher_badges already excludes note-only rows';
    RETURN;
  END IF;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'evaluate_teacher_badges: lessons-metric anchor not found, patch by hand';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch$;

-- 5b. The export already reports a note-only row as Filled with the note in the
--     notes column, which is right. Only the chapter cell was blank, which
--     reads like missing data rather than a deliberate non-chapter period.
DO $patch$
DECLARE
  v_def  text;
  v_old1 text := E'      lp.note AS teacher_note,\n';
  v_new1 text := E'      lp.note AS teacher_note,\n      lp.is_note_only AS is_note_only,\n';
  v_old2 text := E'    ''chapter'', chapter,\n';
  v_new2 text := E'    ''chapter'', COALESCE(chapter, CASE WHEN is_note_only THEN ''No chapter (activity logged)'' END),\n';
BEGIN
  v_def := pg_get_functiondef('public.tt_lesson_plan_export(text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  IF position('No chapter (activity logged)' in v_def) > 0 THEN
    RAISE NOTICE 'tt_lesson_plan_export already labels note-only rows';
    RETURN;
  END IF;
  IF position(v_old1 in v_def) = 0 OR position(v_old2 in v_def) = 0 THEN
    RAISE EXCEPTION 'tt_lesson_plan_export: anchors not found, patch by hand';
  END IF;
  EXECUTE replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
END $patch$;

-- ---------------------------------------------------------------
-- 6. Student read policy: notes are staff-private.
--
-- RLS cannot restrict columns, so this policy handed students the whole row
-- including `note`. No student code path selects it (useStudentWeekV2 reads
-- tt_slots and nulls slot notes), but the guarantee rested entirely on that
-- absence, and "pop quiz tomorrow" is exactly the note a student should not be
-- able to read over raw PostgREST. Verified: before this change a student in a
-- published class COULD read a note-only row.
--
-- Narrowed to teaching rows. Residual, tracked separately: chapter-mode notes
-- remain readable; the real fix there is dropping this policy (nothing reads
-- it) or a column-restricted view.
-- (select auth.uid()) per CLAUDE.md §23.13 while it is being rewritten anyway.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS tt_lesson_plans_select_student_published ON public.tt_lesson_plans;
CREATE POLICY tt_lesson_plans_select_student_published
  ON public.tt_lesson_plans FOR SELECT
  USING (
    public.has_role((select auth.uid()), 'student')
    AND status IN ('planned','done')
    AND session_type = 'teaching'
    AND EXISTS (
      SELECT 1
      FROM public.tt_class_structure cs
      JOIN public.class_assignments  ca ON ca.class_id = cs.class_id
      WHERE cs.class_id = tt_lesson_plans.class_id
        AND cs.publish_status = 'published'
        AND ca.user_id = (select auth.uid())
        AND ca.role    = 'student'
    )
  );
