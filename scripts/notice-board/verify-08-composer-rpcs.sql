-- Exercises notice_target_options, notice_class_staff and
-- communication_overview as a real admin and a real teacher.
--
-- Results come back as ROWS, not a RAISE: the Supabase Management API returns
-- an EMPTY BODY on a SQL error. Read-only, so nothing needs cleaning up.

CREATE TEMP TABLE _nb_c(check_name text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  _inst    uuid;
  _admin   uuid;
  _teacher uuid;
  _class   uuid;
  _classes integer;
  _wings   integer;
  _t_cls   integer;
  _staff   integer;
  _coord   integer;
  _ov      record;
BEGIN
  -- an institution with a class that has a wing mapping and a teacher
  SELECT c.institution_id, c.id INTO _inst, _class
    FROM public.classes c
   WHERE EXISTS (SELECT 1 FROM public.wing_class_mappings w WHERE w.class_id=c.id)
     AND EXISTS (SELECT 1 FROM public.class_assignments ca
                  WHERE ca.class_id=c.id AND ca.role::text='teacher')
   LIMIT 1;

  SELECT ur.user_id INTO _admin FROM public.user_roles ur
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin')
     AND p.institution_id=_inst LIMIT 1;

  SELECT ca.user_id INTO _teacher FROM public.class_assignments ca
    JOIN public.profiles p ON p.id=ca.user_id
   WHERE ca.class_id=_class AND ca.role::text='teacher'
     AND p.institution_id=_inst LIMIT 1;

  INSERT INTO _nb_c VALUES
    ('fixture_built', _inst IS NOT NULL AND _admin IS NOT NULL AND _teacher IS NOT NULL,
     'class=' || coalesce(left(_class::text,8),'-'));
  IF _inst IS NULL OR _admin IS NULL OR _teacher IS NULL THEN RETURN; END IF;

  -- ---- as the admin --------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);

  SELECT count(*) FILTER (WHERE kind='class'), count(*) FILTER (WHERE kind='wing')
    INTO _classes, _wings FROM public.notice_target_options();
  INSERT INTO _nb_c VALUES
    ('admin_sees_classes', _classes > 0, _classes || ' classes'),
    ('admin_sees_wings',   _wings   > 0, _wings   || ' wings');

  SELECT count(*) FILTER (WHERE kind='teacher'), count(*) FILTER (WHERE kind='coordinator')
    INTO _staff, _coord FROM public.notice_class_staff(ARRAY[_class]);
  INSERT INTO _nb_c VALUES
    ('class_staff_has_teachers',     _staff > 0, _staff || ' teachers'),
    ('class_staff_has_coordinators', _coord > 0, _coord || ' coordinators');

  -- one row per person per kind, never a duplicate from multi-subject teaching
  INSERT INTO _nb_c VALUES
    ('class_staff_deduped',
     NOT EXISTS (SELECT 1 FROM (SELECT kind, user_id FROM public.notice_class_staff(ARRAY[_class])
                                 GROUP BY 1,2 HAVING count(*)>1) d), '');

  -- ---- as a teacher --------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);

  SELECT count(*) FILTER (WHERE kind='class'), count(*) FILTER (WHERE kind='wing')
    INTO _t_cls, _wings FROM public.notice_target_options();
  INSERT INTO _nb_c VALUES
    ('teacher_sees_own_classes', _t_cls > 0, _t_cls || ' classes'),
    ('teacher_offered_no_wings', _wings = 0, _wings || ' wings, want 0'),
    ('teacher_scope_narrower_than_admin', _t_cls <= _classes,
     'teacher=' || _t_cls || ' admin=' || _classes);

  -- ---- analytics -----------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  SELECT * INTO _ov FROM public.communication_overview(_inst);
  INSERT INTO _nb_c VALUES
    ('overview_returns_row', _ov.total_notices IS NOT NULL,
     'notices=' || _ov.total_notices || ' reads=' || _ov.total_reads ||
     ' convs=' || _ov.total_conversations || ' msgs=' || _ov.total_messages),
    ('overview_notices_match',
     _ov.total_notices = (SELECT count(*) FROM public.notices WHERE institution_id=_inst), '');
END $$;

SELECT check_name, ok, detail FROM _nb_c ORDER BY check_name;
