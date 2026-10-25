-- ============================================================================
-- Salci Support: system institution + intake resilience
--
-- INCIDENT (2026-09-02 11:45 UTC). During a 27-institution cleanup of demo and
-- test schools from /admin/institutions, the SALCI Support container
-- institution (code SALCI-SUPPORT, is_active=false, 0 users) was deleted. It
-- looked exactly like the junk around it and carried the same Delete button.
--   * tasks.institution_id is ON DELETE CASCADE, so every support mirror task
--     went with it (unrecoverable: tasks has no backup).
--   * reported_issues.task_id is ON DELETE SET NULL and support_messages hangs
--     off reported_issues, so all 22 tickets and 58 messages survived.
--   * create_support_task() hard-required the container and raised
--     'Support is not set up yet' for EVERY user on both frontends for 7 days.
--     Failed intakes leave no server-side row, so nothing showed it.
--
-- WHAT THIS MIGRATION CHANGES
--   1. institutions.is_system: a platform singleton is not a school. Guarded by
--      a BEFORE DELETE / BEFORE UPDATE trigger, which fires for the service
--      role too (RLS does not, triggers do).
--   2. ensure_support_institution(): idempotent self-provisioning. A missing
--      container is re-created, never fatal.
--   3. create_support_task(): the ticket and thread are written FIRST and are
--      the record of truth. The tasks mirror and the notification are
--      best-effort, each in its own sub-transaction. The function returns
--      degraded=true instead of raising when a mirror cannot be made, and
--      falls back to any super admin when support_settings has no owner.
--   4. support_health_events + _support_record_health(): every degradation is a
--      row, with one coalesced in-app alert per hour to every super admin.
--   5. log_support_intake_failure(): the client reports a hard failure so the
--      class of "error only on the reporter's screen" is gone.
--   6. support_health(): one read the inbox renders as a banner.
--   7. support_backfill_mirror_tasks(): recovery tool; re-mirrors open tickets.
--
-- Idempotent: safe to re-apply.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. System institutions
-- ---------------------------------------------------------------------------
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.institutions.is_system IS
  'Platform-owned container (e.g. SALCI Support), not a school. Cannot be deleted, renamed or un-flagged: see guard_system_institution().';

-- Restore the container with its ORIGINAL id so the 2026-08-31 plan and every
-- earlier reference stay accurate. Nothing references the old id any more (the
-- cascade saw to that), so reusing it is free.
INSERT INTO public.institutions (id, name, code, is_active, is_system, timezone)
SELECT 'd9f3def9-7e53-43e3-9bbe-da688d5899db'::uuid,
       'SALCI Support', 'SALCI-SUPPORT', false, true, 'Asia/Kolkata'
WHERE NOT EXISTS (SELECT 1 FROM public.institutions WHERE code = 'SALCI-SUPPORT');

UPDATE public.institutions
SET is_system = true
WHERE code = 'SALCI-SUPPORT' AND is_system IS DISTINCT FROM true;

CREATE OR REPLACE FUNCTION public.guard_system_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION '% is a system institution and cannot be deleted. Support tickets depend on it.', OLD.name
        USING ERRCODE = 'P0001',
              HINT = 'System institutions are removed only by a migration, never from the app.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: the lookup key and the flag itself are immutable on system rows.
  IF OLD.is_system AND (NEW.is_system IS DISTINCT FROM true OR NEW.code IS DISTINCT FROM OLD.code) THEN
    RAISE EXCEPTION '% is a system institution: its code and system flag cannot be changed.', OLD.name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_system_institution_delete ON public.institutions;
CREATE TRIGGER guard_system_institution_delete
  BEFORE DELETE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_institution();

DROP TRIGGER IF EXISTS guard_system_institution_update ON public.institutions;
CREATE TRIGGER guard_system_institution_update
  BEFORE UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_institution();

-- ---------------------------------------------------------------------------
-- 2. Health event log. RPC-write-only; super admins read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_health_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text        NOT NULL CHECK (kind IN (
                'intake_failed', 'mirror_failed', 'mirror_skipped',
                'owner_missing', 'institution_reprovisioned', 'notify_failed')),
  detail     text,
  ticket_id  uuid        REFERENCES public.reported_issues(id) ON DELETE SET NULL,
  actor_id   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  page_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_health_events_created      ON public.support_health_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_health_events_kind_created ON public.support_health_events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_health_events_ticket       ON public.support_health_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_health_events_actor        ON public.support_health_events (actor_id);

