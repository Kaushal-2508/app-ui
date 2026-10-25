-- Notice Board fix: class scope must respect audience_roles.
--
-- BUG this closes. publish_notice rejected a teacher who NAMED _teacher_ids,
-- but left _teacher_ids NULL -- and NULL means "all teachers of these classes"
-- inside notice_expand_audience. So a teacher publishing to their own class
-- silently reached every co-teacher of that class, which is exactly what
-- "teachers issue to their students" is supposed to prevent. The guard blocked
-- the explicit path and left the default wide open.
--
-- Caught by scripts/notice-board/verify-09-end-to-end.sql:
--   teacher_audience_is_students_only  FAIL  coordinator,student,teacher
--
-- Fix: class scope now filters students and teachers by _audience_roles, the
-- same way wing and institution scope already do. publish_notice derives that
-- list from who is publishing. The wing-coordinator branch stays UNFILTERED --
-- that recipient is locked by design and no audience choice may drop them.
BEGIN;

CREATE OR REPLACE FUNCTION public.notice_expand_audience(
  _institution_id uuid,
  _author         uuid,
  _scope          text,
  _class_ids      uuid[],
  _wing_ids       uuid[],
  _audience_roles text[],
  _teacher_ids    uuid[]
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
  -- Under class scope an omitted list means "students and teachers", which is
  -- what an admin or coordinator gets by default. publish_notice narrows it to
  -- ARRAY['student'] for a teacher author.
  class_roles AS (
    SELECT coalesce(_audience_roles, ARRAY['student','teacher']) AS roles
  ),
  candidates AS (
    -- CLASS scope: students of the chosen classes
    SELECT ca.user_id, 'student'::text AS recipient_role, 'class_student'::text AS added_reason
      FROM public.class_assignments ca
      JOIN public.profiles p ON p.id = ca.user_id
      CROSS JOIN class_roles cr
     WHERE _scope = 'class'
       AND 'student' = ANY(cr.roles)
       AND ca.class_id = ANY(_class_ids)
       AND ca.role::text = 'student'
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- CLASS scope: teachers of those classes. Empty/NULL _teacher_ids means
    -- "all teachers of these classes", but only when 'teacher' is in the
    -- audience at all -- otherwise no teacher is included.
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
    -- CLASS scope: wing coordinators. Deliberately NOT filtered by
    -- _audience_roles -- this recipient is locked so a teacher cannot notify a
    -- class while cutting their coordinator out of the loop.
    SELECT wa.user_id, 'coordinator', 'wing_coordinator_auto'
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
      JOIN public.profiles p          ON p.id = wa.user_id
     WHERE _scope = 'class'
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

CREATE OR REPLACE FUNCTION public.publish_notice(
  _notice_id               uuid,
  _title                   text,
  _content                 text,
  _type                    text,
  _priority                text,
  _scope                   text,
  _class_ids               uuid[]      DEFAULT NULL,
  _wing_ids                uuid[]      DEFAULT NULL,
  _audience_roles          text[]      DEFAULT NULL,
  _teacher_ids             uuid[]      DEFAULT NULL,
  _requires_acknowledgement boolean    DEFAULT false,
  _expires_at              timestamptz DEFAULT NULL,
  _attachments             jsonb       DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _author    uuid := (SELECT auth.uid());
  _inst      uuid;
  _is_admin  boolean;
  _is_coord  boolean;
  _is_teach  boolean;
  _teacher_only boolean;
  _roles     text[];
  _n         integer;
BEGIN
  IF _author IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to publish a notice.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.notices WHERE id = _notice_id) THEN
    RETURN _notice_id;
  END IF;

  _inst := public.get_user_institution(_author);
  IF _inst IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a school yet.';
  END IF;

  IF coalesce(btrim(_title), '') = '' THEN
    RAISE EXCEPTION 'A notice needs a title.';
  END IF;
  IF coalesce(btrim(_content), '') = '' THEN
    RAISE EXCEPTION 'A notice needs some content.';
  END IF;
  IF _scope NOT IN ('institution','wing','class') THEN
    RAISE EXCEPTION 'Choose who this notice is for.';
  END IF;

  _is_admin := public.is_institution_admin(_author, _inst);
  _is_coord := public.has_role(_author, 'coordinator');
  _is_teach := public.has_role(_author, 'teacher');
  _teacher_only := _is_teach AND NOT _is_admin AND NOT _is_coord;

  IF NOT (_is_admin OR _is_coord OR _is_teach) THEN
    RAISE EXCEPTION 'You do not have permission to publish notices.';
  END IF;

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
        RAISE EXCEPTION 'You can only send notices to your own classes.';
      END IF;
    END IF;

    -- A teacher reaches the students of their class and nobody else on staff.
    -- The wing coordinator is still added -- that branch ignores this list.
    IF _teacher_only THEN
      _roles := ARRAY['student'];
    ELSE
      _roles := coalesce(_audience_roles, ARRAY['student','teacher']);
      IF NOT (_roles <@ ARRAY['student','teacher']) THEN
        RAISE EXCEPTION 'A class notice can only address students and teachers.';
      END IF;
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
        RAISE EXCEPTION 'Only coordinators and admins can send a wing notice.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(_wing_ids) wid
         WHERE NOT EXISTS (SELECT 1 FROM public.wing_assignments wa
                            WHERE wa.user_id = _author AND wa.wing_id = wid)
      ) THEN
        RAISE EXCEPTION 'You can only send notices to your own wings.';
      END IF;
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['teacher','student']);

  ELSE
    IF NOT _is_admin THEN
      RAISE EXCEPTION 'Only school admins can send a whole-school notice.';
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['coordinator','teacher','student']);
  END IF;

  IF _teacher_only THEN
    IF EXISTS (SELECT 1 FROM unnest(_roles) r WHERE r <> 'student') THEN
      RAISE EXCEPTION 'Teachers can only send notices to students.';
    END IF;
    IF _teacher_ids IS NOT NULL AND cardinality(_teacher_ids) > 0 THEN
      RAISE EXCEPTION 'Teachers can only send notices to students.';
    END IF;
  END IF;

  IF NOT (_roles <@ ARRAY['coordinator','teacher','student']) THEN
    RAISE EXCEPTION 'Unknown audience.';
  END IF;

  INSERT INTO public.notices (
    id, institution_id, title, content, type, scope, priority,
    audience_roles, requires_acknowledgement, expires_at, attachments,
    published_by, published_at
  ) VALUES (
    -- order must track the column list above: type, scope, priority
    _notice_id, _inst, btrim(_title), _content, _type, _scope, _priority,
    coalesce(_roles, ARRAY['student']), _requires_acknowledgement, _expires_at,
    coalesce(_attachments, '[]'::jsonb),
    _author, now()
  );

  IF _scope = 'class' THEN
    INSERT INTO public.notice_target_classes (notice_id, class_id)
    SELECT _notice_id, cid FROM unnest(_class_ids) cid
    ON CONFLICT DO NOTHING;
  ELSIF _scope = 'wing' THEN
    INSERT INTO public.notice_target_wings (notice_id, wing_id)
    SELECT _notice_id, wid FROM unnest(_wing_ids) wid
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason)
  SELECT _notice_id, e.user_id, e.recipient_role, e.added_reason
    FROM public.notice_expand_audience(
           _inst, _author, _scope, _class_ids, _wing_ids, _roles, _teacher_ids) e
  ON CONFLICT (notice_id, user_id) DO NOTHING;

  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.notices
     SET recipient_count = _n,
         audience_roles  = (SELECT coalesce(array_agg(DISTINCT r.recipient_role),
                                            ARRAY['student'])
                              FROM public.notice_recipients r
                             WHERE r.notice_id = _notice_id)
   WHERE id = _notice_id;

  RETURN _notice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_notice(uuid,text,text,text,text,text,uuid[],uuid[],text[],uuid[],boolean,timestamptz,jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.publish_notice(uuid,text,text,text,text,text,uuid[],uuid[],text[],uuid[],boolean,timestamptz,jsonb) TO authenticated;

COMMIT;
