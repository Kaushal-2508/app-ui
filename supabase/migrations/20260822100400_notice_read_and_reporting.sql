-- Notice Board phase 5: read receipts and the reach rollup.
--
-- Both feeds are single RPCs rather than PostgREST embeds so a list never N+1s
-- to fetch per-notice read state or reach, and both paginate by keyset rather
-- than OFFSET (section 23).
BEGIN;

-- Opening a notice stamps read_at. The Acknowledge button additionally stamps
-- acknowledged_at, and is only offered when notices.requires_acknowledgement.
--
-- COALESCE makes this idempotent by construction: a double-click, a retry, or a
-- second open cannot move a timestamp that is already set. notice_recipients
-- has no UPDATE policy, so this is the only write path -- nobody can stamp an
-- acknowledgement they did not make or edit their own recipient_role.
CREATE OR REPLACE FUNCTION public.mark_notice_read(
  _notice_id  uuid,
  _acknowledge boolean DEFAULT false
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notice_recipients
     SET read_at         = COALESCE(read_at, now()),
         acknowledged_at = CASE WHEN _acknowledge
                                THEN COALESCE(acknowledged_at, now())
                                ELSE acknowledged_at END
   WHERE notice_id = _notice_id
     AND user_id   = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.notice_inbox(
  _before_published_at timestamptz DEFAULT NULL,
  _before_id           uuid        DEFAULT NULL,
  _limit               integer     DEFAULT 20
) RETURNS TABLE(
  id uuid, title text, content text, type text, scope text, priority text,
  published_at timestamptz, expires_at timestamptz,
  requires_acknowledgement boolean, attachments jsonb,
  publisher_name text, read_at timestamptz, acknowledged_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.content, n.type, n.scope, n.priority,
         n.published_at, n.expires_at, n.requires_acknowledgement, n.attachments,
         pub.full_name, r.read_at, r.acknowledged_at
    FROM public.notice_recipients r
    JOIN public.notices  n   ON n.id  = r.notice_id
    LEFT JOIN public.profiles pub ON pub.id = n.published_by
   WHERE r.user_id = (SELECT auth.uid())
     AND n.published_at <= now()
     AND (n.expires_at IS NULL OR n.expires_at > now())
     AND (_before_published_at IS NULL
          OR (n.published_at, n.id) < (_before_published_at, _before_id))
   ORDER BY n.published_at DESC, n.id DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.notice_outbox(
  _before_published_at timestamptz DEFAULT NULL,
  _before_id           uuid        DEFAULT NULL,
  _limit               integer     DEFAULT 20
) RETURNS TABLE(
  id uuid, title text, type text, scope text, priority text,
  published_at timestamptz, expires_at timestamptz,
  requires_acknowledgement boolean, publisher_name text, target_summary text,
  recipient_count integer, read_count integer, ack_count integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.type, n.scope, n.priority,
         n.published_at, n.expires_at, n.requires_acknowledgement,
         pub.full_name,
         CASE n.scope
           WHEN 'institution' THEN 'Whole school'
           WHEN 'wing'  THEN (SELECT string_agg(w.name, ', ' ORDER BY w.name)
                                FROM public.notice_target_wings tw
                                JOIN public.wings w ON w.id = tw.wing_id
                               WHERE tw.notice_id = n.id)
           ELSE (SELECT string_agg(
                          c.name || CASE WHEN coalesce(c.section,'') <> ''
                                         THEN '-' || c.section ELSE '' END,
                          ', ' ORDER BY c.name, c.section)
                   FROM public.notice_target_classes tc
                   JOIN public.classes c ON c.id = tc.class_id
                  WHERE tc.notice_id = n.id)
         END,
         n.recipient_count,
         agg.read_count, agg.ack_count
    FROM public.notices n
    LEFT JOIN public.profiles pub ON pub.id = n.published_by
    -- server-side aggregate, never rows pulled to be counted on the client
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.read_at IS NOT NULL)::integer         AS read_count,
             count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::integer AS ack_count
        FROM public.notice_recipients r WHERE r.notice_id = n.id
    ) agg
   WHERE n.institution_id = public.get_user_institution((SELECT auth.uid()))
     AND public.notice_can_oversee(n.id, (SELECT auth.uid()))
     AND (_before_published_at IS NULL
          OR (n.published_at, n.id) < (_before_published_at, _before_id))
   ORDER BY n.published_at DESC, n.id DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.notice_reach(_notice_id uuid)
RETURNS TABLE(recipient_role text, total integer, read_count integer, ack_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.recipient_role,
         count(*)::integer,
         count(*) FILTER (WHERE r.read_at IS NOT NULL)::integer,
         count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::integer
    FROM public.notice_recipients r
   WHERE r.notice_id = _notice_id
     AND public.notice_can_oversee(_notice_id, (SELECT auth.uid()))
   GROUP BY r.recipient_role
   ORDER BY CASE r.recipient_role
              WHEN 'coordinator' THEN 1
              WHEN 'teacher'     THEN 2
              ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public.notice_recipient_list(
  _notice_id  uuid,
  _status     text    DEFAULT 'all',
  _after_name text    DEFAULT NULL,
  _after_id   uuid    DEFAULT NULL,
  _limit      integer DEFAULT 50
) RETURNS TABLE(
  user_id uuid, full_name text, recipient_role text, added_reason text,
  read_at timestamptz, acknowledged_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.user_id, p.full_name, r.recipient_role, r.added_reason,
         r.read_at, r.acknowledged_at
    FROM public.notice_recipients r
    JOIN public.profiles p ON p.id = r.user_id
   WHERE r.notice_id = _notice_id
     AND public.notice_can_oversee(_notice_id, (SELECT auth.uid()))
     AND CASE coalesce(_status, 'all')
           WHEN 'unread'       THEN r.read_at IS NULL
           WHEN 'read'         THEN r.read_at IS NOT NULL
           WHEN 'acknowledged' THEN r.acknowledged_at IS NOT NULL
           ELSE true
         END
     AND (_after_name IS NULL
          OR (coalesce(p.full_name,''), r.user_id) > (_after_name, _after_id))
   ORDER BY coalesce(p.full_name,'') ASC, r.user_id ASC
   LIMIT LEAST(GREATEST(coalesce(_limit, 50), 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notice_read(uuid, boolean)                       FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_inbox(timestamptz, uuid, integer)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_outbox(timestamptz, uuid, integer)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_reach(uuid)                                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_recipient_list(uuid, text, text, uuid, integer) FROM anon;

GRANT EXECUTE ON FUNCTION public.mark_notice_read(uuid, boolean)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_inbox(timestamptz, uuid, integer)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_outbox(timestamptz, uuid, integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_reach(uuid)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_recipient_list(uuid, text, text, uuid, integer)  TO authenticated;

COMMIT;
