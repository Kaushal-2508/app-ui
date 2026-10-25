-- ============================================================================
-- Support Inbox reporting cutoff: the cards and the inbox count from a date,
-- and nothing is ever deleted to make a number look right.
--
-- WHY. 65 tickets had accumulated, 20 of them genuine test traffic from
-- is_demo schools and two SALCI raised against no institution at all. Tushar
-- wanted the header cards to start at zero and count forward, and said
-- explicitly: do not delete anything. So this is a reporting epoch, not a
-- purge. `support_settings.stats_since` is the one dial. Move it back and
-- every old number returns, because every old row is still there.
--
-- WHAT IT COVERS. Both inbox RPCs read the cutoff themselves, so the four
-- cards, the tab badges and the Awaiting SALCI chip can never disagree with
-- each other. The frontend applies the same cutoff to the list, the board and
-- the Turnaround card, and offers a "show earlier tickets" toggle that lifts
-- it for the list ONLY: the cards always speak for the current period.
--
-- CONSEQUENCE, ACCEPTED ON PURPOSE. Two Alliance tickets were in progress and
-- unanswered when the cutoff was set. They fall outside it and leave the
-- default inbox view. Tushar chose the full clean slate over keeping live work
-- pinned, having been told this; the toggle is how they are reached.
--
-- The cutoff is never applied to what a REPORTER sees. /support reads
-- list_my_support_tickets and get_support_thread, neither touched here, so a
-- school keeps its whole history and an old thread still answers.
--
-- Idempotent: re-applying does NOT move an existing cutoff.
-- ============================================================================

ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS stats_since timestamptz;

COMMENT ON COLUMN public.support_settings.stats_since IS
  'Support Inbox reporting cutoff. Cards, badges and the inbox list count only tickets created at or after this moment. NULL = count everything. Nothing is deleted; move it earlier to bring old numbers back.';

-- Set the epoch once, at the moment of the reset. A re-apply must not move it.
UPDATE public.support_settings
SET stats_since = now(), updated_at = now()
WHERE stats_since IS NULL;

