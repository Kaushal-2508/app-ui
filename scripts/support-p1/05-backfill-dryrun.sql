BEGIN;

INSERT INTO public.support_messages (
  ticket_id, author_id, author_name, author_side, kind,
  body, is_internal, attachments, client_token, created_at
)
SELECT r.id, p.id, r.reporter_name, 'reporter', 'message',
       r.description, false, '[]'::jsonb, NULL, r.created_at
FROM public.reported_issues r
LEFT JOIN public.profiles p ON p.id = r.reporter_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.support_messages m
  WHERE m.ticket_id = r.id AND m.author_side = 'reporter'
);

INSERT INTO public.support_messages (
  ticket_id, author_id, author_name, author_side, kind,
  body, is_internal, attachments, client_token, created_at
)
SELECT b.id, NULL, 'SALCI Support', 'salci', 'message',
       btrim(b.admin_notes), true, '[]'::jsonb, NULL, b.updated_at
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE nullif(btrim(coalesce(b.admin_notes, '')), '') IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.reported_issues r WHERE r.id = b.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.support_messages m
    WHERE m.ticket_id = b.id AND m.is_internal
  );

UPDATE public.reported_issues r
SET resolved_at = b.updated_at
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id AND r.status IN ('resolved','closed') AND r.resolved_at IS NULL;

UPDATE public.reported_issues r
SET last_message_at = m.max_created
FROM (SELECT ticket_id, max(created_at) AS max_created
        FROM public.support_messages GROUP BY ticket_id) m
WHERE m.ticket_id = r.id
  AND (r.last_message_at IS NULL OR r.last_message_at < m.max_created);

UPDATE public.reported_issues r
SET priority = t.priority
FROM public.tasks t
WHERE t.id = r.task_id AND r.priority IS NULL AND t.priority IS NOT NULL;

UPDATE public.reported_issues r
SET category = nullif(btrim(substring(t.description from E'Category: ([^\n]+)')), '')
FROM public.tasks t
WHERE t.id = r.task_id AND r.category IS NULL AND t.description LIKE '%Category: %';

DO $$
DECLARE
  v_seeded   integer;
  v_internal integer;
  v_orphans  integer;
  v_unres    integer;
BEGIN
  SELECT count(*) INTO v_seeded
  FROM public.reported_issues r
  WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                     WHERE m.ticket_id = r.id AND m.author_side = 'reporter');
  SELECT count(*) INTO v_internal FROM public.support_messages WHERE is_internal;
  SELECT count(*) INTO v_orphans
  FROM public.support_messages m LEFT JOIN public.profiles p ON p.id = m.author_id
  WHERE m.author_id IS NOT NULL AND p.id IS NULL;
  SELECT count(*) INTO v_unres FROM public.reported_issues
  WHERE status IN ('resolved','closed') AND resolved_at IS NULL;

  IF v_seeded <> 0 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: % tickets have no seed message', v_seeded;
  END IF;
  IF v_internal <> 14 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: expected 14 internal messages, got %', v_internal;
  END IF;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: % messages point at a missing profile', v_orphans;
  END IF;
  IF v_unres <> 0 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: % resolved tickets have no resolved_at', v_unres;
  END IF;
  RAISE NOTICE 'dry run backfill counts all correct';
END $$;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM public.support_messages) = 0 AS rolled_back_clean;
