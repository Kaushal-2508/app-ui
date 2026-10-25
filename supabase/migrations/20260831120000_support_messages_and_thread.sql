-- ============================================================================
-- Salci Support: conversation thread, ticket metadata, confidentiality fix
--
-- Design: docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
-- Phase 1 of 7. RPCs land in phase 2; nothing here changes the client contract
-- except dropping reported_issues.admin_notes (section 6 below), which is the
-- whole point: the column the UI labelled "Internal notes" was readable by the
-- reporter through the "Users can view own reports" SELECT policy, and 14 rows
-- currently hold text in it.
--
-- Applied to production by scripts/run-sql.ps1 (Management API), section by
-- section, each one dry-run inside BEGIN ... ROLLBACK first. The migration
-- ledger supabase_migrations.schema_migrations is NOT maintained in this repo,
-- so this file is a record of what ran, not the mechanism that ran it.
--
-- Rollback: scripts/rollback-salci-support-messages.sql (break-glass only, it
-- reinstates the admin_notes leak).
--
-- Verified against production gyymkgohcijeksmrzuyw on 2026-08-31:
--   reported_issues total 41, with task_id 18, with admin_notes 14,
--   status closed 21 / resolved 16 / in_progress 4 / open 0.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Full-row backup, taken BEFORE any change
--
-- A whole-table copy rather than just the admin_notes column, so the entire
-- phase is reversible from one place. It is also the only trigger-immune copy
-- of updated_at: update_reported_issues_updated_at bumps updated_at on every
-- UPDATE, so the backfill in section 5 must read resolution timestamps from
-- here, never from the live table it is in the middle of rewriting.
--
-- RLS is enabled with no policies, so the copy is unreachable from PostgREST
-- even if salci_backups were ever exposed. The Management API runs as postgres
-- (BYPASSRLS), so the rollback script can still read it.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS salci_backups;

REVOKE ALL ON SCHEMA salci_backups FROM anon;
REVOKE ALL ON SCHEMA salci_backups FROM authenticated;

CREATE TABLE IF NOT EXISTS salci_backups.reported_issues_pre_messages_20260831 AS
SELECT * FROM public.reported_issues;

ALTER TABLE salci_backups.reported_issues_pre_messages_20260831
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM anon;
REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM authenticated;

COMMENT ON TABLE salci_backups.reported_issues_pre_messages_20260831 IS
  'Full copy of public.reported_issues taken 2026-08-31 immediately before the support thread migration, including the admin_notes column that migration drops. Restore path: scripts/rollback-salci-support-messages.sql.';

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

