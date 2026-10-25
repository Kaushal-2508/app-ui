-- Students of the chosen classes, for the bulk-message student picker.
--
-- Mirrors notice_class_staff. Scoped to the caller's institution and to classes
-- they may actually address, so the picker cannot enumerate a roster the send
-- RPC would refuse anyway.
BEGIN;

CREATE OR REPLACE FUNCTION public.notice_class_students(_class_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT (SELECT auth.uid()) AS uid,
           public.get_user_institution((SELECT auth.uid())) AS inst
  )
  SELECT DISTINCT ON (ca.user_id)
         ca.user_id,
         p.full_name,
         c.name || CASE WHEN coalesce(c.section,'') <> ''
                        THEN '-' || c.section ELSE '' END AS detail
    FROM public.class_assignments ca
    JOIN public.profiles p ON p.id = ca.user_id
    JOIN public.classes  c ON c.id = ca.class_id
    JOIN me ON true
   WHERE ca.class_id = ANY(_class_ids)
     AND ca.role::text = 'student'
     AND p.institution_id = me.inst
     AND p.is_active IS NOT FALSE
     AND (
          public.is_institution_admin(me.uid, me.inst)
       OR public.is_coordinator_for_class(me.uid, ca.class_id)
       OR public.is_teacher_for_class(me.uid, ca.class_id)
     )
   ORDER BY ca.user_id, p.full_name;
$$;

REVOKE EXECUTE ON FUNCTION public.notice_class_students(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.notice_class_students(uuid[]) TO authenticated;

COMMIT;
