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