-- ---------------------------------------------------------------------------
-- 3. support_messages: the two-way thread
--
-- Keyed to reported_issues, not to tasks: 23 of the 41 live tickets pre-date
-- the task rework and have task_id NULL, and task_comments has no private
-- channel and would need RLS widened on a table the whole Tasks module shares.
--
-- author_id is ON DELETE SET NULL, not CASCADE (CLAUDE.md section 21):
-- deleting a SALCI staff profile must not erase their replies from a
-- reporter's history. author_name is a snapshot, because profiles SELECT
-- requires a shared institution and the support owner's institution_id is
-- NULL, so neither side can ever read the other's profile row.
--
-- author_side is decided by the RPC at write time and frozen, never derived
-- from author_id: a super admin can also be a reporter, and production already
-- has 2 such tickets.
--
-- client_token plus a PARTIAL unique index makes posting idempotent under
-- double tap and retry (Scale Gate item 5). System rows pass NULL, and NULLs
-- are not unique-checked, so any number of them coexist.
--
-- attachments shape:
--   [{"path":"<ticket_id>/<uuid>-name.png","name":"screenshot.png",
--     "size":48213,"type":"image/png"}]
-- Paths, never URLs. URLs are signed at read time (phase 6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES public.reported_issues(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name  text,
  author_side  text NOT NULL CHECK (author_side IN ('reporter', 'salci', 'system')),
  kind         text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
  body         text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_token uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.support_messages IS
  'Conversation on a Salci Support ticket. Reader-visible rows have is_internal=false; internal notes are SALCI-only. All writes go through SECURITY DEFINER RPCs, the table has no write policy.';
COMMENT ON COLUMN public.support_messages.author_name IS
  'Snapshot of the author name at write time. profiles RLS hides each side from the other, so this can never be a join.';
COMMENT ON COLUMN public.support_messages.author_side IS
  'Frozen at write time from the caller relationship to the ticket. A super admin who is also the reporter resolves to salci.';
COMMENT ON COLUMN public.support_messages.client_token IS
  'Client-supplied idempotency key. Partial unique index; system rows pass NULL.';

-- Both FKs indexed in the same migration (CLAUDE.md section 23). The composite
-- also serves the cursor pagination in get_support_thread.
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON public.support_messages(ticket_id, created_at);

CREATE INDEX IF NOT EXISTS idx_support_messages_author
  ON public.support_messages(author_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_token
  ON public.support_messages(client_token)
  WHERE client_token IS NOT NULL;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- SELECT ONLY, deliberately. There is no INSERT, UPDATE or DELETE policy and
-- there never should be: every write runs through a SECURITY DEFINER RPC that
-- bypasses RLS, so having no client write path at all is the strongest
-- available guarantee that the internal/external split cannot be forged. A
-- PostgREST DELETE blocked by RLS is also indistinguishable from success
-- (CLAUDE.md section 6), which is a second reason not to offer one.
DROP POLICY IF EXISTS "Support participants read the thread" ON public.support_messages;
CREATE POLICY "Support participants read the thread"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_super_admin((SELECT auth.uid()))
    OR (public.is_support_ticket_reporter(ticket_id) AND NOT is_internal)
  );

-- Supabase default privileges grant ALL on new public tables to anon and
-- authenticated. Strip everything anon has, and leave authenticated with
-- SELECT only so the absent write policies are belt and braces, not the only
-- thing standing between a client and a forged internal note.
REVOKE ALL ON TABLE public.support_messages FROM anon;
REVOKE ALL ON TABLE public.support_messages FROM authenticated;
GRANT SELECT ON TABLE public.support_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. reported_issues gains ticket metadata, and stops destroying history
--
-- category and priority: create_support_task already accepted both and threw
-- them away into free text inside tasks.description. Phase 2 writes them here.
--
-- Unread is computed, never stored:
--   last_message_at > coalesce(reporter_last_read_at, 'epoch')
-- so there is no per-message read table.
--
-- resolved_at exists because updated_at is bumped by
-- update_reported_issues_updated_at on every edit and therefore cannot serve
-- as a resolution timestamp.
--
-- first_response_at is stamped on the first NON-INTERNAL salci message. An
-- internal note is not a response.
-- ---------------------------------------------------------------------------
ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS priority              smallint,
  ADD COLUMN IF NOT EXISTS last_message_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reporter_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS salci_last_read_at    timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz;

COMMENT ON COLUMN public.reported_issues.priority IS
  'Urgency 1..3 as sent by the intake sheet, clamped server side.';
COMMENT ON COLUMN public.reported_issues.last_message_at IS
  'Timestamp of the most recent thread message. Drives unread on both sides.';
COMMENT ON COLUMN public.reported_issues.first_response_at IS
  'First non-internal salci message. An internal note is not a response.';
COMMENT ON COLUMN public.reported_issues.resolved_at IS
  'Set when status enters resolved or closed, cleared on reopen. Rows migrated on 2026-08-31 carry an APPROXIMATE value copied from updated_at, which was the only timestamp available.';

-- The four live statuses are closed (21), resolved (16) and in_progress (4);
-- open is currently 0. NOT VALID then VALIDATE keeps the lock weak, and the
-- VALIDATE is what proves the claim rather than asserting it.
ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')) NOT VALID;

ALTER TABLE public.reported_issues
  VALIDATE CONSTRAINT reported_issues_status_check;

CREATE INDEX IF NOT EXISTS idx_reported_issues_last_message
  ON public.reported_issues(last_message_at DESC);

-- -------------------------------------------------------------------------
-- reporter_id: ON DELETE CASCADE to auth.users destroys a reporter's entire
-- ticket history the moment a student leaves. That contradicts CLAUDE.md
-- section 21 (authorship references are SET NULL) and contradicts task_id on
-- this very table, which is already deliberately SET NULL.
--
-- Nothing is lost by nulling it: reporter_name, reporter_email, reporter_role
-- and institution_name are all snapshots taken at intake. And
-- is_support_ticket_reporter still fails closed for a NULL reporter, because
-- NULL = auth.uid() is never true.
--
-- The constraint is dropped by its REAL name looked up from pg_constraint,
-- not by a guessed one.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT c.conname INTO v_con
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.reported_issues'::regclass
    AND c.contype = 'f'
    AND a.attname = 'reporter_id'
  LIMIT 1;

  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.reported_issues DROP CONSTRAINT %I', v_con);
    RAISE NOTICE 'dropped reporter_id foreign key %', v_con;
  END IF;
END $$;

ALTER TABLE public.reported_issues
  ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.reported_issues.reporter_id IS
  'auth.users id of the reporter, NULL once that user is deleted. The reporter_* snapshot columns keep the attribution.';

-- FK index requirement: idx_reported_issues_reporter_created already leads on
-- reporter_id (20260814120000), so the re-added FK is covered. Recreated here
-- with IF NOT EXISTS so this section is safe on a fresh database too.
CREATE INDEX IF NOT EXISTS idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Backfill
--
-- Every statement is guarded so the whole section is re-runnable.
--
-- TIMESTAMP SOURCE IS THE BACKUP, NOT THE LIVE TABLE. reported_issues carries
-- the update_reported_issues_updated_at BEFORE UPDATE trigger, so the moment
-- this section writes anything, live updated_at is now(). The backup taken in
-- section 1 is the only pre-migration copy of those values.
--
-- author_id is LEFT JOIN resolved against profiles and never copied from
-- reporter_id: reported_issues.reporter_id references auth.users(id) while
-- support_messages.author_id references profiles(id). A straight copy is an
-- unguarded FK bet. Where no profile row matches, author_id stays NULL and the
-- author_name snapshot carries the attribution.
-- ---------------------------------------------------------------------------

-- 5a. Seed message 1 for EVERY ticket, so no thread ever opens empty.
INSERT INTO public.support_messages (
  ticket_id, author_id, author_name, author_side, kind,
  body, is_internal, attachments, client_token, created_at
)
SELECT
  r.id,
  p.id,                                   -- NULL when no profile row exists
  r.reporter_name,
  'reporter',
  'message',
  r.description,
  false,
  '[]'::jsonb,
  NULL,
  r.created_at
FROM public.reported_issues r
LEFT JOIN public.profiles p ON p.id = r.reporter_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.support_messages m
  WHERE m.ticket_id = r.id AND m.author_side = 'reporter'
);

-- 5b. The 14 admin_notes become genuinely internal messages.
--
-- author_id is NULL and author_name is a literal because the column never
-- recorded who wrote the note. created_at comes from the BACKUP's updated_at,
-- which 5a did not touch but 5c onward would.
INSERT INTO public.support_messages (
  ticket_id, author_id, author_name, author_side, kind,
  body, is_internal, attachments, client_token, created_at
)
SELECT
  b.id,
  NULL,
  'SALCI Support',
  'salci',
  'message',
  btrim(b.admin_notes),
  true,
  '[]'::jsonb,
  NULL,
  b.updated_at
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE nullif(btrim(coalesce(b.admin_notes, '')), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.reported_issues r WHERE r.id = b.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.support_messages m
    WHERE m.ticket_id = b.id AND m.is_internal
  );

-- 5c. resolved_at, from the BACKUP's updated_at. Approximate and documented as
-- such in the column comment: updated_at is bumped on every edit, so it is the
-- closest available proxy, not the truth.
UPDATE public.reported_issues r
SET resolved_at = b.updated_at
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id
  AND r.status IN ('resolved', 'closed')
  AND r.resolved_at IS NULL;

-- 5d. last_message_at from the thread we just seeded.
UPDATE public.reported_issues r
SET last_message_at = m.max_created
FROM (
  SELECT ticket_id, max(created_at) AS max_created
  FROM public.support_messages
  GROUP BY ticket_id
) m
WHERE m.ticket_id = r.id
  AND (r.last_message_at IS NULL OR r.last_message_at < m.max_created);

-- 5e. priority from the linked task (18 tickets carry task_id).
UPDATE public.reported_issues r
SET priority = t.priority
FROM public.tasks t
WHERE t.id = r.task_id
  AND r.priority IS NULL
  AND t.priority IS NOT NULL;

-- 5f. category by regex over the linked task description, for the "Category: "
-- line create_support_task appended. E'' string so [^\n] is a real newline
-- class: in a plain literal it would read as "not backslash and not n".
UPDATE public.reported_issues r
SET category = nullif(btrim(substring(t.description from E'Category: ([^\n]+)')), '')
FROM public.tasks t
WHERE t.id = r.task_id
  AND r.category IS NULL
  AND t.description LIKE '%Category: %';

-- first_response_at is deliberately NOT backfilled. No historical row records
-- when SALCI first replied, and inventing one would poison the only metric the
-- column exists to carry.

-- ---------------------------------------------------------------------------
-- 6. Close the confidentiality hole at the schema level
--
-- The field the inbox labels "Internal notes" is reported_issues.admin_notes,
-- and the SELECT policy is
--   reporter_id = auth.uid() OR is_super_admin(auth.uid())
-- so every reporter could read SALCI's notes on their own ticket. 14 rows hold
-- such text today. Not rendering the column would not have fixed anything; the
-- column has to go, and the policy has to stop admitting reporters.
--
-- Order matters. The two live RPCs both write admin_notes, so they are
-- rewritten FIRST. These are interim bodies: phase 2 replaces both with thin
-- wrappers over _support_apply_status. Signatures are untouched here, so
-- nothing on the client moves. set_support_ticket_status keeps RETURNS void
-- until phase 2 DROPs and recreates it as RETURNS jsonb.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_support_ticket_status(
  p_ticket_id uuid,
  p_status    text,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_task        uuid;
  v_task_status public.task_status;
  v_note        text;
  v_found       boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can update a support request.';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown status for a support request.';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  SELECT true, task_id INTO v_found, v_task
  FROM public.reported_issues WHERE id = p_ticket_id;

  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  UPDATE public.reported_issues
  SET status      = p_status,
      resolved_at = CASE
                      WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
                      ELSE NULL
                    END,
      updated_at  = now()
  WHERE id = p_ticket_id;

  -- The note lands in the thread as a genuinely private message instead of in
  -- a column the reporter can read.
  IF v_note IS NOT NULL THEN
    INSERT INTO public.support_messages (
      ticket_id, author_id, author_name, author_side, kind, body, is_internal
    )
    VALUES (
      p_ticket_id,
      (SELECT p.id FROM public.profiles p WHERE p.id = v_uid),
      coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), 'SALCI Support'),
      'salci',
      'message',
      v_note,
      true
    );
  END IF;

  IF v_task IS NULL THEN
    RETURN;  -- legacy ticket with no task behind it
  END IF;

  SELECT status INTO v_task_status FROM public.tasks WHERE id = v_task;
  IF v_task_status IS NULL OR v_task_status = 'completed' THEN
    RETURN;
  END IF;

  -- Step off the approval dead-end before closing: from
  -- done_pending_approval the normal ladder needs the ASSIGNER, who on a
  -- support ticket is the reporter, and the RESTRICTIVE policy blocks them.
  IF v_task_status = 'done_pending_approval' AND p_status IN ('resolved', 'closed') THEN
    UPDATE public.tasks SET status = 'in_progress' WHERE id = v_task;
    v_task_status := 'in_progress';
  END IF;

  IF p_status = 'resolved' THEN
    UPDATE public.tasks SET status = 'completed'
    WHERE id = v_task AND status IN ('open', 'in_progress', 'rejected');
  ELSIF p_status = 'closed' THEN
    UPDATE public.tasks SET status = 'rejected'
    WHERE id = v_task AND status IN ('open', 'in_progress');
  ELSIF p_status = 'in_progress' THEN
    UPDATE public.tasks SET status = 'in_progress'
    WHERE id = v_task AND status = 'open';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_support_ticket_status(uuid, text, text) IS
  'Move a Salci Support ticket and its linked task together, and file any note as an internal thread message. Super admins only. Interim body: phase 2 replaces this with a wrapper over _support_apply_status.';

