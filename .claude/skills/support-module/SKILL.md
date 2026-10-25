---
name: support-module
description: Salci Support end-to-end workflow — reported_issues + support_messages thread, the single-write-path RPCs (post_support_message, _support_apply_status), support-notify-email edge function, the /support reporter surface and the /admin/issues + /tasks SALCI surfaces. Use when touching reported_issues, support_messages, support_settings, any support_*/_support_* RPC, src/components/issues/, src/pages/SupportPage.tsx, src/pages/AdminIssuesPage.tsx, src/hooks/useSupportTickets.ts, useReportedIssues, useSupportRequest, or the support special-casing inside src/components/tms/.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Salci Support Module

Support is a **conversation on a ticket**, not a status field. Design: [docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md](../../../docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md). Plan: `docs/superpowers/plans/2026-08-31-salci-support-workflow.md`. Earlier task-mirroring design: `specs/2026-08-14-salci-support-task-design.md`.

## 1. Data model

`reported_issues` is the ticket. `support_messages` is the thread.

```sql
support_messages (
  id, ticket_id → reported_issues(id) ON DELETE CASCADE,
  author_id    → profiles(id) ON DELETE SET NULL,   -- authorship, per CLAUDE.md §21
  author_name  text,                                -- SNAPSHOT, never a join
  author_side  text CHECK IN ('reporter','salci','system'),
  kind         text CHECK IN ('message','system') DEFAULT 'message',
  body         text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  attachments  jsonb NOT NULL DEFAULT '[]',
  client_token uuid,                                -- partial unique index = idempotency
  created_at   timestamptz
)
```

Load-bearing decisions, do not "simplify" any of them:

* **`author_name` is a snapshot.** `profiles` SELECT requires a shared institution and the support owner's `institution_id` is NULL, so **neither side can read the other's profile row**. Any attempt to render the author via a join produces blanks. Same reason `create_support_task` bakes the reporter snapshot into text.
* **`author_side` is decided by the RPC at write time and frozen** — it is NOT derived from `author_id`. A super admin can also be a reporter (prod has 2 such tickets); that case resolves to `salci`.
* **`is_internal` is enforced by the RPC, not by a CHECK**, so a future internal system event stays possible. A `reporter` posting with `is_internal=true` is rejected.
* **`support_messages` has NO write policy.** `authenticated` holds `SELECT` only; every write goes through a SECURITY DEFINER RPC. Read policy: super admin sees everything, reporter sees `is_support_ticket_reporter(ticket_id) AND NOT is_internal`.
* `reported_issues` added `category`, `priority`, `last_message_at`, `reporter_last_read_at`, `salci_last_read_at`, `first_response_at`, `resolved_at`, plus `status CHECK IN ('open','in_progress','resolved','closed')`.
* `support_settings.owner_id` has exactly ONE job now: routing the intake assignment. **Authority is `is_super_admin`, not ownership**, so a second SALCI person is never locked out of a thread.

Helpers: `is_uuid(text)`, `is_support_ticket_reporter(uuid)`, `can_access_support_ticket(uuid)`.

## 2. ONE write path per concern (the central invariant)

| Concern | The only write path |
|---|---|
| Any message, any side | `post_support_message(p_ticket_id, p_body, p_is_internal, p_attachments, p_client_token)` |
| Any status change | `_support_apply_status(p_ticket_id, p_status, p_actor, p_note)` |
| Ticket creation | `create_support_task(...)` (also seeds message 1 and writes `category`/`priority`) |
| Read stamps | `mark_support_ticket_read(p_ticket_id)` |

**`set_support_ticket_status` and `resolve_support_task` are thin wrappers over `_support_apply_status`.** Two entry points, one write path. Building a second divergent path is the exact mistake that produced the original findings 4 and 5.

* **Never drop `resolve_support_task`.** It is live at [src/components/tms/TaskDetailPanel.tsx](../../../src/components/tms/TaskDetailPanel.tsx) via `useResolveSupportRequest` and is how the support owner resolves from `/tasks`, their habitual surface. It keeps its `(uuid, text, text)` signature, resolves `ticket_id` from `task_id`, and maps its `completed`/`rejected` vocabulary onto `resolved`/`closed`.
* `set_support_ticket_status` used to `RETURN void`. Postgres cannot `CREATE OR REPLACE` a function with a changed return type, so a migration touching it must `DROP FUNCTION` first.

