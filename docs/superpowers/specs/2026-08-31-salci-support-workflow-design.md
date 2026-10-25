# Salci Support — End-to-End Workflow Design

**Date:** 2026-08-31
**Status:** Approved design, pending implementation plan
**Supersedes the deferred half of:** [2026-08-14-salci-support-task-design.md](2026-08-14-salci-support-task-design.md) §11 "Out of scope"
**Touches:** new `support_messages`; `reported_issues`; `notifications`; new `support-attachments` bucket; new `support-notify-email` edge function; `src/components/issues/`, `src/pages/AdminIssuesPage.tsx`, new `src/pages/SupportPage.tsx`, `src/hooks/useSupportRequest.ts`, `src/hooks/useReportedIssues.ts`, `src/components/layout/AppSidebar.tsx`, `src/components/layout/ProtectedRoute.tsx`, `src/App.tsx`

---

## 1. Goal

The 2026-08-14 build delivered intake and a super-admin triage inbox, and explicitly deferred everything after. A reporter files a ticket and then falls off a cliff: no tracking surface, no reply, no notification, no outcome. SALCI has a status dropdown and a notes box that reaches nobody.

This design closes the loop:

1. Every reporter, in every role, can see their own tickets and their status.
2. Reporter and SALCI hold a **two-way conversation** on a ticket.
3. SALCI keeps **genuinely private** internal notes on the same ticket.
4. Both sides are **notified** in-app and by email when the other side acts.
5. Either side can attach **screenshots and files**.
6. SALCI can export a **per-ticket transcript**.

Non-goals are listed in §13.

## 2. Why this is not a small patch

Verified against production (`gyymkgohcijeksmrzuyw`) on 2026-08-31, not against the on-disk migrations, which the previous design already documented as stale.

| # | Finding | Evidence |
|---|---|---|
| 1 | **37% of reporters can never see their ticket.** The Salci Support button is unconditional for every role; `/tasks` is the only surface that renders a ticket and its `allowedRoles` omits `student` and `employee`. `ProtectedRoute` bounces them to `/dashboard`. | `src/App.tsx:318-322`; `src/components/layout/ProtectedRoute.tsx:60-74`; prod: 15 of 41 tickets from students |
| 2 | **Staff are bounced too, in 22 of 37 schools.** `/tasks` sits behind the `tasks` feature flag, which is `isDefault: false` and a strict allowlist. | `featuresData.ts:82`, `:35`; `ProtectedRoute.tsx:100-103`; prod: 15 `institution_features` rows for `tasks` vs 37 active institutions |
| 3 | **The reporter is never notified of anything.** The subsystem writes exactly one notification, at intake, to the support owner. `set_support_ticket_status` and `resolve_support_task` write none. | `20260814120000:301-311`; `20260814150000:44-124`, `:127-192` |
| 4 | **Two disconnected note stores, neither reaches the reporter.** The inbox writes `reported_issues.admin_notes`; `resolve_support_task` writes `task_comments`. No support surface renders `task_comments`. | `IssueDetailSheet.tsx:158-165`; `20260814150000:87-89`; prod: **0 rows** in `task_comments` for all 18 support tasks |
| 5 | **Live confidentiality bug.** `reported_issues` SELECT is `reporter_id = auth.uid() OR is_super_admin(...)`. The field the UI labels "Internal notes" is readable by the reporter. | prod `pg_policies`; `20260223115024:30-33`; **14 rows currently hold `admin_notes`** |
| 6 | **A task-based thread cannot cover the archive.** 23 of 41 tickets pre-date the task rework and have `task_id` NULL. | prod: `with_task` = 18, `total` = 41 |
| 7 | **The super admin cannot post on a support task.** `task_comments` INSERT omits `super_admin`; only assignee (the configured owner) and assigner (the reporter) may write. | prod `pg_policies` on `task_comments` |
| 8 | **Category and urgency are discarded.** `create_support_task` takes both but `reported_issues` has neither column; they survive only as free text inside `tasks.description`. | prod `information_schema.columns`; `20260814120000:259-267` |

Findings 5, 6 and 7 are jointly decisive against building the thread on `task_comments`: it cannot cover the archive, it has no private channel, and making it work would require widening RLS on a table the entire Tasks module shares.

## 3. Decisions taken

