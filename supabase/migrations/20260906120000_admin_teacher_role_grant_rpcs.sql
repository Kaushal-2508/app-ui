-- Admin + Teacher dual role: grant and revoke the teacher role on an existing
-- account, in one transaction, with attribution and an audit trail.
--
-- Why an RPC rather than copying PromoteToCoordinatorDialog's shape: that
-- dialog probes then inserts (a TOCTOU race against the real
-- UNIQUE(user_id, role, institution_id) key), omits granted_by, and writes no
-- audit row. The role grant plus the class/subject rows are two dependent
-- writes, and CLAUDE.md §9a requires two or more dependent writes to be ONE
-- RPC, never sequential client calls.
--
-- Note on nesting: set_staff_class_assignments is itself SECURITY DEFINER and
-- gates on auth.uid(). auth.uid() reads the request JWT, not the function
-- owner, so the nested call still authorizes against the real caller.

CREATE OR REPLACE FUNCTION public.grant_teacher_role(
  _user_id uuid,
  _pairs   jsonb DEFAULT '[]'::jsonb          -- [{"class_id": uuid, "subject_id": uuid}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_inst        uuid;
  v_target_name text;
  v_granted     boolean := false;
  v_assign      jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'No user supplied' USING ERRCODE = '22004';
  END IF;

  -- Institution comes from profiles, the same source is_institution_admin uses,
  -- so the authority check and the row we write can never disagree.
  SELECT p.institution_id, p.full_name
  INTO v_inst, v_target_name
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'That account is not attached to an institution yet.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (public.is_institution_admin(v_actor, v_inst) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'You do not have permission to grant roles here.'
      USING ERRCODE = '42501';
  END IF;

  -- A teacher role with no class_assignments is inert: teacher_controls_student
  -- requires subject_id IS NOT NULL, so the account would have no students, no
  -- roster and no exams. Refuse rather than create a broken-looking teacher.
  IF jsonb_array_length(COALESCE(_pairs, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Pick at least one class and subject. A teacher with no assignments cannot see any students.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.user_roles (user_id, role, institution_id, granted_by)
  VALUES (_user_id, 'teacher'::app_role, v_inst, v_actor)
  ON CONFLICT (user_id, role, institution_id) DO NOTHING;

  v_granted := FOUND;

  -- Delegate the teaching rows. That RPC holds the per-user advisory lock,
  -- upserts subject_class_group_mappings so the fanout trigger keeps the §22
  -- dual-table invariant, and logs its own audit delta.
  v_assign := public.set_staff_class_assignments(
    _user_id, _pairs, 'teacher'::app_role, NULL, 'subject'
  );

  PERFORM public.log_audit_event(
    'teacher_role_granted',
    'user',
    _user_id,
    v_target_name,
    '{}'::jsonb,
    jsonb_build_object('role', 'teacher', 'institution_id', v_inst),
    jsonb_build_object(
      'institution_id',   v_inst,
      'granted_by',       v_actor,
      'role_row_created', v_granted,
      'added_count',      COALESCE((v_assign->>'added_count')::int, 0)
    )
  );

  RETURN jsonb_build_object(
    'granted',       v_granted,
    'added_count',   COALESCE((v_assign->>'added_count')::int, 0),
    'removed_count', COALESCE((v_assign->>'removed_count')::int, 0)
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.revoke_teacher_role(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_inst        uuid;
  v_target_name text;
  v_other       int;
  v_subject     jsonb;
  v_bare        jsonb;
  v_removed     int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT p.institution_id, p.full_name
  INTO v_inst, v_target_name
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'That account is not attached to an institution yet.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (public.is_institution_admin(v_actor, v_inst) OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'You do not have permission to change roles here.'
      USING ERRCODE = '42501';
  END IF;

  -- Never strand an account with no role at all.
  SELECT count(*) INTO v_other
  FROM public.user_roles ur
  WHERE ur.user_id = _user_id AND ur.role <> 'teacher'::app_role;

  IF v_other = 0 THEN
    RAISE EXCEPTION 'This is their only role. Removing it would leave the account with no access.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Clear the teaching rows in the same transaction, both kinds: subject rows
  -- carry the authority, bare rows are the pastoral class-teacher links. Every
  -- DELETE lands in class_assignment_deletions via its AFTER DELETE trigger, so
  -- this stays reversible.
  v_subject := public.set_staff_class_assignments(
    _user_id, '[]'::jsonb, 'teacher'::app_role, NULL, 'subject'
  );
  v_bare := public.set_staff_class_assignments(
    _user_id, '[]'::jsonb, 'teacher'::app_role, NULL, 'bare'
  );

  v_removed := COALESCE((v_subject->>'removed_count')::int, 0)
             + COALESCE((v_bare->>'removed_count')::int, 0);

  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role = 'teacher'::app_role
    AND institution_id = v_inst;

  PERFORM public.log_audit_event(
    'teacher_role_revoked',
    'user',
    _user_id,
    v_target_name,
    jsonb_build_object('role', 'teacher', 'institution_id', v_inst),
    '{}'::jsonb,
    jsonb_build_object(
      'institution_id',      v_inst,
      'revoked_by',          v_actor,
      'assignments_removed', v_removed
    )
  );

  RETURN jsonb_build_object(
    'granted',       false,
    'added_count',   0,
    'removed_count', v_removed
  );
END;
$$;


-- Supabase default privileges grant EXECUTE to anon on every new public
-- function, and REVOKE FROM PUBLIC does NOT strip it (CLAUDE.md §26).
REVOKE ALL ON FUNCTION public.grant_teacher_role(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_teacher_role(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_teacher_role(uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_teacher_role(uuid)       FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_teacher_role(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_teacher_role(uuid)       TO authenticated;
