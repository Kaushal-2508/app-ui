-- Achievements redesign, pass 3: the SCHEDULED jobs.
--
-- Two processes that cannot be driven by a student page view or a row trigger,
-- because they are decided across a whole cohort at a fixed point in time:
--
--   * award_player_of_the_month()  — monthly, re-earnable, period_key='YYYY-MM'.
--   * award_year_end_badges()      — the four ACADEMIC-YEAR-END legendary badges
--                                    (Undefeated, Class MVP, All-Star, Immortal).
--
-- Both are idempotent. Every award goes in with ON CONFLICT DO NOTHING against
-- user_badges_once_per_period_idx (user_id, badge_id, COALESCE(period_key,''))
-- from 20260813140000, so a re-run, an overlapping cron tick, or a manual ops
-- call can never double-award. Nothing here ever deletes or rewrites the 1,180
-- badge rows already live. Every award also emits a 'badge_earned' notification,
-- mirroring the evaluator (20260813160000) — a 500-point Immortal that nobody is
-- told about is not an award.
--
-- DEPENDENCY: the badge_definitions rows are owned by the catalog migration
-- (20260813150000). This file NEVER writes badge_definitions. It resolves them
-- by (badge_type='student', name, category), reads their criteria_value as the
-- tunable threshold, and skips — with a WARNING in the cron log — any badge that
-- is missing or inactive, rather than failing the run. Names are the locked
-- product names: 'Undefeated', 'Class MVP', 'All-Star', 'Immortal' in category
-- 'legendary', 'Player of the Month' in 'monthly_form'. badge_definitions.name
-- has NO unique constraint and teacher/coordinator badges may legally share a
-- name, hence the badge_type filter on every lookup.
--
-- criteria_value is honoured, not hardcoded (contract vocabulary):
--   subject_avg_min     (Undefeated) -> minimum per-subject yearly average
--   streak_percentile   (All-Star)   -> top N percent of the streak leaderboard
--   streak_full_year    (Immortal)   -> percent of the year's non-holiday days
--   active_days_in_month (PotM)      -> the CAP; real target is
--                                       LEAST(cap, ceil(0.6 * school_days))
-- class_first_place_count (Class MVP) is a RANK-BASED SENTINEL, never a
-- threshold: the highest first-place count per class wins, exactly one MVP.
--
-- Result universe (shared by every badge below):
--   * ONLINE/OFFLINE: final_results (is_published) joined to student_exam_attempts
--     via attempt_id. final_results has no student_id/exam_id/class_id of its own —
--     all three come from the attempt, and attempt_id is NOT NULL, so the join is
--     total. percentage is the GENERATED column and is only ever READ (§9).
--   * HYBRID: hybrid_exam_attempts with status='evaluated' — a SEPARATE data plane
--     that never reaches final_results, so it has to be UNIONed in explicitly.
--     Product decision: hybrid and offline exams count the same as online.
--   * One score per (student, exam): a retake or a stray duplicate collapses to the
--     best percentage, so a student cannot out-rank a classmate by sitting twice.
--   * Every row is dated by when the student SAT the exam, never by when a teacher
--     published it. Teachers bulk-publish whole terms at once, so published_at is
--     near-constant across a batch and any ordering built on it is arbitrary. The
--     window filter and the Class MVP tiebreak now use the same sit-date key.
--   * §24: every window is institution-local —
--     (<timestamptz> AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date.
--     There is not one bare CURRENT_DATE / now()::date in this file.
--
-- §23: all counting, ranking and percentile work is server-side set logic. There
-- is no per-row function call left: the All-Star leaderboard is a gaps-and-islands
-- query over user_activity_log inside the year window (see §1 All-Star), not a
-- student_streak() call per student.

-- Holiday lookups here are `institution_id = ? AND kind = ? AND ? BETWEEN
-- starts_on AND ends_on`, which is a two-column range that cannot seek on
-- trailing index columns anyway, and cal_events holds at most a few dozen rows
-- per institution. idx_cal_events_dates (institution_id, starts_on, ends_on)
-- from 20260424100000 already covers it; a (institution_id, kind, starts_on,
-- ends_on) index would be pure write overhead and planner noise. Dropped here in
-- case an earlier run of this migration created it.
DROP INDEX IF EXISTS cal_events_institution_kind_dates_idx;

-- ── 1. Year-end legendary badges ────────────────────────────────────────────
--
-- Undefeated : average the student's exam percentages PER SUBJECT across the
--              academic year; award only if EVERY subject average >= the badge's
--              criteria_value (subject_avg_min). Exams with no exam_subjects row
--              are excluded (they cannot be attributed to a subject, and 14 of
--              1,127 exams have none). Floors apply — see c_undefeated_min_*.
-- Class MVP  : count first-place finishes per student within the class they sat
--              the exam in; highest count takes the class. EXACTLY ONE per class
--              (DISTINCT ON), tiebreak highest overall average, then earliest
--              first place BY SIT DATE, then user id so the outcome is
--              deterministic.
-- Immortal   : active on >= criteria_value percent (streak_full_year, 100 = all)
--              of the year's non-holiday days. The day count is derived from
--              cal_academic_years — never hardcoded — and is measured against the
--              year window itself rather than the live streak, so a student who
--              lapses the day AFTER the year ends does not retroactively lose the
--              year they actually completed.
-- All-Star   : top criteria_value percent (streak_percentile) of the school-wide
--              leaderboard of LONGEST STREAK ACHIEVED INSIDE THE YEAR. Zero
--              streaks excluded.
--
-- The old signature took only _institution_id; it is dropped so the new
-- two-argument form is unambiguous for existing callers.
DROP FUNCTION IF EXISTS public.award_year_end_badges(uuid);

CREATE OR REPLACE FUNCTION public.award_year_end_badges(
  _institution_id   uuid DEFAULT NULL,
  _academic_year_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- Floors for Undefeated. The locked spec gives a per-subject average bar but no
  -- volume bar, and without one a single published 90% in a single subject earns a
  -- 300-point legendary badge, outranking a student who sat 20 exams at 89%. Same
  -- reasoning (and the same number) as c_grand_slam_min_exams in the evaluator.
  c_undefeated_min_exams    CONSTANT int := 10;
  c_undefeated_min_subjects CONSTANT int := 2;
  -- How far past ends_on a closed year is still eligible to be processed.
  c_year_end_window         CONSTANT int := 30;

  v_undefeated uuid;
  v_class_mvp  uuid;
  v_all_star   uuid;
  v_immortal   uuid;

  v_undefeated_min_avg int;   -- criteria_value: subject_avg_min
  v_all_star_pct       int;   -- criteria_value: streak_percentile
  v_immortal_pct       int;   -- criteria_value: streak_full_year

  v_inst       record;
  v_holidays   int;
  v_counts     jsonb;
  v_result     jsonb := '{}'::jsonb;
BEGIN
  -- badge_type = 'student' on every lookup: name is not unique and a teacher or
  -- coordinator badge sharing one of these names would otherwise be written into
  -- students' user_badges rows.
  SELECT bd.id, bd.criteria_value INTO v_undefeated, v_undefeated_min_avg
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Undefeated'
     AND bd.category = 'legendary' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  SELECT bd.id INTO v_class_mvp
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Class MVP'
     AND bd.category = 'legendary' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  SELECT bd.id, bd.criteria_value INTO v_all_star, v_all_star_pct
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'All-Star'
     AND bd.category = 'legendary' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  SELECT bd.id, bd.criteria_value INTO v_immortal, v_immortal_pct
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Immortal'
     AND bd.category = 'legendary' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  -- Sane bounds if the catalog row is missing or has been hand-edited to nonsense.
  v_undefeated_min_avg := LEAST(GREATEST(COALESCE(v_undefeated_min_avg, 90), 1), 100);
  v_all_star_pct       := LEAST(GREATEST(COALESCE(v_all_star_pct, 1), 1), 100);
  v_immortal_pct       := LEAST(GREATEST(COALESCE(v_immortal_pct, 100), 1), 100);

  IF v_undefeated IS NULL AND v_class_mvp IS NULL
     AND v_all_star IS NULL AND v_immortal IS NULL THEN
    RAISE WARNING 'award_year_end_badges: no active student legendary badge definitions found (expected Undefeated / Class MVP / All-Star / Immortal in category=legendary) - nothing awarded';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_badge_definitions');
  END IF;

  -- Resolve the year to CLOSE by DATE, never by ay.is_active. is_active always
  -- points at the year currently RUNNING: 20260424100000 puts a partial UNIQUE on
  -- (institution_id) WHERE is_active, and useAcademicCalendar.ts flips the new
  -- year active at rollover. Gating on is_active means that the moment a school
  -- rolls over, ends_on is ~12 months out, the "past the end of the year" test is
  -- never true again, and the ENTIRE legendary tier dies permanently with no
  -- recovery path. Pass _academic_year_id to re-run any closed year on demand.
  FOR v_inst IN
    SELECT DISTINCT ON (i.id)
           i.id                                     AS institution_id,
           COALESCE(i.timezone, 'Asia/Kolkata')     AS tz,
           ay.id                                    AS ay_id,
           ay.code                                  AS ay_code,
           ay.starts_on,
           ay.ends_on
    FROM institutions i
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date AS local_today
    ) t
    JOIN cal_academic_years ay
      ON ay.institution_id = i.id
     AND (
           (_academic_year_id IS NOT NULL AND ay.id = _academic_year_id)
        OR (_academic_year_id IS NULL
            AND ay.ends_on <  t.local_today
            AND ay.ends_on >= t.local_today - c_year_end_window)
         )
    WHERE (_institution_id IS NULL OR i.id = _institution_id)
    ORDER BY i.id, ay.ends_on DESC
  LOOP
    -- A missing holiday calendar is not a neutral omission here: Sundays are NOT
    -- neutral in the day rule, so with zero declared holidays Immortal demands
    -- activity on all ~365 calendar days including the entire summer break, and
    -- the All-Star leaderboard collapses toward zero. Say so loudly rather than
    -- silently awarding nobody a 500-point badge.
    SELECT count(*)::int INTO v_holidays
    FROM cal_events ce
    WHERE ce.institution_id = v_inst.institution_id
      AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_inst.ends_on
      AND COALESCE(ce.ends_on, ce.starts_on)::date >= v_inst.starts_on;

    IF v_holidays = 0 THEN
      RAISE WARNING 'award_year_end_badges: institution % has ZERO cal_events(kind=holiday) rows overlapping academic year % (% .. %). Immortal then requires activity on EVERY calendar day incl. Sundays and vacation, and All-Star ranks streaks that cannot survive an undeclared break - both are effectively unreachable until the holiday calendar is filled in.',
        v_inst.institution_id, COALESCE(v_inst.ay_code, '?'), v_inst.starts_on, v_inst.ends_on;
    END IF;

    WITH raw_scores AS (
      -- Online + offline: the published result, dated by when the student
      -- actually sat it (results-only uploads have no submitted_at, so fall
      -- back to finalization). sat_at is the SAME expression as the window
      -- filter, so the Class MVP tiebreak and the year window agree.
      SELECT a.student_id,
             a.class_id,
             a.exam_id,
             fr.percentage::numeric                    AS pct,
             COALESCE(a.submitted_at, fr.finalized_at) AS sat_at
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e                 ON e.id = a.exam_id
      WHERE e.institution_id = v_inst.institution_id
        AND e.status IN ('published', 'active', 'completed')
        AND fr.is_published
        AND fr.total_max_marks > 0
        AND (COALESCE(a.submitted_at, fr.finalized_at) AT TIME ZONE v_inst.tz)::date
            BETWEEN v_inst.starts_on AND v_inst.ends_on
      UNION ALL
      -- Hybrid: 'evaluated' is the marked-and-visible state on this plane.
      SELECT h.student_id,
             h.class_id,
             h.exam_id,
             round((h.total_marks_awarded / h.total_max_marks) * 100, 2),
             COALESCE(h.submitted_at, h.evaluated_at, h.started_at)
      FROM hybrid_exam_attempts h
      WHERE h.institution_id = v_inst.institution_id
        AND h.status = 'evaluated'
        AND COALESCE(h.total_max_marks, 0) > 0
        AND (COALESCE(h.submitted_at, h.evaluated_at, h.started_at) AT TIME ZONE v_inst.tz)::date
            BETWEEN v_inst.starts_on AND v_inst.ends_on
    ),
    scores AS (
      SELECT DISTINCT ON (student_id, exam_id)
             student_id, class_id, exam_id, pct, sat_at
      FROM raw_scores
      ORDER BY student_id, exam_id, pct DESC, sat_at
    ),
    students AS (
      SELECT DISTINCT ca.user_id AS student_id
      FROM class_assignments ca
      JOIN profiles p ON p.id = ca.user_id
      WHERE ca.role = 'student'
        AND p.institution_id = v_inst.institution_id
    ),

    -- Undefeated ----------------------------------------------------------
    subject_avgs AS (
      SELECT s.student_id, es.subject_id, avg(s.pct) AS subject_avg
      FROM scores s
      JOIN exam_subjects es ON es.exam_id = s.exam_id
      GROUP BY 1, 2
    ),
    subject_exam_counts AS (
      -- Distinct EXAMS behind those subject averages. An exam can carry several
      -- exam_subjects rows, so summing per-subject counts would overstate volume.
      SELECT s.student_id, count(DISTINCT s.exam_id)::int AS n_exams
      FROM scores s
      JOIN exam_subjects es ON es.exam_id = s.exam_id
      GROUP BY 1
    ),
    undefeated AS (
      -- Real floors. `count(*) > 0` inside a GROUP BY is always true, so the
      -- previous guard enforced nothing at all.
      SELECT sa.student_id,
             count(*)::int                 AS n_subjects,
             ec.n_exams,
             round(min(sa.subject_avg), 2) AS weakest_subject_avg
      FROM subject_avgs sa
      JOIN subject_exam_counts ec ON ec.student_id = sa.student_id
      GROUP BY sa.student_id, ec.n_exams
      HAVING count(*) >= c_undefeated_min_subjects
         AND ec.n_exams >= c_undefeated_min_exams
         AND min(sa.subject_avg) >= v_undefeated_min_avg
    ),

    -- Class MVP -----------------------------------------------------------
    per_exam AS (
      SELECT s.class_id, s.exam_id, s.student_id, s.pct, s.sat_at,
             rank()   OVER (PARTITION BY s.class_id, s.exam_id ORDER BY s.pct DESC) AS rk,
             count(*) OVER (PARTITION BY s.class_id, s.exam_id)                     AS cohort
      FROM scores s
    ),
    class_sizes AS (
      SELECT class_id, count(DISTINCT student_id)::int AS n_students
      FROM scores GROUP BY 1
    ),
    overall AS (
      SELECT student_id, avg(pct) AS overall_avg FROM scores GROUP BY 1
    ),
    wins AS (
      -- DELIBERATE DEVIATION from the locked spec, kept on purpose: the spec says
      -- only "count first places, highest count per class wins". These two cohort
      -- gates are additions.
      --   (a) pe.cohort >= 2 here: an exam where only ONE result in the class is
      --       published is not a first place, it is the only place. Without this
      --       a single early publish crowns an MVP over a full class.
      --   (b) cs.n_students >= 2 below: a class with one scoring student has no
      --       contest to win.
      -- Product-visible consequence, accepted: small or thinly-published classes
      -- produce NO MVP rather than an unearned one. Revisit only with the product
      -- owner; do not "simplify" these away.
      SELECT pe.class_id, pe.student_id,
             count(*)      FILTER (WHERE pe.rk = 1 AND pe.cohort >= 2)::int AS n_wins,
             min(pe.sat_at) FILTER (WHERE pe.rk = 1 AND pe.cohort >= 2)     AS first_win_at
      FROM per_exam pe
      GROUP BY 1, 2
    ),
    class_mvp AS (
      SELECT DISTINCT ON (w.class_id)
             w.class_id, w.student_id, w.n_wins, o.overall_avg
      FROM wins w
      JOIN class_sizes cs ON cs.class_id = w.class_id AND cs.n_students >= 2
      JOIN overall o      ON o.student_id = w.student_id
      WHERE w.n_wins > 0
      -- first_win_at is the SIT date, not the publish date: bulk publishing makes
      -- published_at near-constant across a term and would collapse this tiebreak
      -- onto the final student_id sort.
      ORDER BY w.class_id, w.n_wins DESC, o.overall_avg DESC, w.first_win_at, w.student_id
    ),

    -- Immortal + All-Star -------------------------------------------------
    -- Both read the same in-window day series. Holidays are removed entirely, so
    -- they are neutral (neither extend nor break), exactly as student_streak()
    -- treats them in its backward walk.
    year_days AS (
      SELECT d::date AS day
      FROM generate_series(v_inst.starts_on::timestamp,
                           v_inst.ends_on::timestamp,
                           interval '1 day') d
      WHERE NOT EXISTS (
        SELECT 1 FROM cal_events ce
        WHERE ce.institution_id = v_inst.institution_id
          AND ce.kind = 'holiday'
          AND d::date BETWEEN ce.starts_on::date
                          AND COALESCE(ce.ends_on, ce.starts_on)::date
      )
    ),
    year_day_seq AS (
      -- Ordinal position among non-holiday days: consecutive ordinals are
      -- "consecutive" for streak purposes even across a holiday block.
      SELECT yd.day, row_number() OVER (ORDER BY yd.day) AS ord
      FROM year_days yd
    ),
    required_days AS (
      SELECT count(*)::int AS n_year_days,
             GREATEST(1, ceil(count(*) * v_immortal_pct / 100.0))::int AS required
      FROM year_days
    ),
    active_days AS (
      -- DISTINCT because user_activity_log is unique per (user, type, date) and a
      -- student can log several activity types on one day.
      SELECT DISTINCT s.student_id, ds.ord
      FROM students s
      JOIN user_activity_log ual ON ual.user_id = s.student_id
      JOIN year_day_seq ds       ON ds.day = ual.activity_date
    ),
    year_active AS (
      SELECT ad.student_id, count(*)::int AS n_days
      FROM active_days ad
      GROUP BY 1
    ),
    immortal AS (
      SELECT ya.student_id, ya.n_days, rd.n_year_days, rd.required
      FROM year_active ya CROSS JOIN required_days rd
      WHERE rd.n_year_days > 0 AND ya.n_days >= rd.required
    ),
    -- All-Star ranks the LONGEST RUN ACHIEVED INSIDE THE YEAR, not the live
    -- streak. This job runs days AFTER ends_on, i.e. during vacation: a live
    -- student_streak() call reads a holiday-neutral walk backwards from today,
    -- and at any school that has not declared its break (Alliance has zero
    -- kind='holiday' rows) every streak reads 0 the first inactive day and the
    -- badge is awarded to nobody, forever. Gaps-and-islands over the ordinal
    -- series is the in-window equivalent and needs no per-student function call.
    runs AS (
      SELECT student_id,
             ord - row_number() OVER (PARTITION BY student_id ORDER BY ord) AS grp
      FROM active_days
    ),
    longest_run AS (
      SELECT r.student_id, max(r.len)::int AS streak
      FROM (SELECT student_id, grp, count(*) AS len
            FROM runs GROUP BY 1, 2) r
      GROUP BY 1
    ),
    streak_board AS (
      SELECT student_id, streak,
             row_number() OVER (ORDER BY streak DESC, student_id) AS rn,
             count(*)     OVER ()                                 AS n
      FROM longest_run
      WHERE streak > 0                    -- a zero streak is never "top of the board"
    ),
    all_star AS (
      -- ceil() so a small school can still produce one winner; row_number (not
      -- rank) hard-caps the award at the top N% so a flat leaderboard cannot hand
      -- a 250-point legendary badge to the entire school on a tie.
      SELECT student_id, streak, n
      FROM streak_board
      WHERE rn <= GREATEST(1, ceil(n * v_all_star_pct / 100.0))
    ),

    winners AS (
      SELECT u.student_id, v_undefeated AS badge_id,
             jsonb_build_object('badge', 'undefeated',
                                'academic_year_id', v_inst.ay_id,
                                'academic_year', v_inst.ay_code,
                                'subjects', u.n_subjects,
                                'exams', u.n_exams,
                                'min_subject_average', v_undefeated_min_avg,
                                'weakest_subject_average', u.weakest_subject_avg) AS meta
      FROM undefeated u WHERE v_undefeated IS NOT NULL
      UNION ALL
      SELECT m.student_id, v_class_mvp,
             jsonb_build_object('badge', 'class_mvp',
                                'academic_year_id', v_inst.ay_id,
                                'academic_year', v_inst.ay_code,
                                'class_id', m.class_id,
                                'first_place_finishes', m.n_wins,
                                'overall_average', round(m.overall_avg, 2))
      FROM class_mvp m WHERE v_class_mvp IS NOT NULL
      UNION ALL
      SELECT i.student_id, v_immortal,
             jsonb_build_object('badge', 'immortal',
                                'academic_year_id', v_inst.ay_id,
                                'academic_year', v_inst.ay_code,
                                'active_days', i.n_days,
                                'required_days', i.required,
                                'year_days', i.n_year_days,
                                'required_percent', v_immortal_pct)
      FROM immortal i WHERE v_immortal IS NOT NULL
      UNION ALL
      SELECT a.student_id, v_all_star,
             jsonb_build_object('badge', 'all_star',
                                'academic_year_id', v_inst.ay_id,
                                'academic_year', v_inst.ay_code,
                                'streak', a.streak,
                                'leaderboard_size', a.n,
                                'top_percent', v_all_star_pct)
      FROM all_star a WHERE v_all_star IS NOT NULL
    ),
    ins AS (
      INSERT INTO user_badges (user_id, badge_id, institution_id,
                               source_entity_id, source_entity_type, metadata)
      SELECT DISTINCT ON (w.student_id, w.badge_id)
             w.student_id, w.badge_id, v_inst.institution_id,
             v_inst.ay_id, 'academic_year', w.meta
      FROM winners w
      ORDER BY w.student_id, w.badge_id
      -- period_key stays NULL: these are one-time legendary badges, so the
      -- unique index makes every re-run a no-op for anyone who already has one.
      ON CONFLICT DO NOTHING
      RETURNING user_id, badge_id, metadata ->> 'badge' AS kind
    ),
    -- Same shape as the evaluator's notif CTE (20260813160000): only rows that
    -- actually inserted reach it, so a re-run notifies nobody twice.
    notif AS (
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT ins.user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge for '
               || COALESCE(v_inst.ay_code, 'the academic year')
               || ' (+' || bd.points || ' points).',
             '/badges',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name,
                                'points', bd.points,
                                'academic_year', v_inst.ay_code,
                                'academic_year_id', v_inst.ay_id)
      FROM ins
      JOIN badge_definitions bd ON bd.id = ins.badge_id
      RETURNING 1
    )
    SELECT COALESCE(jsonb_object_agg(t.kind, t.c), '{}'::jsonb)
      INTO v_counts
    FROM (SELECT kind, count(*) AS c FROM ins GROUP BY 1) t;

    v_result := v_result || jsonb_build_object(
      v_inst.institution_id::text,
      jsonb_build_object('academic_year', v_inst.ay_code,
                         'academic_year_id', v_inst.ay_id,
                         'ends_on', to_char(v_inst.ends_on, 'YYYY-MM-DD'),
                         'holiday_rows', v_holidays,
                         'awarded', v_counts));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'institutions', v_result);
