-- leaderboard_badge_breakdown(_user_id) — "how did they earn those badges",
-- grouped into achievements rather than listed badge by badge.
--
-- WHY GROUPED: the ladders award every rung passed, so a 15 day streak hands
-- out Hat-trick (3), Flame (7) AND Blaze (15). Listing three lines for one
-- streak reads as three separate accomplishments and pads the story. One line
-- per METRIC, carrying the highest rung reached, is the honest summary:
-- student2's 9 badges are really 3 achievements (100% in an exam, 25 exams
-- completed, one personal best).
--
-- WHY SECURITY DEFINER: RLS on user_badges lets a student read only their OWN
-- rows ("Users view own badges" = user_id = auth.uid()). A client-side query
-- for a classmate returns zero rows and no error, so the popover would
-- confidently report that every other student has earned nothing. This
-- function re-applies badge_leaderboard()'s visibility rules and returns
-- nothing at all when the viewer may not see the target.

CREATE OR REPLACE FUNCTION public.leaderboard_badge_breakdown(_user_id uuid)
RETURNS TABLE (
  metric text,
  criteria_type text,
  top_value integer,
  badge_count integer,
  top_badge text,
  top_tier text,
  points integer,
  latest_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
  v_kind text;
  v_ok   boolean := false;
BEGIN
  IF v_uid IS NULL OR _user_id IS NULL THEN RETURN; END IF;

  v_inst := public.get_user_institution(v_uid);

  SELECT CASE
    WHEN public.has_role(v_uid, 'super_admin') THEN 'super_admin'
    WHEN public.has_role(v_uid, 'school_admin')
      OR public.has_role(v_uid, 'super_school_admin') THEN 'school_admin'
    WHEN public.has_role(v_uid, 'coordinator') THEN 'coordinator'
    WHEN public.has_role(v_uid, 'teacher') THEN 'teacher'
    WHEN public.has_role(v_uid, 'student') THEN 'student'
    ELSE 'none'
  END INTO v_kind;

  IF v_kind = 'none' OR (v_inst IS NULL AND v_kind <> 'super_admin') THEN RETURN; END IF;

  -- Same visibility rules as badge_leaderboard(). Kept as an explicit guard
  -- rather than trusting the caller to only ask about rows it already listed.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND (v_kind = 'super_admin' OR ur.institution_id = v_inst)
      AND (
        ur.user_id = v_uid
        OR CASE v_kind
             WHEN 'super_admin'  THEN true
             WHEN 'school_admin' THEN true
             WHEN 'coordinator'  THEN ur.role = 'coordinator'
             WHEN 'teacher'      THEN ur.role = 'teacher'
             WHEN 'student'      THEN ur.role = 'student' AND EXISTS (
               SELECT 1
               FROM public.class_assignments me
               JOIN public.class_assignments them
                 ON them.class_id = me.class_id AND them.role = 'student'
               WHERE me.user_id = v_uid AND me.role = 'student'
                 AND them.user_id = ur.user_id
             )
           END
      )
  ) INTO v_ok;

  IF NOT v_ok THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    bd.criteria_metric::text,
    bd.criteria_type::text,
    max(bd.criteria_value)::integer,
    -- For a ladder this is "rungs passed"; for the one re-earnable badge
    -- (Player of the Month) it is "months won", which the UI phrases
    -- differently off criteria_type = 'periodic'.
    count(*)::integer,
    (array_agg(bd.name ORDER BY bd.criteria_value DESC, bd.points DESC))[1]::text,
    (array_agg(bd.tier ORDER BY bd.criteria_value DESC, bd.points DESC))[1]::text,
    coalesce(sum(bd.points), 0)::integer,
    max(ub.earned_at)
  FROM public.user_badges ub
  JOIN public.badge_definitions bd ON bd.id = ub.badge_id
  WHERE ub.user_id = _user_id
  GROUP BY bd.criteria_metric, bd.criteria_type
  -- Biggest contributor first: the point of the list is to explain the score,
  -- so the group that supplied the most points leads.
  ORDER BY coalesce(sum(bd.points), 0) DESC, max(ub.earned_at) DESC;
END;
$$;

COMMENT ON FUNCTION public.leaderboard_badge_breakdown(uuid) IS
  'Per-user badge achievements GROUPED by criteria_metric, highest rung first, for the leaderboard info popover. Re-applies badge_leaderboard visibility: returns no rows when the caller may not see the target. Grouping exists because ladders award every rung passed, so a 15 day streak yields three badges but is one achievement.';

-- FROM PUBLIC first: Supabase grants EXECUTE to PUBLIC on every new public
-- function and anon inherits through it, so revoking anon by name is not enough.
REVOKE ALL ON FUNCTION public.leaderboard_badge_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leaderboard_badge_breakdown(uuid) TO authenticated;