**What `post_support_message` does in ONE transaction** (all of it, or the ticket desynchronises):
1. Reject NULL `auth.uid()`. 2. Resolve side (super admin → `salci`; reporter → `reporter`; neither → raise). 3. Reject internal-from-reporter. 4. Reject empty `btrim(body)` unless attachments exist. 5. **Idempotency:** an existing `client_token` returns that message and stops. 6. **Throttle:** >30 messages/caller/hour raises a plain-language error. 7. Snapshot `author_name`. 8. Insert. 9. Stamp `last_message_at`, and `first_response_at` on the first non-internal `salci` reply. 10. **Implicit status moves, each writing its own `kind='system'` row** — `salci` posts on `open` → `in_progress`; **reporter posts on `resolved`/`closed` → `open` with `resolved_at=NULL` ("Reopened by the reporter")**. Never for internal notes. 11. Insert `notifications` for the other side unless internal. 12. Return `{ message_id, status, notify: {...} }` so the client can send email without a second round trip.

There is deliberately **no Reopen button** — a reply reopens. Status changes are `kind='system'` rows in the thread, so the timeline is one read and there is no separate events table.

## 3. Grants — the 20260814150000 post-mortem

Every support RPC is `plpgsql SECURITY DEFINER SET search_path = public` and gets **both** revokes, BY NAME:

```sql
REVOKE EXECUTE ON FUNCTION public.fn(args) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn(args) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn(args) TO authenticated, service_role;
```

Each revoke alone is insufficient, and **`information_schema.routine_privileges` does not expand PUBLIC** — verify with `pg_proc.proacl`; a leading `=X/postgres` entry means PUBLIC still holds EXECUTE. See the `prod-operations` skill.

## 4. Notifications and email

* **In-app is the durable channel**, written inside the RPC transaction. Types: `support_reply`, `support_status_changed`, `support_reopened`. `notifications.type` is free text and INSERT is `WITH CHECK (true)`, so a DEFINER RPC can write for another user with no policy change. Internal notes never notify.
* Deep links, and both targets honour them: reporter → `/support?ticket=<id>`, SALCI → `/admin/issues?ticket=<id>`.
* **Email is best-effort and must never fail the mutation.** Edge fn `support-notify-email` (Resend), sender `SALCI Support <team@salci.in>` — a verified domain. `noreply@salci.org` is also verified; **`support@salci.in` is NOT and must not be used.**
* **Origin handling:** two prod frontends share this Supabase project, so the link must not hardcode a domain. The client passes `window.location.origin`; the function validates it against the `SUPPORT_APP_ORIGINS` secret (comma-separated allowlist) and falls back to the first entry on a miss. **Never echo an unvalidated origin into an email link.**
* Invoke it through `invokeEdgeFunction` ([src/lib/invokeEdgeFunction.ts](../../../src/lib/invokeEdgeFunction.ts)), never `supabase.functions.invoke` (empty Bearer token in this client setup — CLAUDE.md §21).
* **Authorise the RECIPIENT, not only the ticket** (fix af7a271). Being allowed to see a ticket does not make you allowed to have mail sent to an arbitrary address on it.

## 5. Frontend surfaces

**Reporter: `/support`** ([src/pages/SupportPage.tsx](../../../src/pages/SupportPage.tsx), lazy). Three gating rules, all mandatory:
1. **Never add `/support` to `FEATURE_URL_MAP`** — the feature gate only fires for paths in that map, and support must never be gateable.
2. **Keep `/support` in the Olympiad-only allowlist** in `ProtectedRoute` — that guard is an allowlist, so onboarded schools would otherwise be bounced off a page whose entry button they can see.
3. **No sidebar nav item.** The existing footer "Salci Support" button is the only entry, and it is hidden from SALCI's own admins (they use `/admin/issues`).

`<ProtectedRoute>` with **no `allowedRoles`** — roles are only enforced when that prop is non-empty, so omitting it admits every authenticated user, exactly the set that can already press the button.

