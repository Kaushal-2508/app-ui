-- Achievements redesign, pass 1: the activity spine.
--
-- Context from the audit (2026-08-13):
--   * user_activity_log existed but was COMPLETELY EMPTY (0 rows) — nothing has
--     ever been logged, so the three criteria_type='streak' badges have been
--     evaluating against a head count of rows that do not exist.
--   * There is no streak table, no streak function and no server-side awarding
--     of any kind; useAutoBadgeAward runs in the BROWSER and inserts straight
--     into user_badges.
--   * user_badges' UNIQUE is (user_id, badge_id, source_entity_id) and all 1,225
--     rows have source_entity_id NULL. Postgres treats NULLs as distinct, so the
--     constraint has never fired and 45 duplicate awards are live.
--
-- This migration is additive and reuses user_activity_log rather than adding a
-- new table: it already carries exactly the right shape (user, type, date) and
-- its UNIQUE(user_id, activity_type, activity_date) gives per-day idempotency
-- for free. Being empty, there is no legacy data to reconcile.
--
-- Day rule agreed with product:
--   * A day is ACTIVE if the student submitted an exam (online or hybrid),
--     submitted homework, or opened a study material.
--   * A declared holiday (cal_events.kind='holiday') is NEUTRAL — it neither
--     breaks nor extends a streak.
--   * Every other day INCLUDING SUNDAY requires activity. Sundays are deliberately
--     not neutral: study material stays available for revision, so a Sunday can
--     be kept alive by any qualifying activity.
--   * Every date is institution-local per §24 — never a bare CURRENT_DATE.

-- ── 1. Activity capture ─────────────────────────────────────────────────────

-- Institution-local "today" for a given user. Centralised so no caller is
-- tempted to write CURRENT_DATE and reintroduce the 2026-05-25 UTC bug class.
CREATE OR REPLACE FUNCTION public.student_local_date(_user_id uuid)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date
  FROM profiles p
  LEFT JOIN institutions i ON i.id = p.institution_id
  WHERE p.id = _user_id;
$$;