CREATE OR REPLACE FUNCTION public.resolve_support_task(
  p_task_id uuid,
  p_outcome text,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_inst      uuid;
  v_task_inst uuid;
  v_status    public.task_status;
  v_new       public.task_status;
  v_note      text;
  v_rows      integer;
  v_ticket    uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can resolve a support request.';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'Unknown outcome for a support request.';
  END IF;
  v_new := p_outcome::public.task_status;

  v_inst := public.get_support_institution_id();

  SELECT institution_id, status INTO v_task_inst, v_status
  FROM public.tasks WHERE id = p_task_id;

  IF v_task_inst IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  IF v_inst IS NULL OR v_task_inst <> v_inst THEN
    RAISE EXCEPTION 'That task is not a support request.';
  END IF;

  SELECT id INTO v_ticket FROM public.reported_issues WHERE task_id = p_task_id LIMIT 1;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    INSERT INTO public.task_comments (task_id, user_id, content)
    VALUES (p_task_id, v_uid, v_note);

    IF v_ticket IS NOT NULL THEN
      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      )
      VALUES (
        v_ticket,
        (SELECT p.id FROM public.profiles p WHERE p.id = v_uid),
        coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), 'SALCI Support'),
        'salci',
        'message',
        v_note,
        true
      );
    END IF;
  END IF;

  -- Already where we want it: mirror the intake row and stop, so a double
  -- click never raises 'Completed tasks cannot be modified'.
  IF v_status = 'completed' OR v_status = v_new THEN
    UPDATE public.reported_issues
    SET status      = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
        resolved_at = coalesce(resolved_at, now()),
        updated_at  = now()
    WHERE task_id = p_task_id;
    RETURN;
  END IF;

  IF v_status = 'done_pending_approval' THEN
    UPDATE public.tasks SET status = 'in_progress' WHERE id = p_task_id;
    v_status := 'in_progress';
  END IF;

  UPDATE public.tasks
  SET status = v_new
  WHERE id = p_task_id
    AND status IN ('open', 'in_progress', 'rejected');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Never mirror a change that did not happen.
    RAISE EXCEPTION 'Could not update this support request. Please refresh and try again.';
  END IF;

  UPDATE public.reported_issues
  SET status      = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      resolved_at = coalesce(resolved_at, now()),
      updated_at  = now()
  WHERE task_id = p_task_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_support_task(uuid, text, text) IS
  'Resolve a Salci Support ticket from /tasks. Super admins only; asserts the task belongs to the SALCI Support institution. Interim body: phase 2 replaces this with a wrapper over _support_apply_status.';

-- Nothing writes the column any more, so it can go. This, not a UI label, is
-- what closes the leak.
ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS admin_notes;

-- Narrow the read. The only client readers are the two super-admin inbox
-- hooks in src/hooks/useReportedIssues.ts, re-verified before applying.
-- Reporters read exclusively through list_my_support_tickets() from phase 2,
-- which returns an explicit column list.
--
-- The "Users can insert own reports" INSERT policy becomes dead (every insert
-- goes through create_support_task) but is left in place: removing it is an
-- unrelated cleanup and this migration is already wide enough.
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
CREATE POLICY "Super admins view all reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));
