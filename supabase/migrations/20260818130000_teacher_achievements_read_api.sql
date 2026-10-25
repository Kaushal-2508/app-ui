-- Teacher achievements, pass 2: the READ api the teacher badge surface renders from.
--
-- The deliberate mirror of 20260813180000_achievements_read_api.sql, with two
-- structural differences that are NOT oversights:
--
--   1. NO STREAK. Students have an activity spine (student_activity_days) that
--      makes "14 day streak" a measured fact. Teachers have no such spine, so
--      there is nothing honest to put in a streak field and the key is absent
--      rather than present-and-zero. A zero streak is a claim; a missing streak
--      is the truth.
--   2. Rarity gets its OWN function. badge_rarity() hardcodes the denominator to
--      students in the institution (2,498 in production against 265 teachers),
--      so reusing it for a teacher badge would divide teacher holders by the
--      student roll and print "earned by 3% of teachers" for a badge 30% of the
--      staffroom holds. Same shape, correct cohort. See teacher_badge_rarity().
--
-- Read-only by construction: this file WRITES nothing. Awarding lives in the
-- evaluator, and keeping the two apart means a teacher opening their profile can
-- never hand themselves a badge.

-- ── Next rank threshold ─────────────────────────────────────────────────────
-- badge_rank_for_points() owns the rank ladder. The student payload restates the
-- 100/300/600/1000 thresholds inline to answer "what does the next rank cost",
-- which is a second copy of a ladder that already exists in exactly one place.
-- Rather than add a third copy for teachers, this derives the answer FROM
-- badge_rank_for_points: the next threshold is simply the lowest point total
-- above the current one whose rank NAME differs.
--
-- Cost: badge_rank_for_points is an IMMUTABLE sql CASE, so the planner inlines
-- it and this is an in-memory scan of a few thousand integers, once per page
-- load. 5000 is a scan CEILING, not a threshold - any ladder defined below it is
-- discovered automatically, so moving a rank boundary needs no edit here.
CREATE OR REPLACE FUNCTION public.badge_next_rank_at(_points integer)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT min(g.p)::int
  FROM generate_series(GREATEST(COALESCE(_points, 0), 0) + 1, 5000) AS g(p)
  WHERE public.badge_rank_for_points(g.p)
     <> public.badge_rank_for_points(GREATEST(COALESCE(_points, 0), 0));
$$;

COMMENT ON FUNCTION public.badge_next_rank_at(integer) IS
  'Point total at which the badge rank changes next, or NULL at the top rank. Derived from badge_rank_for_points() so the ladder is stated in exactly one place and no surface can disagree with another about what the next rank costs.';

-- ── Rarity, teacher cohort ──────────────────────────────────────────────────
-- "Earned by 12% of teachers". Denominator is TEACHERS in the same institution:
-- a badge's rarity only means something against the cohort the holder actually
-- works alongside, and cross-tenant counts would leak the size of other schools.
--
-- The numerator is restricted to the same cohort as the denominator, so percent
-- is structurally incapable of exceeding 100. Only badge_type='teacher' rows are
-- returned, so no caller can pick up a student badge id and read it against a
-- teacher headcount.
CREATE OR REPLACE FUNCTION public.teacher_badge_rarity()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
  v_total int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT count(DISTINCT ur.user_id) INTO v_total
  FROM user_roles ur
  JOIN profiles p ON p.id = ur.user_id
  WHERE ur.role = 'teacher' AND p.institution_id = v_inst;

  RETURN COALESCE((
    SELECT jsonb_object_agg(x.badge_id, jsonb_build_object(
             'holders', x.holders,
             -- NULL rather than 0 when the cohort is empty: "earned by 0%" is a
             -- claim, "unknown" is the truth.
             'percent', CASE WHEN v_total > 0
                             THEN round(x.holders * 100.0 / v_total, 1) END))
    FROM (
      SELECT ub.badge_id, count(DISTINCT ub.user_id) AS holders
      FROM user_badges ub
      JOIN badge_definitions bd ON bd.id = ub.badge_id AND bd.badge_type = 'teacher'
      JOIN profiles p2 ON p2.id = ub.user_id
      WHERE p2.institution_id = v_inst
        AND EXISTS (
          SELECT 1 FROM user_roles ur2
          WHERE ur2.user_id = ub.user_id AND ur2.role = 'teacher'
        )
      GROUP BY ub.badge_id
    ) x
  ), '{}'::jsonb);
END $$;

COMMENT ON FUNCTION public.teacher_badge_rarity() IS
  'Per-badge holder count and percent for badge_type=teacher, denominated by TEACHERS in the caller institution. Separate from badge_rarity(), whose denominator is hardcoded to students and would understate teacher rarity roughly tenfold.';