ALTER TABLE public.support_health_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins read support health events" ON public.support_health_events;
CREATE POLICY "Super admins read support health events"
  ON public.support_health_events FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));

-- Supabase default privileges hand anon and authenticated full table rights on
-- every new table. There is deliberately no write policy, and the grant is
-- stripped too, so the only writers are the SECURITY DEFINER RPCs below.
REVOKE ALL ON TABLE public.support_health_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.support_health_events FROM authenticated;
GRANT SELECT ON TABLE public.support_health_events TO authenticated;

-- Internal. Records one event and, at most once per hour platform-wide, tells
-- every super admin in-app. It must NEVER raise: it is called from inside
-- exception handlers, where a second failure would kill the intake it is
-- reporting on.
CREATE OR REPLACE FUNCTION public._support_record_health(
  p_kind      text,
  p_detail    text,
  p_ticket_id uuid DEFAULT NULL,
  p_actor_id  uuid DEFAULT NULL,
  p_page_url  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.support_health_events (kind, detail, ticket_id, actor_id, page_url)
    VALUES (p_kind, left(p_detail, 600), p_ticket_id, p_actor_id, left(p_page_url, 300));
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  -- Alert coalescing: one notification per hour, however many events.
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE type = 'support_health' AND created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      SELECT ur.user_id,
             'support_health',
             'Support intake needs attention',
             left(p_kind || ': ' || coalesce(p_detail, ''), 240),
             '/admin/issues',
             jsonb_build_object('kind', p_kind, 'ticket_id', p_ticket_id)
      FROM public.user_roles ur
      WHERE ur.role = 'super_admin'::public.app_role;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Self-provisioning of the container
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_support_institution()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  SELECT id INTO v FROM public.institutions WHERE code = 'SALCI-SUPPORT' LIMIT 1;
  IF v IS NOT NULL THEN
    UPDATE public.institutions SET is_system = true WHERE id = v AND is_system IS DISTINCT FROM true;
    RETURN v;
  END IF;

  BEGIN
    INSERT INTO public.institutions (id, name, code, is_active, is_system, timezone)
    VALUES ('d9f3def9-7e53-43e3-9bbe-da688d5899db'::uuid, 'SALCI Support', 'SALCI-SUPPORT', false, true, 'Asia/Kolkata')
    ON CONFLICT (code) DO UPDATE SET is_system = true
    RETURNING id INTO v;
  EXCEPTION WHEN unique_violation THEN
    -- The original id is somehow taken by another row: provision under a new id.
    INSERT INTO public.institutions (name, code, is_active, is_system, timezone)
    VALUES ('SALCI Support', 'SALCI-SUPPORT', false, true, 'Asia/Kolkata')
    ON CONFLICT (code) DO UPDATE SET is_system = true
    RETURNING id INTO v;
  END;

  PERFORM public._support_record_health(
    'institution_reprovisioned',
    'SALCI Support institution was missing and has been re-created as ' || v::text,
    NULL, auth.uid(), NULL);
  RETURN v;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Intake, hardened. Same signature as before.
--
-- Order of operations is the design: ticket, thread, THEN mirror, THEN notify.
-- Anything after the thread runs in its own sub-transaction and can only
-- degrade the result, never fail the submission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_support_task(
  p_subject     text,
  p_description text,
  p_category    text    DEFAULT NULL,
  p_priority    integer DEFAULT 2,
  p_page_url    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_inst      uuid;
  v_recent    integer;
  v_task      uuid;
  v_ticket    uuid;
  v_priority  integer;
  v_category  text;
  v_subject   text;
  v_body      text;
  v_desc      text;
  v_role      text;
  v_classes   text;
  v_author    uuid;
  v_name      text;
  v_email     text;
  v_rep_inst  uuid;
  v_school    text;
  v_degraded  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to contact support.';
  END IF;

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'Please add a subject so we know what this is about.';
  END IF;

  v_body := nullif(btrim(coalesce(p_description, '')), '');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Please describe the issue so we can help.';
  END IF;

  v_priority := least(greatest(coalesce(p_priority, 2), 1), 3);
  v_category := nullif(btrim(coalesce(p_category, '')), '');

  SELECT count(*) INTO v_recent
  FROM public.reported_issues
  WHERE reporter_id = v_uid AND created_at > now() - interval '1 hour';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You have already sent 5 support requests in the last hour. Please wait a little before sending another.';
  END IF;

  -- Reporter snapshot, baked in as text: profiles RLS hides each side's row
  -- from the other, so nothing downstream may rely on a join.
  SELECT p.id, p.full_name, p.email, p.institution_id, i.name
    INTO v_author, v_name, v_email, v_rep_inst, v_school
  FROM public.profiles p
  LEFT JOIN public.institutions i ON i.id = p.institution_id
  WHERE p.id = v_uid;

  SELECT string_agg(DISTINCT ur.role::text, ', ') INTO v_role
  FROM public.user_roles ur WHERE ur.user_id = v_uid;

  SELECT string_agg(DISTINCT btrim(c.name || ' ' || coalesce(c.section, '')), ', ') INTO v_classes
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.user_id = v_uid;

  v_desc := v_body
    || E'\n\n----------------------------------------\n'
    || 'Reported by: ' || coalesce(v_name, 'Unknown')
    || ' (' || coalesce(v_email, 'no email on file') || ')' || E'\n'
    || 'Role: '   || coalesce(v_role, 'unknown') || E'\n'
    || 'School: ' || coalesce(v_school, 'None')  || E'\n'
    || coalesce('Classes: ' || v_classes  || E'\n', '')
    || coalesce('Page: '    || p_page_url || E'\n', '');

  -- 1) THE TICKET. This is the record. Nothing below may undo it.
  INSERT INTO public.reported_issues (
    reporter_id, reporter_name, reporter_email, reporter_role,
    institution_name, institution_id, classes_assigned,
    subject, description, status, task_id,
    category, priority, last_message_at
  ) VALUES (
    v_uid, v_name, v_email, v_role,
    v_school, v_rep_inst, v_classes,
    v_subject, v_body, 'open', NULL,
    v_category, v_priority, now()
  )
  RETURNING id INTO v_ticket;

  -- 2) THE THREAD. Message 1 is the reporter's own text.
  INSERT INTO public.support_messages (
    ticket_id, author_id, author_name, author_side, kind, body, is_internal
  ) VALUES (
    v_ticket, v_author, coalesce(v_name, 'Reporter'), 'reporter', 'message', v_body, false
  );

  -- 3) ROUTING. Configured owner, else any super admin, and say so.
  v_owner := public.get_support_owner_id();
  IF v_owner IS NULL THEN
    SELECT ur.user_id INTO v_owner
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'super_admin'::public.app_role
    ORDER BY p.created_at, ur.user_id
    LIMIT 1;
    PERFORM public._support_record_health(
      'owner_missing',
      'support_settings has no owner; routed to ' || coalesce(v_owner::text, 'nobody'),
      v_ticket, v_uid, p_page_url);
  END IF;

  -- 4) THE MIRROR into the tasks plane. Best effort, own sub-transaction.
  v_inst := coalesce(public.get_support_institution_id(), public.ensure_support_institution());

  IF v_inst IS NOT NULL AND v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.tasks (institution_id, title, description, task_type, status, priority)
      VALUES (v_inst, left(v_subject, 200), v_desc, 'general'::public.task_type, 'open'::public.task_status, v_priority)
      RETURNING id INTO v_task;

      -- Reporter is the assigner (that is what shows it under Assigned BY Me).
      -- When the owner files a ticket themselves, no_self_assignment forbids
      -- assigner = assignee, so fall back to the NULL "SALCI System" shape.
      INSERT INTO public.task_assignments (task_id, assignee_id, assigner_id)
      VALUES (v_task, v_owner, CASE WHEN v_uid = v_owner THEN NULL ELSE v_uid END);

      UPDATE public.reported_issues SET task_id = v_task WHERE id = v_ticket;
    EXCEPTION WHEN OTHERS THEN
      v_task := NULL;
      v_degraded := true;
      PERFORM public._support_record_health('mirror_failed', SQLERRM, v_ticket, v_uid, p_page_url);
    END;
  ELSE
    v_degraded := true;
    PERFORM public._support_record_health(
      'mirror_skipped',
      'institution=' || coalesce(v_inst::text, 'missing') || ' owner=' || coalesce(v_owner::text, 'missing'),
      v_ticket, v_uid, p_page_url);
  END IF;

  -- 5) TELL SALCI. Owner if known, otherwise every super admin. Never fatal.
  BEGIN
    IF v_owner IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      VALUES (
        v_owner, 'task_assigned', 'New support request',
        coalesce(v_name, 'A user') || coalesce(' from ' || v_school, '') || ': ' || v_subject,
        '/admin/issues?ticket=' || v_ticket::text,
        jsonb_build_object('task_id', v_task, 'ticket_id', v_ticket, 'category', v_category)
      );
    ELSE
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      SELECT ur.user_id, 'task_assigned', 'New support request',
             coalesce(v_name, 'A user') || coalesce(' from ' || v_school, '') || ': ' || v_subject,
             '/admin/issues?ticket=' || v_ticket::text,
             jsonb_build_object('task_id', v_task, 'ticket_id', v_ticket, 'category', v_category)
      FROM public.user_roles ur
      WHERE ur.role = 'super_admin'::public.app_role;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._support_record_health('notify_failed', SQLERRM, v_ticket, v_uid, p_page_url);
  END;

  RETURN jsonb_build_object('ticket_id', v_ticket, 'task_id', v_task, 'degraded', v_degraded);
