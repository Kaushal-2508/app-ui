-- Dashboard action cards: one read-only answer per staff dashboard load.
-- Spec: docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md
--
-- my_dashboard_actions(p_view) tells the signed-in staff member what is waiting for them
-- TODAY, on the school's own clock (CLAUDE.md §24):
--   check_in   no check-in yet (or marked absent) on a working day, before check-out time
--   cover      pending substitutions in their scope whose period has not ended; admin and
--              coordinator views only, and only on a day the school has at least one real
--              staff check-in (schools that never check in raise a cover for every period)
--   leave      pending leave they may decide: teacher view, student leave of the sections
--              they teach; coordinator view, student leave of their wings plus the staff
--              leave of their wings' teachers (can_review_staff_leave's coordinator rung
--              only, so an admin who also coordinates never gets admin scope there, §25);
--              admin view, staff leave only (owner, 2026-10-03: admins do not see student
--              leave on the card)
--   check_out  checked in, not checked out, at or after check-out time
-- Counts and one line of context only, never row lists.
--
-- p_view is a REQUEST that can only narrow (the task_status_counts pattern): it is honoured
-- only when the caller holds that role, otherwise the default view applies (admin, else
-- teacher, else coordinator: the same default ActiveRoleContext picks).
--
-- _my_dashboard_actions holds the logic with the caller and the clock passed in, so
-- scripts/test-dashboard-actions.sql can pin the time. Only its owner may execute it; the
-- public wrapper passes the JWT's user and the transaction clock.

