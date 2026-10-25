-- Exercises publish_notice end to end against real prod rosters.
--
-- Results come back as ROWS, not a RAISE: the Supabase Management API returns
-- an EMPTY BODY on a SQL error, which makes a raised assertion invisible.
-- Fixture ids are fixed (not gen_random_uuid) so cleanup is deterministic and
-- the script is re-runnable; everything it creates is deleted at both ends.

CREATE TEMP TABLE _nb_pub(check_name text, ok boolean, detail text) ON COMMIT DROP;

DELETE FROM public.notices WHERE id IN (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'bbbbbbbb-0000-4000-8000-000000000003');

DO $$
DECLARE
  _inst     uuid;
  _author   uuid;
  _class    uuid;
  _outsider uuid;
  _nid      uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  _cnt      integer;
  _preview  integer;
  _raised   boolean;
BEGIN
  -- a class that has students AND a wing mapping, so every branch fires
  SELECT c.institution_id, c.id INTO _inst, _class
    FROM public.classes c
   WHERE EXISTS (SELECT 1 FROM public.class_assignments ca
                  WHERE ca.class_id=c.id AND ca.role::text='student')
     AND EXISTS (SELECT 1 FROM public.wing_class_mappings w WHERE w.class_id=c.id)
   LIMIT 1;

  SELECT ur.user_id INTO _author
    FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin')
     AND p.institution_id=_inst LIMIT 1;

  INSERT INTO _nb_pub VALUES
    ('fixture_built', _class IS NOT NULL AND _author IS NOT NULL,
     'inst=' || coalesce(left(_inst::text,8),'-') || ' class=' || coalesce(left(_class::text,8),'-'));
  IF _class IS NULL OR _author IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO _preview
    FROM public.notice_expand_audience(_inst,_author,'class',ARRAY[_class],NULL,NULL,NULL);
  INSERT INTO _nb_pub VALUES
    ('expansion_non_empty', _preview > 0, _preview || ' would-be recipients');
  IF _preview = 0 THEN RETURN; END IF;

  -- Exercise the real RPC. publish_notice reads auth.uid(), which resolves
  -- from request.jwt.claims.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _author, 'role', 'authenticated')::text, true);

  PERFORM public.publish_notice(
    _nid, 'assert', 'assert body', 'general', 'normal', 'class',
    ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);

  SELECT count(*) INTO _cnt FROM public.notice_recipients WHERE notice_id=_nid;

  INSERT INTO _nb_pub VALUES
    ('preview_matches_publish', _cnt = _preview, 'preview=' || _preview || ' published=' || _cnt),
    ('recipient_count_snapshot',
      (SELECT recipient_count FROM public.notices WHERE id=_nid) = _cnt,
      'snapshot=' || (SELECT recipient_count FROM public.notices WHERE id=_nid) || ' actual=' || _cnt),
    ('target_class_written',
      EXISTS (SELECT 1 FROM public.notice_target_classes WHERE notice_id=_nid AND class_id=_class), ''),
    ('author_excluded',
      NOT EXISTS (SELECT 1 FROM public.notice_recipients WHERE notice_id=_nid AND user_id=_author), ''),
    ('wing_coordinator_auto_added',
      EXISTS (SELECT 1 FROM public.notice_recipients
               WHERE notice_id=_nid AND added_reason='wing_coordinator_auto'),
      (SELECT count(*)::text FROM public.notice_recipients
        WHERE notice_id=_nid AND added_reason='wing_coordinator_auto') || ' coordinators'),
    ('no_duplicate_recipients',
      NOT EXISTS (SELECT 1 FROM (SELECT notice_id,user_id FROM public.notice_recipients
                                  WHERE notice_id=_nid GROUP BY 1,2 HAVING count(*)>1) d), '');

  -- idempotency: the client-generated id means a double-submit returns rather
  -- than publishing twice
  PERFORM public.publish_notice(
    _nid, 'assert', 'assert body', 'general', 'normal', 'class',
    ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);
  INSERT INTO _nb_pub VALUES
    ('idempotent_on_resubmit',
     (SELECT count(*) FROM public.notice_recipients WHERE notice_id=_nid) = _cnt,
     'still ' || (SELECT count(*) FROM public.notice_recipients WHERE notice_id=_nid));

  -- ---- authority must actually reject -------------------------------------
  SELECT ur.user_id INTO _outsider
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role::text = 'teacher'
     AND p.institution_id = _inst
     AND NOT public.is_teacher_for_class(ur.user_id, _class)
     AND NOT public.is_coordinator_for_class(ur.user_id, _class)
     AND NOT public.is_institution_admin(ur.user_id, _inst)
   LIMIT 1;

  IF _outsider IS NULL THEN
    INSERT INTO _nb_pub VALUES ('authority_checks', NULL, 'SKIPPED: no non-teaching teacher in institution');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _outsider, 'role', 'authenticated')::text, true);

  _raised := false;
  BEGIN
    PERFORM public.publish_notice(
      'bbbbbbbb-0000-4000-8000-000000000002', 'nope', 'nope', 'general', 'normal', 'class',
      ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);
  EXCEPTION WHEN others THEN
    _raised := true;
  END;
  INSERT INTO _nb_pub VALUES
    ('teacher_blocked_from_foreign_class', _raised, 'refused=' || _raised);

  _raised := false;
  BEGIN
    PERFORM public.publish_notice(
      'bbbbbbbb-0000-4000-8000-000000000003', 'nope', 'nope', 'general', 'normal', 'institution',
      NULL, NULL, ARRAY['teacher'], NULL, false, NULL, '[]'::jsonb);
  EXCEPTION WHEN others THEN
    _raised := true;
  END;
  INSERT INTO _nb_pub VALUES
    ('teacher_blocked_from_staff_audience', _raised, 'refused=' || _raised);
END $$;

DELETE FROM public.notices WHERE id IN (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'bbbbbbbb-0000-4000-8000-000000000003');

SELECT check_name, ok, detail FROM _nb_pub ORDER BY check_name;
