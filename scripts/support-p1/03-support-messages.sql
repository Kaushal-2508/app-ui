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
