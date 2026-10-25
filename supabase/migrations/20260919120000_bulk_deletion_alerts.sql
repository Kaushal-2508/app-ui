-- Bulk deletion alerts.
-- Design: docs/superpowers/specs/2026-09-19-bulk-deletion-alerts-design.md
--
-- Watches the audit ledgers and opens an "incident" when someone deletes a lot of
-- things, or deletes one very important thing. Read-only with respect to everything
-- it watches: nothing here sits on the delete path, so an alert can never slow or
-- abort a deletion.

-- ---------------------------------------------------------------------------
-- 1. Incident table: dedup key + permanent record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletion_alert_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule              text NOT NULL CHECK (rule IN ('burst', 'roster', 'sensitive')),
  actor_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- actor_id is NULL for cron/service-role/cascade deletions. A partial unique
  -- index cannot dedup NULLs, so carry a non-null key alongside it.
  actor_key         uuid NOT NULL,
  actor_name        text,
  institution_id    uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  institution_name  text,
  entity_types      text[] NOT NULL DEFAULT '{}',
  sample_names      text[] NOT NULL DEFAULT '{}',
  event_count       integer NOT NULL DEFAULT 0,
  first_event_at    timestamptz NOT NULL,
  last_event_at     timestamptz NOT NULL,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  notified_at       timestamptz,
  notify_error      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One open incident per (rule, actor). This is the whole dedup story: a continuous
-- deletion spree extends this row instead of opening a second one.
CREATE UNIQUE INDEX IF NOT EXISTS deletion_alert_open_idx
  ON public.deletion_alert_incidents (rule, actor_key)
  WHERE closed_at IS NULL;

-- Every FK gets an index in the same migration (CLAUDE.md section 23).
CREATE INDEX IF NOT EXISTS deletion_alert_actor_idx
  ON public.deletion_alert_incidents (actor_id);
CREATE INDEX IF NOT EXISTS deletion_alert_institution_idx
  ON public.deletion_alert_incidents (institution_id);
CREATE INDEX IF NOT EXISTS deletion_alert_pending_idx
  ON public.deletion_alert_incidents (opened_at DESC)
  WHERE notified_at IS NULL;

ALTER TABLE public.deletion_alert_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins read deletion alerts" ON public.deletion_alert_incidents;
CREATE POLICY "Super admins read deletion alerts"
  ON public.deletion_alert_incidents FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));

-- No INSERT/UPDATE/DELETE policy on purpose: only the SECURITY DEFINER scan and the
-- service-role edge function write here.
REVOKE ALL ON public.deletion_alert_incidents FROM anon;

COMMENT ON TABLE public.deletion_alert_incidents IS
  'One row per bulk-deletion incident. Opened by sec_scan_deletion_alerts(), emailed by the deletion-alert-pass edge function.';

-- ---------------------------------------------------------------------------
-- 2. Which entity types count toward the burst rule
-- ---------------------------------------------------------------------------
-- Accounts and structural objects only. Content deletions (Chapter, Study material,
-- Question, Task, Homework, ...) are routine teacher work and would bury the signal:
-- chapters alone saw 257 deletions by 28 people in 90 days.
--
-- 'Role' is deliberately absent. role_deleted rows are a cascade side effect of
-- deleting a user, always carry actor_id = NULL, and arrive one per user. Counting
-- them would double every account deletion and collapse every unrelated NULL-actor
-- event into one bucket. The sensitive rule still reads them, for the role name.
CREATE OR REPLACE FUNCTION public.sec_watched_delete_entity_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'user', 'institution', 'Class', 'Class section',
    'Subject', 'Subject mapping', 'Exam', 'Wing'
  ]::text[];
$$;