END;
$$;

COMMENT ON FUNCTION public.create_support_task(text, text, text, integer, text) IS
  'Salci Support intake. Ticket + thread are written first and always; the tasks mirror and notification are best-effort and reported through support_health_events. Returns {ticket_id, task_id, degraded}.';

-- ---------------------------------------------------------------------------
-- 5. Client failure telemetry. A hard failure on the reporter's screen becomes
--    a row here. Never raises: this is reporting, and a second error would be
--    shown to a user who already has one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_support_intake_failure(
  p_stage    text,
  p_error    text,
  p_page_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_recent integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Callable by every authenticated user, so it is bounded per caller.
  SELECT count(*) INTO v_recent
  FROM public.support_health_events
  WHERE actor_id = v_uid AND kind = 'intake_failed' AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    RETURN;
  END IF;

  PERFORM public._support_record_health(
    'intake_failed',
    left(coalesce(p_stage, 'unknown'), 40) || ': ' || left(coalesce(p_error, ''), 500),
    NULL, v_uid, p_page_url);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. One health read for the inbox banner. Super admins only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst          uuid;
  v_owner         uuid;
  v_last_intake   timestamptz;
  v_intakes_24h   integer;
  v_failures_24h  integer;
  v_degraded_7d   integer;
  v_orphans       integer;
  v_status        text;
  v_events        jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view support health.';
  END IF;

  v_inst  := public.get_support_institution_id();
  v_owner := public.get_support_owner_id();

  SELECT max(created_at), count(*) FILTER (WHERE created_at > now() - interval '24 hours')
    INTO v_last_intake, v_intakes_24h
  FROM public.reported_issues;

  SELECT count(*) FILTER (WHERE kind = 'intake_failed' AND created_at > now() - interval '24 hours'),
         count(*) FILTER (WHERE kind <> 'intake_failed')
    INTO v_failures_24h, v_degraded_7d
  FROM public.support_health_events
  WHERE created_at > now() - interval '7 days';

  SELECT count(*) INTO v_orphans
  FROM public.reported_issues
  WHERE task_id IS NULL AND status IN ('open', 'in_progress');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', e.kind, 'detail', e.detail, 'ticket_id', e.ticket_id, 'at', e.created_at)
           ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_events
  FROM (SELECT * FROM public.support_health_events ORDER BY created_at DESC LIMIT 10) e;

  v_status := CASE
    WHEN v_inst IS NULL THEN 'down'
    WHEN v_failures_24h >= 3 AND v_intakes_24h = 0 THEN 'down'
    WHEN v_owner IS NULL OR v_failures_24h > 0 OR v_degraded_7d > 0 OR v_orphans > 0 THEN 'degraded'
    ELSE 'ok'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'institution_ok', v_inst IS NOT NULL,
    'institution_id', v_inst,
    'owner_ok', v_owner IS NOT NULL,
    'owner_id', v_owner,
    'last_intake_at', v_last_intake,
    'intakes_24h', v_intakes_24h,
    'failures_24h', v_failures_24h,
    'degraded_7d', v_degraded_7d,
    'open_tickets_without_task', v_orphans,
    'recent_events', v_events
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Recovery: re-mirror open tickets that lost their task. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_backfill_mirror_tasks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_inst    uuid;
  v_owner   uuid;
  v_task    uuid;
  v_created integer := 0;
  v_failed  integer := 0;
  r         record;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can re-link support requests.';
  END IF;

  v_inst  := coalesce(public.get_support_institution_id(), public.ensure_support_institution());
  v_owner := public.get_support_owner_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No support owner is configured. Set support_settings.owner_id first.';
  END IF;

  FOR r IN
    SELECT id, reporter_id, reporter_name, reporter_email, reporter_role,
           institution_name, classes_assigned, subject, description, status, priority, created_at
    FROM public.reported_issues
    WHERE task_id IS NULL AND status IN ('open', 'in_progress')
    ORDER BY created_at
  LOOP
    BEGIN
      INSERT INTO public.tasks (institution_id, title, description, task_type, status, priority, created_at)
      VALUES (
        v_inst,
        left(r.subject, 200),
        r.description
          || E'\n\n----------------------------------------\n'
          || 'Reported by: ' || coalesce(r.reporter_name, 'Unknown')
          || ' (' || coalesce(r.reporter_email, 'no email on file') || ')' || E'\n'
          || 'Role: '   || coalesce(r.reporter_role, 'unknown') || E'\n'
          || 'School: ' || coalesce(r.institution_name, 'None') || E'\n'
          || coalesce('Classes: ' || r.classes_assigned || E'\n', '')
          || 'Re-linked to this task on ' || to_char(now(), 'YYYY-MM-DD') || E'\n',
        'general'::public.task_type,
        CASE WHEN r.status = 'in_progress' THEN 'in_progress' ELSE 'open' END::public.task_status,
        least(greatest(coalesce(r.priority, 2), 1), 3),
        r.created_at
      )
      RETURNING id INTO v_task;

      INSERT INTO public.task_assignments (task_id, assignee_id, assigner_id)
      VALUES (v_task, v_owner, CASE WHEN r.reporter_id = v_owner THEN NULL ELSE r.reporter_id END);

      UPDATE public.reported_issues SET task_id = v_task WHERE id = r.id;
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      PERFORM public._support_record_health('mirror_failed', 'backfill: ' || SQLERRM, r.id, v_uid, NULL);
    END;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'failed', v_failed);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Retention: 90 days of health events, purged weekly.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'support-health-events-purge',
      '15 3 * * 0',
      $job$DELETE FROM public.support_health_events WHERE created_at < now() - interval '90 days'$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'support-health-events-purge not scheduled: %', SQLERRM;
