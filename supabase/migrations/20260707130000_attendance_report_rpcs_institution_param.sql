-- Final-review fixes for the attendance-report RPCs:
--  (1) accept an optional p_institution_id so a super_admin using "Manage
--      Institution" (useEffectiveInstitutionId -> managedInstitutionId) can pull
--      a managed school's report — parity with the old client-side filter.
--      Security: v_inst = COALESCE(p_institution_id, own); the existing gate
--      (is_institution_admin(v_uid, v_inst) OR is_super_admin(v_uid)) blocks any
--      non-super_admin from passing another institution's id.
--  (2) deterministic "primary class" for multi-class students: add a tiebreak
--      to the student roster's DISTINCT ON so on-screen and export always agree.

-- Old signatures are replaced (arg list changes -> new overload), so drop them.
DROP FUNCTION IF EXISTS public.report_student_attendance(date, date, uuid, int, int);
DROP FUNCTION IF EXISTS public.report_staff_attendance(date, date, int, int);

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
  -- super_admin may target any institution; a school_admin only their own.
  IF NOT (public.is_institution_admin(v_uid, v_inst) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT ON (ca.user_id)
      ca.user_id AS sid,
      p.full_name AS fname,
      p.roll_number AS roll,
      c.id AS cid,
      c.name AS cname,
      c.section AS csection
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id AND p.institution_id = v_inst
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst
    WHERE ca.role = 'student'
      AND (p_class_id IS NULL OR ca.class_id = p_class_id)
    ORDER BY ca.user_id, ca.class_id  -- deterministic primary class
  ),
  ranked AS (
    SELECT
      r.*,
      count(*) OVER() AS total,
      row_number() OVER (ORDER BY
        r.cname,
        r.csection NULLS FIRST,
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::int NULLS LAST,
        r.roll,
        r.fname
      ) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.roll::text,
    ranked.cid,
    CASE WHEN ranked.csection IS NOT NULL AND ranked.csection <> ''
      THEN ranked.cname || ' - ' || ranked.csection
      ELSE ranked.cname END,
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

CREATE OR REPLACE FUNCTION public.report_staff_attendance(
  p_from date,
  p_to date,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL
) RETURNS TABLE (
  staff_id uuid,
  full_name text,
  role text,
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
    SELECT DISTINCT ON (ur.user_id)
      ur.user_id AS sid,
      p.full_name AS fname,
      ur.role::text AS srole
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.institution_id = v_inst
    WHERE ur.role IN ('teacher', 'coordinator')
    ORDER BY ur.user_id, ur.role
  ),
  ranked AS (
    SELECT
      r.*,
      count(*) OVER() AS total,
      row_number() OVER (ORDER BY r.fname) AS rn
    FROM roster r
  )
  SELECT
    ranked.sid,
    ranked.fname,
    ranked.srole,
    COALESCE((
      SELECT jsonb_object_agg(sar.date::text, sar.status)
      FROM public.staff_attendance_records sar
      WHERE sar.staff_id = ranked.sid
        AND sar.institution_id = v_inst
        AND sar.date BETWEEN p_from AND p_to
    ), '{}'::jsonb),
    ranked.total
  FROM ranked
  WHERE ranked.rn > p_offset AND ranked.rn <= p_offset + p_limit
  ORDER BY ranked.rn;
END;
$$;

REVOKE ALL ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_student_attendance(date, date, uuid, int, int, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.report_staff_attendance(date, date, int, int, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_staff_attendance(date, date, int, int, uuid) TO authenticated;
