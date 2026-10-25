-- Final piece of the 2026-08-07 assignment-loss hardening.
--
-- (1) set_class_teachers — the class-level "Assign Teachers" screen used to
--     DELETE every teacher row for the class (all teachers, ALL subjects) and
--     re-insert the ticked teachers as subject-less rows. One save silently
--     destroyed the whole class's teacher-subject map and downgraded the
--     survivors to bare rows. It now diffs, keeps existing subject links for
--     teachers that stay, and audits.
--
-- (2) class_assignment_deletions — a permanent forensic + restore ledger.
--     The 2026-08-07 incident could not be attributed because the deleted rows
--     carried the only authorship column (assigned_by) and nothing logged the
--     delete. Every DELETE on class_assignments now records the full row, the
--     actor and the timestamp, whatever the path (client, RPC, SQL, cascade).
--     Recovering a wiped teacher becomes:
--       INSERT INTO class_assignments (user_id, class_id, subject_id, role)
--       SELECT user_id, class_id, subject_id, role
--       FROM class_assignment_deletions
--       WHERE user_id = '<uuid>' AND deleted_at > now() - interval '30 days'
--       ON CONFLICT (user_id, class_id, subject_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Deletion ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_assignment_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  class_id uuid NOT NULL,
  subject_id uuid,
  role app_role NOT NULL,
  institution_id uuid,
  teaching_type text,
  assigned_by uuid,
  assigned_at timestamptz,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

-- No FKs on purpose: rows must survive the cascade that deleted them
-- (class or profile removal) so a mistaken class delete stays recoverable.
CREATE INDEX IF NOT EXISTS cad_user_deleted_idx ON public.class_assignment_deletions(user_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS cad_class_deleted_idx ON public.class_assignment_deletions(class_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS cad_institution_deleted_idx ON public.class_assignment_deletions(institution_id, deleted_at DESC);

ALTER TABLE public.class_assignment_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cad_admin_read ON public.class_assignment_deletions;
CREATE POLICY cad_admin_read ON public.class_assignment_deletions
  FOR SELECT TO authenticated
  USING (
    has_role((select auth.uid()), 'super_admin'::app_role)
    OR has_role_at_institution((select auth.uid()), 'school_admin'::app_role, institution_id)
    OR has_role_at_institution((select auth.uid()), 'super_school_admin'::app_role, institution_id)
  );
-- Writes come only from the SECURITY DEFINER trigger below; no client policy.

CREATE OR REPLACE FUNCTION public.log_class_assignment_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.class_assignment_deletions (
      assignment_id, user_id, class_id, subject_id, role, institution_id,
      teaching_type, assigned_by, assigned_at, deleted_by
    ) VALUES (
      OLD.id, OLD.user_id, OLD.class_id, OLD.subject_id, OLD.role,
      (SELECT c.institution_id FROM classes c WHERE c.id = OLD.class_id),
      OLD.teaching_type, OLD.assigned_by, OLD.assigned_at, auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Forensics must never block a legitimate delete.
    NULL;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_class_assignment_deletion ON public.class_assignments;
CREATE TRIGGER trg_log_class_assignment_deletion
  AFTER DELETE ON public.class_assignments
  FOR EACH ROW EXECUTE FUNCTION public.log_class_assignment_deletion();

-- ---------------------------------------------------------------------------
-- 2. set_class_teachers — class-scoped teacher roster, subject-links preserved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_class_teachers(
  _class_id uuid,
  _teacher_ids uuid[] DEFAULT ARRAY[]::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_institution uuid;
  v_class_name text;
  v_ids uuid[] := COALESCE(_teacher_ids, ARRAY[]::uuid[]);
  v_bad int;
  v_removed jsonb := '[]'::jsonb;
  v_removed_n int := 0;
  v_added_n int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT get_class_institution(c.id), trim(c.name || ' ' || COALESCE(c.section, ''))
  INTO v_institution, v_class_name
  FROM classes c WHERE c.id = _class_id;

  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'That class no longer exists.';
  END IF;

  IF NOT (
    has_role(v_caller, 'super_admin'::app_role)
    OR has_role_at_institution(v_caller, 'school_admin'::app_role, v_institution)
    OR has_role_at_institution(v_caller, 'super_school_admin'::app_role, v_institution)
    OR (has_role(v_caller, 'coordinator'::app_role) AND is_coordinator_for_class(v_caller, _class_id))
    OR (has_role(v_caller, 'coordinator'::app_role) AND get_user_institution(v_caller) = v_institution)
    OR (is_staff_manager(v_caller) AND get_user_institution(v_caller) = v_institution)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to manage this class''s teachers.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('class_teachers:' || _class_id::text, 0));

  SELECT count(*) INTO v_bad
  FROM unnest(v_ids) AS t(id)
  WHERE NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = t.id AND p.institution_id = v_institution
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% selected teacher(s) do not belong to this school.', v_bad;
  END IF;

  -- Unassigned teachers lose every row they hold on this class (that IS the
  -- intent of unticking them), and it is now confirmed, audited and ledgered.
  WITH del AS (
    DELETE FROM class_assignments ca
    WHERE ca.class_id = _class_id
      AND ca.role = 'teacher'::app_role
      AND NOT (ca.user_id = ANY(v_ids))
    RETURNING ca.user_id, ca.subject_id
  )
  SELECT count(*)::int,
         COALESCE(jsonb_agg(DISTINCT jsonb_build_object('user_id', d.user_id, 'teacher', p.full_name)), '[]'::jsonb)
  INTO v_removed_n, v_removed
  FROM del d LEFT JOIN profiles p ON p.id = d.user_id;

  -- Teachers who stay keep their existing subject rows untouched; only a
  -- teacher with NO row on this class gets a new subject-less placeholder.
  WITH ins AS (
    INSERT INTO class_assignments (user_id, class_id, subject_id, role, assigned_by)
    SELECT t.id, _class_id, NULL, 'teacher'::app_role, v_caller
    FROM unnest(v_ids) AS t(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM class_assignments ca
      WHERE ca.class_id = _class_id AND ca.role = 'teacher'::app_role AND ca.user_id = t.id
    )
    RETURNING 1
  )
  SELECT count(*)::int INTO v_added_n FROM ins;

  IF v_removed_n > 0 OR v_added_n > 0 THEN
    PERFORM log_audit_event(
      'class_teachers_updated', 'Class', _class_id, v_class_name,
      jsonb_build_object('removed', v_removed),
      jsonb_build_object('added_count', v_added_n),
      jsonb_build_object('institution_id', v_institution::text,
                         'removed_rows', v_removed_n, 'added_rows', v_added_n)
    );
  END IF;

  RETURN jsonb_build_object(
    'removed_count', v_removed_n,
    'added_count', v_added_n,
    'removed', v_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_class_teachers(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_class_teachers(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_class_teachers(uuid, uuid[]) TO authenticated;
