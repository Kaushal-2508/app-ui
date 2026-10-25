# Notice Board: in-app notification on publish

**Date:** 2026-09-07
**Status:** SHIPPED. Frontend on `naman-erp` (merged 2026-09-08); database half applied to prod 2026-09-08 as `supabase/migrations/20260908120000_notice_publish_notifies_recipients.sql` (fan-out placed after `GET DIAGNOSTICS` so `recipient_count` stays correct; `mark_notice_read` also clears the bell row).
**Area:** `publish_notice` RPC, `notifications` table, `NotificationBell`, `NoticeBoard`

## Goal

When a notice is published, every person it was addressed to gets an in-app
notification: the bell badge increments, the realtime channel plays the alert,
and tapping the row opens that notice on the Notice Board.

## Why the fan-out lives in the RPC, not the client

`publish_notice` already materialises the audience into `notice_recipients`
inside one transaction (up to ~1,500 rows for a whole-school notice at
Alliance). Writing the notification rows from the same statement set means:

- **One transaction.** A notice can never exist without its notifications or
  vice versa (CLAUDE.md §9a: two dependent writes are one RPC).
- **One `INSERT ... SELECT`**, not 1,500 client round-trips (§23).
- **Idempotent for free.** `publish_notice` returns early when the notice id
  already exists, so a retried publish cannot double-notify.
- **The author never notifies themselves.** `notice_expand_audience` already
  excludes the author; selecting from `notice_recipients` inherits that.

The client-side `useCreateNotification` hook and the permissive
"Authenticated users can insert notifications" policy exist, but using them for
a fan-out would be exactly the pattern §23 forbids.

## Database change (NEEDS DB)

Append to `publish_notice`, after the `notice_recipients` insert and before the
`recipient_count` update. The migration must ship with the `NOT applied to prod`
header and re-`CREATE OR REPLACE` the whole function (the current body is in
`20260822100700_notice_class_audience_fix.sql`).

```sql
  -- One in-app notification per recipient, in the same transaction as the
  -- recipient rows. Type encodes urgency so the client can pick the alert
  -- sound without reading metadata.
  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT r.user_id,
         CASE WHEN _priority = 'urgent' THEN 'notice_urgent' ELSE 'notice_published' END,
         CASE WHEN _priority = 'urgent'    THEN 'Urgent notice: '    || btrim(_title)
              WHEN _priority = 'important' THEN 'Important notice: ' || btrim(_title)
              ELSE 'New notice: ' || btrim(_title) END,
         left(regexp_replace(_content, '\s+', ' ', 'g'), 140)
           || CASE WHEN length(_content) > 140 THEN '…' ELSE '' END,
         '/school/notices?notice=' || _notice_id::text,
         jsonb_build_object(
           'notice_id', _notice_id,
           'priority',  _priority,
           'type',      _type,
           'scope',     _scope,
           'requires_acknowledgement', _requires_acknowledgement
         )
    FROM public.notice_recipients r
   WHERE r.notice_id = _notice_id;
```

Notes for the implementer:

- `notifications.type` is free text today (no CHECK). The two new values are
  `notice_published` and `notice_urgent`; the frontend already maps both.
- `notifications.user_id` should already carry `ON DELETE CASCADE` per §21.
  Verify in `pg_constraint` rather than assuming.
- `notifications` is already in the `supabase_realtime` publication (the bell
  relies on it). A 1,500-row insert emits 1,500 realtime events, each filtered
  to one user by `user_id=eq.<id>`, so every recipient sees exactly one.
- Confirm an index covering `(user_id, is_read)` exists on `notifications`; the
  60s head-count poll in `useUnreadNotificationCount` depends on it.

### Optional follow-up: mark the notification read when the notice is opened

`mark_notice_read` could also close the loop so the bell does not keep nagging
about a notice the person has already read on the board:

```sql
  UPDATE public.notifications
     SET is_read = true
   WHERE user_id = (SELECT auth.uid())
     AND is_read = false
     AND type IN ('notice_published', 'notice_urgent')
     AND (metadata->>'notice_id')::uuid = _notice_id;
```

This needs an expression index to stay cheap at scale:
`CREATE INDEX ... ON public.notifications (user_id, ((metadata->>'notice_id')::uuid)) WHERE type IN ('notice_published','notice_urgent');`
Skip it if the index is not wanted; the bell's own click handler already marks
the tapped row read.

## Frontend (shipped on `naman-erp`, this commit)

| File | Change |
|---|---|
| `src/components/layout/NotificationBell.tsx` | icons for `notice_published` (📣) and `notice_urgent` (🚨) |
| `src/hooks/useNotificationSound.ts` | `notice_urgent` joins `URGENT_TYPES` (double beep + vibration); ordinary notices get the soft beep |
| `src/components/notices/NoticeBoard.tsx` | reads `?notice=<id>` from the URL, opens that notice once the inbox has loaded, then strips the param |

The link targets `/school/notices` (the dedicated route) rather than the
Communication tab, so the deep link does not depend on which tab that page
opens on.

## Verification (once the migration is applied)

| Check | Expected |
|---|---|
| Teacher publishes to 9-A | every 9-A student and the wing coordinator see the badge increment within a second; the author does not |
| Priority urgent | recipient hears the double beep; row shows 🚨 and "Urgent notice: …" |
| Tap the row | lands on `/school/notices` with that notice open (sheet on phone, right pane on desktop); URL no longer carries `?notice=` |
| Publish retried with the same notice id | no second notification row (`SELECT count(*) FROM notifications WHERE metadata->>'notice_id' = …` equals recipient count) |
| Whole-school notice at Alliance | one statement, ~1,500 rows, publish still returns in well under a second |