END $fn$;

COMMENT ON FUNCTION public.award_year_end_badges(uuid, uuid) IS
  'Awards the year-end legendary badges (Undefeated, Class MVP, All-Star, Immortal) for the most recently CLOSED academic year (ends_on in the last 30 institution-local days), or for _academic_year_id when ops passes one. Never keys off cal_academic_years.is_active - that points at the running year and would kill the tier at rollover. Idempotent, notifies each winner. Server-only: driven by award_year_end_badges_due() on cron, or called by ops for one institution/year.';

-- ── 2. Player of the Month ──────────────────────────────────────────────────
--
-- Awards the month that just ENDED (institution-local), written with
-- period_key='YYYY-MM' so the badge is re-earnable exactly once per month.
-- Threshold: active on >= LEAST(cap, ceil(0.6 * school_days)) school days, where
-- the cap is the badge's criteria_value (active_days_in_month, 15) and
-- school_days is the days of that month NOT covered by a declared holiday. A
-- school with no holidays declared (Alliance) therefore lands on the flat cap.
--
-- _period_key is an ops escape hatch for backfilling a specific month; the cron
-- always calls this with no arguments.
CREATE OR REPLACE FUNCTION public.award_player_of_the_month(
  _institution_id uuid DEFAULT NULL,
  _period_key     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_badge       uuid;
  v_cap         int;
  v_inst        record;
  v_start       date;
  v_end         date;
  v_period      text;
  v_school_days int;
  v_threshold   int;
  v_awarded     int;
  v_result      jsonb := '{}'::jsonb;
BEGIN
  IF _period_key IS NOT NULL AND _period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'period_key must be YYYY-MM';
  END IF;

  SELECT bd.id, bd.criteria_value INTO v_badge, v_cap
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Player of the Month'
     AND bd.category = 'monthly_form' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  IF v_badge IS NULL THEN
    RAISE WARNING 'award_player_of_the_month: no active student badge_definitions row named "Player of the Month" in category=monthly_form - nothing awarded';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_badge_definition');
  END IF;

  -- criteria_value is the CAP (contract), not a flat target: retuning it in the
  -- catalog retunes the badge without a code change.
  v_cap := GREATEST(COALESCE(v_cap, 15), 1);

  FOR v_inst IN
    SELECT i.id                                 AS institution_id,
           COALESCE(i.timezone, 'Asia/Kolkata') AS tz
    FROM institutions i
    WHERE (_institution_id IS NULL OR i.id = _institution_id)
    ORDER BY i.id
  LOOP
    IF _period_key IS NOT NULL THEN
      v_start := to_date(_period_key || '-01', 'YYYY-MM-DD');
    ELSE
      -- date_trunc on the institution-LOCAL today always yields the previous
      -- COMPLETE month, whichever side of midnight UTC the institution is on.
      v_start := (date_trunc('month', (now() AT TIME ZONE v_inst.tz)::date::timestamp)
                  - interval '1 month')::date;
    END IF;
    v_end    := (v_start + interval '1 month' - interval '1 day')::date;
    v_period := to_char(v_start, 'YYYY-MM');

    SELECT count(*)::int INTO v_school_days
    FROM generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') d
    WHERE NOT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst.institution_id
        AND ce.kind = 'holiday'
        AND d::date BETWEEN ce.starts_on::date
                        AND COALESCE(ce.ends_on, ce.starts_on)::date
    );

    CONTINUE WHEN v_school_days = 0;    -- month entirely on holiday: nothing to win
    v_threshold := GREATEST(1, LEAST(v_cap, ceil(0.6 * v_school_days)::int));

    WITH month_days AS (
      SELECT d::date AS day
      FROM generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') d
      WHERE NOT EXISTS (
        SELECT 1 FROM cal_events ce
        WHERE ce.institution_id = v_inst.institution_id
          AND ce.kind = 'holiday'
          AND d::date BETWEEN ce.starts_on::date
                          AND COALESCE(ce.ends_on, ce.starts_on)::date
      )
    ),
    students AS (
      SELECT DISTINCT ca.user_id AS student_id
      FROM class_assignments ca
      JOIN profiles p ON p.id = ca.user_id
      WHERE ca.role = 'student'
        AND p.institution_id = v_inst.institution_id
    ),
    active AS (
      SELECT s.student_id, count(DISTINCT ual.activity_date)::int AS n_days
      FROM students s
      JOIN user_activity_log ual ON ual.user_id = s.student_id
      JOIN month_days md         ON md.day = ual.activity_date
      GROUP BY 1
    ),
    ins AS (
      INSERT INTO user_badges (user_id, badge_id, institution_id, period_key,
                               source_entity_type, metadata)
      SELECT a.student_id, v_badge, v_inst.institution_id, v_period,
             'calendar_month',
             jsonb_build_object('badge', 'player_of_the_month',
                                'period', v_period,
                                'active_days', a.n_days,
                                'school_days', v_school_days,
                                'threshold', v_threshold,
                                'cap', v_cap)
      FROM active a
      WHERE a.n_days >= v_threshold
      ON CONFLICT DO NOTHING
      RETURNING user_id, badge_id
    ),
    notif AS (
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT ins.user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge for '
               || to_char(v_start, 'FMMonth YYYY')
               || ' (+' || bd.points || ' points).',
             '/badges',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name,
                                'points', bd.points, 'period_key', v_period)
      FROM ins
      JOIN badge_definitions bd ON bd.id = ins.badge_id
      RETURNING 1
    )
    SELECT count(*)::int INTO v_awarded FROM ins;

    v_result := v_result || jsonb_build_object(
      v_inst.institution_id::text,
      jsonb_build_object('period', v_period,
                         'school_days', v_school_days,
                         'threshold', v_threshold,
                         'awarded', v_awarded));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'institutions', v_result);
