-- Achievements redesign, pass 2: the badge CATALOG.
--
-- Pass 1 (20260813140000) built the activity spine (user_activity_log writes,
-- public.student_streak, the per-period UNIQUE on user_badges) and renamed the
-- eight badges whose criteria already matched the new product design. This
-- migration is the catalog only: it declares WHAT can be earned. The evaluator
-- that decides WHO earns it ships separately, so nothing here awards anything
-- and NOT ONE user_badges row is read, written or deleted.
--
-- Why catalog and evaluator are split: 1,180 awards are live across 537
-- students. Inserting definitions is reversible (flip is_active); awarding is
-- not, because a badge that appears and then vanishes is a support ticket.
--
-- ── FILE OWNERSHIP (locked) ────────────────────────────────────────────────
--
-- THIS FILE IS THE SOLE WRITER OF badge_definitions for the student
-- achievement set. Every INSERT, recategorise, display_order move and
-- deactivation of a student badge lives here and nowhere else.
--   20260813160000 (evaluator)  READS definitions; writes user_badges /
--                               badge_progress / notifications ONLY.
--   20260813170000 (scheduled)  READS definitions (always filtered
--                               badge_type = 'student'); writes user_badges.
-- Two migrations owning the same rows means whichever runs last silently wins,
-- and the migration ledger in this repo is known-stale, so "last" is not even
-- predictable. If a sibling migration ever grows a badge_definitions write,
-- delete it there and add it here.
--
-- §-rules that apply here: none of 2 (no new function), 4 (no new FK) or 5 (no
-- new RLS policy) are in scope. Rule 7 (idempotent) is: every statement below
-- is guarded and the file converges on re-run rather than duplicating.
--
-- ── Criteria vocabulary (the contract with the evaluator) ───────────────────
--
-- criteria_type answers "how is the value compared, and how does the UI draw
-- the un-earned state". Every row below lands on EXACTLY ONE display variant:
--   count      cumulative counter, award at >= criteria_value   -> progress bar
--   streak     consecutive active days (public.student_streak)  -> progress bar
--   threshold  BEST single observation vs criteria_value        -> "best so far
--              74%, need 90%". NEVER a progress bar: a progress bar on a
--              single-exam threshold reads as "you are 74% of the way there",
--              which is false. One exam either clears the bar or it does not.
--   event      a discrete qualifying occurrence, criteria_value parameterises
--              the window                                       -> no bar
--   periodic   re-earnable inside a period, written with user_badges.period_key
--                                                               -> bar for the
--              current period only, resets when the period rolls
--   aggregate  computed across the whole academic year, no meaningful
--              intermediate progress                            -> rarity
--              indicator ("Top 1%", "Earned by 4% of students")
--
-- criteria_metric answers "which number does the evaluator compute". One
-- metric = one evaluator branch. Full list at the bottom of this file.
--
-- category drives EVALUATION TIMING, not just grouping:
--   streak_ranks / quest_log / clutch_plays  evaluated on every qualifying event
--   monthly_form                             evaluated per calendar month
--   legendary                                evaluated ONCE at academic year end
-- That is why Double Century is criteria_type 'count' (it wants a progress bar
-- reading "1 of 2 perfect scores") yet still only lands at year end: the bar is
-- a display concern, the timing is a category concern, and conflating the two
-- would force a choice between a wrong bar and a wrong award date. The
-- evaluator must never award ANY badge whose category is 'legendary'.
--
-- ── Two deliberate naming decisions ────────────────────────────────────────
--
-- 1. Double Century uses metric 'perfect_score_count', NOT the existing
--    'perfect_scores'. useAutoBadgeAward.ts still runs IN THE BROWSER and
--    awards any active badge whose criteria_metric is in its hardcoded list
--    (exams_completed, exams_passed, perfect_scores, login_days, portal_visits,
--    exams_created, evaluations_done, questions_generated), which includes
--    'perfect_scores'. Reusing that word would let the legacy client hand out a
--    200-point legendary badge the moment a student hit two perfect scores,
--    months before the year-end pass and with no rarity context. None of the 18
--    metrics below appear in that hardcoded list, so the legacy awarder cannot
--    touch any new badge. NEVER rename this metric to 'perfect_scores'.
--    Frontend dependency: 'perfect_score_count' must be present in
--    CUMULATIVE_METRICS (src/hooks/useStudentAchievements.ts) or Double Century
--    silently loses the progress bar its criteria_type 'count' promises.
-- 2. Grand Slam's criteria_value is 100 = PERCENT OF THE REQUIRED SET, and the
--    required set is "every exam scheduled for you this academic year, minus
--    those inside an approved leave window". criteria_value IS the award
--    threshold everywhere else in this catalog (the evaluator compares
--    (stats ->> criteria_metric)::numeric >= bd.criteria_value), so storing the
--    80% completion floor here would award Grand Slam at 80% of the year and
--    contradict the locked product decision. The floor is a SEPARATE named
--    constant in the evaluator; it is never criteria_value.