| Decision | Choice | Consequence |
|---|---|---|
| Thread store | New `support_messages`, keyed to `reported_issues` | Covers all 41 tickets; real internal/external split; zero blast radius on Tasks RLS |
| Reporter surface | New `/support` route, opened by the **existing** sidebar Salci Support button | No new nav item. Reachable by every authenticated role, feature-flag-free |
| Ticket ownership | Unchanged: single configured owner, any super admin may act | No agent model, no assignment UI, no queue ownership |
| Reply on a resolved ticket | **Auto-reopens** and notifies SALCI | No separate Reopen button; a prematurely resolved ticket cannot be lost |
| Notifications | In-app **and** email, both directions | Reuses the existing Resend setup; in-app is the durable channel |
| Attachments | In scope, private bucket, path-prefix authority | Ships with the thread rather than as a later phase |
| Reporting | Per-ticket transcript PDF, super admin only | No queue analytics dashboard in this change |
| Status changes | Recorded as `kind='system'` rows in the thread | Transcript is one read; no separate events table |
| `admin_notes` | Migrated into internal messages, column dropped | Removes the leak at the schema level, not with a UI label |

## 4. Architecture

### 4.1 `support_messages`

```sql
CREATE TABLE public.support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES public.reported_issues(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name  text,
  author_side  text NOT NULL CHECK (author_side IN ('reporter','salci','system')),
  kind         text NOT NULL DEFAULT 'message' CHECK (kind IN ('message','system')),
  body         text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_token uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_messages_ticket_created
  ON public.support_messages(ticket_id, created_at);
CREATE INDEX idx_support_messages_author
  ON public.support_messages(author_id);
CREATE UNIQUE INDEX uq_support_messages_client_token
  ON public.support_messages(client_token) WHERE client_token IS NOT NULL;
```

Design notes, each load-bearing:

- **`author_id` is `ON DELETE SET NULL`, not CASCADE.** Authorship reference per CLAUDE.md §21. Deleting a SALCI staff profile must not erase their replies from a reporter's history.
- **`author_name` is a snapshot, not a join.** `profiles` SELECT requires a shared institution, and the support owner's `institution_id` is NULL. Neither side can read the other's profile. `create_support_task` already solves this by baking the reporter snapshot into text; this is the same mechanism applied per message.
- **`author_side` is not derived from `author_id`.** A super admin can also be a reporter (prod has 2 such tickets). Side is decided by the RPC at write time from the caller's relationship to the ticket, and frozen.
- **`is_internal` is only ever meaningful with `author_side='salci'`.** Enforced by the RPC, not by a CHECK, so a future "internal system event" stays possible.
- **`client_token` with a partial unique index** makes posting idempotent under double-tap and retry (Scale Gate item 5). System rows pass NULL.
- **`attachments` shape:** `[{ "path": "<ticket_id>/<uuid>-name.png", "name": "screenshot.png", "size": 48213, "type": "image/png" }]`. Paths, never URLs. URLs are signed at read time.

### 4.2 `reported_issues` changes

```sql
ALTER TABLE public.reported_issues
  ADD COLUMN category              text,
  ADD COLUMN priority              smallint,
  ADD COLUMN last_message_at       timestamptz,
  ADD COLUMN reporter_last_read_at timestamptz,
  ADD COLUMN salci_last_read_at    timestamptz,
  ADD COLUMN first_response_at     timestamptz,
  ADD COLUMN resolved_at           timestamptz;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_status_check
  CHECK (status IN ('open','in_progress','resolved','closed'));

CREATE INDEX idx_reported_issues_last_message
  ON public.reported_issues(last_message_at DESC);
```

- The `status` CHECK is safe to add unvalidated then validate: all 41 live rows are `closed` (21), `resolved` (16) or `in_progress` (4).
- Unread is computed, not stored: `last_message_at > coalesce(reporter_last_read_at, 'epoch')`. No per-message read table.
- `first_response_at` is stamped on the **first non-internal `salci` message**. An internal note is not a response.
- `resolved_at` is stamped when status enters `resolved` or `closed`, and cleared on reopen. It exists because `updated_at` is bumped by a trigger on every edit (`20260223115024:42-45`) and therefore cannot serve as a resolution timestamp.

### 4.3 RLS and helpers

