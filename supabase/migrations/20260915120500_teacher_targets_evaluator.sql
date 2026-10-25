-- Teacher Targets, part 6 of 7: the nightly evaluator.
--
-- Plain SQL under pg_cron, not an edge function: every period-evaluation job in
-- this repo is a plain SECURITY DEFINER function, and an edge function would
-- import a 10s ceiling that SQL does not have.
--
-- NAMING: `tgt_`, never `tt_` -- `tt_` is the Timetable module's namespace
-- (CLAUDE.md 7). This brief originally spelled this tt_evaluate_targets and
-- called tt_target_periods/tt_count_exams_published/tt_count_homework_published;
-- renamed/repointed to the tgt_ names Tasks 2-4 actually shipped.
--
-- HOLIDAYS ARE NOT SUBTRACTED, deliberately. A target counts work produced over
-- a wall-clock window, not a school-day rate. Two incompatible definitions of
-- "school day" already ship (award_player_of_the_month subtracts only
-- cal_events kind='holiday' and counts Sundays; get-working-days subtracts
-- holidays, exam_blocks and weekends), and adopting either would make this
-- feature disagree with the other one.

CREATE OR REPLACE FUNCTION public.tgt_evaluate_targets(_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_t        record;
  v_p        record;
  v_today    date;
  v_tz       text;
  v_achieved integer;
  v_opened   integer := 0;
  v_closed   integer := 0;
BEGIN
  FOR v_t IN
    SELECT tt.*, COALESCE(i.timezone,'Asia/Kolkata') AS tz
    FROM public.teacher_targets tt
    JOIN public.institutions i ON i.id = tt.institution_id
    WHERE tt.scope = 'teacher'
      AND tt.status = 'active'
      AND (_institution_id IS NULL OR tt.institution_id = _institution_id)
    ORDER BY tt.id                      -- deterministic lock order
  LOOP
    v_tz    := v_t.tz;
    v_today := (now() AT TIME ZONE v_tz)::date;      -- CLAUDE.md 24

    FOR v_p IN
      SELECT * FROM public.tgt_periods(
        v_t.starts_on, v_t.ends_on, v_t.cadence_unit, v_t.cadence_n, v_today)
    LOOP
      -- Never touch a period that has already been closed: its numbers are
      -- frozen, and the source rows behind them may since have been deleted.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.teacher_target_periods x
        WHERE x.target_id = v_t.id AND x.period_index = v_p.period_index
          AND x.status <> 'open');

      v_achieved := CASE v_t.metric
        WHEN 'exams_published' THEN
          public.tgt_count_exams_published(v_t.owner_id, v_t.institution_id,
                                           v_p.period_start, v_p.period_end)
        WHEN 'homework_published' THEN
          public.tgt_count_homework_published(v_t.owner_id, v_t.institution_id,
                                              v_p.period_start, v_p.period_end, v_tz)
      END;

      INSERT INTO public.teacher_target_periods
        (target_id, institution_id, teacher_id, period_index, period_start, period_end,
         target_value, achieved_value, status)
      VALUES
        (v_t.id, v_t.institution_id, v_t.owner_id, v_p.period_index,
         v_p.period_start, v_p.period_end, v_t.target_value, v_achieved, 'open')
      -- The constraint is NAMED: a bare DO NOTHING would fire on any unique
      -- index on the table and silently drop the row.
      ON CONFLICT ON CONSTRAINT teacher_target_periods_target_period_key
      DO UPDATE SET achieved_value = EXCLUDED.achieved_value,
                    target_value   = EXCLUDED.target_value,
                    updated_at     = now()
      WHERE public.teacher_target_periods.status = 'open';

      v_opened := v_opened + 1;

      -- Close it once the window has passed.
      IF v_p.period_end < v_today THEN
        UPDATE public.teacher_target_periods p
        SET status    = CASE WHEN p.achieved_value >= p.target_value THEN 'met' ELSE 'missed' END,
            closed_at = now(),
            updated_at = now()
        WHERE p.target_id = v_t.id AND p.period_index = v_p.period_index
          AND p.status = 'open';
        v_closed := v_closed + 1;
      END IF;
    END LOOP;

    -- Expiry completes the target, it never deletes it.
    IF v_t.ends_on < v_today THEN
      UPDATE public.teacher_targets SET status = 'completed', updated_at = now()
       WHERE id = v_t.id AND status = 'active';
    END IF;
  END LOOP;

  -- Tell the teacher they came up short. notified_at makes this fire exactly
  -- once per period, however many times the job runs.
  WITH due AS (
    SELECT p.id, p.teacher_id, p.target_value, p.achieved_value, t.metric
    FROM public.teacher_target_periods p
    JOIN public.teacher_targets t ON t.id = p.target_id
    WHERE p.status = 'missed' AND p.notified_at IS NULL
      AND (_institution_id IS NULL OR p.institution_id = _institution_id)
    ORDER BY p.id
  ),
  ins AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT d.teacher_id, 'target_period_missed',
           'Target period closed',
           'Your target period has closed at ' || d.achieved_value || ' of ' || d.target_value || '.',
           '/teacher/my-targets',
           jsonb_build_object('metric', d.metric, 'achieved', d.achieved_value,
                              'target', d.target_value)
    FROM due d
    RETURNING 1
  )
  UPDATE public.teacher_target_periods p
  SET notified_at = now()
  FROM due d WHERE p.id = d.id;

  -- Wing pools expire too; they carry no periods of their own to close.
  UPDATE public.teacher_targets tt
  SET status = 'completed', updated_at = now()
  FROM public.institutions i
  WHERE i.id = tt.institution_id
    AND tt.scope = 'wing' AND tt.status = 'active'
    AND tt.ends_on < (now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date
    AND (_institution_id IS NULL OR tt.institution_id = _institution_id);

  RETURN jsonb_build_object('ok', true, 'periods_touched', v_opened, 'periods_closed', v_closed);
END $fn$;

-- Cron and ops only, never client callable (unlike Task 5's two read RPCs).
REVOKE ALL ON FUNCTION public.tgt_evaluate_targets(uuid) FROM PUBLIC, anon, authenticated;

-- 00:35 UTC. The 00:20 to 00:45 band already holds student-activity-daily
-- (00:20), teacher-engagement-monthly (00:25), badges-player-of-the-month
-- (00:30, days 1-4 only) and achievements-year-end-aggregates (00:45) -
-- confirmed free via `SELECT jobname, schedule FROM cron.job` before this
-- migration was written.
--
-- Unschedule-then-schedule, NOT the "WHERE NOT EXISTS" form: that form never
-- updates an existing job's schedule, so a later edit here would be a no-op on
-- prod.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('teacher-targets-daily');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('teacher-targets-daily', '35 0 * * *',
                          $job$ SELECT public.tgt_evaluate_targets(); $job$);
  ELSE
    RAISE NOTICE 'pg_cron not installed: teacher-targets-daily was NOT scheduled.';
  END IF;
END;
$$;
