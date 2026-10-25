-- Coordinator dashboard, phase 1: the wing standing strip.
--
-- Scope doctrine: the coordinator learns their OWN wing's position and score.
-- Peer wings are read internally to compute the rank and then discarded -- no
-- other wing's name, students, teachers or averages ever reach the client.
--
-- The score is four equally-weighted components (25 points each), chosen
-- because all four are backed by data that actually exists. Recheck turnaround
-- and syllabus pacing are deliberately NOT scored: syllabus_progress_events is
-- empty for most wings and recheck_requests is near-empty platform-wide, so
-- scoring them would penalise a wing for a module nobody uses yet.

CREATE OR REPLACE FUNCTION public.dash_scoped_wing_standing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := (SELECT auth.uid());
  v_inst uuid := public.get_user_institution((SELECT auth.uid()));
  v_tz   text;
  v_today date;
  v_ay_start date;
  v_ay_end   date;
  v_wing_id uuid;
  v_wing_name text;
  v_working_days int;
  v_school_avg numeric;
  v_out jsonb;
BEGIN
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- The caller's own wing. A coordinator covering several wings gets the first
  -- by display order; the strip names the wing so there is no ambiguity.
  SELECT w.id, w.name INTO v_wing_id, v_wing_name
    FROM wing_assignments wa
    JOIN wings w ON w.id = wa.wing_id
   WHERE wa.user_id = v_uid
     AND w.institution_id = v_inst
     AND w.is_active IS NOT FALSE
   ORDER BY w.display_order NULLS LAST, w.name
   LIMIT 1;

  IF v_wing_id IS NULL THEN
    -- Not a wing coordinator, or no wing assigned yet. The widget renders its
    -- empty state rather than surfacing an error.
    RETURN jsonb_build_object('has_wing', false);
  END IF;

  -- "Working days" proxy, matching the rest of the dash_* family: a date on
  -- which ANY class in the institution recorded attendance.
  SELECT count(DISTINCT ar.date)::int INTO v_working_days
    FROM attendance_records ar
   WHERE ar.institution_id = v_inst
     AND ar.date > v_today - 30;

  WITH wing_classes AS (
    SELECT w.id AS wing_id, m.class_id
      FROM wings w
      JOIN wing_class_mappings m ON m.wing_id = w.id
      JOIN classes c ON c.id = m.class_id
                    AND c.institution_id = v_inst
                    AND COALESCE(c.is_active, true)
     WHERE w.institution_id = v_inst
       AND w.is_active IS NOT FALSE
  ),
  wing_students AS (
    SELECT DISTINCT wc.wing_id, ca.user_id AS student_id
      FROM wing_classes wc
      JOIN class_assignments ca ON ca.class_id = wc.class_id AND ca.role::text = 'student'
  ),
  wing_teachers AS (
    SELECT DISTINCT wc.wing_id, ca.user_id AS teacher_id
      FROM wing_classes wc
      JOIN class_assignments ca ON ca.class_id = wc.class_id AND ca.role::text = 'teacher'
  ),
  academic AS (
    SELECT ws.wing_id, avg(fr.percentage) AS avg_pct
      FROM wing_students ws
      JOIN student_exam_attempts a ON a.student_id = ws.student_id
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN exams e ON e.id = a.exam_id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published', 'active', 'completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
     GROUP BY ws.wing_id
  ),
  stud_adopt AS (
    SELECT ws.wing_id,
           count(*)::numeric AS total,
           count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')::numeric AS active30
      FROM wing_students ws
      LEFT JOIN auth.users u ON u.id = ws.student_id
     GROUP BY ws.wing_id
  ),
  teach_adopt AS (
    SELECT wt.wing_id,
           count(*)::numeric AS total,
           count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')::numeric AS active30
      FROM wing_teachers wt
      LEFT JOIN auth.users u ON u.id = wt.teacher_id
     GROUP BY wt.wing_id
  ),
  att AS (
    SELECT wc.wing_id,
           count(DISTINCT (ar.class_id::text || ':' || ar.date::text))::numeric AS marked,
           (count(DISTINCT wc.class_id) * GREATEST(v_working_days, 1))::numeric AS expected
      FROM wing_classes wc
      LEFT JOIN attendance_records ar
             ON ar.class_id = wc.class_id
            AND ar.date > v_today - 30
     GROUP BY wc.wing_id
  ),
  scored AS (
    SELECT wc.wing_id,
           COALESCE(ac.avg_pct, 0)                                                AS academic_pct,
           CASE WHEN sa.total > 0 THEN sa.active30 * 100.0 / sa.total ELSE 0 END   AS student_pct,
           CASE WHEN ta.total > 0 THEN ta.active30 * 100.0 / ta.total ELSE 0 END   AS teacher_pct,
           CASE WHEN a2.expected > 0
                THEN LEAST(a2.marked * 100.0 / a2.expected, 100) ELSE 0 END        AS attendance_pct
      FROM (SELECT DISTINCT wing_id FROM wing_classes) wc
      LEFT JOIN academic    ac ON ac.wing_id = wc.wing_id
      LEFT JOIN stud_adopt  sa ON sa.wing_id = wc.wing_id
      LEFT JOIN teach_adopt ta ON ta.wing_id = wc.wing_id
      LEFT JOIN att         a2 ON a2.wing_id = wc.wing_id
  ),
  ranked AS (
    SELECT s.*,
           (s.academic_pct + s.student_pct + s.teacher_pct + s.attendance_pct) / 4.0 AS score,
           rank() OVER (
             ORDER BY (s.academic_pct + s.student_pct + s.teacher_pct + s.attendance_pct) DESC
           ) AS rnk,
           count(*) OVER () AS wing_count
      FROM scored s
  )
  SELECT jsonb_build_object(
           'has_wing', true,
           'wing_name', v_wing_name,
           'rank', r.rnk,
           'total_wings', r.wing_count,
           'score', round(r.score, 1),
           'avg_pct', round(r.academic_pct, 1),
           'components', jsonb_build_array(
             jsonb_build_object(
               'key', 'academic', 'label', 'Average exam score',
               'pct', round(r.academic_pct, 1),
               'points', round(r.academic_pct / 4.0, 1), 'max_points', 25),
             jsonb_build_object(
               'key', 'student_adoption', 'label', 'Students active in SALCI (30 days)',
               'pct', round(r.student_pct, 1),
               'points', round(r.student_pct / 4.0, 1), 'max_points', 25),
             jsonb_build_object(
               'key', 'teacher_adoption', 'label', 'Teachers active in SALCI (30 days)',
               'pct', round(r.teacher_pct, 1),
               'points', round(r.teacher_pct / 4.0, 1), 'max_points', 25),
             jsonb_build_object(
               'key', 'attendance', 'label', 'Attendance logged on time',
               'pct', round(r.attendance_pct, 1),
               'points', round(r.attendance_pct / 4.0, 1), 'max_points', 25)
           )
         )
    INTO v_out
    FROM ranked r
   WHERE r.wing_id = v_wing_id;

  -- The school average is a single institution-wide number, not per-wing data,
  -- so it is safe to expose as a benchmark alongside the wing's own average.
  SELECT round(avg(fr.percentage), 1) INTO v_school_avg
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
   WHERE e.institution_id = v_inst
     AND e.status IN ('published', 'active', 'completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end;

  RETURN COALESCE(v_out, jsonb_build_object('has_wing', false))
         || jsonb_build_object('school_avg_pct', v_school_avg);
END
$function$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new public
-- function to BOTH anon (by name) and PUBLIC (which anon inherits), and
-- revoking one does not strip the other. Revoke both, then verify with:
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'dash_scoped_wing_standing';
-- Only authenticated/postgres/service_role should remain.
REVOKE EXECUTE ON FUNCTION public.dash_scoped_wing_standing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_scoped_wing_standing() FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_scoped_wing_standing() TO authenticated;