END $fn$;

COMMENT ON FUNCTION public.award_player_of_the_month(uuid, text) IS
  'Awards Player of the Month for the last complete institution-local calendar month, period_key=YYYY-MM, threshold LEAST(criteria_value, ceil(0.6 * school days)). Idempotent, notifies each winner. Pass _period_key to backfill a specific month.';

-- ── 3. Year-end gate ────────────────────────────────────────────────────────
--
-- Runs daily and no-ops until an institution is actually past the end of an
-- academic year. The year is resolved BY DATE (ends_on strictly in the past, at
-- most 30 institution-local days ago) and never by cal_academic_years.is_active,
-- which points at the year currently running and would silence this job forever
-- after the first rollover. The 30-day window gives ~29 retries if a run fails,
-- then falls silent for the rest of the year instead of re-scanning every result
-- row every night. Re-runs inside the window are free: every award is
-- ON CONFLICT DO NOTHING and every notification hangs off an actual insert.
CREATE OR REPLACE FUNCTION public.award_year_end_badges_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inst record;
  v_ran  jsonb := '{}'::jsonb;
  v_n    int   := 0;
BEGIN
  FOR v_inst IN
    SELECT DISTINCT ON (i.id)
           i.id  AS institution_id,
           ay.id AS ay_id,
           ay.ends_on,
           t.local_today
    FROM institutions i
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date AS local_today
    ) t
    JOIN cal_academic_years ay
      ON ay.institution_id = i.id
     AND ay.ends_on <  t.local_today
     AND ay.ends_on >= t.local_today - 30
    ORDER BY i.id, ay.ends_on DESC
  LOOP
    -- Pass the resolved year explicitly so the gate and the worker can never
    -- disagree about which year is being closed.
    v_ran := v_ran || jsonb_build_object(
      v_inst.institution_id::text,
      public.award_year_end_badges(v_inst.institution_id, v_inst.ay_id));
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'institutions_processed', v_n, 'detail', v_ran);
END $fn$;

