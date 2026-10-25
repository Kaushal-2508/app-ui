-- Achievements redesign, pass 1.5: the server-side EVALUATOR.
--
-- Replaces src/hooks/useAutoBadgeAward.ts, which ran the whole awarding engine in
-- the BROWSER. That design had four structural defects, all fixed here:
--
--   1. Awarding only happened if the student happened to have the right page open
--      when the event fired. A student who submitted an exam and closed the tab
--      never got the badge.
--   2. It trusted the client with the INSERT into user_badges. Anyone with the
--      anon key could award themselves anything.
--   3. getUserStats() filtered final_results by `student_id` -- a column that DOES
--      NOT EXIST on that table (verified 2026-08-13: final_results reaches a
--      student only through attempt_id -> student_exam_attempts). Every
--      perfect_scores lookup has been erroring out and being swallowed by the
--      per-metric try/catch, silently scoring 0.
--   4. It read one metric per round trip, per event, per user.
--
-- ── FILE OWNERSHIP (read before editing) ────────────────────────────────────
--
--   20260813150000_achievements_catalog.sql is the SOLE SEEDER of
--   badge_definitions. It owns every INSERT/UPDATE of that table (seed,
--   recategorise, deactivate, display_order).
--
--   THIS FILE MUST NOT CONTAIN A SINGLE INSERT/UPDATE/DELETE AGAINST
--   badge_definitions. It only READS definitions and WRITES user_badges,
--   badge_progress and notifications. A previous revision seeded a second,
--   contradicting copy of the catalog here; two owners meant whichever migration
--   ran last silently won and re-broke the other. Do not reintroduce it.
--
--   20260813140000_achievements_activity_spine.sql is ALREADY APPLIED TO
--   PRODUCTION. Its three trigger functions (tg_log_exam_submitted,
--   tg_log_homework_submitted, tg_log_hybrid_exam_submitted), its three triggers,
--   log_student_activity, log_study_material_open, student_local_date and
--   student_streak are FIXED. Nothing below redefines any of them -- the wiring in
--   §3 hangs NEW triggers off the activity row the spine already writes.
--
-- ── criteria_metric vocabulary (locked; the catalog writes these exact strings,
--    the frontend hook src/hooks/useStudentAchievements.ts matches them) ──────
--
--   metric                  criteria_value means           badges
--   ----------------------  -----------------------------  ----------------------
--   streak_days             required consecutive days      Hat-trick 3, Flame 7,
--                                                          Blaze 15, Inferno 30,
--                                                          Wildfire 60, Eternal
--                                                          Flame 100, Legacy 150
--   streak_comeback_hours   48 = the WALL-CLOCK window     Comeback
--   exams_completed         exam count                     Debut 1, Regular
--                                                          Starter 5, Iron Man 10,
--                                                          First XI 25
--   study_materials_opened  open count                     Playbook Pro 10
--   all_exams_completed     100 = percent of the REQUIRED  Grand Slam
--                           set (year exams minus approved
--                           leave). The 80% completion
--                           FLOOR is a named constant
--                           below, NEVER criteria_value.
--   exam_percentage         best single-exam percent       Clean Hit 70, MVP
--                                                          Round 80, Ace 90,
--                                                          Century 100
--   score_improvement       percentage-point gain          Personal Best 15
--   exams_at_90             count of exams >= 90%          In Form 3
--   active_days_in_month    15 = the CAP; real target is   Player of the Month
--                           LEAST(cap, ceil(0.6 * school   (PROGRESS ONLY here --
--                           days))                         the monthly cron awards)
--
-- Reserved for the scheduled job and NEVER dispatched here: all_exams_completed
-- (Grand Slam), subject_avg_min, class_first_place_count, streak_percentile,
-- streak_full_year. perfect_score_count is computed here for its PROGRESS BAR
-- only and is likewise never dispatched -- the year-end cron awards it.
--
-- ── EVALUATION TIMING (locked product decision) ─────────────────────────────
--
--   streak_ranks / quest_log / clutch_plays  -> every qualifying event (THIS FILE)
--   monthly_form                             -> monthly cron
--                                               (award_player_of_the_month, 170000)
--   legendary  (ALL FIVE, incl. Double Century) -> ACADEMIC YEAR END cron only
--                                               (award_year_end_badges, 170000)
--
-- The award statement in §2 therefore carries a POSITIVE category allowlist
-- ('streak_ranks','quest_log','clutch_plays'). A legendary badge cannot be
-- awarded here even if someone later gives it an event-driven metric, and Player
-- of the Month has exactly one writer. Double Century in particular stays out:
-- its metric is deliberately 'perfect_score_count' and NOT 'perfect_scores', so
-- the still-live browser awarder (which dispatches on 'perfect_scores') cannot
-- hand out a 200-point legendary badge either. Never rename it.
--
-- ── Interaction with the legacy browser awarder ─────────────────────────────
--
-- src/hooks/useAutoBadgeAward.ts is still called from useExamAttempt.ts and
-- useSaveExam.ts. Of its hardcoded metrics only 'exams_completed' overlaps with
-- this file. The server always wins that race (the trigger runs inside the submit
-- transaction, the hook runs after it commits), so the hook's un-upserted INSERT
-- raises 23505, its `if (!awardError)` swallows it, and NO duplicate notification
-- is written. The only regression is the loss of the immediate client-side toast.
-- Removing useAutoBadgeAward from the two call sites is the required companion
-- frontend change; it is intentionally not attempted from SQL.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. (removed)
-- ════════════════════════════════════════════════════════════════════════════
-- The badge_definitions seed / deactivate / recategorise block that used to live
-- here has been deleted. See FILE OWNERSHIP above: 20260813150000 is the sole
-- seeder. This file reads badge_definitions and never writes it.

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The evaluator
-- ════════════════════════════════════════════════════════════════════════════
--
-- Contract:
--   * Idempotent. Safe to call on every event, repeatedly, concurrently. New
--     awards land through ON CONFLICT DO NOTHING against
--     user_badges_once_per_period_idx.
--   * SCOPED. §23: this runs inside the hottest write paths on the platform, so
--     an event only pays for the metrics it can actually move:
--
--       'day'       streak_days, streak_comeback_hours, active_days_in_month
--                   (only when a NEW activity row appears -- a repeat activity on
--                   an already-active day cannot change any of them)
--       'exam'      exams_completed, all_exams_completed
--       'materials' study_materials_opened
--       'scores'    exam_percentage, exams_at_90, score_improvement
--       'all'       everything (backfill / ops)
--
--     Publishing a result no longer runs the streak walk, the comeback
--     gaps-and-islands pass or the academic-year exam sweep; a repeat homework
--     submission on the same day costs nothing at all (the trigger computes an
--     empty scope and returns without calling this function).
--   * Metrics absent from the computed scope are simply absent from v_stats, and
--     both the award statement and the progress upsert skip absent metrics. A
--     narrow scope can therefore never clear or downgrade an existing progress row.
--   * ONE award statement and ONE progress statement, dispatched against
--     badge_definitions. Adding a badge row to the catalog costs zero extra
--     queries as long as it reuses a known criteria_metric.
--
-- _notify=false awards silently. Required for the one-time backfill: the browser
-- hook awarded so unreliably that the first real run hands a typical student
-- 3-9 badges at once, and 537 students x 9 "Badge earned" notifications is a
-- flood, not a celebration. Deploy sequence is in the header comment of §3.

