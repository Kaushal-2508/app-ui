-- set_staff_class_assignments: atomic, audited replacement for the client-side
-- delete-then-reinsert pattern in AssignTeacherClassSubjectDialog and
-- AssignClassesDialog.
--
-- Incident 2026-08-07 (Alliance): two teachers' entire class_assignments sets
-- were silently wiped during the 07-25..07-30 assignment reorg. The old client
-- flow deleted ALL of a teacher's rows and then re-inserted the selection as a
-- second, separate request; an empty selection or a failed insert left zero
-- rows, unaudited. This RPC replaces that with a single transaction that:
--   * diffs instead of delete-all (unchanged rows keep assigned_at/assigned_by),
--   * only manages rows of the caller's declared kind (_kind 'subject' = rows
--     with subject_id, 'bare' = class-teacher/coordinator links without one),
--     so the teacher-subject dialog can never destroy bare class links and
--     vice versa,
--   * upserts the §22 class-group subject catalog (trigger fans out
--     subject_class_mappings) inside the same transaction,
--   * writes a system_audit_logs row with the exact delta,
--   * serializes concurrent saves per (user, role) via advisory lock.

CREATE OR REPLACE FUNCTION public.set_staff_class_assignments(
  _user_id uuid,
  _pairs jsonb DEFAULT '[]'::jsonb,          -- [{"class_id": uuid, "subject_id": uuid|null}, ...]
  _role app_role DEFAULT 'teacher'::app_role, -- 'teacher' | 'coordinator'
  _scope_class_ids uuid[] DEFAULT NULL,       -- limit managed classes (coordinator wing scope); NULL = whole institution
  _kind text DEFAULT 'subject'                -- 'subject' | 'bare' (which rows this call manages)
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_institution uuid;
  v_target_name text;
  v_want jsonb;
  v_bad int;
  v_removed jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_removed_n int := 0;
  v_added_n int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _role NOT IN ('teacher'::app_role, 'coordinator'::app_role) THEN
    RAISE EXCEPTION 'Unsupported role %', _role;
  END IF;
  IF _kind NOT IN ('subject', 'bare') THEN
    RAISE EXCEPTION 'Unsupported kind %', _kind;
  END IF;

  SELECT p.institution_id, p.full_name
  INTO v_institution, v_target_name
  FROM profiles p
  WHERE p.id = _user_id;

  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'Target user not found or has no institution';
  END IF;

  IF NOT (
    has_role(v_caller, 'super_admin'::app_role)
    OR has_role_at_institution(v_caller, 'school_admin'::app_role, v_institution)
    OR has_role_at_institution(v_caller, 'super_school_admin'::app_role, v_institution)
    OR (has_role(v_caller, 'coordinator'::app_role) AND get_user_institution(v_caller) = v_institution)
    OR (is_staff_manager(v_caller) AND get_user_institution(v_caller) = v_institution)
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage staff class assignments';
  END IF;

  -- Serialize concurrent saves for the same target user + role.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff_ca:' || _user_id::text || ':' || _role::text, 0));

  -- Normalize + dedupe the desired pairs.
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('class_id', x.cid, 'subject_id', x.sid)), '[]'::jsonb)
  INTO v_want
  FROM (
    SELECT (p->>'class_id')::uuid AS cid,
           NULLIF(p->>'subject_id', '')::uuid AS sid
    FROM jsonb_array_elements(COALESCE(_pairs, '[]'::jsonb)) p
  ) x
  WHERE x.cid IS NOT NULL;

  -- Kind discipline: 'subject' calls must send subject-ful pairs only,
  -- 'bare' calls must send subject-less pairs only.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_want) w
  WHERE (_kind = 'subject' AND NULLIF(w->>'subject_id', '') IS NULL)
     OR (_kind = 'bare' AND NULLIF(w->>'subject_id', '') IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Pair kind mismatch: % pair(s) do not match kind %', v_bad, _kind;
  END IF;

  -- Every desired class must belong to the target's institution and scope.
  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(v_want) w
  WHERE get_class_institution((w->>'class_id')::uuid) IS DISTINCT FROM v_institution
     OR (_scope_class_ids IS NOT NULL AND NOT ((w->>'class_id')::uuid = ANY(_scope_class_ids)));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'One or more classes are outside the allowed scope';
  END IF;

  -- Remove rows of the managed kind that are no longer wanted.
  WITH del AS (
    DELETE FROM class_assignments ca
    WHERE ca.user_id = _user_id
      AND ca.role = _role
      AND get_class_institution(ca.class_id) = v_institution
      AND (_scope_class_ids IS NULL OR ca.class_id = ANY(_scope_class_ids))
      AND ((_kind = 'subject' AND ca.subject_id IS NOT NULL)
        OR (_kind = 'bare' AND ca.subject_id IS NULL))
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_want) w
        WHERE (w->>'class_id')::uuid = ca.class_id
          AND NULLIF(w->>'subject_id', '')::uuid IS NOT DISTINCT FROM ca.subject_id
      )
    RETURNING ca.class_id, ca.subject_id
  )
  SELECT count(*)::int,
         COALESCE(jsonb_agg(jsonb_build_object(
           'class_id', d.class_id,
           'class', trim(c.name || ' ' || COALESCE(c.section, '')),
           'subject_id', d.subject_id,
           'subject', us.name)), '[]'::jsonb)
  INTO v_removed_n, v_removed
  FROM del d
  LEFT JOIN classes c ON c.id = d.class_id
  LEFT JOIN universal_subjects us ON us.id = d.subject_id;

  -- Add missing rows. Unchanged rows are untouched (assigned_at/by preserved).
  -- NOT EXISTS instead of ON CONFLICT because subject_id NULL never conflicts
  -- under the (user_id, class_id, subject_id) unique key.
  WITH ins AS (
    INSERT INTO class_assignments (user_id, class_id, subject_id, role, assigned_by)
    SELECT _user_id,
           (w->>'class_id')::uuid,
           NULLIF(w->>'subject_id', '')::uuid,
           _role,
           v_caller
    FROM jsonb_array_elements(v_want) w
    WHERE NOT EXISTS (
      SELECT 1 FROM class_assignments ca
      WHERE ca.user_id = _user_id
        AND ca.role = _role
        AND ca.class_id = (w->>'class_id')::uuid
        AND ca.subject_id IS NOT DISTINCT FROM NULLIF(w->>'subject_id', '')::uuid
    )
    RETURNING class_id, subject_id
  )
  SELECT count(*)::int,
         COALESCE(jsonb_agg(jsonb_build_object(
           'class_id', i.class_id,
           'class', trim(c.name || ' ' || COALESCE(c.section, '')),
           'subject_id', i.subject_id,
           'subject', us.name)), '[]'::jsonb)
  INTO v_added_n, v_added
  FROM ins i
  LEFT JOIN classes c ON c.id = i.class_id
  LEFT JOIN universal_subjects us ON us.id = i.subject_id;

  -- §22 dual-table invariant, group-table-first: catalog each subject at the
  -- class-group level (AFTER INSERT trigger fans out subject_class_mappings
  -- per section); section-level fallback for classes without a class_group.
  INSERT INTO subject_class_group_mappings (institution_id, class_group_id, subject_id)
  SELECT DISTINCT v_institution, c.class_group_id, NULLIF(w->>'subject_id', '')::uuid
  FROM jsonb_array_elements(v_want) w
  JOIN classes c ON c.id = (w->>'class_id')::uuid
  WHERE NULLIF(w->>'subject_id', '') IS NOT NULL
    AND c.class_group_id IS NOT NULL
  ON CONFLICT (institution_id, class_group_id, subject_id) DO NOTHING;

  INSERT INTO subject_class_mappings (institution_id, class_id, subject_id)
  SELECT DISTINCT v_institution, c.id, NULLIF(w->>'subject_id', '')::uuid
  FROM jsonb_array_elements(v_want) w
  JOIN classes c ON c.id = (w->>'class_id')::uuid
  WHERE NULLIF(w->>'subject_id', '') IS NOT NULL
    AND c.class_group_id IS NULL
  ON CONFLICT (class_id, subject_id) DO NOTHING;

  IF v_removed_n > 0 OR v_added_n > 0 THEN
    PERFORM log_audit_event(
      _role::text || '_assignments_updated',
      'user',
      _user_id,
      v_target_name,
      jsonb_build_object('removed', v_removed),
      jsonb_build_object('added', v_added),
      jsonb_build_object(
        'institution_id', v_institution,
        'role', _role,
        'kind', _kind,
        'scope_class_ids', to_jsonb(_scope_class_ids),
        'removed_count', v_removed_n,
        'added_count', v_added_n
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'removed_count', v_removed_n,
    'added_count', v_added_n,
    'removed', v_removed,
    'added', v_added
  );
END;
$$;

-- Supabase default privileges grant EXECUTE to anon on every new public
-- function, and REVOKE FROM PUBLIC does NOT strip it — revoke anon BY NAME
-- (CLAUDE.md §11), then verify via information_schema.routine_privileges.
REVOKE ALL ON FUNCTION public.set_staff_class_assignments(uuid, jsonb, app_role, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_staff_class_assignments(uuid, jsonb, app_role, uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_staff_class_assignments(uuid, jsonb, app_role, uuid[], text) TO authenticated;