REVOKE EXECUTE ON FUNCTION public.sec_watched_delete_entity_types() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sec_watched_delete_entity_types() FROM anon;
GRANT  EXECUTE ON FUNCTION public.sec_watched_delete_entity_types() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The scan
-- ---------------------------------------------------------------------------
-- Closes stale incidents, opens or extends live ones, returns what still needs an
-- email. Idempotent: running it twice in a row opens nothing new.
CREATE OR REPLACE FUNCTION public.sec_scan_deletion_alerts(
  -- NULL means now(). An explicit time replays a historical window, which is how
  -- the thresholds in the design doc were verified against real incidents.
  _as_of timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id               uuid,
  rule             text,
  actor_name       text,
  institution_name text,
  entity_types     text[],
  sample_names     text[],
  event_count      integer,
  first_event_at   timestamptz,
  last_event_at    timestamptz,
  actor_id         uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window    interval := interval '10 minutes';
  v_cooldown  interval := interval '60 minutes';
  v_burst     integer  := 10;   -- accounts + structural objects
  v_roster    integer  := 25;   -- class_assignments churn legitimately more
  v_zero      uuid     := '00000000-0000-0000-0000-000000000000';
  v_now       timestamptz := COALESCE(_as_of, now());
BEGIN
  -- (a) Close anything quiet for the cooldown. If the same actor starts deleting
  -- again later, a fresh incident opens and emails again, which is the correct
  -- signal: it means it is still going.
  -- Alias and qualify: this function's RETURNS TABLE columns are also PL/pgSQL
  -- variables, so a bare last_event_at here is ambiguous (42702).
  UPDATE public.deletion_alert_incidents AS i
     SET closed_at = v_now
   WHERE i.closed_at IS NULL
     AND i.last_event_at < v_now - v_cooldown;

  -- (b) Candidate breaches in the trailing window, one row per (rule, actor).
  -- ON COMMIT DROP alone is not enough: two calls inside ONE transaction would
  -- hit "relation _hits already exists". Production calls this once per request,
  -- but replaying several historical windows in one batch does not.
  DROP TABLE IF EXISTS _hits;
  CREATE TEMP TABLE _hits ON COMMIT DROP AS
  WITH audit_burst AS (
    SELECT
      'burst'::text                                   AS rule,
      a.actor_id,
      COALESCE(a.actor_id, v_zero)                    AS actor_key,
      NULLIF(a.metadata ->> 'institution_id', '')::uuid AS institution_id,
      count(*)                                        AS n,
      min(a.created_at)                               AS t0,
      max(a.created_at)                               AS t1,
      array_agg(DISTINCT a.entity_type)               AS types,
      (array_agg(a.entity_name ORDER BY a.created_at)
         FILTER (WHERE a.entity_name IS NOT NULL))    AS names
    FROM public.system_audit_logs a
    WHERE a.created_at >= v_now - v_window
      AND a.created_at <  v_now
      -- Not just '%_deleted': unassigning a subject logs
      -- 'subject_removed_from_class', and 81 of those in one window on
      -- 2026-09-04 were invisible until this pattern was widened.
      AND (a.action LIKE '%\_deleted' OR a.action LIKE '%\_removed%')
      -- Institutions are excluded here because the sensitive rule already
      -- catches them at threshold 1; counting them twice sent two emails
      -- for the single 2026-09-02 event.
      AND a.entity_type <> 'institution'
      AND a.entity_type = ANY (public.sec_watched_delete_entity_types())
    GROUP BY 1, 2, 3, 4
    HAVING count(*) >= v_burst
  ),
  roster AS (
    SELECT
      'roster'::text                        AS rule,
      d.deleted_by                          AS actor_id,
      COALESCE(d.deleted_by, v_zero)        AS actor_key,
      d.institution_id,
      count(*)                              AS n,
      min(d.deleted_at)                     AS t0,
      max(d.deleted_at)                     AS t1,
      ARRAY['Teacher class assignment']     AS types,
      (array_agg(DISTINCT p.full_name)
         FILTER (WHERE p.full_name IS NOT NULL)) AS names
    FROM public.class_assignment_deletions d
    LEFT JOIN public.profiles p ON p.id = d.user_id
    WHERE d.deleted_at >= v_now - v_window
      AND d.deleted_at <  v_now
      -- A NULL actor here is a cascade from deleting the user itself, which
      -- the burst rule already reports. Without this, one account spree
      -- opened both a burst AND a phantom '(system)' roster incident.
      AND d.deleted_by IS NOT NULL
    GROUP BY 1, 2, 3, 4
    HAVING count(*) >= v_roster
  ),
  sensitive AS (
    -- Threshold 1. An institution, or an account that held real authority.
    SELECT
      'sensitive'::text                                 AS rule,
      a.actor_id,
      COALESCE(a.actor_id, v_zero)                      AS actor_key,
      NULLIF(a.metadata ->> 'institution_id', '')::uuid AS institution_id,
      count(*)                                          AS n,
      min(a.created_at)                                 AS t0,
      max(a.created_at)                                 AS t1,
      array_agg(DISTINCT
        CASE WHEN a.entity_type = 'institution' THEN 'institution'
             ELSE 'admin role: ' || COALESCE(a.old_values ->> 'role', '?') END) AS types,
      (array_agg(a.entity_name ORDER BY a.created_at)
         FILTER (WHERE a.entity_name IS NOT NULL))      AS names
    FROM public.system_audit_logs a
    WHERE a.created_at >= v_now - v_window
      AND a.created_at <  v_now
      AND (a.action LIKE '%\_deleted' OR a.action LIKE '%\_removed%')
      AND (
        a.entity_type = 'institution'
        OR (a.entity_type = 'Role'
            AND a.old_values ->> 'role' IN ('school_admin', 'super_school_admin', 'super_admin'))
      )
    GROUP BY 1, 2, 3, 4
  )
  SELECT * FROM audit_burst
  UNION ALL SELECT * FROM roster
  UNION ALL SELECT * FROM sensitive;

  -- (c) Extend whatever is already open.
  --
  -- event_count is RECOMPUTED from the incident's own start, never accumulated.
  -- The scan runs every 5 minutes over a 10-minute window, so consecutive passes
  -- see the same rows twice; adding h.n each pass would roughly double the
  -- reported total. The cooldown bounds this scan to about an hour of rows.
  UPDATE public.deletion_alert_incidents i
     SET last_event_at = GREATEST(i.last_event_at, h.t1),
         event_count   = CASE i.rule
           WHEN 'roster' THEN (
             SELECT count(*)::integer
               FROM public.class_assignment_deletions d
              WHERE d.deleted_at >= i.first_event_at
                AND ((i.actor_id IS NOT NULL AND d.deleted_by = i.actor_id)
                  OR (i.actor_id IS NULL     AND d.deleted_by IS NULL)))
           ELSE (
             SELECT count(*)::integer
               FROM public.system_audit_logs a
              WHERE a.created_at >= i.first_event_at
                AND (a.action LIKE '%\_deleted' OR a.action LIKE '%\_removed%')
                AND a.entity_type = ANY (public.sec_watched_delete_entity_types())
                AND ((i.actor_id IS NOT NULL AND a.actor_id = i.actor_id)
                  OR (i.actor_id IS NULL     AND a.actor_id IS NULL)))
         END,
         entity_types  = ARRAY(SELECT DISTINCT unnest(i.entity_types || h.types)),
         sample_names  = ARRAY(SELECT DISTINCT unnest(i.sample_names || COALESCE(h.names, '{}'::text[])))
    FROM _hits h
   WHERE i.closed_at IS NULL
     AND i.rule = h.rule
     AND i.actor_key = h.actor_key;

  -- (d) Open incidents for breaches with nothing open. ON CONFLICT makes a
  -- concurrent pass a no-op rather than a duplicate-key error.
  INSERT INTO public.deletion_alert_incidents (
    rule, actor_id, actor_key, actor_name, institution_id, institution_name,
    entity_types, sample_names, event_count, first_event_at, last_event_at
  )
  SELECT
    h.rule, h.actor_id, h.actor_key,
    COALESCE(p.full_name, p.email, '(system)'),
    h.institution_id,
    inst.name,
    h.types,
    COALESCE(h.names[1:10], '{}'::text[]),
    h.n,
    h.t0,
    h.t1
  FROM _hits h
  LEFT JOIN public.profiles p      ON p.id = h.actor_id
  LEFT JOIN public.institutions inst ON inst.id = h.institution_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.deletion_alert_incidents i
     WHERE i.closed_at IS NULL AND i.rule = h.rule AND i.actor_key = h.actor_key
  )
  ON CONFLICT DO NOTHING;

  -- (e) Hand back everything still owed an email, oldest first.
  RETURN QUERY
  SELECT i.id, i.rule, i.actor_name, i.institution_name, i.entity_types,
         i.sample_names[1:10], i.event_count, i.first_event_at, i.last_event_at,
         i.actor_id
    FROM public.deletion_alert_incidents i
   WHERE i.notified_at IS NULL
   ORDER BY i.opened_at
   LIMIT 20;
