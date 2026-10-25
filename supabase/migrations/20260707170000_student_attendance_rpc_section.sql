-- report_student_attendance: return class_name (grade, e.g. "Class 1") and
-- section (e.g. "A") SEPARATELY, so the export can group per class (grade) with
-- a Section column instead of one tab per section. class_id is retained.
-- DROP + CREATE because the RETURNS TABLE gains a column.

DROP FUNCTION IF EXISTS public.report_student_attendance(date, date, uuid, int, int, uuid);

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
        NULLIF(regexp_replace(COALESCE(r.roll, ''), '\D', '', 'g'), '')::int NULLS LAST,
        r.roll, r.fname
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