-- ── 0. The uniqueness the whole file already assumes ───────────────────────
--
-- badge_definitions has NO unique constraint on name and must NOT gain one:
-- teacher and coordinator badges legally share names with student ones
-- ('Task Starter' vs a future student equivalent). But every guard below is on
-- (badge_type, name), and 20260813170000 resolves badges by name, so that pair
-- has to actually be unique or two concurrent applications (or one manual
-- dashboard insert) produce duplicate student rows that the UPDATE then
-- configures identically and students see the badge twice. Created BEFORE the
-- INSERT so the INSERT is protected by it. If this fails, duplicates already
-- exist and must be merged by hand: that is the correct loud failure.

CREATE UNIQUE INDEX IF NOT EXISTS badge_definitions_type_name_idx
  ON public.badge_definitions (badge_type, name);

-- ── 1. The 18 new definitions ──────────────────────────────────────────────
--
-- The trailing UPDATE makes the file a declarative catalog rather than a
-- one-shot insert. Because a data-modifying CTE cannot see its own output, that
-- UPDATE touches ONLY rows that already existed - i.e. exactly the insert-skip
-- path - and on a first run it matches nothing. On any re-run it re-asserts the
-- criteria the evaluator depends on, so a hand-edit in the Supabase dashboard
-- cannot silently desync criteria_value from the evaluator branch that reads it.
--
-- is_active IS re-asserted to true for these 18 names. It used to be excluded
-- so that "deactivating a badge is an admin decision" survived a re-run, but
-- that let the insert-skip path silently ADOPT a pre-existing inactive row: the
-- INSERT skips it, the UPDATE configures it perfectly, and the result is a
-- badge that is correctly categorised, correctly priced, invisible in every
-- student's catalog (20260813180000 filters WHERE bd.is_active) and awardable
-- never, with no error anywhere. §3's four retirements are a disjoint set of
-- names, so re-asserting here never undoes them. Retiring one of THESE 18 is a
-- catalog change: move it into §3.
--
-- icon_name values are constrained to the 41 names src/components/badges/
-- BadgeIcon.tsx actually maps (26 original + 15 added 2026-08-13 for this set:
-- gem, sparkles, target, activity, calendar-check, rotate-ccw, shield-check,
-- dumbbell, notebook-pen, swords, rocket, crosshair, scroll-text, percent,
-- infinity); anything else silently falls back to Award. All 13 icons used
-- below are deliberate and stand as the reconciled set: 'crown' differentiates
-- the top of the streak ladder from the shared 'flame' rungs, and 'trophy' is
-- reserved for Double Century, so Legacy and Grand Slam do not take them. The
-- streak ladder shares 'flame' on purpose and is differentiated by tier colour,
-- which BadgeCard already renders per tier. Trimming the icon entries this
-- catalog does not use is a frontend cleanup, not a catalog change.

