-- =============================================================
-- badge_leaderboard(_limit) — server-side aggregated leaderboard
-- (2026-07-27). Perf fix for the #2 total-DB-time query.
--
-- Replaces useBadgeLeaderboard's client-side pipeline, which fetched
-- EVERY user_badges row in the institution (unbounded select — silently
-- capped at 1000 rows by PostgREST, so results were also WRONG for
-- large institutions), all user_roles, and profiles in 500-id chunks,
-- then aggregated in the browser: 21k calls / 97.7 DB-minutes / 276ms
-- mean since 2026-07-02 (pg_stat_statements). One aggregate query
-- returns the top N rows only.
--
-- Role-visibility rules preserved exactly from the hook:
--   student      -> students sharing at least one class with the viewer
--   teacher      -> teachers of the institution
--   coordinator  -> coordinators of the institution
--   school_admin / super_school_admin -> everyone in the institution
--   super_admin  -> everyone, across institutions
--   (viewer always sees themself)
-- =============================================================

CREATE OR REPLACE FUNCTION public.badge_leaderboard(_limit integer DEFAULT 20)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  avatar_url text,
  role text,
  total_badges integer,
  total_points integer,
  bronze integer,
  silver integer,
  gold integer,
  platinum integer,
  diamond integer,
  latest_badge_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
  v_kind text;
  v_lim  integer := LEAST(GREATEST(coalesce(_limit, 20), 1), 100);
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

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

  IF v_kind = 'none' OR (v_inst IS NULL AND v_kind <> 'super_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH visible_users AS (
    -- The set of user_ids the viewer may see, per the role rules above.
    SELECT ur.user_id AS uid, min(ur.role::text) AS any_role
    FROM public.user_roles ur
    WHERE (v_kind = 'super_admin' OR ur.institution_id = v_inst)
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
    GROUP BY ur.user_id
  ),
  agg AS (
    SELECT
      ub.user_id AS uid,
      count(*)::integer                                       AS total_badges,
      coalesce(sum(bd.points), 0)::integer                    AS total_points,
      count(*) FILTER (WHERE bd.tier = 'bronze')::integer     AS bronze,
      count(*) FILTER (WHERE bd.tier = 'silver')::integer     AS silver,
      count(*) FILTER (WHERE bd.tier = 'gold')::integer       AS gold,
      count(*) FILTER (WHERE bd.tier = 'platinum')::integer   AS platinum,
      count(*) FILTER (WHERE bd.tier = 'diamond')::integer    AS diamond,
      max(ub.earned_at)                                       AS latest_badge_at
    FROM public.user_badges ub
    JOIN public.badge_definitions bd ON bd.id = ub.badge_id
    WHERE (v_kind = 'super_admin' OR ub.institution_id = v_inst)
      AND ub.user_id IN (SELECT vu.uid FROM visible_users vu)
    GROUP BY ub.user_id
  )
  SELECT
    a.uid,
    p.full_name,
    p.email,
    p.avatar_url,
    -- Highest-priority role of the target, for the role chip in the UI.
    (SELECT CASE
       WHEN bool_or(r.role = 'super_admin') THEN 'super_admin'
       WHEN bool_or(r.role = 'super_school_admin') THEN 'super_school_admin'
       WHEN bool_or(r.role = 'school_admin') THEN 'school_admin'
       WHEN bool_or(r.role = 'coordinator') THEN 'coordinator'
       WHEN bool_or(r.role = 'teacher') THEN 'teacher'
       ELSE 'student'
     END
     FROM public.user_roles r WHERE r.user_id = a.uid),
    a.total_badges,
    a.total_points,
    a.bronze, a.silver, a.gold, a.platinum, a.diamond,
    a.latest_badge_at
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.uid
  ORDER BY a.total_points DESC, a.total_badges DESC, a.latest_badge_at DESC NULLS LAST
  LIMIT v_lim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.badge_leaderboard(integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.badge_leaderboard(integer) FROM anon;
