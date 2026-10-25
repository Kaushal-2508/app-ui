-- ---------------------------------------------------------------------------
-- 2. Authority helpers
--
-- Both ticket helpers are SECURITY DEFINER so that no RLS policy ever inlines a
-- cross-table EXISTS against reported_issues, which is the 42P17 recursion trap
-- (CLAUDE.md section 23).
--
-- is_uuid exists for the phase 6 storage policies. A bare
-- (storage.foldername(name))[1]::uuid raises 22P02 on any object whose path
-- does not start with a uuid, which surfaces as a hard storage failure instead
-- of a denial. The coalesce keeps it strictly boolean so AND short-circuit
-- ordering does the right thing, and it is IMMUTABLE PARALLEL SAFE so it can be
-- evaluated per row cheaply.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_uuid(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    false
  )
$$;

COMMENT ON FUNCTION public.is_uuid(text) IS
  'True when the text is a uuid. Guards ::uuid casts in storage policies, where a 22P02 would be a hard failure rather than a denial.';

-- A NULL reporter_id (a deleted user, see section 4) never equals auth.uid(),
-- so this fails closed by construction.
CREATE OR REPLACE FUNCTION public.is_support_ticket_reporter(p_ticket uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reported_issues
    WHERE id = p_ticket
      AND reporter_id = auth.uid()
  )
$$;

COMMENT ON FUNCTION public.is_support_ticket_reporter(uuid) IS
  'True when the caller filed this support ticket. SECURITY DEFINER so RLS policies never inline a cross-table EXISTS.';

CREATE OR REPLACE FUNCTION public.can_access_support_ticket(p_ticket uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(auth.uid())
      OR public.is_support_ticket_reporter(p_ticket)
$$;

COMMENT ON FUNCTION public.can_access_support_ticket(uuid) IS
  'Read authority on a support ticket: any super admin, or the reporter. Authority is is_super_admin, not the configured support owner, so a second SALCI person is never locked out.';

-- Supabase ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new public
-- function, and REVOKE ... FROM PUBLIC does NOT strip that explicit anon grant;
-- revoking anon by name does not strip the PUBLIC grant either. BOTH are
-- required (the 20260814150000 post-mortem). authenticated must keep EXECUTE:
-- the policies below and the storage policies in phase 6 call these as the
-- querying user.
REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_uuid(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated, service_role;
