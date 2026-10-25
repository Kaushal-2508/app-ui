-- Live RLS test. verify-03 checks policy SHAPE; this checks policy EFFECT by
-- impersonating real users.
--
-- auth.uid() resolves from request.jwt.claims, so set_config + SET LOCAL ROLE
-- authenticated reproduces what a signed-in user actually sees. Without the
-- role switch the Management API session is postgres, which has BYPASSRLS and
-- would pass any policy vacuously.
--
-- The test builds its OWN fixture: a class-scoped notice in one institution
-- with exactly one recipient, plus a second student in the SAME institution who
-- is not on it. That shape is required to see the bug at all --
--   circ_select USING (get_user_institution(auth.uid()) = institution_id)
-- blocks a different-institution stranger correctly, so testing with one proves
-- nothing. Every legacy row is institution-scope and reaches everybody, so no
-- natural fixture exists either.
--
-- Results come back as ROWS, not a RAISE: the Supabase Management API returns
-- an EMPTY BODY on a SQL error, which makes a raised assertion invisible.
-- The fixture is deleted at both ends, so the script is re-runnable and leaves
-- nothing behind.

CREATE TEMP TABLE _nb_rls(check_name text, ok boolean, detail text) ON COMMIT DROP;

DELETE FROM public.notices WHERE id = 'aaaaaaaa-0000-4000-8000-00000000beef';

DO $$
DECLARE
  _nid      uuid := 'aaaaaaaa-0000-4000-8000-00000000beef';
  _inst     uuid;
  _author   uuid;
  _insider  uuid;   -- same institution, IS a recipient
  _stranger uuid;   -- same institution, NOT a recipient
  _class    uuid;
  _seen     integer;
BEGIN
  -- an institution with at least two active students and a class
  SELECT p.institution_id INTO _inst
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.is_active IS NOT FALSE
   GROUP BY p.institution_id
  HAVING count(*) >= 2
   LIMIT 1;

  SELECT id INTO _class FROM public.classes WHERE institution_id = _inst LIMIT 1;

  SELECT p.id INTO _author FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = _inst
     AND ur.role::text IN ('school_admin','super_school_admin')
   LIMIT 1;
  IF _author IS NULL THEN
    SELECT id INTO _author FROM public.profiles WHERE institution_id = _inst LIMIT 1;
  END IF;

  SELECT p.id INTO _insider FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = _inst AND p.is_active IS NOT FALSE AND p.id <> _author
   LIMIT 1;

  SELECT p.id INTO _stranger FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = _inst AND p.is_active IS NOT FALSE
     AND p.id <> _author AND p.id <> _insider
   LIMIT 1;

  INSERT INTO _nb_rls VALUES
    ('fixture_built',
     _inst IS NOT NULL AND _class IS NOT NULL AND _author IS NOT NULL
     AND _insider IS NOT NULL AND _stranger IS NOT NULL,
     'inst=' || coalesce(left(_inst::text,8),'-') ||
     ' insider=' || coalesce(left(_insider::text,8),'-') ||
     ' stranger=' || coalesce(left(_stranger::text,8),'-'));

  IF _inst IS NULL OR _class IS NULL OR _author IS NULL
     OR _insider IS NULL OR _stranger IS NULL THEN
    RETURN;
  END IF;

  -- a class-scoped notice addressed to exactly one student
  INSERT INTO public.notices (id, institution_id, title, content, type, scope,
                              priority, published_by, recipient_count)
  VALUES (_nid, _inst, 'RLS probe', 'RLS probe', 'general', 'class',
          'normal', _author, 1);
  INSERT INTO public.notice_target_classes (notice_id, class_id) VALUES (_nid, _class);
  INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason)
  VALUES (_nid, _insider, 'student', 'class_student');

  -- the addressed student must see it
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _insider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id = _nid;
  RESET ROLE;
  INSERT INTO _nb_rls VALUES
    ('recipient_sees_own_notice', _seen = 1, 'saw ' || _seen || ', want 1');

  -- THE ORIGINAL BUG: a same-school student who is NOT addressed must not.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id = _nid;
  RESET ROLE;
  INSERT INTO _nb_rls VALUES
    ('SCOPE_LEAK_CLOSED', _seen = 0, 'unaddressed same-school student saw ' || _seen || ', want 0');

  -- and must not be able to enumerate who it went to
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notice_recipients WHERE notice_id = _nid;
  RESET ROLE;
  INSERT INTO _nb_rls VALUES
    ('ROSTER_LEAK_CLOSED', _seen = 0, 'stranger saw ' || _seen || ' recipient rows, want 0');
END $$;

-- cascade removes the target + recipient rows
DELETE FROM public.notices WHERE id = 'aaaaaaaa-0000-4000-8000-00000000beef';

SELECT check_name, ok, detail FROM _nb_rls ORDER BY check_name;