**SALCI: `/admin/issues`** ([src/pages/AdminIssuesPage.tsx](../../../src/pages/AdminIssuesPage.tsx), now `React.lazy`). Has the Awaiting-SALCI filter (`awaiting_salci` from `support_inbox_counts`), unread dots and `?ticket=<id>` deep links. **Header cards (2026-09-10):** four `InboxStatCard`s (Open, In Progress, Resolved with Closed as a footnote button, and Turnaround) fed by ONE read, `support_inbox_stats(p_institution_id, p_role)`, which deliberately has no status argument so its key is `(institution, role)` and a tab switch never refetches the header. Urgency is weight in the ink scale, never colour; every windowed figure names its window and sample; `resolved_*` count `status = 'resolved'` ONLY because `_support_apply_status` stamps `resolved_at` on closed tickets too (the 2026-08-31 bulk close would otherwise read as 32 resolutions); `in_progress_quiet_72h` reads `coalesce(last_message_at, created_at)`, never `updated_at`. **Turnaround (`tat_*` keys) covers SCHOOL-RAISED tickets only:** reporter not a super admin AND `institutions.is_demo = false` (the flag is a Switch in Edit Institution on `/admin/institutions`; SALCI's eight demo and test schools were seeded 2026-09-10, migration `20260910150000`). Demo tickets stay on the three count cards: they are the inbox, not the stopwatch. Headline = median time to resolve (status `'resolved'` only, cohort keyed on `resolved_at` in a rolling 30-day UTC window, calendar hours) with a caption naming the cohort ("to resolve · 9 tickets"); the body is LABEL / VALUE rows, never sentences (Tushar rejected the five-sentence first cut as text-heavy and confusing): Resolved in a week `x of n`, Prior 30 days (only when BOTH samples are >= 5; empty until October because `resolved_at` exists since 2026-08-31; alert weight when slower now), First reply (median), Replied in a day `x of n`. The over-two-weeks tail line was dropped: the headline already carries the tail. No p90 and no mean, ever: at these samples a p90 is the second-slowest ticket. Every median is gated at 5 tickets; below the gate the headline reads N/A and the first line says why. The card is static (no `onSelect`), its footer names the window and how many test tickets were left out, and its durations come from `formatAgeParts` (full words: hours, days, weeks, months, one vocabulary for all four cards). The RPC still emits the four unprefixed legacy speed keys for one release; nothing reads them, drop them in a later migration. Reopen rate is deliberately NOT built: a reopen is only detectable by the literal system-row body, so it waits for a machine-readable stamp inside `post_support_message`. The tab badges read the SAME stats snapshot as the cards (so a tab switch can never leave the two disagreeing for a staleTime); `support_inbox_counts` now feeds only the Awaiting SALCI chip and is the badge fallback in board mode. A failed stats read renders a strip, never zeros, and a badge with no data renders no count. The school-concentration figure is a LIMIT 1 CTE read through scalar subqueries, never a join, so widening the LIMIT raises instead of silently multiplying every aggregate. Design panel record: the editorial-minimal proposal won 3/3; rose text on fact lines was rejected as a token violation. `IssueDetailSheet` renders the thread plus a composer whose **Internal note toggle visibly restyles the composer** so a private note cannot be typed into the public field by accident. The old `admin_notes` Textarea and the dead "Linked task" button are gone.

**`/tasks` stays and converges.** `TaskDetailPanel` / `TaskCard` / `TaskManageActions` keep their support special-casing via `useSupportInstitutionId`; Resolve and Not-an-issue now route through `_support_apply_status`, so a resolution from `/tasks` and one from `/admin/issues` produce identical system rows, stamps and notifications. The panel gets a **View conversation** link so the thread has exactly one home.

Shared components: `SupportThread`, `SupportComposer`, `SupportRequestSheet` (all in [src/components/issues/](../../../src/components/issues/)).

## 6. Hooks and query keys

[src/hooks/useSupportTickets.ts](../../../src/hooks/useSupportTickets.ts):

| Key | staleTime | Notes |
|---|---|---|
| `["support-my-tickets", userId]` | 60_000 | **`userId` is in the key on purpose** — `["tasks-assigned-by-me"]` omits it and can serve a previous session's list. Fetched ONCE and sliced per tab client-side; do not refetch per tab. |
| `["support-thread", ticketId]` | 60_000 | `refetchOnWindowFocus: true` — cheap, bounded, natural for a conversation. |
| `["support-inbox", ...]` | unchanged | existing keys preserved. |
| `["support-inbox-stats", institutionId, role]` | 60_000 | The four header cards AND the four tab badges. Also invalidated by `EditInstitutionDialog` when `is_demo` changes. `refetchOnWindowFocus: true` like the counts, and invalidated wherever `support-inbox-counts` is (useSetIssueStatus, useMarkSupportTicketRead, useResolveSupportRequest, useBackfillSupportMirrors, AdminIssuesPage.openIssue), or the cards disagree with the tab under them. |

**No realtime channel** (CLAUDE.md §23). Every mutation invalidates its thread AND the list keys directly — the sheet must follow its own writes, or a posted reply does not appear until a refetch (fix f9c88ed).

`useReportedIssues` (SALCI list) and `useSupportRequest` (intake) are separate from the above; keep their keys distinct.

## 6a. The reporting cutoff (`support_settings.stats_since`, 2026-09-28)

The Support Inbox counts from a date, and **nothing is ever deleted to make a number look right.** 65 tickets had built up, 20 of them genuine test traffic (`is_demo` schools plus two SALCI raised with no institution) and 45 of them real Alliance history. Tushar wanted the cards to start at zero and count forward and said explicitly: do not delete anything. So `support_settings.stats_since` is a reporting epoch. Move it earlier and every old number returns, because every old row is still there.

* **Both inbox RPCs read the column themselves** (`support_inbox_stats`, `support_inbox_counts`), so the four cards, the tab badges and the Awaiting SALCI chip can never disagree. Do not pass the cutoff as an argument; a caller could then lie about it.
* **The frontend applies the SAME cutoff** to the list, the board, the filter facets and the Turnaround card, via `useSupportStatsSince()`. Every one of those queries carries the cutoff in its key and waits for it (`enabled: !sincePending`), or the inbox flashes pre-cutoff rows for one round trip and then empties.
* **`["support-inbox", status, institutionId, <role#sop#since>]` must stay FOUR items.** `useSetIssueStatus` selects inbox caches with `key.length === 4`; a fifth item makes every optimistic status change silently skip the list. Role, the SOP-column flag and the cutoff share the fourth slot for that reason.
* **"Show earlier tickets" lifts the cutoff for the LIST and BOARD only**, never the cards, so the toggle cannot make a card lie. It exists because two Alliance tickets were in progress and unanswered when the cutoff was set; Tushar chose the full clean slate knowing that, and this is how they are reached.
* **`reported_issues.pinned_to_inbox` carries one ticket across the cutoff** (20260928140000). A pinned ticket counts and lists as though raised after the reset, everywhere the cutoff is read. Use it for live work that must survive a reset, and prefer it to moving `stats_since` back: a looser date silently drags in every other ticket from that window and changes what the cards mean. Unpin by setting it false.
* **Never apply the cutoff to a reporter-facing path.** `list_my_support_tickets` and `get_support_thread` do not mention `stats_since` and must not: a school keeps its whole history and an old thread still answers. Verified after the change: the reporter with 5 tickets still gets 5.

## 7. Landmines

* **Never DROP or narrow a `reported_issues` column ahead of the frontend deploy.** Dropping `admin_notes` broke the live ticket UI on 2026-08-31 and had to be re-added empty (ae93322) before being retired properly. Ship the read change first.
* **Error state before empty state**, including on the stat tiles (CLAUDE.md §6). A failed read must never render as "no tickets", and a failed open must say so rather than showing a blank sheet (fixes c499eb1, f9c88ed).
* Reporter-facing copy is surface-neutral — the intake toast must not promise "Assigned by me" or name the tasks plane.
* `MobileSheet` uses **`placement="center"`** here; `placement="bottom"` hard-codes `bg-white` and does not dark-flip.
* Status chips reuse the `STATUS_TONES` map from `AdminIssuesPage` verbatim so both sides read identically.
* Backups before schema surgery: `salci_backups.reported_issues_pre_messages_20260831` (41 tickets, 14 internal notes backfilled into the thread).

## 8. Designed but NOT shipped

Do not assume these exist; check before referencing them.

* **Attachments.** The `support-attachments` private bucket does not exist yet. When it lands: MIME allowlist + 5 MB cap **on the bucket** (not just client-side), path `<ticket_id>/<uuid>-<sanitised name>`, **paths in `attachments` jsonb, never URLs** (sign at read time, 300s), INSERT/SELECT storage policies gated on `is_uuid((storage.foldername(name))[1])` **before** the `::uuid` cast — a bare cast raises `22P02` as a hard storage failure rather than a denial. No UPDATE/DELETE policies; attachments are immutable. **The `message-attachments` bucket is NOT the model** — its policies are `bucket_id = '...' AND auth.uid() IS NOT NULL`, readable by every authenticated user on the platform.
* **Transcript PDF** (`get_support_ticket_transcript`, super-admin-only, lazy `import("jspdf")`).

## 9. System institution and intake resilience (2026-09-09)

**The incident.** On 2026-09-02 the SALCI Support container institution (code `SALCI-SUPPORT`, the private home of every support mirror task) was deleted from `/admin/institutions` in the middle of a 27-school demo cleanup. It looked like an "Inactive" test school with a Delete button. `tasks.institution_id` cascades, so every mirror task vanished; tickets and threads survived (`reported_issues.task_id` is SET NULL, `support_messages` hangs off the ticket). `create_support_task()` hard-required the container and raised `Support is not set up yet` for EVERY user for seven days. Failed intakes leave no row, so nothing on SALCI's side changed. Migration: `20260909120000_support_system_institution_resilience.sql`. Contract: `scripts/verify-support-resilience.sql` (every row PASS).

**Invariants, in order of what actually protects you:**

* **`institutions.is_system = true` marks a platform container, not a school.** `guard_system_institution()` (BEFORE DELETE / BEFORE UPDATE) refuses deletion, renaming the `code`, or un-flagging, for every role including the service-role client behind `admin-operations`. Triggers fire where RLS does not. Removing a system institution is a migration job that disables the trigger on purpose and accepts the cascade. `/admin/institutions` lists system rows read-only in a separate strip with no actions; the edge fn refuses `delete_institution` on them BEFORE its user-deletion loop.
* **Intake never depends on the mirror.** `create_support_task()` writes the ticket, then message 1, and only THEN attempts the tasks mirror and the notification, each in its own sub-transaction. A mirror failure returns `degraded: true` instead of raising. The container itself self-heals through `ensure_support_institution()` (idempotent, original id, flagged system). A missing `support_settings.owner_id` falls back to any super admin and is recorded. Do not reintroduce a `RAISE` between the thread insert and the return.
* **Every degradation is a row.** `support_health_events` (`intake_failed`, `mirror_failed`, `mirror_skipped`, `owner_missing`, `institution_reprovisioned`, `notify_failed`) is written only by `_support_record_health()`, which never raises and sends ONE coalesced `support_health` notification per hour to every super admin. No write policy, no client grant; 90-day purge via pg_cron `support-health-events-purge`.
* **The client reports what the reporter saw.** `useCreateSupportRequest.onError` calls `reportSupportIntakeFailure()` → `log_support_intake_failure(p_stage, p_error, p_page_url)` (authenticated-callable, 20/caller/hour, never raises). Keep it fire-and-forget: a telemetry failure must not become a second toast.
* **`support_health()`** (super admin) is the one read behind `SupportHealthBanner` on `/admin/issues`: `status` is `ok | degraded | down`; degraded when owner missing, any failure in 24h, any degradation event in 7d, or any open ticket without a mirror; down when the container is missing or ≥3 failures with zero intakes in 24h. The banner is silent when `ok` and renders the error state before assuming health.
* **Recovery is a button, not a script.** `support_backfill_mirror_tasks()` (super admin, idempotent) re-mirrors every open/in-progress ticket with `task_id IS NULL`, preserving `created_at`, mapping status, reporter as assigner, owner as assignee. Ran once on 2026-09-09 for the 8 orphaned tickets.

**Landmine.** Grants: both `REVOKE ... FROM PUBLIC` and `FROM anon` by name, then verify via `pg_proc.proacl` (a leading `=X/postgres` entry means PUBLIC). `ensure_support_institution()` and `_support_record_health()` must stay non-callable by `authenticated`; the verify script asserts it.