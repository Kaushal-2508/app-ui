-- ============================================================================
-- Carry one ticket across the reporting cutoff.
--
-- The 2026-09-28 reset (20260928120000) started the Support Inbox counting from
-- a date. Two Alliance tickets were live and unanswered at that moment and fell
-- outside it. One has since been resolved; the other, Rosy Sharma's "Selection
-- of number of teachers in one go" (in progress since 2026-09-25), still needs
-- an answer, and Tushar asked for that one back in the inbox.
--
-- A per-ticket flag, NOT a looser cutoff. Moving stats_since back to 09-25
-- would also drag in every other ticket created since, including a closed
-- Product Testing School one, and would silently change what the cards mean.
-- `pinned_to_inbox` says the one thing that is actually true: this ticket
-- belongs to the current period no matter when it was raised.
--
-- The flag is additive everywhere the cutoff is read, so a pinned ticket shows
-- in the cards, the tab badges, the list, the board and the turnaround cohorts
-- as though it had been raised after the reset. Unpin by setting it false;
-- nothing else has to change.
--
-- Idempotent: safe to re-apply.
-- ============================================================================

ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS pinned_to_inbox boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reported_issues.pinned_to_inbox IS
  'Carries this ticket across the Support Inbox reporting cutoff (support_settings.stats_since): it counts and lists as though raised after the reset. Used for live work that must not be lost when the counts restart.';

-- Rosy Sharma, Alliance International School, in progress since 2026-09-25.
-- Matched on id AND subject so a recycled id can never pin the wrong ticket.
UPDATE public.reported_issues
SET pinned_to_inbox = true
WHERE id = 'ba2d1c30-f45a-4a44-b5e5-08aed74cefac'
  AND subject = 'Selection of number of teachers in one go';

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
      AND (v_since IS NULL OR ri2.created_at >= v_since OR ri2.pinned_to_inbox)
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
    WHERE (v_since IS NULL OR ri.created_at >= v_since OR ri.pinned_to_inbox)
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
  WHERE (v_since IS NULL OR created_at >= v_since OR pinned_to_inbox)
    AND (p_institution_id IS NULL OR institution_id = p_institution_id)
    AND (p_role IS NULL OR reporter_role = p_role);

  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) TO authenticated, service_role;

DO $verify$
DECLARE r record; v_pinned int;
BEGIN
  SELECT count(*) INTO v_pinned FROM public.reported_issues WHERE pinned_to_inbox;
  IF v_pinned <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 pinned ticket, found %.', v_pinned;
  END IF;

  FOR r IN SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('support_inbox_stats','support_inbox_counts')
  LOOP
    IF pg_get_functiondef(r.oid) NOT LIKE '%pinned_to_inbox%' THEN
      RAISE EXCEPTION '% does not honour the pin.', r.proname;
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on %.', r.proname;
    END IF;
  END LOOP;
END
$verify$;