CREATE OR REPLACE FUNCTION public._my_dashboard_actions(p_uid uuid, p_view text, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_empty     CONSTANT jsonb := jsonb_build_object(
                'v', 1, 'date', NULL, 'view', NULL, 'check_in', NULL, 'cover', NULL,
                'leave', NULL, 'check_out', NULL, 'pass_due', false, 'refresh_in_s', NULL);
  v_inst      uuid;
  v_admin     boolean;
  v_coord     boolean;
  v_teacher   boolean;
  v_view      text;
  v_tz        text;
  v_local     timestamp;
  v_today     date;
  v_time      time;
  v_has_set   boolean;
  v_in        time;
  v_out       time;
  v_grace     integer;
  v_late_ok   boolean;
  v_cutoff    interval;
  v_workday   boolean;
  v_has_row   boolean;
  v_row_id    uuid;
  v_status    text;
  v_in_at     timestamptz;
  v_out_at    timestamptz;
  v_check_in  jsonb;
  v_check_out jsonb;
  v_cover     jsonb;
  v_leave     jsonb;
  v_pass_due  boolean := false;
  v_n_cover   integer;
  v_first_end time;
  v_next_lbl  text;
  v_next_cls  text;
  v_next_sec  text;
  v_next_at   time;
  v_students  integer := 0;
  v_staff     integer := 0;
  v_oldest_s  timestamptz;
  v_oldest    timestamptz;
  v_waits     interval[];
  v_refresh   integer;
BEGIN
  IF p_uid IS NULL OR p_now IS NULL THEN
    RETURN v_empty;
  END IF;

  v_inst := public.get_user_institution(p_uid);
  IF v_inst IS NULL OR public.is_super_admin(p_uid) THEN
    RETURN v_empty;
  END IF;

  -- Roles inside the caller's own school. (Prod has no staff role row that points at
  -- another school than the profile's, checked 2026-10-03.)
  v_admin   := public.is_institution_admin(p_uid, v_inst);
  v_coord   := EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = p_uid AND r.institution_id = v_inst AND r.role = 'coordinator');
  v_teacher := EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = p_uid AND r.institution_id = v_inst AND r.role = 'teacher');
  IF NOT (v_admin OR v_coord OR v_teacher) THEN
    RETURN v_empty;  -- students and employees get no cards
  END IF;

  v_view := CASE
    WHEN p_view = 'admin'       AND v_admin   THEN 'admin'
    WHEN p_view = 'coordinator' AND v_coord   THEN 'coordinator'
    WHEN p_view = 'teacher'     AND v_teacher THEN 'teacher'
    WHEN v_admin   THEN 'admin'
    WHEN v_teacher THEN 'teacher'
    ELSE 'coordinator'
  END;

  -- The school's wall clock (§24).
  SELECT i.timezone INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_tz    := COALESCE(v_tz, 'Asia/Kolkata');
  v_local := p_now AT TIME ZONE v_tz;
  v_today := v_local::date;
  v_time  := v_local::time;

  -- The school's settings, or the defaults the client falls back to (DEFAULT_ATTENDANCE_SETTINGS).
  SELECT s.staff_check_in_time, s.staff_check_out_time, s.staff_late_grace_minutes, s.staff_late_check_in_allowed
    INTO v_in, v_out, v_grace, v_late_ok
    FROM public.attendance_settings s
   WHERE s.institution_id = v_inst;
  v_has_set := FOUND;
  IF NOT v_has_set THEN
    v_in := time '08:00'; v_out := time '16:00'; v_grace := 30; v_late_ok := true;
  END IF;
  -- The moment the attendance pass starts marking: check-in time plus grace (no grace when
  -- late check-in is off), the rule tt_run_attendance_pass_for_institution applies.
  v_cutoff := make_interval(mins => CASE WHEN v_late_ok THEN v_grace ELSE 0 END);

  v_workday := EXISTS (SELECT 1 FROM public._staff_leave_workdays(v_inst, v_today, v_today));

  SELECT r.id, r.status, r.check_in_at, r.check_out_at
    INTO v_row_id, v_status, v_in_at, v_out_at
    FROM public.staff_attendance_records r
   WHERE r.staff_id = p_uid AND r.date = v_today;
  v_has_row := FOUND;

  -- 1. Check-in, every view. A row the person did not write themselves (on leave, holiday,
  --    marked present by an admin) means there is nothing to check in to; an absent row means
  --    a self check-in would collide with it, so the card only says so.
  IF v_workday AND v_time < v_out THEN
    IF NOT v_has_row THEN
      v_check_in := jsonb_build_object('state', 'due',
                      'by', to_char(v_in, 'HH24:MI'), 'until', to_char(v_out, 'HH24:MI'));
    ELSIF v_in_at IS NULL AND v_status = 'absent' THEN
      v_check_in := jsonb_build_object('state', 'absent',
                      'by', to_char(v_in, 'HH24:MI'), 'until', to_char(v_out, 'HH24:MI'));
    END IF;
  END IF;

  -- 4. Check-out, every view; today's row id so the card can never touch another day's row.
  IF v_has_row AND v_in_at IS NOT NULL AND v_out_at IS NULL AND v_time >= v_out THEN
    v_check_out := jsonb_build_object('record_id', v_row_id, 'since', to_char(v_out, 'HH24:MI'));
  END IF;

  -- 2. Cover, admin and coordinator views, on a day the school really checks in.
  IF v_view IN ('admin', 'coordinator')
     AND EXISTS (SELECT 1 FROM public.staff_attendance_records a
                  WHERE a.institution_id = v_inst AND a.date = v_today AND a.check_in_at IS NOT NULL) THEN
    SELECT count(*) OVER (), min(ps.end_time) OVER (), ps.label, c.name, c.section, ps.start_time
      INTO v_n_cover, v_first_end, v_next_lbl, v_next_cls, v_next_sec, v_next_at
      FROM public.tt_substitutions t
      JOIN public.tt_slots s         ON s.id = t.slot_id AND s.institution_id = v_inst
      JOIN public.tt_period_slots ps ON ps.id = s.period_slot_id
      JOIN public.classes c          ON c.id = s.class_id AND c.institution_id = v_inst
                                    AND COALESCE(c.is_active, true)
     WHERE t.status = 'pending'
       AND t.date = v_today
       AND ps.end_time > v_time
       AND (v_view = 'admin' OR EXISTS (
             -- every wing the coordinator holds, as Workday's list and
             -- tt_user_can_edit_class_slots do; no wing means nothing, never the whole school
             SELECT 1
               FROM public.wing_assignments wa
               JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
               JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
              WHERE wa.user_id = p_uid AND wcm.class_id = s.class_id))
     ORDER BY ps.start_time, c.name, c.section
     LIMIT 1;
    IF COALESCE(v_n_cover, 0) > 0 THEN
      v_cover := jsonb_build_object(
        'pending', v_n_cover,
        'next', jsonb_build_object('label', v_next_lbl, 'class_name', v_next_cls,
                                   'section', v_next_sec, 'start', to_char(v_next_at, 'HH24:MI')));
    END IF;
  END IF;

  -- 3. Leave the caller may decide, by view. Student requests count only while the student
  --    is still in the class: review_student_leave refuses the others, so they would pin the
  --    card for ever.
  IF v_view = 'teacher' THEN
    -- every teacher row on the section, with or without a subject (can_review_student_leave)
    SELECT count(*), min(l.created_at) INTO v_students, v_oldest_s
      FROM public.leave_requests l
     WHERE l.institution_id = v_inst
       AND l.status = 'pending'
       AND EXISTS (SELECT 1 FROM public.class_assignments ca
                    WHERE ca.user_id = p_uid AND ca.class_id = l.class_id AND ca.role = 'teacher')
       AND public.student_in_class(l.student_id, l.class_id);
  ELSIF v_view = 'coordinator' THEN
    SELECT count(*), min(l.created_at) INTO v_students, v_oldest_s
      FROM public.leave_requests l
     WHERE l.institution_id = v_inst
       AND l.status = 'pending'
       AND EXISTS (SELECT 1
                     FROM public.wing_assignments wa
                     JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst
                     JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
                    WHERE wa.user_id = p_uid AND wcm.class_id = l.class_id)
       AND public.student_in_class(l.student_id, l.class_id);
  END IF;

  IF v_view = 'admin' THEN
    -- can_review_staff_leave refuses the caller's own request
    SELECT count(*), min(sl.created_at) INTO v_staff, v_oldest
      FROM public.staff_leave_requests sl
     WHERE sl.institution_id = v_inst
       AND sl.status = 'pending'
       AND public.can_review_staff_leave(p_uid, sl.user_id, v_inst);
  ELSIF v_view = 'coordinator' THEN
    -- can_review_staff_leave's coordinator rung ONLY (20260928160000): a teacher of a class in
    -- one of the caller's wings, who is neither an admin nor a coordinator. Calling the helper
    -- here would hand an admin who also coordinates the whole school in the coordinator view.
    SELECT count(*), min(sl.created_at) INTO v_staff, v_oldest
      FROM public.staff_leave_requests sl
     WHERE sl.institution_id = v_inst
       AND sl.status = 'pending'
       AND sl.user_id <> p_uid
       AND NOT public.is_institution_admin(sl.user_id, v_inst)
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                        WHERE r.user_id = sl.user_id AND r.institution_id = v_inst AND r.role = 'coordinator')
       AND EXISTS (SELECT 1
                     FROM public.class_assignments ca
                     JOIN public.classes cl ON cl.id = ca.class_id AND cl.institution_id = v_inst
                     JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
                     JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
                    WHERE ca.user_id = sl.user_id AND ca.role = 'teacher' AND wa.user_id = p_uid);
  END IF;

  IF COALESCE(v_students, 0) + COALESCE(v_staff, 0) > 0 THEN
    v_oldest := LEAST(v_oldest, v_oldest_s);  -- LEAST skips NULLs
    v_leave := jsonb_build_object(
      'students', COALESCE(v_students, 0),
      'staff', COALESCE(v_staff, 0),
      'oldest_days', GREATEST(0, v_today - (v_oldest AT TIME ZONE v_tz)::date));
  END IF;

  -- The attendance pass would mark now: let the admin or coordinator dashboard kick it once
  -- instead of waiting up to 15 minutes for the cron (no settings row: the pass does nothing).
  v_pass_due := v_view IN ('admin', 'coordinator') AND v_has_set AND v_workday
                AND (v_time - v_in) >= v_cutoff;

  -- refresh_in_s: the next moment this answer can change by the clock alone.
  v_waits := ARRAY[interval '24 hours' - (v_time - time '00:00')];          -- the school's midnight
  IF v_time < v_out AND (v_check_in IS NOT NULL OR (v_in_at IS NOT NULL AND v_out_at IS NULL)) THEN
    v_waits := v_waits || (v_out - v_time);                                  -- check-out time
  END IF;
  -- (Nothing in the answer changes at check-in time: the "late" wording is the client's.)
  IF v_view IN ('admin', 'coordinator') AND v_has_set AND v_workday AND NOT v_pass_due THEN
    v_waits := v_waits || ((v_in - v_time) + v_cutoff);                      -- the pass becomes due
  END IF;
  IF v_first_end IS NOT NULL THEN
    v_waits := v_waits || (v_first_end - v_time);                            -- an open period ends
  END IF;
  SELECT ceil(extract(epoch FROM min(w)))::integer INTO v_refresh
    FROM unnest(v_waits) AS w
   WHERE w > interval '0';

  RETURN jsonb_build_object(
    'v', 1,
    'date', to_char(v_today, 'YYYY-MM-DD'),
    'view', v_view,
    'check_in', v_check_in,
    'cover', v_cover,
    'leave', v_leave,
    'check_out', v_check_out,
    'pass_due', v_pass_due,
    'refresh_in_s', v_refresh);
END
$fn$;

CREATE OR REPLACE FUNCTION public.my_dashboard_actions(p_view text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public._my_dashboard_actions((SELECT auth.uid()), p_view, now());
$fn$;

-- The twin trusts its arguments, so nobody but its owner may call it (§26: anon by name;
-- REVOKE FROM PUBLIC does not strip Supabase's default grants).
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._my_dashboard_actions(uuid, text, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.my_dashboard_actions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_dashboard_actions(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.my_dashboard_actions(text) TO authenticated;

COMMENT ON FUNCTION public.my_dashboard_actions(text) IS
  'Dashboard action cards (2026-10-03): check-in, cover, leave and check-out due today for the caller, in the view they request (it can only narrow). Read-only. Spec docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md';
