-- Messages become a fan-out of DIRECT conversations, not one group thread.
--
-- send_bulk_message created a single 'broadcast' conversation with every
-- recipient in it. That is wrong for a message: 253 people end up in one room,
-- they can see each other, and nobody has a private thread with the sender.
-- Sending now creates (or reuses) a normal 1:1 conversation per recipient, so
-- each person sees an ordinary direct message in their conversation list and
-- can reply privately.
--
-- The composer stops mirroring the Notice Board too: no scope, no wing, no
-- class-audience. The author picks people.
BEGIN;

-- Idempotency for a fan-out. The client generates one batch id per send; a
-- double-click or a retry re-runs with the same id and every insert is skipped.
-- Partial index so the millions of ordinary messages carry no uniqueness cost.
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_batch_uniq
  ON public.conversation_messages (conversation_id, batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN public.conversation_messages.batch_id IS
  'Set by send_direct_messages so a repeated fan-out cannot duplicate messages. NULL for ordinary one-off messages.';

/*
 * Who may this person message?
 *
 * Mirrors the authority the rest of the module already enforces:
 *   admin        anyone active in their school
 *   coordinator  anyone assigned to a class in their wings, plus fellow
 *                coordinators of those wings
 *   teacher      students of the classes they teach
 *
 * Used both to build the picker and to re-check every id at send time, so a
 * crafted request cannot message someone the picker would never have offered.
 */
CREATE OR REPLACE FUNCTION public.can_message_user(_author uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ctx AS (
    SELECT public.get_user_institution(_author) AS inst
  )
  SELECT _author IS NOT NULL
     AND _target IS NOT NULL
     AND _author <> _target
     AND EXISTS (
       SELECT 1
         FROM public.profiles p, ctx
        WHERE p.id = _target
          AND p.institution_id = ctx.inst
          AND p.is_active IS NOT FALSE
          AND EXISTS (SELECT 1 FROM public.user_roles ur
                       WHERE ur.user_id = p.id
                         AND ur.role::text IN ('coordinator','teacher','student'))
          AND (
               public.is_institution_admin(_author, ctx.inst)

            OR (public.has_role(_author, 'coordinator') AND (
                  EXISTS (SELECT 1
                            FROM public.class_assignments ca
                            JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
                            JOIN public.wing_assignments wa     ON wa.wing_id = wcm.wing_id
                           WHERE ca.user_id = p.id AND wa.user_id = _author)
               OR EXISTS (SELECT 1
                            FROM public.wing_assignments mine
                            JOIN public.wing_assignments theirs ON theirs.wing_id = mine.wing_id
                           WHERE mine.user_id = _author AND theirs.user_id = p.id)
               ))

            OR (public.has_role(_author, 'teacher') AND EXISTS (
                  SELECT 1
                    FROM public.class_assignments mine
                    JOIN public.class_assignments theirs ON theirs.class_id = mine.class_id
                   WHERE mine.user_id = _author AND mine.role::text = 'teacher'
                     AND theirs.user_id = p.id AND theirs.role::text = 'student'))
          )
     );
$$;

/*
 * The people this author may message, filtered and keyset-paginated.
 *
 * Paginated rather than "fetch everyone and filter in the browser": the school
 * in front of us has 253 students, and PostgREST silently truncates an
 * unbounded select at 1000 rows, so a client-side picker would quietly go wrong
 * on a larger roster.
 */
CREATE OR REPLACE FUNCTION public.list_message_recipients(
  _role       text,
  _search     text    DEFAULT NULL,
  _class_id   uuid    DEFAULT NULL,
  _after_name text    DEFAULT NULL,
  _after_id   uuid    DEFAULT NULL,
  _limit      integer DEFAULT 30
) RETURNS TABLE(user_id uuid, full_name text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ctx AS (SELECT public.get_user_institution((SELECT auth.uid())) AS inst)
  SELECT p.id,
         coalesce(p.full_name, p.email),
         CASE _role
           WHEN 'student' THEN (
             SELECT string_agg(DISTINCT c.name || CASE WHEN coalesce(c.section,'') <> ''
                                                       THEN '-' || c.section ELSE '' END, ', ')
               FROM public.class_assignments ca
               JOIN public.classes c ON c.id = ca.class_id
              WHERE ca.user_id = p.id AND ca.role::text = 'student')
           WHEN 'teacher' THEN (
             SELECT string_agg(DISTINCT c.name || CASE WHEN coalesce(c.section,'') <> ''
                                                       THEN '-' || c.section ELSE '' END, ', ')
               FROM public.class_assignments ca
               JOIN public.classes c ON c.id = ca.class_id
              WHERE ca.user_id = p.id AND ca.role::text = 'teacher')
           ELSE (
             SELECT string_agg(DISTINCT w.name, ', ')
               FROM public.wing_assignments wa
               JOIN public.wings w ON w.id = wa.wing_id
              WHERE wa.user_id = p.id)
         END
    FROM public.profiles p, ctx
   WHERE p.institution_id = ctx.inst
     AND p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id AND ur.role::text = _role)
     AND public.can_message_user((SELECT auth.uid()), p.id)
     AND (_class_id IS NULL OR EXISTS (
            SELECT 1 FROM public.class_assignments ca
             WHERE ca.user_id = p.id AND ca.class_id = _class_id))
     AND (_search IS NULL OR btrim(_search) = ''
          OR coalesce(p.full_name, p.email) ILIKE '%' || btrim(_search) || '%')
     AND (_after_name IS NULL
          OR (coalesce(p.full_name, p.email), p.id) > (_after_name, _after_id))
   ORDER BY coalesce(p.full_name, p.email) ASC, p.id ASC
   LIMIT LEAST(GREATEST(coalesce(_limit, 30), 1), 100);
$$;

/*
 * Sends one body to many people as SEPARATE direct conversations.
 *
 * Each recipient gets an ordinary 1:1 thread with the sender -- reusing the
 * existing one when there is already a direct conversation between them, so a
 * bulk send lands in the thread they already know rather than spawning a
 * duplicate beside it.
 *
 * Returns how many conversations received the message.
 */
CREATE OR REPLACE FUNCTION public.send_direct_messages(
  _batch_id      uuid,
  _recipient_ids uuid[],
  _body          text
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _author uuid := (SELECT auth.uid());
  _inst   uuid;
  _rid    uuid;
  _cid    uuid;
  _sent   integer := 0;
BEGIN
  IF _author IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to send a message.';
  END IF;
  IF coalesce(btrim(_body), '') = '' THEN
    RAISE EXCEPTION 'Write a message before sending.';
  END IF;
  IF _recipient_ids IS NULL OR cardinality(_recipient_ids) = 0 THEN
    RAISE EXCEPTION 'Pick at least one person to message.';
  END IF;
  IF cardinality(_recipient_ids) > 500 THEN
    RAISE EXCEPTION 'That is more than 500 people. Send in smaller batches.';
  END IF;

  _inst := public.get_user_institution(_author);
  IF _inst IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a school yet.';
  END IF;

  FOREACH _rid IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(_recipient_ids) x)
  LOOP
    -- Re-check every id server-side. The picker only offers reachable people,
    -- but the picker is a convenience and this is the enforcement point.
    IF NOT public.can_message_user(_author, _rid) THEN
      RAISE EXCEPTION 'You cannot message one of the people you selected.';
    END IF;

    SELECT c.id INTO _cid
      FROM public.conversations c
     WHERE c.type = 'direct'
       AND c.institution_id = _inst
       AND EXISTS (SELECT 1 FROM public.conversation_participants p
                    WHERE p.conversation_id = c.id AND p.user_id = _author)
       AND EXISTS (SELECT 1 FROM public.conversation_participants p
                    WHERE p.conversation_id = c.id AND p.user_id = _rid)
       AND (SELECT count(*) FROM public.conversation_participants p
             WHERE p.conversation_id = c.id) = 2
     LIMIT 1;

    IF _cid IS NULL THEN
      INSERT INTO public.conversations (institution_id, type, created_by)
      VALUES (_inst, 'direct', _author)
      RETURNING id INTO _cid;

      INSERT INTO public.conversation_participants (conversation_id, user_id, role)
      VALUES (_cid, _author, 'sender'), (_cid, _rid, 'recipient');
    END IF;

    -- ON CONFLICT against conversation_messages_batch_uniq: re-running the same
    -- batch is a no-op rather than a second copy in every thread.
    INSERT INTO public.conversation_messages
      (conversation_id, sender_id, content, message_type, batch_id)
    VALUES (_cid, _author, _body, 'text', _batch_id)
    ON CONFLICT (conversation_id, batch_id) WHERE batch_id IS NOT NULL DO NOTHING;

    IF FOUND THEN _sent := _sent + 1; END IF;

    UPDATE public.conversations SET updated_at = now() WHERE id = _cid;
    _cid := NULL;
  END LOOP;

  RETURN _sent;
END $$;

REVOKE EXECUTE ON FUNCTION public.can_message_user(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_message_recipients(text,text,uuid,text,uuid,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_direct_messages(uuid,uuid[],text) FROM anon;

GRANT EXECUTE ON FUNCTION public.can_message_user(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_message_recipients(text,text,uuid,text,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_direct_messages(uuid,uuid[],text) TO authenticated;

COMMIT;