-- Single write path for "this student did something today". Idempotent: the
-- same activity twice in a day bumps count rather than raising, so triggers and
-- client calls can both fire without coordination.
CREATE OR REPLACE FUNCTION public.log_student_activity(
  _user_id uuid,
  _activity_type text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid;
  v_date date;
BEGIN
  IF _user_id IS NULL OR _activity_type IS NULL THEN RETURN; END IF;
  -- Only the types that can keep a streak alive are accepted; anything else is
  -- ignored rather than silently widening what "active" means.
  IF _activity_type NOT IN ('exam_submitted','homework_submitted','study_material_opened') THEN
    RETURN;
  END IF;

  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = _user_id;
  v_date := public.student_local_date(_user_id);
  IF v_date IS NULL THEN RETURN; END IF;

  INSERT INTO user_activity_log (user_id, institution_id, activity_type, activity_date, count, metadata)
  VALUES (_user_id, v_inst, _activity_type, v_date, 1, COALESCE(_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, activity_type, activity_date)
  DO UPDATE SET count = user_activity_log.count + 1;
END $$;

-- The streak walk scans one student's days in date order; without this it is a
-- seq scan of the whole log per student per page load (§23).
CREATE INDEX IF NOT EXISTS user_activity_log_user_date_idx
  ON user_activity_log (user_id, activity_date DESC);

-- ── 2. Event triggers — awarding must not depend on the student opening a page ──

CREATE OR REPLACE FUNCTION public.tg_log_exam_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Fire once, on the transition into submitted.
  IF NEW.is_submitted = true AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_submitted, false) = false) THEN
    PERFORM public.log_student_activity(
      NEW.student_id, 'exam_submitted',
      jsonb_build_object('exam_id', NEW.exam_id, 'attempt_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_exam_submitted ON student_exam_attempts;
CREATE TRIGGER trg_log_exam_submitted
  AFTER INSERT OR UPDATE OF is_submitted ON student_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_exam_submitted();

CREATE OR REPLACE FUNCTION public.tg_log_homework_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_student_activity(
    NEW.student_id, 'homework_submitted',
    jsonb_build_object('assignment_id', NEW.homework_assignment_id, 'submission_id', NEW.id));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_homework_submitted ON homework_submissions;
CREATE TRIGGER trg_log_homework_submitted
  AFTER INSERT ON homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_homework_submitted();

-- Hybrid exams are a SEPARATE data plane from student_exam_attempts and have
-- never counted toward any badge. They count now.
CREATE OR REPLACE FUNCTION public.tg_log_hybrid_exam_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.submitted_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.submitted_at IS NULL) THEN
    PERFORM public.log_student_activity(
      NEW.student_id, 'exam_submitted',
      jsonb_build_object('hybrid_attempt_id', NEW.id, 'mode', 'hybrid'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_hybrid_exam_submitted ON hybrid_exam_attempts;
CREATE TRIGGER trg_log_hybrid_exam_submitted
  AFTER INSERT OR UPDATE OF submitted_at ON hybrid_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_hybrid_exam_submitted();

-- Study material opens are logged from the client for now (the PDF opens in a
-- new tab at a storage URL, so there is no server-side event to hang a trigger
-- on and no way to measure dwell). Dwell-gating is deferred: when an in-app
-- viewer exists, this RPC gains a _dwell_seconds argument and rejects short
-- opens, and nothing else in the chain has to change.
CREATE OR REPLACE FUNCTION public.log_study_material_open(_material_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  -- Only count materials the caller can actually see, so the endpoint cannot be
  -- used to farm streak days against arbitrary uuids.
  IF NOT EXISTS (
    SELECT 1 FROM study_materials sm
    WHERE sm.id = _material_id
      AND sm.is_active
      AND sm.institution_id = public.get_user_institution(v_uid)
  ) THEN
    RETURN;
  END IF;
  PERFORM public.log_student_activity(v_uid, 'study_material_opened',
                                      jsonb_build_object('material_id', _material_id));
END $$;

-- ── 3. Streak computation ───────────────────────────────────────────────────

-- Current streak for one student, walking back from today.
--   holiday  -> skipped entirely (neutral)
--   active   -> extends
--   inactive -> stops the walk
-- Today not being active yet does NOT break the streak; the walk starts at
-- yesterday in that case, otherwise every student's streak would read 0 until
-- they did something each morning.
CREATE OR REPLACE FUNCTION public.student_streak(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := COALESCE(_user_id, auth.uid());
  v_inst uuid;
  v_today date;
  v_cursor date;
  v_streak int := 0;
  v_active boolean;
  v_holiday boolean;
  v_guard int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT p.institution_id INTO v_inst FROM profiles p WHERE p.id = v_uid;
  v_today := public.student_local_date(v_uid);
  IF v_today IS NULL THEN RETURN jsonb_build_object('current', 0, 'as_of', NULL); END IF;

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

    SELECT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst AND ce.kind = 'holiday'
        AND v_cursor BETWEEN ce.starts_on::date AND ce.ends_on::date
    ) INTO v_holiday;

    IF v_holiday THEN
      v_cursor := v_cursor - 1;          -- neutral: neither breaks nor extends
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

-- ── 4. Fix the duplicate-award hole ─────────────────────────────────────────

-- 45 duplicate (user_id, badge_id) pairs are live because the existing UNIQUE
-- includes source_entity_id, which is NULL on all 1,225 rows and therefore
-- never conflicts. Keep the earliest award of each pair.
DELETE FROM user_badges ub
USING (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, badge_id ORDER BY earned_at, id) AS rn
  FROM user_badges
) d
WHERE ub.id = d.id AND d.rn > 1;

-- period_key carries the window a re-earnable badge was earned in ('2026-08').
-- NULL for every normal one-time badge, so the partial index below behaves as a
-- plain one-award-per-badge rule for them while still allowing Player of the
-- Month to be earned once per month.
ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS period_key text;

CREATE UNIQUE INDEX IF NOT EXISTS user_badges_once_per_period_idx
  ON user_badges (user_id, badge_id, COALESCE(period_key, ''));

-- ── 5. Rename the eight exact-match badges in place ─────────────────────────
-- Same id, same criteria, same tier, same points — only the display label
-- changes, so all 1,090+ earned records follow the rename untouched.
UPDATE badge_definitions SET name = 'Debut',           updated_at = now() WHERE name = 'First Step';
UPDATE badge_definitions SET name = 'Regular Starter', updated_at = now() WHERE name = 'Exam Explorer';
UPDATE badge_definitions SET name = 'Iron Man',        updated_at = now() WHERE name = 'Exam Veteran';
UPDATE badge_definitions SET name = 'First XI',        updated_at = now() WHERE name = 'Exam Master';
UPDATE badge_definitions SET name = 'Clean Hit',       updated_at = now() WHERE name = 'Rising Star';
UPDATE badge_definitions SET name = 'MVP Round',       updated_at = now() WHERE name = 'High Achiever';
UPDATE badge_definitions SET name = 'Ace',             updated_at = now() WHERE name = 'Excellence Award';
UPDATE badge_definitions SET name = 'Century',         updated_at = now() WHERE name = 'Perfect Score';

-- ── 6. Grants ───────────────────────────────────────────────────────────────
-- Supabase's ALTER DEFAULT PRIVILEGES hands EXECUTE to anon on every new public
-- function and REVOKE FROM PUBLIC does not strip it, so revoke by name.
REVOKE EXECUTE ON FUNCTION public.log_student_activity(uuid, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.student_local_date(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_study_material_open(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.student_streak(uuid) FROM anon;

-- log_student_activity stays server-only: it takes a user_id, so exposing it to
-- authenticated would let any student write activity rows for anyone else.
-- Clients reach it only through log_study_material_open, which derives the user
-- from auth.uid() and checks the material is visible to them.
GRANT EXECUTE ON FUNCTION public.log_study_material_open(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_streak(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_local_date(uuid) TO authenticated;