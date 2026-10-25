-- Close anon EXECUTE across the whole dash_* surface.
--
-- 20260822102000 did this for the eleven functions that workstream had created
-- or changed. It missed everything it had only READ from or called into, so 35
-- dash_* routines were still reachable with the publishable anon key that ships
-- in the frontend bundle -- dash_students_attention among them, which is the
-- one the admin dashboard's attention queue calls.
--
-- WHAT THIS IS AND IS NOT. Probing prod with the anon key first:
--
--   dash_kpi_summary          -> "no institution context for this user"
--   dash_students_attention   -> "no institution context for this user"
--   dash_evaluate_flags       -> "not authorized for this institution"
--   dash_create_task_from_flag-> "flag not found"
--
-- So this is NOT a live write hole. dash_create_task_from_flag looks alarming
-- because it answers a bogus id with "flag not found" rather than a refusal,
-- but its authorization is the very next line -- dash_resolve_institution on
-- the flag's own institution -- and that refuses anon. A real flag id gets
-- rejected before anything is written.
--
-- What it IS: an existence oracle (anon can tell a real flag id from a fake
-- one) and 35 functions of needless attack surface on a SECURITY DEFINER
-- surface that runs as the table owner. Neither belongs in production.
--
-- Safe by construction: all 35 already hold EXPLICIT grants to both
-- `authenticated` and `service_role` (verified via
-- information_schema.routine_privileges before writing this), so revoking the
-- PUBLIC and anon grants changes nothing for the app, the edge functions or the
-- crons. The re-GRANT to authenticated below is belt and braces.
--
-- §26: revoking anon BY NAME is not enough on its own. Supabase's default
-- privileges also grant PUBLIC, anon inherits that, and has_function_privilege
-- stays true. Revoking PUBLIC is the part that actually shuts the door.
--
-- SCOPE: the dash_* surface only. 293 SECURITY DEFINER functions are
-- anon-executable platform-wide; that sweep needs its own verification pass per
-- module and is not something to bundle into a dashboard change.
BEGIN;

DO $$
DECLARE
  _fn record;
  _sig text;
  _n int := 0;
BEGIN
  FOR _fn IN
    SELECT p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'dash%'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
     ORDER BY p.proname
  LOOP
    _sig := format('public.%I(%s)', _fn.proname, _fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', _sig);
    _n := _n + 1;
  END LOOP;

  RAISE NOTICE 'closed anon EXECUTE on % dash_* functions', _n;
END $$;

COMMIT;
