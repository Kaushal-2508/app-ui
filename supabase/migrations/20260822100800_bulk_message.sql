-- Bulk messaging, built on the notice audience engine.
--
-- The composer's live "Reaches 24 students" preview and the actual send MUST
-- expand the audience through the SAME expression -- that invariant is what
-- caught the teacher/co-teacher leak on notices. So rather than write a second
-- expansion for messages, notice_expand_audience gains two optional knobs:
--
--   _student_ids                narrows students within the chosen classes,
--                               mirroring how _teacher_ids narrows teachers
--   _include_wing_coordinators  messages pass false; a notice is an
--                               announcement of record a coordinator should
--                               see, a message to four students is not
--
-- Both default to today's notice behaviour, so publish_notice is unchanged.
BEGIN;

-- Adding parameters with defaults would create an AMBIGUOUS overload against
-- the existing 7-arg version (a 7-arg call would match both), so the old
-- signature is dropped first. No CASCADE: that would take publish_notice with
-- it. plpgsql and string-bodied SQL functions resolve callees at runtime, so
-- publish_notice and notice_audience_preview rebind to the new signature on
-- their next call -- both are recreated below anyway to make that explicit.
DROP FUNCTION IF EXISTS public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[]);

CREATE OR REPLACE FUNCTION public.notice_expand_audience(
  _institution_id uuid,
  _author         uuid,
  _scope          text,
  _class_ids      uuid[],
  _wing_ids       uuid[],
  _audience_roles text[],
  _teacher_ids    uuid[],
  _student_ids    uuid[] DEFAULT NULL,
  _include_wing_coordinators boolean DEFAULT true
) RETURNS TABLE(user_id uuid, recipient_role text, added_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH role_of AS (
    SELECT ur.user_id,
           (ARRAY_AGG(ur.role::text ORDER BY CASE ur.role::text
                        WHEN 'coordinator' THEN 1
                        WHEN 'teacher'     THEN 2
                        ELSE 3 END))[1] AS role
      FROM public.user_roles ur
     WHERE ur.role::text IN ('coordinator','teacher','student')
     GROUP BY ur.user_id
  ),
  class_roles AS (
    SELECT coalesce(_audience_roles, ARRAY['student','teacher']) AS roles
  ),
  candidates AS (
    -- CLASS scope: students of the chosen classes, optionally narrowed to a
    -- specific set. Empty/NULL _student_ids means every student of the class.
    SELECT ca.user_id, 'student'::text AS recipient_role, 'class_student'::text AS added_reason
      FROM public.class_assignments ca
      JOIN public.profiles p ON p.id = ca.user_id
      CROSS JOIN class_roles cr
     WHERE _scope = 'class'
       AND 'student' = ANY(cr.roles)
       AND ca.class_id = ANY(_class_ids)
       AND ca.role::text = 'student'
       AND (_student_ids IS NULL OR cardinality(_student_ids) = 0
            OR ca.user_id = ANY(_student_ids))
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- CLASS scope: teachers of those classes
    SELECT ca.user_id, 'teacher', 'class_teacher'
      FROM public.class_assignments ca
      JOIN public.profiles p ON p.id = ca.user_id
      CROSS JOIN class_roles cr
     WHERE _scope = 'class'
       AND 'teacher' = ANY(cr.roles)
       AND ca.class_id = ANY(_class_ids)
       AND ca.role::text = 'teacher'
       AND (_teacher_ids IS NULL OR cardinality(_teacher_ids) = 0
            OR ca.user_id = ANY(_teacher_ids))
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- CLASS scope: wing coordinators. Locked ON for notices (no audience choice
    -- may drop them); messages switch it off.
    SELECT wa.user_id, 'coordinator', 'wing_coordinator_auto'
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
      JOIN public.profiles p          ON p.id = wa.user_id
     WHERE _scope = 'class'
       AND _include_wing_coordinators
       AND wcm.class_id = ANY(_class_ids)
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- WING scope
    SELECT wa.user_id, r.role, 'wing_member'
      FROM public.wing_assignments wa
      JOIN public.profiles p ON p.id = wa.user_id
      JOIN role_of r         ON r.user_id = wa.user_id
     WHERE _scope = 'wing'
       AND wa.wing_id = ANY(_wing_ids)
       AND r.role = ANY(coalesce(_audience_roles, ARRAY['coordinator','teacher','student']))
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- INSTITUTION scope
    SELECT p.id, r.role, 'audience_role'
      FROM public.profiles p
      JOIN role_of r ON r.user_id = p.id
     WHERE _scope = 'institution'
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE
       AND r.role = ANY(coalesce(_audience_roles, ARRAY['coordinator','teacher','student']))
  )
  SELECT DISTINCT ON (c.user_id) c.user_id, c.recipient_role, c.added_reason
    FROM candidates c
   WHERE c.user_id <> _author
   ORDER BY c.user_id,
            CASE c.recipient_role
              WHEN 'coordinator' THEN 1
              WHEN 'teacher'     THEN 2
              ELSE 3 END;
$$;

-- Recreated so the rebinding to the new signature is explicit rather than
-- incidental. Body is byte-identical to 20260822100700 otherwise.
CREATE OR REPLACE FUNCTION public.notice_audience_preview(
  _scope          text,
  _class_ids      uuid[] DEFAULT NULL,
  _wing_ids       uuid[] DEFAULT NULL,
  _audience_roles text[] DEFAULT NULL,
  _teacher_ids    uuid[] DEFAULT NULL
) RETURNS TABLE(recipient_role text, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.recipient_role, count(*)::integer
    FROM public.notice_expand_audience(
           public.get_user_institution((SELECT auth.uid())),
           (SELECT auth.uid()),
           _scope, _class_ids, _wing_ids, _audience_roles, _teacher_ids) e
   GROUP BY e.recipient_role;
$$;

-- ---------------------------------------------------------------------------
-- Bulk messaging
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bulk_message_audience_preview(
  _scope          text,
  _class_ids      uuid[] DEFAULT NULL,
  _wing_ids       uuid[] DEFAULT NULL,
  _audience_roles text[] DEFAULT NULL,
  _student_ids    uuid[] DEFAULT NULL,
  _teacher_ids    uuid[] DEFAULT NULL
) RETURNS TABLE(recipient_role text, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.recipient_role, count(*)::integer
    FROM public.notice_expand_audience(
           public.get_user_institution((SELECT auth.uid())),
           (SELECT auth.uid()),
           _scope, _class_ids, _wing_ids, _audience_roles, _teacher_ids,
           _student_ids, false) e
   GROUP BY e.recipient_role;
$$;

/*
 * Sends one message to a computed audience, in a single transaction.
 *
 * Delivery is in-app: one `conversations` row of type 'broadcast', its
 * participants, and one message. Recipients see it in their Messages with no
 * email or SMS provider configured -- the previous composer sent through
 * send-communication, and this institution has no channels enabled at all, so
 * every "successful" bulk send reached nobody.
 *
 * The conversation id is generated client-side, so a double-click finds the row
 * already present and returns instead of sending twice.
 */
CREATE OR REPLACE FUNCTION public.send_bulk_message(
  _conversation_id uuid,
  _subject         text,
  _body            text,
  _scope           text,
  _class_ids       uuid[] DEFAULT NULL,
  _wing_ids        uuid[] DEFAULT NULL,
  _audience_roles  text[] DEFAULT NULL,
  _student_ids     uuid[] DEFAULT NULL,
  _teacher_ids     uuid[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _author   uuid := (SELECT auth.uid());
  _inst     uuid;
  _is_admin boolean;
  _is_coord boolean;
  _is_teach boolean;
  _teacher_only boolean;
  _roles    text[];
  _n        integer;
BEGIN
  IF _author IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to send a message.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.conversations WHERE id = _conversation_id) THEN
    RETURN _conversation_id;
  END IF;

  _inst := public.get_user_institution(_author);
  IF _inst IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a school yet.';
  END IF;

  IF coalesce(btrim(_body), '') = '' THEN
    RAISE EXCEPTION 'Write a message before sending.';
  END IF;
  IF _scope NOT IN ('institution','wing','class') THEN
    RAISE EXCEPTION 'Choose who this message is for.';
  END IF;

  _is_admin := public.is_institution_admin(_author, _inst);
  _is_coord := public.has_role(_author, 'coordinator');
  _is_teach := public.has_role(_author, 'teacher');
  _teacher_only := _is_teach AND NOT _is_admin AND NOT _is_coord;

  IF NOT (_is_admin OR _is_coord OR _is_teach) THEN
    RAISE EXCEPTION 'You do not have permission to send bulk messages.';
  END IF;

  -- Authority mirrors publish_notice exactly: admins anywhere in their school,
  -- coordinators inside their wings, teachers only their own classes.
  IF _scope = 'class' THEN
    IF _class_ids IS NULL OR cardinality(_class_ids) = 0 THEN
      RAISE EXCEPTION 'Pick at least one class.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.classes c
                WHERE c.id = ANY(_class_ids) AND c.institution_id <> _inst) THEN
      RAISE EXCEPTION 'That class belongs to another school.';
    END IF;
    IF NOT _is_admin THEN
      IF EXISTS (
        SELECT 1 FROM unnest(_class_ids) cid
         WHERE NOT (
           (_is_coord AND public.is_coordinator_for_class(_author, cid))
           OR (_is_teach AND public.is_teacher_for_class(_author, cid))
         )
      ) THEN
        RAISE EXCEPTION 'You can only message your own classes.';
      END IF;
    END IF;
    IF _teacher_only THEN
      _roles := ARRAY['student'];
    ELSE
      _roles := coalesce(_audience_roles, ARRAY['student','teacher']);
    END IF;

  ELSIF _scope = 'wing' THEN
    IF _wing_ids IS NULL OR cardinality(_wing_ids) = 0 THEN
      RAISE EXCEPTION 'Pick at least one wing.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wings w
                WHERE w.id = ANY(_wing_ids) AND w.institution_id <> _inst) THEN
      RAISE EXCEPTION 'That wing belongs to another school.';
    END IF;
    IF NOT _is_admin THEN
      IF NOT _is_coord THEN
        RAISE EXCEPTION 'Only coordinators and admins can message a whole wing.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(_wing_ids) wid
         WHERE NOT EXISTS (SELECT 1 FROM public.wing_assignments wa
                            WHERE wa.user_id = _author AND wa.wing_id = wid)
      ) THEN
        RAISE EXCEPTION 'You can only message your own wings.';
      END IF;
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['teacher','student']);

  ELSE
    IF NOT _is_admin THEN
      RAISE EXCEPTION 'Only school admins can message the whole school.';
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['coordinator','teacher','student']);
  END IF;

  IF _teacher_only THEN
    IF EXISTS (SELECT 1 FROM unnest(_roles) r WHERE r <> 'student') THEN
      RAISE EXCEPTION 'Teachers can only message students.';
    END IF;
  END IF;

  IF NOT (_roles <@ ARRAY['coordinator','teacher','student']) THEN
    RAISE EXCEPTION 'Unknown audience.';
  END IF;

  CREATE TEMP TABLE _bulk_recipients ON COMMIT DROP AS
    SELECT e.user_id
      FROM public.notice_expand_audience(
             _inst, _author, _scope, _class_ids, _wing_ids, _roles,
             _teacher_ids, _student_ids, false) e;

  SELECT count(*) INTO _n FROM _bulk_recipients;
  IF _n = 0 THEN
    RAISE EXCEPTION 'Nobody matches that selection, so there is no one to send to.';
  END IF;

  INSERT INTO public.conversations (id, institution_id, type, title, created_by)
  VALUES (_conversation_id, _inst, 'broadcast',
          nullif(btrim(coalesce(_subject, '')), ''), _author);

  INSERT INTO public.conversation_participants (conversation_id, user_id, role)
  VALUES (_conversation_id, _author, 'sender');

  INSERT INTO public.conversation_participants (conversation_id, user_id, role)
  SELECT _conversation_id, r.user_id, 'recipient' FROM _bulk_recipients r
  ON CONFLICT DO NOTHING;

  INSERT INTO public.conversation_messages (conversation_id, sender_id, content, message_type)
  VALUES (_conversation_id, _author, _body, 'text');

  RETURN _conversation_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[],uuid[],boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[],uuid[],boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bulk_message_audience_preview(text,uuid[],uuid[],text[],uuid[],uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_bulk_message(uuid,text,text,text,uuid[],uuid[],text[],uuid[],uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_audience_preview(text,uuid[],uuid[],text[],uuid[]) FROM anon;

GRANT EXECUTE ON FUNCTION public.bulk_message_audience_preview(text,uuid[],uuid[],text[],uuid[],uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_bulk_message(uuid,text,text,text,uuid[],uuid[],text[],uuid[],uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_audience_preview(text,uuid[],uuid[],text[],uuid[]) TO authenticated;

COMMIT;
