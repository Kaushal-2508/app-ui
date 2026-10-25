-- Harden the two paginated report RPCs' roster ordering (pre-merge review fixes):
--
--  1. The numeric roll-number sort key cast ::int (int4, max 2,147,483,647)
--     OVERFLOWS for long numeric admission/roll numbers (10+ digit strings are
--     common in Indian schools). Because the cast lives in the row_number()
--     ORDER BY, one overflowing roll aborts the ENTIRE query (22003) — the whole
--     class/institution report and its Excel export fail to load any rows.
--     Fix: cast to ::numeric (arbitrary precision — safe for any digit string).
--
--  2. The row_number() ORDER BY had no unique final tiebreak. Two students with
--     the same class + section + blank roll + identical name tie on every key;
--     since each export page is a separate RPC call, a tie straddling a page
--     boundary could duplicate one student and skip another. Fix: append the
--     unique student id (r.sid) as the final ORDER BY key -> deterministic
--     cross-page numbering.
--
-- CREATE OR REPLACE (unchanged signature + return type) so grants are preserved.

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

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid, p.full_name AS fname, p.roll_number AS roll,
      c.id AS cid, c.name AS cname, c.section AS csection
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
GRANT EXECUTE ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) TO authenticated;


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
GRANT EXECUTE ON FUNCTION public.report_student_activity(date, date, uuid, int, int, uuid) TO authenticated;
