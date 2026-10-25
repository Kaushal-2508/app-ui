-- Final-review fix (§24): bucket the activity RPCs' timestamptz columns
-- (started_at / submitted_at / requested_at) into calendar days using the
-- institution's timezone, not the DB session's UTC. Otherwise, for an IST
-- school, an event at e.g. 03:00 IST on p_from resolves to the previous UTC
-- day and is wrongly excluded at the range boundary.
-- CREATE OR REPLACE keeps the same RETURNS TABLE signature (body-only change),
-- so no type regen is needed. attendance_records.date is a plain DATE column
-- and is left as-is. marked_days is retained (signature-locked; harmless).

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
  last_sign_in_at timestamptz,
  exams_taken bigint,
  exams_submitted bigint,
  homework_submitted bigint,
  homework_late bigint,
  rechecks_raised bigint,
  present_days bigint,
  absent_days bigint,
  marked_days bigint,
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
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
    WHERE ca.role = 'student' AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id, ca.class_id
  ),
  ranked AS (
    SELECT r.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname, r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::int NULLS LAST,
        r.roll, r.fname
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection ELSE ranked.cname END,
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
    (SELECT count(*) FROM public.attendance_records ar
       WHERE ar.student_id = ranked.sid AND ar.date BETWEEN p_from AND p_to),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_student_activity_events(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  student_id uuid,
  full_name text,
  roll_number text,
  class_name text,
  event_at timestamptz,
  event_type text,
  detail text,
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_inst := COALESCE(p_institution_id, public.get_user_institution(v_uid));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for report' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
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
    WHERE ca.role = 'student' AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id, ca.class_id
  ),
  events AS (
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      a.started_at AS ev_at, 'exam_started'::text AS ev_type, COALESCE(e.title, '') AS ev_detail
    FROM roster r
    JOIN public.student_exam_attempts a ON a.student_id = r.sid
    LEFT JOIN public.exams e ON e.id = a.exam_id
    WHERE (a.started_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      a.submitted_at, 'exam_submitted', COALESCE(e.title, '')
    FROM roster r
    JOIN public.student_exam_attempts a ON a.student_id = r.sid
    LEFT JOIN public.exams e ON e.id = a.exam_id
    WHERE a.is_submitted AND (a.submitted_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      h.submitted_at, 'homework_submitted', COALESCE(ha.title, '')
    FROM roster r
    JOIN public.homework_submissions h ON h.student_id = r.sid
    LEFT JOIN public.homework_assignments ha ON ha.id = h.homework_assignment_id
    WHERE (h.submitted_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.sid, r.fname, r.roll, r.cname, r.csection,
      rr.requested_at, 'recheck_requested', ''
    FROM roster r
    JOIN public.recheck_requests rr ON rr.requested_by = r.sid
    WHERE (rr.requested_at AT TIME ZONE v_tz)::date BETWEEN p_from AND p_to
  ),
  ranked AS (
    SELECT ev.*, count(*) OVER() AS total,
      row_number() OVER (ORDER BY ev.fname, ev.ev_at) AS rn
    FROM events ev
  )
  SELECT
    ranked.sid, ranked.fname, ranked.roll::text,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection ELSE ranked.cname END,
    ranked.ev_at, ranked.ev_type, ranked.ev_detail, ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;
