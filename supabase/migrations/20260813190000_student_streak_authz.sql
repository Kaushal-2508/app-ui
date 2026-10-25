-- Authorisation guard for public.student_streak(uuid).
--
-- The function resolves its subject as COALESCE(_user_id, auth.uid()) and is
-- SECURITY DEFINER with EXECUTE granted to `authenticated`. That combination is
-- the "never authenticate a DEFINER RPC through COALESCE(arg, resolver())" trap:
-- passing the argument silently bypasses the resolver, so any signed-in user
-- could read any other user's streak by uuid, including across institutions.
--
-- Only a streak integer leaks, but it is still a cross-tenant read and the
-- dashboard is about to call this from a second surface, so close it now.
--
-- The guard is deliberately conditional on there BEING a session:
--   * client call  -> auth.uid() is non-null, so the caller may only ask about
--                     themselves.
--   * internal call-> the evaluator and the cron jobs are SECURITY DEFINER and
--                     run with auth.uid() NULL, and legitimately evaluate other
--                     students. Requiring a match unconditionally would break
--                     award_year_end_badges and award_player_of_the_month.
--
-- Only the guard is added; the streak walk below it is unchanged.

CREATE OR REPLACE FUNCTION public.student_streak(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_uid uuid := COALESCE(_user_id, v_caller);
  v_inst uuid;
  v_today date;
  v_cursor date;
  v_streak int := 0;
  v_active boolean;
  v_holiday boolean;
  v_guard int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- A caller with a session may only ask about themselves. No session means an
  -- internal SECURITY DEFINER caller (evaluator / cron), which may ask about anyone.
  IF v_caller IS NOT NULL AND v_uid <> v_caller THEN
    RAISE EXCEPTION 'not authorised to read another user''s streak';
  END IF;

  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = v_uid;
  v_today := public.student_local_date(v_uid);
  IF v_today IS NULL THEN
    RETURN jsonb_build_object('current', 0, 'as_of', NULL, 'active_today', false);
  END IF;

  v_cursor := v_today;
  -- Grace for today: an unfinished today is not a broken streak.
  IF NOT EXISTS (SELECT 1 FROM user_activity_log ual
                 WHERE ual.user_id = v_uid AND ual.activity_date = v_today) THEN
    v_cursor := v_today - 1;
  END IF;

  -- Bounded walk: a streak cannot exceed one academic year, and the guard stops
  -- any pathological loop from running away inside a request.
  WHILE v_guard < 400 LOOP
    v_guard := v_guard + 1;

    -- A declared holiday is neutral: it neither breaks nor extends the streak.
    SELECT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst
        AND ce.kind = 'holiday'
        AND v_cursor BETWEEN ce.starts_on::date AND ce.ends_on::date
    ) INTO v_holiday;

    IF v_holiday THEN
      v_cursor := v_cursor - 1;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM user_activity_log ual
      WHERE ual.user_id = v_uid AND ual.activity_date = v_cursor
    ) INTO v_active;

    EXIT WHEN NOT v_active;

    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  END LOOP;

  RETURN jsonb_build_object(
    'current', v_streak,
    'as_of', to_char(v_today, 'YYYY-MM-DD'),
    'active_today', EXISTS (SELECT 1 FROM user_activity_log ual
                            WHERE ual.user_id = v_uid AND ual.activity_date = v_today)
  );
END $$;

-- FROM PUBLIC, not just FROM anon: Supabase's default privileges grant EXECUTE
-- to PUBLIC and anon inherits through it (see 20260813145000).
REVOKE ALL ON FUNCTION public.student_streak(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_streak(uuid) TO authenticated;