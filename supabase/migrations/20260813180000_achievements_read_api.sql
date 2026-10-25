-- Achievements redesign, pass 2: the READ api the redesigned tab renders from.
--
-- Separate from the evaluator (which WRITES awards) on purpose: these are STABLE
-- read-only functions the student's own page calls, and keeping them apart means
-- a read path can never accidentally award a badge.
--
-- Rarity is computed LIVE rather than as a scheduled aggregate. At current volume
-- (2,498 students, 1,180 award rows, 26 student badges) the grouping is trivial,
-- and the codebase already leans this way: badge_leaderboard is a plain RPC, not
-- a materialized view. Revisit only if the student base grows ~50x.

-- ── Rank track ──────────────────────────────────────────────────────────────
-- Thresholds were hardcoded in the FRONTEND (AchievementsPage.tsx TierProgress).
-- Moving them server-side so the rank a student sees and the rank any other
-- surface computes can never disagree.
CREATE OR REPLACE FUNCTION public.badge_rank_for_points(_points integer)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN COALESCE(_points, 0) >= 1000 THEN 'diamond'
           WHEN _points >= 600  THEN 'platinum'
           WHEN _points >= 300  THEN 'gold'
           WHEN _points >= 100  THEN 'silver'
           ELSE 'bronze'
         END;
$$;

-- ── Rarity ──────────────────────────────────────────────────────────────────
-- "Earned by 4% of students". Denominator is students in the SAME institution,
-- because a badge's rarity only means something against the cohort a student is
-- actually competing with, and cross-tenant counts would leak the size of other
-- schools.
CREATE OR REPLACE FUNCTION public.badge_rarity()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_total int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT count(DISTINCT ur.user_id) INTO v_total
  FROM user_roles ur
  JOIN profiles p ON p.id = ur.user_id
  WHERE ur.role = 'student' AND p.institution_id = v_inst;

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
      JOIN profiles p2 ON p2.id = ub.user_id
      WHERE p2.institution_id = v_inst
      GROUP BY ub.badge_id
    ) x
  ), '{}'::jsonb);
END $$;

-- ── One-call page payload ───────────────────────────────────────────────────
-- The achievements tab needs catalog + earned + progress + points + rank + streak.
-- Six round trips on a page a student opens constantly is exactly the pattern that
-- collapsed the platform at 60 users (§23), so it is ONE call.
CREATE OR REPLACE FUNCTION public.student_achievements()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_points int;
  v_streak jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Points are summed over EARNED rows, including badges since deactivated, so a
  -- student never loses points because the catalog was reorganised under them.
  SELECT COALESCE(sum(bd.points), 0) INTO v_points
  FROM user_badges ub
  JOIN badge_definitions bd ON bd.id = ub.badge_id
  WHERE ub.user_id = v_uid;

  v_streak := public.student_streak(v_uid);

  RETURN jsonb_build_object(
    'points', v_points,
    'rank', public.badge_rank_for_points(v_points),
    'next_rank_at', CASE
                      WHEN v_points >= 1000 THEN NULL
                      WHEN v_points >= 600  THEN 1000
                      WHEN v_points >= 300  THEN 600
                      WHEN v_points >= 100  THEN 300
                      ELSE 100 END,
    'streak', v_streak,
    'catalog', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', bd.id, 'name', bd.name, 'description', bd.description,
               'icon_name', bd.icon_name, 'category', bd.category, 'tier', bd.tier,
               'points', bd.points, 'criteria_type', bd.criteria_type,
               'criteria_metric', bd.criteria_metric, 'criteria_value', bd.criteria_value,
               'display_order', bd.display_order)
             ORDER BY bd.display_order, bd.name)
      FROM badge_definitions bd
      WHERE bd.is_active AND bd.badge_type = 'student'), '[]'::jsonb),
    -- Earned is an ARRAY, not a map: Player of the Month can be held many times
    -- over a year, one row per period_key, and a map would silently collapse them.
    'earned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'badge_id', ub.badge_id, 'earned_at', ub.earned_at,
               'period_key', ub.period_key)
             ORDER BY ub.earned_at DESC)
      FROM user_badges ub WHERE ub.user_id = v_uid), '[]'::jsonb),
    'progress', COALESCE((
      SELECT jsonb_object_agg(bp.badge_id, jsonb_build_object(
               'current', bp.current_value, 'target', bp.target_value))
      FROM badge_progress bp WHERE bp.user_id = v_uid), '{}'::jsonb)
  );
END $$;

-- FROM PUBLIC first, not just FROM anon. Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE to PUBLIC on every new public function, and anon inherits
-- through it, so revoking the role by name leaves the hole wide open. This is
-- the same mistake the spine migration made (fixed in 20260813145000).
REVOKE ALL ON FUNCTION public.badge_rarity()                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_achievements()          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.badge_rank_for_points(integer)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.badge_rarity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_achievements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.badge_rank_for_points(integer) TO authenticated;