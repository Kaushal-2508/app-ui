-- Fix: the student activity signal undercounted, and "never opened the portal"
-- was factually wrong.
--
-- WHAT WAS WRONG
-- --------------
-- student_activity_daily was seeded ONLY from auth.refresh_tokens. Measured on
-- Teacher2's Class 12 Science Non-Medical A (2026-08-19): all 9 students have a
-- non-null auth.users.last_sign_in_at, but only 1 of 9 has any refresh_tokens
-- row — GoTrue prunes/revokes them here. Consequences on screen:
--   * Today / Yesterday / 7-day / 30-day all read 0 while student2 had signed in
--     the previous day (2026-08-18);
--   * the "Not using the portal" card labelled student2 "Never opened the
--     portal", which is simply false.
--
-- FIX
-- ---
-- 1. Seed the rollup from BOTH sources. refresh_tokens stays because it is
--    fine-grained (a row per active day); last_sign_in_at is coarse (one row,
--    the most recent visit only) but survives token pruning, so together they
--    floor the count at the truth instead of far below it.
-- 2. Derive "never seen" from auth.users.last_sign_in_at IS NULL — the only
--    authoritative answer — never from absence in the rollup.

-- ---------------------------------------------------------------------------
-- 1. Two-source rollup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_student_activity_daily(_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_a integer := 0; v_b integer := 0;
BEGIN
  -- (a) Token refreshes: one row per day the student was actually active.
  --     auth.refresh_tokens.user_id is character varying, NOT uuid.
  INSERT INTO public.student_activity_daily (student_id, institution_id, activity_date, source)
  SELECT DISTINCT rt.user_id::uuid, p.institution_id, (rt.updated_at)::date, 'refresh_token'
    FROM auth.refresh_tokens rt
    JOIN public.profiles p   ON p.id = rt.user_id::uuid
    JOIN public.user_roles ur ON ur.user_id = rt.user_id::uuid AND ur.role = 'student'
   WHERE rt.updated_at >= (now() - make_interval(days => _days))
     AND rt.user_id IS NOT NULL
  ON CONFLICT (student_id, activity_date) DO NOTHING;
  GET DIAGNOSTICS v_a = ROW_COUNT;

  -- (b) Last sign-in: coarse but survives token pruning. Without this the
  --     rollup missed 8 of 9 students in the measured class.
  INSERT INTO public.student_activity_daily (student_id, institution_id, activity_date, source)
  SELECT u.id, p.institution_id, (u.last_sign_in_at)::date, 'last_sign_in'
    FROM auth.users u
    JOIN public.profiles p    ON p.id = u.id
    JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'student'
   WHERE u.last_sign_in_at IS NOT NULL
     AND u.last_sign_in_at >= (now() - make_interval(days => _days))
  ON CONFLICT (student_id, activity_date) DO NOTHING;
  GET DIAGNOSTICS v_b = ROW_COUNT;

  RETURN v_a + v_b;
END $function$;

REVOKE ALL ON FUNCTION public.snapshot_student_activity_daily(integer) FROM PUBLIC, anon, authenticated;

-- Re-seed history now that the second source exists.
SELECT public.snapshot_student_activity_daily(400);

-- ---------------------------------------------------------------------------
-- 2. "Not using the portal" — last-seen is the LATER of the rollup and the
--    authoritative last_sign_in_at; "never" means last_sign_in_at IS NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_portal_laggards(p_limit integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_classes uuid[]; v_roster uuid[]; v_rows jsonb;
  v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 15), 1), 50);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;

  SELECT array_agg(DISTINCT r.student_id) INTO v_roster
    FROM public.teacher_roster_student_ids(v_uid, v_classes) r;
  v_roster := COALESCE(v_roster, ARRAY[]::uuid[]);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    SELECT DISTINCT ca.user_id AS student_id, ca.class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
       AND ca.user_id = ANY(v_roster)
  ),
  seen AS (
    SELECT r.student_id,
           GREATEST(
             (SELECT max(d.activity_date) FROM student_activity_daily d
               WHERE d.student_id = r.student_id),
             (SELECT (u.last_sign_in_at)::date FROM auth.users u WHERE u.id = r.student_id)
           ) AS last_seen,
           (SELECT u.last_sign_in_at IS NULL FROM auth.users u WHERE u.id = r.student_id)
             AS never_signed_in
      FROM roster r
  ),
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id
                              ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NOT NULL) AS submitted,
           count(*)                                 AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NOT NULL) AS attempted,
           count(*)                                 AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id, s.last_seen, s.never_signed_in,
           CASE WHEN s.last_seen IS NULL THEN NULL ELSE v_today - s.last_seen END AS days_since,
           COALESCE(hw.submitted, 0) AS hw_submitted, COALESCE(hw.expected, 0) AS hw_expected,
           COALESCE(ex.attempted, 0) AS ex_attempted, COALESCE(ex.expected, 0) AS ex_expected,
           COALESCE(CASE WHEN hw.expected > 0 THEN hw.submitted::numeric / hw.expected END, 1)
         + COALESCE(CASE WHEN ex.expected > 0 THEN ex.attempted::numeric / ex.expected END, 1)
             AS work_score
      FROM roster r
      LEFT JOIN seen s ON s.student_id = r.student_id
      LEFT JOIN hw ON hw.student_id = r.student_id
      LEFT JOIN ex ON ex.student_id = r.student_id
  ),
  ranked AS (
    SELECT sc.*,
           COALESCE(sc.days_since, 9999) AS stale,
           CASE
             WHEN COALESCE(sc.days_since, 9999) >= 7 AND sc.work_score < 0.8 THEN 'high'
             WHEN COALESCE(sc.days_since, 9999) >= 5 AND sc.work_score < 1.4 THEN 'medium'
             ELSE 'watch'
           END AS severity
      FROM scored sc
     WHERE COALESCE(sc.days_since, 9999) >= 3
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY sev_rank, stale DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'days_since',   rk.days_since,
             -- authoritative, not "absent from the rollup"
             'never_seen',   COALESCE(rk.never_signed_in, false),
             'hw_submitted', rk.hw_submitted,
             'hw_expected',  rk.hw_expected,
             'ex_attempted', rk.ex_attempted,
             'ex_expected',  rk.ex_expected,
             'severity',     rk.severity,
             'note',         CASE WHEN rk.severity = 'watch' AND rk.work_score >= 1.6
                                  THEN 'Logs in rarely, work is otherwise fine' END
           ) AS x,
           CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS sev_rank,
           rk.stale
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     ORDER BY CASE rk.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, rk.stale DESC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.dash_teacher_portal_laggards(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_laggards(integer) TO authenticated;
