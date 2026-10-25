-- 20260811140000_scoped_attendance_reports.sql
--
-- Give teachers and coordinators the attendance Reports surface, scoped to
-- their own classes. Until now both student report RPCs raised 42501 for
-- anyone who was not an institution/super admin.
--
-- New authorization shape (both functions, identical):
--   * super admin / institution admin  → institution-wide (unchanged).
--   * teacher                          → classes where class_assignments
--                                        (user_id = me, role = 'teacher').
--   * coordinator                      → classes via wing_assignments ×
--                                        wing_class_mappings.
--     (Same membership logic as is_teacher_for_class /
--      is_coordinator_for_class, but resolved ONCE into an array instead of
--      called per roster row.)
--   * nobody else (students, unrelated staff, empty scope) → 42501.
--
-- Cross-tenant guard: p_institution_id is a caller-supplied parameter that
-- exists so super admins can follow the "Manage Institution" switcher. For
-- non-admins it is now IGNORED and forced to the caller's own institution —
-- otherwise a teacher could pass another school's id. The old code trusted
-- the parameter because only admins could get past the gate.
--
-- p_class_id outside the caller's scope simply returns zero rows (the scope
-- filter still applies), so no extra validation branch is needed.
--
-- report_staff_attendance is deliberately NOT changed — staff attendance
-- reporting stays admin-only, which is what hides the Staff/Students toggle
-- for teachers in the UI.
--
-- CREATE OR REPLACE with unchanged signatures + return types, so existing
-- grants are preserved.

-- ---------------------------------------------------------------------
-- Helper: the class ids a non-admin may report on. Empty array = no scope.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_scope_class_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT s.class_id), '{}'::uuid[])
  FROM (
    SELECT ca.class_id
      FROM public.class_assignments ca
     WHERE ca.user_id = _user_id AND ca.role = 'teacher'
    UNION
    SELECT wcm.class_id
      FROM public.wing_assignments wa
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
     WHERE wa.user_id = _user_id
  ) s;
$$;

REVOKE ALL ON FUNCTION public.report_scope_class_ids(uuid) FROM public;
REVOKE ALL ON FUNCTION public.report_scope_class_ids(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_scope_class_ids(uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- report_student_attendance — per-day attendance pivot
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_student_attendance(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_id uuid,
  class_name text,
  section text,
  by_date jsonb,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_is_admin boolean;
  v_classes uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid);

  IF NOT v_is_admin THEN
    -- Non-admins never cross institutions: ignore the supplied id.
    v_inst := public.get_user_institution(v_uid);
    IF v_inst IS NULL THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    v_classes := public.report_scope_class_ids(v_uid);
    IF v_classes IS NULL OR cardinality(v_classes) = 0 THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid, p.full_name AS fname, p.roll_number AS roll,
      c.id AS cid, c.name AS cname, c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student'
      AND (p_class_id IS NULL OR ca.class_id = p_class_id)
      AND (v_is_admin OR ca.class_id = ANY(v_classes))
    ORDER BY ca.user_id, ca.class_id
  ),
  ranked AS (
    SELECT r.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname, r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::numeric NULLS LAST,
        r.roll, r.fname, r.sid
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,
    ranked.cid,
    ranked.cname,
    ranked.csection,
    COALESCE((
      SELECT jsonb_object_agg(t.d, t.s)
      FROM (
        SELECT DISTINCT ON (ar.date) ar.date::text AS d, ar.status AS s
        FROM public.attendance_records ar
        WHERE ar.student_id = ranked.sid
          AND ar.date BETWEEN p_from AND p_to
        ORDER BY ar.date, ar.class_id
      ) t
    ), '{}'::jsonb),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) FROM public;
REVOKE ALL ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- report_student_activity — per-student engagement summary
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_student_activity(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_name text,
  section text,
  last_sign_in_at timestamptz,
  exams_taken bigint,
  exams_submitted bigint,
  homework_submitted bigint,
  homework_late bigint,
  rechecks_raised bigint,
  present_days bigint,
  absent_days bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_tz text;
  v_is_admin boolean;
  v_classes uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid);

  IF NOT v_is_admin THEN
    v_inst := public.get_user_institution(v_uid);
    IF v_inst IS NULL THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    v_classes := public.report_scope_class_ids(v_uid);
    IF v_classes IS NULL OR cardinality(v_classes) = 0 THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid, p.full_name AS fname, p.roll_number AS roll,
      c.name AS cname, c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student'
      AND (p_class_id IS NULL OR ca.class_id = p_class_id)
      AND (v_is_admin OR ca.class_id = ANY(v_classes))
    ORDER BY ca.user_id, ca.class_id
  ),
  ranked AS (
    SELECT r.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname, r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::numeric NULLS LAST,
        r.roll, r.fname, r.sid
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,
    ranked.cname,
    ranked.csection,
    (SELECT au.last_sign_in_at FROM auth.users au WHERE au.id = ranked.sid),
    (SELECT count(*) FROM public.student_exam_attempts a
       WHERE a.student_id = ranked.sid AND (a.started_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.student_exam_attempts a
       WHERE a.student_id = ranked.sid AND a.is_submitted AND (a.submitted_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.homework_submissions h
       WHERE h.student_id = ranked.sid AND (h.submitted_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.homework_submissions h
       WHERE h.student_id = ranked.sid AND h.is_late AND (h.submitted_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.recheck_requests rr
       WHERE rr.requested_by = ranked.sid AND (rr.requested_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to AND ar.status = 'present'),
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to AND ar.status = 'absent'),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) FROM public;
REVOKE ALL ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) TO authenticated;