WITH cat (name, description, icon_name, category, tier,
          criteria_type, criteria_metric, criteria_value, points, display_order) AS (
  VALUES
  -- Streak Ranks. criteria_value is the day count public.student_streak must
  -- return. Comeback is not part of the ladder: it rewards recovery, so its
  -- value is the 48-hour grace WINDOW, and the 3-day rebuild it requires is the
  -- Hat-trick rank it mirrors.
  ('Hat-trick',           'Stay active 3 days in a row',                              'flame',           'streak_ranks',  'bronze',    'streak',    'streak_days',            3,  10, 120),
  ('Flame',               'Stay active 7 days in a row',                               'flame',           'streak_ranks',  'bronze',    'streak',    'streak_days',            7,  15, 121),
  ('Blaze',               'Stay active 15 days in a row',                              'flame',           'streak_ranks',  'silver',    'streak',    'streak_days',           15,  30, 122),
  ('Inferno',             'Stay active 30 days in a row',                              'flame',           'streak_ranks',  'gold',      'streak',    'streak_days',           30,  60, 123),
  ('Wildfire',            'Stay active 60 days in a row',                              'flame',           'streak_ranks',  'platinum',  'streak',    'streak_days',           60, 120, 124),
  ('Eternal Flame',       'Stay active 100 days in a row',                             'flame',           'streak_ranks',  'diamond',   'streak',    'streak_days',          100, 250, 125),
  ('Legacy',              'Stay active 150 days in a row',                             'crown',           'streak_ranks',  'diamond',   'streak',    'streak_days',          150, 400, 126),
  ('Comeback',            'Rebuild a 3 day streak within 48 hours of breaking one',    'clock',           'streak_ranks',  'bronze',    'event',     'streak_comeback_hours',  48,  10, 127),

  -- Quest Log. Playbook Pro counts user_activity_log rows of type
  -- 'study_material_opened', which only public.log_study_material_open writes
  -- and which already refuses materials outside the student's institution.
  --
  -- Grand Slam: 100 = percent of the REQUIRED set (this year's scheduled exams
  -- minus any inside an approved leave window), so it awards only on a complete
  -- year. It is 'aggregate', not 'count': a year-end verdict with no honest
  -- intermediate reading, so the UI shows rarity and never a bar. Typed 'count'
  -- it matched no display variant at all, and the "next badge" callout rendered
  -- it as "0 of 80".
  ('Playbook Pro',        'Open 10 study materials',                                   'book-open',       'quest_log',     'silver',    'count',     'study_materials_opened', 10,  20, 112),
  ('Grand Slam',          'Complete every exam scheduled for you this year',           'check-square',    'quest_log',     'diamond',   'aggregate', 'all_exams_completed',   100, 200, 115),

  -- Clutch Plays. Personal Best is an 'event' rather than a threshold because
  -- the qualifying thing is a DELTA between two consecutive results, so there
  -- is no "best so far" to show against a bar.
  ('Personal Best',       'Beat your own previous exam score by 15 points or more',    'zap',             'clutch_plays',  'bronze',    'event',     'score_improvement',      15,  20, 131),
  ('In Form',             'Score 90% or above in 3 different exams',                   'check-circle',    'clutch_plays',  'platinum',  'count',     'exams_at_90',             3, 150, 135),

  -- Monthly Form. criteria_value is the CAP, not the target: the evaluator
  -- awards at LEAST(15, ceil(0.6 * school days in that month)), where school
  -- days exclude cal_events kind='holiday'. A short, holiday-heavy month must
  -- not demand more active days than it contains.
  ('Player of the Month', 'Be active on most school days this month',                  'medal',           'monthly_form',  'silver',    'periodic',  'active_days_in_month',   15,  20, 140),

  -- Legendary. Every one of these is a year-end verdict; the UI shows rarity,
  -- not progress, because a half-finished year says nothing about the outcome.
  --
  -- WARNING on the four criteria_values below: 20260813170000 currently
  -- HARDCODES the same numbers (>= 90 for subject_avg_min, top 1% for
  -- streak_percentile, the full year for streak_full_year) instead of reading
  -- them from here. These rows are therefore the source of truth for DISPLAY
  -- only, and a retune is a two-file change until that job is switched to read
  -- badge_definitions.criteria_value. Do not describe them as tunable-by-UPDATE.
  ('Undefeated',          'Average 90% or above in every single subject this year',    'shield',          'legendary',     'legendary', 'aggregate', 'subject_avg_min',        90, 300, 150),
  -- class_first_place_count is a RANK-BASED SENTINEL, not a threshold. The rule
  -- is "highest count of first places in each class wins, EXACTLY ONE MVP per
  -- class"; 1 is the floor to enter the ranking (you must have topped at least
  -- one exam), never a `>= criteria_value` award test. Read as a threshold it
  -- would hand Class MVP to every student who topped a single exam.
  ('Class MVP',           'Top your class in more exams than anyone else this year',   'users-2',         'legendary',     'legendary', 'aggregate', 'class_first_place_count', 1, 300, 151),
  -- 1 = top N percent of the school-wide streak leaderboard.
  ('All-Star',            'Finish in the top 1% of the school streak leaderboard',     'star',            'legendary',     'legendary', 'aggregate', 'streak_percentile',       1, 250, 152),
  -- 2 = exams scored at EXACTLY 100%, counted once per exam. Category is
  -- legendary, so this lands at year end even though its type draws a bar.
  ('Double Century',      'Score 100% in two different exams',                         'trophy',          'legendary',     'legendary', 'count',     'perfect_score_count',     2, 200, 153),
  -- 100 = percent of the academic year's instructional days, derived from
  -- cal_academic_years at evaluation time. Storing a day count here would
  -- hardcode one institution's calendar into a global catalog row.
  ('Immortal',            'Keep your streak alive for the entire academic year',       'sun',             'legendary',     'legendary', 'aggregate', 'streak_full_year',      100, 500, 154)
),
ins AS (
  INSERT INTO public.badge_definitions
    (name, description, icon_name, badge_type, category, tier,
     criteria_type, criteria_metric, criteria_value, points, display_order, is_active)
  SELECT c.name, c.description, c.icon_name, 'student', c.category, c.tier,
         c.criteria_type, c.criteria_metric, c.criteria_value, c.points, c.display_order, true
  FROM cat c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.badge_definitions b
    WHERE b.name = c.name AND b.badge_type = 'student'
  )
  RETURNING 1
)
UPDATE public.badge_definitions b
SET description    = c.description,
    icon_name      = c.icon_name,
    category       = c.category,
    tier           = c.tier,
    criteria_type  = c.criteria_type,
    criteria_metric = c.criteria_metric,
    criteria_value = c.criteria_value,
    points         = c.points,
    display_order  = c.display_order,
    is_active      = true,
    updated_at     = now()
