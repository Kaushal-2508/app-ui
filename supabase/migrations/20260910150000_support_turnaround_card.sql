-- ============================================================================
-- Support turnaround (TAT): the fourth Support Inbox card, and institutions.is_demo.
--
-- WHAT THIS ADDS
--   1. institutions.is_demo boolean NOT NULL DEFAULT false. A demo or test school
--      SALCI runs for itself (Salci National School, Product Testing School, ...).
--      It stays a school everywhere else: its tickets are still work in the inbox
--      and still count on the Open / In Progress / Resolved cards. Only SALCI's
--      own SPEED figures leave it out, because answering your own test ticket in
--      thirty seconds is not turnaround. Toggle: Edit Institution on
--      /admin/institutions ("Demo or test school").
--   2. support_inbox_stats() grows the tat_* keys (school-raised cohort only)
--      plus two Resolved-card keys. The four pre-existing speed keys keep their
--      exact old meaning for one release so this SQL can land before the
--      frontend (CLAUDE.md section 2 ship order); drop them in a later migration
--      once nothing reads them.
--
-- CALCULATIONS (rolling UTC windows, calendar hours, medians never means)
--   school_raised   reporter is not a super admin AND the institution is not demo.
--                   The two super-admin tickets are institution-less and closed, so
--                   that half removes nothing today; the demo half removes SALCI's
--                   16 test tickets. Both halves stay: the rule is "not raised by
--                   SALCI for SALCI", whichever way it happens next.
--   time to resolve resolved_at - created_at, status = 'resolved' ONLY (closed
--                   tickets carry a resolved_at stamp too, see 20260910120000),
--                   cohort keyed on resolved_at in the window ("resolved in
--                   period"). A reopened ticket keeps its original created_at, so
--                   its lifetime spans the reopen: that is what the school lived
--                   through, and it is the right number for the reader.
--   first reply     first_response_at - created_at, cohort keyed on
--                   first_response_at in the window. first_response_at is stamped
--                   by post_support_message (a public SALCI message) and by
--                   _support_apply_status (a reporter-visible note), never by an
--                   internal note. Tickets never answered are not in this cohort
--                   (survivorship, same as every helpdesk); they are reported as
--                   "never answered" on the Open card instead.
--   prior window    the 30 days before the last 30, same predicates. The client
--                   compares only when BOTH samples are >= 5. resolved_at exists
--                   only since 2026-08-31, so the comparison is empty until October.
--   no p90          at these samples a 90th percentile is the second-slowest
--                   ticket dressed as a statistic. The tail is a real count
--                   instead: tickets that took over 14 days (an editorial
--                   constant, not an SLA; no support hours or SLA are defined).
--   tat_excluded_30d  the tickets the exclusion removed from either 30-day cohort,
--                   so the card can say "N test tickets left out" and the Resolved
--                   card's 30-day count and the Turnaround sample never look like a
--                   contradiction.
--
-- Idempotent: safe to re-apply.
-- ============================================================================

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.institutions.is_demo IS
  'SALCI-run demo or test school. Still a school everywhere (its tickets are inbox work); only SALCI turnaround figures leave it out. Toggle in Edit Institution.';

-- Seed: SALCI''s own demo and test schools as of 2026-09-10, matched on id AND
-- name so a reused id can never flag a real school. Reversible from the dialog.
UPDATE public.institutions
SET is_demo = true
WHERE is_demo = false
  AND (id, name) IN (
    ('f73c5548-fab2-4b2b-85dc-04852e87e892'::uuid, 'Salci National School'),
    ('d3673911-873c-4c4d-b35a-295b532043de'::uuid, 'Product Testing School'),
    ('fc2dfff0-97dd-4aab-aa29-536a1314b7a5'::uuid, 'Vanshika Testing School'),
    ('b3ec52ac-c431-400f-ac98-f495c0b8e1bb'::uuid, 'Olympiad Testing'),
    ('508807f9-9905-4885-9a42-be20d80d1db0'::uuid, 'New Flow Demo'),
    ('b6cee586-53c9-40d3-ad1a-1cba4c7e0357'::uuid, 'exam test 15/01'),
    ('178a54ce-d746-4003-9199-a1c83131d324'::uuid, 'Test 22/01/26'),
    ('1fe2c288-3a63-4e89-b3a5-131cd7848387'::uuid, 'test school 16-01-26 2')
  );

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
    -- School concentration of the open backlog. LIMIT 1 read through scalar
    -- subqueries below, never a join: widening the LIMIT raises instead of
    -- silently multiplying every aggregate.
    SELECT ri2.institution_name, count(*) AS c
    FROM public.reported_issues ri2
    WHERE ri2.status = 'open'
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
    WHERE (p_institution_id IS NULL OR ri.institution_id = p_institution_id)
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
$$;

COMMENT ON FUNCTION public.support_inbox_stats(uuid, text) IS
  'Support Inbox card metrics (super admins only). Counts cover every ticket; tat_* speed figures cover school-raised tickets only (reporter not a super admin, institution not is_demo). resolved_* and tat_resolve_* count status = ''resolved'' ONLY because _support_apply_status stamps resolved_at on closed tickets too; quiet_72h reads coalesce(last_message_at, created_at), never updated_at. Rolling UTC windows, calendar hours, medians. The four unprefixed speed keys are legacy and unread; drop after one release.';

-- Grants: both revokes BY NAME (CLAUDE.md section 26, 20260814150000 post-mortem).
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.support_inbox_stats(uuid, text) TO authenticated, service_role;

-- Contract check: fail loudly rather than ship a gap.
DO $verify$
DECLARE
  v_oid oid;
  v_demo int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'is_demo') THEN
    RAISE EXCEPTION 'institutions.is_demo was not added.';
  END IF;

  SELECT count(*) INTO v_demo FROM public.institutions WHERE is_demo;
  IF v_demo < 2 THEN
    RAISE EXCEPTION 'Expected at least the two ticket-bearing demo schools flagged, found %.', v_demo;
  END IF;

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