-- Older revisions of this migration shipped narrower signatures. Drop them so a
-- re-apply cannot leave two overloads behind (a one-argument call would then be
-- ambiguous). plpgsql resolves callees by name at runtime, so no trigger breaks.
DROP FUNCTION IF EXISTS public.evaluate_student_badges(uuid, boolean);
DROP FUNCTION IF EXISTS public.evaluate_student_badges_safe(uuid);

CREATE OR REPLACE FUNCTION public.evaluate_student_badges(
  _user_id uuid,
  _notify  boolean  DEFAULT true,
  _scopes  text[]   DEFAULT ARRAY['all']::text[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst           uuid;
  v_tz             text;
  v_today          date;
  v_month_start    date;
  v_month_end      date;
  v_ay_start       date;
  v_ay_end         date;
  v_scan_from      date;
  v_streak         int;
  v_comeback_hours int;
  v_month_days     int;
  v_school_days    int;
  v_potm_target    int;
  v_opens          int;
  v_exams_done     int;
  v_grand          numeric;
  v_n_scored       int;
  v_best_pct       numeric;
  v_at90           int;
  -- Double Century's count. Computed here for its PROGRESS BAR ONLY -- the
  -- year-end cron is the sole awarder. Product asked for "1 of 2" explicitly, and
  -- without this the 399 students who already hold two perfect scores stare at a
  -- permanently frozen "0 of 2".
  v_perfect        int;
  v_gain           numeric;
  v_stats          jsonb := '{}'::jsonb;
  v_awarded        int   := 0;
  v_new_badges     uuid[];
  v_do_day         boolean;
  v_do_exam        boolean;
  v_do_materials   boolean;
  v_do_scores      boolean;
  -- Grand Slam is "100% of the REQUIRED set" (the year's exams minus those inside
  -- an approved leave window). The completion FLOOR below is the second, separate
  -- condition that stops a student on extended approved leave from sweeping a
  -- handful of exams and calling it a season. It is a named constant precisely
  -- because criteria_value already means the 100% target and cannot carry it.
  c_grand_slam_floor  constant numeric := 0.80;
  -- The rebuilt run Comeback demands. Product text is fixed ("rebuild a 3 day
  -- streak"); criteria_value carries the 48-hour window, not this.
  c_comeback_min_run  constant int := 3;
  -- Positive allowlists. Both are asserted on every award: a metric this file does
  -- not compute cannot award, and a badge outside these three categories cannot be
  -- awarded here no matter what metric it carries (legendary = year-end cron,
  -- monthly_form = monthly cron).
  -- 'all_exams_completed' (Grand Slam) is deliberately NOT here. It cannot be
  -- evaluated mid-year: "every exam scheduled in the academic year" is only
  -- knowable once the year is closed, because the year's later exams do not exist
  -- as rows yet, so did_required = required is trivially true in April. Measured
  -- on production 2026-08-13, awarding it here would have handed a 200-point
  -- diamond badge to 284 students 7.5 months early, with no revoke path -- 243 of
  -- them in classes holding just 8 exams. A ratio floor cannot save it either:
  -- ceil(0.80 * 1) = 1. The year-end cron in 20260813170000 is its sole awarder.
  c_event_metrics constant text[] := ARRAY[
    'streak_days', 'streak_comeback_hours', 'exams_completed',
    'study_materials_opened',
    'exam_percentage', 'score_improvement', 'exams_at_90'
  ];
  c_event_categories constant text[] := ARRAY['streak_ranks', 'quest_log', 'clutch_plays'];
  -- criteria_type values that the UI draws as a progress bar. threshold ("best so
  -- far 74%, need 90%"), event (Comeback, Personal Best) and aggregate (Grand
  -- Slam and the legendary set) must NOT get a badge_progress row: pickNextBadge()
  -- reads progress for every badge and would surface "Ace, 82% complete" off a
  -- single 74% exam, which is the display the locked rules forbid.
  c_bar_types constant text[] := ARRAY['streak', 'count', 'periodic'];
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;

  IF _scopes IS NULL OR array_length(_scopes, 1) IS NULL THEN
    _scopes := ARRAY['all']::text[];
  END IF;
  v_do_day       := 'all' = ANY (_scopes) OR 'day'       = ANY (_scopes);
  v_do_exam      := 'all' = ANY (_scopes) OR 'exam'      = ANY (_scopes);
  v_do_materials := 'all' = ANY (_scopes) OR 'materials' = ANY (_scopes);
  v_do_scores    := 'all' = ANY (_scopes) OR 'scores'    = ANY (_scopes);
  IF NOT (v_do_day OR v_do_exam OR v_do_materials OR v_do_scores) THEN RETURN 0; END IF;

  -- §24: every date below is derived from this timezone, never a bare
  -- CURRENT_DATE. Every generate_series is cast to `timestamp` (not timestamptz)
  -- before ::date, so the server's UTC session TimeZone can never shift a day.
  SELECT p.institution_id, COALESCE(i.timezone, 'Asia/Kolkata')
    INTO v_inst, v_tz
  FROM profiles p
  LEFT JOIN institutions i ON i.id = p.institution_id
  WHERE p.id = _user_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  v_today       := (now() AT TIME ZONE v_tz)::date;
  v_month_start := date_trunc('month', v_today)::date;
  v_month_end   := (v_month_start + interval '1 month' - interval '1 day')::date;

  SELECT ay.starts_on, ay.ends_on INTO v_ay_start, v_ay_end
  FROM cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active
  ORDER BY ay.starts_on DESC
  LIMIT 1;

  -- ══ Scope 'day': streak, comeback, monthly form ═══════════════════════════
  IF v_do_day THEN
    -- Reuse the shipped streak walk rather than reimplementing the holiday rules.
    v_streak := COALESCE((public.student_streak(_user_id) ->> 'current')::int, 0);
    v_stats  := v_stats || jsonb_build_object('streak_days', v_streak);

    -- The comeback scan is bounded to 120 days (clamped to the academic year).
    -- Far more than the 2-day gap it looks for, and the evaluator re-runs on every
    -- event, so a qualifying comeback is always seen on the day it completes.
    v_scan_from := GREATEST(COALESCE(v_ay_start, v_today - 120), v_today - 120);

    -- ── Comeback: the 48 hours is WALL CLOCK ────────────────────────────────
    -- Runs are built from the ACTIVITY ROWS themselves (typically a few dozen),
    -- not from a 120-row day series with two correlated EXISTS per day.
    --
    -- Two rules that must not be conflated:
    --   * RUN CONTINUITY is the streak rule: a declared holiday is neutral, so two
    --     active days separated only by holidays belong to the same run. That is
    --     what the inner generate_series tests -- a run BREAKS only if at least one
    --     NON-holiday day sits in the gap.
    --   * THE 48-HOUR WINDOW is a wall clock, measured in CALENDAR days between
    --     the last active day of the broken run and the first active day of the
    --     rebuilt one. Holidays are NOT deleted from that measurement. Reusing the
    --     holiday-stripped ordinal (the previous implementation) let a student
    --     resume after a two-week break and still collect Comeback.
    WITH act AS (
      SELECT DISTINCT ual.activity_date AS day
      FROM user_activity_log ual
      WHERE ual.user_id = _user_id
        AND ual.activity_date BETWEEN v_scan_from AND v_today
    ),
    seq AS (
      SELECT a.day, lag(a.day) OVER (ORDER BY a.day) AS prev_day
      FROM act a
    ),
    marked AS (
      SELECT s.day,
             s.prev_day,
             (s.prev_day IS NULL
              OR EXISTS (
                   SELECT 1
                   FROM generate_series((s.prev_day + 1)::timestamp,
                                        (s.day - 1)::timestamp,
                                        interval '1 day') g
                   WHERE NOT EXISTS (
                     SELECT 1 FROM cal_events ce
                     WHERE ce.institution_id = v_inst
                       AND ce.kind = 'holiday'
                       AND g::date BETWEEN ce.starts_on AND COALESCE(ce.ends_on, ce.starts_on))
                 )) AS starts_run
      FROM seq s
    ),
    runs AS (
      SELECT m.day,
             m.prev_day,
             m.starts_run,
             count(*) FILTER (WHERE m.starts_run)
               OVER (ORDER BY m.day ROWS UNBOUNDED PRECEDING) AS run_id
      FROM marked m
    ),
    run_agg AS (
      -- Exactly one row per run carries starts_run, and its prev_day is the last
      -- active day of the run that broke (NULL for the first run in the window).
      SELECT r.run_id,
             min(r.day)                                  AS first_day,
             count(*)::int                               AS active_days,
             min(r.prev_day) FILTER (WHERE r.starts_run) AS prev_run_last_day
      FROM runs r
      GROUP BY r.run_id
    )
    SELECT min((ra.first_day - ra.prev_run_last_day) * 24)::int
      INTO v_comeback_hours
    FROM run_agg ra
    WHERE ra.prev_run_last_day IS NOT NULL
      AND ra.active_days >= c_comeback_min_run;

    -- Absent (not zero) when no comeback exists: the comparison for this metric is
    -- inverted (<= the window), so a 0 would award it to everyone.
    IF v_comeback_hours IS NOT NULL THEN
      v_stats := v_stats || jsonb_build_object('streak_comeback_hours', v_comeback_hours);
    END IF;

    -- ── Monthly form: PROGRESS ONLY. award_player_of_the_month() on cron is the
    -- single writer of the badge itself; this only keeps the current month's bar
    -- honest between cron runs.
    SELECT count(DISTINCT ual.activity_date)::int INTO v_month_days
    FROM user_activity_log ual
    WHERE ual.user_id = _user_id
      AND ual.activity_date BETWEEN v_month_start AND v_month_end;

    -- School days for the WHOLE month, not month-to-date: the target must not
    -- drift upward as the month fills in.
    SELECT count(*)::int INTO v_school_days
    FROM generate_series(v_month_start::timestamp, v_month_end::timestamp, interval '1 day') d
    WHERE NOT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst
        AND ce.kind = 'holiday'
        AND d::date BETWEEN ce.starts_on AND COALESCE(ce.ends_on, ce.starts_on));

    -- No literal cap here: criteria_value IS the cap (LEAST below), so retuning
    -- Player of the Month is an UPDATE on badge_definitions, not a code change.
    -- Matches award_player_of_the_month()'s threshold shape exactly.
    v_potm_target := GREATEST(1, ceil(0.6 * GREATEST(COALESCE(v_school_days, 0), 1))::int);
    v_stats := v_stats || jsonb_build_object('active_days_in_month', COALESCE(v_month_days, 0));
  END IF;

  -- ══ Scope 'exam': completion counts and Grand Slam ════════════════════════
  IF v_do_exam THEN
    -- Completion spans BOTH planes. hybrid_exam_attempts has never counted toward
    -- a badge before; it counts now, deduped by exam (UNION, not UNION ALL) so a
    -- student with both an online and a hybrid attempt on one exam is not
    -- double-credited.
    WITH completed AS (
      SELECT sea.exam_id FROM student_exam_attempts sea
       WHERE sea.student_id = _user_id AND sea.is_submitted
      UNION
      SELECT h.exam_id FROM hybrid_exam_attempts h
       WHERE h.student_id = _user_id AND h.submitted_at IS NOT NULL
    ),
    me_classes AS (
      -- A student who changed section mid-year has two rows, so Grand Slam counts
      -- both sections' exams.
      SELECT DISTINCT ca.class_id
      FROM class_assignments ca
      WHERE ca.user_id = _user_id AND ca.role = 'student'
    ),
    -- Grand Slam is scoped to the WHOLE academic year including exams still in the
    -- future. Scoping it to "exams so far" would hand a 200-point diamond badge to
    -- anyone who sat the first exam of April.
    --
    -- The exam's date is COALESCE(scheduled_date, published_at, created_at), the
    -- same chain every other date-based RPC in this repo uses. Requiring
    -- scheduled_date IS NOT NULL (the previous implementation) silently dropped
    -- every exam at schools that do not fill that field in -- from the numerator
    -- AND the denominator -- making the badge unreachable there.
    year_exams AS (
      SELECT DISTINCT e.id,
             (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE v_tz)::date AS on_date
      FROM exam_classes ec
      JOIN me_classes mc ON mc.class_id = ec.class_id
      JOIN exams e       ON e.id = ec.exam_id
      WHERE e.status IN ('published', 'active', 'completed')
        AND v_ay_start IS NOT NULL
        AND (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE v_tz)::date
            BETWEEN v_ay_start AND v_ay_end
    ),
    year_split AS (
      SELECT ye.id,
             EXISTS (SELECT 1 FROM leave_requests lr
                     WHERE lr.student_id = _user_id
                       AND lr.status = 'approved'
                       AND ye.on_date BETWEEN lr.start_date AND lr.end_date) AS on_leave,
             EXISTS (SELECT 1 FROM completed c WHERE c.exam_id = ye.id)      AS done
      FROM year_exams ye
    ),
    grand AS (
      SELECT count(*)                                      AS total_year,
             count(*) FILTER (WHERE NOT on_leave)          AS required,
             count(*) FILTER (WHERE NOT on_leave AND done) AS did_required,
             count(*) FILTER (WHERE done)                  AS did_year
      FROM year_split
    )
    SELECT (SELECT count(*)::int FROM completed),
           CASE
             WHEN g.required = 0 THEN NULL          -- nothing required: not a sweep
             WHEN g.did_required = g.required
              AND g.did_year >= ceil(c_grand_slam_floor * g.total_year) THEN 100
             -- Below the bar we still report real progress for the UI, capped at 99
             -- so a partial sweep can never satisfy criteria_value = 100.
             ELSE LEAST(floor(g.did_required * 100.0 / g.required), 99)
           END
      INTO v_exams_done, v_grand
    FROM grand g;

    v_stats := v_stats || jsonb_build_object('exams_completed', COALESCE(v_exams_done, 0));
    IF v_grand IS NOT NULL THEN
      v_stats := v_stats || jsonb_build_object('all_exams_completed', v_grand);
    END IF;
  END IF;

  -- ══ Scope 'materials' ═════════════════════════════════════════════════════
  IF v_do_materials THEN
    -- ROWS, not sum(count). user_activity_log is UNIQUE(user_id, activity_type,
    -- activity_date) and log_student_activity bumps `count` on conflict, so
    -- sum(count) is raw clicks and ten opens of one PDF in one afternoon would
    -- earn Playbook Pro. count(*) is "days on which the student opened material",
    -- which is what the catalog documents this metric to be.
    SELECT count(*)::int INTO v_opens
    FROM user_activity_log ual
    WHERE ual.user_id = _user_id
      AND ual.activity_type = 'study_material_opened';

    v_stats := v_stats || jsonb_build_object('study_materials_opened', COALESCE(v_opens, 0));
  END IF;

  -- ══ Scope 'scores': clutch plays ══════════════════════════════════════════
  IF v_do_scores THEN
    -- Scores are OVERALL percentages. final_results has no student_id: the only
    -- route from a student to a result is attempt_id. percentage is a GENERATED
    -- column and is read here, never written (§9).
    WITH scored_raw AS (
      SELECT sea.exam_id,
             -- "100%" means exactly 100. Bonus marks can push a raw percentage
             -- past it on either plane; clamping keeps "best so far" honest and
             -- keeps Century's 100 a real ceiling rather than a soft one.
             LEAST(fr.percentage, 100)::numeric AS pct,
             COALESCE(e.scheduled_date, e.published_at, e.created_at, sea.submitted_at) AS exam_at,
             sea.submitted_at AS sat_at
      FROM student_exam_attempts sea
      JOIN final_results fr ON fr.attempt_id = sea.id
      JOIN exams e          ON e.id = sea.exam_id
      WHERE sea.student_id = _user_id
        AND fr.is_published
        AND fr.percentage IS NOT NULL
      UNION ALL
      SELECT h.exam_id,
             LEAST(round(h.total_marks_awarded::numeric * 100 / h.total_max_marks::numeric, 2), 100),
             COALESCE(e.scheduled_date, e.published_at, e.created_at, h.submitted_at),
             h.submitted_at
      FROM hybrid_exam_attempts h
      JOIN exams e ON e.id = h.exam_id
      WHERE h.student_id = _user_id
        AND h.status = 'evaluated'          -- the marked-and-visible state on this plane
        AND COALESCE(h.total_max_marks, 0) > 0
        AND h.total_marks_awarded IS NOT NULL
    ),
    -- ONE ROW PER EXAM. The two planes are UNION ALL (a student can hold both an
    -- online final_results row and a hybrid attempt for the same exam, and retakes
    -- produce two rows either way). Without this collapse, "3 SEPARATE exams at
    -- 90%" counts one exam three times.
    scored AS (
      SELECT DISTINCT ON (sr.exam_id) sr.exam_id, sr.pct, sr.exam_at, sr.sat_at
      FROM scored_raw sr
      ORDER BY sr.exam_id, sr.pct DESC, sr.exam_at
    ),
    -- Personal Best compares against the IMMEDIATELY previous exam in EXAM order.
    -- Ordering by publish time is wrong: teachers bulk-publish a whole term at
    -- once, so published_at is near-identical across the batch and the tiebreaker
    -- collapses to a random uuid -- "beat your previous exam" would become "beat a
    -- randomly chosen neighbour" for roughly half the cohort.
    seq AS (
      SELECT s.pct - lag(s.pct) OVER (
               ORDER BY COALESCE(s.exam_at, s.sat_at), s.sat_at NULLS LAST, s.exam_id
             ) AS gain
      FROM scored s
    ),
    agg AS (
      SELECT count(*)::int                                AS n,
             max(s.pct)                                   AS best_pct,
             count(*) FILTER (WHERE s.pct >= 90)::int     AS at90,
             -- pct is already clamped to 100 by LEAST above, so ">= 100" is
             -- exactly 100 and bonus marks cannot manufacture a perfect score.
             -- `scored` is one row per exam, so this is DISTINCT exams.
             count(*) FILTER (WHERE s.pct >= 100)::int    AS perfect
      FROM scored s
    )
    SELECT a.n, a.best_pct, a.at90, a.perfect,
           COALESCE((SELECT max(q.gain) FROM seq q), 0)
      INTO v_n_scored, v_best_pct, v_at90, v_perfect, v_gain
    FROM agg a;

    -- With no published result at all these metrics have no value; emitting 0
    -- would write meaningless progress rows and re-check every threshold badge.
    IF COALESCE(v_n_scored, 0) > 0 THEN
      v_stats := v_stats || jsonb_build_object(
        'exam_percentage',    v_best_pct,
        'exams_at_90',        v_at90,
        -- PROGRESS ONLY. Deliberately absent from c_event_metrics below, so the
        -- award statement can never see it.
        'perfect_score_count', v_perfect,
        'score_improvement',  v_gain);
    END IF;
  END IF;

  IF v_stats = '{}'::jsonb THEN RETURN 0; END IF;

  -- ── Award ────────────────────────────────────────────────────────────────
  -- One statement for every badge in the allowlists. Nothing legendary and nothing
  -- periodic can be reached from here (see EVALUATION TIMING in the header).
  WITH ins AS (
    INSERT INTO user_badges
      (user_id, badge_id, institution_id, source_entity_type, metadata)
    SELECT _user_id, bd.id, v_inst, 'auto_evaluator',
           jsonb_build_object(
             'metric',    bd.criteria_metric,
             'value',     (v_stats ->> bd.criteria_metric)::numeric,
             'threshold', bd.criteria_value)
    FROM badge_definitions bd
    WHERE bd.is_active
      AND bd.badge_type = 'student'
      AND bd.category = ANY (c_event_categories)   -- structural: never 'legendary'
      AND bd.criteria_metric = ANY (c_event_metrics)
      AND (v_stats ->> bd.criteria_metric) IS NOT NULL
      AND CASE
            -- The one inverted comparison in the file: criteria_value is a WINDOW
            -- (48 wall-clock hours), not a floor, so a SMALLER gap qualifies.
            WHEN bd.criteria_metric = 'streak_comeback_hours'
              THEN (v_stats ->> bd.criteria_metric)::numeric <= bd.criteria_value
            ELSE (v_stats ->> bd.criteria_metric)::numeric >= bd.criteria_value
          END
    -- period_key stays NULL (this file awards no periodic badge), so the partial
    -- index behaves as a plain one-award-per-badge rule.
    ON CONFLICT (user_id, badge_id, COALESCE(period_key, ''::text)) DO NOTHING
    RETURNING badge_id
  )
  SELECT count(*)::int, COALESCE(array_agg(ins.badge_id), '{}'::uuid[])
    INTO v_awarded, v_new_badges
  FROM ins;

  -- ── Notify ───────────────────────────────────────────────────────────────
  -- SEPARATE statement, in its own subtransaction. When the notification INSERT
  -- shared a CTE with the award INSERT, a notifications defect (a new NOT NULL, a
  -- type rename) rolled the awards back with it -- the notification path could
  -- revoke a badge. Now a failure here costs the announcement and nothing else.
  IF _notify AND array_length(v_new_badges, 1) IS NOT NULL THEN
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT _user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge (+' || bd.points || ' points).',
             '/badges',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name, 'points', bd.points)
      FROM badge_definitions bd
      WHERE bd.id = ANY (v_new_badges);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'evaluate_student_badges: notification insert failed for user %: % (%)',
        _user_id, SQLERRM, SQLSTATE;
    END;
  END IF;

  -- ── Progress ─────────────────────────────────────────────────────────────
  -- badge_progress has existed since the original schema and has NEVER been
  -- written (0 rows). Filling it here is what lets student_achievements() render
  -- "7 of 15 days" without the client recomputing anything per badge.
  --
  -- Only the criteria_types the locked UI rules draw as a bar get a row. Threshold
  -- badges (Clean Hit/MVP Round/Ace/Century), event badges (Comeback, Personal
  -- Best) and aggregates (Grand Slam, the legendary set) are excluded: a progress
  -- row for them makes pickNextBadge() present a single high score as partial
  -- progress. Values are FLOORED, never rounded -- a best of 89.6 must not read
  -- as "90, need 90" next to "Not earned yet".
  INSERT INTO badge_progress
    (user_id, badge_id, institution_id, current_value, target_value, last_updated)
  SELECT _user_id, bd.id, v_inst,
         GREATEST(0, floor((v_stats ->> bd.criteria_metric)::numeric))::int,
         CASE WHEN bd.criteria_metric = 'active_days_in_month'
              THEN GREATEST(1, LEAST(bd.criteria_value, COALESCE(v_potm_target, bd.criteria_value)))
              ELSE bd.criteria_value END,
         now()
  FROM badge_definitions bd
  WHERE bd.is_active
    AND bd.badge_type = 'student'
    -- NOTE: no category guard here on purpose. Progress is not an award. A
    -- `category <> 'legendary'` filter used to sit here and it froze Double
    -- Century's bar at "0 of 2" for the 399 students who already hold two
    -- perfect scores. Awarding is gated independently below by BOTH
    -- c_event_metrics and c_event_categories, so nothing legendary can be
    -- awarded from this function regardless. The real guard for progress is
    -- criteria_type: the four aggregate legendary badges are 'aggregate' and
    -- so are still excluded, while Double Century is 'count' and gets its bar.
    AND bd.criteria_type = ANY (c_bar_types)
    AND (bd.criteria_metric = ANY (c_event_metrics)
         OR bd.criteria_metric IN ('active_days_in_month', 'perfect_score_count'))
    AND (v_stats ->> bd.criteria_metric) IS NOT NULL
  ON CONFLICT (user_id, badge_id) DO UPDATE
    SET current_value  = EXCLUDED.current_value,
        target_value   = EXCLUDED.target_value,
        institution_id = EXCLUDED.institution_id,
        last_updated   = now();

  RETURN v_awarded;
END $$;

COMMENT ON FUNCTION public.evaluate_student_badges(uuid, boolean, text[]) IS
  'Event-driven student badge evaluator (streak_ranks / quest_log / clutch_plays only). Idempotent. _scopes limits the metrics recomputed: day, exam, materials, scores, all. Never awards legendary or monthly_form badges - those belong to the crons in 20260813170000.';

-- A badge bug must NEVER roll back a student's exam submission. Every trigger
-- goes through this wrapper, which contains any failure in a subtransaction and
-- downgrades it to a warning.
--
-- A swallowed error is invisible, so the failure is ALSO recorded durably in
-- system_audit_logs -- a silent 100% awarding outage with the only signal buried
-- in the Postgres log is the §6 failure mode this repo has already been burned by.
-- That audit write is itself wrapped, because an exception raised inside an
-- exception handler would propagate and take the exam submission down with it.
CREATE OR REPLACE FUNCTION public.evaluate_student_badges_safe(
  _user_id uuid,
  _scopes  text[] DEFAULT ARRAY['all']::text[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.evaluate_student_badges(_user_id, true, _scopes);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'evaluate_student_badges failed for user % (scopes %): % (%)',
    _user_id, _scopes, SQLERRM, SQLSTATE;
  BEGIN
    INSERT INTO system_audit_logs (action, entity_type, entity_id, entity_name, metadata)
    VALUES ('badge_evaluation_failed', 'user_badges', _user_id, 'evaluate_student_badges',
            jsonb_build_object('scopes', _scopes, 'sqlstate', SQLSTATE, 'message', SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- the audit trail must never be able to abort the caller's transaction
  END;
END $$;

COMMENT ON FUNCTION public.evaluate_student_badges_safe(uuid, text[]) IS
  'Trigger-safe wrapper around evaluate_student_badges: contains any failure in a subtransaction, warns, and records it in system_audit_logs (action=badge_evaluation_failed).';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Event wiring
-- ════════════════════════════════════════════════════════════════════════════
--
-- The spine (20260813140000) is ALREADY IN PRODUCTION and its trigger functions
-- are fixed, so nothing here redefines them. Instead:
--
--   * ONE row-level trigger on user_activity_log. Every qualifying event already
--     funnels through log_student_activity() -- exam submit, hybrid submit,
--     homework submit and study-material open all write exactly one row there --
--     so hanging the evaluator off that row covers all four paths with one
--     trigger instead of four, and ordering is guaranteed by construction: the
--     activity row exists before the evaluator can read it. (Adding parallel
--     triggers to student_exam_attempts / hybrid_exam_attempts / homework_
--     submissions would have to out-sort trg_log_* by NAME to get the same
--     guarantee, which is a fragile thing to depend on.)
--   * TWO statement-level triggers on final_results for the publish path.
--
-- §23 shape of the result path: a teacher publishing one class used to run the
-- FULL evaluator 40 times (each doing a ~120-row day series with two correlated
-- EXISTS per day, plus a year-wide exam sweep). It now runs ONCE PER STATEMENT,
-- over the DISTINCT students in that statement, with scope 'scores' -- which
-- touches only the two attempt tables and exams. A term-wide publish that lands
-- many exams for the same student in one statement now costs that student one
-- pass, not one per result row.
--
-- DEPLOY SEQUENCE. Run the silent backfill ONCE, immediately after this
-- migration, before students generate traffic. It awards everything the browser
-- hook failed to award without firing a notification per badge:
--
--   DO $backfill$
--   DECLARE r record;
--   BEGIN
--     FOR r IN SELECT ur.user_id FROM user_roles ur WHERE ur.role = 'student' LOOP
--       PERFORM public.evaluate_student_badges(r.user_id, false, ARRAY['all']);
--     END LOOP;
--   END $backfill$;
--
-- Skipping it is not harmful, only noisy: the first live event per student then
-- delivers their whole backlog as 3-9 notifications at once.

CREATE OR REPLACE FUNCTION public.tg_award_on_activity_logged()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scopes text[] := '{}'::text[];
BEGIN
  -- A NEW row means this (activity_type, day) pair did not exist, so the day may
  -- have just become active and the streak / comeback / monthly numbers can move.
  -- An UPDATE is a repeat of the same activity on a day that is already active:
  -- those three cannot change, so they are not recomputed.
  IF TG_OP = 'INSERT' THEN
    v_scopes := v_scopes || 'day'::text;
  END IF;

  IF NEW.activity_type = 'exam_submitted' THEN
    v_scopes := v_scopes || 'exam'::text;      -- exams_completed, all_exams_completed
  ELSIF NEW.activity_type = 'study_material_opened' THEN
    v_scopes := v_scopes || 'materials'::text;
  END IF;

  -- Nothing measurable changed (e.g. a second homework submission on a day that is
  -- already active): no metric this file owns counts homework, so do no work.
  IF array_length(v_scopes, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM public.evaluate_student_badges_safe(NEW.user_id, v_scopes);
  RETURN NULL;                                  -- AFTER trigger: return value ignored
END $$;

DROP TRIGGER IF EXISTS trg_z_award_on_activity ON user_activity_log;
CREATE TRIGGER trg_z_award_on_activity
  AFTER INSERT OR UPDATE OF "count" ON user_activity_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_award_on_activity_logged();

-- Clutch plays (Clean Hit, MVP Round, Ace, Century, Personal Best, In Form) all
-- depend on a PUBLISHED percentage, which appears long after submission and often
-- in a bulk publish by a teacher. final_results carries no student_id: the student
-- is reachable only through attempt_id -> student_exam_attempts.
--
-- Statement-level with transition tables, so one bulk publish is one pass per
-- distinct student. Postgres forbids transition tables on a trigger with more than
-- one event, and forbids them together with an UPDATE OF column list, hence two
-- triggers: the INSERT one filters on is_published, the UPDATE one uses the OLD
-- table to fire only on the transition into published (so an unrelated
-- final_results UPDATE produces an empty set and costs nothing).
DROP TRIGGER IF EXISTS trg_award_on_result_published   ON final_results;
DROP TRIGGER IF EXISTS trg_z_award_on_result_inserted  ON final_results;
DROP TRIGGER IF EXISTS trg_z_award_on_result_published ON final_results;
DROP FUNCTION IF EXISTS public.tg_award_on_result_published();

CREATE OR REPLACE FUNCTION public.tg_award_on_results_inserted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT sea.student_id
    FROM newrows nr
    JOIN student_exam_attempts sea ON sea.id = nr.attempt_id
    WHERE nr.is_published
  LOOP
    PERFORM public.evaluate_student_badges_safe(r.student_id, ARRAY['scores']);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.tg_award_on_results_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT sea.student_id
    FROM newrows nr
    JOIN oldrows o                 ON o.id = nr.id
    JOIN student_exam_attempts sea ON sea.id = nr.attempt_id
    WHERE nr.is_published AND NOT COALESCE(o.is_published, false)
  LOOP
    PERFORM public.evaluate_student_badges_safe(r.student_id, ARRAY['scores']);
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_z_award_on_result_inserted
  AFTER INSERT ON final_results
  REFERENCING NEW TABLE AS newrows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_award_on_results_inserted();

CREATE TRIGGER trg_z_award_on_result_published
  AFTER UPDATE ON final_results
  REFERENCING OLD TABLE AS oldrows NEW TABLE AS newrows
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_award_on_results_published();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Indexes
-- ════════════════════════════════════════════════════════════════════════════
-- No new FK is introduced by this migration, and every lookup the evaluator
-- performs is already index-backed (verified against pg_indexes 2026-08-13):
--   student_exam_attempts  idx_student_attempts_student (student_id)
--   final_results          final_results_attempt_id_key (attempt_id, unique)
--   hybrid_exam_attempts   idx_hybrid_attempts_student (student_id)
--   class_assignments      idx_class_assignments_user (user_id)
--   exam_classes           idx_exam_classes_class (class_id)
--   exams                  pkey
--   leave_requests         idx_leave_requests_student_created (student_id, ...)
--   cal_events             idx_cal_events_dates (institution_id, starts_on, ends_on)
--   user_activity_log      user_activity_log_user_date_idx (user_id, activity_date)
--   badge_progress         badge_progress_user_id_badge_id_key (upsert target)
--   user_badges            user_badges_once_per_period_idx (conflict target)
--
-- Deliberately NO index on badge_definitions. It holds ~44 rows, is effectively
-- pinned in shared_buffers, and a seq scan beats an index probe at that size; a
-- partial index there would be pure write overhead and planner noise. Revisit if
-- the catalog ever passes a few hundred rows.
DROP INDEX IF EXISTS public.badge_definitions_active_student_idx;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ════════════════════════════════════════════════════════════════════════════
-- Supabase's ALTER DEFAULT PRIVILEGES hands EXECUTE to anon on every new public
-- function and REVOKE FROM PUBLIC does not strip it, so revoke by name.
--
-- Both evaluator entry points take a user_id, so neither is exposed to
-- authenticated: granting it would let any student drive badge evaluation for any
-- other student's uuid. Clients never call these -- they reach the evaluator only
-- through the triggers, or through the spine's log_study_material_open, which
-- derives the user from auth.uid().
REVOKE ALL ON FUNCTION public.evaluate_student_badges(uuid, boolean, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_student_badges_safe(uuid, text[])     FROM PUBLIC, anon, authenticated;

-- Trigger functions are reached only by the trigger machinery, but the rule is
-- stated unconditionally and "it cannot be reached" has been wrong here before.
REVOKE ALL ON FUNCTION public.tg_award_on_activity_logged()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_award_on_results_inserted()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_award_on_results_published() FROM PUBLIC, anon, authenticated;

-- The spine's three trigger functions shipped without a revoke. These are ACL
-- statements only: no body is redefined, so the production functions are untouched.
REVOKE ALL ON FUNCTION public.tg_log_exam_submitted()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_log_homework_submitted()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_log_hybrid_exam_submitted() FROM PUBLIC, anon, authenticated;