Two SECURITY DEFINER helpers, so no policy inlines a cross-table EXISTS (the 42P17 trap):

```sql
CREATE FUNCTION public.is_support_ticket_reporter(p_ticket uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.reported_issues
  WHERE id = p_ticket AND reporter_id = auth.uid()
) $$;

CREATE FUNCTION public.can_access_support_ticket(p_ticket uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_super_admin(auth.uid())
       OR public.is_support_ticket_reporter(p_ticket) $$;
```

`support_messages` policies — **SELECT only**. Every write goes through a SECURITY DEFINER RPC, which bypasses RLS, so granting no write policy is the strongest available guarantee that the internal/external split cannot be forged from a client.

```sql
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Support participants read the thread"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_super_admin((SELECT auth.uid()))
    OR (public.is_support_ticket_reporter(ticket_id) AND NOT is_internal)
  );
```

There is deliberately **no INSERT, UPDATE or DELETE policy**. A blocked PostgREST DELETE looks identical to success (CLAUDE.md §6), so the safe shape is for the client to have no direct write path at all.

`reported_issues` SELECT is narrowed to super admin only:

```sql
DROP POLICY "Users can view own reports" ON public.reported_issues;
CREATE POLICY "Super admins view all reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));
```

Safe because the only client readers are the two super-admin inbox hooks (`useReportedIssues.ts:68-78`, `:119-123`). Reporters read exclusively through `list_my_support_tickets()`, which returns an explicit column list. This removes the leak at the schema level rather than relying on a UI that does not display a column.

The existing `Users can insert own reports` INSERT policy becomes dead (all inserts run through `create_support_task`) but is left in place; removing it is a separate, unrelated cleanup.

### 4.4 The `admin_notes` fix and backfill

Ordered, in one migration:

1. `CREATE TABLE salci_backups.reported_issues_pre_messages_20260831 AS SELECT * FROM public.reported_issues;` (full row backup, not just the column, so the whole step is reversible).
2. Seed message 1 for **every** ticket from its own intake text, so no ticket opens empty:
   `author_side='reporter'`, `kind='message'`, `is_internal=false`, `author_name=reporter_name`, `body=description`, `created_at=created_at`.
   **`author_id` must be `LEFT JOIN`-resolved against `profiles`, not copied from `reporter_id`.** `reported_issues.reporter_id` references `auth.users(id)` while `support_messages.author_id` references `profiles(id)`; a straight copy is an unguarded FK bet. Write `author_id` only where a matching profile row exists, else NULL — the snapshot name carries the attribution either way.
3. Migrate the 14 non-empty `admin_notes` into internal messages: `author_side='salci'`, `is_internal=true`, `author_id=NULL`, `author_name='SALCI Support'`, `created_at=updated_at`. Author is genuinely unknown; the column never recorded one.
4. Backfill `last_message_at` from the max seeded `created_at`; `resolved_at` from `updated_at` where status is `resolved`/`closed` (**approximate**, documented in a column comment); `priority` from `tasks.priority` via `task_id`; `category` by regex over `tasks.description` for the `Category: ` line the intake RPC writes.
5. `ALTER TABLE public.reported_issues DROP COLUMN admin_notes;`

Step 5 is what actually closes finding 5. Keeping the column and merely not rendering it would leave 14 rows readable.

### 4.5 RPC surface

All `plpgsql SECURITY DEFINER SET search_path = public`. Every one gets **both** `REVOKE EXECUTE ... FROM PUBLIC` and `REVOKE EXECUTE ... FROM anon`, by name — the 20260814150000 post-mortem proved each revoke alone is insufficient, and that `information_schema.routine_privileges` does not expand PUBLIC. Verify with `pg_proc.proacl`; a leading `=X/postgres` entry means PUBLIC still holds EXECUTE.

