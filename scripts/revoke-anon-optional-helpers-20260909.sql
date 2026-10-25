-- =====================================================================
-- Close PUBLIC and anon EXECUTE on the remaining optional-subjects and
-- band-scheduling function surface
--
-- Written : 2026-09-09
-- Contract: CLAUDE.md section 26; prod-operations skill section 3
-- Precedent: scripts/revoke-anon-optional-subjects-rpcs-20260908.sql closed
--            the seven client-facing RPCs (applied to prod 2026-09-09). This
--            finishes the surface: the RLS authority helpers, the trigger
--            functions and the superseded band-plane RPCs that sweep did not
--            reach. Classification below was read from pg_policies,
--            pg_trigger and prosrc call graphs on 2026-09-09, not assumed.
--
-- WHY BOTH REVOKES
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon BY NAME, and the
-- functions also carry PostgreSQL's default PUBLIC grant. REVOKE FROM PUBLIC
-- leaves the anon grant; REVOKE FROM anon leaves the PUBLIC grant, and anon is
-- a member of PUBLIC. Both are issued, then verified against pg_proc.proacl
-- (information_schema.routine_privileges does not expand PUBLIC and reads
-- clean while the function is still world-executable).
--
-- WHAT IS DELIBERATELY KEPT
--   * authenticated keeps EXECUTE on every RLS authority helper. Policies run
--     as the querying role; revoking authenticated would turn every read of
--     optional_groups, optional_group_subjects, optional_batches,
--     optional_batch_students and optional_band_slots into
--     "permission denied for function" for every user on the platform.
--   * authenticated keeps EXECUTE on the trigger functions. Trigger execution
--     does not check EXECUTE for the role performing the DML, so revoking it
--     buys nothing; keeping it removes any doubt.
--   * service_role keeps its explicit grant everywhere.
--
-- OUT OF SCOPE, ON PURPOSE
--   * oly_enrollment_is_open(uuid) matched the %enrollment% search but belongs
--     to the Olympiad module: a public "is enrollment open for this school"
--     read used by the oly-cash-enroll and oly-payment-create-order edge
--     functions. Left untouched; see the olympiad-module skill first.
--   * Audit S-1 (student_band_resolution and band_slot_batches trust their
--     _student / _band_slot argument): closing anon is defence in depth only.
--     The argument-trust hole needs an auth.uid() guard inside the bodies and
--     stays OPEN. Do not read this script as closing it.
--
-- SEVERITY: defence in depth. No behaviour changes for any real caller. Every
-- caller of these functions is Postgres itself (RLS evaluation, triggers) or an
-- authenticated session.
--
-- Apply with:
--   scripts/run-sql.ps1 -SqlFile scripts/revoke-anon-optional-helpers-20260909.sql
-- =====================================================================

BEGIN;

-- RLS authority helpers (SECURITY DEFINER, referenced by policies TO authenticated)
REVOKE ALL     ON FUNCTION public.can_manage_band_slot(_actor uuid, _band_slot uuid)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_band_slot(_actor uuid, _band_slot uuid)          TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_manage_optional_batch(_actor uuid, _batch uuid)         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_optional_batch(_actor uuid, _batch uuid)         TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_manage_optional_batches(_actor uuid, _institution uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_optional_batches(_actor uuid, _institution uuid) TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_manage_optional_group(_actor uuid, _group uuid)         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_optional_group(_actor uuid, _group uuid)         TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_manage_optional_groups(_actor uuid, _institution uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_optional_groups(_actor uuid, _institution uuid)  TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_view_band_slot(_actor uuid, _band_slot uuid)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_band_slot(_actor uuid, _band_slot uuid)            TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.can_view_optional_group(_actor uuid, _group uuid)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_view_optional_group(_actor uuid, _group uuid)           TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.optional_batch_teacher_can_see(_actor uuid, _batch uuid)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.optional_batch_teacher_can_see(_actor uuid, _batch uuid)    TO authenticated, service_role;

-- Trigger functions (fired by Postgres; not meaningfully callable over /rpc)
REVOKE ALL     ON FUNCTION public.enforce_exam_subject_enrollment()             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enforce_exam_subject_enrollment()             TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.optional_batch_student_requires_enrollment()  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.optional_batch_student_requires_enrollment()  TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.optional_enrollment_cascade_batch_removal()   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.optional_enrollment_cascade_batch_removal()   TO authenticated, service_role;

-- RPCs: two called from the authenticated client, one with no caller at all
REVOKE ALL     ON FUNCTION public.optional_subject_enrolled_students(_subject uuid, _institution uuid)              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.optional_subject_enrolled_students(_subject uuid, _institution uuid)              TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.student_band_resolution(_student uuid, _class_id uuid, _academic_year text)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.student_band_resolution(_student uuid, _class_id uuid, _academic_year text)      TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.band_slot_batches(_band_slot uuid)                                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.band_slot_batches(_band_slot uuid)                                                TO authenticated, service_role;

-- Verification: fail the transaction rather than commit a gap -----------------
DO $verify$
DECLARE
  v_open text;
  v_lost text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_open
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'can_manage_band_slot', 'can_manage_optional_batch', 'can_manage_optional_batches',
      'can_manage_optional_group', 'can_manage_optional_groups', 'can_view_band_slot',
      'can_view_optional_group', 'optional_batch_teacher_can_see',
      'enforce_exam_subject_enrollment', 'optional_batch_student_requires_enrollment',
      'optional_enrollment_cascade_batch_removal',
      'optional_subject_enrolled_students', 'student_band_resolution', 'band_slot_batches')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on: %', v_open;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_lost
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'can_manage_band_slot', 'can_manage_optional_batch', 'can_manage_optional_batches',
      'can_manage_optional_group', 'can_manage_optional_groups', 'can_view_band_slot',
      'can_view_optional_group', 'optional_batch_teacher_can_see',
      'enforce_exam_subject_enrollment', 'optional_batch_student_requires_enrollment',
      'optional_enrollment_cascade_batch_removal',
      'optional_subject_enrolled_students', 'student_band_resolution', 'band_slot_batches')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on: % (RLS would break)', v_lost;
  END IF;
END
$verify$;

COMMIT;