FROM cat c
WHERE b.name = c.name
  AND b.badge_type = 'student'
  AND (b.description, b.icon_name, b.category, b.tier,
       b.criteria_type, b.criteria_metric, b.criteria_value, b.points, b.display_order,
       b.is_active)
      IS DISTINCT FROM
      (c.description, c.icon_name, c.category, c.tier,
       c.criteria_type, c.criteria_metric, c.criteria_value, c.points, c.display_order,
       true);

-- ── 2. Recategorise the eight badges renamed in pass 1 ─────────────────────
--
-- Same ids, same criteria, same points, same tier: only the shelf they sit on
-- changes, so every earned record follows untouched. display_order moves with
-- them because the legacy values (1-9) were an ordering within the OLD
-- categories and would interleave the new arrivals wrongly. The new blocks are
-- 110+ so they never collide with the teacher/coordinator range (20-33).
--
-- Quest Log reads: Debut, Regular Starter, Playbook Pro, Iron Man, First XI,
-- Grand Slam. Clutch Plays reads: Clean Hit, Personal Best, MVP Round, Ace,
-- Century, In Form. The gaps at 112 and 131/135 are the new badges inserted
-- above, slotted into the ladder rather than appended after it.
--
-- Each guard tests category OR display_order. Guarding on category alone made
-- the statement a permanent no-op the moment the category was right, so a
-- drifted or hand-edited display_order could never be repaired - which is
-- exactly the desync §1's trailing UPDATE exists to prevent.

UPDATE public.badge_definitions SET category = 'quest_log', display_order = 110, updated_at = now()
  WHERE name = 'Debut'           AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'quest_log' OR display_order IS DISTINCT FROM 110);
UPDATE public.badge_definitions SET category = 'quest_log', display_order = 111, updated_at = now()
  WHERE name = 'Regular Starter' AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'quest_log' OR display_order IS DISTINCT FROM 111);
UPDATE public.badge_definitions SET category = 'quest_log', display_order = 113, updated_at = now()
  WHERE name = 'Iron Man'        AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'quest_log' OR display_order IS DISTINCT FROM 113);
UPDATE public.badge_definitions SET category = 'quest_log', display_order = 114, updated_at = now()
  WHERE name = 'First XI'        AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'quest_log' OR display_order IS DISTINCT FROM 114);

UPDATE public.badge_definitions SET category = 'clutch_plays', display_order = 130, updated_at = now()
  WHERE name = 'Clean Hit'  AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'clutch_plays' OR display_order IS DISTINCT FROM 130);