| RPC | Signature | Behaviour |
|---|---|---|
| `list_my_support_tickets` | `(p_limit int DEFAULT 50, p_offset int DEFAULT 0) RETURNS jsonb` | Caller's own tickets, newest first, `p_limit` clamped to 100. Explicit column list; no `admin_notes` (dropped) and no other side's internals. Includes `has_unread`, `last_message_at`, `message_count`. |
| `get_support_thread` | `(p_ticket_id uuid, p_limit int DEFAULT 50, p_before timestamptz DEFAULT NULL) RETURNS jsonb` | Authority via `can_access_support_ticket`. Cursor-paginated on `created_at`. Internal rows omitted unless caller is super admin. Returns ticket header plus messages. |
| `post_support_message` | `(p_ticket_id uuid, p_body text, p_is_internal boolean DEFAULT false, p_attachments jsonb DEFAULT '[]'::jsonb, p_client_token uuid DEFAULT NULL) RETURNS jsonb` | The whole write path. Detailed below. |
| `set_support_ticket_status` | `(p_ticket_id uuid, p_status text, p_note text DEFAULT NULL) RETURNS jsonb` | Rewritten. Keeps existing task mirroring verbatim; adds system row, `resolved_at`, notification payload. |
| `mark_support_ticket_read` | `(p_ticket_id uuid) RETURNS void` | Stamps `reporter_last_read_at` or `salci_last_read_at` by caller side. Idempotent. |
| `support_inbox_counts` | `(p_institution_id uuid, p_role text)` **extended** | Adds `awaiting_salci` (`last_message_at > coalesce(salci_last_read_at,'epoch')`). Existing keys unchanged. |
| `get_support_ticket_transcript` | `(p_ticket_id uuid) RETURNS jsonb` | Super admin only. Header, full thread including internal, attachment names. Feeds the PDF. |
| `create_support_task` | unchanged signature | **Modified**: additionally writes `category` and `priority` into the new `reported_issues` columns, and seeds message 1 into `support_messages` so a new ticket opens with its own text. Stops appending `Category:` to `tasks.description`, which was the only place either value survived. |

**Two migration mechanics that will bite otherwise:**

- `set_support_ticket_status` currently `RETURNS void`. Postgres cannot `CREATE OR REPLACE` a function with a different return type, so the migration must `DROP FUNCTION public.set_support_ticket_status(uuid, text, text);` first.
- **`resolve_support_task` must NOT be dropped.** It is live at `src/components/tms/TaskDetailPanel.tsx:102` via `useResolveSupportRequest`, and it is how the support owner resolves a ticket from `/tasks` — their habitual surface. Dropping it breaks that flow. Instead, both it and `set_support_ticket_status` are rewritten as thin wrappers over **one** internal routine (`_support_apply_status(p_ticket_id, p_status, p_actor, p_note)`), so a resolution from `/tasks` and one from `/admin/issues` produce identical system rows, `resolved_at` stamps and notifications. Two entry points, one write path. Building a second divergent path is the exact mistake that produced findings 4 and 5. `resolve_support_task` keeps its `(uuid, text, text)` signature and resolves `ticket_id` from `task_id`; its outcome vocabulary (`completed`/`rejected`) maps to `resolved`/`closed`.
- `is_uuid` must exist before the storage policies reference it:

```sql
CREATE OR REPLACE FUNCTION public.is_uuid(p text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' $$;
```

**`post_support_message` in full.** This is the only place ticket state moves as a side effect, so all of it lives in one transaction:

1. Reject NULL `auth.uid()`.
2. Resolve side: super admin → `salci`; `is_support_ticket_reporter` → `reporter`; neither → raise. A super admin who is also the reporter resolves to `salci`, matching the existing 2 prod rows where the owner filed their own ticket.
3. Reject `p_is_internal = true` from a `reporter`.
4. Reject empty `btrim(p_body)` unless attachments are present.
5. **Idempotency:** if `p_client_token` already exists, return that message and stop.
6. **Throttle:** more than 30 messages from this caller in the last hour raises a plain-language error.
7. Snapshot `author_name` from `profiles` (the caller can always read their own row).
8. Insert the message.
9. Set `last_message_at`. If side is `salci` and not internal and `first_response_at` is NULL, stamp it.
10. **Implicit status moves** (never for internal notes), each writing its own `kind='system'` row:
    - `salci` posts on an `open` ticket → `in_progress`, "SALCI started working on this".
    - `reporter` posts on `resolved` or `closed` → `open`, `resolved_at = NULL`, "Reopened by the reporter".
11. Insert `notifications` for the other side, unless internal.
12. Return `{ message_id, status, notify: { to_user_id, to_email, to_name, kind, ticket_id, subject } }` so the client can invoke the email function without a second round trip.

### 4.6 Attachments

