-- Optional class filter on "Are your students using SALCI?".
--
-- School-wide the card says 241 of 253 have never signed in, which is a fact
-- an admin can do nothing with: the work is handed out class by class, to the
-- class teacher. Narrowing to one class turns the same number into a list that
-- one person can be asked to fix.
--
-- p_class_id is appended with a NULL default AND the old two-argument signature
-- is dropped in the same migration. CREATE OR REPLACE does not replace across a
-- different argument count -- it creates a second overload, and PostgREST then
-- cannot resolve a call that matches both, which surfaces as an empty card.
-- That exact failure shipped in 20260822101900 on dash_attendance_trend.
--
-- The membership test is EXISTS rather than a join: class_assignments holds one
-- row per (student, class, subject), so joining would count a student once per
-- subject and inflate every figure on the card.
BEGIN;

DROP FUNCTION IF EXISTS public.dash_student_portal_adoption(uuid, integer);

CREATE OR REPLACE FUNCTION public.dash_student_portal_adoption(
  p_institution_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 8,
  p_class_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_now timestamptz;
  v_total int; v_never int; v_7d int; v_30d int;
  v_laggards jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_now := now();

  -- A class from another institution must not silently return zeroes and read
  -- as "nobody here has ever signed in".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH students AS (
    SELECT p.id, p.full_name, u.last_sign_in_at
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
      LEFT JOIN auth.users u ON u.id = p.id
     WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
       AND (p_class_id IS NULL OR EXISTS (
             SELECT 1 FROM class_assignments ca
              WHERE ca.user_id = p.id AND ca.role::text = 'student'
                AND ca.class_id = p_class_id))
  )
  SELECT count(*),
         count(*) FILTER (WHERE last_sign_in_at IS NULL),
         count(*) FILTER (WHERE last_sign_in_at >= v_now - INTERVAL '7 days'),
         count(*) FILTER (WHERE last_sign_in_at >= v_now - INTERVAL '30 days')
    INTO v_total, v_never, v_7d, v_30d
    FROM students;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_laggards
    FROM (
      SELECT jsonb_build_object(
               'student_id', p.id,
               'name', coalesce(p.full_name, p.email),
               'class', (SELECT string_agg(DISTINCT c.name || CASE WHEN coalesce(c.section,'') <> ''
                                                                   THEN '-' || c.section ELSE '' END, ', ')
                           FROM class_assignments ca
                           JOIN classes c ON c.id = ca.class_id
                          WHERE ca.user_id = p.id AND ca.role::text = 'student'),
               'last_sign_in_at', u.last_sign_in_at) AS x
        FROM profiles p
        JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
        LEFT JOIN auth.users u ON u.id = p.id
       WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
         AND u.last_sign_in_at IS NULL
         AND (p_class_id IS NULL OR EXISTS (
               SELECT 1 FROM class_assignments ca
                WHERE ca.user_id = p.id AND ca.role::text = 'student'
                  AND ca.class_id = p_class_id))
       ORDER BY coalesce(p.full_name, p.email)
       LIMIT LEAST(GREATEST(coalesce(p_limit, 8), 1), 50)
    ) s;

  RETURN jsonb_build_object(
    'total', v_total,
    'never_signed_in', v_never,
    'active_7d', v_7d,
    'active_30d', v_30d,
    'pct_active_7d',  CASE WHEN v_total > 0 THEN round(v_7d *100.0/v_total, 1) END,
    'pct_active_30d', CASE WHEN v_total > 0 THEN round(v_30d*100.0/v_total, 1) END,
    'never_list', v_laggards
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_student_portal_adoption(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_student_portal_adoption(uuid, integer, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_student_portal_adoption(uuid, integer, uuid) TO authenticated;

COMMIT;
