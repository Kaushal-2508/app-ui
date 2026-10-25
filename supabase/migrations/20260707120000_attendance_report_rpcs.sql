-- Admin-only, server-side attendance-report pivots. Each returns one row per
-- person with a by_date jsonb (date -> raw status) + a windowed total_count,
-- paginated by LIMIT/OFFSET. Institution is resolved from auth.uid(); never
-- trusted from a client argument.

CREATE OR REPLACE FUNCTION public.report_student_attendance(
  p_from date,
  p_to date,
  p_class_id uuid DEFAULT NULL,
  p_limit int DEFAULT 40,
  p_offset int DEFAULT 0
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
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for user' USING ERRCODE = '42501';
  END IF;
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
    ORDER BY ca.user_id
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
    ranked.roll::text,  -- profiles.roll_number is varchar; RETURNS TABLE declares text
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
  p_offset int DEFAULT 0
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
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'No institution for user' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.report_student_attendance(date, date, uuid, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.report_student_attendance(date, date, uuid, int, int) TO authenticated;
REVOKE ALL ON FUNCTION public.report_staff_attendance(date, date, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.report_staff_attendance(date, date, int, int) TO authenticated;
