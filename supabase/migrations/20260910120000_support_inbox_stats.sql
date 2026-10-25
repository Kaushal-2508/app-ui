-- ============================================================================
-- support_inbox_stats(): one server-side read behind the three Support Inbox
-- cards on /admin/issues (Open, In Progress, Resolved with Closed as a footnote).
--
-- Companion to support_inbox_counts(), which stays as it is for the Awaiting
-- SALCI chip (scoped to the ACTIVE tab, so its query key carries the tab). The
-- cards AND the tab badges read this function, so the two can never disagree
-- after a tab switch; it has no p_status argument and its key is
-- (institution, role) only, so a tab switch never refetches it.
--
-- LOAD-BEARING PREDICATES
--   * resolved_7d, resolve_median_hours_30d and resolve_sample_30d carry
--     AND status = 'resolved'. _support_apply_status stamps
--     resolved_at = coalesce(resolved_at, now()) for BOTH 'resolved' and
--     'closed', so without the predicate the 2026-08-31 bulk open-to-closed
--     cleanup reads as 32 resolutions. Accepted consequence: a ticket that was
--     resolved and later closed drops out of the Resolved figures. The clean fix,
--     if ever wanted, is a real closed_at column stamped inside
--     _support_apply_status; then resolved_* can count across both statuses and
--     Closed can honestly show "this week".
--   * in_progress_quiet_72h reads coalesce(last_message_at, created_at) and
--     NEVER updated_at: update_reported_issues_updated_at bumps updated_at on
--     every read stamp, so a stale ticket would un-stale the moment SALCI opened it.
--   * Windows are rolling (now() - interval), in UTC, on purpose. The inbox spans
--     schools and has no institution timezone, so CLAUDE.md section 24 does not
--     apply; a calendar "today" line would have to pick an explicit zone first.
--   * The school-concentration figure comes from a LIMIT 1 CTE read through
--     SCALAR subqueries, never a join: if a later edit widens the LIMIT, Postgres
--     raises 'more than one row returned by a subquery' instead of silently
--     multiplying every aggregate in the SELECT (a LATERAL join had that hazard).
--
-- reported_issues is 54 rows today; no new index. Past tens of thousands, add
-- (status, institution_id) and (status, resolved_at) in a later migration.
--
-- Idempotent: safe to re-apply.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.support_inbox_stats(
  p_institution_id uuid DEFAULT NULL,
  p_role           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  WITH top AS (
    SELECT ri2.institution_name, count(*) AS c
    FROM public.reported_issues ri2
    WHERE ri2.status = 'open'
      AND (p_institution_id IS NULL OR ri2.institution_id = p_institution_id)
      AND (p_role IS NULL OR ri2.reporter_role = p_role)
    GROUP BY ri2.institution_id, ri2.institution_name
    ORDER BY c DESC, ri2.institution_name
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'open',        count(*) FILTER (WHERE ri.status = 'open'),
    'in_progress', count(*) FILTER (WHERE ri.status = 'in_progress'),
    'resolved',    count(*) FILTER (WHERE ri.status = 'resolved'),
    'closed',      count(*) FILTER (WHERE ri.status = 'closed'),

    'open_awaiting_salci',
      count(*) FILTER (WHERE ri.status = 'open'
                         AND ri.last_message_at > coalesce(ri.salci_last_read_at, 'epoch'::timestamptz)),
    'open_never_answered',
      count(*) FILTER (WHERE ri.status = 'open' AND ri.first_response_at IS NULL),
    'open_oldest_hours',
      round((extract(epoch FROM (now() - min(ri.created_at) FILTER (WHERE ri.status = 'open'))) / 3600)::numeric),
    'open_top_school_name',  (SELECT t.institution_name FROM top t),
    'open_top_school_count', coalesce((SELECT t.c FROM top t), 0),

    'in_progress_awaiting_salci',
      count(*) FILTER (WHERE ri.status = 'in_progress'
                         AND ri.last_message_at > coalesce(ri.salci_last_read_at, 'epoch'::timestamptz)),
    'in_progress_quiet_72h',
      count(*) FILTER (WHERE ri.status = 'in_progress'
                         AND coalesce(ri.last_message_at, ri.created_at) < now() - interval '72 hours'),
    'in_progress_oldest_hours',
      round((extract(epoch FROM (now() - min(ri.created_at) FILTER (WHERE ri.status = 'in_progress'))) / 3600)::numeric),

    'resolved_7d',
      count(*) FILTER (WHERE ri.status = 'resolved' AND ri.resolved_at >= now() - interval '7 days'),
    'resolve_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ri.resolved_at - ri.created_at)) / 3600)
             FILTER (WHERE ri.status = 'resolved' AND ri.resolved_at >= now() - interval '30 days'))::numeric),
    'resolve_sample_30d',
      count(*) FILTER (WHERE ri.status = 'resolved' AND ri.resolved_at >= now() - interval '30 days'),
    'first_reply_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (ri.first_response_at - ri.created_at)) / 3600)
             FILTER (WHERE ri.first_response_at >= now() - interval '30 days'))::numeric),
    'first_reply_sample_30d',
      count(*) FILTER (WHERE ri.first_response_at >= now() - interval '30 days')
  )
  INTO v
  FROM public.reported_issues ri
  WHERE (p_institution_id IS NULL OR ri.institution_id = p_institution_id)
    AND (p_role IS NULL OR ri.reporter_role = p_role);

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.support_inbox_stats(uuid, text) IS
  'Support Inbox card metrics (super admins only). resolved_* count status = ''resolved'' ONLY, because _support_apply_status stamps resolved_at on closed tickets too; quiet_72h reads coalesce(last_message_at, created_at), never updated_at. Windows are rolling UTC intervals by design.';

-- Grants: both revokes BY NAME (CLAUDE.md section 26, 20260814150000 post-mortem).
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) TO authenticated, service_role;

-- Contract check: fail loudly rather than ship a gap.
DO $verify$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'support_inbox_stats';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'support_inbox_stats was not created.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.proacl IS NULL)
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on support_inbox_stats.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lost EXECUTE on support_inbox_stats.';
  END IF;
END
$verify$;
