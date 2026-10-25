BEGIN;

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

REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_uuid(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated, service_role;

-- Behavioural smoke test while the functions exist, inside the transaction.
-- auth.uid() is NULL on a Management API connection, so the reporter helper
-- must return false, never NULL and never an error.
SELECT
  public.is_uuid('11111111-2222-3333-4444-555555555555') AS uuid_true,
  public.is_uuid('avatars')                              AS uuid_false,
  public.is_uuid(NULL)                                   AS uuid_null_is_false,
  public.is_support_ticket_reporter(
    (SELECT id FROM public.reported_issues ORDER BY created_at LIMIT 1))
                                                         AS reporter_false_for_nobody;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('is_uuid','is_support_ticket_reporter','can_access_support_ticket'))
         = 0 AS rolled_back_clean;
