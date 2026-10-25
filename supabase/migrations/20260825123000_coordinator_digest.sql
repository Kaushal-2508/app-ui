-- Coordinator dashboard, phase 4: the wing digest.
--
-- Deliberately composed by calling the other dash_scoped_* functions rather
-- than re-deriving their SQL, so a change to how adoption or compliance is
-- measured can never leave the digest telling a different story from the card
-- immediately below it. All of them are STABLE SECURITY DEFINER and resolve the
-- same scope from auth.uid(), so this stays a single logical read.
--
-- Severity vocabulary matches dash_admin_digest: 'critical' | 'warning' | 'info'.

CREATE OR REPLACE FUNCTION public.dash_scoped_digest()
RETURNS TABLE(code text, severity text, headline text, detail text, link_url text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_class_ids uuid[] := public.dash_resolve_scoped_classes();
  v_students jsonb;
  v_teachers jsonb;
  v_compliance jsonb;
  v_classperf jsonb;
  v_recheck jsonb;
  v_tasks jsonb;
  v_standing jsonb;
  v_worst jsonb;
BEGIN
  IF array_length(v_class_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  v_students   := public.dash_scoped_student_portal_adoption(1);
  v_teachers   := public.dash_scoped_teacher_adoption(1);
  v_compliance := public.dash_scoped_attendance_compliance(14);
  v_classperf  := public.dash_scoped_class_performance();
  v_recheck    := public.dash_scoped_recheck_stats();
  v_tasks      := public.dash_scoped_task_stats();
  v_standing   := public.dash_scoped_wing_standing();

  -- 1. Students who have never opened the portal.
  IF COALESCE((v_students->>'never_signed_in')::int, 0) > 0 THEN
    RETURN QUERY SELECT
      'CO_STUDENTS_NEVER',
      CASE WHEN (v_students->>'never_signed_in')::int * 100.0
                / NULLIF((v_students->>'total')::int, 0) >= 20
           THEN 'critical' ELSE 'warning' END,
      (v_students->>'never_signed_in') || ' of ' || (v_students->>'total') ||
        ' students have never signed in to SALCI',
      'Only ' || COALESCE(v_students->>'pct_active_30d', '0') ||
        '% opened the portal in the last 30 days. The weakest classes are listed in Student adoption below.',
      '/school/snapshot#dash-student-adoption';
  END IF;

  -- 2. Teachers who are not in the system.
  IF COALESCE((v_teachers->>'total')::int, 0) > 0
     AND COALESCE((v_teachers->>'active_7d')::int, 0) * 2 < COALESCE((v_teachers->>'total')::int, 0) THEN
    RETURN QUERY SELECT
      'CO_TEACHERS_INACTIVE',
      'critical',
      'Only ' || (v_teachers->>'active_7d') || ' of ' || (v_teachers->>'total') ||
        ' teachers opened SALCI this week',
      CASE WHEN COALESCE((v_teachers->>'never_signed_in')::int, 0) > 0
           THEN (v_teachers->>'never_signed_in') ||
                ' have never signed in at all. A teacher who is not in the system is a teacher whose students probably are not either.'
           ELSE 'A teacher who is not in the system is a teacher whose students probably are not either.' END,
      '/school/snapshot#dash-teacher-adoption';
  END IF;

  -- 3. Attendance not being logged.
  IF COALESCE((v_compliance->>'missing_today')::int, 0) > 0 THEN
    RETURN QUERY SELECT
      'CO_ATTENDANCE_GAP',
      CASE WHEN (v_compliance->>'missing_today')::int * 2 >= (v_compliance->>'total_classes')::int
           THEN 'critical' ELSE 'warning' END,
      (v_compliance->>'missing_today') || ' of ' || (v_compliance->>'total_classes') ||
        ' classes did not log attendance on the last working day',
      'This is a compliance gap as well as a data gap: absences nobody recorded cannot be followed up.',
      '/school/snapshot#dash-attendance-compliance';
  END IF;

  -- 4. Weakest class.
  v_worst := v_classperf->'rows'->0;
  IF v_worst IS NOT NULL AND v_worst->>'class_name' IS NOT NULL THEN
    RETURN QUERY SELECT
      'CO_WEAKEST_CLASS',
      CASE WHEN (v_worst->>'avg_pct')::numeric < 50 THEN 'warning' ELSE 'info' END,
      (v_worst->>'class_name') || ' is your weakest class at ' || (v_worst->>'avg_pct') || '%',
      'Scope average is ' || COALESCE(v_classperf->>'scope_avg_pct', 'n/a') ||
        '%. Based on ' || (v_worst->>'results') || ' results this academic year.',
      '/school/snapshot#dash-class-performance';
  END IF;

  -- 5. Rechecks past a reasonable turnaround.
  IF COALESCE((v_recheck->>'pending')::int, 0) > 0 THEN
    RETURN QUERY SELECT
      'CO_RECHECK_PENDING',
      CASE WHEN COALESCE((v_recheck->>'oldest_pending_days')::int, 0) > 5
           THEN 'critical' ELSE 'warning' END,
      (v_recheck->>'pending') || ' recheck request' ||
        CASE WHEN (v_recheck->>'pending')::int = 1 THEN '' ELSE 's' END || ' waiting on you',
      CASE WHEN COALESCE((v_recheck->>'oldest_pending_days')::int, 0) > 0
           THEN 'The oldest has been open ' || (v_recheck->>'oldest_pending_days') || ' days.'
           ELSE 'Approving or rejecting a recheck is a coordinator-only action.' END,
      '/school/snapshot#dash-rechecks';
  END IF;

  -- 6. Overdue tasks.
  IF COALESCE((v_tasks->>'overdue')::int, 0) > 0 THEN
    RETURN QUERY SELECT
      'CO_TASKS_OVERDUE',
      CASE WHEN (v_tasks->>'overdue')::int >= 10 THEN 'critical' ELSE 'warning' END,
      (v_tasks->>'overdue') || ' tasks are overdue in your wing',
      COALESCE(v_tasks->>'completion_rate', '0') || '% of tasks assigned here are completed, and closure takes ' ||
        COALESCE(v_tasks->>'avg_closure_days', 'n/a') || ' days on average.',
      '/school/snapshot#dash-tasks';
  END IF;

  -- 7. Standing, always last: context rather than an action.
  IF COALESCE((v_standing->>'has_wing')::boolean, false) THEN
    RETURN QUERY SELECT
      'CO_WING_STANDING',
      'info',
      (v_standing->>'wing_name') || ' wing is #' || (v_standing->>'rank') ||
        ' of ' || (v_standing->>'total_wings') || ' this month',
      'Wing average ' || COALESCE(v_standing->>'avg_pct', 'n/a') ||
        '% against a school average of ' || COALESCE(v_standing->>'school_avg_pct', 'n/a') || '%.',
      '/school/snapshot#dash-wing-standing';
  END IF;

  RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash_scoped_digest() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash_scoped_digest() TO authenticated;
