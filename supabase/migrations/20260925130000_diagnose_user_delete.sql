-- =============================================================
-- diagnose_user_delete: WHY did a user delete fail?
-- -------------------------------------------------------------
-- GoTrue reports every database failure inside auth.admin.deleteUser as
-- "Database error deleting user", so a blocked delete has shown admins
-- exactly that toast three times (2026-04-22, 09-11, 09-25), each time for
-- a different cause, each time needing someone to dig through prod.
--
-- This runs the same DELETE FROM auth.users inside a subtransaction that
-- is ALWAYS aborted (success raises a sentinel that the handler catches),
-- so the cascade is undone and nothing is written, and returns the real
-- Postgres error: sqlstate, message, constraint, table, context.
-- admin-operations calls it only after deleteUser has already failed, to
-- log the cause and show the admin a reason they can act on. The happy
-- path never calls it.
--
-- Safety:
--   * Every path through the inner block ends in an exception, so the
--     delete can never commit. A statement timeout (57014) is not caught
--     by WHEN OTHERS; it aborts the whole call, which rolls back too.
--   * service_role only. It runs a real (rolled-back) delete, so it must
--     never be reachable by anon or authenticated. EXECUTE is revoked from
--     PUBLIC, anon and authenticated by name (CLAUDE.md §26).
--   * The only outbound call a delete can queue is pg_net on
--     notifications; pg_net requests are rows, so they roll back too.
-- Same technique as scripts/probe-user-deletes.sql, for one user.
-- =============================================================

CREATE OR REPLACE FUNCTION public.diagnose_user_delete(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state text;
  v_msg text;
  v_constraint text;
  v_table text;
  v_context text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'no user id');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'user not found in auth.users');
  END IF;

  BEGIN
    DELETE FROM auth.users WHERE id = _user_id;
    RAISE EXCEPTION 'DIAGNOSE_DELETE_OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_state = RETURNED_SQLSTATE,
      v_msg = MESSAGE_TEXT,
      v_constraint = CONSTRAINT_NAME,
      v_table = TABLE_NAME,
      v_context = PG_EXCEPTION_CONTEXT;
  END;

  IF v_msg = 'DIAGNOSE_DELETE_OK' THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'sqlstate', v_state,
    'message', v_msg,
    'constraint', nullif(v_constraint, ''),
    'table', nullif(v_table, ''),
    'context', left(v_context, 1000)
  );
END;
$$;

COMMENT ON FUNCTION public.diagnose_user_delete(uuid) IS
  'Runs DELETE FROM auth.users for one user inside an always-aborted subtransaction and returns the real Postgres error (or ok). service_role only. Called by admin-operations after auth.admin.deleteUser fails. See 20260925130000.';

REVOKE EXECUTE ON FUNCTION public.diagnose_user_delete(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.diagnose_user_delete(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.diagnose_user_delete(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_user_delete(uuid) TO service_role;