END
$cron$;

-- ---------------------------------------------------------------------------
-- 9. Grants. Both revokes BY NAME; verify with pg_proc.proacl, never
--    information_schema (it does not expand PUBLIC).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.guard_system_institution()                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._support_record_health(text, text, uuid, uuid, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_support_institution()                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_support_intake_failure(text, text, text)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_health()                                            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_backfill_mirror_tasks()                             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_support_intake_failure(text, text, text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_health()                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_backfill_mirror_tasks()                       TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Contract check. Fails the migration loudly rather than shipping a gap.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.institutions WHERE code = 'SALCI-SUPPORT' AND is_system) THEN
    RAISE EXCEPTION 'SALCI Support institution is missing or not flagged is_system.';
  END IF;

  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.institutions'::regclass
      AND tgname IN ('guard_system_institution_delete', 'guard_system_institution_update')) <> 2 THEN
    RAISE EXCEPTION 'guard_system_institution triggers are not both installed.';
  END IF;

  SELECT string_agg(p.proname, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('create_support_task', 'log_support_intake_failure', 'support_health',
                      'support_backfill_mirror_tasks', 'ensure_support_institution',
                      '_support_record_health', 'guard_system_institution')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on: %', v_bad;
  END IF;

  IF has_function_privilege('authenticated', 'public.ensure_support_institution()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._support_record_health(text, text, uuid, uuid, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'An internal support helper is callable by authenticated.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.create_support_task(text, text, text, integer, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'create_support_task lost its authenticated EXECUTE grant.';
  END IF;
END
$verify$;
