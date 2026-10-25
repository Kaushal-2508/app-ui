-- Super-admin platform pages: count on the server instead of downloading
-- every row (CLAUDE.md §23 item 2). Asked for as NEEDS DB in naman-erp
-- 2520efa1, which pages user_roles, exams and profiles through
-- fetchAllRows to get the numbers right past PostgREST's 1000-row cap.
--
-- * admin_institution_counts(): one row per institution. Students come from
--   institution_student_ids(), the platform's single roster definition, so
--   the Institutions grid shows the same student total as the Command
--   Center (it used to count student ROLE rows, a different number).
-- * admin_user_roster(): every profile with its institution name and roles,
--   as ONE jsonb value. A set-returning RPC would be clipped at 1000 rows by
--   PostgREST exactly like a table read; a scalar is not.
-- Both are super_admin only and fail closed on a missing caller.

CREATE OR REPLACE FUNCTION public.admin_institution_counts()
RETURNS TABLE(institution_id uuid, teachers integer, students integer, exams integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (select auth.uid()) IS NULL OR NOT public.is_super_admin((select auth.uid())) THEN
    RAISE EXCEPTION 'Only a super admin can read platform counts' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.id,
         (SELECT count(DISTINCT ur.user_id)::int FROM public.user_roles ur
           WHERE ur.institution_id = i.id AND ur.role = 'teacher'),
         (SELECT count(*)::int FROM public.institution_student_ids(i.id)),
         (SELECT count(*)::int FROM public.exams e WHERE e.institution_id = i.id)
    FROM public.institutions i;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_user_roster()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF (select auth.uid()) IS NULL OR NOT public.is_super_admin((select auth.uid())) THEN
    RAISE EXCEPTION 'Only a super admin can read the platform roster' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'full_name', p.full_name,
           'email', p.email,
           'is_active', p.is_active,
           'institution_id', p.institution_id,
           'created_at', p.created_at,
           'institution_name', i.name,
           -- Role rows in id order: the page's "primary role" is the first.
           'roles', COALESCE(r.roles, '[]'::jsonb)
         ) ORDER BY p.full_name, p.id), '[]'::jsonb)
    INTO v
    FROM public.profiles p
    LEFT JOIN public.institutions i ON i.id = p.institution_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(ur.role::text ORDER BY ur.id) AS roles
        FROM public.user_roles ur WHERE ur.user_id = p.id
    ) r ON true;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_institution_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_institution_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_institution_counts() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_user_roster() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_roster() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_user_roster() TO authenticated, service_role;
