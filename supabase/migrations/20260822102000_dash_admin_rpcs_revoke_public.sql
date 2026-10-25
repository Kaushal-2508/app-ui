-- Close anon EXECUTE on the dashboard RPCs this branch added or changed.
--
-- CLAUDE.md's rule is "REVOKE ... FROM anon BY NAME", and each of these
-- migrations did exactly that -- yet has_function_privilege('anon', oid,
-- 'EXECUTE') is still true for every one of them. The carrier is the separate
-- grant to PUBLIC that Supabase's ALTER DEFAULT PRIVILEGES also creates: anon
-- is a member of PUBLIC, so revoking the named grant leaves the inherited one
-- untouched. Revoking PUBLIC is the part that actually closes the door.
--
-- Every function below is re-granted to authenticated in the same statement
-- pair, so the only privilege that changes is anon's.
--
-- SCOPE: only functions created or modified on this branch. 50 dash_* routines
-- are anon-executable platform-wide, including four that WRITE
-- (dash_create_task_from_flag, dash_reassign_flag_task, dash_cancel_flag_task,
-- dash_evaluate_flags). They all fail at dash_resolve_institution() for a
-- caller with no auth.uid(), so this is depth rather than an open door, but the
-- sweep is a separate decision from a dashboard change.
BEGIN;

DO $$
DECLARE
  _sig text;
  _sigs text[] := ARRAY[
    'public.dash_admin_roster_counts(uuid)',
    'public.dash_student_portal_adoption(uuid, integer)',
    'public.dash_wing_performance(uuid)',
    'public.dash_attendance_compliance(uuid, integer)',
    'public.dash_recent_events(uuid, integer)',
    'public.dash_admin_digest(uuid)',
    'public.dash_school_subject_performance(uuid)',
    'public.dash_class_performance(uuid)',
    'public.dash_students_in_band(text, integer, numeric, uuid, uuid)',
    'public.dash_exam_trend(integer, uuid)',
    'public.dash_attendance_trend(integer, uuid, uuid)'
  ];
BEGIN
  FOREACH _sig IN ARRAY _sigs LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', _sig);
  END LOOP;
END $$;

COMMIT;