UPDATE public.badge_definitions SET category = 'clutch_plays', display_order = 132, updated_at = now()
  WHERE name = 'MVP Round'  AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'clutch_plays' OR display_order IS DISTINCT FROM 132);
UPDATE public.badge_definitions SET category = 'clutch_plays', display_order = 133, updated_at = now()
  WHERE name = 'Ace'        AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'clutch_plays' OR display_order IS DISTINCT FROM 133);
UPDATE public.badge_definitions SET category = 'clutch_plays', display_order = 134, updated_at = now()
  WHERE name = 'Century'    AND badge_type = 'student'
    AND (category IS DISTINCT FROM 'clutch_plays' OR display_order IS DISTINCT FROM 134);

-- ── 3. Retire the four superseded badges ───────────────────────────────────
--
-- is_active = false, never DELETE. The rows stay so the students who already
-- hold them keep the badge on their passport and keep the points in their rank
-- total; only new awards stop. Deleting would cascade user_badges and silently
-- demote real people down the leaderboard.
--
-- Early Bird / Dedicated Learner / Study Champion are the old login-streak
-- ladder (5/15/30 days on criteria_metric 'login_streak'). They collide head-on
-- with the new Streak Ranks and, per pass 1, never actually fired: the client
-- awarder looks up 'login_days'/'portal_visits' and nothing has ever written a
-- 'login' activity row. Exam Legend (50 exams) has no slot in the Quest Log,
-- which tops out at First XI (25) and then hands off to Grand Slam.
--
-- These four names are disjoint from §1's 18, so §1's is_active = true
-- re-assertion cannot resurrect them on a re-run.

UPDATE public.badge_definitions
SET is_active = false, updated_at = now()
WHERE badge_type = 'student'
  AND name IN ('Early Bird', 'Dedicated Learner', 'Study Champion', 'Exam Legend')
  AND is_active IS DISTINCT FROM false;

-- ── Metric vocabulary reference ────────────────────────────────────────────
-- These strings are the locked contract. The evaluator and the scheduled job
-- dispatch on them and src/hooks/useStudentAchievements.ts matches them; do not
-- rename one without changing all four places in the same commit.
--
-- Existing, unchanged (evaluator must keep honouring these):
--   exams_completed        cumulative submitted attempts       count
--   exam_percentage        best single published percentage    threshold
-- New in this migration:
--   streak_days            public.student_streak ->> 'current'          streak
--   streak_comeback_hours  48 = the wall-clock window between a break   event
--                          and a 3-day rebuild. Wall clock, not school
--                          days: holidays are neutral for the STREAK,
--                          never for this window.
--   study_materials_opened user_activity_log 'study_material_opened'    count
--   all_exams_completed    percent of the REQUIRED set, so 100 = every  aggregate
--                          one. Required set = this year's scheduled
--                          exams minus those inside an approved leave
--                          window. The 80% completion FLOOR is a
--                          separate named constant in the evaluator and
--                          must never be stored in criteria_value.
--   score_improvement      percentage-point gain over own previous exam event
--   exams_at_90            distinct published results >= 90%            count
--   active_days_in_month   distinct active days this calendar month,    periodic
--                          15 = the CAP; real target is
--                          LEAST(15, ceil(0.6 * school days))
--   subject_avg_min        lowest per-subject yearly average, over      aggregate
--                          90 = the minimum that average may be.
--                          Exams with no linked subject (no
--                          exam_subjects row) are EXCLUDED from the
--                          per-subject calculation - locked product
--                          decision, and live: 14 of 1,127 exams have
--                          no exam_subjects row.
--   class_first_place_count RANK-BASED SENTINEL, not a threshold:       aggregate
--                          highest count of first places per class
--                          wins, EXACTLY ONE MVP per class. 1 = the
--                          floor to enter the ranking, never an award
--                          test.
--   streak_percentile      school-wide streak rank, 1 = top 1 percent   aggregate
--   perfect_score_count    published results at EXACTLY 100%, counted   count
--                          once per exam. NEVER rename to
--                          'perfect_scores' (browser awarder, see above).
--   streak_full_year       percent of the academic year's days held     aggregate
--                          unbroken, so 100 = the whole year