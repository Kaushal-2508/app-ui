-- =============================================================
-- notice_unread_count(): one integer for the Notice Board tab badge
-- -------------------------------------------------------------
-- The Communication page badges its Notice Board tab with the reader's unread
-- notices. The frontend half (naman-erp round 2, merged b4283d32) counted the
-- rows of the first inbox page client-side, which loaded 20 notices on every
-- visit to the page just to print a number and under-counted past page one
-- (CLAUDE.md 23: aggregate server-side, never fetch rows to count them).
--
-- The predicate is the inbox's own (notice_inbox): addressed to the caller,
-- unread, published, not expired. Same shape as useUnreadNotificationCount and
-- useUnreadDiaryCount on the client: a head count, STABLE, one row.
--
-- Fails closed: a NULL auth.uid() matches no recipient row and returns 0.
--
-- Index: notice_recipients had (user_id) and a partial (notice_id) WHERE
-- read_at IS NULL for the author's read-progress line; the reader's unread set
-- gets its own partial index so the badge is an index-only lookup.
--
-- Grants per CLAUDE.md 26: REVOKE FROM PUBLIC and FROM anon by name.
-- Prod: applied 2026-09-09 via scripts/run-sql.ps1.
-- =============================================================

CREATE OR REPLACE FUNCTION public.notice_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.notice_recipients r
    JOIN public.notices n ON n.id = r.notice_id
   WHERE r.user_id = (SELECT auth.uid())
     AND r.read_at IS NULL
     AND n.published_at <= now()
     AND (n.expires_at IS NULL OR n.expires_at > now());
$$;

REVOKE ALL ON FUNCTION public.notice_unread_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notice_unread_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.notice_unread_count() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS notice_recipients_user_unread_idx
  ON public.notice_recipients (user_id)
  WHERE read_at IS NULL;

-- Verify after applying:
--   SELECT proname, proacl::text FROM pg_proc WHERE proname = 'notice_unread_count';
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'notice_recipients_user_unread_idx';
--   -- as a recipient (SET LOCAL ROLE authenticated + jwt claims):
--   SELECT public.notice_unread_count();  -- equals count(*) of their unread notice_inbox rows
