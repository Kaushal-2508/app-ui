-- Roster counts: the breakdown behind "students present today" (2026-09-06)
-- ============================================================================
-- The Command Center's top block is being rebuilt as a bento, with attendance
-- as the wide hero tile. A hero needs more than one number, and the three
-- facts that actually explain the headline were not in the payload:
--
--   * absent / on_leave  - "6 present" means nothing without knowing whether
--     the other 4 marked students were absent or on approved leave.
--   * classes.marked_today - the real story most days is coverage: 10 of 252
--     students have a record because only 2 of 42 classes have taken the
--     register. Without it the tile looks like a catastrophic attendance rate
--     when it is really an un-taken register.
--
-- All three come from the SAME single scan of today's rows, so this adds no
-- query cost. Nothing is removed, so existing callers are unaffected.

CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_students int; v_students_new int;
  v_staff int; v_classes int; v_wings int;
  v_s_present int; v_s_total int; v_s_absent int; v_s_leave int; v_classes_marked int;
  v_t_present int; v_t_total int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(*) INTO v_students
    FROM public.institution_student_ids(v_inst);

  SELECT count(*) INTO v_students_new
    FROM public.institution_student_ids(v_inst) s
    JOIN public.profiles p ON p.id = s.student_id
   WHERE p.created_at >= (v_today - INTERVAL '30 days');

  SELECT count(DISTINCT p.id) INTO v_staff
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND ur.role::text IN ('teacher','coordinator','school_admin','super_school_admin','employee');

  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_wings
    FROM wings WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  -- One scan for the whole attendance headline: present, absent, on leave, the
  -- marked total, and how many classes have taken a register at all.
  SELECT count(*) FILTER (WHERE status IN ('present','late')),
         count(*),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status = 'leave'),
         count(DISTINCT class_id)
    INTO v_s_present, v_s_total, v_s_absent, v_s_leave, v_classes_marked
    FROM attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_t_present, v_t_total
    FROM staff_attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  RETURN jsonb_build_object(
    'students', jsonb_build_object('count', v_students, 'new_30d', v_students_new),
    'staff',    jsonb_build_object('count', v_staff),
    'classes',  jsonb_build_object('count', v_classes, 'wings', v_wings,
                                   'marked_today', v_classes_marked),
    'students_present', jsonb_build_object(
       'present', v_s_present, 'total', v_s_total, 'marked', v_s_total > 0,
       'absent', v_s_absent, 'on_leave', v_s_leave,
       'pct', CASE WHEN v_s_total > 0 THEN round(v_s_present*100.0/v_s_total, 1) END),
    'staff_present', jsonb_build_object(
       'present', v_t_present, 'total', v_t_total, 'marked', v_t_total > 0,
       'pct', CASE WHEN v_t_total > 0 THEN round(v_t_present*100.0/v_t_total, 1) END)
  );
END $function$;
