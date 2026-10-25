-- teacher_badge_rarity(): the cohort follows the ladder.
--
-- 20260904150000 opened the badge_type='teacher' ladder to coordinators, but
-- this read function still counted only user_roles.role = 'teacher' in BOTH the
-- numerator (holders) and the denominator (institution headcount). The moment
-- useTeacherBadgeRarity is wired into a tile, a coordinator would read
-- "earned by 0% of teachers" on a badge they hold, and every teacher's percent
-- would be computed over a headcount that excludes the coordinators who can
-- now earn the same badges. Same rule as the evaluator: teachers and
-- coordinators share one ladder, so they share one cohort.
--
-- Full re-emit of the 20260818130000 body with exactly two predicates changed
-- (ur.role and ur2.role: = 'teacher' -> IN ('teacher', 'coordinator')) and the
-- COMMENT updated. Grants re-asserted per CLAUDE.md §26 (REVOKE FROM anon by
-- name; REVOKE FROM PUBLIC alone does not strip it).
--
-- Applied to prod 2026-09-07 together with 20260904150000.

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
  WHERE ur.role IN ('teacher', 'coordinator') AND p.institution_id = v_inst;

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
          WHERE ur2.user_id = ub.user_id AND ur2.role IN ('teacher', 'coordinator')
        )
      GROUP BY ub.badge_id
    ) x
  ), '{}'::jsonb);
END $$;

COMMENT ON FUNCTION public.teacher_badge_rarity() IS
  'Per-badge holder count and percent for badge_type=teacher, denominated by TEACHERS AND COORDINATORS in the caller institution (the two roles share one ladder since 20260904150000). Separate from badge_rarity(), whose denominator is students.';

REVOKE ALL ON FUNCTION public.teacher_badge_rarity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_badge_rarity() TO authenticated;
