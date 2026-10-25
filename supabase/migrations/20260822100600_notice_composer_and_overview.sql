-- Notice Board phase 7: the RPCs the composer and the analytics tab need.
--
-- notice_target_options  - which classes / wings THIS author may address
-- notice_class_staff     - teachers of the chosen classes + the auto-added
--                          wing coordinators, for the composer's staff fields
-- communication_overview - replaces six unbounded client-side selects in
--                          CommunicationAnalytics with one server aggregate
BEGIN;

-- What the author is allowed to pick. The composer renders only these, and
-- publish_notice re-checks them server-side anyway -- this exists so the UI
-- never offers something the RPC would refuse.
CREATE OR REPLACE FUNCTION public.notice_target_options()
RETURNS TABLE(kind text, id uuid, label text, sort_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT (SELECT auth.uid()) AS uid,
           public.get_user_institution((SELECT auth.uid())) AS inst
  ),
  flags AS (
    SELECT me.uid, me.inst,
           public.is_institution_admin(me.uid, me.inst) AS is_admin,
           public.has_role(me.uid, 'coordinator')       AS is_coord,
           public.has_role(me.uid, 'teacher')           AS is_teach
      FROM me
  )
  SELECT 'class'::text, c.id,
         c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         c.name || '~' || coalesce(c.section,'')
    FROM public.classes c, flags f
   WHERE c.institution_id = f.inst
     AND c.is_active IS NOT FALSE
     AND (
          f.is_admin
       OR (f.is_coord AND public.is_coordinator_for_class(f.uid, c.id))
       OR (f.is_teach AND public.is_teacher_for_class(f.uid, c.id))
     )

  UNION ALL

  SELECT 'wing', w.id, w.name, w.name
    FROM public.wings w, flags f
   WHERE w.institution_id = f.inst
     AND w.is_active IS NOT FALSE
     -- teachers cannot address a wing, so they are not offered one
     AND (
          f.is_admin
       OR (f.is_coord AND EXISTS (SELECT 1 FROM public.wing_assignments wa
                                   WHERE wa.user_id = f.uid AND wa.wing_id = w.id))
     )
   ORDER BY 1, 4;
$$;

-- Teachers of the chosen classes (pickable) and the wing coordinators those
-- classes pull in (locked). added_reason mirrors notice_expand_audience so the
-- composer can label the locked chip with the same wording the row will carry.
CREATE OR REPLACE FUNCTION public.notice_class_staff(_class_ids uuid[])
RETURNS TABLE(kind text, user_id uuid, full_name text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT public.get_user_institution((SELECT auth.uid())) AS inst
  )
  SELECT DISTINCT ON (kind, user_id) *
    FROM (
      SELECT 'teacher'::text AS kind, ca.user_id, p.full_name,
             coalesce(string_agg(DISTINCT s.name, ', '), '') AS detail
        FROM public.class_assignments ca
        JOIN public.profiles p ON p.id = ca.user_id
        JOIN me ON true
        LEFT JOIN public.subjects s ON s.id = ca.subject_id
       WHERE ca.class_id = ANY(_class_ids)
         AND ca.role::text = 'teacher'
         AND p.institution_id = me.inst
         AND p.is_active IS NOT FALSE
       GROUP BY ca.user_id, p.full_name

      UNION ALL

      SELECT 'coordinator', wa.user_id, p.full_name,
             coalesce(string_agg(DISTINCT w.name, ', '), '')
        FROM public.wing_class_mappings wcm
        JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
        JOIN public.wings w             ON w.id = wcm.wing_id
        JOIN public.profiles p          ON p.id = wa.user_id
        JOIN me ON true
       WHERE wcm.class_id = ANY(_class_ids)
         AND p.institution_id = me.inst
         AND p.is_active IS NOT FALSE
       GROUP BY wa.user_id, p.full_name
    ) x
   ORDER BY kind, user_id, full_name;
$$;

-- CommunicationAnalytics previously ran six unbounded .select() calls and
-- counted the rows client-side -- one of them (conversation_messages) had no
-- institution filter at all, so it pulled every message on the platform up to
-- the PostgREST 1000-row cap and called the result a total.
CREATE OR REPLACE FUNCTION public.communication_overview(_institution_id uuid)
RETURNS TABLE(
  total_conversations integer, total_messages integer,
  total_notices integer, total_reads integer, total_acknowledgements integer,
  total_ptms integer, total_bookings integer,
  notices_general integer, notices_academic integer,
  notices_event integer, notices_ptm integer,
  conv_direct integer, conv_group integer, conv_announcement integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*)::integer FROM public.conversations WHERE institution_id = _institution_id),
    (SELECT count(*)::integer FROM public.conversation_messages cm
       JOIN public.conversations c ON c.id = cm.conversation_id
      WHERE c.institution_id = _institution_id),
    (SELECT count(*)::integer FROM public.notices WHERE institution_id = _institution_id),
    (SELECT count(*)::integer FROM public.notice_recipients r
       JOIN public.notices n ON n.id = r.notice_id
      WHERE n.institution_id = _institution_id AND r.read_at IS NOT NULL),
    (SELECT count(*)::integer FROM public.notice_recipients r
       JOIN public.notices n ON n.id = r.notice_id
      WHERE n.institution_id = _institution_id AND r.acknowledged_at IS NOT NULL),
    (SELECT count(*)::integer FROM public.ptm_schedules WHERE institution_id = _institution_id),
    (SELECT count(*)::integer FROM public.ptm_bookings b
       JOIN public.ptm_schedules s ON s.id = b.ptm_id
      WHERE s.institution_id = _institution_id),
    (SELECT count(*)::integer FROM public.notices WHERE institution_id=_institution_id AND type='general'),
    (SELECT count(*)::integer FROM public.notices WHERE institution_id=_institution_id AND type='academic'),
    (SELECT count(*)::integer FROM public.notices WHERE institution_id=_institution_id AND type='event'),
    (SELECT count(*)::integer FROM public.notices WHERE institution_id=_institution_id AND type='ptm'),
    (SELECT count(*)::integer FROM public.conversations WHERE institution_id=_institution_id AND type='direct'),
    (SELECT count(*)::integer FROM public.conversations WHERE institution_id=_institution_id AND type='group'),
    (SELECT count(*)::integer FROM public.conversations WHERE institution_id=_institution_id AND type='class_announcement');
$$;

REVOKE EXECUTE ON FUNCTION public.notice_target_options()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_class_staff(uuid[])             FROM anon;
REVOKE EXECUTE ON FUNCTION public.communication_overview(uuid)           FROM anon;

GRANT EXECUTE ON FUNCTION public.notice_target_options()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_class_staff(uuid[])              TO authenticated;
GRANT EXECUTE ON FUNCTION public.communication_overview(uuid)            TO authenticated;

COMMIT;