Private bucket `support-attachments`, created with an explicit MIME allowlist and size cap so the bucket enforces what the client validates:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('support-attachments', 'support-attachments', false, 5242880,
        ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']);
```

Path is `<ticket_id>/<uuid>-<sanitised filename>`. Files upload **before** the message is posted, and their paths are passed into `post_support_message`.

```sql
CREATE POLICY "Support participants upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket((storage.foldername(name))[1]::uuid)
  );

CREATE POLICY "Support participants read attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket((storage.foldername(name))[1]::uuid)
  );
```

- **`is_uuid()` guard is mandatory.** A bare `::uuid` cast on the first path segment raises `22P02` for any object whose path does not start with a uuid, which surfaces as a hard storage failure rather than a denial. `is_uuid` is a tiny `IMMUTABLE` helper returning false on a regex miss.
- No UPDATE or DELETE policies: attachments are immutable, matching the messages they belong to.
- Reads use client-side `createSignedUrl` at 300s, batched per message. Storage RLS is the gate, so no edge function is needed.
- **The `message-attachments` bucket is not the model.** Its policies are `bucket_id = '...' AND auth.uid() IS NOT NULL` (`20260226074822:170-178`), readable by every authenticated user on the platform. Do not copy it.
- Client validation reuses `validateFileUpload(file, { allowedMimes, maxBytes })` from `src/lib/fileValidation.ts:35` with a support-specific config, and `uploadResumable({ bucket, path, file, contentType })` from `src/lib/storageUpload.ts:26`. Limits: 5 MB, 3 files per message.

### 4.7 Notifications

**In-app.** Three new `type` values: `support_reply`, `support_status_changed`, `support_reopened`. `notifications.type` is free text with 20 values already in production, and INSERT is `WITH CHECK (true)`, so a DEFINER RPC can write for another user with no policy change.

Links are deep links, and both targets must honour them:
- reporter → `/support?ticket=<id>`
- SALCI → `/admin/issues?ticket=<id>`

Internal notes never produce a notification.

**Email.** New edge function `support-notify-email`, modelled on `supabase/functions/send-welcome-email/index.ts` (same `serve` + `corsHeaders` + `new Resend(Deno.env.get("RESEND_API_KEY"))` shape). Sender `SALCI Support <team@salci.in>`, an already-verified Resend domain. `noreply@salci.org` is also verified; `support@salci.in` is not, and must not be used until it is.

The client invokes it after a successful mutation, passing the `notify` payload the RPC returned. This matches the house pattern for all nine existing Resend functions. It is adequate here because both sides always have a live client at the moment of writing. The in-app notification is written inside the RPC transaction and is the durable channel; email is best-effort and its failure must never fail the mutation.

**Origin handling.** The portal runs on two production frontends against this one Supabase project, so the email link must not hardcode a domain. The client passes `window.location.origin`; the function validates it against a `SUPPORT_APP_ORIGINS` secret (comma-separated allowlist) and falls back to the first entry on a miss. Never echo an unvalidated origin into an email link.

The function is invoked through `invokeEdgeFunction` from `src/lib/invokeEdgeFunction.ts`, not `supabase.functions.invoke`, which sends an empty Bearer token in this client setup (CLAUDE.md §21).

## 5. Frontend

### 5.1 Reporter surface: `/support`

New `src/pages/SupportPage.tsx`, lazy-loaded in `App.tsx` like the other 53 routes.

```jsx
<Route path="/support" element={
  <ProtectedRoute>
    <SupportPage />
  </ProtectedRoute>
} />
```

**No `allowedRoles`.** `ProtectedRoute.tsx:62` only enforces roles when `allowedRoles` is non-empty, so omitting it admits every authenticated user, which is exactly the set that can already press the Support button.

Three gating rules, all mandatory:
1. **Do not add `/support` to `FEATURE_URL_MAP`.** The feature gate at `ProtectedRoute.tsx:100-103` only fires for paths present in that map. Support must never be gateable.
2. **Add `/support` to the Olympiad-only allowlist** at `ProtectedRoute.tsx:116-122`. That guard is an allowlist, so onboarded schools would otherwise be bounced off a page whose entry button they can see.
3. **No sidebar nav item.** The existing footer button is the only entry.

Layout, per the design system:

- `PageShell` + `PageHeader` (icon `LifeBuoy`, primary action "New request").
- `StatTileGrid`: Active, Awaiting your reply, Resolved.
- `MobileTabs`: **Active** (`open`, `in_progress`), **Resolved** (`resolved`, `closed`), **All**.
- `ListRow` per ticket with an unread dot driven by `has_unread`.
- `EmptyState` with the **error state rendered before the empty state** (CLAUDE.md §6), copying the ordering and the invariant comment at `AdminIssuesPage.tsx:181`.
- Detail in a `MobileSheet` with **`placement="center"`**. `placement="bottom"` hard-codes `bg-white` and does not dark-flip.
- Status chips reuse `AdminIssuesPage.tsx:35-40` `STATUS_TONES` verbatim so both sides read identically.

The thread is a message list plus a composer, at 375px and in dark mode. Reporter messages align right, SALCI left, each with snapshot name and `formatDistanceToNow`. System rows render as centred muted single lines, not bubbles. Internal rows never reach this surface, because the RPC omits them.

Reading a ticket calls `mark_support_ticket_read` once per open.

### 5.2 `SupportRequestSheet`

Unchanged in shape. Two edits:
- Pass category and urgency through to the new `reported_issues` columns (the RPC gains the writes; the sheet already sends both).
- The success toast stops promising "Assigned BY Me" and instead says the request is now trackable, since the sheet is opened from `/support` where the new ticket appears immediately.

### 5.3 SALCI surface

`IssueDetailSheet` gains the thread, a composer, and an **Internal note** toggle that visibly restyles the composer so a private note can never be typed into the public field by accident. The "Internal notes" `Textarea` at `IssueDetailSheet.tsx:158-165` is removed; its column no longer exists.

The "Linked task" button at `AdminIssuesPage.tsx:239` is removed. It navigates to `/tasks?task=<id>` and `TasksPage` never reads a query parameter, so it is dead today. The thread now lives in the sheet, and the tasks plane is an implementation detail.

**The `/tasks` support surface stays, and converges.** `TaskDetailPanel`, `TaskCard` and `TaskManageActions` already special-case support tickets via `useSupportInstitutionId`. None of that changes shape: the panel keeps its Resolve and Not-an-issue actions, which now route through the shared `_support_apply_status` routine and therefore produce the same system rows and notifications as the inbox. It gains one addition, a **View conversation** link to `/admin/issues?ticket=<id>`, so the thread has exactly one home rather than being half-rendered in two places.

`AdminIssuesPage` gains an **Awaiting SALCI** filter from the new `awaiting_salci` count, an unread dot per row, and `?ticket=<id>` deep-link handling for notifications. It also becomes `React.lazy` — it is currently a static import at `App.tsx:121` while 53 other pages are lazy, and it is about to pull jsPDF.

### 5.4 Transcript export

Button in `IssueDetailSheet`, super admin only, lazy `import("jspdf")` (already a dependency at `^2.5.2`).

Contents: ticket id, subject, reporter name / email / role / school, category, urgency, raised at, first response at, resolved at, current status; the status timeline from the `kind='system'` rows; the full conversation with internal notes clearly marked; attachment filenames. Filename `salci-support-<first 8 of id>.pdf`.

### 5.5 Hooks

New `src/hooks/useSupportTickets.ts`. Conventions per CLAUDE.md §23:

| Query key | `staleTime` | Notes |
|---|---|---|
| `["support-my-tickets", userId, tab]` | `60_000` | `userId` in the key: `["tasks-assigned-by-me"]` omits it today and can serve a previous session's list |
| `["support-thread", ticketId]` | `60_000` | `refetchOnWindowFocus: true` — cheap, bounded, natural for a conversation |
| `["support-inbox", ...]` | unchanged | existing keys preserved |

No realtime channel. §23 prefers polling or invalidation over new subscriptions, and every mutation invalidates its thread directly.

## 6. Permission matrix

| Actor | See ticket | See internal notes | Post reply | Post internal note | Change status | Attach files |
|---|---|---|---|---|---|---|
| Reporter | Yes, `/support` | **No** | Yes | No | Only implicitly, by reopening | Yes |
| Reporter's colleagues / school admin | No | No | No | No | No | No |
| Any super admin | Yes, `/admin/issues` | Yes | Yes | Yes | Yes | Yes |
| `anon` | No | No | No | No | No | No |

The support owner's special status disappears from the read/write path: authority is `is_super_admin`, so a second SALCI person is never locked out of a thread. `support_settings.owner_id` keeps its single job, routing the intake assignment.

## 7. Error handling

- Every RPC raises plain-language sentences, which `isLikelyUserFriendly()` passes through `toastError` unmodified.
- Every `onError` routes through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. No `toast.error(error.message)`.
- Error state renders **before** empty state on both list surfaces and inside the thread. A failed thread read must never render as "no replies yet" — that is exactly the defect in `TaskComments.tsx:264-265`, which must not be copied.
- Email failure is caught, logged and toasted as a warning; the message is already saved and the in-app notification already written.
- Attachment upload failure aborts the post and names the file that failed.
- **No em-dashes in any user-facing string**, per the platform-wide convention.

## 8. Scale gate

| # | Item | Verdict |
|---|---|---|
| 1 | Every list query bounded | **pass.** `list_my_support_tickets` clamps `p_limit` to 100; `get_support_thread` is cursor-paginated on `created_at`; the inbox keeps its existing `range(0,199)`. |
| 2 | Server-side aggregation | **pass.** Unread, `message_count` and `awaiting_salci` are computed in Postgres. Nothing is counted by fetching rows. |
| 3 | Explicit `staleTime` | **pass.** Table in §5.5, all `60_000`. |
| 4 | No `select("*")` | **pass.** Reporter reads are RPC-only with explicit lists; the inbox already uses `ISSUE_COLUMNS`. |
| 5 | Idempotent mutations | **pass.** `client_token` + partial unique index, plus `isPending` single-flight, plus the hourly throttle. `mark_support_ticket_read` is naturally idempotent. |
| 6 | Dependent writes in one transaction | **pass.** Message, `last_message_at`, `first_response_at`, implicit status move, system row and notification are all inside `post_support_message`. |
| 7 | FK indexes in-migration; DEFINER RLS helpers | **pass.** Both FKs indexed above. Policies call `is_super_admin`, `is_support_ticket_reporter`, `can_access_support_ticket` only. |
| 8 | Errors surfaced | **pass.** §7. |
| 9 | No JWT-less `getUser()` | **pass.** Identity from `useAuth`; RPCs use `auth.uid()` server-side. |
| 10 | No sub-30s polling; subscriptions clean up | **pass.** No polling and no new subscriptions. |

Bundle: jsPDF is lazy and lands only in the admin chunk, which also becomes lazy for the first time. Net entry-chunk delta is expected to be negative.

## 9. Risks and landmines

1. **Narrowing `reported_issues` SELECT.** Verified that the only client readers are the two super-admin hooks. If any unaudited surface reads that table directly, it breaks. Re-grep before applying.
2. **Dropping `admin_notes`** is irreversible without the backup. Step 1 of §4.4 is not optional.
3. **`storage.foldername(name)[1]::uuid` raises `22P02`** on any non-uuid path. The `is_uuid` guard must short-circuit before the cast, and `AND` short-circuit order is load-bearing.
4. **`validate_task_state_transition()` remains a check-list with no trailing `ELSE`.** The existing task mirroring in `set_support_ticket_status` depends on `open|in_progress → completed` staying unguarded. This design does not change that dependency, but preserves it verbatim; hardening that trigger still breaks support resolution.
5. **Badge triggers fire on support tickets.** `trg_zz_teacher_badges_task_assignment` and `trg_zz_teacher_badges_task_completed` run on support intake and resolution. Unchanged by this design, but any new write to `tasks` inherits them.
6. **`reported_issues.reporter_id` is `ON DELETE CASCADE` to `auth.users`.** Deleting a user destroys their entire ticket history, contrary to §21 and to `task_id`'s deliberate `SET NULL`. **Decided: in scope for Phase 1.** The column becomes nullable with `ON DELETE SET NULL`. Nothing is lost, because `reporter_name` and `reporter_email` are already snapshots; the super admin keeps the ticket and its attribution, and `is_support_ticket_reporter` still fails closed for a NULL reporter since `NULL = auth.uid()` is never true. Without this, the archive silently shrinks every time a student leaves.
7. **Email origin.** Never echo a client-supplied origin into a link without the allowlist check.
8. **Migrations do not reach prod by merging.** Apply via `scripts/run-sql.ps1` (Management API) and verify against `pg_policies`, `pg_proc.proacl` and `information_schema.columns`. `supabase_migrations.schema_migrations` is not maintained. Regenerate `src/integrations/supabase/types.ts` from prod afterwards.
9. **`scripts/rollback-salci-support-tasks.sql` is already stale and dangerous.** It drops `get_support_institution_id()` without dropping `guard_support_task_mutations()` or its two triggers, which call it — running it as written would raise `42883` on every task update platform-wide. Fix it in the same pass or delete it; do not leave a booby-trapped rollback beside a new one.

## 10. Data migration and rollback

Forward: §4.4, one migration, ordered, idempotent where it can be.

Rollback (`scripts/rollback-salci-support-messages.sql`, written in the same change):
1. `DROP TABLE public.support_messages;`
2. Restore `admin_notes` and the added columns from `salci_backups.reported_issues_pre_messages_20260831`.
3. Restore the original `Users can view own reports` SELECT policy.
4. Drop the three new RPCs, the two helpers, the bucket policies and the bucket.
5. Note explicitly that restoring the old SELECT policy **reinstates the `admin_notes` leak**, so rollback is a break-glass action, not a routine one.

## 11. Testing

**Database**, against prod with an explicit `BEGIN ... ROLLBACK` dry run first (the house pattern):
- A reporter reads their own thread and sees zero `is_internal` rows.
- A reporter cannot read another reporter's ticket or thread.
- A super admin sees internal rows; a second super admin who is not the owner can both read and post.
- `post_support_message` with a repeated `client_token` returns the same message and inserts nothing.
- The 31st message in an hour raises the throttle error.
- A reporter posting on a `resolved` ticket flips it to `open`, clears `resolved_at`, and writes one system row.
- A `salci` internal note on an `open` ticket does **not** move status and writes **no** notification.
- Storage: an object path not starting with a uuid is denied, not `22P02`.
- Privileges: `pg_proc.proacl` for all new functions shows no leading `=X/postgres` and no `anon`.

**Frontend:** `npm run typecheck`, `npx eslint <changed paths>`, `npx vite build`, all exit 0. Manual pass at 375px and in dark mode. A student account files a ticket, opens `/support`, sees it, replies, and receives the notification.

## 12. Phasing

Each phase is separately reviewable and independently shippable.

| Phase | Contents |
|---|---|
| 1 | Migration: `support_messages`, `reported_issues` columns + CHECK, `reporter_id` to nullable `SET NULL` (risk 6), `is_uuid`, the two authority helpers, RLS, backfill, `admin_notes` drop, rollback script, plus repairing the booby-trapped `rollback-salci-support-tasks.sql` (risk 9) |
| 2 | RPCs: the four new ones, modified `create_support_task` and `support_inbox_counts`, `DROP`-then-create `set_support_ticket_status`, and `resolve_support_task` rewritten as a wrapper over the shared `_support_apply_status` routine. `REVOKE` from PUBLIC **and** anon by name, verified via `pg_proc.proacl`. Regenerate `types.ts` from prod |
| 3 | `/support` page, route, gating, sidebar repoint, hooks |
| 4 | `IssueDetailSheet` thread + internal toggle; `AdminIssuesPage` awaiting filter, deep link, lazy import |
| 5 | In-app notifications wired both ways; `support-notify-email` edge function + `SUPPORT_APP_ORIGINS` secret |
| 6 | Attachments: bucket, policies, upload and viewer on both surfaces |
| 7 | Transcript PDF |

## 13. Out of scope

Queue analytics (volume over time, per-school and per-category breakdowns, resolution-time distributions) — the columns this design adds (`category`, `priority`, `first_response_at`, `resolved_at`) make it buildable later, deliberately. A support agent or team model, and any reassignment UI. Ticket merge, duplicate detection, canned replies, and CSAT. Message editing and deletion. Email **inbound** parsing, so a reply to a notification email does not post to the thread. Per-user email opt-out, since support email is transactional and user-initiated. SLA targets and breach alerting.

**Superseded in part (2026-09-18):** SLA targets, a SALCI-set priority, escalation to a named SALCI person and the working-hours closure clock are now designed in [2026-09-18-support-sop-design.md](2026-09-18-support-sop-design.md), following the Ticket Resolution SOP.
