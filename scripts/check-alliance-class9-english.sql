-- Apply the corrected (non-recursive) student-sibling policy.

-- 1. SECURITY DEFINER helper — bypasses RLS so the policy doesn't recurse.
CREATE OR REPLACE FUNCTION public.get_student_class_group_ids(p_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $func$
  SELECT DISTINCT c.class_group_id
  FROM public.classes c
  JOIN public.class_assignments ca
    ON ca.class_id = c.id
  WHERE ca.user_id = p_user_id
    AND ca.role = 'student'::public.app_role
    AND c.class_group_id IS NOT NULL;
$func$;

GRANT EXECUTE ON FUNCTION public.get_student_class_group_ids(UUID)
  TO authenticated;

-- 2. Drop any prior version, install the new one that calls the helper.
DROP POLICY IF EXISTS "Students can view sibling classes in their class_group"
  ON public.classes;

CREATE POLICY "Students can view sibling classes in their class_group"
  ON public.classes
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student'::public.app_role)
    AND class_group_id IS NOT NULL
    AND class_group_id IN (
      SELECT public.get_student_class_group_ids(auth.uid())
    )
  );

-- 3. Verify
SELECT 'function' AS object, proname AS name FROM pg_proc WHERE proname = 'get_student_class_group_ids'
UNION ALL
SELECT 'policy', policyname FROM pg_policies WHERE policyname ILIKE '%sibling%';