END
$$;

-- Supabase grants EXECUTE to anon on every new public function, and REVOKE FROM
-- PUBLIC does not strip it. Both, by name (CLAUDE.md section 26).
REVOKE EXECUTE ON FUNCTION public.sec_scan_deletion_alerts(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sec_scan_deletion_alerts(timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sec_scan_deletion_alerts(timestamptz) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.sec_scan_deletion_alerts(timestamptz) TO service_role;

COMMENT ON FUNCTION public.sec_scan_deletion_alerts(timestamptz) IS
  'Opens/extends bulk-deletion incidents and returns those still needing an email. Service role only; called by the deletion-alert-pass edge function every 5 minutes.';

-- ---------------------------------------------------------------------------
-- 4. Mark an incident emailed (or record why it failed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sec_mark_deletion_alert_sent(
  _incident_id uuid,
  _error       text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.deletion_alert_incidents
     SET notified_at  = CASE WHEN _error IS NULL THEN now() ELSE NULL END,
         notify_error = _error
   WHERE id = _incident_id;
$$;

REVOKE EXECUTE ON FUNCTION public.sec_mark_deletion_alert_sent(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sec_mark_deletion_alert_sent(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sec_mark_deletion_alert_sent(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.sec_mark_deletion_alert_sent(uuid, text) TO service_role;