CREATE OR REPLACE FUNCTION public.support_inbox_stats(p_institution_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_since timestamptz;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  -- The reporting cutoff. Everything the inbox shows and counts starts here.
  -- NULL means no cutoff, i.e. the whole history.
  SELECT s.stats_since INTO v_since FROM public.support_settings s LIMIT 1;

  WITH top AS (
    -- School concentration of the open backlog. LIMIT 1 read through scalar
    -- subqueries below, never a join: widening the LIMIT raises instead of
    -- silently multiplying every aggregate.
    SELECT ri2.institution_name, count(*) AS c
    FROM public.reported_issues ri2
    WHERE ri2.status = 'open'
      AND (v_since IS NULL OR ri2.created_at >= v_since)
      AND (p_institution_id IS NULL OR ri2.institution_id = p_institution_id)
      AND (p_role IS NULL OR ri2.reporter_role = p_role)
    GROUP BY ri2.institution_id, ri2.institution_name
    ORDER BY c DESC, ri2.institution_name
    LIMIT 1
  ),
  sa AS (
    -- DISTINCT so the join below can never multiply a ticket.
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'::app_role
  ),
  b AS (
    SELECT
      ri.status,
      ri.created_at,
      ri.resolved_at,
      ri.first_response_at,
      ri.last_message_at,
      ri.salci_last_read_at,
      (sa.user_id IS NULL AND NOT coalesce(i.is_demo, false))                       AS school_raised,
      (ri.status = 'resolved' AND ri.resolved_at >= now() - interval '30 days')      AS resolved_30d,
      (ri.status = 'resolved'
         AND ri.resolved_at >= now() - interval '60 days'
         AND ri.resolved_at <  now() - interval '30 days')                            AS resolved_prev_30d,
      coalesce(ri.first_response_at >= now() - interval '30 days', false)            AS replied_30d,
      extract(epoch FROM (ri.resolved_at - ri.created_at)) / 3600                     AS resolve_hours,
      extract(epoch FROM (ri.first_response_at - ri.created_at)) / 3600              AS first_reply_hours
    FROM public.reported_issues ri
    LEFT JOIN public.institutions i ON i.id = ri.institution_id
    LEFT JOIN sa ON sa.user_id = ri.reporter_id
    WHERE (v_since IS NULL OR ri.created_at >= v_since)
      AND (p_institution_id IS NULL OR ri.institution_id = p_institution_id)
      AND (p_role IS NULL OR ri.reporter_role = p_role)
  )
  SELECT jsonb_build_object(
    'open',        count(*) FILTER (WHERE b.status = 'open'),
    'in_progress', count(*) FILTER (WHERE b.status = 'in_progress'),
    'resolved',    count(*) FILTER (WHERE b.status = 'resolved'),
    'closed',      count(*) FILTER (WHERE b.status = 'closed'),

    -- Open card
    'open_awaiting_salci',
      count(*) FILTER (WHERE b.status = 'open'
                         AND b.last_message_at > coalesce(b.salci_last_read_at, 'epoch'::timestamptz)),
    'open_never_answered',
      count(*) FILTER (WHERE b.status = 'open' AND b.first_response_at IS NULL),
    'open_oldest_hours',
      round((extract(epoch FROM (now() - min(b.created_at) FILTER (WHERE b.status = 'open'))) / 3600)::numeric),
    'open_top_school_name',  (SELECT t.institution_name FROM top t),
    'open_top_school_count', coalesce((SELECT t.c FROM top t), 0),

    -- In Progress card. quiet reads last_message_at, never updated_at (bumped on read stamps).
    'in_progress_awaiting_salci',
      count(*) FILTER (WHERE b.status = 'in_progress'
                         AND b.last_message_at > coalesce(b.salci_last_read_at, 'epoch'::timestamptz)),
    'in_progress_quiet_72h',
      count(*) FILTER (WHERE b.status = 'in_progress'
                         AND coalesce(b.last_message_at, b.created_at) < now() - interval '72 hours'),
    'in_progress_oldest_hours',
      round((extract(epoch FROM (now() - min(b.created_at) FILTER (WHERE b.status = 'in_progress'))) / 3600)::numeric),

    -- Resolved card: throughput (every ticket, demo included: it is the inbox, not the stopwatch)
    'resolved_7d',
      count(*) FILTER (WHERE b.status = 'resolved' AND b.resolved_at >= now() - interval '7 days'),
    'resolved_prev_7d',
      count(*) FILTER (WHERE b.status = 'resolved'
                         AND b.resolved_at >= now() - interval '14 days'
                         AND b.resolved_at <  now() - interval '7 days'),
    -- ... and one quality line, school-raised only: resolved without a single public word.
    'resolved_no_reply_30d',
      count(*) FILTER (WHERE b.school_raised AND b.resolved_30d AND b.first_response_at IS NULL),

    -- Legacy speed keys, unfiltered cohort. Kept for one release (ship order);
    -- the 2026-09-10 frontend no longer reads them. Drop in a later migration.
    'resolve_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.resolve_hours) FILTER (WHERE b.resolved_30d))::numeric),
    'resolve_sample_30d',
      count(*) FILTER (WHERE b.resolved_30d),
    'first_reply_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.first_reply_hours) FILTER (WHERE b.replied_30d))::numeric),
    'first_reply_sample_30d',
      count(*) FILTER (WHERE b.replied_30d),

    -- Turnaround card: school-raised cohort only.
    'tat_resolve_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.resolve_hours)
             FILTER (WHERE b.school_raised AND b.resolved_30d))::numeric),
    'tat_resolve_sample_30d',
      count(*) FILTER (WHERE b.school_raised AND b.resolved_30d),
    'tat_resolve_within_7d_30d',
      count(*) FILTER (WHERE b.school_raised AND b.resolved_30d AND b.resolve_hours <= 168),
    'tat_resolve_over_14d_30d',
      count(*) FILTER (WHERE b.school_raised AND b.resolved_30d AND b.resolve_hours > 336),
    'tat_resolve_median_hours_prev_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.resolve_hours)
             FILTER (WHERE b.school_raised AND b.resolved_prev_30d))::numeric),
    'tat_resolve_sample_prev_30d',
      count(*) FILTER (WHERE b.school_raised AND b.resolved_prev_30d),
    'tat_first_reply_median_hours_30d',
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.first_reply_hours)
             FILTER (WHERE b.school_raised AND b.replied_30d))::numeric),
    'tat_first_reply_sample_30d',
      count(*) FILTER (WHERE b.school_raised AND b.replied_30d),
    'tat_first_reply_within_24h_30d',
      count(*) FILTER (WHERE b.school_raised AND b.replied_30d AND b.first_reply_hours <= 24),
    'tat_excluded_30d',
      count(*) FILTER (WHERE NOT b.school_raised AND (b.resolved_30d OR b.replied_30d)),
    'tat_institution_is_demo',
      (p_institution_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.institutions x WHERE x.id = p_institution_id AND x.is_demo))
  )
  INTO v
  FROM b;

  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_inbox_counts(p_institution_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_since timestamptz;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown support status filter.';
  END IF;

  -- The reporting cutoff. Everything the inbox shows and counts starts here.
  -- NULL means no cutoff, i.e. the whole history.
  SELECT s.stats_since INTO v_since FROM public.support_settings s LIMIT 1;

  SELECT jsonb_build_object(
    'open',           count(*) FILTER (WHERE status = 'open'),
    'in_progress',    count(*) FILTER (WHERE status = 'in_progress'),
    'resolved',       count(*) FILTER (WHERE status = 'resolved'),
    'closed',         count(*) FILTER (WHERE status = 'closed'),
    'awaiting_salci', count(*) FILTER (
                        WHERE (CASE
                                 WHEN p_status IS NULL
                                   THEN status IN ('open', 'in_progress')
                                 ELSE status = p_status
                               END)
                          AND last_message_at > coalesce(salci_last_read_at, 'epoch'::timestamptz)),
    'total',          count(*)
  )
  INTO v
  FROM public.reported_issues
  WHERE (v_since IS NULL OR created_at >= v_since)
    AND (p_institution_id IS NULL OR institution_id = p_institution_id)
    AND (p_role IS NULL OR reporter_role = p_role);

  RETURN v;
END;
$function$;

-- Grants: both revokes BY NAME (CLAUDE.md section 26, 20260814150000 post-mortem).
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) TO authenticated, service_role;

DO $verify$
DECLARE
  v_since timestamptz;
  v_oid oid;
  r record;
BEGIN
  SELECT stats_since INTO v_since FROM public.support_settings LIMIT 1;
  IF v_since IS NULL THEN
    RAISE EXCEPTION 'stats_since was not set.';
  END IF;

  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('support_inbox_stats','support_inbox_counts')
  LOOP
    IF pg_get_functiondef(r.oid) NOT LIKE '%v_since%' THEN
      RAISE EXCEPTION '% does not read the cutoff.', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on %.', r.proname;
    END IF;
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lost EXECUTE on %.', r.proname;
    END IF;
  END LOOP;
END
$verify$;
