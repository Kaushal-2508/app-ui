-- Teacher dashboard — spec 2.1 header banner + spec 2.7 "Not using the portal"
--
-- Both scope through dash_resolve_scoped_pairs() like every other dash_teacher_*
-- function, so the banner's chips describe exactly the boundary the rest of the
-- page enforces.

-- ---------------------------------------------------------------------------
-- 1. Header meta: wing + academic year. Name and institution are already on the
--    client, so this returns only what the client cannot get.
--
--    WING RESOLUTION LADDER (the honest answer to a genuinely ambiguous case):
--      1. an explicit wing_assignments row wins — an admin said so;
--      2. otherwise the wing of the teacher's classes, but ONLY if unambiguous;
--      3. otherwise NULL, and the UI omits the wing rather than guessing.
--    In prod 17 teachers are explicitly wing-assigned, 51 span two wings, 4 span
--    three, and 65 map to none, so step 3 is common and must render cleanly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_teacher_header()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_classes uuid[];
  v_wing text; v_wing_n int; v_ay text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);

  -- 1. explicit assignment
  SELECT w.name INTO v_wing
    FROM wing_assignments wa
    JOIN wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
   WHERE wa.user_id = v_uid
   ORDER BY w.display_order NULLS LAST, w.name
   LIMIT 1;

  -- 2. derived, only when unambiguous
  IF v_wing IS NULL AND array_length(v_classes, 1) > 0 THEN
    SELECT count(DISTINCT w.id), min(w.name) INTO v_wing_n, v_wing
      FROM wing_class_mappings m
      JOIN wings w ON w.id = m.wing_id AND w.institution_id = v_inst
     WHERE m.class_id = ANY(v_classes);
    IF COALESCE(v_wing_n, 0) <> 1 THEN v_wing := NULL; END IF;   -- 0 or many: say nothing
  END IF;

  SELECT ay.code INTO v_ay
    FROM cal_academic_years ay
   WHERE ay.institution_id = v_inst AND COALESCE(ay.is_active, false)
   ORDER BY ay.starts_on DESC
   LIMIT 1;

  RETURN jsonb_build_object('wing_name', v_wing, 'academic_year', v_ay);
END $function$;

-- ---------------------------------------------------------------------------
-- 2. "Not using the portal" — login recency COMBINED with submission/attempt
--    rate, per spec 2.7. A pupil who is quiet on both fronts is the one still
--    working on paper; a pupil who logs in rarely but submits everything is a
--    WATCH, not a problem, and the row says so.
--
--    Login recency comes from student_activity_daily (the refresh-token rollup).
--    A student with no row at all has never been seen, which outranks any
--    number of days.
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
    SELECT d.student_id, max(d.activity_date) AS last_seen
      FROM student_activity_daily d
     WHERE d.student_id = ANY(v_roster)
     GROUP BY d.student_id
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
    SELECT r.student_id, r.class_id,
           s.last_seen,
           CASE WHEN s.last_seen IS NULL THEN NULL ELSE v_today - s.last_seen END AS days_since,
           COALESCE(hw.submitted, 0) AS hw_submitted, COALESCE(hw.expected, 0) AS hw_expected,
           COALESCE(ex.attempted, 0) AS ex_attempted, COALESCE(ex.expected, 0) AS ex_expected,
           -- 0..2. Components with no expectation contribute their full weight,
           -- so a teacher who has set no homework does not make every pupil look idle.
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
             WHEN COALESCE(sc.days_since, 9999) >= 7 AND sc.work_score < 0.8  THEN 'high'
             WHEN COALESCE(sc.days_since, 9999) >= 5 AND sc.work_score < 1.4  THEN 'medium'
             ELSE 'watch'
           END AS severity
      FROM scored sc
     -- Only pupils who are actually quiet on the portal belong in this list.
     WHERE COALESCE(sc.days_since, 9999) >= 3
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY sev_rank, stale DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',    rk.student_id,
             'student_name',  (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',      rk.class_id,
             'class_name',    c.name,
             'section',       c.section,
             'days_since',    rk.days_since,
             'never_seen',    rk.last_seen IS NULL,
             'hw_submitted',  rk.hw_submitted,
             'hw_expected',   rk.hw_expected,
             'ex_attempted',  rk.ex_attempted,
             'ex_expected',   rk.ex_expected,
             'severity',      rk.severity,
             -- The one case worth spelling out: quiet but not behind.
             'note',          CASE WHEN rk.severity = 'watch' AND rk.work_score >= 1.6
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

-- ---------------------------------------------------------------------------
-- 3. Grants — anon revoked BY NAME (CLAUDE.md §11)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dash_teacher_header()                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dash_teacher_portal_laggards(integer)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dash_teacher_header()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teacher_portal_laggards(integer) TO authenticated;
