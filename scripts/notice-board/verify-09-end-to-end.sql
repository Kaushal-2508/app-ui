-- End-to-end walk of the hierarchy the feature exists to enforce.
--
-- A real teacher publishes to a real class; the assertions then check that the
-- right people received it, that the wrong people cannot see it, and that reach
-- rolls up to the coordinator and admin but not to a student.
--
-- Results come back as ROWS (the Management API returns an empty body on a SQL
-- error). The fixture is deleted at both ends, so this is re-runnable and leaves
-- prod untouched.

CREATE TEMP TABLE _nb_e2e(check_name text, ok boolean, detail text) ON COMMIT DROP;

DELETE FROM public.notices WHERE id = 'cccccccc-0000-4000-8000-00000000e2e1';

DO $$
DECLARE
  _nid      uuid := 'cccccccc-0000-4000-8000-00000000e2e1';
  _inst     uuid;
  _class    uuid;
  _teacher  uuid;
  _student  uuid;
  _outsider uuid;
  _coord    uuid;
  _admin    uuid;
  _seen     integer;
  _reach    integer;
BEGIN
  -- a class its teacher can publish to, that has students and a wing coordinator
  SELECT c.institution_id, c.id INTO _inst, _class
    FROM public.classes c
   WHERE EXISTS (SELECT 1 FROM public.class_assignments a
                  WHERE a.class_id=c.id AND a.role::text='student')
     AND EXISTS (SELECT 1 FROM public.class_assignments a
                  WHERE a.class_id=c.id AND a.role::text='teacher')
     AND EXISTS (SELECT 1 FROM public.wing_class_mappings w WHERE w.class_id=c.id)
   LIMIT 1;

  SELECT a.user_id INTO _teacher FROM public.class_assignments a
    JOIN public.profiles p ON p.id=a.user_id
   WHERE a.class_id=_class AND a.role::text='teacher'
     AND p.is_active IS NOT FALSE
     AND NOT public.is_institution_admin(a.user_id, _inst)
   LIMIT 1;

  SELECT a.user_id INTO _student FROM public.class_assignments a
    JOIN public.profiles p ON p.id=a.user_id
   WHERE a.class_id=_class AND a.role::text='student' AND p.is_active IS NOT FALSE
   LIMIT 1;

  -- a student of the SAME school who is not in this class
  SELECT p.id INTO _outsider FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id=p.id AND ur.role::text='student'
   WHERE p.institution_id=_inst AND p.is_active IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments a
                      WHERE a.user_id=p.id AND a.class_id=_class)
   LIMIT 1;

  SELECT wa.user_id INTO _coord
    FROM public.wing_class_mappings wcm
    JOIN public.wing_assignments wa ON wa.wing_id=wcm.wing_id
    JOIN public.profiles p ON p.id=wa.user_id
   WHERE wcm.class_id=_class AND p.institution_id=_inst AND p.is_active IS NOT FALSE
   LIMIT 1;

  SELECT ur.user_id INTO _admin FROM public.user_roles ur
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin') AND p.institution_id=_inst
   LIMIT 1;

  INSERT INTO _nb_e2e VALUES
    ('fixture_built',
     _class IS NOT NULL AND _teacher IS NOT NULL AND _student IS NOT NULL
     AND _outsider IS NOT NULL AND _coord IS NOT NULL AND _admin IS NOT NULL,
     'class=' || coalesce(left(_class::text,8),'-') ||
     ' teacher=' || coalesce(left(_teacher::text,8),'-') ||
     ' coord='   || coalesce(left(_coord::text,8),'-'));

  IF _class IS NULL OR _teacher IS NULL OR _student IS NULL
     OR _outsider IS NULL OR _coord IS NULL OR _admin IS NULL THEN
    RETURN;
  END IF;

  -- ---- the teacher publishes to their own class ----------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  PERFORM public.publish_notice(
    _nid, 'E2E probe', 'Body', 'general', 'important', 'class',
    ARRAY[_class], NULL, NULL, NULL, true, NULL, '[]'::jsonb);

  INSERT INTO _nb_e2e VALUES
    ('student_of_class_received',
     public.notice_is_recipient(_nid, _student), ''),
    ('wing_coordinator_auto_received',
     EXISTS (SELECT 1 FROM public.notice_recipients
              WHERE notice_id=_nid AND user_id=_coord
                AND added_reason='wing_coordinator_auto'), ''),
    ('outsider_not_a_recipient',
     NOT public.notice_is_recipient(_nid, _outsider), ''),
    ('teacher_author_not_own_recipient',
     NOT public.notice_is_recipient(_nid, _teacher), ''),
    ('teacher_audience_is_students_only',
     NOT EXISTS (SELECT 1 FROM public.notice_recipients
                  WHERE notice_id=_nid AND recipient_role='teacher'),
     (SELECT string_agg(DISTINCT recipient_role, ',')
        FROM public.notice_recipients WHERE notice_id=_nid));

  -- ---- visibility, as each party -------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id=_nid;
  RESET ROLE;
  INSERT INTO _nb_e2e VALUES ('student_can_read_it', _seen = 1, 'saw ' || _seen);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _outsider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id=_nid;
  RESET ROLE;
  INSERT INTO _nb_e2e VALUES
    ('outsider_cannot_read_it', _seen = 0, 'saw ' || _seen || ', want 0');

  -- ---- reach rolls UP, never sideways or down ------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _reach FROM public.notice_reach(_nid);
  INSERT INTO _nb_e2e VALUES ('author_sees_reach', _reach > 0, _reach || ' role rows');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _coord, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _reach FROM public.notice_reach(_nid);
  INSERT INTO _nb_e2e VALUES ('coordinator_sees_reach', _reach > 0, _reach || ' role rows');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _reach FROM public.notice_reach(_nid);
  INSERT INTO _nb_e2e VALUES ('admin_sees_reach', _reach > 0, _reach || ' role rows');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _reach FROM public.notice_reach(_nid);
  INSERT INTO _nb_e2e VALUES
    ('student_denied_reach', _reach = 0, _reach || ' role rows, want 0');

  -- ---- the read + acknowledge round trip -----------------------------------
  PERFORM public.mark_notice_read(_nid, true);
  INSERT INTO _nb_e2e VALUES
    ('student_read_and_acknowledged',
     (SELECT read_at IS NOT NULL AND acknowledged_at IS NOT NULL
        FROM public.notice_recipients WHERE notice_id=_nid AND user_id=_student), '');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _coord, 'role', 'authenticated')::text, true);
  INSERT INTO _nb_e2e VALUES
    ('coordinator_sees_the_read',
     (SELECT coalesce(sum(read_count),0) FROM public.notice_reach(_nid)) = 1,
     (SELECT coalesce(sum(read_count),0)::text FROM public.notice_reach(_nid)) || ' reads'),
    ('coordinator_sees_the_ack',
     (SELECT coalesce(sum(ack_count),0) FROM public.notice_reach(_nid)) = 1,
     (SELECT coalesce(sum(ack_count),0)::text FROM public.notice_reach(_nid)) || ' acks');

  -- ---- inbox / outbox ------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _student, 'role', 'authenticated')::text, true);
  INSERT INTO _nb_e2e VALUES
    ('notice_in_student_inbox',
     EXISTS (SELECT 1 FROM public.notice_inbox(NULL,NULL,50) WHERE id=_nid), '');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  INSERT INTO _nb_e2e VALUES
    ('notice_in_author_outbox',
     EXISTS (SELECT 1 FROM public.notice_outbox(NULL,NULL,50) WHERE id=_nid), '');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _outsider, 'role', 'authenticated')::text, true);
  INSERT INTO _nb_e2e VALUES
    ('notice_absent_from_outsider_inbox',
     NOT EXISTS (SELECT 1 FROM public.notice_inbox(NULL,NULL,50) WHERE id=_nid), '');
END $$;

DELETE FROM public.notices WHERE id = 'cccccccc-0000-4000-8000-00000000e2e1';

SELECT check_name, ok, detail FROM _nb_e2e ORDER BY check_name;
