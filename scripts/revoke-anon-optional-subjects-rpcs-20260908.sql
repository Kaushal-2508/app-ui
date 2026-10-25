-- =====================================================================
-- Close anon EXECUTE on the optional-subjects RPC surface
--
-- Written : 2026-09-08
-- Contract: CLAUDE.md section 26
-- Precedent: ef9ca4a7 did exactly this for the dash_* surface on 2026-09-07.
--            That sweep did not reach optional_*; this finishes it.
--
-- WHY
-- Supabase ships an ALTER DEFAULT PRIVILEGES rule granting EXECUTE to anon on
-- every new function created in public. REVOKE ... FROM PUBLIC does NOT strip
-- it, because it is an explicit grant to the anon role. All seven functions
-- below therefore sit on the public API unauthenticated.
--
-- SEVERITY: defence in depth, NOT a live hole. Each one was checked
-- individually on 2026-09-08 and every one fails closed:
--   * the five can_*-gated ones RAISE 42501, because
--     can_manage_student_optional_choices(NULL, ...) returns false, not NULL.
--     That distinction is load bearing: had it returned NULL, "IF NOT <null>"
--     would not fire and execution would fall through to the write.
--   * my_optional_slot_choices and my_teacher_optional_week self-scope with
--     AND ... = (select auth.uid()), which matches no rows without a session.
-- So this changes no behaviour for any real caller. It removes a surface that
-- should never have existed, and stops the next guard regression from being
-- reachable anonymously.
--
-- Applies nothing until run. Apply with:
--   scripts/run-sql.ps1 -SqlFile scripts/revoke-anon-optional-subjects-rpcs-20260908.sql
-- =====================================================================

BEGIN;

-- Writers -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_student_optional_group_choices(_student uuid, _choices jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_student_optional_group_choices(_student uuid, _choices jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_student_optional_group_choices(_student uuid, _choices jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_optional_group(_class_group_id uuid, _name text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_optional_group(_class_group_id uuid, _name text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_optional_group(_class_group_id uuid, _name text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_optional_group_subject(_group_id uuid, _subject_id uuid, _member boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_optional_group_subject(_group_id uuid, _subject_id uuid, _member boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_optional_group_subject(_group_id uuid, _subject_id uuid, _member boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_optional_group(_group_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_optional_group(_group_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_optional_group(_group_id uuid) TO authenticated;

-- Readers -------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_student_optional_group_assignment(_student uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_optional_group_assignment(_student uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_student_optional_group_assignment(_student uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.my_optional_slot_choices(_class_id uuid, _academic_year text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_optional_slot_choices(_class_id uuid, _academic_year text) FROM anon;
GRANT EXECUTE ON FUNCTION public.my_optional_slot_choices(_class_id uuid, _academic_year text) TO authenticated;

REVOKE ALL ON FUNCTION public.my_teacher_optional_week(_academic_year text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_teacher_optional_week(_academic_year text) FROM anon;
GRANT EXECUTE ON FUNCTION public.my_teacher_optional_week(_academic_year text) TO authenticated;

-- Post-conditions: never commit a half-applied grant change ------------
DO $verify$
DECLARE
  fns text[] := ARRAY[
    'set_student_optional_group_choices','upsert_optional_group',
    'set_optional_group_subject','delete_optional_group',
    'get_student_optional_group_assignment','my_optional_slot_choices',
    'my_teacher_optional_week'
  ];
  stray_anon  int;
  lost_authed int;
BEGIN
  SELECT count(*) INTO stray_anon
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name = ANY (fns)
    AND grantee IN ('anon', 'PUBLIC');
  IF stray_anon > 0 THEN
    RAISE EXCEPTION 'Verify failed: % anon/PUBLIC grant(s) survived.', stray_anon;
  END IF;

  -- The app calls all seven as a signed-in user; losing this would be an outage.
  SELECT count(*) INTO lost_authed
  FROM unnest(fns) AS f(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges rp
     WHERE rp.routine_schema = 'public'
       AND rp.routine_name = f.name
       AND rp.grantee = 'authenticated'
       AND rp.privilege_type = 'EXECUTE'
  );
  IF lost_authed > 0 THEN
    RAISE EXCEPTION 'Verify failed: % function(s) lost EXECUTE for authenticated.', lost_authed;
  END IF;

  RAISE NOTICE 'Verified: 7 functions, anon and PUBLIC stripped, authenticated intact.';
END
$verify$;

COMMIT;
