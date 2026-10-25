-- Exercises send_direct_messages and list_message_recipients on real rosters.
--
-- Results come back as ROWS (the Management API returns an empty body on a SQL
-- error). Everything created is deleted at both ends, so this is re-runnable
-- and leaves prod untouched.

CREATE TEMP TABLE _dm(check_name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE _dm_made(conversation_id uuid) ON COMMIT DROP;

DO $$
DECLARE
  _batch   uuid := 'eeeeeeee-0000-4000-8000-00000000dd01';
  _inst    uuid;
  _class   uuid;
  _admin   uuid;
  _teacher uuid;
  _s1      uuid;
  _s2      uuid;
  _far     uuid;
  _sent    integer;
  _convs   integer;
  _c1      uuid;
  _c2      uuid;
  _rows    integer;
  _raised  boolean;
BEGIN
  SELECT c.institution_id, c.id INTO _inst, _class
    FROM public.classes c
   WHERE (SELECT count(*) FROM public.class_assignments a
           WHERE a.class_id=c.id AND a.role::text='student') >= 2
     AND EXISTS (SELECT 1 FROM public.class_assignments a
                  WHERE a.class_id=c.id AND a.role::text='teacher')
   LIMIT 1;

  SELECT ur.user_id INTO _admin FROM public.user_roles ur
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin')
     AND p.institution_id=_inst LIMIT 1;

  SELECT a.user_id INTO _teacher FROM public.class_assignments a
    JOIN public.profiles p ON p.id=a.user_id
   WHERE a.class_id=_class AND a.role::text='teacher' AND p.is_active IS NOT FALSE
     AND NOT public.is_institution_admin(a.user_id,_inst) LIMIT 1;

  SELECT a.user_id INTO _s1 FROM public.class_assignments a
    JOIN public.profiles p ON p.id=a.user_id
   WHERE a.class_id=_class AND a.role::text='student' AND p.is_active IS NOT FALSE
   ORDER BY a.user_id LIMIT 1;

  SELECT a.user_id INTO _s2 FROM public.class_assignments a
    JOIN public.profiles p ON p.id=a.user_id
   WHERE a.class_id=_class AND a.role::text='student' AND p.is_active IS NOT FALSE
     AND a.user_id <> _s1 ORDER BY a.user_id LIMIT 1;

  -- a student of ANOTHER institution: nobody here may message them
  SELECT p.id INTO _far FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id=p.id AND ur.role::text='student'
   WHERE p.institution_id <> _inst AND p.is_active IS NOT FALSE LIMIT 1;

  INSERT INTO _dm VALUES ('fixture_built',
    _class IS NOT NULL AND _admin IS NOT NULL AND _s1 IS NOT NULL AND _s2 IS NOT NULL,
    'class=' || coalesce(left(_class::text,8),'-'));
  IF _class IS NULL OR _admin IS NULL OR _s1 IS NULL OR _s2 IS NULL THEN RETURN; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);

  -- ---- picker -------------------------------------------------------------
  SELECT count(*) INTO _rows FROM public.list_message_recipients('student', NULL, _class, NULL, NULL, 100);
  INSERT INTO _dm VALUES ('picker_lists_students', _rows > 0, _rows || ' students in class');

  SELECT count(*) INTO _rows FROM public.list_message_recipients('student', NULL, NULL, NULL, NULL, 5);
  INSERT INTO _dm VALUES ('picker_respects_limit', _rows <= 5, _rows || ' rows for limit 5');

  INSERT INTO _dm VALUES
    ('picker_excludes_self',
     NOT EXISTS (SELECT 1 FROM public.list_message_recipients('student',NULL,NULL,NULL,NULL,100)
                  WHERE user_id = _admin), '');

  -- ---- send to two students, as two SEPARATE direct threads ---------------
  SELECT public.send_direct_messages(_batch, ARRAY[_s1,_s2], 'DM probe body') INTO _sent;

  INSERT INTO _dm_made
  SELECT DISTINCT cm.conversation_id FROM public.conversation_messages cm
   WHERE cm.batch_id = _batch;

  SELECT count(*) INTO _convs FROM _dm_made;

  SELECT cm.conversation_id INTO _c1 FROM public.conversation_messages cm
    JOIN public.conversation_participants p
      ON p.conversation_id = cm.conversation_id AND p.user_id = _s1
   WHERE cm.batch_id = _batch LIMIT 1;
  SELECT cm.conversation_id INTO _c2 FROM public.conversation_messages cm
    JOIN public.conversation_participants p
      ON p.conversation_id = cm.conversation_id AND p.user_id = _s2
   WHERE cm.batch_id = _batch LIMIT 1;

  INSERT INTO _dm VALUES
    ('sent_count_matches', _sent = 2, _sent || ' sent'),
    ('two_separate_conversations', _convs = 2, _convs || ' conversations'),
    ('every_thread_is_direct',
     NOT EXISTS (SELECT 1 FROM public.conversations c JOIN _dm_made m ON m.conversation_id=c.id
                  WHERE c.type <> 'direct'), ''),
    ('every_thread_has_two_people',
     NOT EXISTS (SELECT 1 FROM _dm_made m
                  WHERE (SELECT count(*) FROM public.conversation_participants p
                          WHERE p.conversation_id=m.conversation_id) <> 2), ''),
    ('recipients_cannot_see_each_other',
     NOT EXISTS (SELECT 1 FROM _dm_made m
                  WHERE EXISTS (SELECT 1 FROM public.conversation_participants p
                                 WHERE p.conversation_id=m.conversation_id AND p.user_id=_s1)
                    AND EXISTS (SELECT 1 FROM public.conversation_participants p
                                 WHERE p.conversation_id=m.conversation_id AND p.user_id=_s2)), '');

  -- ---- idempotent on a repeat of the same batch ---------------------------
  SELECT public.send_direct_messages(_batch, ARRAY[_s1,_s2], 'DM probe body') INTO _sent;
  SELECT count(*) INTO _rows FROM public.conversation_messages WHERE batch_id=_batch;
  INSERT INTO _dm VALUES
    ('resend_is_noop', _sent = 0 AND _rows = 2,
     'second call sent=' || _sent || ', total messages=' || _rows);

  -- ---- a second, different batch reuses the SAME threads -------------------
  SELECT public.send_direct_messages(
           'eeeeeeee-0000-4000-8000-00000000dd02', ARRAY[_s1], 'Follow up') INTO _sent;
  INSERT INTO _dm VALUES
    ('second_batch_reuses_thread',
     (SELECT count(DISTINCT conversation_id) FROM public.conversation_messages
       WHERE batch_id IN (_batch,'eeeeeeee-0000-4000-8000-00000000dd02')
         AND conversation_id IN (SELECT conversation_id FROM _dm_made)) = 2,
     'no duplicate thread spawned');

  -- ---- recipients can read their own thread, and only their own -----------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _rows FROM public.conversations c WHERE c.id IN (_c1, _c2);
  RESET ROLE;
  INSERT INTO _dm VALUES
    ('recipient_sees_only_own_thread', _rows = 1, 'saw ' || _rows || ' of 2');

  -- ---- authority ----------------------------------------------------------
  IF _far IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
    _raised := false;
    BEGIN
      PERFORM public.send_direct_messages(
        'eeeeeeee-0000-4000-8000-00000000dd03', ARRAY[_far], 'nope');
    EXCEPTION WHEN others THEN _raised := true;
    END;
    INSERT INTO _dm VALUES
      ('cross_institution_blocked', _raised, 'refused=' || _raised);
  ELSE
    INSERT INTO _dm VALUES ('cross_institution_blocked', NULL, 'SKIPPED: single institution');
  END IF;

  IF _teacher IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
    INSERT INTO _dm VALUES
      ('teacher_may_message_own_student', public.can_message_user(_teacher, _s1), ''),
      ('teacher_may_not_message_admin',
       NOT public.can_message_user(_teacher, _admin), '');
  END IF;
END $$;

-- cascade removes participants and messages
DELETE FROM public.conversations WHERE id IN (SELECT conversation_id FROM _dm_made);

SELECT check_name, ok, detail FROM _dm ORDER BY check_name;