COMMENT ON FUNCTION public.award_year_end_badges_due() IS
  'Cron entry point: runs award_year_end_badges() for every institution whose institution-local date is within 30 days past a cal_academic_years.ends_on, resolved by date rather than is_active, and passes that year id through.';

-- ── 4. pg_cron ──────────────────────────────────────────────────────────────
-- Both jobs are plain DB functions, so they need no JWT and no edge-function
-- hop — same shape as tt-attendance-substitution-pass / homework-autocheck-15min.
-- Guarded on pg_extension so a database without pg_cron (a local
-- `supabase db reset` shadow DB) does not fail the whole migration, matching
-- 20260509100000_attendance_phase5_substitution_engine.sql. Unschedule first so
-- the migration is rerunnable on pg_cron < 1.5.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('badges-player-of-the-month');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 00:30 UTC = 06:00 IST, on the 1st through 4th of the month. The job awards
    -- the last COMPLETE institution-local month: an institution far west of IST
    -- is still on the last day of the old month at the first tick and picks its
    -- month up on the next one. The extra ticks are also the only catch-up this
    -- job has - every one of them is a no-op via ON CONFLICT DO NOTHING, so a
    -- restart, lock or statement timeout on the 1st no longer loses the month.
    PERFORM cron.schedule(
      'badges-player-of-the-month',
      '30 0 1-4 * *',
      $job$ select public.award_player_of_the_month(); $job$
    );

    BEGIN
      PERFORM cron.unschedule('badges-year-end');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 01:00 UTC = 06:30 IST, daily. award_year_end_badges_due() is the gate: on
    -- every other day of the year it reads a handful of rows and returns.
    PERFORM cron.schedule(
      'badges-year-end',
      '0 1 * * *',
      $job$ select public.award_year_end_badges_due(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed: badges-player-of-the-month and badges-year-end were NOT scheduled. Schedule them by hand on any database where they are expected to run.';
  END IF;
END;
$$;

-- ── 5. Grants ───────────────────────────────────────────────────────────────
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new public
-- function and REVOKE FROM PUBLIC does not strip it, so revoke anon BY NAME.
-- These three write badge rows for other users: they are cron/ops only and are
-- never exposed to a client role.
REVOKE ALL ON FUNCTION public.award_year_end_badges(uuid, uuid)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_year_end_badges_due()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_player_of_the_month(uuid, text) FROM PUBLIC, anon, authenticated;