-- ── One-call page payload ───────────────────────────────────────────────────
-- Catalog + earned + progress + points + rank in ONE call. The teacher surface
-- is opened constantly, and four round trips that each re-count points in the
-- browser is the exact shape that collapsed the platform at 60 users (§23).
--
-- Everything is scoped to badge_type='teacher'. A user who holds both student and
-- teacher badges (a teacher who was once a student in the same tenant) sees their
-- teaching points here and their student points on the student surface, rather
-- than one inflated number on both.
--
-- No date arithmetic anywhere in this file, so §24 does not apply: there is no
-- CURRENT_DATE, no now()::date, and nothing to shift across a timezone.
CREATE OR REPLACE FUNCTION public.teacher_achievements()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_points int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Points sum over EARNED rows and deliberately do NOT filter on is_active, so
  -- a teacher never loses points because the catalog was reorganised under them.
  -- Student Mentor, Impact Creator and Speed Demon are being deactivated in this
  -- same pass; anyone holding one keeps the points it was awarded with.
  SELECT COALESCE(sum(bd.points), 0) INTO v_points
  FROM user_badges ub
  JOIN badge_definitions bd ON bd.id = ub.badge_id
  WHERE ub.user_id = v_uid AND bd.badge_type = 'teacher';

  RETURN jsonb_build_object(
    'points', v_points,
    -- Same ladder as students on purpose: one rank vocabulary across the
    -- platform, so "gold" means the same thing on any leaderboard.
    'rank', public.badge_rank_for_points(v_points),
    'next_rank_at', public.badge_next_rank_at(v_points),
    'catalog', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', bd.id, 'name', bd.name, 'description', bd.description,
               'icon_name', bd.icon_name, 'category', bd.category, 'tier', bd.tier,
               'points', bd.points, 'criteria_type', bd.criteria_type,
               'criteria_metric', bd.criteria_metric, 'criteria_value', bd.criteria_value,
               'display_order', bd.display_order)
             ORDER BY bd.display_order, bd.name)
      FROM badge_definitions bd
      WHERE bd.is_active AND bd.badge_type = 'teacher'), '[]'::jsonb),
    -- An ARRAY, not a map, matching the student payload: nothing in the teacher
    -- catalog is re-earnable today, but a map would silently collapse the rows
    -- the moment a periodic teacher badge is added, and that is a bug that only
    -- shows up in production a month after the badge ships.
    'earned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'badge_id', ub.badge_id, 'earned_at', ub.earned_at,
               'period_key', ub.period_key)
             ORDER BY ub.earned_at DESC)
      FROM user_badges ub
      JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.user_id = v_uid AND bd.badge_type = 'teacher'), '[]'::jsonb),
    -- Written by the evaluator, read here. A badge ABSENT from this map has not
    -- been measured yet, which is not the same as measured-at-zero: a teacher
    -- with 12 exams whose progress row does not exist must not be shown "0 of 25"
    -- as a fact.
    --
    -- Target comes from the CATALOG for count badges rather than from the stored
    -- target_value, because every teacher badge is a plain count and the catalog
    -- is its authority. This pass re-values Task Master (20 -> 15) and Task
    -- Champion (50 -> 30); reading the stored target would show the old goal
    -- until the evaluator next rewrote the row. Any future non-count teacher
    -- badge keeps the evaluator's computed target (a periodic badge clamped to
    -- the number of days in the month, say), which the catalog cannot know.
    'progress', COALESCE((
      SELECT jsonb_object_agg(bp.badge_id, jsonb_build_object(
               'current', bp.current_value,
               'target', CASE WHEN bd.criteria_type = 'count'
                              THEN bd.criteria_value
                              ELSE COALESCE(bp.target_value, bd.criteria_value) END))
      FROM badge_progress bp
      JOIN badge_definitions bd ON bd.id = bp.badge_id
      WHERE bp.user_id = v_uid AND bd.badge_type = 'teacher'), '{}'::jsonb)
  );
END $$;

COMMENT ON FUNCTION public.teacher_achievements() IS
  'Everything the teacher achievements surface renders, in one call: points, rank, next_rank_at, catalog, earned, progress. Scoped to badge_type=teacher. No streak key: teachers have no activity spine, so a streak would have to be invented.';

-- FROM PUBLIC first, not just FROM anon. Supabase ALTER DEFAULT PRIVILEGES grants
-- EXECUTE to PUBLIC on every new public function and anon inherits through it, so
-- revoking the role by name leaves the hole wide open.
REVOKE ALL ON FUNCTION public.badge_next_rank_at(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_badge_rarity()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_achievements()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.badge_next_rank_at(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_badge_rarity()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_achievements()      TO authenticated;
