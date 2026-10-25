# Salci Support Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Salci Support loop end to end, so every reporter can track and reply to their own ticket, SALCI can reply and keep genuinely private notes, both sides are notified in-app and by email, either side can attach files, and a ticket can be exported as a transcript.

**Architecture:** A new `support_messages` table keyed to `reported_issues` carries the two-way thread, internal notes and status-change system rows, with all writes funnelled through SECURITY DEFINER RPCs so the internal/external split cannot be forged from a client. A new all-roles `/support` route, opened by the existing sidebar Salci Support button, gives reporters the surface they have never had; the existing `/admin/issues` inbox gains the same thread component. `reported_issues.admin_notes`, which is readable by the reporter today, is migrated into internal messages and dropped.

**Tech Stack:** PostgreSQL + Supabase RLS and SECURITY DEFINER RPCs, Supabase Storage, Deno edge function with Resend, React 18 + TypeScript + Vite, TanStack Query v5, Tailwind + shadcn/ui, jsPDF.

**Spec:** [docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md](../specs/2026-08-31-salci-support-workflow-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

**Verification. This repository has NO test runner.** There is no vitest, no jest, no playwright, and zero `*.test.*` files. Do not add one. The verification cycle is:
- `npm run typecheck` (= `tsc -p tsconfig.app.json --noEmit`). Never bare `npx tsc --noEmit`, which is a no-op here and once masked 77 errors.
- `npx eslint <changed paths>` with zero errors. Never silence with `// eslint-disable-next-line` or `as any`. `prefer-const` and `@typescript-eslint/no-explicit-any` are hard errors. Never edit `eslint.config.*`.
- `npx vite build` must exit 0. Bundle-size warnings over 500 kB are not failures.
- Database work is verified by SQL assertions run through `powershell -NoProfile -File scriptsun-sql.ps1 -SqlFile <file> -OutFile <out.json>`. That script takes a FILE, not a string; it reads the PAT from Windows Credential Manager target `Supabase CLI:supabase`; it writes UTF-8 **with BOM**, so parse results with `encoding='utf-8-sig'`.

**Migrations do not reach production by merging or by `supabase db push`.** `supabase_migrations.schema_migrations` is not maintained. Apply via `run-sql.ps1` and verify against `pg_policies`, `pg_proc.proacl` and `information_schema`. Regenerate types afterwards with `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw`.

**Production facts this plan is pinned to** (verified 2026-08-31, project `gyymkgohcijeksmrzuyw`):
- `reported_issues`: 41 rows. Status `closed` 21, `resolved` 16, `in_progress` 4, `open` 0. 18 have `task_id`, 23 do not. 14 have non-empty `admin_notes`. All 41 reporters resolve to a `profiles` row.
- Reporters by role: teacher 18, student 15, school_admin 6, super_admin 2.
- 0 rows in `task_comments` for all 18 support tasks.
- SALCI Support institution id `d9f3def9-7e53-43e3-9bbe-da688d5899db`; support owner `bhanu@salci.in`.
- `reported_issues.reporter_id` FK is named `reported_issues_reporter_id_fkey`.
- `salci_backups` schema exists and holds 35 backup tables.
- Only 15 of 37 active institutions have a `tasks` feature row.

**Security.** Every new SECURITY DEFINER function gets `REVOKE EXECUTE ... FROM PUBLIC` **and** `FROM anon`, by name. Both are required: revoking from anon does not strip the PUBLIC grant, and revoking from PUBLIC does not strip an explicit anon grant. Verify with `pg_proc.proacl`, not `information_schema.routine_privileges`, which does not expand PUBLIC membership. A leading `=X/postgres` ACL entry means PUBLIC still holds EXECUTE.

**Scale gate**, enforced per task: every list query bounded with `.range()`; every count or aggregate computed server-side, never `filter(...).length` over fetched rows; every `useQuery` has an explicit `staleTime` of at least `60_000`; no `select("*")`; mutations idempotent; dependent writes in one RPC; every new FK indexed in the same migration; RLS policies call SECURITY DEFINER helpers only; no `supabase.auth.getUser()` without a JWT argument; no `refetchInterval` under 30s; no new realtime channels.

**UI.** shadcn/ui only, no raw HTML buttons or inputs. No inline styles. Colors from CSS variable tokens and the `text-ink-*` scale, never raw greys; note `text-ink-800` does not exist in `tailwind.config.ts`. Cards use `surface-card frosted-shadow rounded-card`. Pages wrap in `PageShell`. Sheets use `MobileSheet` with `placement="center"`; `placement="bottom"` hard-codes `bg-white` and does not dark-flip. Every surface works at 375px and fully flips in dark mode. Loading states on every fetch, and the **error state always renders before the empty state**, so a failed read never reads as "nothing here".

**Copy.** No em-dashes in any user-facing string, including email templates and the PDF. Use a comma, a colon, or the word.

**Errors.** Every `onError` and catch-toast routes through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. Never `toast.error(error.message)`.

**Service worker.** Any form holding unsaved input sets `data-dirty="true"`, matched by `src/main.tsx` as `form[data-dirty="true"]`. It must be a `<form>` element; a `<div>` never matches.

**Task numbering:** Phase 1 = Tasks 1-7, Phase 2 = 8-14, Phase 3 = 15-20, Phase 4 = 21-26, Phase 5 = 27-30, Phase 6 = 31-35, Phase 7 = 36-37.

---

## Phase 1 - Database migration

### Task 1: Back up `reported_issues` before anything touches it

**Files:**
- Create: `supabase/migrations/20260831120000_support_messages_and_thread.sql`
- Create: `scripts/support-p1/01-backup.sql`
- Create: `scripts/support-p1/01-backup-assert.sql`

**Interfaces:**
- Consumes: nothing (first task of the phase)
- Produces: `salci_backups.reported_issues_pre_messages_20260831` (full pre-migration row copy, the only way back from the `admin_notes` drop in Task 6, and the trigger-immune source of `updated_at` for the Task 5 backfill)

- [ ] **Step 1: Create the migration file with its header**

Write `supabase/migrations/20260831120000_support_messages_and_thread.sql` with exactly this content. Every later task appends its applied section to this same file, so the file always equals what actually ran in production.

```sql
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
```

- [ ] **Step 2: Write the backup section**

Create `scripts/support-p1/01-backup.sql`:

```sql
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
```

- [ ] **Step 3: Write the assertion**

Create `scripts/support-p1/01-backup-assert.sql`. It must not reference the backup table statically, because before the migration that name does not resolve and the whole statement would fail to parse instead of returning FAIL. `query_to_xml` is VOLATILE, so it is evaluated at run time, inside the CASE branch, only when the table exists.

```sql
-- Expect FAIL before section 1, PASS after.
SELECT
  (SELECT count(*) FROM public.reported_issues)                     AS live_rows,
  to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NOT NULL
                                                                    AS backup_exists,
  CASE
    WHEN to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL
      THEN NULL
    ELSE (xpath(
            '/row/c/text()',
            query_to_xml(
              'SELECT count(*) AS c FROM salci_backups.reported_issues_pre_messages_20260831',
              false, true, '')
          ))[1]::text::bigint
  END                                                               AS backup_rows,
  CASE
    WHEN to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NOT NULL
     AND (SELECT count(*) FROM public.reported_issues) = 41
     AND (xpath(
            '/row/c/text()',
            query_to_xml(
              'SELECT count(*) AS c FROM salci_backups.reported_issues_pre_messages_20260831',
              false, true, '')
          ))[1]::text::bigint = 41
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                               AS verdict;
```

- [ ] **Step 4: Run the assertion BEFORE (expect FAIL)**

Run from the repository root. `run-sql.ps1` reads the PAT from Windows Credential Manager target `Supabase CLI:supabase` and posts to the Management API.

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\01-backup-assert.sql -OutFile "$env:TEMP\salci-p1-01-before.json"
Get-Content "$env:TEMP\salci-p1-01-before.json"
```

Expected: `"verdict":"FAIL"`, `"backup_exists":false`, `"backup_rows":null`, `"live_rows":41`. If `live_rows` is not 41, stop and reconcile the plan against production before continuing: every count in this phase is pinned to 41.

- [ ] **Step 5: Dry run inside BEGIN ... ROLLBACK**

Create `scripts/support-p1/01-backup-dryrun.sql`:

```sql
BEGIN;

CREATE SCHEMA IF NOT EXISTS salci_backups;

REVOKE ALL ON SCHEMA salci_backups FROM anon;
REVOKE ALL ON SCHEMA salci_backups FROM authenticated;

CREATE TABLE IF NOT EXISTS salci_backups.reported_issues_pre_messages_20260831 AS
SELECT * FROM public.reported_issues;

ALTER TABLE salci_backups.reported_issues_pre_messages_20260831
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM anon;
REVOKE ALL ON TABLE salci_backups.reported_issues_pre_messages_20260831 FROM authenticated;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL
         AS rolled_back_clean;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\01-backup-dryrun.sql -OutFile "$env:TEMP\salci-p1-01-dry.json"
Get-Content "$env:TEMP\salci-p1-01-dry.json"
```

Expected: HTTP 200 and `"rolled_back_clean":true`. Any HTTP ERROR means the section does not apply cleanly; fix it before Step 6.

- [ ] **Step 6: Apply for real**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\01-backup.sql -OutFile "$env:TEMP\salci-p1-01-apply.json"
Get-Content "$env:TEMP\salci-p1-01-apply.json"
```

- [ ] **Step 7: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\01-backup-assert.sql -OutFile "$env:TEMP\salci-p1-01-after.json"
Get-Content "$env:TEMP\salci-p1-01-after.json"
```

Expected: `"verdict":"PASS"`, `"backup_exists":true`, `"backup_rows":41`, `"live_rows":41`.

- [ ] **Step 8: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/01-backup.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/01-backup.sql scripts/support-p1/01-backup-assert.sql scripts/support-p1/01-backup-dryrun.sql
git commit -m "feat(support): back up reported_issues before the thread migration

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Authority helpers, `is_uuid` / `is_support_ticket_reporter` / `can_access_support_ticket`

**Files:**
- Create: `scripts/support-p1/02-helpers.sql`
- Create: `scripts/support-p1/02-helpers-assert.sql`
- Create: `scripts/support-p1/02-helpers-dryrun.sql`
- Modify: `supabase/migrations/20260831120000_support_messages_and_thread.sql` (append)

**Interfaces:**
- Consumes: `public.is_super_admin(uuid)` (already live)
- Produces: `public.is_uuid(text)`, `public.is_support_ticket_reporter(uuid)`, `public.can_access_support_ticket(uuid)`, consumed by the `support_messages` SELECT policy in Task 3, by every phase 2 RPC, and by the phase 6 storage policies

- [ ] **Step 1: Write the helpers section**

Create `scripts/support-p1/02-helpers.sql`:

```sql
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
```

- [ ] **Step 2: Write the assertion**

Create `scripts/support-p1/02-helpers-assert.sql`. It checks `pg_proc.proacl` and not `information_schema.routine_privileges`, because that view does not expand PUBLIC membership and reported a clean result over a leaking ACL in the 2026-08-14 build. A NULL `proacl` means default privileges, which for a function is EXECUTE to PUBLIC, so NULL counts as leaky.

```sql
-- Expect FAIL before section 2, PASS after.
WITH fns AS (
  SELECT p.oid, p.proname, p.proacl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('is_uuid', 'is_support_ticket_reporter', 'can_access_support_ticket')
),
leaky AS (
  SELECT proname FROM fns WHERE proacl IS NULL
  UNION ALL
  SELECT f.proname
  FROM fns f, unnest(f.proacl) AS a(entry)
  WHERE a.entry::text LIKE '=%'          -- empty grantee == PUBLIC
     OR a.entry::text LIKE 'anon=%'
),
granted AS (
  SELECT DISTINCT f.proname
  FROM fns f, unnest(coalesce(f.proacl, '{}'::aclitem[])) AS a(entry)
  WHERE a.entry::text LIKE 'authenticated=%'
)
SELECT
  (SELECT count(*) FROM fns)                                        AS fn_count,
  (SELECT count(*) FROM leaky)                                      AS leaky_acl_entries,
  (SELECT count(*) FROM granted)                                    AS authenticated_grants,
  (SELECT coalesce(string_agg(proname || ' -> ' || coalesce(array_to_string(proacl, ' | '), 'NULL(default=PUBLIC)'), E'\n'), '')
     FROM fns)                                                      AS acl_dump,
  CASE
    WHEN (SELECT count(*) FROM fns) = 3
     AND (SELECT count(*) FROM leaky) = 0
     AND (SELECT count(*) FROM granted) = 3
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                               AS verdict;
```

- [ ] **Step 3: Run the assertion BEFORE (expect FAIL)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\02-helpers-assert.sql -OutFile "$env:TEMP\salci-p1-02-before.json"
Get-Content "$env:TEMP\salci-p1-02-before.json"
```

Expected: `"verdict":"FAIL"`, `"fn_count":0`.

- [ ] **Step 4: Dry run inside BEGIN ... ROLLBACK**

Create `scripts/support-p1/02-helpers-dryrun.sql`:

```sql
BEGIN;

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

REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_uuid(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.is_uuid(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_support_ticket_reporter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated, service_role;

-- Behavioural smoke test while the functions exist, inside the transaction.
-- auth.uid() is NULL on a Management API connection, so the reporter helper
-- must return false, never NULL and never an error.
SELECT
  public.is_uuid('11111111-2222-3333-4444-555555555555') AS uuid_true,
  public.is_uuid('avatars')                              AS uuid_false,
  public.is_uuid(NULL)                                   AS uuid_null_is_false,
  public.is_support_ticket_reporter(
    (SELECT id FROM public.reported_issues ORDER BY created_at LIMIT 1))
                                                         AS reporter_false_for_nobody;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('is_uuid','is_support_ticket_reporter','can_access_support_ticket'))
         = 0 AS rolled_back_clean;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\02-helpers-dryrun.sql -OutFile "$env:TEMP\salci-p1-02-dry.json"
Get-Content "$env:TEMP\salci-p1-02-dry.json"
```

Expected: HTTP 200 and `"rolled_back_clean":true`.

- [ ] **Step 5: Apply for real**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\02-helpers.sql -OutFile "$env:TEMP\salci-p1-02-apply.json"
Get-Content "$env:TEMP\salci-p1-02-apply.json"
```

- [ ] **Step 6: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\02-helpers-assert.sql -OutFile "$env:TEMP\salci-p1-02-after.json"
Get-Content "$env:TEMP\salci-p1-02-after.json"
```

Expected: `"verdict":"PASS"`, `"fn_count":3`, `"leaky_acl_entries":0`, `"authenticated_grants":3`. Read `acl_dump` and confirm no entry begins with `=X/` and none mentions `anon`.

- [ ] **Step 7: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/02-helpers.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/02-helpers.sql scripts/support-p1/02-helpers-assert.sql scripts/support-p1/02-helpers-dryrun.sql
git commit -m "feat(support): add is_uuid and the two support ticket authority helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `support_messages` table, indexes, RLS, single SELECT policy

**Files:**
- Create: `scripts/support-p1/03-support-messages.sql`
- Create: `scripts/support-p1/03-support-messages-assert.sql`
- Create: `scripts/support-p1/03-support-messages-dryrun.sql`
- Modify: `supabase/migrations/20260831120000_support_messages_and_thread.sql` (append)

**Interfaces:**
- Consumes: `public.is_super_admin(uuid)`, `public.is_support_ticket_reporter(uuid)` from Task 2
- Produces: `public.support_messages` with columns `id, ticket_id, author_id, author_name, author_side, kind, body, is_internal, attachments, client_token, created_at`; indexes `idx_support_messages_ticket_created`, `idx_support_messages_author`, `uq_support_messages_client_token`. Consumed by Task 5 backfill, Task 6 interim RPCs, and every phase 2 RPC.

- [ ] **Step 1: Write the table section**

Create `scripts/support-p1/03-support-messages.sql`:

```sql
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
```

- [ ] **Step 2: Write the assertion**

Create `scripts/support-p1/03-support-messages-assert.sql`. Catalog-only, so it parses before the table exists.

```sql
-- Expect FAIL before section 3, PASS after.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'support_messages')      AS tbl,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND column_name IN ('id','ticket_id','author_id','author_name','author_side',
                           'kind','body','is_internal','attachments','client_token',
                           'created_at'))                                    AS cols,
  (SELECT coalesce(bool_or(c.relrowsecurity), false)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'support_messages')           AS rls_enabled,
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'support_messages'
       AND indexname IN ('idx_support_messages_ticket_created',
                         'idx_support_messages_author',
                         'uq_support_messages_client_token'))                AS idx,
  (SELECT count(*) FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relname = 'uq_support_messages_client_token'
      AND i.indisunique AND i.indpred IS NOT NULL)                           AS partial_unique_ok,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'support_messages')         AS policies_total,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'support_messages'
       AND cmd <> 'SELECT')                                                  AS write_policies,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND grantee = 'anon')                                                 AS anon_grants,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'support_messages'
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT')         AS authenticated_write_grants,
  (SELECT count(*) FROM pg_constraint
     WHERE conrelid = to_regclass('public.support_messages')
       AND contype = 'f' AND confdeltype = 'n')                              AS fks_set_null,
  CASE
    WHEN (SELECT count(*) FROM information_schema.tables
            WHERE table_schema='public' AND table_name='support_messages') = 1
     AND (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='support_messages'
              AND column_name IN ('id','ticket_id','author_id','author_name','author_side',
                                  'kind','body','is_internal','attachments','client_token',
                                  'created_at')) = 11
     AND (SELECT coalesce(bool_or(c.relrowsecurity), false)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='public' AND c.relname='support_messages')
     AND (SELECT count(*) FROM pg_indexes
            WHERE schemaname='public' AND tablename='support_messages'
              AND indexname IN ('idx_support_messages_ticket_created',
                                'idx_support_messages_author',
                                'uq_support_messages_client_token')) = 3
     AND (SELECT count(*) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
           WHERE ic.relname='uq_support_messages_client_token'
             AND i.indisunique AND i.indpred IS NOT NULL) = 1
     AND (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename='support_messages') = 1
     AND (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename='support_messages'
              AND cmd <> 'SELECT') = 0
     AND (SELECT count(*) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='support_messages'
              AND grantee='anon') = 0
     AND (SELECT count(*) FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='support_messages'
              AND grantee='authenticated' AND privilege_type <> 'SELECT') = 0
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                        AS verdict;
```

- [ ] **Step 3: Run the assertion BEFORE (expect FAIL)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\03-support-messages-assert.sql -OutFile "$env:TEMP\salci-p1-03-before.json"
Get-Content "$env:TEMP\salci-p1-03-before.json"
```

Expected: `"verdict":"FAIL"`, `"tbl":0`, `"cols":0`.

- [ ] **Step 4: Dry run inside BEGIN ... ROLLBACK, with a behaviour probe**

Create `scripts/support-p1/03-support-messages-dryrun.sql`. It proves the partial unique index actually blocks a repeated token and actually permits many NULLs, before the real apply.

```sql
BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON public.support_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_author
  ON public.support_messages(author_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_token
  ON public.support_messages(client_token)
  WHERE client_token IS NOT NULL;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support participants read the thread" ON public.support_messages;
CREATE POLICY "Support participants read the thread"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_super_admin((SELECT auth.uid()))
    OR (public.is_support_ticket_reporter(ticket_id) AND NOT is_internal)
  );

REVOKE ALL ON TABLE public.support_messages FROM anon;
REVOKE ALL ON TABLE public.support_messages FROM authenticated;
GRANT SELECT ON TABLE public.support_messages TO authenticated;

-- Two NULL tokens coexist; a repeated token is rejected.
INSERT INTO public.support_messages (ticket_id, author_side, body)
SELECT id, 'system', 'dry run a' FROM public.reported_issues ORDER BY created_at LIMIT 1;
INSERT INTO public.support_messages (ticket_id, author_side, body)
SELECT id, 'system', 'dry run b' FROM public.reported_issues ORDER BY created_at LIMIT 1;
INSERT INTO public.support_messages (ticket_id, author_side, body, client_token)
SELECT id, 'reporter', 'dry run c', '00000000-0000-4000-8000-000000000001'
FROM public.reported_issues ORDER BY created_at LIMIT 1;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.support_messages (ticket_id, author_side, body, client_token)
    SELECT id, 'reporter', 'dry run d', '00000000-0000-4000-8000-000000000001'
    FROM public.reported_issues ORDER BY created_at LIMIT 1;
    RAISE EXCEPTION 'DRY RUN FAILED: duplicate client_token was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'duplicate client_token correctly rejected';
  END;
END $$;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       to_regclass('public.support_messages') IS NULL AS rolled_back_clean;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\03-support-messages-dryrun.sql -OutFile "$env:TEMP\salci-p1-03-dry.json"
Get-Content "$env:TEMP\salci-p1-03-dry.json"
```

Expected: HTTP 200 and `"rolled_back_clean":true`. An HTTP ERROR mentioning `DRY RUN FAILED` means the partial unique index is not doing its job; fix it before applying.

- [ ] **Step 5: Apply for real**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\03-support-messages.sql -OutFile "$env:TEMP\salci-p1-03-apply.json"
Get-Content "$env:TEMP\salci-p1-03-apply.json"
```

- [ ] **Step 6: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\03-support-messages-assert.sql -OutFile "$env:TEMP\salci-p1-03-after.json"
Get-Content "$env:TEMP\salci-p1-03-after.json"
```

Expected: `"verdict":"PASS"`, `"cols":11`, `"rls_enabled":true`, `"idx":3`, `"partial_unique_ok":1`, `"policies_total":1`, `"write_policies":0`, `"anon_grants":0`, `"authenticated_write_grants":0`, `"fks_set_null":1` (the `author_id` FK; `ticket_id` is CASCADE by design).

- [ ] **Step 7: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/03-support-messages.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/03-support-messages.sql scripts/support-p1/03-support-messages-assert.sql scripts/support-p1/03-support-messages-dryrun.sql
git commit -m "feat(support): add support_messages with read-only RLS and no write policy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `reported_issues` columns, status CHECK, index, and `reporter_id` to nullable SET NULL

**Files:**
- Create: `scripts/support-p1/04-fk-lookup.sql`
- Create: `scripts/support-p1/04-reported-issues.sql`
- Create: `scripts/support-p1/04-reported-issues-assert.sql`
- Create: `scripts/support-p1/04-reported-issues-dryrun.sql`
- Modify: `supabase/migrations/20260831120000_support_messages_and_thread.sql` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of `support_messages`)
- Produces: `reported_issues.category`, `.priority`, `.last_message_at`, `.reporter_last_read_at`, `.salci_last_read_at`, `.first_response_at`, `.resolved_at`; constraint `reported_issues_status_check`; index `idx_reported_issues_last_message`; `reporter_id` nullable with `ON DELETE SET NULL`. Consumed by Task 5, Task 6 and every phase 2 RPC.

- [ ] **Step 1: Look up the real FK constraint name**

Create `scripts/support-p1/04-fk-lookup.sql`:

```sql
SELECT
  c.conname                                   AS constraint_name,
  pg_get_constraintdef(c.oid)                 AS definition,
  c.confdeltype                               AS on_delete_code,
  (SELECT a.attnotnull FROM pg_attribute a
    WHERE a.attrelid = c.conrelid AND a.attname = 'reporter_id') AS reporter_id_not_null
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.conrelid = 'public.reported_issues'::regclass
  AND c.contype = 'f'
  AND a.attname = 'reporter_id';
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\04-fk-lookup.sql -OutFile "$env:TEMP\salci-p1-04-fk.json"
Get-Content "$env:TEMP\salci-p1-04-fk.json"
```

Expected: one row, `on_delete_code` `c` (CASCADE) and `reporter_id_not_null` true. Record the `constraint_name` value. The migration drops it by looked-up name in a DO block rather than by a hardcoded guess, so it is correct whatever this prints.

- [ ] **Step 2: Write the alteration section**

Create `scripts/support-p1/04-reported-issues.sql`:

```sql
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
```

- [ ] **Step 3: Write the assertion**

Create `scripts/support-p1/04-reported-issues-assert.sql`:

```sql
-- Expect FAIL before section 4, PASS after.
WITH cols AS (
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'reported_issues'
),
fk AS (
  SELECT c.conname, c.confdeltype
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.reported_issues'::regclass
    AND c.contype = 'f'
    AND a.attname = 'reporter_id'
)
SELECT
  (SELECT count(*) FROM cols
    WHERE column_name IN ('category','priority','last_message_at',
                          'reporter_last_read_at','salci_last_read_at',
                          'first_response_at','resolved_at'))            AS new_cols,
  (SELECT is_nullable FROM cols WHERE column_name = 'reporter_id')       AS reporter_id_nullable,
  (SELECT count(*) FROM fk WHERE confdeltype = 'n')                      AS fk_set_null,
  (SELECT string_agg(conname || ':' || confdeltype, ',') FROM fk)        AS fk_dump,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.reported_issues'::regclass
      AND conname = 'reported_issues_status_check'
      AND contype = 'c' AND convalidated)                                AS status_check_validated,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'reported_issues'
      AND indexname = 'idx_reported_issues_last_message')                AS last_message_index,
  (SELECT count(*) FROM public.reported_issues
    WHERE status NOT IN ('open','in_progress','resolved','closed'))      AS rogue_statuses,
  CASE
    WHEN (SELECT count(*) FROM cols
            WHERE column_name IN ('category','priority','last_message_at',
                                  'reporter_last_read_at','salci_last_read_at',
                                  'first_response_at','resolved_at')) = 7
     AND (SELECT is_nullable FROM cols WHERE column_name = 'reporter_id') = 'YES'
     AND (SELECT count(*) FROM fk WHERE confdeltype = 'n') = 1
     AND (SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.reported_issues'::regclass
              AND conname = 'reported_issues_status_check'
              AND contype = 'c' AND convalidated) = 1
     AND (SELECT count(*) FROM pg_indexes
            WHERE schemaname='public' AND tablename='reported_issues'
              AND indexname='idx_reported_issues_last_message') = 1
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                    AS verdict;
```

- [ ] **Step 4: Run the assertion BEFORE (expect FAIL)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\04-reported-issues-assert.sql -OutFile "$env:TEMP\salci-p1-04-before.json"
Get-Content "$env:TEMP\salci-p1-04-before.json"
```

Expected: `"verdict":"FAIL"`, `"new_cols":0`, `"reporter_id_nullable":"NO"`, `"fk_set_null":0`, `"rogue_statuses":0`.

- [ ] **Step 5: Dry run inside BEGIN ... ROLLBACK**

Create `scripts/support-p1/04-reported-issues-dryrun.sql`:

```sql
BEGIN;

ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS priority              smallint,
  ADD COLUMN IF NOT EXISTS last_message_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reporter_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS salci_last_read_at    timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz;

ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;
ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')) NOT VALID;
ALTER TABLE public.reported_issues
  VALIDATE CONSTRAINT reported_issues_status_check;

CREATE INDEX IF NOT EXISTS idx_reported_issues_last_message
  ON public.reported_issues(last_message_at DESC);

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
  END IF;
END $$;

ALTER TABLE public.reported_issues ALTER COLUMN reporter_id DROP NOT NULL;

ALTER TABLE public.reported_issues
  ADD CONSTRAINT reported_issues_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reported_issues_reporter_created
  ON public.reported_issues(reporter_id, created_at DESC);

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'reported_issues'
           AND column_name = 'resolved_at') = 0 AS rolled_back_clean;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\04-reported-issues-dryrun.sql -OutFile "$env:TEMP\salci-p1-04-dry.json"
Get-Content "$env:TEMP\salci-p1-04-dry.json"
```

Expected: HTTP 200 and `"rolled_back_clean":true`. If `VALIDATE CONSTRAINT` errors, a row holds a status outside the four; find it with the `rogue_statuses` figure from Step 4 before proceeding.

- [ ] **Step 6: Apply for real**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\04-reported-issues.sql -OutFile "$env:TEMP\salci-p1-04-apply.json"
Get-Content "$env:TEMP\salci-p1-04-apply.json"
```

- [ ] **Step 7: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\04-reported-issues-assert.sql -OutFile "$env:TEMP\salci-p1-04-after.json"
Get-Content "$env:TEMP\salci-p1-04-after.json"
```

Expected: `"verdict":"PASS"`, `"new_cols":7`, `"reporter_id_nullable":"YES"`, `"fk_set_null":1`, `"status_check_validated":1`, `"last_message_index":1`.

- [ ] **Step 8: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/04-reported-issues.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/04-fk-lookup.sql scripts/support-p1/04-reported-issues.sql scripts/support-p1/04-reported-issues-assert.sql scripts/support-p1/04-reported-issues-dryrun.sql
git commit -m "feat(support): add ticket metadata columns and stop cascading ticket history away

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Backfill the thread from the 41 existing tickets

**Files:**
- Create: `scripts/support-p1/05-backfill.sql`
- Create: `scripts/support-p1/05-backfill-assert.sql`
- Create: `scripts/support-p1/05-backfill-dryrun.sql`
- Modify: `supabase/migrations/20260831120000_support_messages_and_thread.sql` (append)

**Interfaces:**
- Consumes: `salci_backups.reported_issues_pre_messages_20260831` (Task 1), `public.support_messages` (Task 3), the seven new `reported_issues` columns (Task 4)
- Produces: 41 seed `reporter` messages, 14 `is_internal` messages, populated `last_message_at` / `resolved_at` / `priority` / `category`. Consumed by Task 6, which can only drop `admin_notes` once its 14 rows live somewhere else.

- [ ] **Step 1: Write the backfill section**

Create `scripts/support-p1/05-backfill.sql`. Note the ordering constraint written into the comments: every timestamp is sourced from the backup table, because `update_reported_issues_updated_at` bumps `updated_at` on the very first UPDATE this section performs.

```sql
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
```

- [ ] **Step 2: Write the assertion**

Create `scripts/support-p1/05-backfill-assert.sql`:

```sql
-- Expect FAIL before section 5, PASS after.
SELECT
  (SELECT count(*) FROM public.reported_issues)                            AS tickets,
  (SELECT count(*) FROM public.reported_issues r
     WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                        WHERE m.ticket_id = r.id AND m.author_side = 'reporter'))
                                                                           AS tickets_without_seed,
  (SELECT count(*) FROM public.support_messages WHERE is_internal)         AS internal_messages,
  (SELECT count(*) FROM public.support_messages)                           AS messages_total,
  (SELECT count(*) FROM public.reported_issues WHERE last_message_at IS NULL)
                                                                           AS missing_last_message,
  (SELECT count(*) FROM public.reported_issues
     WHERE status IN ('resolved','closed') AND resolved_at IS NULL)        AS missing_resolved_at,
  (SELECT count(*) FROM public.reported_issues
     WHERE status NOT IN ('resolved','closed') AND resolved_at IS NOT NULL)
                                                                           AS wrongly_resolved_at,
  (SELECT count(*) FROM public.support_messages m
     LEFT JOIN public.profiles p ON p.id = m.author_id
    WHERE m.author_id IS NOT NULL AND p.id IS NULL)                        AS orphan_authors,
  (SELECT count(*) FROM public.reported_issues WHERE priority IS NOT NULL) AS with_priority,
  (SELECT count(*) FROM public.reported_issues WHERE category IS NOT NULL) AS with_category,
  (SELECT count(*) FROM public.reported_issues WHERE first_response_at IS NOT NULL)
                                                                           AS with_first_response,
  CASE
    WHEN (SELECT count(*) FROM public.reported_issues) = 41
     AND (SELECT count(*) FROM public.reported_issues r
            WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                               WHERE m.ticket_id = r.id AND m.author_side = 'reporter')) = 0
     AND (SELECT count(*) FROM public.support_messages WHERE is_internal) = 14
     AND (SELECT count(*) FROM public.support_messages) = 55
     AND (SELECT count(*) FROM public.reported_issues WHERE last_message_at IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues
            WHERE status IN ('resolved','closed') AND resolved_at IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues
            WHERE status NOT IN ('resolved','closed') AND resolved_at IS NOT NULL) = 0
     AND (SELECT count(*) FROM public.support_messages m
            LEFT JOIN public.profiles p ON p.id = m.author_id
           WHERE m.author_id IS NOT NULL AND p.id IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues WHERE priority IS NOT NULL) = 18
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                      AS verdict;
```

- [ ] **Step 3: Run the assertion BEFORE (expect FAIL)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\05-backfill-assert.sql -OutFile "$env:TEMP\salci-p1-05-before.json"
Get-Content "$env:TEMP\salci-p1-05-before.json"
```

Expected: `"verdict":"FAIL"`, `"tickets_without_seed":41`, `"messages_total":0`, `"internal_messages":0`.

- [ ] **Step 4: Dry run inside BEGIN ... ROLLBACK, asserting inside the transaction**

Create `scripts/support-p1/05-backfill-dryrun.sql`. The DO block raises if the counts are wrong, which turns a bad backfill into an HTTP ERROR from the API rather than a silent commit.

```sql
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
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\05-backfill-dryrun.sql -OutFile "$env:TEMP\salci-p1-05-dry.json"
Get-Content "$env:TEMP\salci-p1-05-dry.json"
```

Expected: HTTP 200 and `"rolled_back_clean":true`. Any `DRY RUN FAILED` message names exactly which count is wrong; fix the backfill before applying.

- [ ] **Step 5: Apply for real**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\05-backfill.sql -OutFile "$env:TEMP\salci-p1-05-apply.json"
Get-Content "$env:TEMP\salci-p1-05-apply.json"
```

- [ ] **Step 6: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\05-backfill-assert.sql -OutFile "$env:TEMP\salci-p1-05-after.json"
Get-Content "$env:TEMP\salci-p1-05-after.json"
```

Expected: `"verdict":"PASS"`, `"tickets":41`, `"tickets_without_seed":0`, `"internal_messages":14`, `"messages_total":55`, `"missing_last_message":0`, `"missing_resolved_at":0`, `"wrongly_resolved_at":0`, `"orphan_authors":0`, `"with_priority":18`, `"with_first_response":0`. `with_category` is informational: it counts only the linked tasks whose description carried a `Category: ` line, so any value from 0 to 18 is correct.

- [ ] **Step 7: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/05-backfill.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/05-backfill.sql scripts/support-p1/05-backfill-assert.sql scripts/support-p1/05-backfill-dryrun.sql
git commit -m "feat(support): backfill the thread for all 41 tickets and the 14 internal notes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Drop `admin_notes`, narrow the SELECT policy, keep the two live RPCs working

**Files:**
- Create: `scripts/support-p1/06-drop-admin-notes.sql`
- Create: `scripts/support-p1/06-drop-admin-notes-assert.sql`
- Create: `scripts/support-p1/06-drop-admin-notes-dryrun.sql`
- Modify: `supabase/migrations/20260831120000_support_messages_and_thread.sql` (append)
- Modify: `src/hooks/useReportedIssues.ts:27-43`, `src/hooks/useReportedIssues.ts:61-62`
- Modify: `src/components/issues/IssueDetailSheet.tsx:53-71`, `src/components/issues/IssueDetailSheet.tsx:159-168`

**Interfaces:**
- Consumes: `public.support_messages` (Task 3), the internal messages written by Task 5
- Produces: `reported_issues` with no `admin_notes` column, SELECT policy `Super admins view all reports`, and interim `set_support_ticket_status` / `resolve_support_task` that route a note into `support_messages` instead. Phase 2 replaces both function bodies; the signatures here are unchanged so nothing downstream moves.

- [ ] **Step 1: Re-grep for direct readers of `reported_issues` (spec risk 1)**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
git grep -n "admin_notes" -- src supabase/functions
git grep -n "from(\"reported_issues\")" -- src
```

The only expected hits are `src/hooks/useReportedIssues.ts` (two `.from("reported_issues")` calls, both super-admin inbox reads, plus the `admin_notes` type and column-list entries) and `src/components/issues/IssueDetailSheet.tsx` (two `issue.admin_notes` reads). If anything else appears, stop: narrowing the SELECT policy will break it and that surface must be handled in this same commit.

- [ ] **Step 2: Write the drop section**

Create `scripts/support-p1/06-drop-admin-notes.sql`. The two `CREATE OR REPLACE`s are not optional: both live functions write `admin_notes` today, and dropping the column under them raises 42703 on every status change, including the support owner's Resolve button in `/tasks`.

```sql
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
```

- [ ] **Step 3: Write the assertion**

Create `scripts/support-p1/06-drop-admin-notes-assert.sql`:

```sql
-- Expect FAIL before section 6, PASS after.
WITH pol AS (
  SELECT policyname, cmd, qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'reported_issues' AND cmd = 'SELECT'
),
rpc AS (
  SELECT p.proname, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('set_support_ticket_status', 'resolve_support_task')
)
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reported_issues'
       AND column_name = 'admin_notes')                       AS admin_notes_col,
  (SELECT count(*) FROM pol)                                  AS select_policies,
  (SELECT count(*) FROM pol WHERE policyname = 'Super admins view all reports')
                                                              AS narrowed_policy,
  (SELECT count(*) FROM pol WHERE qual ILIKE '%reporter_id%') AS reporter_readable,
  (SELECT count(*) FROM rpc)                                  AS rpcs_present,
  (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%admin_notes%')
                                                              AS rpcs_still_writing_admin_notes,
  (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%support_messages%')
                                                              AS rpcs_filing_internal_messages,
  (SELECT count(*) FROM public.support_messages WHERE is_internal)
                                                              AS internal_messages_preserved,
  CASE
    WHEN (SELECT count(*) FROM information_schema.columns
            WHERE table_schema='public' AND table_name='reported_issues'
              AND column_name='admin_notes') = 0
     AND (SELECT count(*) FROM pol) = 1
     AND (SELECT count(*) FROM pol WHERE policyname='Super admins view all reports') = 1
     AND (SELECT count(*) FROM pol WHERE qual ILIKE '%reporter_id%') = 0
     AND (SELECT count(*) FROM rpc) = 2
     AND (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%admin_notes%') = 0
     AND (SELECT count(*) FROM rpc WHERE prosrc ILIKE '%support_messages%') = 2
     AND (SELECT count(*) FROM public.support_messages WHERE is_internal) = 14
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                         AS verdict;
```

- [ ] **Step 4: Run the assertion BEFORE (expect FAIL)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\06-drop-admin-notes-assert.sql -OutFile "$env:TEMP\salci-p1-06-before.json"
Get-Content "$env:TEMP\salci-p1-06-before.json"
```

Expected: `"verdict":"FAIL"`, `"admin_notes_col":1`, `"reporter_readable":1`, `"rpcs_still_writing_admin_notes":2`.

- [ ] **Step 5: Dry run inside BEGIN ... ROLLBACK**

Create `scripts/support-p1/06-drop-admin-notes-dryrun.sql`. Rather than repeating both 120-line function bodies, this proves the two irreversible statements apply and that the RPCs no longer reference the column, using the real section file as the source of truth for the bodies. Run the section file's function halves first in the same transaction by executing the whole section, then rolling back:

```sql
BEGIN;

ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS admin_notes;

DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
CREATE POLICY "Super admins view all reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));

DO $$
DECLARE
  v_leftover integer;
BEGIN
  SELECT count(*) INTO v_leftover
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ILIKE '%admin_notes%';

  IF v_leftover > 0 THEN
    RAISE EXCEPTION
      'DRY RUN FAILED: % function(s) still reference admin_notes; rewrite them before dropping the column',
      v_leftover;
  END IF;
END $$;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='reported_issues'
           AND column_name='admin_notes') = 1 AS rolled_back_clean;
```

Run it BEFORE applying the section. It is expected to return an HTTP ERROR naming two leftover functions, which is the point: it proves the guard works and that the column cannot be dropped out from under the live RPCs.

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\06-drop-admin-notes-dryrun.sql -OutFile "$env:TEMP\salci-p1-06-dry1.json"
Get-Content "$env:TEMP\salci-p1-06-dry1.json"
```

Expected: `HTTP ERROR` with `DRY RUN FAILED: 2 function(s) still reference admin_notes`.

- [ ] **Step 6: Apply the section for real, then re-run the dry run as a guard**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\06-drop-admin-notes.sql -OutFile "$env:TEMP\salci-p1-06-apply.json"
Get-Content "$env:TEMP\salci-p1-06-apply.json"
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\06-drop-admin-notes-dryrun.sql -OutFile "$env:TEMP\salci-p1-06-dry2.json"
Get-Content "$env:TEMP\salci-p1-06-dry2.json"
```

The second run is now expected to return HTTP 200 with `"rolled_back_clean":false`, because the column is genuinely gone and the guard finds zero leftover functions.

- [ ] **Step 7: Run the assertion AFTER (expect PASS)**

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\06-drop-admin-notes-assert.sql -OutFile "$env:TEMP\salci-p1-06-after.json"
Get-Content "$env:TEMP\salci-p1-06-after.json"
```

Expected: `"verdict":"PASS"`, `"admin_notes_col":0`, `"select_policies":1`, `"narrowed_policy":1`, `"reporter_readable":0`, `"rpcs_still_writing_admin_notes":0`, `"rpcs_filing_internal_messages":2`, `"internal_messages_preserved":14`.

- [ ] **Step 8: Stop the client selecting the dropped column**

The inbox names `admin_notes` in its explicit column list; leaving it there makes every inbox read fail with 42703. Edit `src/hooks/useReportedIssues.ts`, removing the interface field:

```ts
export interface ReportedIssue {
  id: string;
  reporter_id: string;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_role: string | null;
  institution_id: string | null;
  institution_name: string | null;
  classes_assigned: string | null;
  subject: string;
  description: string;
  status: string;
  task_id: string | null;
  created_at: string;
  updated_at: string;
}
```

and the column list, which must stay one unbroken literal so supabase-js keeps the parsed row type:

```ts
/** Explicit column list: reported_issues carries free-text descriptions and is
 *  read on every inbox open, so `select("*")` is not acceptable here.
 *
 *  `admin_notes` is gone: the column was dropped on 2026-08-31 because the
 *  SELECT policy let the reporter read it. Internal notes now live in
 *  support_messages with is_internal = true.
 *
 *  One unbroken literal on purpose: supabase-js parses the selection with
 *  template literal types, and string concatenation widens this to `string`,
 *  which collapses the row type to GenericStringError[]. */
const ISSUE_COLUMNS =
  "id, reporter_id, reporter_name, reporter_email, reporter_role, institution_id, institution_name, classes_assigned, subject, description, status, task_id, created_at, updated_at" as const;
```

- [ ] **Step 9: Make the notes box write-only in `IssueDetailSheet`**

The `Textarea` still works, because `set_support_ticket_status` now files `p_note` as an internal thread message. It just cannot show a stored value any more. Edit `src/components/issues/IssueDetailSheet.tsx`, replacing the reset effect and the `dirty` line:

```tsx
  // Reset the draft when a DIFFERENT ticket is opened, keyed on the ticket id.
  //
  // The previous version compared the draft status against issue.status during
  // render and reset whenever they differed, which meant selecting a new status
  // immediately snapped back to the stored one. The dropdown could never be
  // changed, so every save posted the unchanged status.
  //
  // The note box is write-only now: admin_notes was dropped on 2026-08-31 and
  // a note is filed as an internal message on the thread, which phase 4 renders
  // in this sheet.
  const loadedId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (issue && loadedId.current !== issue.id) {
      loadedId.current = issue.id;
      setDraftStatus((issue.status as IssueStatus) ?? "open");
      setNotes("");
    }
  }, [issue]);

  if (!issue) return null;

  const dirty = draftStatus !== issue.status || notes.trim().length > 0;
```

and the notes block:

```tsx
        <div className="grid gap-2">
          <Label htmlFor="issue-notes">Internal note</Label>
          <Textarea
            id="issue-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you found, what you did."
            rows={3}
          />
          <p className="text-xs text-ink-500">
            Saved to this ticket as an internal note. The reporter never sees it.
          </p>
        </div>
```

- [ ] **Step 10: Verify the frontend**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/hooks/useReportedIssues.ts src/components/issues/IssueDetailSheet.tsx
npx vite build
```

All three must exit 0. `src/integrations/supabase/types.ts` still declares `admin_notes`, which is harmless because nothing selects or writes it any more; phase 2 regenerates the file from production.

- [ ] **Step 11: Append the applied section to the migration file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
printf '\n' >> supabase/migrations/20260831120000_support_messages_and_thread.sql
cat scripts/support-p1/06-drop-admin-notes.sql >> supabase/migrations/20260831120000_support_messages_and_thread.sql
```

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260831120000_support_messages_and_thread.sql scripts/support-p1/06-drop-admin-notes.sql scripts/support-p1/06-drop-admin-notes-assert.sql scripts/support-p1/06-drop-admin-notes-dryrun.sql src/hooks/useReportedIssues.ts src/components/issues/IssueDetailSheet.tsx
git commit -m "fix(support): drop admin_notes and narrow reported_issues reads to super admins

The column the inbox labelled Internal notes was readable by the reporter
through the Users can view own reports SELECT policy, and 14 rows held text
in it. The notes are migrated to internal support_messages, the column is
dropped, and the SELECT policy no longer admits reporters. Both live status
RPCs are rewritten first so nothing writes a column that is about to go.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rollback scripts, including defusing the booby-trapped one

**Files:**
- Create: `scripts/rollback-salci-support-messages.sql`
- Modify: `scripts/rollback-salci-support-tasks.sql:1-25`
- Create: `scripts/support-p1/07-rollback-dryrun.sql`

**Interfaces:**
- Consumes: everything Tasks 1 to 6 produced
- Produces: a rollback that actually runs, and a repaired 2026-08-14 rollback that no longer bricks task updates platform-wide

- [ ] **Step 1: Write the new rollback**

Create `scripts/rollback-salci-support-messages.sql`:

```sql
-- Rollback for supabase/migrations/20260831120000_support_messages_and_thread.sql
--
-- BREAK GLASS ONLY. Step 3 restores the "Users can view own reports" SELECT
-- policy, and step 1 restores admin_notes with its 14 rows of SALCI notes.
-- Together they REINSTATE THE CONFIDENTIALITY LEAK the migration existed to
-- close: every reporter can once again read SALCI's private notes on their own
-- ticket. Do not run this to tidy up. Run it only to recover a broken
-- production, and re-apply the forward migration as soon as the cause is fixed.
--
-- Run through the Management API:
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/rollback-salci-support-messages.sql -OutFile "%TEMP%\rollback.json"
--
-- Order matters throughout: the RPCs are restored before the column they write
-- is dropped from under them, and support_messages goes before the helpers its
-- policy calls.

-- ---------------------------------------------------------------------------
-- 0. Refuse to run if phase 2 or later shipped
--
-- _support_apply_status and the jsonb set_support_ticket_status are built on
-- support_messages. Dropping the table under them leaves broken functions
-- rather than a clean rollback.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_support_apply_status'
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is applied. Roll back the support RPCs first, then run this script.';
  END IF;

  IF to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL THEN
    RAISE EXCEPTION
      'The pre-migration backup is missing. Without it admin_notes cannot be restored; do not continue.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Restore admin_notes and its 14 rows from the backup
-- ---------------------------------------------------------------------------
ALTER TABLE public.reported_issues ADD COLUMN IF NOT EXISTS admin_notes text;

UPDATE public.reported_issues r
SET admin_notes = b.admin_notes
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id
  AND b.admin_notes IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Restore the two RPC bodies exactly as 20260814150000 left them
-- ---------------------------------------------------------------------------
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

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    INSERT INTO public.task_comments (task_id, user_id, content)
    VALUES (p_task_id, v_uid, v_note);
  END IF;

  IF v_status = 'completed' OR v_status = v_new THEN
    UPDATE public.reported_issues
    SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
        admin_notes = coalesce(v_note, admin_notes),
        updated_at = now()
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
    RAISE EXCEPTION 'Could not update this support request. Please refresh and try again.';
  END IF;

  UPDATE public.reported_issues
  SET status = CASE WHEN v_new = 'completed' THEN 'resolved' ELSE 'closed' END,
      admin_notes = coalesce(v_note, admin_notes),
      updated_at = now()
  WHERE task_id = p_task_id;
END;
$$;

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
      admin_notes = coalesce(v_note, admin_notes),
      updated_at  = now()
  WHERE id = p_ticket_id;

  IF v_task IS NULL THEN
    RETURN;
  END IF;

  SELECT status INTO v_task_status FROM public.tasks WHERE id = v_task;
  IF v_task_status IS NULL OR v_task_status = 'completed' THEN
    RETURN;
  END IF;

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

-- ---------------------------------------------------------------------------
-- 3. Restore the original SELECT policy. THIS REINSTATES THE LEAK.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
CREATE POLICY "Users can view own reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Drop the added columns, constraint and index
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_reported_issues_last_message;

ALTER TABLE public.reported_issues
  DROP CONSTRAINT IF EXISTS reported_issues_status_check;

ALTER TABLE public.reported_issues
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS last_message_at,
  DROP COLUMN IF EXISTS reporter_last_read_at,
  DROP COLUMN IF EXISTS salci_last_read_at,
  DROP COLUMN IF EXISTS first_response_at,
  DROP COLUMN IF EXISTS resolved_at;

-- ---------------------------------------------------------------------------
-- 5. Restore reporter_id to NOT NULL + ON DELETE CASCADE
--
-- Only when no row has already been nulled by a user deletion. If one has, the
-- NOT NULL cannot be restored without destroying that ticket, so the FK is
-- returned to CASCADE and the column is left nullable, which is reported.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_con   text;
  v_nulls integer;
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
  END IF;

  ALTER TABLE public.reported_issues
    ADD CONSTRAINT reported_issues_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  SELECT count(*) INTO v_nulls
  FROM public.reported_issues WHERE reporter_id IS NULL;

  IF v_nulls = 0 THEN
    ALTER TABLE public.reported_issues ALTER COLUMN reporter_id SET NOT NULL;
  ELSE
    RAISE WARNING
      'reporter_id left nullable: % ticket(s) belong to a deleted user and would be destroyed by restoring NOT NULL.',
      v_nulls;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Drop the thread and its helpers
--
-- SECTION 6 IS ONLY SAFE WHILE NOTHING ELSE DEPENDS ON THESE HELPERS.
-- Phase 6 (Task 32) creates two storage.objects policies that call
-- can_access_support_ticket() and is_uuid(). A policy is a tracked pg_depend
-- dependency, so once Phase 6 is applied these DROP FUNCTION statements raise
-- 2BP01 and abort this script AFTER section 1 restored admin_notes and section 3
-- restored the leaking SELECT policy. Task 32 therefore inserts a section 5b
-- into this file that drops those policies and the bucket first. If you are
-- reading this file and section 5b is missing while the bucket exists, add it
-- before running anything.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.support_messages;

DROP FUNCTION IF EXISTS public.can_access_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_support_ticket_reporter(uuid);
DROP FUNCTION IF EXISTS public.is_uuid(text);

-- The backup table is deliberately left in place. Drop it by hand, only after
-- confirming the rollback restored what you expected:
--   DROP TABLE salci_backups.reported_issues_pre_messages_20260831;
```

- [ ] **Step 2: Defuse `rollback-salci-support-tasks.sql`**

Replace the whole file. As written it drops `get_support_institution_id()` while `guard_support_task_mutations()` and its two triggers still call it, and a plpgsql body is not a tracked dependency, so the drop succeeds and every subsequent UPDATE or DELETE on `tasks` raises 42883 platform-wide. Write `scripts/rollback-salci-support-tasks.sql`:

```sql
-- Rollback for 20260814120000_salci_support_tasks.sql
--   and its companion 20260814130000_guard_support_task_mutations.sql
--
-- DANGER, and why this file was rewritten on 2026-08-31:
--
-- The original version dropped get_support_institution_id() but left
-- guard_support_task_mutations() and its two triggers on public.tasks in
-- place. A plpgsql body is not a tracked dependency, so the DROP succeeded and
-- every UPDATE and DELETE on tasks then raised
--   42883: function public.get_support_institution_id() does not exist
-- for every user in every school. Running it as written would have taken the
-- entire Tasks module down platform-wide.
--
-- Order is now: dependents first (policy, triggers, trigger function), then the
-- functions they call.
--
-- This also drops resolve_support_task(uuid, text, text), which is live at
-- src/components/tms/TaskDetailPanel.tsx via useResolveSupportRequest. The
-- support owner loses the Resolve action on /tasks the moment it runs.
--
-- This deliberately does NOT delete the SALCI Support institution row or any
-- support tasks already created. Dropping the institution would cascade
-- (institutions -> tasks ON DELETE CASCADE) and destroy real tickets. Remove it
-- by hand only after confirming no tasks reference it:
--   SELECT count(*) FROM tasks WHERE institution_id =
--     (SELECT id FROM institutions WHERE code = 'SALCI-SUPPORT');

-- The 2026-08-31 support thread build sits on top of these objects. Roll that
-- back first or this leaves broken functions behind rather than a clean state.
DO $$
BEGIN
  IF to_regclass('public.support_messages') IS NOT NULL THEN
    RAISE EXCEPTION
      'Run scripts/rollback-salci-support-messages.sql first: the support thread build depends on these objects.';
  END IF;
END $$;

-- 1. Dependents of get_support_institution_id(), in dependency order.
DROP POLICY IF EXISTS "Only SALCI may update support tasks" ON public.tasks;

DROP TRIGGER IF EXISTS guard_support_task_update ON public.tasks;
DROP TRIGGER IF EXISTS guard_support_task_delete ON public.tasks;
DROP FUNCTION IF EXISTS public.guard_support_task_mutations();

-- 2. The support RPCs.
DROP FUNCTION IF EXISTS public.create_support_task(text, text, text, integer, text);
DROP FUNCTION IF EXISTS public.resolve_support_task(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_support_ticket_status(uuid, text, text);
-- Both signatures: the 2026-08-14 build shipped (uuid, text), and Phase 2 of the
-- 2026-08-31 build replaces it with (uuid, text, text) for the p_status scope.
-- Naming only one leaves the other standing.
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text);
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text, text);

-- 3. Only now the helpers everything above called.
DROP FUNCTION IF EXISTS public.get_support_owner_id();
DROP FUNCTION IF EXISTS public.get_support_institution_id();

DROP TABLE IF EXISTS public.support_settings;

-- Keeps the intake rows; only unlinks them from tasks.
ALTER TABLE public.reported_issues DROP COLUMN IF EXISTS task_id;

DROP INDEX IF EXISTS public.idx_reported_issues_task_id;
DROP INDEX IF EXISTS public.idx_reported_issues_reporter_created;
DROP INDEX IF EXISTS public.idx_reported_issues_status_created;
DROP INDEX IF EXISTS public.idx_reported_issues_institution;

-- Verify nothing is left calling a dropped helper:
--   SELECT n.nspname, p.proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE p.prosrc ILIKE '%get_support_institution_id%';
-- Expect zero rows.
```

- [ ] **Step 3: Prove the new rollback runs, inside BEGIN ... ROLLBACK**

Create `scripts/support-p1/07-rollback-dryrun.sql`. This is the only way to know a break-glass script works before the day it is needed. It cannot `\i` the file, so it re-runs the two irreversible halves and the guard, then rolls back.

```sql
BEGIN;

-- Guard behaviour: the backup must exist and phase 2 must not be applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_support_apply_status'
  ) THEN
    RAISE EXCEPTION 'DRY RUN: phase 2 detected, rollback would refuse (correct).';
  END IF;
  IF to_regclass('salci_backups.reported_issues_pre_messages_20260831') IS NULL THEN
    RAISE EXCEPTION 'DRY RUN FAILED: backup missing, rollback would be impossible.';
  END IF;
END $$;

ALTER TABLE public.reported_issues ADD COLUMN IF NOT EXISTS admin_notes text;

UPDATE public.reported_issues r
SET admin_notes = b.admin_notes
FROM salci_backups.reported_issues_pre_messages_20260831 b
WHERE b.id = r.id AND b.admin_notes IS NOT NULL;

DROP POLICY IF EXISTS "Super admins view all reports" ON public.reported_issues;
DROP POLICY IF EXISTS "Users can view own reports" ON public.reported_issues;
CREATE POLICY "Users can view own reports"
  ON public.reported_issues FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP INDEX IF EXISTS public.idx_reported_issues_last_message;
ALTER TABLE public.reported_issues DROP CONSTRAINT IF EXISTS reported_issues_status_check;
ALTER TABLE public.reported_issues
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS last_message_at,
  DROP COLUMN IF EXISTS reporter_last_read_at,
  DROP COLUMN IF EXISTS salci_last_read_at,
  DROP COLUMN IF EXISTS first_response_at,
  DROP COLUMN IF EXISTS resolved_at;

DROP TABLE IF EXISTS public.support_messages;
DROP FUNCTION IF EXISTS public.can_access_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_support_ticket_reporter(uuid);
DROP FUNCTION IF EXISTS public.is_uuid(text);

DO $$
DECLARE
  v_restored integer;
BEGIN
  SELECT count(*) INTO v_restored
  FROM public.reported_issues
  WHERE nullif(btrim(coalesce(admin_notes, '')), '') IS NOT NULL;

  IF v_restored <> 14 THEN
    RAISE EXCEPTION 'DRY RUN FAILED: restored % admin_notes rows, expected 14', v_restored;
  END IF;
  RAISE NOTICE 'rollback dry run restored 14 admin_notes rows as expected';
END $$;

ROLLBACK;

SELECT 'rollback dry run completed with no error'      AS result,
       to_regclass('public.support_messages') IS NOT NULL AS thread_still_live,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='reported_issues'
           AND column_name='admin_notes') = 0            AS leak_still_closed;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\07-rollback-dryrun.sql -OutFile "$env:TEMP\salci-p1-07-dry.json"
Get-Content "$env:TEMP\salci-p1-07-dry.json"
```

Expected: HTTP 200, `"thread_still_live":true`, `"leak_still_closed":true`. Those two together are the proof that the rollback path works and that nothing was actually rolled back.

- [ ] **Step 4: Confirm the repaired task rollback names no orphan callers**

Create `scripts/support-p1/07-orphan-callers-assert.sql`:

```sql
-- Every function that calls a helper the task rollback drops must itself be
-- dropped by that same script. Expect exactly the four names the script drops.
SELECT
  p.proname,
  p.prosrc ILIKE '%get_support_institution_id%' AS calls_institution_helper,
  p.prosrc ILIKE '%get_support_owner_id%'       AS calls_owner_helper
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.prosrc ILIKE '%get_support_institution_id%'
       OR p.prosrc ILIKE '%get_support_owner_id%')
ORDER BY p.proname;
```

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\support-p1\07-orphan-callers-assert.sql -OutFile "$env:TEMP\salci-p1-07-callers.json"
Get-Content "$env:TEMP\salci-p1-07-callers.json"
```

Expected names: `create_support_task`, `guard_support_task_mutations`, `resolve_support_task`. Every one of them is dropped by the repaired script, before the helpers are. If a name appears that the script does not drop, add it to section 2 of `scripts/rollback-salci-support-tasks.sql` before committing: that is exactly the class of omission that made the original file dangerous.

- [ ] **Step 5: Commit**

```bash
git add scripts/rollback-salci-support-messages.sql scripts/rollback-salci-support-tasks.sql scripts/support-p1/07-rollback-dryrun.sql scripts/support-p1/07-orphan-callers-assert.sql
git commit -m "fix(support): add the thread rollback and defuse the 2026-08-14 one

rollback-salci-support-tasks.sql dropped get_support_institution_id() while
guard_support_task_mutations() and its two triggers still called it, so
running it would have raised 42883 on every task update platform-wide. It now
drops the policy, triggers and trigger function first, refuses to run while
the support thread build is applied, and cleans up the four indexes it left
behind.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 - RPC layer

### Task 8: Pin the Phase 2 contract as a runnable assertion, and confirm it FAILS

**Files:**
- Create: `scripts/support/assert-support-rpcs.sql`
- Create: `scripts/support/preflight-phase1.sql`

**Interfaces:**
- Consumes: Phase 1 objects `public.support_messages`, `public.is_uuid(text)`, `public.is_support_ticket_reporter(uuid)`, `public.can_access_support_ticket(uuid)`, `reported_issues.category/priority/last_message_at/reporter_last_read_at/salci_last_read_at/first_response_at/resolved_at`
- Produces: `scripts/support/assert-support-rpcs.sql` (the PASS/FAIL gate every later step in this phase is measured against)

- [ ] **Step 1: Create the folder for this phase's SQL**

```powershell
New-Item -ItemType Directory -Force "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main\scripts\support" | Out-Null
```

- [ ] **Step 2: Write the Phase 1 preflight, so Phase 2 never runs against a half-migrated database**

Create `scripts/support/preflight-phase1.sql`:

```sql
-- Phase 2 preflight. Every row must read PASS before the RPC migration is applied.
-- Phase 2 depends on Phase 1 having landed in PROD (the migration ledger is not
-- maintained, so file presence on disk proves nothing).
WITH checks AS (
  SELECT 'support_messages table exists' AS check_name,
         to_regclass('public.support_messages') IS NOT NULL AS ok
  UNION ALL
  SELECT 'support_messages has client_token',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'support_messages'
                   AND column_name = 'client_token')
  UNION ALL
  SELECT 'support_messages has is_internal',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'support_messages'
                   AND column_name = 'is_internal')
  UNION ALL
  SELECT 'reported_issues.admin_notes is dropped',
         NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'reported_issues'
                       AND column_name = 'admin_notes')
  UNION ALL
  SELECT 'reported_issues has the seven new columns',
         (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'reported_issues'
            AND column_name IN ('category','priority','last_message_at',
                                'reporter_last_read_at','salci_last_read_at',
                                'first_response_at','resolved_at')) = 7
  UNION ALL
  SELECT 'reported_issues.reporter_id is nullable',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'reported_issues'
                   AND column_name = 'reporter_id' AND is_nullable = 'YES')
  UNION ALL
  SELECT 'is_uuid(text) exists',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_uuid')
  UNION ALL
  SELECT 'is_support_ticket_reporter(uuid) exists',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'is_support_ticket_reporter')
  UNION ALL
  SELECT 'can_access_support_ticket(uuid) exists',
         EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'can_access_support_ticket')
  UNION ALL
  SELECT 'every ticket already has at least one seeded message',
         NOT EXISTS (SELECT 1 FROM public.reported_issues ri
                     WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                                       WHERE m.ticket_id = ri.id))
)
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;
```

- [ ] **Step 3: Write the Phase 2 assertion, which must FAIL now and PASS after the migration**

Create `scripts/support/assert-support-rpcs.sql`:

```sql
-- Phase 2 assertion (docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md section 4.5).
-- Run BEFORE the migration: expect FAIL rows. Run AFTER: every row must read PASS.
WITH fns AS (
  SELECT p.oid, p.proname, p.prorettype, p.proacl, p.prosecdef,
         pg_get_functiondef(p.oid) AS src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_support_apply_status','list_my_support_tickets','get_support_thread',
      'post_support_message','set_support_ticket_status','resolve_support_task',
      'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
      'create_support_task')
),
checks AS (
  SELECT '01 _support_apply_status exists' AS check_name,
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status') AS ok
  UNION ALL SELECT '02 list_my_support_tickets exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'list_my_support_tickets')
  UNION ALL SELECT '03 get_support_thread exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'get_support_thread')
  UNION ALL SELECT '04 post_support_message exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message')
  UNION ALL SELECT '05 mark_support_ticket_read exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'mark_support_ticket_read')
  UNION ALL SELECT '06 get_support_ticket_transcript exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'get_support_ticket_transcript')
  UNION ALL SELECT '07 set_support_ticket_status returns jsonb',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'set_support_ticket_status'
                   AND prorettype = 'jsonb'::regtype)
  UNION ALL SELECT '08 only one set_support_ticket_status remains',
         (SELECT count(*) FROM fns WHERE proname = 'set_support_ticket_status') = 1
  UNION ALL SELECT '09 resolve_support_task still returns void',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND prorettype = 'void'::regtype)
  UNION ALL SELECT '10 resolve_support_task delegates to _support_apply_status',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND src LIKE '%_support_apply_status%')
  UNION ALL SELECT '11 set_support_ticket_status delegates to _support_apply_status',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'set_support_ticket_status'
                   AND src LIKE '%_support_apply_status%')
  UNION ALL SELECT '12 _support_apply_status keeps the done_pending_approval step-off',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND src LIKE '%done_pending_approval%')
  UNION ALL SELECT '13 _support_apply_status keeps the completed-task guard',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND src LIKE '%v_task_status <> ''completed''%')
  UNION ALL SELECT '14 support_inbox_counts takes p_status and reports awaiting_salci',
         (SELECT count(*) FROM fns WHERE proname = 'support_inbox_counts') = 1
           AND EXISTS (SELECT 1 FROM fns WHERE proname = 'support_inbox_counts'
                         AND src LIKE '%p_status%'
                         AND src LIKE '%awaiting_salci%')
  UNION ALL SELECT '15 create_support_task writes category and priority',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'create_support_task'
                   AND src LIKE '%p_category,%' AND src LIKE '%support_messages%')
  UNION ALL SELECT '16 create_support_task stopped stuffing Category into the task text',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'create_support_task'
                   AND src NOT LIKE '%''Category: ''%')
  UNION ALL SELECT '17 post_support_message is idempotent on client_token',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'
                   AND src LIKE '%client_token = p_client_token%')
  UNION ALL SELECT '18 post_support_message throttles at 30 per hour',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'
                   AND src LIKE '%v_recent >= 30%')
  UNION ALL SELECT '19 every support function is SECURITY DEFINER',
         NOT EXISTS (SELECT 1 FROM fns WHERE prosecdef = false)
  UNION ALL SELECT '20 no PUBLIC EXECUTE on any support function',
         NOT EXISTS (
           SELECT 1 FROM fns
           WHERE proacl IS NULL
              OR EXISTS (SELECT 1 FROM unnest(proacl) AS a WHERE a::text LIKE '=%'))
  UNION ALL SELECT '21 no anon EXECUTE on any support function',
         NOT EXISTS (
           SELECT 1 FROM fns
           WHERE EXISTS (SELECT 1 FROM unnest(coalesce(proacl, ARRAY[]::aclitem[])) AS a
                         WHERE a::text LIKE 'anon=%'))
  UNION ALL SELECT '22 authenticated keeps EXECUTE on the callable RPCs',
         NOT EXISTS (
           SELECT 1 FROM fns
           WHERE proname <> '_support_apply_status'
             AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(proacl, ARRAY[]::aclitem[])) AS a
                             WHERE a::text LIKE 'authenticated=%'))
  UNION ALL SELECT '23 _support_apply_status is not callable by authenticated',
         NOT EXISTS (
           SELECT 1 FROM fns
           WHERE proname = '_support_apply_status'
             AND EXISTS (SELECT 1 FROM unnest(coalesce(proacl, ARRAY[]::aclitem[])) AS a
                         WHERE a::text LIKE 'authenticated=%'))
  UNION ALL SELECT '24 list_my_support_tickets aggregates the stat-tile counts server-side',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'list_my_support_tickets'
                   AND src LIKE '%''counts'',%'
                   AND src LIKE '%''awaiting'', count(*) FILTER%')
)
SELECT check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY check_name;
```

- [ ] **Step 4: Run the preflight against prod. Every row must read PASS**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\preflight-phase1.sql -OutFile scripts\support\out-preflight.json
Get-Content scripts\support\out-preflight.json -Raw
```

If any row reads FAIL, stop: Phase 1 has not reached production and Phase 2 must not be applied.

- [ ] **Step 5: Run the Phase 2 assertion against prod and confirm it FAILS**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\assert-support-rpcs.sql -OutFile scripts\support\out-assert-before.json
Get-Content scripts\support\out-assert-before.json -Raw
```

Expected now: rows 01 to 06, 07, 10 to 18 and 24 read FAIL (the functions do not exist yet, and the live `set_support_ticket_status` returns `void`). This is the failing test. If everything already reads PASS, the migration has already been applied and this phase is a no-op.

- [ ] **Step 6: Commit**

```bash
git add scripts/support/preflight-phase1.sql scripts/support/assert-support-rpcs.sql
git commit -m "test(support): pin the Phase 2 RPC contract as a runnable SQL assertion"
```

---

### Task 9: Create the RPC migration and the one shared status write path

**Files:**
- Create: `supabase/migrations/20260831130000_support_rpcs.sql`

**Interfaces:**
- Consumes: `public.support_messages`, `public.reported_issues`, `public.is_super_admin(uuid)`, `public.tasks`, `public.notifications`, `public.profiles`
- Produces: `public._support_apply_status(p_ticket_id uuid, p_status text, p_note text) RETURNS jsonb`, returning `{ ticket_id, status, notify }` where `notify` matches `SupportNotify`

- [ ] **Step 1: Create the migration file with its header and preflight guard**

Create `supabase/migrations/20260831130000_support_rpcs.sql` with exactly this content:

```sql
-- ============================================================================
-- Salci Support, Phase 2: the RPC layer
--
-- Design: docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
-- Depends on Phase 1 (20260831120000_support_messages.sql) having reached PROD.
--
-- Contract, in one line each:
--   _support_apply_status          the ONE write path for a status change
--   list_my_support_tickets        reporter's own tickets, bounded, unread computed,
--                                  plus unclamped counts for the stat tiles
--   get_support_thread             cursor-paginated thread, internal rows hidden
--   post_support_message           the ONE write path for a message
--   set_support_ticket_status      inbox entry point, wrapper, DROPPED and recreated
--   resolve_support_task           /tasks entry point, wrapper, signature preserved
--   mark_support_ticket_read       per-side read stamp
--   support_inbox_counts           awaiting_salci + a p_status scope, DROPPED and recreated
--   get_support_ticket_transcript  super admin, everything including internal
--   create_support_task            now writes category + priority + message 1
--
-- Two entry points for a status change (the inbox and /tasks), ONE write path.
-- Building a second divergent path is exactly the mistake that produced the
-- two disconnected note stores this design removes.
--
-- Every function below is SECURITY DEFINER and every one is revoked from
-- PUBLIC *and* anon by name at the bottom of this file. Both revokes are
-- required: revoking anon alone leaves the PUBLIC grant, and revoking PUBLIC
-- alone leaves an explicit anon grant. Verify with pg_proc.proacl, never
-- information_schema.routine_privileges, which does not expand PUBLIC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Preflight. Fail loudly rather than create RPCs against a half-migrated
-- schema: the migration ledger (supabase_migrations.schema_migrations) is not
-- maintained in this project, so file presence proves nothing.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.support_messages') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: public.support_messages is missing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reported_issues'
      AND column_name = 'admin_notes'
  ) THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: reported_issues.admin_notes still exists.';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reported_issues'
      AND column_name IN ('category','priority','last_message_at',
                          'reporter_last_read_at','salci_last_read_at',
                          'first_response_at','resolved_at')
  ) <> 7 THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: reported_issues is missing the new columns.';
  END IF;
END
$preflight$;
```

- [ ] **Step 2: Append `_support_apply_status`, the single status write path**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- _support_apply_status: the ONE place a support ticket's status moves.
--
-- Called by set_support_ticket_status (the inbox) and by resolve_support_task
-- (the /tasks panel). Both entry points therefore produce identical system
-- rows, identical resolved_at stamps and identical notifications.
--
-- The task mirroring below is preserved VERBATIM from
-- 20260814150000_support_harden_grants_and_resolve.sql:167-191, including:
--   * the completed-task guard (the trigger raises 'Completed tasks cannot be
--     modified', so a completed task is never touched), and
--   * the done_pending_approval step-off (that state needs the ASSIGNER to
--     approve, and the assigner is the reporter, who a RESTRICTIVE policy
--     blocks, so the ticket would be stuck forever while the UPDATE matched
--     zero rows and reported_issues flipped anyway: a silent divergence).
--
-- DEPENDENCY, unchanged by this migration: validate_task_state_transition() is
-- a check-list with no trailing ELSE, so (open|in_progress) -> completed and
-- open -> rejected are unguarded. Hardening that trigger breaks support
-- resolution unless those pairs are added to its allow-list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._support_apply_status(
  p_ticket_id uuid,
  p_status    text,
  p_note      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_prev        text;
  v_task        uuid;
  v_task_status public.task_status;
  v_note        text;
  v_reporter    uuid;
  v_subject     text;
  v_actor       uuid;
  v_actor_name  text;
  v_label       text;
  v_changed     boolean;
  v_wrote       boolean := false;
  v_has_profile boolean := false;
  v_to_email    text;
  v_to_name     text;
  v_kind        text;
  v_preview     text;
  v_notify      jsonb := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can update a support request.';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown status for a support request.';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  SELECT ri.status, ri.task_id, ri.reporter_id, ri.subject
    INTO v_prev, v_task, v_reporter, v_subject
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  -- subject is NOT NULL on the table, so a NULL here means "no such row".
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  v_changed := v_prev IS DISTINCT FROM p_status;

  -- The actor snapshot. author_id references profiles(id); resolve it rather
  -- than assuming auth.uid() has a profiles row.
  SELECT p.id, p.full_name INTO v_actor, v_actor_name
  FROM public.profiles p WHERE p.id = v_uid;

  v_label := CASE p_status
               WHEN 'open'        THEN 'reopened'
               WHEN 'in_progress' THEN 'in progress'
               WHEN 'resolved'    THEN 'resolved'
               ELSE                    'closed'
             END;

  -- resolved_at is stamped on entry to resolved/closed and cleared otherwise.
  -- It exists because updated_at is bumped by a trigger on every edit and so
  -- cannot serve as a resolution timestamp. coalesce keeps the FIRST
  -- resolution time across a resolved -> closed move.
  UPDATE public.reported_issues
  SET status      = p_status,
      resolved_at = CASE WHEN p_status IN ('resolved', 'closed')
                         THEN coalesce(resolved_at, now())
                         ELSE NULL END,
      updated_at  = now()
  WHERE id = p_ticket_id;

  IF v_changed THEN
    INSERT INTO public.support_messages (
      ticket_id, author_id, author_name, author_side, kind, body, is_internal
    ) VALUES (
      p_ticket_id, v_actor, coalesce(v_actor_name, 'SALCI Support'),
      'system', 'system',
      CASE WHEN p_status = 'open'
           THEN 'SALCI reopened this request.'
           ELSE 'SALCI marked this request ' || v_label || '.' END,
      false
    );
    v_wrote := true;
  END IF;

  IF v_note IS NOT NULL THEN
    INSERT INTO public.support_messages (
      ticket_id, author_id, author_name, author_side, kind, body, is_internal
    ) VALUES (
      p_ticket_id, v_actor, coalesce(v_actor_name, 'SALCI Support'),
      'salci', 'message', v_note, false
    );
    v_wrote := true;
  END IF;

  IF v_wrote THEN
    UPDATE public.reported_issues
    SET last_message_at   = now(),
        first_response_at = CASE WHEN v_note IS NOT NULL
                                 THEN coalesce(first_response_at, now())
                                 ELSE first_response_at END
    WHERE id = p_ticket_id;
  END IF;

  -- --- linked task mirroring, preserved verbatim -----------------------------
  IF v_task IS NOT NULL THEN
    SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id = v_task;

    IF v_task_status IS NOT NULL AND v_task_status <> 'completed' THEN
      -- Step off the approval dead-end before closing.
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
    END IF;
  END IF;

  -- --- reporter notification -------------------------------------------------
  -- notifications.user_id is NOT NULL and references profiles(id), while
  -- reported_issues.reporter_id references auth.users(id). Check for the
  -- profile before inserting rather than betting on the FK.
  IF v_reporter IS NOT NULL AND (v_changed OR v_note IS NOT NULL) THEN
    SELECT p.email, p.full_name, true INTO v_to_email, v_to_name, v_has_profile
    FROM public.profiles p WHERE p.id = v_reporter;
  END IF;

  IF coalesce(v_has_profile, false) AND v_reporter <> v_uid THEN
    v_kind := CASE
                WHEN v_changed AND p_status = 'open' THEN 'support_reopened'
                WHEN v_changed                       THEN 'support_status_changed'
                ELSE                                      'support_reply'
              END;

    v_preview := left(coalesce(v_note,
                   CASE WHEN p_status = 'open'
                        THEN 'Your request has been reopened.'
                        ELSE 'Your request is now ' || v_label || '.' END), 160);

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      v_reporter,
      v_kind,
      CASE WHEN v_changed
           THEN 'Support request ' || v_label
           ELSE 'SALCI replied to your support request' END,
      left(v_subject, 80) || ': ' || v_preview,
      '/support?ticket=' || p_ticket_id::text,
      jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status)
    );

    v_notify := jsonb_build_object(
      'to_user_id', v_reporter,
      'to_email',   v_to_email,
      'to_name',    v_to_name,
      'kind',       v_kind,
      'ticket_id',  p_ticket_id,
      'subject',    v_subject,
      'preview',    v_preview
    );
  END IF;

  RETURN jsonb_build_object(
    'ticket_id', p_ticket_id,
    'status',    p_status,
    'notify',    v_notify
  );
END;
$$;

COMMENT ON FUNCTION public._support_apply_status(uuid, text, text) IS
  'Internal. The ONE write path for a Salci Support status change: intake row, resolved_at, system message, optional public note, linked task mirror, reporter notification. Called only by set_support_ticket_status and resolve_support_task. Not callable by authenticated.';
```

- [ ] **Step 3: Dry run the file so far, wrapped in BEGIN and ROLLBACK**

The Management API runs plain SQL, not psql, so there are no meta-commands available: build `scripts/support/dryrun-support-rpcs.sql` by wrapping a copy of the migration body in an explicit transaction, then run it.

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
$body = Get-Content supabase\migrations\20260831130000_support_rpcs.sql -Raw
Set-Content -Encoding utf8 scripts\support\dryrun-support-rpcs.sql ("BEGIN;`n" + $body + "`nROLLBACK;")
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\dryrun-support-rpcs.sql -OutFile scripts\support\out-dryrun.json
Get-Content scripts\support\out-dryrun.json -Raw
```

A non-zero exit or a thrown error means the SQL does not compile. Fix it before continuing. Nothing is committed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831130000_support_rpcs.sql scripts/support/dryrun-support-rpcs.sql
git commit -m "feat(support): add _support_apply_status, the single status write path"
```

---

### Task 10: The read RPCs, all bounded and aggregated server-side

**Files:**
- Modify: `supabase/migrations/20260831130000_support_rpcs.sql` (append)

**Interfaces:**
- Consumes: `public.support_messages`, `public.reported_issues`, `public.is_super_admin(uuid)`, `public.can_access_support_ticket(uuid)`, `public.is_support_ticket_reporter(uuid)`
- Produces: `list_my_support_tickets(int,int) -> { tickets: SupportTicket[]; has_more: boolean; counts: { active: number; awaiting: number; resolved: number; total: number } }` where `counts` is computed over ALL of the caller's tickets and is never clamped by `p_limit`, `get_support_thread(uuid,int,timestamptz) -> { ticket, messages, has_more }`, `mark_support_ticket_read(uuid) -> void`, `support_inbox_counts(uuid,text,text) -> jsonb` where the four per-status keys and `total` always cover every status and the new third argument `p_status` scopes `awaiting_salci` to one status tab, `get_support_ticket_transcript(uuid) -> { ticket, messages }`

- [ ] **Step 1: Append `list_my_support_tickets`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- list_my_support_tickets: the reporter's own tickets.
--
-- The reporter has NO direct SELECT on reported_issues after Phase 1; this RPC
-- is their only read path, and it returns an explicit column list so a future
-- column cannot leak by accident.
--
-- Scale gate: p_limit is clamped to 100, one extra row is fetched to compute
-- has_more, and message_count / has_unread are computed in Postgres. Nothing
-- is counted by shipping rows to the browser.
--
-- The 'counts' key exists for the same reason: the reporter page shows Active /
-- Awaiting reply / Resolved stat tiles, and counting the returned page in the
-- browser would both violate the scale gate and go silently wrong past the
-- 100-row clamp. counts is aggregated over ALL of the caller's tickets and is
-- deliberately NOT bounded by p_limit / p_offset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_support_tickets(
  p_limit  int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_limit    int;
  v_offset   int;
  v_tickets  jsonb;
  v_has_more boolean;
  v_counts   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view your support requests.';
  END IF;

  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  WITH page AS (
    SELECT ri.id,
           ri.subject,
           ri.description,
           ri.status,
           ri.category,
           ri.priority,
           ri.reporter_name,
           ri.reporter_email,
           ri.reporter_role,
           ri.institution_name,
           ri.created_at,
           ri.last_message_at,
           ri.resolved_at,
           ri.first_response_at,
           ri.reporter_last_read_at
    FROM public.reported_issues ri
    WHERE ri.reporter_id = v_uid
    ORDER BY coalesce(ri.last_message_at, ri.created_at) DESC, ri.id
    LIMIT v_limit + 1
    OFFSET v_offset
  ),
  ranked AS (
    -- row_number is computed before LIMIT at the same query level, so it has
    -- to be applied in an OUTER query or a non-zero p_offset shifts it.
    SELECT p.*,
           row_number() OVER (ORDER BY coalesce(p.last_message_at, p.created_at) DESC, p.id) AS rn
    FROM page p
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',                r.id,
          'subject',           r.subject,
          'description',       r.description,
          'status',            r.status,
          'category',          r.category,
          'priority',          r.priority,
          'reporter_name',     r.reporter_name,
          'reporter_email',    r.reporter_email,
          'reporter_role',     r.reporter_role,
          'institution_name',  r.institution_name,
          'created_at',        r.created_at,
          'last_message_at',   r.last_message_at,
          'resolved_at',       r.resolved_at,
          'first_response_at', r.first_response_at,
          'message_count',     (SELECT count(*) FROM public.support_messages m
                                WHERE m.ticket_id = r.id AND m.is_internal = false),
          'has_unread',        EXISTS (SELECT 1 FROM public.support_messages m
                                       WHERE m.ticket_id = r.id
                                         AND m.is_internal = false
                                         AND m.author_side <> 'reporter'
                                         AND m.created_at > coalesce(r.reporter_last_read_at,
                                                                     'epoch'::timestamptz))
        )
        ORDER BY r.rn
      ) FILTER (WHERE r.rn <= v_limit),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE r.rn > v_limit) > 0
  INTO v_tickets, v_has_more
  FROM ranked r;

  -- Aggregated over EVERY ticket this reporter owns, not just the page above.
  SELECT jsonb_build_object(
    'active',   count(*) FILTER (WHERE status IN ('open', 'in_progress')),
    'awaiting', count(*) FILTER (
                  WHERE last_message_at > coalesce(reporter_last_read_at, 'epoch'::timestamptz)),
    'resolved', count(*) FILTER (WHERE status IN ('resolved', 'closed')),
    'total',    count(*)
  )
  INTO v_counts
  FROM public.reported_issues
  WHERE reporter_id = v_uid;

  RETURN jsonb_build_object(
    'tickets',  coalesce(v_tickets, '[]'::jsonb),
    'has_more', coalesce(v_has_more, false),
    'counts',   coalesce(v_counts,
                  jsonb_build_object('active', 0, 'awaiting', 0, 'resolved', 0, 'total', 0))
  );
END;
$$;

COMMENT ON FUNCTION public.list_my_support_tickets(int, int) IS
  'The caller''s own Salci Support tickets, newest activity first, plus unclamped counts (active, awaiting, resolved, total). p_limit clamped to 100. The reporter''s only read path onto reported_issues.';
```

- [ ] **Step 2: Append `get_support_thread`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- get_support_thread: ticket header plus one cursor page of messages.
--
-- Internal rows are omitted for anyone who is not a super admin. That omission
-- happens here, in the RPC, so the reporter surface can never render one even
-- by mistake: it never receives one.
--
-- Cursor, not offset: p_before is the created_at of the oldest message the
-- client already holds. Messages come back oldest-first for direct rendering.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_support_thread(
  p_ticket_id uuid,
  p_limit     int DEFAULT 50,
  p_before    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_limit    int;
  v_ticket   jsonb;
  v_messages jsonb;
  v_has_more boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view a support request.';
  END IF;

  IF NOT public.can_access_support_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);
  v_limit    := least(greatest(coalesce(p_limit, 50), 1), 100);

  SELECT jsonb_build_object(
    'id',                ri.id,
    'subject',           ri.subject,
    'description',       ri.description,
    'status',            ri.status,
    'category',          ri.category,
    'priority',          ri.priority,
    'reporter_name',     ri.reporter_name,
    'reporter_email',    ri.reporter_email,
    'reporter_role',     ri.reporter_role,
    'institution_name',  ri.institution_name,
    'created_at',        ri.created_at,
    'last_message_at',   ri.last_message_at,
    'resolved_at',       ri.resolved_at,
    'first_response_at', ri.first_response_at,
    'message_count',     (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = ri.id
                            AND (v_is_admin OR m.is_internal = false)),
    'has_unread',        EXISTS (
                           SELECT 1 FROM public.support_messages m
                           WHERE m.ticket_id = ri.id
                             AND (v_is_admin OR m.is_internal = false)
                             AND m.author_side <> CASE WHEN v_is_admin THEN 'salci' ELSE 'reporter' END
                             AND m.created_at > coalesce(
                                   CASE WHEN v_is_admin THEN ri.salci_last_read_at
                                        ELSE ri.reporter_last_read_at END,
                                   'epoch'::timestamptz))
  )
  INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  WITH page AS (
    SELECT m.id,
           m.author_side,
           m.author_name,
           m.kind,
           m.body,
           m.is_internal,
           m.attachments,
           m.created_at
    FROM public.support_messages m
    WHERE m.ticket_id = p_ticket_id
      AND (v_is_admin OR m.is_internal = false)
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit + 1
  ),
  ranked AS (
    SELECT p.*,
           row_number() OVER (ORDER BY p.created_at DESC, p.id DESC) AS rn
    FROM page p
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',          r.id,
          'author_side', r.author_side,
          'author_name', r.author_name,
          'kind',        r.kind,
          'body',        r.body,
          'is_internal', r.is_internal,
          'attachments', coalesce(r.attachments, '[]'::jsonb),
          'created_at',  r.created_at
        )
        ORDER BY r.created_at ASC, r.id ASC
      ) FILTER (WHERE r.rn <= v_limit),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE r.rn > v_limit) > 0
  INTO v_messages, v_has_more
  FROM ranked r;

  RETURN jsonb_build_object(
    'ticket',   v_ticket,
    'messages', coalesce(v_messages, '[]'::jsonb),
    'has_more', coalesce(v_has_more, false)
  );
END;
$$;

COMMENT ON FUNCTION public.get_support_thread(uuid, int, timestamptz) IS
  'One cursor page of a Salci Support thread, oldest first, plus the ticket header. Internal rows are returned only to super admins.';
```

- [ ] **Step 3: Append `mark_support_ticket_read`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- mark_support_ticket_read: stamp the caller's side. Naturally idempotent.
--
-- Unread is computed from these two stamps against support_messages, so there
-- is no per-message read table to keep in step.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_support_ticket_read(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view a support request.';
  END IF;

  IF public.is_super_admin(v_uid) THEN
    UPDATE public.reported_issues
    SET salci_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSIF public.is_support_ticket_reporter(p_ticket_id) THEN
    UPDATE public.reported_issues
    SET reporter_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSE
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.mark_support_ticket_read(uuid) IS
  'Stamp reporter_last_read_at or salci_last_read_at by caller side. Idempotent.';
```

- [ ] **Step 4: Append the extended `support_inbox_counts`, dropping the two-argument version first**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- support_inbox_counts, extended with awaiting_salci and a p_status scope.
--
-- The four per-status keys (open, in_progress, resolved, closed) and total are
-- computed across EVERY status and are deliberately NOT affected by p_status,
-- so the inbox tab badges keep working exactly as they do today.
--
-- awaiting_salci is the number behind the Awaiting SALCI chip: the thread moved
-- after SALCI last read it. That chip lives INSIDE one status tab and filters
-- that tab's rows, so the number it prints has to be measured over that same
-- status, or the Closed tab can read "Awaiting SALCI (7)" and then filter to
-- nothing. p_status is what makes them agree: when it is supplied, awaiting_salci
-- counts only tickets in that status; when it is NULL the platform-wide default
-- (open + in_progress) is kept for any caller that wants the whole backlog.
--
-- RULE for anyone touching this later: the count and the list filter it labels
-- must always measure the same set. Change one and you change both.
--
-- MECHANIC: the live function is support_inbox_counts(uuid, text). Adding a
-- third parameter creates a NEW function rather than replacing that one, so the
-- two-argument version is DROPped first. Leaving both behind would give
-- PostgREST two overloads to resolve between, and would leave an over-granted
-- function standing, because the REVOKE block at the bottom of this file names
-- only the three-argument signature.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text);

CREATE OR REPLACE FUNCTION public.support_inbox_counts(
  p_institution_id uuid DEFAULT NULL,
  p_role           text DEFAULT NULL,
  p_status         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown support status filter.';
  END IF;

  SELECT jsonb_build_object(
    'open',           count(*) FILTER (WHERE status = 'open'),
    'in_progress',    count(*) FILTER (WHERE status = 'in_progress'),
    'resolved',       count(*) FILTER (WHERE status = 'resolved'),
    'closed',         count(*) FILTER (WHERE status = 'closed'),
    'awaiting_salci', count(*) FILTER (
                        WHERE (CASE
                                 WHEN p_status IS NULL
                                   THEN status IN ('open', 'in_progress')
                                 ELSE status = p_status
                               END)
                          AND last_message_at > coalesce(salci_last_read_at, 'epoch'::timestamptz)),
    'total',          count(*)
  )
  INTO v
  FROM public.reported_issues
  WHERE (p_institution_id IS NULL OR institution_id = p_institution_id)
    AND (p_role IS NULL OR reporter_role = p_role);

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.support_inbox_counts(uuid, text, text) IS
  'Per-status counts for the Salci Support inbox, plus awaiting_salci. The per-status keys and total always cover every status; p_status scopes awaiting_salci to one tab so the chip count and the list it filters measure the same set. Super admins only.';
```

- [ ] **Step 5: Append `get_support_ticket_transcript`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- get_support_ticket_transcript: everything, including internal notes.
--
-- Super admin only, and deliberately unpaginated: a transcript is a whole
-- document or it is nothing. A support thread is a conversation between two
-- people, so the row count is bounded in practice by the 30-per-hour throttle
-- in post_support_message rather than by data growth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_support_ticket_transcript(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ticket   jsonb;
  v_messages jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can export a support transcript.';
  END IF;

  SELECT jsonb_build_object(
    'id',                ri.id,
    'subject',           ri.subject,
    'description',       ri.description,
    'status',            ri.status,
    'category',          ri.category,
    'priority',          ri.priority,
    'reporter_name',     ri.reporter_name,
    'reporter_email',    ri.reporter_email,
    'reporter_role',     ri.reporter_role,
    'institution_name',  ri.institution_name,
    'created_at',        ri.created_at,
    'last_message_at',   ri.last_message_at,
    'resolved_at',       ri.resolved_at,
    'first_response_at', ri.first_response_at,
    'message_count',     (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = ri.id),
    'has_unread',        ri.last_message_at > coalesce(ri.salci_last_read_at, 'epoch'::timestamptz)
  )
  INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',          m.id,
        'author_side', m.author_side,
        'author_name', m.author_name,
        'kind',        m.kind,
        'body',        m.body,
        'is_internal', m.is_internal,
        'attachments', coalesce(m.attachments, '[]'::jsonb),
        'created_at',  m.created_at
      )
      ORDER BY m.created_at ASC, m.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_messages
  FROM public.support_messages m
  WHERE m.ticket_id = p_ticket_id;

  RETURN jsonb_build_object('ticket', v_ticket, 'messages', v_messages);
END;
$$;

COMMENT ON FUNCTION public.get_support_ticket_transcript(uuid) IS
  'Full Salci Support ticket transcript including internal notes. Super admins only. Feeds the PDF export.';
```

- [ ] **Step 6: Dry run the file again**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
$body = Get-Content supabase\migrations\20260831130000_support_rpcs.sql -Raw
Set-Content -Encoding utf8 scripts\support\dryrun-support-rpcs.sql ("BEGIN;`n" + $body + "`nROLLBACK;")
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\dryrun-support-rpcs.sql -OutFile scripts\support\out-dryrun.json
Get-Content scripts\support\out-dryrun.json -Raw
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260831130000_support_rpcs.sql
git commit -m "feat(support): add the bounded read RPCs and extend support_inbox_counts with awaiting_salci"
```

---

### Task 11: `post_support_message`, the single message write path

**Files:**
- Modify: `supabase/migrations/20260831130000_support_rpcs.sql` (append)

**Interfaces:**
- Consumes: `public.support_messages`, `public.reported_issues`, `public.is_super_admin(uuid)`, `public.get_support_owner_id()`, `public.notifications`, `public.tasks`
- Produces: `post_support_message(uuid, text, boolean, jsonb, uuid) -> { message_id: string; status: string; notify: SupportNotify | null }`

- [ ] **Step 1: Append `post_support_message` with all twelve steps in order**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- post_support_message: the whole write path for a reply, in one transaction.
--
-- This is the ONLY place a support message is created, and the only place the
-- ticket moves as a side effect of a message. support_messages has no INSERT,
-- UPDATE or DELETE policy at all, so the internal/external split cannot be
-- forged from a client: there is no client write path to forge it through.
--
-- The twelve steps, in order:
--   1  reject an anonymous caller
--   2  resolve the side, freeze it (a super admin who is also the reporter is
--      'salci', matching the two prod tickets the support owner filed)
--   3  reject an internal note from a reporter
--   4  reject an empty body with no attachments
--   5  idempotency: a repeated client_token returns the first message
--   6  resolve the caller's profiles row and reject a caller who has none, and
--      snapshot author_name (profiles RLS hides each side from the other, so a
--      join at read time is impossible; the snapshot is the attribution)
--   7  throttle: 30 messages per caller per hour
--   8  insert the message
--   9  last_message_at, and first_response_at on the first PUBLIC salci reply
--   10 implicit status moves, each with its own system row
--   11 notify the other side, never for an internal note
--   12 return message_id, status and the notify payload for the email function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_support_message(
  p_ticket_id    uuid,
  p_body         text,
  p_is_internal  boolean DEFAULT false,
  p_attachments  jsonb   DEFAULT '[]'::jsonb,
  p_client_token uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_is_admin     boolean;
  v_is_reporter  boolean;
  v_internal     boolean := coalesce(p_is_internal, false);
  v_side         text;
  v_body         text;
  v_atts         jsonb;
  v_status       text;
  v_new_status   text;
  v_reporter     uuid;
  v_subject      text;
  v_task         uuid;
  v_task_status  public.task_status;
  v_author       uuid;
  v_name         text;
  v_msg          uuid;
  v_recent       int;
  v_reopened     boolean := false;
  v_target       uuid;
  v_to_email     text;
  v_to_name      text;
  v_has_profile  boolean := false;
  v_kind         text;
  v_title        text;
  v_link         text;
  v_preview      text;
  v_notify       jsonb := NULL;
BEGIN
  -- 1 -----------------------------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to reply to a support request.';
  END IF;

  SELECT ri.status, ri.reporter_id, ri.subject, ri.task_id
    INTO v_status, v_reporter, v_subject, v_task
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  -- subject is NOT NULL on the table, so a NULL here means "no such row".
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  -- 2 -----------------------------------------------------------------------
  v_is_admin    := public.is_super_admin(v_uid);
  v_is_reporter := (v_reporter IS NOT NULL AND v_reporter = v_uid);

  IF v_is_admin THEN
    v_side := 'salci';
  ELSIF v_is_reporter THEN
    v_side := 'reporter';
  ELSE
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;

  -- 3 -----------------------------------------------------------------------
  IF v_internal AND v_side <> 'salci' THEN
    RAISE EXCEPTION 'Only SALCI support can add an internal note.';
  END IF;

  -- 4 -----------------------------------------------------------------------
  v_body := btrim(coalesce(p_body, ''));
  v_atts := coalesce(p_attachments, '[]'::jsonb);
  IF jsonb_typeof(v_atts) <> 'array' THEN
    v_atts := '[]'::jsonb;
  END IF;

  IF v_body = '' AND jsonb_array_length(v_atts) = 0 THEN
    RAISE EXCEPTION 'Please write a message or attach a file before sending.';
  END IF;

  -- 5 -----------------------------------------------------------------------
  -- Backed by the partial unique index on client_token. A double tap or a
  -- retry after a dropped response returns the first message and writes
  -- nothing at all.
  IF p_client_token IS NOT NULL THEN
    SELECT m.id INTO v_msg
    FROM public.support_messages m
    WHERE m.client_token = p_client_token;

    IF v_msg IS NOT NULL THEN
      RETURN jsonb_build_object(
        'message_id', v_msg,
        'status',     v_status,
        'notify',     NULL
      );
    END IF;
  END IF;

  -- 6 -----------------------------------------------------------------------
  -- author_id references profiles(id), so it is NULL for a caller who has no
  -- profiles row. That MUST be rejected here, before the throttle: the throttle
  -- counts rows by author_id, so a NULL author_id would match nothing and such
  -- a caller would post an unlimited number of messages on an RPC any
  -- authenticated user can reach. Every real SALCI account has a profiles row
  -- (handle_new_user creates it), so this only ever fires on a broken account.
  SELECT p.id, p.full_name INTO v_author, v_name
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_author IS NULL THEN
    RAISE EXCEPTION 'Your account is not set up for support messages yet. Please contact SALCI support.';
  END IF;

  -- 7 -----------------------------------------------------------------------
  -- Backed by idx_support_messages_author.
  SELECT count(*) INTO v_recent
  FROM public.support_messages m
  WHERE m.author_id = v_author
    AND m.created_at > now() - interval '1 hour';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'You have sent 30 support messages in the last hour. Please wait a little before sending another.';
  END IF;

  -- 8 -----------------------------------------------------------------------
  INSERT INTO public.support_messages (
    ticket_id, author_id, author_name, author_side, kind,
    body, is_internal, attachments, client_token
  ) VALUES (
    p_ticket_id,
    v_author,
    coalesce(v_name, CASE WHEN v_side = 'salci' THEN 'SALCI Support' ELSE 'Reporter' END),
    v_side,
    'message',
    v_body,
    v_internal,
    v_atts,
    p_client_token
  )
  RETURNING id INTO v_msg;

  -- 9 -----------------------------------------------------------------------
  -- An internal note must NOT bump last_message_at: awaiting_salci is derived
  -- from it, and SALCI's own private note is not something SALCI is waiting on.
  -- first_response_at is stamped on the first PUBLIC salci message only; an
  -- internal note is not a response.
  UPDATE public.reported_issues
  SET last_message_at   = CASE WHEN v_internal THEN last_message_at ELSE now() END,
      first_response_at = CASE WHEN v_side = 'salci' AND NOT v_internal
                               THEN coalesce(first_response_at, now())
                               ELSE first_response_at END,
      updated_at        = now()
  WHERE id = p_ticket_id;

  -- 10 ----------------------------------------------------------------------
  v_new_status := v_status;

  IF NOT v_internal THEN
    IF v_side = 'salci' AND v_status = 'open' THEN
      v_new_status := 'in_progress';

      UPDATE public.reported_issues
      SET status = 'in_progress', updated_at = now()
      WHERE id = p_ticket_id;

      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      ) VALUES (
        p_ticket_id, v_author, coalesce(v_name, 'SALCI Support'),
        'system', 'system', 'SALCI started working on this.', false
      );

      -- Mirror onto the linked task with the same mapping and the same
      -- completed-task guard the status RPC uses.
      IF v_task IS NOT NULL THEN
        SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id = v_task;
        IF v_task_status IS NOT NULL AND v_task_status = 'open' THEN
          UPDATE public.tasks SET status = 'in_progress'
          WHERE id = v_task AND status = 'open';
        END IF;
      END IF;

    ELSIF v_side = 'reporter' AND v_status IN ('resolved', 'closed') THEN
      v_new_status := 'open';
      v_reopened   := true;

      UPDATE public.reported_issues
      SET status = 'open', resolved_at = NULL, updated_at = now()
      WHERE id = p_ticket_id;

      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      ) VALUES (
        p_ticket_id, v_author, coalesce(v_name, 'Reporter'),
        'system', 'system', 'Reopened by the reporter.', false
      );

      -- The linked task is deliberately NOT touched here. By this point it is
      -- completed or rejected, and the task trigger raises 'Completed tasks
      -- cannot be modified'. The reopen lives on the ticket, which is the
      -- record both surfaces read.
    END IF;
  END IF;

  -- 11 ----------------------------------------------------------------------
  IF NOT v_internal THEN
    IF v_side = 'salci' THEN
      v_target := v_reporter;
      v_kind   := 'support_reply';
      v_title  := 'SALCI replied to your support request';
      v_link   := '/support?ticket=' || p_ticket_id::text;
    ELSE
      v_target := public.get_support_owner_id();
      v_kind   := CASE WHEN v_reopened THEN 'support_reopened' ELSE 'support_reply' END;
      v_title  := CASE WHEN v_reopened
                       THEN 'Support request reopened'
                       ELSE 'New reply on a support request' END;
      v_link   := '/admin/issues?ticket=' || p_ticket_id::text;
    END IF;

    v_preview := left(coalesce(nullif(v_body, ''), 'Sent an attachment.'), 160);

    -- notifications.user_id is NOT NULL and references profiles(id), while
    -- reported_issues.reporter_id references auth.users(id). Check for the
    -- profile row before inserting rather than betting on the FK.
    IF v_target IS NOT NULL AND v_target <> v_uid THEN
      SELECT p.email, p.full_name, true INTO v_to_email, v_to_name, v_has_profile
      FROM public.profiles p WHERE p.id = v_target;
    END IF;

    IF coalesce(v_has_profile, false) THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      VALUES (
        v_target,
        v_kind,
        v_title,
        left(v_subject, 80) || ': ' || v_preview,
        v_link,
        jsonb_build_object('ticket_id', p_ticket_id, 'message_id', v_msg)
      );

      v_notify := jsonb_build_object(
        'to_user_id', v_target,
        'to_email',   v_to_email,
        'to_name',    v_to_name,
        'kind',       v_kind,
        'ticket_id',  p_ticket_id,
        'subject',    v_subject,
        'preview',    v_preview
      );
    END IF;
  END IF;

  -- 12 ----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'message_id', v_msg,
    'status',     v_new_status,
    'notify',     v_notify
  );
END;
$$;

COMMENT ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) IS
  'The only write path for a Salci Support message. Resolves and freezes the author side, rejects an internal note from a reporter, is idempotent on client_token, throttled to 30 per caller per hour, auto-reopens a resolved ticket, moves open to in_progress on the first SALCI reply, and notifies the other side. Returns the notify payload so the client can send the email without a second round trip.';
```

- [ ] **Step 2: Dry run the file again**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
$body = Get-Content supabase\migrations\20260831130000_support_rpcs.sql -Raw
Set-Content -Encoding utf8 scripts\support\dryrun-support-rpcs.sql ("BEGIN;`n" + $body + "`nROLLBACK;")
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\dryrun-support-rpcs.sql -OutFile scripts\support\out-dryrun.json
Get-Content scripts\support\out-dryrun.json -Raw
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260831130000_support_rpcs.sql
git commit -m "feat(support): add post_support_message, the single idempotent message write path"
```

---

### Task 12: Rewrite the three existing RPCs onto the shared write path

**Files:**
- Modify: `supabase/migrations/20260831130000_support_rpcs.sql` (append)

**Interfaces:**
- Consumes: `public._support_apply_status(uuid, text, text)`, `public.get_support_institution_id()`, `public.get_support_owner_id()`
- Produces: `set_support_ticket_status(uuid, text, text) RETURNS jsonb`, `resolve_support_task(uuid, text, text) RETURNS void` (signature unchanged), `create_support_task(text, text, text, integer, text) RETURNS jsonb` now writing `category`, `priority` and message 1

- [ ] **Step 1: Append the DROP and recreation of `set_support_ticket_status`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- set_support_ticket_status: the inbox entry point, now a thin wrapper.
--
-- MECHANIC: the live function RETURNS void. Postgres cannot CREATE OR REPLACE
-- a function with a different return type (42P13), so it must be DROPped
-- first. The drop also resets its ACL, which the REVOKE block at the bottom of
-- this file re-establishes.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_support_ticket_status(uuid, text, text);

CREATE FUNCTION public.set_support_ticket_status(
  p_ticket_id uuid,
  p_status    text,
  p_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._support_apply_status(p_ticket_id, p_status, p_note);
END;
$$;

COMMENT ON FUNCTION public.set_support_ticket_status(uuid, text, text) IS
  'Move a Salci Support ticket from the inbox. Super admins only. Thin wrapper over _support_apply_status so the inbox and the /tasks panel produce identical system rows, resolved_at stamps and notifications. Returns { ticket_id, status, notify }.';
```

- [ ] **Step 2: Append the rewritten `resolve_support_task`, signature preserved**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- resolve_support_task: the /tasks entry point.
--
-- MUST NOT be dropped and MUST keep RETURNS void: it is live at
-- src/components/tms/TaskDetailPanel.tsx via useResolveSupportRequest, and it
-- is how the support owner resolves a ticket from their habitual surface.
--
-- Rewritten as a wrapper. The outcome vocabulary maps completed -> resolved and
-- rejected -> closed, then the shared routine does everything else, including
-- the done_pending_approval step-off, the completed-task guard, the system row
-- and the reporter notification.
--
-- Because the signature stays void, the notify payload is discarded on this
-- path: the in-app notification is still written inside the transaction (it is
-- the durable channel), but no email is sent from /tasks. That is a deliberate
-- trade for not breaking a live call site.
-- ---------------------------------------------------------------------------
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
  v_status    text;
  v_ticket    uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can resolve a support request.';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'Unknown outcome for a support request.';
  END IF;

  v_status := CASE WHEN p_outcome = 'completed' THEN 'resolved' ELSE 'closed' END;

  -- Authority on the unforgeable marker, not on a client-writable flag: no
  -- client can create a tasks row in the SALCI Support institution, because the
  -- tasks INSERT policy pins institution_id to the author's own school.
  v_inst := public.get_support_institution_id();

  SELECT t.institution_id INTO v_task_inst
  FROM public.tasks t WHERE t.id = p_task_id;

  IF v_task_inst IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  IF v_inst IS NULL OR v_task_inst <> v_inst THEN
    RAISE EXCEPTION 'That task is not a support request.';
  END IF;

  SELECT ri.id INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.task_id = p_task_id
  ORDER BY ri.created_at
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  PERFORM public._support_apply_status(v_ticket, v_status, p_note);
END;
$$;

COMMENT ON FUNCTION public.resolve_support_task(uuid, text, text) IS
  'Resolve a Salci Support ticket from the /tasks panel. Super admins only. Signature preserved for the live TaskDetailPanel call site; body is a wrapper over _support_apply_status so both entry points share one write path.';
```

- [ ] **Step 3: Append the modified `create_support_task`**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- create_support_task: intake, unchanged in signature, three changes in body.
--
--   1. category and priority are written into the new reported_issues columns.
--      They used to survive only as free text inside tasks.description, which
--      is why the inbox could never filter or report on either.
--   2. The 'Category: ' line is no longer appended to tasks.description: the
--      column is now the record.
--   3. Message 1 is seeded into support_messages from the reporter's own text,
--      so a new ticket opens with content instead of an empty thread, and
--      last_message_at is stamped so the inbox orders it correctly.
--
-- The 5-per-hour throttle, the reporter snapshot, the assigner shape and the
-- owner notification are all unchanged.
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

  -- Urgency arrives as 1..3; clamp rather than trust the client.
  v_priority := least(greatest(coalesce(p_priority, 2), 1), 3);
  v_category := nullif(btrim(coalesce(p_category, '')), '');

  SELECT count(*) INTO v_recent
  FROM public.reported_issues
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You have already sent 5 support requests in the last hour. Please wait a little before sending another.';
  END IF;

  v_inst := public.get_support_institution_id();
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Support is not set up yet. Please contact SALCI directly.';
  END IF;

  v_owner := public.get_support_owner_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No support owner is configured. Please contact SALCI directly.';
  END IF;

  -- Reporter snapshot. Baked in as TEXT so rendering a ticket never needs a
  -- cross-tenant profiles read: profiles RLS hides the reporter from the SALCI
  -- admin and vice versa.
  SELECT p.id, p.full_name, p.email, p.institution_id, i.name
    INTO v_author, v_name, v_email, v_rep_inst, v_school
  FROM public.profiles p
  LEFT JOIN public.institutions i ON i.id = p.institution_id
  WHERE p.id = v_uid;

  SELECT string_agg(DISTINCT ur.role::text, ', ')
    INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid;

  SELECT string_agg(DISTINCT btrim(c.name || ' ' || coalesce(c.section, '')), ', ')
    INTO v_classes
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

  INSERT INTO public.tasks (institution_id, title, description, task_type, status, priority)
  VALUES (
    v_inst,
    left(v_subject, 200),
    v_desc,
    'general'::public.task_type,
    'open'::public.task_status,
    v_priority
  )
  RETURNING id INTO v_task;

  -- Reporter is the assigner. When the support owner files a ticket
  -- themselves, the no_self_assignment CHECK would reject the row, so fall
  -- back to the established NULL-assigner "SALCI System" shape.
  INSERT INTO public.task_assignments (task_id, assignee_id, assigner_id)
  VALUES (v_task, v_owner, CASE WHEN v_uid = v_owner THEN NULL ELSE v_uid END);

  INSERT INTO public.reported_issues (
    reporter_id, reporter_name, reporter_email, reporter_role,
    institution_name, institution_id, classes_assigned,
    subject, description, status, task_id,
    category, priority, last_message_at
  ) VALUES (
    v_uid, v_name, v_email, v_role,
    v_school, v_rep_inst, v_classes,
    v_subject, v_body, 'open', v_task,
    v_category, v_priority, now()
  )
  RETURNING id INTO v_ticket;

  -- Message 1, from the reporter's own text, so the thread never opens empty.
  -- author_id is the resolved profiles row (NULL when there is none); the
  -- snapshot name carries the attribution either way.
  INSERT INTO public.support_messages (
    ticket_id, author_id, author_name, author_side, kind, body, is_internal
  ) VALUES (
    v_ticket, v_author, coalesce(v_name, 'Reporter'),
    'reporter', 'message', v_body, false
  );

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_owner,
    'task_assigned',
    'New support request',
    coalesce(v_name, 'A user')
      || coalesce(' from ' || v_school, '')
      || ': ' || v_subject,
    '/admin/issues?ticket=' || v_ticket::text,
    jsonb_build_object('task_id', v_task, 'ticket_id', v_ticket, 'category', v_category)
  );

  RETURN jsonb_build_object('ticket_id', v_ticket, 'task_id', v_task);
END;
$$;

COMMENT ON FUNCTION public.create_support_task(text, text, text, integer, text) IS
  'Salci Support intake. Creates a task in the SALCI Support institution assigned to the configured owner with the reporter as assigner, records category and priority on reported_issues, and seeds message 1 into support_messages. Throttled to 5 per caller per hour.';
```

- [ ] **Step 4: Dry run the file again**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
$body = Get-Content supabase\migrations\20260831130000_support_rpcs.sql -Raw
Set-Content -Encoding utf8 scripts\support\dryrun-support-rpcs.sql ("BEGIN;`n" + $body + "`nROLLBACK;")
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\dryrun-support-rpcs.sql -OutFile scripts\support\out-dryrun.json
Get-Content scripts\support\out-dryrun.json -Raw
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260831130000_support_rpcs.sql
git commit -m "feat(support): route set_support_ticket_status and resolve_support_task through one write path"
```

---

### Task 13: Grants, apply to production, and prove the assertion PASSES

**Files:**
- Modify: `supabase/migrations/20260831130000_support_rpcs.sql` (append)
- Create: `scripts/support/behaviour-support-rpcs.sql`

**Interfaces:**
- Consumes: every function created in Tasks 9 to 12
- Produces: a production database where `scripts/support/assert-support-rpcs.sql` returns PASS on all 24 rows

- [ ] **Step 1: Append the grant and revoke block**

Append to `supabase/migrations/20260831130000_support_rpcs.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- function in public, AND functions carry an implicit EXECUTE grant to PUBLIC.
-- Both must be stripped, BY NAME, on every function:
--   * REVOKE FROM PUBLIC alone leaves the explicit anon grant standing.
--   * REVOKE FROM anon alone leaves the PUBLIC grant standing, and anon is a
--     member of PUBLIC. This is the half that bit on 20260814120000.
--
-- Verify with pg_proc.proacl, never information_schema.routine_privileges,
-- which does not expand PUBLIC membership. An aclitem whose grantee is empty
-- (it renders as '=X/postgres') means PUBLIC still holds EXECUTE.
--
-- _support_apply_status is internal: authenticated is revoked too. The two
-- wrappers are SECURITY DEFINER owned by postgres, so they call it as postgres
-- and are unaffected.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM anon;

-- Internal only. Reachable exclusively through the two DEFINER wrappers.
REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text) FROM authenticated;

-- Explicit, because DROP FUNCTION reset the ACL on set_support_ticket_status
-- and on support_inbox_counts, and because relying on default privileges is
-- what produced the leak above.
GRANT EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- In-migration privilege assertion. Fails the migration rather than leaving a
-- silently over-granted function behind.
-- ---------------------------------------------------------------------------
DO $acl$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_support_apply_status','list_my_support_tickets','get_support_thread',
      'post_support_message','set_support_ticket_status','resolve_support_task',
      'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
      'create_support_task')
    AND (
      p.proacl IS NULL
      OR EXISTS (SELECT 1 FROM unnest(p.proacl) AS a WHERE a::text LIKE '=%')
      OR EXISTS (SELECT 1 FROM unnest(p.proacl) AS a WHERE a::text LIKE 'anon=%')
    );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on: %', v_bad;
  END IF;
END
$acl$;
```

- [ ] **Step 2: Write the behavioural test, wrapped in an explicit transaction that rolls back**

Create `scripts/support/behaviour-support-rpcs.sql`:

```sql
-- Behavioural test for the Phase 2 RPCs, against PROD, rolled back at the end.
-- Nothing here is committed. The DO block raises on the first failed assertion,
-- which aborts the transaction; a clean run means every assertion held.
--
-- auth.uid() reads request.jwt.claims, so each impersonation is one
-- set_config(..., true) call. The RPCs are SECURITY DEFINER and run as postgres
-- regardless, so this exercises the RPC logic, not RLS.
BEGIN;

DO $test$
DECLARE
  v_admin    uuid;
  v_reporter uuid;
  v_other    uuid;
  v_ticket   uuid;
  v_res      jsonb;
  v_res2     jsonb;
  v_token    uuid := gen_random_uuid();
  v_before   int;
  v_after    int;
  v_have     int;
  v_i        int;
  v_status   text;
  v_leaked   int;
BEGIN
  SELECT ur.user_id INTO v_admin
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'
  ORDER BY ur.user_id
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no super admin found.';
  END IF;

  SELECT ri.id, ri.reporter_id INTO v_ticket, v_reporter
  FROM public.reported_issues ri
  WHERE ri.reporter_id IS NOT NULL
    AND ri.reporter_id <> v_admin
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ri.reporter_id)
  ORDER BY ri.created_at DESC
  LIMIT 1;
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no ticket with a live reporter profile found.';
  END IF;

  -- --- 1. A super admin can post an internal note, and it moves nothing -----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  UPDATE public.reported_issues SET status = 'open' WHERE id = v_ticket;

  v_res := public.post_support_message(v_ticket, 'Internal triage note.', true, '[]'::jsonb, NULL);

  SELECT status INTO v_status FROM public.reported_issues WHERE id = v_ticket;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'FAIL 1a: an internal note moved the status to %.', v_status;
  END IF;
  IF v_res -> 'notify' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL 1b: an internal note produced a notify payload.';
  END IF;

  -- --- 2. A public SALCI reply on an open ticket moves it to in_progress ----
  v_res := public.post_support_message(v_ticket, 'We are looking into this.', false, '[]'::jsonb, NULL);
  IF v_res ->> 'status' <> 'in_progress' THEN
    RAISE EXCEPTION 'FAIL 2a: expected in_progress, got %.', v_res ->> 'status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_messages
                 WHERE ticket_id = v_ticket AND kind = 'system'
                   AND body = 'SALCI started working on this.') THEN
    RAISE EXCEPTION 'FAIL 2b: no system row for the implicit in_progress move.';
  END IF;

  -- --- 3. The reporter never sees the internal note ------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_leaked
  FROM jsonb_array_elements(public.get_support_thread(v_ticket, 100, NULL) -> 'messages') m
  WHERE (m ->> 'is_internal')::boolean;
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 3: the reporter thread contains % internal rows.', v_leaked;
  END IF;

  -- --- 4. client_token makes the post idempotent ---------------------------
  SELECT count(*) INTO v_before FROM public.support_messages WHERE ticket_id = v_ticket;
  v_res  := public.post_support_message(v_ticket, 'Any update please.', false, '[]'::jsonb, v_token);
  v_res2 := public.post_support_message(v_ticket, 'Any update please.', false, '[]'::jsonb, v_token);
  SELECT count(*) INTO v_after FROM public.support_messages WHERE ticket_id = v_ticket;
  IF v_res ->> 'message_id' <> v_res2 ->> 'message_id' THEN
    RAISE EXCEPTION 'FAIL 4a: the repeated client_token returned a different message.';
  END IF;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL 4b: the repeated client_token inserted a second row.';
  END IF;

  -- --- 5. A reporter cannot post an internal note --------------------------
  BEGIN
    PERFORM public.post_support_message(v_ticket, 'Sneaky.', true, '[]'::jsonb, NULL);
    RAISE EXCEPTION 'FAIL 5: a reporter was allowed to post an internal note.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%internal note%' THEN
      RAISE;
    END IF;
  END;

  -- --- 6. A reporter reply on a resolved ticket reopens it -----------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_support_ticket_status(v_ticket, 'resolved', NULL);

  SELECT ri.status INTO v_status
  FROM public.reported_issues ri WHERE ri.id = v_ticket;
  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'FAIL 6a: expected resolved, got %.', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reported_issues
                 WHERE id = v_ticket AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 6b: resolved_at was not stamped.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);
  v_res := public.post_support_message(v_ticket, 'This is still happening.', false, '[]'::jsonb, NULL);
  IF v_res ->> 'status' <> 'open' THEN
    RAISE EXCEPTION 'FAIL 6c: the reply did not reopen the ticket, status is %.', v_res ->> 'status';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reported_issues
             WHERE id = v_ticket AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 6d: resolved_at was not cleared on reopen.';
  END IF;
  IF v_res ->> 'notify' IS NULL THEN
    RAISE EXCEPTION 'FAIL 6e: the reopen produced no notify payload.';
  END IF;

  -- --- 7. list_my_support_tickets is bounded and self-scoped ---------------
  v_res := public.list_my_support_tickets(200, 0);
  IF jsonb_array_length(v_res -> 'tickets') > 100 THEN
    RAISE EXCEPTION 'FAIL 7a: p_limit was not clamped to 100.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_res -> 'tickets') t
    JOIN public.reported_issues ri ON ri.id = (t ->> 'id')::uuid
    WHERE ri.reporter_id IS DISTINCT FROM v_reporter
  ) THEN
    RAISE EXCEPTION 'FAIL 7b: the list returned another reporter''s ticket.';
  END IF;
  IF v_res -> 'counts' IS NULL THEN
    RAISE EXCEPTION 'FAIL 7c: the list returned no counts object.';
  END IF;
  IF (v_res -> 'counts' ->> 'total')::int
     IS DISTINCT FROM (SELECT count(*)::int FROM public.reported_issues
                       WHERE reporter_id = v_reporter) THEN
    RAISE EXCEPTION 'FAIL 7d: counts.total does not match the reporter''s ticket count.';
  END IF;
  IF (v_res -> 'counts' ->> 'active')::int
     IS DISTINCT FROM (SELECT count(*)::int FROM public.reported_issues
                       WHERE reporter_id = v_reporter
                         AND status IN ('open', 'in_progress')) THEN
    RAISE EXCEPTION 'FAIL 7e: counts.active does not match the reporter''s open work.';
  END IF;

  -- --- 8. A reporter cannot export a transcript ---------------------------
  BEGIN
    PERFORM public.get_support_ticket_transcript(v_ticket);
    RAISE EXCEPTION 'FAIL 8: a reporter exported a transcript.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only SALCI support%' THEN
      RAISE;
    END IF;
  END;

  -- --- 9. awaiting_salci exists, and p_status scopes it without ------------
  --        disturbing the per-status tab counts.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.support_inbox_counts(
             p_institution_id => NULL, p_role => NULL, p_status => NULL);
  IF v_res -> 'awaiting_salci' IS NULL THEN
    RAISE EXCEPTION 'FAIL 9a: support_inbox_counts has no awaiting_salci key.';
  END IF;

  v_res2 := public.support_inbox_counts(
              p_institution_id => NULL, p_role => NULL, p_status => 'open');
  IF (v_res2 ->> 'awaiting_salci')::int > (v_res ->> 'awaiting_salci')::int THEN
    RAISE EXCEPTION
      'FAIL 9b: p_status = open widened awaiting_salci (% vs %) instead of narrowing it.',
      v_res2 ->> 'awaiting_salci', v_res ->> 'awaiting_salci';
  END IF;
  IF (v_res2 ->> 'open')        IS DISTINCT FROM (v_res ->> 'open')
  OR (v_res2 ->> 'in_progress') IS DISTINCT FROM (v_res ->> 'in_progress')
  OR (v_res2 ->> 'resolved')    IS DISTINCT FROM (v_res ->> 'resolved')
  OR (v_res2 ->> 'closed')      IS DISTINCT FROM (v_res ->> 'closed')
  OR (v_res2 ->> 'total')       IS DISTINCT FROM (v_res ->> 'total') THEN
    RAISE EXCEPTION 'FAIL 9c: p_status changed the per-status tab counts.';
  END IF;

  BEGIN
    PERFORM public.support_inbox_counts(
              p_institution_id => NULL, p_role => NULL, p_status => 'archived');
    RAISE EXCEPTION 'FAIL 9d: an unknown status filter was accepted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unknown support status filter%' THEN
      RAISE;
    END IF;
  END;

  -- --- 10. An unrelated reporter cannot read this ticket or its thread ------
  --        This is the assertion the whole confidentiality design rests on.
  --        can_access_support_ticket() allows a super admin or the ticket's own
  --        reporter and nobody else, so the second identity must be neither.
  SELECT p.id INTO v_other
  FROM public.profiles p
  WHERE p.id <> v_reporter
    AND p.id <> v_admin
    AND NOT public.is_super_admin(p.id)
  ORDER BY p.id
  LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no second, non-super-admin profile found.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.get_support_thread(v_ticket, 50, NULL);
    RAISE EXCEPTION 'FAIL 10a: an unrelated reporter read another reporter''s thread.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access to this support request%' THEN
      RAISE;
    END IF;
  END;

  SELECT count(*) INTO v_leaked
  FROM jsonb_array_elements(public.list_my_support_tickets(100, 0) -> 'tickets') t
  WHERE (t ->> 'id')::uuid = v_ticket;
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 10b: another reporter''s ticket appeared in an unrelated reporter''s list.';
  END IF;

  -- --- 11. The 31st message from one author within an hour is refused ------
  --        post_support_message counts support_messages.author_id over the last
  --        hour and refuses at 30. author_id is the caller's profiles id, and an
  --        earlier guard in the same function rejects a caller with no profiles
  --        row, so the throttle always counts a column that is populated and can
  --        never be sidestepped by a NULL author_id. Each probe carries its own
  --        p_client_token, otherwise the idempotency branch would keep returning
  --        the first message and the loop would never reach the limit.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);

  SELECT count(*)::int INTO v_have
  FROM public.support_messages m
  WHERE m.author_id = v_reporter
    AND m.created_at > now() - interval '1 hour';

  v_i := v_have;
  WHILE v_i < 30 LOOP
    PERFORM public.post_support_message(
      v_ticket, 'Throttle probe ' || v_i::text || '.', false, '[]'::jsonb, gen_random_uuid());
    v_i := v_i + 1;
  END LOOP;

  SELECT count(*)::int INTO v_have
  FROM public.support_messages m
  WHERE m.author_id = v_reporter
    AND m.created_at > now() - interval '1 hour';
  IF v_have < 30 THEN
    RAISE EXCEPTION 'FAIL 11a: only % messages landed for the reporter, the throttle was never reached.', v_have;
  END IF;

  BEGIN
    PERFORM public.post_support_message(
      v_ticket, 'One message too many.', false, '[]'::jsonb, gen_random_uuid());
    RAISE EXCEPTION 'FAIL 11b: the 31st message within an hour was accepted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%30 support messages in the last hour%' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'All support RPC behaviour assertions held.';
END
$test$;

ROLLBACK;
```

- [ ] **Step 3: Apply the migration to production**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile supabase\migrations\20260831130000_support_rpcs.sql -OutFile scripts\support\out-apply.json
Get-Content scripts\support\out-apply.json -Raw
```

- [ ] **Step 4: Re-run the Phase 2 assertion. Every one of the 24 rows must now read PASS**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\assert-support-rpcs.sql -OutFile scripts\support\out-assert-after.json
Get-Content scripts\support\out-assert-after.json -Raw
```

Any FAIL row means the migration did not do what it claims. Fix and re-apply before continuing.

- [ ] **Step 5: Run the behavioural test. A clean run means every assertion held**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\behaviour-support-rpcs.sql -OutFile scripts\support\out-behaviour.json
Get-Content scripts\support\out-behaviour.json -Raw
```

A thrown error names the failing assertion (`FAIL 1a`, `FAIL 6c`, and so on). The transaction rolls back either way, so production data is untouched.

- [ ] **Step 6: Independently verify the ACLs against `pg_proc.proacl`**

Create `scripts/support/verify-support-acl.sql`:

```sql
-- The authoritative privilege check. information_schema.routine_privileges does
-- NOT expand PUBLIC, so it looks clean while PUBLIC still holds EXECUTE.
-- An aclitem with an empty grantee renders as '=X/postgres' and IS the PUBLIC grant.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       coalesce(array_to_string(p.proacl, ' | '), '(NULL: default privileges, PUBLIC has EXECUTE)') AS acl,
       CASE
         WHEN p.proacl IS NULL THEN 'FAIL'
         WHEN EXISTS (SELECT 1 FROM unnest(p.proacl) AS a WHERE a::text LIKE '=%') THEN 'FAIL'
         WHEN EXISTS (SELECT 1 FROM unnest(p.proacl) AS a WHERE a::text LIKE 'anon=%') THEN 'FAIL'
         ELSE 'PASS'
       END AS verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    '_support_apply_status','list_my_support_tickets','get_support_thread',
    'post_support_message','set_support_ticket_status','resolve_support_task',
    'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
    'create_support_task')
ORDER BY p.proname;
```

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
powershell -File scripts\run-sql.ps1 -SqlFile scripts\support\verify-support-acl.sql -OutFile scripts\support\out-acl.json
Get-Content scripts\support\out-acl.json -Raw
```

All ten rows must read `PASS`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260831130000_support_rpcs.sql scripts/support/behaviour-support-rpcs.sql scripts/support/verify-support-acl.sql
git commit -m "feat(support): revoke PUBLIC and anon on every support RPC, with behavioural and ACL verification"
```

---

### Task 14: Regenerate `types.ts` from production and run the full verification cycle

**Files:**
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: the live production schema after Task 13
- Produces: `Database["public"]["Functions"]` entries for `list_my_support_tickets`, `get_support_thread`, `post_support_message`, `set_support_ticket_status`, `mark_support_ticket_read`, `support_inbox_counts`, `get_support_ticket_transcript`, and `Database["public"]["Tables"]["support_messages"]`, which Phase 3 onward types its `supabase.rpc(...)` calls against

- [ ] **Step 1: Record the current file size so the regeneration can be sanity-checked**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
(Get-Content src\integrations\supabase\types.ts | Measure-Object -Line).Lines
```

Write the number down. A regeneration that loses hundreds of lines has silently dropped schema, which has happened in this repo before.

- [ ] **Step 2: Regenerate the types from production**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src\integrations\supabase\types.ts
(Get-Content src\integrations\supabase\types.ts | Measure-Object -Line).Lines
```

The new line count must be greater than or equal to the number from Step 1. If it dropped, restore with `git checkout -- src/integrations/supabase/types.ts` and investigate before retrying.

- [ ] **Step 3: Confirm the new surface actually landed in the generated types**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
Select-String -Path src\integrations\supabase\types.ts -Pattern "support_messages","list_my_support_tickets","get_support_thread","post_support_message","mark_support_ticket_read","get_support_ticket_transcript" | Select-Object -ExpandProperty Pattern -Unique
```

All six patterns must appear. `_support_apply_status` deliberately will NOT: `authenticated` has no EXECUTE on it, so PostgREST does not expose it, which is exactly the intent.

- [ ] **Step 4: Confirm the dropped column is gone from the generated types**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
Select-String -Path src\integrations\supabase\types.ts -Pattern "admin_notes"
```

This must return nothing. If it still matches, Phase 1's `DROP COLUMN` did not reach production.

- [ ] **Step 5: Run the repo's full verification cycle. All three must exit 0**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
npm run typecheck
```

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
npx eslint src/integrations/supabase/types.ts
```

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
npx vite build
```

`npm run typecheck` runs `tsc -p tsconfig.app.json --noEmit`. Do not substitute bare `npx tsc --noEmit`: the root tsconfig has `files: []` plus project references, so it always exits 0 and checks nothing. Bundle-size warnings above 500 kB from `vite build` are not failures; a non-zero exit code is.

- [ ] **Step 6: Clean up the run-sql output artefacts so they are not committed**

```powershell
cd "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main"
Remove-Item scripts\support\out-*.json -ErrorAction SilentlyContinue
Remove-Item scripts\support\dryrun-support-rpcs.sql -ErrorAction SilentlyContinue
```

- [ ] **Step 7: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regenerate Supabase types from prod after the support RPC migration"
```

---

## Phase 3 - Reporter surface (/support)

### Task 15: Support ticket hooks (`useSupportTickets.ts`)

**Files:**
- Create: `src/hooks/useSupportTickets.ts`

**Interfaces:**
- Consumes (from Phase 2, must already be live in prod and present in the regenerated `src/integrations/supabase/types.ts`): RPCs `list_my_support_tickets(p_limit, p_offset)`, `get_support_thread(p_ticket_id, p_limit, p_before)`, `post_support_message(p_ticket_id, p_body, p_is_internal, p_attachments, p_client_token)`, `mark_support_ticket_read(p_ticket_id)`.
- Produces: `useMySupportTickets`, `useSupportThread`, `usePostSupportMessage`, `useMarkSupportTicketRead`, `SUPPORT_TAB_STATUSES`, `SUPPORT_STATUS_LABELS`, `SUPPORT_STATUS_TONES`, types `SupportTicket`, `SupportMessage`, `SupportAttachment`, `SupportNotify`, `SupportTab`, `SupportTicketStatus`, `SupportTicketCounts`, `SupportThreadPayload`, `PostSupportMessageInput`, `PostSupportMessageResult`, `MySupportTickets`. `MySupportTickets.counts` is the server-aggregated `counts` object from `list_my_support_tickets`, passed through untouched.

- [ ] **Step 1: Confirm Phase 2 landed and `types.ts` knows the four RPCs**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "list_my_support_tickets\|get_support_thread\|post_support_message\|mark_support_ticket_read" src/integrations/supabase/types.ts | head
```

All four names must appear. If any is missing, stop: Phase 2 did not regenerate `src/integrations/supabase/types.ts` from prod (`npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw`), and every file in this phase will fail `npm run typecheck`.

- [ ] **Step 2: Write the hook file**

Create `src/hooks/useSupportTickets.ts` with exactly this content:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toastError } from "@/lib/toast";

/**
 * Reporter-side Salci Support: the reporter's own tickets and the two-way
 * conversation on each of them.
 *
 * Every read here is an RPC, never a table read. `reported_issues` SELECT is
 * super-admin-only (Phase 1 narrowed it), and `support_messages` has a SELECT
 * policy but deliberately NO insert/update/delete policy, so the whole write
 * path is the SECURITY DEFINER `post_support_message`. That is what makes the
 * internal/external split unforgeable from a client.
 *
 * Design: docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
 */

/**
 * The three reporter tabs and the ticket statuses each one covers.
 * `all` is also the canonical status vocabulary, and the CHECK constraint on
 * `reported_issues.status` allows exactly these four values.
 */
export const SUPPORT_TAB_STATUSES = {
  active: ["open", "in_progress"],
  resolved: ["resolved", "closed"],
  all: ["open", "in_progress", "resolved", "closed"],
} as const;

export type SupportTab = keyof typeof SUPPORT_TAB_STATUSES;
export type SupportTicketStatus = (typeof SUPPORT_TAB_STATUSES)["all"][number];

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * Copied verbatim from AdminIssuesPage's STATUS_TONES so a ticket reads
 * identically to the reporter and to SALCI. If one side ever changes, change
 * both: a status that looks amber on one surface and grey on the other is a
 * support conversation about the support tool.
 */
export const SUPPORT_STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

export interface SupportAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface SupportMessage {
  id: string;
  author_side: "reporter" | "salci" | "system";
  author_name: string | null;
  kind: "message" | "system";
  body: string;
  is_internal: boolean;
  attachments: SupportAttachment[];
  created_at: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  category: string | null;
  priority: number | null;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_role: string | null;
  institution_name: string | null;
  created_at: string;
  last_message_at: string | null;
  resolved_at: string | null;
  first_response_at: string | null;
  message_count: number;
  has_unread: boolean;
}

/** Returned by `post_support_message` so the caller can fire the notification
 *  email without a second round trip. Wired up in Phase 5. */
export interface SupportNotify {
  to_user_id: string;
  to_email: string | null;
  to_name: string | null;
  kind: "support_reply" | "support_status_changed" | "support_reopened";
  ticket_id: string;
  subject: string;
  preview: string;
}

/**
 * The stat-tile counts, aggregated in Postgres over EVERY ticket the caller
 * owns. They are not derived from the returned page, so they stay correct past
 * the 100-row clamp.
 */
export interface SupportTicketCounts {
  active: number;
  awaiting: number;
  resolved: number;
  total: number;
}

interface ListMyTicketsPayload {
  tickets: SupportTicket[];
  has_more: boolean;
  counts: SupportTicketCounts;
}

export interface SupportThreadPayload {
  ticket: SupportTicket;
  messages: SupportMessage[];
  has_more: boolean;
}

export interface MySupportTickets {
  tickets: SupportTicket[];
  counts: SupportTicketCounts;
  hasMore: boolean;
}

const EMPTY_SUPPORT_COUNTS: SupportTicketCounts = {
  active: 0,
  awaiting: 0,
  resolved: 0,
  total: 0,
};

const SUPPORT_STALE_TIME = 60_000;
/** The RPC clamps `p_limit` to 100 server-side; ask for the clamp. */
const SUPPORT_LIST_LIMIT = 100;
/** `get_support_thread` is cursor-paginated on created_at; this is one page. */
const SUPPORT_THREAD_LIMIT = 50;

/**
 * The caller's own tickets, filtered to one tab.
 *
 * Scale Gate item 1 (bounded): `p_limit` is 100 and the RPC clamps it.
 * Scale Gate item 2 (server-side aggregation): the tile counts come back in
 * `payload.counts`, aggregated in Postgres over every ticket the caller owns.
 * Counting the returned page in the browser would both violate the gate and go
 * quietly wrong the moment a reporter passes the 100-row clamp, because the
 * page it counted is not the whole history.
 *
 * The one client-side pass that remains is the tab filter, which selects rows
 * out of an already materialised page. It computes no number.
 *
 * `userId` is in the query key on purpose: ["tasks-assigned-by-me"] omits it
 * and can serve a previous session's list after a user switch.
 */
export function useMySupportTickets(tab: SupportTab) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ["support-my-tickets", userId, tab],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MySupportTickets> => {
      const { data, error } = await supabase.rpc("list_my_support_tickets", {
        p_limit: SUPPORT_LIST_LIMIT,
        p_offset: 0,
      });
      if (error) throw error;

      const payload = (data as unknown as ListMyTicketsPayload | null) ?? {
        tickets: [],
        has_more: false,
        counts: EMPTY_SUPPORT_COUNTS,
      };
      const all = payload.tickets ?? [];

      const wanted = SUPPORT_TAB_STATUSES[tab] as readonly SupportTicketStatus[];
      return {
        tickets: all.filter((t) => wanted.includes(t.status)),
        counts: payload.counts ?? EMPTY_SUPPORT_COUNTS,
        hasMore: Boolean(payload.has_more),
      };
    },
    staleTime: SUPPORT_STALE_TIME,
  });
}

/**
 * One ticket's header plus its latest page of messages.
 *
 * Internal SALCI notes are stripped server-side for a reporter, so this hook
 * is safe to mount on both surfaces without a client-side filter that could be
 * forgotten.
 *
 * `refetchOnWindowFocus` is on here and only here: a conversation is exactly
 * the surface where coming back to the tab should show the new reply, and one
 * bounded RPC on focus is far cheaper than a realtime channel (§23).
 */
export function useSupportThread(ticketId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["support-thread", ticketId],
    enabled: Boolean(ticketId) && enabled,
    queryFn: async (): Promise<SupportThreadPayload> => {
      const { data, error } = await supabase.rpc("get_support_thread", {
        p_ticket_id: ticketId as string,
        p_limit: SUPPORT_THREAD_LIMIT,
      });
      if (error) throw error;
      return data as unknown as SupportThreadPayload;
    },
    staleTime: SUPPORT_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export interface PostSupportMessageInput {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  attachments?: SupportAttachment[];
  /** Idempotency key. A partial unique index on support_messages.client_token
   *  makes a repeated post return the SAME message instead of a duplicate, so
   *  a retry after a flaky network is safe. Hold one token per draft. */
  clientToken: string;
}

export interface PostSupportMessageResult {
  message_id: string;
  status: SupportTicketStatus;
  notify: SupportNotify | null;
}

/**
 * The single write path for the conversation. Message, `last_message_at`,
 * `first_response_at`, any implicit status move, its system row and the in-app
 * notification all happen inside this one transaction (Scale Gate item 6).
 */
export function usePostSupportMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PostSupportMessageInput): Promise<PostSupportMessageResult> => {
      const { data, error } = await supabase.rpc("post_support_message", {
        p_ticket_id: input.ticketId,
        p_body: input.body,
        p_is_internal: input.isInternal ?? false,
        p_attachments: (input.attachments ?? []) as unknown as Json,
        p_client_token: input.clientToken,
      });
      if (error) throw error;
      return data as unknown as PostSupportMessageResult;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["support-thread", variables.ticketId] });
      for (const key of ["support-my-tickets", "support-inbox", "support-inbox-counts"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't send your message.",
        context: "postSupportMessage",
      }),
  });
}

/**
 * Stamps `reporter_last_read_at` or `salci_last_read_at` by caller side. The
 * RPC decides which, so both surfaces call it identically. Naturally
 * idempotent (Scale Gate item 5).
 */
export function useMarkSupportTicketRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase.rpc("mark_support_ticket_read", {
        p_ticket_id: ticketId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ["support-my-tickets", "support-inbox", "support-inbox-counts"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    // Deliberately NOT toasted. This is a background read receipt the user
    // never asked for; a failed stamp costs an unread dot, and interrupting
    // someone reading a support reply with an error toast is worse than that.
    // Every user-initiated mutation in this file does route through toastError.
    onError: (error: Error) => {
      console.warn("[support] mark read failed:", error.message);
    },
  });
}
```

- [ ] **Step 3: Verify**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/hooks/useSupportTickets.ts
```

Both must exit 0. There is no test runner in this repo; typecheck plus eslint plus `npx vite build` is the whole verification cycle (CLAUDE.md §5a).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSupportTickets.ts
git commit -m "feat(support): reporter-side ticket and thread hooks"
```

---

### Task 16: `SupportComposer` (message box, internal toggle, reopen hint)

**Files:**
- Create: `src/components/issues/SupportComposer.tsx`

**Interfaces:**
- Consumes: `usePostSupportMessage`, `SupportTicket` from `@/hooks/useSupportTickets`.
- Produces: `SupportComposer`, `SupportComposerProps` with exactly `{ ticketId: string; canPostInternal: boolean; ticketStatus?: SupportTicket["status"]; onPosted?: () => void }`. This is the FINAL prop contract: Phase 6 Task 34 EDITS this file to add the attachment picker (a file input, a pending-file list and an upload call inside `handleSend`), and does not change these four props. Do not invent attachment props here, since a prop that no caller passes for three phases is a prop nobody maintains.

- [ ] **Step 0: Read the hook this component writes through**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "usePostSupportMessage" -A 30 src/hooks/useSupportTickets.ts
```

Confirm the mutation variables are `{ ticketId, body, isInternal, attachments, clientToken }` and that the hook's `useMutation` already carries the `onError: (error: Error) => toastError(...)` written in Task 15. The composer below passes only an `onSuccess` to `post.mutate`, so the hook owns every error toast. If that `onError` is missing, add it to the hook before continuing: a send that fails silently is worse than one that fails loudly.

- [ ] **Step 1: Write the composer**

Create `src/components/issues/SupportComposer.tsx`:

```tsx
import * as React from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  usePostSupportMessage,
  type SupportTicket,
} from "@/hooks/useSupportTickets";

export interface SupportComposerProps {
  ticketId: string;
  /** Super admin only. A reporter is rejected server-side if this is forged. */
  canPostInternal: boolean;
  /**
   * The ticket's current status, so a reporter replying to a resolved or
   * closed request is told, before they type, that the reply reopens it. The
   * reopen itself happens in `post_support_message`; this is only the warning.
   */
  ticketStatus?: SupportTicket["status"];
  /** Fired after a successful post, so the mounting surface can react. */
  onPosted?: () => void;
}

/**
 * Reply box for a support ticket, shared by /support and /admin/issues.
 *
 * The internal toggle restyles the whole box in amber, not just a label,
 * because a private note typed into the public field is the single most
 * expensive mistake this surface can produce.
 *
 * Errors are NOT handled here on purpose: `usePostSupportMessage` routes its
 * `onError` through `toastError`, so there is one translated message for every
 * caller of the write path (CLAUDE.md §19).
 *
 * Phase 6 (Task 34) edits this file to add the attachment picker: a hidden file
 * input, a pending-file list above the send row, and an upload step at the top
 * of `handleSend` that turns the picked files into `attachments`. The four
 * props above do not change.
 */
export function SupportComposer({
  ticketId,
  canPostInternal,
  ticketStatus,
  onPosted,
}: SupportComposerProps) {
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const post = usePostSupportMessage();

  // One idempotency token per draft, regenerated only after a successful post.
  // A retry of a failed send reuses the token, so a message that actually
  // landed before the network died is returned rather than duplicated.
  const tokenRef = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    setBody("");
    setIsInternal(false);
    tokenRef.current = crypto.randomUUID();
  }, [ticketId]);

  const trimmed = body.trim();
  const busy = post.isPending;
  const canSend = trimmed.length > 0 && !busy;

  // A reporter replying to a finished request reopens it. Say so before they
  // type, not after. SALCI's own reply never reopens anything.
  const reopensTicket =
    !canPostInternal && (ticketStatus === "resolved" || ticketStatus === "closed");

  const handleSend = () => {
    // Single flight: `busy` gates the double tap, `client_token` gates the
    // retry, and the RPC throttles the caller at 30 messages an hour.
    if (!canSend) return;

    post.mutate(
      {
        ticketId,
        body: trimmed,
        isInternal: canPostInternal && isInternal,
        attachments: [],
        clientToken: tokenRef.current,
      },
      {
        onSuccess: () => {
          setBody("");
          setIsInternal(false);
          tokenRef.current = crypto.randomUUID();
          onPosted?.();
        },
      },
    );
  };

  return (
    <form
      // Service-worker dirty-form contract (§17): while there is unsent text,
      // an update must toast rather than silently reload the page underneath.
      data-dirty={trimmed.length > 0 ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className="space-y-3"
    >
      {canPostInternal && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-card border p-3 transition-colors duration-200",
            isInternal
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-surface-stroke bg-surface-base/60",
          )}
        >
          <div className="min-w-0">
            <Label
              htmlFor={`support-internal-${ticketId}`}
              className="text-sm font-medium text-ink-900"
            >
              Internal note
            </Label>
            <p className="text-xs text-ink-500">
              {isInternal
                ? "Only SALCI can read this. The reporter is not notified."
                : "Off, so your reply goes to the reporter."}
            </p>
          </div>
          <Switch
            id={`support-internal-${ticketId}`}
            checked={isInternal}
            onCheckedChange={setIsInternal}
          />
        </div>
      )}

      <Textarea
        id={`support-composer-${ticketId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={isInternal ? "Write a note only SALCI can see." : "Write your reply"}
        rows={3}
        disabled={busy}
        aria-label={isInternal ? "Internal note" : "Reply"}
        className={cn(
          "resize-none",
          isInternal && "border-amber-500/50 bg-amber-500/5 focus-visible:ring-amber-500/40",
        )}
      />

      {reopensTicket && (
        <p className="text-xs text-ink-500">
          Replying reopens this request and tells SALCI.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          disabled={!canSend}
          className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
        >
          <Send className="mr-2 h-4 w-4" />
          {busy ? "Sending" : isInternal ? "Save note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/components/issues/SupportComposer.tsx
```

Both must exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/issues/SupportComposer.tsx
git commit -m "feat(support): shared ticket composer with internal-note toggle"
```

---

### Task 17: `SupportThread` (shared by /support and /admin/issues)

**Files:**
- Create: `src/components/issues/SupportThread.tsx`

**Interfaces:**
- Consumes: `useSupportThread`, `useMarkSupportTicketRead`, `SupportMessage` from `@/hooks/useSupportTickets`; `SupportComposer` from `./SupportComposer`; `EmptyState` from `@/components/shared/surfaces`.
- Produces: `SupportThread` with props `{ ticketId: string; canPostInternal: boolean; className?: string }`. `canPostInternal` is REQUIRED: whether a surface may write a private note is not a thing to default. `className` exists because Phase 4 mounts this inside `IssueDetailSheet` and needs to set the sheet body's spacing on it. Phase 4 mounts the component **unchanged** with `canPostInternal` true.

- [ ] **Step 1: Write the thread**

Create `src/components/issues/SupportThread.tsx`:

```tsx
import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, MessageSquare, Paperclip } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useMarkSupportTicketRead,
  useSupportThread,
  type SupportMessage,
} from "@/hooks/useSupportTickets";
import { SupportComposer } from "./SupportComposer";

export interface SupportThreadProps {
  ticketId: string;
  /** Super admin only. Shows the internal-note toggle on the composer. */
  canPostInternal: boolean;
  /** Merged onto the outer stack, so a sheet can set its own spacing. */
  className?: string;
}

function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/**
 * One message.
 *
 * Alignment is by AUTHOR SIDE, not by who is looking: the reporter is always
 * on the right and SALCI always on the left. That way a thread reads the same
 * on /support, on /admin/issues and in the exported transcript, and a
 * screenshot from one surface is legible on the other.
 */
function ThreadMessage({ message }: { message: SupportMessage }) {
  const when = relativeTime(message.created_at);

  // Status changes and reopens are centred muted single lines, never bubbles.
  // They are punctuation in the conversation, not turns in it.
  if (message.kind === "system" || message.author_side === "system") {
    return (
      <li className="flex justify-center">
        <p className="px-3 py-1 text-center text-xs text-ink-500">
          {message.body} <span className="text-ink-400">· {when}</span>
        </p>
      </li>
    );
  }

  const fromReporter = message.author_side === "reporter";

  return (
    <li className={cn("flex", fromReporter ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5",
          fromReporter
            ? "bg-brand-primary/10"
            : message.is_internal
              ? "border border-amber-500/40 bg-amber-500/10"
              : "surface-card frosted-shadow",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-700">
            {message.author_name || (fromReporter ? "Reporter" : "SALCI Support")}
          </span>
          {message.is_internal && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-600"
            >
              Internal
            </Badge>
          )}
        </div>

        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-900">
          {message.body}
        </p>

        {message.attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {message.attachments.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-1.5 text-xs text-ink-500"
              >
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate">{file.name}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-1 text-[11px] text-ink-400">{when}</p>
      </div>
    </li>
  );
}

/**
 * The conversation on one support ticket, plus the composer.
 *
 * Mounted by BOTH surfaces: /support passes canPostInternal false, the SALCI
 * inbox passes true. Internal rows are stripped server-side for a reporter, so
 * there is no client-side filter here that could be dropped by accident.
 *
 * This component renders as a plain stacked list and does not scroll itself:
 * both callers put it inside a MobileSheet, whose body is the scroll container.
 */
export function SupportThread({
  ticketId,
  canPostInternal,
  className,
}: SupportThreadProps) {
  const { data, isLoading, isError, error, refetch } = useSupportThread(ticketId);
  const markRead = useMarkSupportTicketRead();
  const markReadMutate = markRead.mutate;

  // Once per ticket open, and only after the thread actually loaded: stamping
  // "read" on a request that failed would clear the unread dot on messages the
  // user never saw.
  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!data || markedRef.current === ticketId) return;
    markedRef.current = ticketId;
    markReadMutate(ticketId);
  }, [data, ticketId, markReadMutate]);

  React.useEffect(() => {
    markedRef.current = null;
  }, [ticketId]);

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        <Skeleton className="h-16 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-3/4 rounded-2xl" />
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
      </div>
    );
  }

  // Error BEFORE empty (§6). A failed read must never render as "no replies
  // yet": that reads as SALCI ignoring the ticket, which is the worst possible
  // lie for this surface to tell.
  if (isError) {
    return (
      <div className={className}>
        <EmptyState
          icon={<AlertCircle className="h-7 w-7" />}
          title="Couldn't load this conversation"
          description={
            error instanceof Error
              ? error.message
              : "Something went wrong fetching the messages."
          }
          tone="rose"
          reason="error"
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
      </div>
    );
  }

  const messages = data?.messages ?? [];

  return (
    <div className={cn("space-y-4", className)}>
      {data?.has_more && (
        <p className="text-center text-xs text-ink-400">
          Showing the latest 50 messages.
        </p>
      )}

      {messages.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-7 w-7" />}
          title="No messages yet"
          description="Anything you write here goes straight to SALCI."
          size="sm"
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((message) => (
            <ThreadMessage key={message.id} message={message} />
          ))}
        </ul>
      )}

      <div className="border-t border-surface-stroke pt-4">
        {/* ticketStatus comes from the header this RPC already returned, so the
            composer can warn a reporter that replying reopens a finished
            request. onPosted re-stamps the read marker: the reply the user just
            sent moved last_message_at, and without this the ticket comes back
            in the list wearing its own unread dot. */}
        <SupportComposer
          ticketId={ticketId}
          canPostInternal={canPostInternal}
          ticketStatus={data?.ticket.status}
          onPosted={() => markReadMutate(ticketId)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/components/issues/SupportThread.tsx src/components/issues/SupportComposer.tsx
```

Both must exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/issues/SupportThread.tsx
git commit -m "feat(support): shared ticket thread with error-before-empty and read receipts"
```

---

### Task 18: `SupportPage` (the /support reporter surface)

**Files:**
- Create: `src/pages/SupportPage.tsx`

**Interfaces:**
- Consumes: `useMySupportTickets` (whose `counts` are aggregated server-side and drive both the stat tiles and the tab counts), `SUPPORT_STATUS_LABELS`, `SUPPORT_STATUS_TONES`, types `SupportTab`, `SupportTicket`, `SupportTicketCounts` from `@/hooks/useSupportTickets`; `SupportThread` from `@/components/issues/SupportThread`; `SupportRequestSheet` from `@/components/issues/SupportRequestSheet`; primitives `PageShell`, `PageHeader`, `StatTile`, `StatTileGrid`, `ListRow`, `EmptyState`, `MobileTabs`, `MobileSheet`.
- Produces: default export `SupportPage`, consumed by the `/support` route in Task 19 and by the `/support?ticket=<id>` deep link the Phase 5 notifications will emit.

- [ ] **Step 1: Write the page**

Create `src/pages/SupportPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  LifeBuoy,
  MailOpen,
  Plus,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, ListRow, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SupportRequestSheet } from "@/components/issues/SupportRequestSheet";
import { SupportThread } from "@/components/issues/SupportThread";
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_STATUS_TONES,
  useMySupportTickets,
  type SupportTab,
  type SupportTicket,
  type SupportTicketCounts,
} from "@/hooks/useSupportTickets";

const TAB_EMPTY_COPY: Record<SupportTab, { title: string; description: string }> = {
  active: {
    title: "No open requests",
    description: "Anything you raise with SALCI shows up here while we work on it.",
  },
  resolved: {
    title: "Nothing resolved yet",
    description: "Requests move here once SALCI closes them out.",
  },
  all: {
    title: "You have not raised anything yet",
    description: "Tap New request to tell SALCI what went wrong.",
  },
};

/**
 * Salci Support, reporter side.
 *
 * Every authenticated role reaches this page, students and employees included:
 * they are 37% of real reporters and had no tracking surface at all before it.
 * The route deliberately carries no allowedRoles and is deliberately absent
 * from FEATURE_URL_MAP, so no school can end up able to press the Support
 * button but unable to open the page it leads to.
 */
export default function SupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<SupportTab>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newRequestOpen, setNewRequestOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useMySupportTickets(tab);

  const tickets: SupportTicket[] = useMemo(() => data?.tickets ?? [], [data]);

  // Server-aggregated in list_my_support_tickets over EVERY ticket this person
  // owns, so the tiles and the tab counts stay right past the 100-row page.
  // Never recount `tickets` here: that array is one clamped, tab-filtered page.
  const counts: SupportTicketCounts =
    data?.counts ?? { active: 0, awaiting: 0, resolved: 0, total: 0 };

  // Deep link from a notification: /support?ticket=<id>. Switch to All first,
  // or a ticket that has since been resolved opens against a list that does
  // not contain it and the sheet has no subject to show.
  const deepLinkId = searchParams.get("ticket");
  useEffect(() => {
    if (!deepLinkId) return;
    setTab("all");
    setSelectedId(deepLinkId);
  }, [deepLinkId]);

  const closeTicket = () => {
    setSelectedId(null);
    if (searchParams.has("ticket")) {
      const next = new URLSearchParams(searchParams);
      next.delete("ticket");
      setSearchParams(next, { replace: true });
    }
  };

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const tabs: MobileTabOption[] = [
    { value: "active", label: "Active", count: counts.active },
    { value: "resolved", label: "Resolved", count: counts.resolved },
    { value: "all", label: "All", count: counts.total },
  ];

  return (
    <PageShell>
      <PageHeader
        icon={<LifeBuoy className="h-5 w-5" />}
        title="Salci Support"
        subtitle="Your requests to SALCI, and every reply on them"
        primaryAction={{
          label: "New request",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setNewRequestOpen(true),
        }}
      />

      <StatTileGrid mdCols={3} lgCols={3} className="mt-2">
        <StatTile
          label="Active"
          value={counts.active}
          icon={<Inbox className="h-5 w-5" />}
          tone="peach"
          onClick={() => setTab("active")}
        />
        <StatTile
          label="Awaiting your reply"
          value={counts.awaiting}
          icon={<MailOpen className="h-5 w-5" />}
          tone="sky"
          onClick={() => setTab("all")}
        />
        <StatTile
          label="Resolved"
          value={counts.resolved}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
          onClick={() => setTab("resolved")}
        />
      </StatTileGrid>

      <div className="mt-6 sticky top-[var(--app-bar-height,64px)] z-20 -mx-4 px-4 py-2 surface-gradient">
        <MobileTabs
          value={tab}
          onValueChange={(v) => setTab(v as SupportTab)}
          options={tabs}
        />
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
          </>
        ) : isError ? (
          /* Error BEFORE empty (§6): a failed read must never read as "you have
             raised nothing", which would send the reporter to raise a duplicate. */
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load your requests"
            description={
              error instanceof Error
                ? error.message
                : "Something went wrong fetching your support requests."
            }
            tone="rose"
            reason="error"
            action={{ label: "Try again", onClick: () => void refetch() }}
          />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="h-7 w-7" />}
            title={TAB_EMPTY_COPY[tab].title}
            description={TAB_EMPTY_COPY[tab].description}
            action={{
              label: "New request",
              onClick: () => setNewRequestOpen(true),
              icon: <Plus className="h-4 w-4" />,
            }}
          />
        ) : (
          <ul className="space-y-3">
            {tickets.map((ticket) => (
              <ListRow
                key={ticket.id}
                as="li"
                onClick={() => setSelectedId(ticket.id)}
                title={
                  <span className="flex items-center gap-2">
                    {ticket.has_unread && (
                      <>
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand-primary"
                        />
                        <span className="sr-only">New reply</span>
                      </>
                    )}
                    <span className="truncate">{ticket.subject}</span>
                  </span>
                }
                subtitle={
                  <span>
                    {ticket.category ? `${ticket.category} · ` : ""}
                    {ticket.message_count === 1
                      ? "1 message"
                      : `${ticket.message_count} messages`}
                    {ticket.last_message_at
                      ? ` · ${format(new Date(ticket.last_message_at), "MMM d")}`
                      : ""}
                  </span>
                }
                trailing={
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge
                      variant="outline"
                      className={SUPPORT_STATUS_TONES[ticket.status] ?? ""}
                    >
                      {SUPPORT_STATUS_LABELS[ticket.status] ?? ticket.status}
                    </Badge>
                    <span className="whitespace-nowrap text-xs text-ink-500">
                      {format(new Date(ticket.created_at), "MMM d")}
                    </span>
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* placement="center" is mandatory: the "bottom" placement hard-codes
          bg-white and does not flip in dark mode. */}
      <MobileSheet
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) closeTicket();
        }}
        placement="center"
        title={selected?.subject ?? "Support request"}
        subtitle={
          selected
            ? `${SUPPORT_STATUS_LABELS[selected.status]} · raised ${format(
                new Date(selected.created_at),
                "MMM d, yyyy",
              )}`
            : undefined
        }
        icon={<LifeBuoy className="h-4 w-4" />}
      >
        {selectedId && <SupportThread ticketId={selectedId} canPostInternal={false} />}
      </MobileSheet>

      <SupportRequestSheet open={newRequestOpen} onOpenChange={setNewRequestOpen} />
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/pages/SupportPage.tsx
```

Both must exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SupportPage.tsx
git commit -m "feat(support): reporter /support page with tabs, unread dots and thread sheet"
```

---

### Task 19: Route the page and fix its two gates

**Files:**
- Modify: `src/App.tsx:20-23` (add the lazy import), `src/App.tsx:249-255` (add the route)
- Modify: `src/components/layout/ProtectedRoute.tsx:116-122` (Olympiad-only allowlist)

**Interfaces:**
- Consumes: default export `SupportPage` from `src/pages/SupportPage.tsx`.
- Produces: the `/support` route, reachable by every authenticated role, gate-free.

- [ ] **Step 1: Add the lazy import in App.tsx**

In `src/App.tsx`, find the first lazy declaration (line 23):

```tsx
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
```

Insert immediately **above** it:

```tsx
const SupportPage = lazy(() => import("./pages/SupportPage"));
```

Every page route in this file is lazy (§23 bundle rule); a static import here would pull the support thread into the entry chunk for users who never open it.

- [ ] **Step 2: Add the route directly under /dashboard**

In `src/App.tsx`, find lines 249 to 255:

```tsx
          {/* Protected routes - Dashboard */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
```

Replace that block with:

```tsx
          {/* Protected routes - Dashboard */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />

          {/* Salci Support, reporter side.

              NO allowedRoles, deliberately. ProtectedRoute only enforces roles
              when allowedRoles is non-empty (ProtectedRoute.tsx:62), so leaving
              it off admits every authenticated user. That is exactly the set
              that can already press the Salci Support button in the sidebar.
              Students and employees are 37% of real reporters and the entire
              point of this route; adding allowedRoles here recreates the hole
              it exists to close.

              DO NOT add "/support" to FEATURE_URL_MAP in
              src/components/admin/institution-wizard/featuresData.ts. The
              feature gate at ProtectedRoute.tsx:100-103 fires only for paths
              present in that map, and support must never be gateable: a school
              whose feature flags are misconfigured is precisely the school that
              needs to reach support. */}
          <Route path="/support" element={
            <ProtectedRoute>
              <Suspense fallback={<p>Loading...</p>}>
                <SupportPage />
              </Suspense>
            </ProtectedRoute>
          } />

```

- [ ] **Step 3: Add /support to the Olympiad-only allowlist**

In `src/components/layout/ProtectedRoute.tsx`, find lines 115 to 122:

```tsx
    const p = location.pathname;
    const allowed =
      p === "/dashboard" ||
      p.startsWith("/school/olympiad") ||
      p.startsWith("/teacher/olympiad") ||
      p.startsWith("/student/olympiad") ||
      p.startsWith("/olympiad") ||
      p.startsWith("/settings");
```

Replace with:

```tsx
    const p = location.pathname;
    const allowed =
      p === "/dashboard" ||
      // Salci Support. This guard is an ALLOWLIST, so without this line an
      // onboarded (Olympiad-only) school's users get bounced straight off a
      // page whose entry button is visible to them in the sidebar footer.
      // Their tickets are the ones most likely to be about onboarding.
      p === "/support" ||
      p.startsWith("/school/olympiad") ||
      p.startsWith("/teacher/olympiad") ||
      p.startsWith("/student/olympiad") ||
      p.startsWith("/olympiad") ||
      p.startsWith("/settings");
```

- [ ] **Step 4: Confirm /support is absent from the feature map**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "/support" src/components/admin/institution-wizard/featuresData.ts
```

This must print nothing. A hit means support has been made gateable and the grep is the failing check: remove the entry.

- [ ] **Step 5: Verify**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/App.tsx src/components/layout/ProtectedRoute.tsx
npx vite build
```

All three must exit 0. Bundle-size warnings over 500 kB are not failures.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/layout/ProtectedRoute.tsx
git commit -m "feat(support): lazy /support route open to every authenticated role"
```

---

### Task 20: Point the sidebar button at /support and retarget the intake copy

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx:82` (drop the sheet import), `src/components/layout/AppSidebar.tsx:1128-1183` (`SidebarFooterWithReportIssue`)
- Modify: `src/hooks/useSupportRequest.ts:65-71` (success toast + invalidation)
- Modify: `src/components/issues/SupportRequestSheet.tsx:23-31` (doc comment)

**Interfaces:**
- Consumes: the `/support` route from Task 19; `SupportRequestSheet` now mounted by `SupportPage` (Task 18).
- Produces: a sidebar footer whose Salci Support entry is a `NavLink` to `/support`, and an intake success toast that points at the new tracking surface.

- [ ] **Step 1: Remove the sheet import from AppSidebar**

In `src/components/layout/AppSidebar.tsx`, delete line 82:

```tsx
import { SupportRequestSheet } from "@/components/issues/SupportRequestSheet";
```

The sheet is mounted by `SupportPage` now. Leave the `useState` import on line 1 alone: line 209 still uses it for `openGroups`. Leave the `MessageSquareWarning` import on line 77 alone: the footer entry keeps its familiar icon.

- [ ] **Step 2: Rewrite the footer component**

In `src/components/layout/AppSidebar.tsx`, replace the whole of lines 1128 to 1183 (the `SidebarFooterWithReportIssue` function) with:

```tsx
function SidebarFooterWithReportIssue({ collapsed, isSuperAdmin }: { collapsed: boolean; isSuperAdmin: boolean }) {
  const { isMobile, setOpenMobile, setOpen } = useSidebar();

  const handleNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    } else {
      setOpen(false);
    }
  };

  return (
    <SidebarFooter className="border-t p-2">
      <SidebarMenu>
        {/* Salci Support is a PAGE now, not a sheet that opened a form and
            then dropped the reporter off a cliff. /support lists the caller's
            own tickets, holds the conversation, and mounts the intake form
            itself behind "New request". Every authenticated role can open it:
            the route carries no allowedRoles and is not feature-gated, which
            is what makes this button honest for students and employees. */}
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <NavLink
              to="/support"
              className="flex items-center gap-2"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              onClick={handleNavClick}
            >
              <MessageSquareWarning className="h-4 w-4" />
              {!collapsed && <span>Salci Support</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {isSuperAdmin && (
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <NavLink
                to="/admin/issues"
                className="flex items-center gap-2"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
                onClick={handleNavClick}
              >
                <AlertTriangle className="h-4 w-4" />
                {!collapsed && <span>Issues</span>}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <NavLink
              to="/settings"
              className="flex items-center gap-2"
              activeClassName="bg-sidebar-accent text-sidebar-accent-foreground"
              onClick={handleNavClick}
            >
              <Settings className="h-4 w-4" />
              {!collapsed && <span>Settings</span>}
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}
```

The fragment wrapper and the `reportOpen` state are both gone with the sheet.

- [ ] **Step 3: Retarget the intake success toast**

In `src/hooks/useSupportRequest.ts`, replace lines 65 to 71:

```ts
    onSuccess: () => {
      toast.success("Support request sent", {
        description: "SALCI has it. You can track it under Assigned BY Me.",
      });
      // The reporter is the assigner, so the new ticket lands in this list.
      queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
    },
```

with:

```ts
    onSuccess: () => {
      toast.success("Support request sent", {
        description: "SALCI has it. Track it and reply right here on this page.",
      });
      // /support is the reporter's tracking surface now, and it is where this
      // sheet is opened from, so the new ticket must appear behind it
      // immediately. The task plane still exists underneath (the ticket is
      // also a `tasks` row assigned to the support owner), so the legacy
      // "Assigned BY Me" list is invalidated too.
      queryClient.invalidateQueries({ queryKey: ["support-my-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["tasks-assigned-by-me"] });
    },
```

The old copy pointed at `/tasks`, a page whose `allowedRoles` excludes students and employees and which sits behind the `tasks` feature flag in 22 of 37 schools. There are no em-dashes in either string.

- [ ] **Step 4: Update the sheet's doc comment**

In `src/components/issues/SupportRequestSheet.tsx`, replace lines 23 to 31:

```tsx
/**
 * Salci Support intake. Mirrors CreateTaskDialog's field grammar (subject =
 * title, category = task type, urgency = priority) because a support request
 * becomes a real task, just one nobody in the reporter's school can see and
 * only SALCI can close.
 *
 * There is no assignee picker: support always routes to the configured support
 * owner. No due date and no supervisor either, since SALCI owns the timeline.
 */
```

with:

```tsx
/**
 * Salci Support intake. Mirrors CreateTaskDialog's field grammar (subject =
 * title, category = task type, urgency = priority) because a support request
 * becomes a real task, just one nobody in the reporter's school can see and
 * only SALCI can close.
 *
 * There is no assignee picker: support always routes to the configured support
 * owner. No due date and no supervisor either, since SALCI owns the timeline.
 *
 * Opened from SupportPage (/support) behind "New request", not from the
 * sidebar. The ticket the reporter creates here appears in the list directly
 * behind this sheet the moment it is sent, which is why the success toast
 * points at this page rather than at /tasks.
 */
```

- [ ] **Step 5: Confirm nothing else still mounts the sheet from the sidebar**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -rn "SupportRequestSheet" src
```

Expected: exactly two hits, the component's own definition and the mount inside `src/pages/SupportPage.tsx`.

- [ ] **Step 6: Verify the whole phase**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/hooks/useSupportTickets.ts src/pages/SupportPage.tsx src/components/issues/SupportThread.tsx src/components/issues/SupportComposer.tsx src/components/issues/SupportRequestSheet.tsx src/hooks/useSupportRequest.ts src/components/layout/AppSidebar.tsx src/components/layout/ProtectedRoute.tsx src/App.tsx
npx vite build
```

All three must exit 0. Then a manual pass, which is the only end-to-end check this repo has: sign in as a student, open the sidebar, press Salci Support, confirm `/support` loads rather than bouncing to `/dashboard`, raise a request, confirm it appears in the Active tab without a refresh, open it, send a reply, and confirm the thread shows the reply on the right. Repeat the page at a 375px viewport and with dark mode on.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AppSidebar.tsx src/hooks/useSupportRequest.ts src/components/issues/SupportRequestSheet.tsx
git commit -m "feat(support): sidebar Salci Support opens /support, intake toast points at it"
```

---

## Phase 4 - SALCI inbox surface

### Task 21: Purge `admin_notes` from the client and extend the inbox hooks

**Files:**
- Modify: `src/hooks/useReportedIssues.ts:1-184` (full rewrite of the file)

**Interfaces:**
- Consumes: `SupportNotify` (type, from `src/hooks/useSupportTickets.ts`, Phase 3); prod schema from Phase 1 (`reported_issues.category`, `.priority`, `.last_message_at`, `.reporter_last_read_at`, `.salci_last_read_at`, `.first_response_at`, `.resolved_at`; `admin_notes` DROPPED; `reporter_id` nullable); `set_support_ticket_status(uuid, text, text) RETURNS jsonb` and `support_inbox_counts(uuid, text, text)` with `awaiting_salci` and the `p_status` scope (Phase 2)
- Produces: `ReportedIssue` (no `admin_notes`, plus the seven new fields), `IssueCounts` (plus `awaiting_salci`), `issueAwaitsSalci()`, `useReportedIssueById()`, `useSupportTicketIdForTask()`, `useReportedIssueCounts(institutionId, role, status)` whose third argument scopes `awaiting_salci` to the caller's active status tab, `SetIssueStatusResult`, `useSetIssueStatus()` returning jsonb and invalidating the thread key

- [ ] **Step 1: Find every surviving `admin_notes` reference**

Phase 1 dropped `public.reported_issues.admin_notes`. After Phase 2 regenerates `src/integrations/supabase/types.ts` from prod, **any remaining reference to `admin_notes` anywhere in `src/` is a hard TypeScript compile error**, not a warning. Find them all before touching anything:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -rn "admin_notes" src/
```

Expected hits before this phase: `src/hooks/useReportedIssues.ts` (2), `src/components/issues/IssueDetailSheet.tsx` (2), `src/integrations/supabase/types.ts` (3). The `types.ts` hits disappear when Phase 2's regen lands. The other four are removed by this task and Task 22. Re-run this grep at the end of the phase and expect zero hits outside `types.ts`.

- [ ] **Step 2: Rewrite `src/hooks/useReportedIssues.ts` in full**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { SupportNotify } from "@/hooks/useSupportTickets";

/**
 * The Salci Support inbox (/admin/issues).
 *
 * Every support request writes BOTH a `tasks` row and a `reported_issues`
 * intake row linked by `task_id`. This inbox reads the intake side, and moves
 * both together through `set_support_ticket_status`, which now routes through
 * the shared `_support_apply_status` routine so a resolution from /tasks and
 * one from here produce identical system rows and notifications.
 *
 * The conversation itself lives in `support_messages` and is read through
 * `get_support_thread` (see `useSupportTickets.ts`). The old `admin_notes`
 * column is GONE: it was readable by the reporter despite being labelled
 * "Internal notes", and its 14 rows were migrated into internal messages.
 */

export const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export interface ReportedIssue {
  id: string;
  /** Nullable since Phase 1: the FK is ON DELETE SET NULL so a departing
   *  student no longer takes the ticket history with them. */
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_role: string | null;
  institution_id: string | null;
  institution_name: string | null;
  classes_assigned: string | null;
  subject: string;
  description: string;
  status: string;
  category: string | null;
  priority: number | null;
  task_id: string | null;
  last_message_at: string | null;
  reporter_last_read_at: string | null;
  salci_last_read_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueFilters {
  status: IssueStatus;
  institutionId: string | null;
  role: string | null;
}

/** PostgREST silently truncates at 1000 rows, so bound it explicitly (§23). */
const ISSUE_LIST_RANGE: [number, number] = [0, 199];
const ISSUE_STALE_TIME = 60_000;

/** Explicit column list: reported_issues carries free-text descriptions and is
 *  read on every inbox open, so `select("*")` is not acceptable here.
 *
 *  One unbroken literal on purpose: supabase-js parses the selection with
 *  template literal types, and string concatenation widens this to `string`,
 *  which collapses the row type to GenericStringError[]. */
const ISSUE_COLUMNS =
  "id, reporter_id, reporter_name, reporter_email, reporter_role, institution_id, institution_name, classes_assigned, subject, description, status, category, priority, task_id, last_message_at, reporter_last_read_at, salci_last_read_at, first_response_at, resolved_at, created_at, updated_at" as const;

/**
 * True when the reporter has spoken since SALCI last opened the ticket.
 *
 * Computed from two columns already on the row we fetched, so it costs no
 * extra read. The authoritative total comes from the server
 * (`support_inbox_counts.awaiting_salci`), never from measuring this list.
 *
 * This predicate deliberately does NOT look at status: the caller decides which
 * status it is filtering, and it must pass that same status to
 * `useReportedIssueCounts` so the chip's number and the rows it filters measure
 * the same set.
 */
export function issueAwaitsSalci(
  issue: Pick<ReportedIssue, "last_message_at" | "salci_last_read_at">,
): boolean {
  if (!issue.last_message_at) return false;
  if (!issue.salci_last_read_at) return true;
  return (
    new Date(issue.last_message_at).getTime() >
    new Date(issue.salci_last_read_at).getTime()
  );
}

export function useReportedIssues(filters: IssueFilters) {
  return useQuery({
    queryKey: ["support-inbox", filters.status, filters.institutionId, filters.role],
    queryFn: async (): Promise<ReportedIssue[]> => {
      let query = supabase
        .from("reported_issues")
        .select(ISSUE_COLUMNS)
        .eq("status", filters.status);

      if (filters.institutionId) query = query.eq("institution_id", filters.institutionId);
      if (filters.role) query = query.eq("reporter_role", filters.role);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .range(...ISSUE_LIST_RANGE);

      if (error) throw error;
      return (data ?? []) as ReportedIssue[];
    },
    staleTime: ISSUE_STALE_TIME,
  });
}

/**
 * One ticket by id, for the `?ticket=<id>` deep link that support notifications
 * point at. The linked ticket is often in a different status tab from the one
 * on screen, so it cannot be found in the list query's cache.
 */
export function useReportedIssueById(ticketId: string | null) {
  return useQuery({
    queryKey: ["support-inbox-ticket", ticketId],
    queryFn: async (): Promise<ReportedIssue | null> => {
      const { data, error } = await supabase
        .from("reported_issues")
        .select(ISSUE_COLUMNS)
        .eq("id", ticketId as string)
        .maybeSingle();

      if (error) throw error;
      return (data as ReportedIssue | null) ?? null;
    },
    enabled: Boolean(ticketId),
    staleTime: ISSUE_STALE_TIME,
  });
}

/**
 * Ticket id behind a support `tasks` row, so /tasks can link into the thread.
 * `reported_issues` SELECT is super-admin-only, so callers must gate this on
 * the viewer actually being one rather than relying on a silent empty result.
 */
export function useSupportTicketIdForTask(taskId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["support-ticket-for-task", taskId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("reported_issues")
        .select("id")
        .eq("task_id", taskId as string)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: Boolean(taskId) && enabled,
    staleTime: ISSUE_STALE_TIME,
  });
}

export interface IssueCounts {
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  total: number;
  /**
   * Tickets whose newest message lands after SALCI last read them, counted
   * WITHIN the status passed to `useReportedIssueCounts`. With no status it
   * falls back to the platform-wide backlog (open plus in progress).
   */
  awaiting_salci: number;
}

/**
 * Counted in Postgres, never by fetching rows and measuring them (§23).
 *
 * `status` scopes `awaiting_salci` only. The four per-status keys and `total`
 * always cover every status, so the tab badges never move when the active tab
 * changes. Pass the tab the Awaiting SALCI chip sits in: the chip prints this
 * number and filters that tab's rows with `issueAwaitsSalci`, and the two must
 * always measure the same set, or Closed can read "Awaiting SALCI (7)" and then
 * filter to nothing.
 */
export function useReportedIssueCounts(
  institutionId: string | null,
  role: string | null,
  status: IssueStatus | null,
) {
  return useQuery({
    queryKey: ["support-inbox-counts", institutionId, role, status],
    queryFn: async (): Promise<IssueCounts> => {
      const { data, error } = await supabase.rpc("support_inbox_counts", {
        p_institution_id: institutionId ?? undefined,
        p_role: role ?? undefined,
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return data as unknown as IssueCounts;
    },
    staleTime: ISSUE_STALE_TIME,
  });
}

/**
 * Distinct schools and roles present in the inbox, for the filter chips.
 * Derived from a bounded projection rather than a second full read.
 */
export function useReportedIssueFacets() {
  return useQuery({
    queryKey: ["support-inbox-facets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reported_issues")
        .select("institution_id, institution_name, reporter_role")
        .order("created_at", { ascending: false })
        .range(...ISSUE_LIST_RANGE);

      if (error) throw error;

      const schools = new Map<string, string>();
      const roles = new Set<string>();
      for (const row of data ?? []) {
        if (row.institution_id && row.institution_name) {
          schools.set(row.institution_id, row.institution_name);
        }
        if (row.reporter_role) roles.add(row.reporter_role);
      }

      return {
        schools: [...schools.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        roles: [...roles].sort(),
      };
    },
    staleTime: 5 * 60_000,
  });
}

export interface SetIssueStatusInput {
  ticketId: string;
  status: IssueStatus;
  note?: string;
}

/**
 * What the rewritten `set_support_ticket_status` returns. `notify` is the
 * payload Phase 5 hands to the `support-notify-email` edge function; it is
 * NULL when the move produces no outbound message.
 */
export interface SetIssueStatusResult {
  status: string;
  notify: SupportNotify | null;
}

export function useSetIssueStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      status,
      note,
    }: SetIssueStatusInput): Promise<SetIssueStatusResult> => {
      // One RPC, not two client writes: the intake row, its system message and
      // its linked task move in the same transaction or not at all (§23).
      const { data, error } = await supabase.rpc("set_support_ticket_status", {
        p_ticket_id: ticketId,
        p_status: status,
        p_note: note,
      });
      if (error) throw error;
      return data as unknown as SetIssueStatusResult;
    },
    onSuccess: (_result, variables) => {
      toast.success(`Marked as ${ISSUE_STATUS_LABELS[variables.status]}`);
      // The status move writes a kind='system' row into the thread, so the
      // thread cache is stale too. Missing this key leaves the sheet showing a
      // conversation that ends before the status change the user just made.
      for (const key of [
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-ticket",
        "support-thread",
        "support-my-tickets",
        "my-tasks",
        "tasks-assigned-by-me",
        "task-detail",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update this support request.",
        context: "setSupportTicketStatus",
      }),
  });
}
```

- [ ] **Step 3: Lint the hook file**

`IssueDetailSheet.tsx` still reads `issue.admin_notes` at this point, so typecheck will report those two lines until Task 22 lands. Lint the file that changed:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx eslint src/hooks/useReportedIssues.ts
```

Zero errors required. Do not silence anything with `eslint-disable` or `as any`.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useReportedIssues.ts
git commit -m "feat(support): inbox hooks drop admin_notes and expose unread, category and ticket-by-id"
```

---

### Task 22: Rebuild `IssueDetailSheet` around the shared thread

**Files:**
- Modify: `src/components/issues/IssueDetailSheet.tsx:1-172` (full rewrite of the file)

**Interfaces:**
- Consumes: `SupportThread` from `src/components/issues/SupportThread.tsx` (Phase 3) with props `{ ticketId: string; canPostInternal: boolean; className?: string }`, where `canPostInternal` is REQUIRED (pass it explicitly, `canPostInternal` bare in JSX is `true`) and renders the Internal note toggle inside `SupportComposer`, restyling the composer while it is armed; `ReportedIssue`, `ISSUE_STATUSES`, `ISSUE_STATUS_LABELS`, `useSetIssueStatus`, `IssueStatus` from `src/hooks/useReportedIssues.ts`; `SUPPORT_URGENCIES` from `src/hooks/useSupportRequest.ts`
- Produces: `IssueDetailSheet` with props `{ issue: ReportedIssue | null; open: boolean; onOpenChange: (open: boolean) => void }`. The `onOpenTask` prop is GONE.

- [ ] **Step 1: Confirm the composer already carries the internal channel**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "canPostInternal" src/components/issues/SupportComposer.tsx
```

Expect at least one hit. Task 16 already ships `canPostInternal` on `SupportComposer`, together with the Internal note toggle and the amber restyling of the field, and Task 17 already threads the prop through `SupportThread`, so nothing is written here. If the grep prints nothing, Task 16 has not landed: finish it rather than adding a second toggle, which is how two divergent composers get built.

- [ ] **Step 2: Rewrite `src/components/issues/IssueDetailSheet.tsx` in full**

```tsx
import * as React from "react";
import { format } from "date-fns";
import { LifeBuoy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { MobileSheet } from "@/components/shared/sheets";
import { SupportThread } from "@/components/issues/SupportThread";
import { SUPPORT_URGENCIES } from "@/hooks/useSupportRequest";
import {
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  useSetIssueStatus,
  type IssueStatus,
  type ReportedIssue,
} from "@/hooks/useReportedIssues";

export interface IssueDetailSheetProps {
  issue: ReportedIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

/**
 * `reported_issues.priority` is written by `create_support_task` from the
 * urgency the reporter picked in SupportRequestSheet, so it uses THAT
 * vocabulary (1 Low, 2 Medium, 3 High). The tasks module reads its own
 * `tasks.priority` with the opposite convention; do not borrow its labels.
 */
function urgencyLabel(priority: number | null): string {
  if (priority === null || priority === undefined) return "N/A";
  return (
    SUPPORT_URGENCIES.find((u) => u.value === String(priority))?.label ??
    String(priority)
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate text-sm text-ink-700">{value}</p>
    </div>
  );
}

export function IssueDetailSheet({ issue, open, onOpenChange }: IssueDetailSheetProps) {
  const setStatus = useSetIssueStatus();

  const [draftStatus, setDraftStatus] = React.useState<IssueStatus>("open");

  // Reset the draft when a DIFFERENT ticket is opened, keyed on the ticket id.
  //
  // An earlier version compared the draft against issue.status during render
  // and reset whenever they differed, which meant selecting a new status
  // immediately snapped back to the stored one. The dropdown could never be
  // changed, so every save posted the unchanged status.
  const loadedId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (issue && loadedId.current !== issue.id) {
      loadedId.current = issue.id;
      setDraftStatus((issue.status as IssueStatus) ?? "open");
    }
  }, [issue]);

  if (!issue) return null;

  const dirty = draftStatus !== issue.status;

  const handleSave = () => {
    if (!dirty || setStatus.isPending) return;
    // The sheet stays open on success: the status move writes a system row into
    // the thread below, and SALCI usually keeps talking straight after it.
    setStatus.mutate({ ticketId: issue.id, status: draftStatus });
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={issue.subject}
      subtitle={`Raised ${format(new Date(issue.created_at), "PPp")}`}
      icon={<LifeBuoy className="h-4 w-4" />}
      placement="center"
      primaryAction={{
        label: "Update status",
        onClick: handleSave,
        loading: setStatus.isPending,
        disabled: !dirty,
      }}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_TONES[issue.status] ?? ""}>
            {ISSUE_STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
          </Badge>
          {issue.category && (
            <Badge variant="outline" className="border-surface-stroke text-ink-600">
              {issue.category}
            </Badge>
          )}
          <Badge variant="outline" className="border-surface-stroke text-ink-600">
            Urgency: {urgencyLabel(issue.priority)}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reporter" value={issue.reporter_name || "Unknown"} />
          <Field label="Email" value={issue.reporter_email || "N/A"} />
          <Field
            label="Role"
            value={
              <span className="capitalize">
                {issue.reporter_role?.replace(/_/g, " ") || "N/A"}
              </span>
            }
          />
          <Field label="School" value={issue.institution_name || "N/A"} />
          <Field
            label="First reply"
            value={
              issue.first_response_at
                ? format(new Date(issue.first_response_at), "PPp")
                : "Not yet"
            }
          />
          <Field
            label="Resolved"
            value={
              issue.resolved_at ? format(new Date(issue.resolved_at), "PPp") : "Not yet"
            }
          />
          {issue.classes_assigned && (
            <div className="col-span-2">
              <Field label="Classes" value={issue.classes_assigned} />
            </div>
          )}
        </div>

        {/* Its own form element, deliberately NOT wrapping the thread: the
            composer below carries its own form, and nesting forms is invalid
            HTML. data-dirty keeps the service worker from reloading the tab
            under an unsaved status change (§17). */}
        <form
          data-dirty={dirty ? "true" : undefined}
          onSubmit={(e) => e.preventDefault()}
          className="grid gap-2"
        >
          <Label>Status</Label>
          <SearchableSelect
            value={draftStatus}
            onValueChange={(value) => setDraftStatus(value as IssueStatus)}
            placeholder="Set a status"
            searchPlaceholder="Search..."
            options={ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_LABELS[s] }))}
          />
          <p className="text-xs text-ink-500">
            The reporter is told about every status change. Any linked task moves
            with it: Resolved completes it, Closed rejects it.
          </p>
        </form>

        <div className="space-y-2">
          <p className="eyebrow">Conversation</p>
          <p className="text-xs text-ink-500">
            Anything you send here reaches the reporter. Switch on Internal note
            to keep a message private to the SALCI team.
          </p>
          {/* The single thread component, shared with the reporter's /support
              page. canPostInternal is the only difference between the two
              surfaces, and the RPC omits internal rows from the reporter read
              regardless, so the split is enforced in Postgres, not here. */}
          <SupportThread ticketId={issue.id} canPostInternal />
        </div>
      </div>
    </MobileSheet>
  );
}
```

- [ ] **Step 3: Confirm the notes column is gone from this surface**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -rn "admin_notes\|Internal notes\|onOpenTask" src/components/issues/IssueDetailSheet.tsx
```

Expect zero output. `admin_notes` no longer exists in the database, `Internal notes` was the label on the leaking textarea, and `onOpenTask` was the prop feeding the dead Linked task button.

- [ ] **Step 4: Lint the sheet**

`AdminIssuesPage.tsx` still passes `onOpenTask` at this point, so its typecheck fails until Task 23. Lint what changed:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx eslint src/components/issues/IssueDetailSheet.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/issues/IssueDetailSheet.tsx
git commit -m "feat(support): SALCI ticket sheet renders the thread and a guarded internal-note channel"
```

---

### Task 23: Awaiting SALCI filter, unread dots and `?ticket=` deep link on the inbox

**Files:**
- Modify: `src/pages/AdminIssuesPage.tsx:1-243` (full rewrite of the file)

**Interfaces:**
- Consumes: `useReportedIssues`, `useReportedIssueCounts` (three arguments: `institutionId`, `role`, and the active tab's `status`, which scopes `awaiting_salci` to the rows the chip actually filters), `useReportedIssueFacets`, `useReportedIssueById`, `issueAwaitsSalci`, `ISSUE_STATUS_LABELS`, `IssueStatus`, `ReportedIssue` from `src/hooks/useReportedIssues.ts`; `useMarkSupportTicketRead()` from `src/hooks/useSupportTickets.ts` (Phase 3), a mutation whose `mutate` takes the ticket id as its only argument; `IssueDetailSheet` with its new three-prop signature
- Produces: `/admin/issues?ticket=<id>` deep-link behaviour that the Phase 5 notification link and Task 25's View conversation button both rely on

- [ ] **Step 1: Rewrite `src/pages/AdminIssuesPage.tsx` in full**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Inbox,
  LifeBuoy,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState, ListRow, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs, FilterRow, FilterChip, type MobileTabOption } from "@/components/shared/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IssueDetailSheet } from "@/components/issues/IssueDetailSheet";
import { useMarkSupportTicketRead } from "@/hooks/useSupportTickets";
import {
  ISSUE_STATUS_LABELS,
  issueAwaitsSalci,
  useReportedIssueById,
  useReportedIssueCounts,
  useReportedIssueFacets,
  useReportedIssues,
  type IssueStatus,
  type ReportedIssue,
} from "@/hooks/useReportedIssues";

const STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

export default function AdminIssuesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [status, setStatus] = useState<IssueStatus>("open");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [awaitingOnly, setAwaitingOnly] = useState(false);

  const [selected, setSelected] = useState<ReportedIssue | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // The active tab's status is passed so that counts.awaiting_salci is measured
  // over the SAME rows the Awaiting SALCI chip filters below. The four
  // per-status keys the tabs read stay platform-wide inside the RPC, so the tab
  // badges do not move when the tab changes.
  const { data: counts } = useReportedIssueCounts(institutionId, role, status);
  const { data: facets } = useReportedIssueFacets();
  const {
    data: issues,
    isLoading,
    isError,
    error,
    refetch,
  } = useReportedIssues({ status, institutionId, role });

  // `mutate` is referentially stable in React Query v5, so destructuring it
  // keeps the callbacks below stable and out of effect-loop territory.
  const { mutate: markTicketRead } = useMarkSupportTicketRead();
  const markedRef = useRef<Set<string>>(new Set());
  const selectedIdRef = useRef<string | null>(null);

  const openIssue = useCallback(
    (issue: ReportedIssue) => {
      selectedIdRef.current = issue.id;
      setSelected(issue);
      setDetailOpen(true);

      // Stamp salci_last_read_at once per ticket per visit, then refresh the
      // rows and counts so the unread dot actually clears on screen.
      if (markedRef.current.has(issue.id)) return;
      markedRef.current.add(issue.id);
      markTicketRead(issue.id, {
        onSuccess: () => {
          for (const key of [
            "support-inbox",
            "support-inbox-counts",
            "support-inbox-ticket",
          ]) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        },
      });
    },
    [markTicketRead, queryClient],
  );

  // Deep link. Support notifications point at /admin/issues?ticket=<id>, and
  // the linked ticket is usually in a different status tab from the one on
  // screen, so it is fetched by id rather than hunted for in the list.
  const deepLinkId = searchParams.get("ticket");
  const { data: deepLinkIssue } = useReportedIssueById(deepLinkId);

  useEffect(() => {
    if (!deepLinkIssue) return;
    if (selectedIdRef.current === deepLinkIssue.id) return;
    openIssue(deepLinkIssue);
  }, [deepLinkIssue, openIssue]);

  const handleDetailOpenChange = (next: boolean) => {
    setDetailOpen(next);
    if (!next && searchParams.has("ticket")) {
      const params = new URLSearchParams(searchParams);
      params.delete("ticket");
      setSearchParams(params, { replace: true });
    }
  };

  const tabs: MobileTabOption[] = useMemo(
    () =>
      (Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((key) => ({
        value: key,
        label: ISSUE_STATUS_LABELS[key],
        count: counts?.[key] ?? 0,
      })),
    [counts],
  );

  // Narrows the page the server already bounded to 200 rows. This is a display
  // filter over rows in hand, not an aggregation: the authoritative total is
  // counts.awaiting_salci, computed in Postgres.
  //
  // The count and this filter MUST measure the same set. Both are now scoped to
  // `status`: the RPC is passed the active tab, and `issues` is that tab's list.
  // Before that, the chip read a platform-wide open + in_progress figure, so the
  // Closed tab could offer "Awaiting SALCI (7)" and then filter to zero rows.
  // The only remaining gap is the 200-row page bound on the list, which the
  // chip's count deliberately ignores because it is the true total for the tab.
  const visibleIssues = useMemo(() => {
    if (!issues) return [];
    return awaitingOnly ? issues.filter(issueAwaitsSalci) : issues;
  }, [issues, awaitingOnly]);

  const schoolLabel =
    facets?.schools.find((s) => s.id === institutionId)?.name ?? "All schools";
  const roleLabel = role ? role.replace(/_/g, " ") : "All roles";
  const activeFilters =
    (institutionId ? 1 : 0) + (role ? 1 : 0) + (awaitingOnly ? 1 : 0);
  const awaitingCount = counts?.awaiting_salci ?? 0;

  return (
    <PageShell>
      <PageHeader
        icon={<LifeBuoy className="h-5 w-5" />}
        title="Support Inbox"
        subtitle="Requests raised from every school, newest first"
        primaryAction={{
          label: "Refresh",
          icon: <RefreshCw className="h-4 w-4" />,
          onClick: () => refetch(),
        }}
      />

      <StatTileGrid mdCols={4} lgCols={4} className="mt-2">
        <StatTile
          label="Open"
          value={counts?.open ?? 0}
          icon={<Inbox className="h-5 w-5" />}
          tone="peach"
          onClick={() => setStatus("open")}
        />
        <StatTile
          label="In Progress"
          value={counts?.in_progress ?? 0}
          icon={<Clock className="h-5 w-5" />}
          tone="sky"
          onClick={() => setStatus("in_progress")}
        />
        <StatTile
          label="Resolved"
          value={counts?.resolved ?? 0}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
          onClick={() => setStatus("resolved")}
        />
        <StatTile
          label="Closed"
          value={counts?.closed ?? 0}
          icon={<XCircle className="h-5 w-5" />}
          tone="violet"
          onClick={() => setStatus("closed")}
        />
      </StatTileGrid>

      <div className="mt-6 sticky top-[var(--app-bar-height,64px)] z-20 -mx-4 px-4 py-2 surface-gradient">
        <MobileTabs value={status} onValueChange={(v) => setStatus(v as IssueStatus)} options={tabs} />
      </div>

      <FilterRow
        className="mt-3"
        activeCount={activeFilters}
        onClear={() => {
          setInstitutionId(null);
          setRole(null);
          setAwaitingOnly(false);
        }}
      >
        <FilterChip
          label={`Awaiting SALCI (${awaitingCount})`}
          active={awaitingOnly}
          onClick={() => setAwaitingOnly((v) => !v)}
          trailing={<Bell className="h-4 w-4 shrink-0" />}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip label={schoolLabel} active={Boolean(institutionId)} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
            <DropdownMenuItem onSelect={() => setInstitutionId(null)}>
              All schools
            </DropdownMenuItem>
            {facets?.schools.map((school) => (
              <DropdownMenuItem key={school.id} onSelect={() => setInstitutionId(school.id)}>
                {school.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip
              label={roleLabel}
              active={Boolean(role)}
              className="capitalize"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onSelect={() => setRole(null)}>All roles</DropdownMenuItem>
            {facets?.roles.map((r) => (
              <DropdownMenuItem key={r} onSelect={() => setRole(r)} className="capitalize">
                {r.replace(/_/g, " ")}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </FilterRow>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
          </>
        ) : isError ? (
          /* Error BEFORE empty (§6): a failed read must never read as "nothing here". */
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Couldn't load the inbox"
            description={
              error instanceof Error
                ? error.message
                : "Something went wrong fetching support requests."
            }
            tone="rose"
            reason="error"
            action={{ label: "Try again", onClick: () => refetch() }}
          />
        ) : !visibleIssues.length ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={
              awaitingOnly
                ? "Nothing is waiting on SALCI"
                : `Nothing ${ISSUE_STATUS_LABELS[status].toLowerCase()}`
            }
            description={
              awaitingOnly
                ? "Every request in this tab has been read since the reporter last wrote."
                : activeFilters > 0
                  ? "No requests match these filters."
                  : "Support requests will appear here as schools raise them."
            }
          />
        ) : (
          <ul className="space-y-3">
            {visibleIssues.map((issue) => {
              const awaits = issueAwaitsSalci(issue);
              return (
                <ListRow
                  key={issue.id}
                  as="li"
                  onClick={() => openIssue(issue)}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      {awaits && (
                        <span
                          aria-label="Unread reply from the reporter"
                          className="h-2 w-2 shrink-0 rounded-full bg-brand-primary"
                        />
                      )}
                      <span className="truncate">{issue.subject}</span>
                    </span>
                  }
                  subtitle={
                    <span className="capitalize">
                      {issue.reporter_name || "Unknown"}
                      {issue.institution_name ? ` · ${issue.institution_name}` : ""}
                      {issue.reporter_role ? ` · ${issue.reporter_role.replace(/_/g, " ")}` : ""}
                    </span>
                  }
                  trailing={
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant="outline" className={STATUS_TONES[issue.status] ?? ""}>
                        {ISSUE_STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
                      </Badge>
                      <span className="whitespace-nowrap text-xs text-ink-500">
                        {format(
                          new Date(issue.last_message_at ?? issue.created_at),
                          "MMM d",
                        )}
                      </span>
                    </div>
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      <IssueDetailSheet
        issue={selected}
        open={detailOpen}
        onOpenChange={handleDetailOpenChange}
      />
    </PageShell>
  );
}
```

- [ ] **Step 2: Confirm the dead Linked task navigation is gone**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -rn "tasks?task=\|useNavigate\|onOpenTask" src/pages/AdminIssuesPage.tsx
```

Expect zero output. That button navigated to `/tasks?task=<id>`, and `TasksPage` never reads a `task` query parameter, so it did nothing at all. The conversation now lives in the sheet.

- [ ] **Step 3: Typecheck and lint the three files changed so far**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/pages/AdminIssuesPage.tsx src/components/issues/IssueDetailSheet.tsx src/hooks/useReportedIssues.ts
```

`npm run typecheck` runs `tsc -p tsconfig.app.json --noEmit`. Never substitute a bare `npx tsc --noEmit`: the root tsconfig has `files: []` plus project references, so it always exits 0 and checks nothing.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminIssuesPage.tsx
git commit -m "feat(support): inbox gains awaiting-SALCI filter, unread dots and ticket deep links"
```

---

### Task 24: Lazy-load `AdminIssuesPage`

**Files:**
- Modify: `src/App.tsx` (delete the static import, add the lazy binding, wrap the route in Suspense)

Anchor every edit on the strings quoted below, never on a line number: Task 19 already inserted a lazy import near the top of this file, so every line below it has moved.

**Interfaces:**
- Consumes: `AdminIssuesPage` default export from `src/pages/AdminIssuesPage.tsx`
- Produces: `/admin/issues` as a code-split route, so the transcript PDF work in Phase 7 pulls jsPDF into the admin chunk instead of the entry bundle

- [ ] **Step 1: Delete the static import**

Delete this exact line from `src/App.tsx`, wherever it now sits in the `// Admin pages` block:

```
import AdminIssuesPage from "./pages/AdminIssuesPage";
```

It is the only statically imported page in that block about to gain a heavy dependency; the other 53 routes are already lazy.

- [ ] **Step 2: Add the lazy binding beside the other admin lazies**

In the `// Lazy-loaded pages (isolate heavy imports from bootstrap)` block, immediately after the `NonSalciSchoolDetailPage` line, add:

```ts
const AdminIssuesPage = lazy(() => import("./pages/AdminIssuesPage"));
```

- [ ] **Step 3: Wrap the route in Suspense**

Find the route that opens with `<Route path="/admin/issues" element={` and replace that whole `<Route .../>` element, through its closing `} />`, with:

```tsx
          <Route path="/admin/issues" element={
            <ProtectedRoute allowedRoles={["super_admin"]}>
              <Suspense fallback={<p>Loading...</p>}>
                <AdminIssuesPage />
              </Suspense>
            </ProtectedRoute>
          } />
```

That is the same `<Suspense fallback={<p>Loading...</p>}>` shape every other lazy route in this file uses. Keep `allowedRoles={["super_admin"]}` exactly as it was: the inbox reads `reported_issues`, whose SELECT policy is super-admin-only after Phase 1.

- [ ] **Step 4: Prove the split actually happened**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/App.tsx
npx vite build
```

All three must exit 0. In the `vite build` output there must now be a separate `AdminIssuesPage-*.js` chunk. Bundle-size warnings above 500 kB on pre-existing chunks are not failures.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "perf(support): code-split the admin support inbox route"
```

---

### Task 25: Link `/tasks` into the conversation

**Files:**
- Modify: `src/components/tms/TaskDetailPanel.tsx:1-48` (imports), `:96-110` (hook call above the early returns), `:311-321` (support banner)
- Modify: `src/hooks/useSupportRequest.ts:98-107` (invalidations after `resolve_support_task`)

**Interfaces:**
- Consumes: `useSupportTicketIdForTask` from `src/hooks/useReportedIssues.ts` (Task 21); `/admin/issues?ticket=<id>` deep link (Task 23)
- Produces: a single home for the thread. `resolve_support_task` keeps its `(uuid, text, text)` signature and, after Phase 2, routes through `_support_apply_status`, so the Resolve and Not-an-issue actions need no change beyond cache invalidation.

- [ ] **Step 1: Add the imports to `TaskDetailPanel.tsx`**

Add `Link` to the existing `react-router-dom` surface (the file imports no router symbols today, so add a new line beside the other imports at the top):

```tsx
import { Link } from "react-router-dom";
```

Add `MessagesSquare` to the `lucide-react` import list, which currently reads `CalendarDays, User, Clock, CheckCircle, XCircle, AlertTriangle, Eye, LifeBuoy`, so it becomes:

```tsx
import {
  CalendarDays,
  User,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  LifeBuoy,
  MessagesSquare,
} from "lucide-react";
```

And add the hook import:

```tsx
import { useSupportTicketIdForTask } from "@/hooks/useReportedIssues";
```

- [ ] **Step 2: Resolve the ticket id ABOVE the early returns**

`TaskDetailPanel` returns early at `if (!taskId) return null;` and again for the grouped view, and `isSupportOwner` is only computed after those. A hook cannot be called after a conditional return, so recompute the support test from `fetchedTask` at the top. Insert this directly after the `const derivedGroupId = groupId ?? fetchedTask?.task_group_id ?? null;` line:

```tsx
  // Hooks must run before any early return, so the support test is recomputed
  // here from `fetchedTask` rather than the derived `task` further down.
  // `reported_issues` SELECT is super-admin-only, so gate the read explicitly
  // instead of letting a denied query resolve as "no ticket".
  const isSupportTicketTask = Boolean(
    supportInstitutionId && fetchedTask?.institution_id === supportInstitutionId,
  );
  const { data: supportTicketId } = useSupportTicketIdForTask(
    taskId,
    isSupportTicketTask && Boolean(userRole?.isSuperAdmin),
  );
```

- [ ] **Step 3: Add View conversation to the support banner**

Replace the support ticket banner block (the `{isSupportTask && ( ... )}` div) with:

```tsx
          {/* Support ticket banner. The reporter can watch but not act. */}
          {isSupportTask && (
            <div className="rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <LifeBuoy className="h-5 w-5 shrink-0 text-brand-primary" />
                <p className="text-sm text-ink-700">
                  {isSupportOwner
                    ? "This is a Salci Support request. Resolving it closes the ticket for the person who raised it."
                    : "This is your Salci Support request. Only the SALCI team can close it, and you will see the status update here."}
                </p>
              </div>
              {/* One home for the thread. The reply history and the internal
                  notes live in the Support Inbox, not half-rendered here. */}
              {isSupportOwner && supportTicketId && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/admin/issues?ticket=${supportTicketId}`}>
                    <MessagesSquare className="h-4 w-4 mr-2" />
                    View conversation
                  </Link>
                </Button>
              )}
            </div>
          )}
```

The Resolve and Not-an-issue AlertDialogs below stay exactly as they are. They call `resolve_support_task`, which Phase 2 rewrote as a wrapper over `_support_apply_status`, so a resolution from here now writes the same system message, the same `resolved_at` stamp and the same notification as one from the inbox.

- [ ] **Step 4: Invalidate the support caches when /tasks resolves a ticket**

In `src/hooks/useSupportRequest.ts`, replace the `onSuccess` body of `useResolveSupportRequest` with:

```ts
    onSuccess: (_result, variables) => {
      toast.success(
        variables.outcome === "completed"
          ? "Support request resolved"
          : "Support request closed",
      );
      // resolve_support_task now routes through _support_apply_status, so it
      // moves the ticket, writes a kind='system' message and notifies the
      // reporter. Every support surface is stale afterwards, not just /tasks.
      for (const key of [
        "my-tasks",
        "tasks-assigned-by-me",
        "task-detail",
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-ticket",
        "support-thread",
        "support-my-tickets",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
```

- [ ] **Step 5: Typecheck and lint**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/components/tms/TaskDetailPanel.tsx src/hooks/useSupportRequest.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/components/tms/TaskDetailPanel.tsx src/hooks/useSupportRequest.ts
git commit -m "feat(support): task panel links into the ticket conversation and refreshes support caches"
```

---

### Task 26: Verify the phase against prod and the build

**Files:**
- Create: `scripts/verify-support-phase4.sql`

**Interfaces:**
- Consumes: the Phase 1 and Phase 2 schema in project `gyymkgohcijeksmrzuyw`
- Produces: a repeatable PASS/FAIL assertion file for every database contract this phase's frontend depends on

- [ ] **Step 1: Write the assertion file**

Create `scripts/verify-support-phase4.sql`:

```sql
-- Contracts the Phase 4 (SALCI inbox) frontend depends on.
-- Run:  powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-support-phase4.sql -OutFile out.json
-- Read the result file with encoding utf-8-sig (run-sql.ps1 writes a UTF-8 BOM).
-- Every row must read PASS. A FAIL means Phase 1 or Phase 2 is not actually in
-- prod, regardless of what the on-disk migrations say: the ledger
-- supabase_migrations.schema_migrations is not maintained in this project.

SELECT 'admin_notes dropped' AS check_name,
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name = 'admin_notes'
       ) THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL
SELECT 'seven new reported_issues columns present',
       CASE WHEN (
         SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name IN ('category','priority','last_message_at',
                               'reporter_last_read_at','salci_last_read_at',
                               'first_response_at','resolved_at')
       ) = 7 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'reporter_id is nullable',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name = 'reporter_id'
           AND is_nullable = 'YES'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'set_support_ticket_status returns jsonb',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'set_support_ticket_status'
           AND pg_get_function_result(p.oid) = 'jsonb'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'support_inbox_counts emits awaiting_salci',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'support_inbox_counts'
           AND pg_get_functiondef(p.oid) LIKE '%awaiting_salci%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- One overload only, and it takes p_status. The chip on the inbox passes the
-- active tab so its number and the rows it filters measure the same set; a
-- surviving two-argument version would silently answer with the old
-- platform-wide figure.
SELECT 'support_inbox_counts is (uuid,text,text) and only that',
       CASE WHEN (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'support_inbox_counts'
           AND pg_get_function_identity_arguments(p.oid)
               = 'p_institution_id uuid, p_role text, p_status text'
       ) = 1
       AND (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'support_inbox_counts'
       ) = 1
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'mark_support_ticket_read exists',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'mark_support_ticket_read'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'resolve_support_task still (uuid,text,text)',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'resolve_support_task'
           AND pg_get_function_identity_arguments(p.oid) = 'p_task_id uuid, p_outcome text, p_note text'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'no PUBLIC execute on the support RPCs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('post_support_message','get_support_thread',
                             'list_my_support_tickets','mark_support_ticket_read',
                             'set_support_ticket_status','support_inbox_counts',
                             'get_support_ticket_transcript','resolve_support_task')
           AND array_to_string(p.proacl, ',') ~ '(^|,)=X/'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'no anon execute on the support RPCs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('post_support_message','get_support_thread',
                             'list_my_support_tickets','mark_support_ticket_read',
                             'set_support_ticket_status','support_inbox_counts',
                             'get_support_ticket_transcript','resolve_support_task')
           AND array_to_string(p.proacl, ',') ~ 'anon=X/'
       ) THEN 'PASS' ELSE 'FAIL' END;
```

- [ ] **Step 2: Run it against prod**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-support-phase4.sql -OutFile scratch-phase4.json
```

`run-sql.ps1` takes a file, not a string, reads the PAT from Windows Credential Manager target `Supabase CLI:supabase`, and posts to the Management API. Open `scratch-phase4.json` with encoding `utf-8-sig` (it carries a UTF-8 BOM). Every row must read `PASS`. If `admin_notes dropped` fails, stop: the frontend in this phase compiles against a schema prod does not have.

- [ ] **Step 3: Full frontend verification cycle**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -rn "admin_notes" src/
npm run typecheck
npx eslint src/hooks/useReportedIssues.ts src/hooks/useSupportRequest.ts src/pages/AdminIssuesPage.tsx src/components/issues/IssueDetailSheet.tsx src/components/tms/TaskDetailPanel.tsx src/App.tsx
npx vite build
```

The grep must return nothing at all. If it still hits `src/integrations/supabase/types.ts`, Phase 2's regen from prod (`npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw`) did not land, and the checked-in types are lying about the schema. The other three commands must each exit 0, with no `eslint-disable` and no `as any` anywhere in the diff.

- [ ] **Step 4: Manual pass as a super admin**

Sign in as a super admin and walk these, at 375px width and then again with dark mode on. Each must hold:

1. `/admin/issues` loads through its Suspense fallback and lists tickets. The Awaiting SALCI chip shows the server count and, when pressed, narrows the list. Switch to the Closed tab: the chip's number changes with the tab, and pressing it leaves exactly that many rows on screen. A chip reading a non-zero count over an empty filtered list means the count and the filter are measuring different sets.
2. A ticket with a reporter reply carries a teal dot beside its subject. Open it, close it, refresh: the dot is gone.
3. The sheet is a centred panel that flips fully in dark mode. There is no Internal notes textarea and no Linked task button anywhere on the page or in the sheet.
4. Turning on Internal note visibly recolours the composer to amber before a single character is typed.
5. Change the status: a system line appears in the thread, the badge updates, the sheet stays open.
6. Open a support ticket in `/tasks` as the owner, press View conversation, and land on `/admin/issues` with that exact ticket's sheet already open. Close the sheet: the `?ticket=` parameter disappears from the URL without adding a history entry.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-support-phase4.sql
git commit -m "chore(support): assertion script for the phase 4 inbox schema contract"
```

---

## Phase 5 - Notifications and email

### Task 27: Create the `support-notify-email` edge function

**Files:**
- Create: `supabase/functions/support-notify-email/index.ts`
- Modify: `supabase/config.toml` (append a new `[functions.support-notify-email]` block at the end of the file)

**Interfaces:**
- Consumes: `SupportNotify` payload shape returned by `post_support_message` and `set_support_ticket_status`; SQL helper `public.can_access_support_ticket(p_ticket uuid)`; tables `public.reported_issues`, `public.profiles`
- Produces: HTTP endpoint `support-notify-email` accepting `{ notify: SupportNotify, origin: string }` and returning `{ sent: boolean, reason?: string, email_id?: string }`

- [ ] **Step 1: Create the function directory and write the complete function**

Create `supabase/functions/support-notify-email/index.ts` with exactly this content:

```ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Best-effort transactional email for the SALCI Support workflow.
 *
 * The in-app notification is written inside the RPC transaction and is the
 * durable channel. This function is the courtesy copy, so every failure path
 * returns a 200 with `sent: false` rather than an error the caller must
 * handle, EXCEPT for genuine misconfiguration or an unauthorised caller.
 *
 * Trust model: the client hands us a `notify` payload, but we never trust it
 * for (a) who receives the mail or (b) where the link points.
 *  - The recipient address is resolved server-side from `profiles`.
 *  - The deep-link origin is checked against the SUPPORT_APP_ORIGINS allowlist
 *    (the portal runs on two production frontends against one Supabase
 *    project, so the domain cannot be hardcoded).
 *  - The caller must pass `can_access_support_ticket` for this ticket under
 *    their own JWT, so a random authenticated user cannot use this as a
 *    mailer.
 */

type NotifyKind = "support_reply" | "support_status_changed" | "support_reopened";

interface SupportNotify {
  to_user_id: string;
  to_email: string | null;
  to_name: string | null;
  kind: NotifyKind;
  ticket_id: string;
  subject: string;
  preview: string;
}

interface RequestBody {
  notify?: SupportNotify;
  origin?: string;
}

const KIND_COPY: Record<NotifyKind, { subject: (s: string) => string; heading: string; lead: string }> = {
  support_reply: {
    subject: (s) => `New reply on your support request: ${s}`,
    heading: "New reply on your support request",
    lead: "There is a new message on this support request.",
  },
  support_status_changed: {
    subject: (s) => `Status update on your support request: ${s}`,
    heading: "Status update",
    lead: "The status of this support request has changed.",
  },
  support_reopened: {
    subject: (s) => `Support request reopened: ${s}`,
    heading: "Support request reopened",
    lead: "This support request has been reopened and needs another look.",
  },
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;

/** Allowlisted origin, or the first allowlisted origin on a miss. */
const resolveOrigin = (candidate: string | undefined, allowlist: string[]): string => {
  const cleaned = (candidate ?? "").trim().replace(/\/+$/, "");
  return allowlist.includes(cleaned) ? cleaned : allowlist[0];
};

const buildEmailHtml = (opts: {
  heading: string;
  lead: string;
  recipientName: string | null;
  ticketSubject: string;
  preview: string;
  ctaUrl: string;
}): string => {
  const greeting = opts.recipientName ? `Hi ${escapeHtml(opts.recipientName)},` : "Hi,";
  const preview = escapeHtml(clip(opts.preview ?? "", 400)).replace(/\n/g, "<br />");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f7fa; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08); overflow: hidden;">
              <tr>
                <td style="background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); padding: 32px 40px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.3px;">${escapeHtml(opts.heading)}</h1>
                  <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">SALCI Support</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 32px 40px;">
                  <p style="margin: 0 0 20px; font-size: 16px; color: #1f2937; line-height: 1.6;">${greeting}</p>
                  <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563; line-height: 1.7;">${escapeHtml(opts.lead)}</p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #f9fafb; border-radius: 12px; border-left: 4px solid #249ca2; margin: 0 0 24px;">
                    <tr>
                      <td style="padding: 20px 24px;">
                        <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px;">Request</p>
                        <p style="margin: 0 0 16px; color: #1f2937; font-size: 15px; font-weight: 600;">${escapeHtml(opts.ticketSubject)}</p>
                        <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px;">Latest update</p>
                        <p style="margin: 0; color: #4b5563; font-size: 14px; line-height: 1.7;">${preview}</p>
                      </td>
                    </tr>
                  </table>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 8px;">
                    <tr>
                      <td align="center">
                        <a href="${opts.ctaUrl}"
                           style="display: inline-block; background: linear-gradient(135deg, #249ca2 0%, #1c7a7e 100%); color: #ffffff; padding: 14px 36px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 14px rgba(36, 156, 162, 0.3);">
                          Open the conversation
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background: #f9fafb; padding: 20px 40px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0 0 6px; color: #6b7280; font-size: 13px; text-align: center;">
                    Replies to this address are not monitored. Please reply inside the portal so your message reaches the team.
                  </p>
                  <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                    &copy; ${new Date().getFullYear()} SALCI. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const originsRaw = Deno.env.get("SUPPORT_APP_ORIGINS") ?? "";

    const allowlist = originsRaw
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter((o) => o.length > 0);

    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error("support-notify-email: missing Supabase env");
      return json(500, { error: "Notification service is not configured." });
    }
    if (allowlist.length === 0) {
      console.error("support-notify-email: SUPPORT_APP_ORIGINS is empty");
      return json(500, { error: "Notification service is not configured." });
    }

    const body = (await req.json()) as RequestBody;
    const notify = body.notify;

    if (!notify || !notify.ticket_id || !notify.to_user_id || !notify.kind) {
      return json(400, { error: "Missing notify payload." });
    }
    const copy = KIND_COPY[notify.kind];
    if (!copy) {
      return json(400, { error: "Unknown notification kind." });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Not signed in." });
    }

    // Authority check under the CALLER's JWT: only a participant on this
    // ticket may trigger mail about it.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: allowed, error: authErr } = await userClient.rpc("can_access_support_ticket", {
      p_ticket: notify.ticket_id,
    });
    if (authErr) {
      console.error("support-notify-email: authority check failed", authErr.message);
      return json(403, { error: "You do not have access to this support request." });
    }
    if (allowed !== true) {
      return json(403, { error: "You do not have access to this support request." });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Recipient address comes from the database, never from the request body.
    const { data: recipient, error: recipientErr } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", notify.to_user_id)
      .maybeSingle();

    if (recipientErr) {
      console.error("support-notify-email: recipient lookup failed", recipientErr.message);
      return json(200, { sent: false, reason: "recipient_lookup_failed" });
    }
    if (!recipient?.email) {
      console.log("support-notify-email: recipient has no email, skipping", notify.to_user_id);
      return json(200, { sent: false, reason: "no_recipient_email" });
    }

    // Deep-link target depends on which side the recipient sits on, resolved
    // from the ticket itself rather than from the client.
    const { data: ticket, error: ticketErr } = await admin
      .from("reported_issues")
      .select("id, subject, reporter_id")
      .eq("id", notify.ticket_id)
      .maybeSingle();

    if (ticketErr || !ticket) {
      console.error("support-notify-email: ticket lookup failed", ticketErr?.message ?? "not found");
      return json(200, { sent: false, reason: "ticket_lookup_failed" });
    }

    const origin = resolveOrigin(body.origin, allowlist);
    const isReporter = ticket.reporter_id === notify.to_user_id;
    const path = isReporter ? "/support" : "/admin/issues";
    const ctaUrl = `${origin}${path}?ticket=${encodeURIComponent(notify.ticket_id)}`;

    const ticketSubject = ticket.subject ?? notify.subject ?? "Support request";

    const emailResponse = await resend.emails.send({
      from: "SALCI Support <team@salci.in>",
      to: [recipient.email],
      subject: clip(copy.subject(ticketSubject), 160),
      html: buildEmailHtml({
        heading: copy.heading,
        lead: copy.lead,
        recipientName: recipient.full_name ?? notify.to_name ?? null,
        ticketSubject,
        preview: notify.preview ?? "",
        ctaUrl,
      }),
    });

    if (emailResponse.error) {
      console.error("support-notify-email: resend rejected", emailResponse.error);
      return json(200, { sent: false, reason: "provider_rejected" });
    }

    console.log(`support-notify-email: sent ${notify.kind} for ticket ${notify.ticket_id}`);
    return json(200, { sent: true, email_id: emailResponse.data?.id ?? "sent" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("support-notify-email: unhandled error", message);
    return json(500, { error: message });
  }
});
```

- [ ] **Step 2: Register the function in `supabase/config.toml`**

Append to the very end of `supabase/config.toml` (the file currently ends with the `[functions.homework-notify-pass]` block):

```toml

[functions.support-notify-email]
verify_jwt = true
```

`verify_jwt = true` is deliberate: the function checks the caller's participation in the ticket with their own JWT, so an unauthenticated request must never reach the handler.

- [ ] **Step 3: Type-check the Deno file by eye against the house pattern**

Confirm all four of these are present, since they are the parts that silently break at runtime rather than at build time:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "deno.land/std@0.190.0/http/server.ts" supabase/functions/support-notify-email/index.ts
grep -n "npm:resend@2.0.0" supabase/functions/support-notify-email/index.ts
grep -n "SALCI Support <team@salci.in>" supabase/functions/support-notify-email/index.ts
grep -n "SUPPORT_APP_ORIGINS" supabase/functions/support-notify-email/index.ts
```

Each command must print at least one line.

- [ ] **Step 4: Confirm no em-dash reached the email copy**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "—" supabase/functions/support-notify-email/index.ts
```

This must print nothing. If it prints a line, replace the em-dash with a comma or the word "and".

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/support-notify-email/index.ts supabase/config.toml
git commit -m "feat(support): add support-notify-email edge function with origin allowlist"
```

### Task 28: Set the `SUPPORT_APP_ORIGINS` secret and deploy the function

**Files:**
- Modify: none (this task is deployment only)

**Interfaces:**
- Consumes: `supabase/functions/support-notify-email/index.ts` from Task 27
- Produces: a live `support-notify-email` function on project `gyymkgohcijeksmrzuyw`, with `SUPPORT_APP_ORIGINS` and `RESEND_API_KEY` set

- [ ] **Step 1: Confirm `RESEND_API_KEY` already exists on the project**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx supabase@latest secrets list --project-ref gyymkgohcijeksmrzuyw
```

`RESEND_API_KEY` must appear in the list (the nine existing Resend functions already use it). The command prints sha256 digests, not values, which is expected. If `RESEND_API_KEY` is absent, stop and ask the repo owner for it, do not invent one.

- [ ] **Step 2: Set `SUPPORT_APP_ORIGINS`**

The first entry is the fallback used whenever a client sends an origin that is not on the list, so the canonical portal domain must come first.

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx supabase@latest secrets set SUPPORT_APP_ORIGINS="https://www.salci.org,https://salci.org,https://www.salci.sale,https://salci.sale" --project-ref gyymkgohcijeksmrzuyw
```

- [ ] **Step 3: Verify the secret landed**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx supabase@latest secrets list --project-ref gyymkgohcijeksmrzuyw
```

`SUPPORT_APP_ORIGINS` must now be listed.

- [ ] **Step 4: Deploy the function**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npx supabase@latest functions deploy support-notify-email --project-ref gyymkgohcijeksmrzuyw
```

The command must exit 0 and print the deployed function URL.

- [ ] **Step 5: Smoke-test the misconfiguration and unauthorised paths**

An unauthenticated call must be rejected by the gateway, because `verify_jwt = true`:

```bash
curl -s -o - -w "\nHTTP %{http_code}\n" -X POST \
  "https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/support-notify-email" \
  -H "Content-Type: application/json" \
  -d '{"notify":{"to_user_id":"00000000-0000-0000-0000-000000000000","to_email":null,"to_name":null,"kind":"support_reply","ticket_id":"00000000-0000-0000-0000-000000000000","subject":"x","preview":"x"}}'
```

Expect HTTP 401 and no email sent. A 200 here means `verify_jwt` did not take effect, so re-check `supabase/config.toml` and redeploy.

- [ ] **Step 6: Commit the deployment note**

There is no file change in this task, so record the deployment in the repo history with an empty commit so the next engineer can see when the secret was set:

```bash
git commit --allow-empty -m "chore(support): set SUPPORT_APP_ORIGINS and deploy support-notify-email"
```

### Task 29: Invoke the email from the reporter write path

**Files:**
- Modify: `src/hooks/useSupportTickets.ts` (add the `sendSupportNotifyEmail` helper and call it from `usePostSupportMessage`)

**Interfaces:**
- Consumes: `invokeEdgeFunction` from `src/lib/invokeEdgeFunction.ts`; `toastWarning` from `src/lib/toast.ts`; the `SupportNotify` type and `usePostSupportMessage` created earlier in this plan; the deployed `support-notify-email` function
- Produces: `sendSupportNotifyEmail(notify: SupportNotify | null): Promise<void>`, exported from `src/hooks/useSupportTickets.ts` and reused by `useReportedIssues.ts` in Task 30

- [ ] **Step 1: Add the imports**

At the top of `src/hooks/useSupportTickets.ts`, alongside the existing imports, ensure these two lines are present (add whichever is missing, keep the existing import block order: react-query first, then `@/` modules):

```ts
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError, toastWarning } from "@/lib/toast";
```

If the file already imports `toastError` from `@/lib/toast`, widen that existing import to `import { toastError, toastWarning } from "@/lib/toast";` rather than adding a second import statement from the same module.

- [ ] **Step 2: Add the shared best-effort email helper**

Insert this block in `src/hooks/useSupportTickets.ts` immediately after the type declarations (`SupportAttachment`, `SupportMessage`, `SupportTicket`, `SupportNotify`, `SUPPORT_TAB_STATUSES`) and before the first hook:

```ts
/**
 * Best-effort courtesy email for a support write.
 *
 * The in-app notification is written inside the RPC transaction and is the
 * durable channel, so this must NEVER fail the mutation: the message is
 * already saved by the time we get here. A failure is a warning, not an
 * error, and it is never rethrown.
 *
 * Invoked through `invokeEdgeFunction`, not `supabase.functions.invoke`,
 * which sends an empty Bearer token in this client setup (CLAUDE.md 21).
 *
 * `window.location.origin` is passed because the portal runs on two
 * production frontends against one Supabase project. The function validates
 * it against the SUPPORT_APP_ORIGINS allowlist and falls back to the first
 * entry on a miss, so an unexpected origin can never reach an email link.
 */
export async function sendSupportNotifyEmail(notify: SupportNotify | null | undefined): Promise<void> {
  if (!notify) return;
  try {
    await invokeEdgeFunction<{ sent: boolean; reason?: string }>("support-notify-email", {
      notify,
      origin: window.location.origin,
    });
  } catch (err) {
    console.error("[support] notification email failed", err);
    toastWarning(
      "Saved, but the email alert did not go out.",
      "The other side will still see it in the portal.",
    );
  }
}
```

- [ ] **Step 3: Call it from `usePostSupportMessage`**

In `src/hooks/useSupportTickets.ts`, find `usePostSupportMessage` and make its `onSuccess` fire the email as its first statement. After the edit the `onSuccess` / `onError` pair must read exactly like this (keep whatever invalidation keys the hook already lists, just add the first line and widen the first callback argument from `_result` to `data` if it is currently ignored):

```ts
    onSuccess: (data, variables) => {
      // Fire and forget: the message and its in-app notification are already
      // committed, so email failure must not surface as a failed post.
      void sendSupportNotifyEmail(data.notify);

      queryClient.invalidateQueries({ queryKey: ["support-thread", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support-my-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["support-inbox-counts"] });
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't send your message.",
        context: "postSupportMessage",
      }),
```

- [ ] **Step 4: Verify the hook still type-checks and lints**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/hooks/useSupportTickets.ts
```

`npm run typecheck` must exit 0 and `npx eslint` must report zero errors. Do not use bare `npx tsc --noEmit`, it is a no-op in this repo. If TypeScript complains that `data.notify` is `unknown`, the RPC result in `usePostSupportMessage` is not yet cast to its payload type: cast the `supabase.rpc("post_support_message", ...)` result with `as unknown as { message_id: string; status: string; notify: SupportNotify | null }` inside the `mutationFn` and return that, never `as any`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSupportTickets.ts
git commit -m "feat(support): send best-effort reply email after posting a support message"
```

### Task 30: Invoke the email from the status-change write path

**Files:**
- Modify: `src/hooks/useReportedIssues.ts` (`useSetIssueStatus`)

**Interfaces:**
- Consumes: `sendSupportNotifyEmail` from `src/hooks/useSupportTickets.ts` (Task 29); `SetIssueStatusResult`, already exported by `src/hooks/useReportedIssues.ts` (Task 21); the rewritten `set_support_ticket_status(uuid, text, text) RETURNS jsonb`
- Produces: `useSetIssueStatus` still returning the exported `SetIssueStatusResult` (`{ status: string; notify: SupportNotify | null }`) from its `mutationFn`, and now emailing the reporter on every status move

- [ ] **Step 1: Widen the existing `useSupportTickets` import**

`src/hooks/useReportedIssues.ts` already carries a type-only import from that module:

```ts
import type { SupportNotify } from "@/hooks/useSupportTickets";
```

Replace that single line with a combined value-and-type import, so the module is imported once and `SupportNotify` keeps backing the exported `SetIssueStatusResult`:

```ts
import { sendSupportNotifyEmail, type SupportNotify } from "@/hooks/useSupportTickets";
```

- [ ] **Step 2: Replace `useSetIssueStatus` in full**

Anchor on the exact string `export function useSetIssueStatus() {` and replace that function through its closing `}` with the version below. Do not use line numbers: Task 21 rewrote this whole file and every offset moved.

Leave the `SetIssueStatusResult` interface declared directly above the function exactly as it is, and reuse it here. Declaring a second private interface with the same shape would leave Task 21's exported type unreferenced beside a private twin, and the two would drift the first time the RPC payload changes.

```ts
export function useSetIssueStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      status,
      note,
    }: SetIssueStatusInput): Promise<SetIssueStatusResult> => {
      // One RPC, not two client writes: the intake row and its linked task move
      // in the same transaction or not at all (§23). The RPC also writes the
      // system message row and the in-app notification, and hands back the
      // notify payload so the email needs no second round trip.
      const { data, error } = await supabase.rpc("set_support_ticket_status", {
        p_ticket_id: ticketId,
        p_status: status,
        p_note: note,
      });
      if (error) throw error;
      return data as unknown as SetIssueStatusResult;
    },
    onSuccess: (data, variables) => {
      toast.success(`Marked as ${ISSUE_STATUS_LABELS[variables.status]}`);

      // Best effort, never blocks or fails the status change: the status, the
      // system row and the in-app notification are already committed.
      void sendSupportNotifyEmail(data.notify);

      // The SAME eight keys Task 21 established, unchanged. Two of them are
      // easy to lose and both matter: ["support-inbox-ticket", ticketId] backs
      // the ?ticket= deep-linked sheet, so dropping it leaves a sheet opened
      // from a notification showing the old status badge, and
      // "tasks-assigned-by-me" is the reporter-side task list that moves with
      // the ticket.
      for (const key of [
        "support-inbox",
        "support-inbox-counts",
        "support-inbox-ticket",
        "support-thread",
        "support-my-tickets",
        "my-tasks",
        "tasks-assigned-by-me",
        "task-detail",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update this support request.",
        context: "setSupportTicketStatus",
      }),
  });
}
```

- [ ] **Step 3: Confirm there is no circular-import surprise**

`useReportedIssues.ts` now imports from `useSupportTickets.ts`. Check that the reverse edge does not exist:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "useReportedIssues" src/hooks/useSupportTickets.ts
```

This must print nothing. If it prints a line, move `sendSupportNotifyEmail` and the `SupportNotify` type usage so that `useSupportTickets.ts` never imports from `useReportedIssues.ts`.

- [ ] **Step 4: Run the full verification cycle**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/hooks/useReportedIssues.ts src/hooks/useSupportTickets.ts
npx vite build
```

All three must exit 0, with zero eslint errors. Bundle-size warnings over 500 kB from `vite build` are not failures. Never silence an error with `// eslint-disable-next-line` or `as any`.

- [ ] **Step 5: Manual smoke test on both write paths**

With `npm run dev` running and signed in as the super admin:

1. Open `/admin/issues`, open a ticket that has a reporter with an email on their profile, post a reply. Expect: the reply appears in the thread, a success toast, and no warning toast. Check the function logs with `npx supabase@latest functions logs support-notify-email --project-ref gyymkgohcijeksmrzuyw` for a `support-notify-email: sent support_reply for ticket <id>` line.
2. On the same ticket press Resolve. Expect a "Marked as Resolved" toast and a second log line for `support_status_changed`.
3. Confirm the CTA link in the delivered email points at an allowlisted origin plus `/support?ticket=<id>` for the reporter, not at `localhost`. The dev origin is not on the allowlist, so the function must fall back to the first allowlisted entry, which proves the allowlist path works.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useReportedIssues.ts
git commit -m "feat(support): email the reporter on every support status change"
```

---

## Phase 6 - Attachments

### Task 31: Prove the `support-attachments` bucket and its policies do not exist yet

**Files:**
- Create: `scripts/assert-support-attachments-bucket.sql`

**Interfaces:**
- Consumes: `public.is_uuid(text)` and `public.can_access_support_ticket(uuid)` from Phase 1 (asserted present, not created here)
- Produces: a repeatable PASS/FAIL assertion used BEFORE and AFTER the Phase 6 migration

- [ ] **Step 1: Write the assertion file**

Create `scripts/assert-support-attachments-bucket.sql`:

```sql
-- Phase 6 assertion: the private support-attachments bucket and its two
-- ticket-scoped storage policies.
--
-- Run BEFORE the migration (expect FAIL on every bucket/policy row) and AFTER
-- (expect PASS on every row):
--   powershell -File scripts/run-sql.ps1 -SqlFile scripts/assert-support-attachments-bucket.sql -OutFile out.json
WITH checks AS (
  SELECT 1 AS ord,
         'phase 1 helpers exist (is_uuid + can_access_support_ticket)' AS check_name,
         (to_regprocedure('public.is_uuid(text)') IS NOT NULL
          AND to_regprocedure('public.can_access_support_ticket(uuid)') IS NOT NULL) AS ok
  UNION ALL
  SELECT 2, 'bucket support-attachments exists and is private',
         EXISTS (SELECT 1 FROM storage.buckets
                 WHERE id = 'support-attachments' AND public = false)
  UNION ALL
  SELECT 3, 'bucket file_size_limit is 5242880',
         EXISTS (SELECT 1 FROM storage.buckets
                 WHERE id = 'support-attachments' AND file_size_limit = 5242880)
  UNION ALL
  SELECT 4, 'bucket allows exactly the five support mime types',
         EXISTS (SELECT 1 FROM storage.buckets
                 WHERE id = 'support-attachments'
                   AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']::text[]
                   AND coalesce(array_length(allowed_mime_types, 1), 0) = 5)
  UNION ALL
  SELECT 5, 'INSERT policy exists on storage.objects',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'Support participants upload attachments'
                   AND cmd = 'INSERT')
  UNION ALL
  SELECT 6, 'SELECT policy exists on storage.objects',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'Support participants read attachments'
                   AND cmd = 'SELECT')
  UNION ALL
  SELECT 7, 'INSERT policy guards with is_uuid BEFORE can_access_support_ticket',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'Support participants upload attachments'
                   AND with_check LIKE '%is_uuid%'
                   AND with_check LIKE '%can_access_support_ticket%'
                   AND position('is_uuid' in with_check)
                       < position('can_access_support_ticket' in with_check))
  UNION ALL
  SELECT 8, 'SELECT policy guards with is_uuid BEFORE can_access_support_ticket',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'Support participants read attachments'
                   AND qual LIKE '%is_uuid%'
                   AND qual LIKE '%can_access_support_ticket%'
                   AND position('is_uuid' in qual)
                       < position('can_access_support_ticket' in qual))
  UNION ALL
  SELECT 9, 'no UPDATE or DELETE policy touches support-attachments',
         NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'storage' AND tablename = 'objects'
                       AND cmd IN ('UPDATE','DELETE')
                       AND (coalesce(qual,'') LIKE '%support-attachments%'
                            OR coalesce(with_check,'') LIKE '%support-attachments%'))
  UNION ALL
  SELECT 10, 'no support-attachments policy uses the message-attachments shape',
         NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'storage' AND tablename = 'objects'
                       AND (coalesce(qual,'') LIKE '%support-attachments%'
                            OR coalesce(with_check,'') LIKE '%support-attachments%')
                       AND (coalesce(qual,'') LIKE '%uid() IS NOT NULL%'
                            OR coalesce(with_check,'') LIKE '%uid() IS NOT NULL%'))
)
SELECT ord, check_name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY ord;
```

- [ ] **Step 2: Run it against prod and record the BEFORE result**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/assert-support-attachments-bucket.sql -OutFile "$env:TEMP/support-attach-before.json"
```

Read `%TEMP%\support-attach-before.json` with encoding `utf-8-sig` (the file carries a UTF-8 BOM).

Expected BEFORE state: row 1 `PASS` (Phase 1 already applied), rows 2 through 8 `FAIL`, rows 9 and 10 `PASS` (vacuously true, nothing exists yet).

If row 1 is `FAIL`, stop. Phase 1 has not been applied to prod and the storage policies below cannot be created; apply Phase 1 first.

- [ ] **Step 3: Commit**

```bash
git add scripts/assert-support-attachments-bucket.sql
git commit -m "test(support): assertion for the support-attachments bucket and its ticket-scoped policies"
```

---

### Task 32: Create the private `support-attachments` bucket and its two guarded storage policies

**Files:**
- Create: `supabase/migrations/20260831140000_support_attachments_bucket.sql`
- Create: `scripts/dryrun-support-attachments-bucket.sql`
- Create: `scripts/probe-support-attachments-denial.sql`
- Modify: `scripts/rollback-salci-support-messages.sql` (insert the bucket teardown ahead of its section 6)

**Interfaces:**
- Consumes: `public.is_uuid(p text) RETURNS boolean`, `public.can_access_support_ticket(p_ticket uuid) RETURNS boolean` (Phase 1)
- Produces: storage bucket `support-attachments` (private, 5242880 bytes, 5 mime types); policies `Support participants upload attachments` (INSERT) and `Support participants read attachments` (SELECT) on `storage.objects`; the rollback path for all three

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260831140000_support_attachments_bucket.sql`:

```sql
-- Phase 6 of the Salci Support workflow: private attachment storage.
--
-- DO NOT COPY THE message-attachments BUCKET POLICIES.
-- supabase/migrations/20260226074822_342919a9-820d-4d6a-bf9c-500afb9bd6e1.sql
-- lines 170-178 create policies shaped
--     bucket_id = 'message-attachments' AND auth.uid() IS NOT NULL
-- which make every object in that bucket readable by every authenticated user
-- on the platform. It is the nearest example in this repo and it is the wrong
-- one. The policies below instead resolve the first path segment back to a
-- support ticket and run can_access_support_ticket() on it, so an attachment
-- is exactly as visible as the ticket it belongs to: the reporter and any
-- super admin, nobody else.

-- Fail loudly rather than creating policies that reference missing functions.
DO $$
BEGIN
  IF to_regprocedure('public.is_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'public.is_uuid(text) is missing. Apply the Phase 1 support migration before this one.';
  END IF;
  IF to_regprocedure('public.can_access_support_ticket(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.can_access_support_ticket(uuid) is missing. Apply the Phase 1 support migration before this one.';
  END IF;
END $$;

-- The bucket enforces server-side exactly what the client validates:
-- 5 MB per object, images and PDF only. A client that skips validation still
-- cannot land a 40 MB video here.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies are evaluated as the calling role, so `authenticated` needs
-- EXECUTE on both helpers. Phase 1 revoked EXECUTE from PUBLIC and from anon by
-- name, which also removes the implicit PUBLIC grant `authenticated` was
-- relying on; grant it back explicitly to the one role that needs it.
GRANT EXECUTE ON FUNCTION public.is_uuid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated;

DROP POLICY IF EXISTS "Support participants upload attachments" ON storage.objects;
CREATE POLICY "Support participants upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Support participants read attachments" ON storage.objects;
CREATE POLICY "Support participants read attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

-- No UPDATE policy and no DELETE policy, on purpose. Attachments are immutable,
-- like the support_messages rows that reference them. A storage DELETE blocked
-- by RLS is indistinguishable from a success (CLAUDE.md section 6), so the safe
-- shape is for the client to have no write path other than INSERT.

COMMENT ON POLICY "Support participants read attachments" ON storage.objects IS
  'support-attachments. The is_uuid() guard must stay ahead of the ::uuid cast: a bare cast on a non-uuid first path segment raises 22P02, which surfaces as a hard storage failure instead of a clean denial. The AND short-circuit order is load-bearing.';

COMMENT ON POLICY "Support participants upload attachments" ON storage.objects IS
  'support-attachments. Path is <ticket_id>/<uuid>-<sanitised filename>. Authority comes from the first path segment, never from auth.uid() IS NOT NULL.';
```

- [ ] **Step 2: Write the dry run and run it**

Create `scripts/dryrun-support-attachments-bucket.sql` (the migration body wrapped in an explicit transaction that is rolled back, so a syntax or permission problem surfaces without changing prod):

```sql
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_uuid(text)') IS NULL THEN
    RAISE EXCEPTION 'public.is_uuid(text) is missing. Apply the Phase 1 support migration before this one.';
  END IF;
  IF to_regprocedure('public.can_access_support_ticket(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.can_access_support_ticket(uuid) is missing. Apply the Phase 1 support migration before this one.';
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

GRANT EXECUTE ON FUNCTION public.is_uuid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated;

DROP POLICY IF EXISTS "Support participants upload attachments" ON storage.objects;
CREATE POLICY "Support participants upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Support participants read attachments" ON storage.objects;
CREATE POLICY "Support participants read attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_uuid((storage.foldername(name))[1])
    AND public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

SELECT 'dry run applied cleanly' AS result,
       (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname IN ('Support participants upload attachments',
                             'Support participants read attachments')) AS policies_created;

ROLLBACK;
```

Run it:

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/dryrun-support-attachments-bucket.sql -OutFile "$env:TEMP/support-attach-dryrun.json"
```

Read `%TEMP%\support-attach-dryrun.json` with encoding `utf-8-sig`. Success is a body with no `error` / `message` key. `policies_created` must be `2`. If the body carries an error, fix the migration and re-run the dry run before touching prod.

- [ ] **Step 3: Apply the migration to prod**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260831140000_support_attachments_bucket.sql -OutFile "$env:TEMP/support-attach-apply.json"
```

Read `%TEMP%\support-attach-apply.json` with encoding `utf-8-sig` and confirm there is no `error` key. Merging this file does not apply it: `supabase_migrations.schema_migrations` is not maintained in this project, so the Management API run above is the only thing that reaches prod.

- [ ] **Step 4: Re-run the assertion and confirm every row is PASS**

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/assert-support-attachments-bucket.sql -OutFile "$env:TEMP/support-attach-after.json"
```

All 10 rows must read `PASS`. Rows 7 and 8 are the ones that matter most: they prove `is_uuid` appears earlier in the policy expression than `can_access_support_ticket`, which is what keeps a non-uuid first path segment a clean denial instead of a `22P02` storage failure. Row 10 proves nobody pasted the `message-attachments` shape.

- [ ] **Step 5: Prove a non-uuid path is DENIED, not a 22P02 crash**

Task 31 rows 7 and 8 only prove that the string `is_uuid` appears earlier than `can_access_support_ticket` in the policy text. Text ordering is not evaluation. Spec section 11, database bullet 8 asks for the behaviour itself: an object path whose first segment is not a uuid must come back as a clean RLS denial (`42501`), never as `22P02 invalid input syntax for type uuid`, which would surface to the user as a hard storage failure and, worse, would prove the short-circuit is not happening.

Create `scripts/probe-support-attachments-denial.sql`:

```sql
-- Phase 6 storage security probe. Runs entirely inside BEGIN ... ROLLBACK, so
-- nothing it inserts survives.
--
-- It impersonates a real reporter (SET LOCAL ROLE authenticated plus the two
-- request.jwt.* settings auth.uid() reads) and drives storage.objects directly:
--
--   negative: 'avatars/x.png'   -> first path segment is not a uuid.
--             MUST raise 42501 (RLS denial). If it raises 22P02 the is_uuid()
--             guard is not short-circuiting ahead of the ::uuid cast and the
--             policy is wrong, however good its text ordering looks.
--   positive: '<own ticket id>/probe.png' -> MUST insert.
--             Without this control a policy that denies everything would pass
--             the negative case for the wrong reason.
--
-- Run AFTER the migration is applied:
--   powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\probe-support-attachments-denial.sql -OutFile "%TEMP%\support-attach-probe.json"
BEGIN;

DO $$
DECLARE
  v_reporter uuid;
  v_ticket   uuid;
  v_state    text;
  v_msg      text;
BEGIN
  SELECT r.reporter_id, r.id
    INTO v_reporter, v_ticket
  FROM public.reported_issues r
  WHERE r.reporter_id IS NOT NULL
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_reporter IS NULL THEN
    RAISE EXCEPTION 'PROBE FAILED: no ticket with a live reporter to impersonate.';
  END IF;

  -- auth.uid() reads request.jwt.claim.sub first and falls back to the sub key
  -- of request.jwt.claims. Set both, transaction-local.
  PERFORM set_config('request.jwt.claim.sub', v_reporter::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_reporter::text, 'role', 'authenticated')::text,
    true);

  -- Outside every nested exception block on purpose: a SET LOCAL made inside a
  -- block that then traps an error is rolled back with that block's savepoint.
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF auth.uid() IS DISTINCT FROM v_reporter THEN
    RAISE EXCEPTION 'PROBE FAILED: impersonation did not take, auth.uid() is %', auth.uid();
  END IF;

  ---------------------------------------------------------------------------
  -- Negative case: first path segment is not a uuid.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('support-attachments', 'avatars/x.png', v_reporter);

    RAISE EXCEPTION
      'PROBE FAILED: a non-uuid path prefix was ACCEPTED into support-attachments. The INSERT policy is not scoping by ticket.';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'negative case OK: non-uuid prefix denied with 42501';
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION
        'PROBE FAILED: non-uuid prefix raised 22P02, not 42501. is_uuid() is NOT short-circuiting ahead of the ::uuid cast; fix the policy expression order.';
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      RAISE EXCEPTION
        'PROBE FAILED: non-uuid prefix raised % (%), expected 42501.', v_state, v_msg;
  END;

  ---------------------------------------------------------------------------
  -- Positive control: the reporter's own ticket id as the prefix.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('support-attachments', v_ticket::text || '/probe.png', v_reporter);

    RAISE NOTICE 'positive control OK: own ticket prefix accepted';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      RAISE EXCEPTION
        'PROBE FAILED: the reporter could not upload under their OWN ticket. % (%). The policy denies everything, so the negative case above proved nothing.',
        v_state, v_msg;
  END;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'storage denial probe passed both cases';
END $$;

ROLLBACK;

SELECT 'storage denial probe completed with no error' AS result,
       (SELECT count(*) FROM storage.objects
         WHERE bucket_id = 'support-attachments')          AS objects_left,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname IN ('Support participants upload attachments',
                              'Support participants read attachments')) AS policies_live;
```

Run it:

```powershell
powershell -NoProfile -File scripts\run-sql.ps1 -SqlFile scripts\probe-support-attachments-denial.sql -OutFile "$env:TEMP\support-attach-probe.json"
Get-Content "$env:TEMP\support-attach-probe.json"
```

Read `%TEMP%\support-attach-probe.json` with encoding `utf-8-sig`. Expected: no `error` key, `objects_left` `0` and `policies_live` `2`. Any `PROBE FAILED` message is a stop: fix the policy expression in the migration, re-apply it, and re-run this probe before writing any client code against the bucket.

- [ ] **Step 6: Append the bucket teardown to the Phase 1 rollback, AHEAD of its function drops**

Spec section 10 item 4 requires the rollback to remove the bucket and its policies. `scripts/rollback-salci-support-messages.sql` was written in Task 7, before this bucket existed, and its section 6 runs:

```sql
DROP FUNCTION IF EXISTS public.can_access_support_ticket(uuid);
DROP FUNCTION IF EXISTS public.is_uuid(text);
```

The two storage policies created above reference both of those functions, and a policy IS a tracked `pg_depend` dependency. From the moment this migration lands, that `DROP FUNCTION` fails with `2BP01 cannot drop function ... because other objects depend on it`. The break-glass script would then abort mid-way, AFTER section 1 restored `admin_notes` and section 3 restored the leaking SELECT policy, leaving production in the worst possible state: the confidentiality leak reopened and the thread still live.

Edit `scripts/rollback-salci-support-messages.sql` and insert this new section immediately BEFORE the line `-- 6. Drop the thread and its helpers` (that is, between the `END $$;` that closes section 5 and section 6's comment banner):

```sql
-- ---------------------------------------------------------------------------
-- 5b. Tear down the attachment bucket (added 2026-08-31 with Phase 6)
--
-- MUST run before section 6. Both storage policies below reference
-- can_access_support_ticket() and is_uuid(); a policy is a tracked pg_depend
-- dependency, so section 6's DROP FUNCTION raises 2BP01 while they exist and
-- aborts this script after it has already restored admin_notes and the leaking
-- SELECT policy.
--
-- The DELETE removes the storage.objects ROWS only. The bytes in S3 are not
-- reachable from SQL; after this rollback, empty the support-attachments bucket
-- from the Supabase Storage dashboard by hand.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Support participants upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Support participants read attachments" ON storage.objects;

DELETE FROM storage.objects WHERE bucket_id = 'support-attachments';
DELETE FROM storage.buckets WHERE id = 'support-attachments';
```

Then confirm the ordering is right in the file:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "5b. Tear down\|6. Drop the thread\|DROP FUNCTION IF EXISTS public.is_uuid" scripts/rollback-salci-support-messages.sql
```

The `5b` line number must be smaller than the `6.` line number, which must be smaller than the `is_uuid` drop. If they are not in that order the rollback is still booby-trapped.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260831140000_support_attachments_bucket.sql scripts/dryrun-support-attachments-bucket.sql scripts/probe-support-attachments-denial.sql scripts/rollback-salci-support-messages.sql
git commit -m "feat(support): private support-attachments bucket with ticket-scoped storage policies"
```

---

### Task 33: `src/lib/supportAttachments.ts`, upload helper and batched signed-URL hook

**Files:**
- Create: `src/lib/supportAttachments.ts`

**Interfaces:**
- Consumes: `SupportAttachment` from `src/hooks/useSupportTickets.ts` (Phase 3); `validateFileUpload` from `src/lib/fileValidation.ts`; `uploadResumable` from `src/lib/storageUpload.ts`; `supabase` from `src/integrations/supabase/client`
- Produces: `SUPPORT_ATTACHMENTS_BUCKET`, `SUPPORT_FILE_ALLOWED_MIMES`, `SUPPORT_FILE_ACCEPT`, `SUPPORT_MAX_FILE_BYTES`, `SUPPORT_MAX_FILES`, `formatSupportFileSize`, `isSupportImageAttachment`, `uploadSupportAttachments`, `useSupportAttachmentUrls`

- [ ] **Step 1: Confirm the `SupportAttachment` type name and shape**

```bash
grep -n "SupportAttachment" "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main/src/hooks/useSupportTickets.ts"
```

It must be `{ path: string; name: string; size: number; type: string }`, exported from `src/hooks/useSupportTickets.ts`. That is the exact shape `post_support_message` stores into `support_messages.attachments`, so it is not renamed or reshaped here.

- [ ] **Step 2: Write the file**

Create `src/lib/supportAttachments.ts`:

```ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { validateFileUpload } from "@/lib/fileValidation";
import { uploadResumable } from "@/lib/storageUpload";
import type { SupportAttachment } from "@/hooks/useSupportTickets";

/** Private bucket created by 20260831140000_support_attachments_bucket.sql.
 *  Read and write authority both come from the first path segment, which is
 *  the ticket id, resolved by can_access_support_ticket() in the policy. */
export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";

/** MUST match the bucket's allowed_mime_types exactly. The bucket rejects
 *  anything else server-side; this list exists so the reporter is told why
 *  before a byte is uploaded. */
export const SUPPORT_FILE_ALLOWED_MIMES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

/** `accept` attribute for the file input. */
export const SUPPORT_FILE_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf";

/** 5 MB, matching the bucket's file_size_limit of 5242880. */
export const SUPPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Per message, not per ticket. */
export const SUPPORT_MAX_FILES = 3;

/** Signed links are deliberately short lived: the URL is minted when the
 *  thread is opened, so a copied link stops working quickly. */
const SIGNED_URL_TTL_SECONDS = 300;

/** Keeps a filename recognisable while stripping anything that would break a
 *  storage path or shift the first path segment away from the ticket id. */
function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120);
}

export function formatSupportFileSize(bytes: number | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Images render inline in the thread, PDFs render as a download row. */
export function isSupportImageAttachment(attachment: SupportAttachment): boolean {
  return typeof attachment.type === "string" && attachment.type.startsWith("image/");
}

/**
 * Uploads every file for one message and returns the rows to hand to
 * `post_support_message` as `p_attachments`.
 *
 * Files upload BEFORE the message is posted, so a failed upload aborts the post
 * and the reporter is told which file failed rather than seeing a message land
 * with a missing screenshot.
 *
 * Uploads run one at a time on purpose: three parallel resumable uploads from a
 * phone on school wifi is the shape that produces half-written objects and an
 * unattributable error.
 *
 * There is no cleanup path for a partially uploaded batch. The bucket has no
 * DELETE policy (attachments are immutable), and an orphaned object is
 * unreachable to anyone who cannot already read the ticket.
 */
export async function uploadSupportAttachments(
  ticketId: string,
  files: File[],
): Promise<SupportAttachment[]> {
  if (files.length === 0) return [];
  if (files.length > SUPPORT_MAX_FILES) {
    throw new Error(
      `You can attach at most ${SUPPORT_MAX_FILES} files to one message.`,
    );
  }

  for (const file of files) {
    // Checked before validateFileUpload so the reporter gets the support
    // vocabulary, not the homework one (Word, PowerPoint, Excel).
    if (file.type && !SUPPORT_FILE_ALLOWED_MIMES.includes(file.type)) {
      throw new Error(
        `"${file.name}" isn't an allowed type. Attach a JPG, PNG, GIF or WEBP image, or a PDF.`,
      );
    }
    const problem = validateFileUpload(file, {
      allowedMimes: SUPPORT_FILE_ALLOWED_MIMES,
      maxBytes: SUPPORT_MAX_FILE_BYTES,
    });
    if (problem) throw new Error(problem);
  }

  const uploaded: SupportAttachment[] = [];
  for (const file of files) {
    const path = `${ticketId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    try {
      await uploadResumable({
        bucket: SUPPORT_ATTACHMENTS_BUCKET,
        path,
        file,
        contentType: file.type || undefined,
      });
    } catch (err) {
      console.error("[uploadSupportAttachments]", path, err);
      throw new Error(
        `Couldn't upload "${file.name}". Your message was not sent, please try again.`,
      );
    }
    uploaded.push({
      path,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    });
  }
  return uploaded;
}

/**
 * Signs every attachment on ONE message in a single storage round trip.
 *
 * `createSignedUrls` (plural) means a message with three files costs one call
 * rather than three. Storage RLS is the gate, so no edge function sits in
 * front of this. The query is keyed on the paths themselves, so two messages
 * never share a cache entry and re-rendering the thread does not re-sign.
 */
export function useSupportAttachmentUrls(
  attachments: SupportAttachment[],
  enabled: boolean,
) {
  const paths = attachments
    .map((a) => a.path)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  const cacheKey = [...paths].sort().join("|");

  return useQuery({
    queryKey: ["support-attachment-urls", cacheKey],
    queryFn: async (): Promise<Record<string, string | null>> => {
      const { data, error } = await supabase.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;

      const out: Record<string, string | null> = {};
      for (const entry of data ?? []) {
        const key = entry.path ?? "";
        if (key) out[key] = entry.signedUrl ?? null;
      }
      // One unsignable file must not blank the whole list.
      for (const p of paths) if (!(p in out)) out[p] = null;
      return out;
    },
    enabled: enabled && paths.length > 0,
    // Links live 300s. Re-signing at 240s means a thread left open never
    // renders a dead image, and the value stays well above the 60_000 floor.
    staleTime: 240_000,
    refetchOnWindowFocus: false,
  });
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main" && npm run typecheck && npx eslint src/lib/supportAttachments.ts
```

Both must exit 0. Do not use bare `npx tsc --noEmit`, it is a no-op in this repo.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supportAttachments.ts
git commit -m "feat(support): attachment upload helper and batched signed-URL hook"
```

---

### Task 34: Fill the attachment slot in `SupportComposer`

**Files:**
- Modify: `src/components/issues/SupportComposer.tsx` (a TARGETED EDIT of the file Task 16 created, never a rewrite from scratch)
- Modify: `src/hooks/useSupportTickets.ts` (only if `usePostSupportMessage` has no `onError`)

**Interfaces:**
- Consumes: `usePostSupportMessage()`, types `SupportAttachment` and `SupportTicket` from `src/hooks/useSupportTickets.ts`; `uploadSupportAttachments`, `SUPPORT_FILE_ACCEPT`, `SUPPORT_MAX_FILES`, `formatSupportFileSize` from `src/lib/supportAttachments`; `toastError` from `src/lib/toast`
- Produces: `SupportComposer` with the SAME four props Task 16 fixed as final, `{ ticketId: string; canPostInternal: boolean; ticketStatus?: SupportTicket["status"]; onPosted?: () => void }`. No prop is added, removed or made optional here, so the Phase 3 and Phase 4 call sites in `SupportThread.tsx` keep compiling untouched.

Two things about the Task 16 file that this task MUST preserve, because losing either is a regression that no typecheck catches:

1. **The outer element stays a `<form>` with `data-dirty` on it.** `src/main.tsx` implements the service-worker contract (CLAUDE.md section 17) by querying `document.querySelector('form[data-dirty="true"]')` before it lets a `controllerchange` reload the page. A `<div data-dirty="true">` never matches that selector, so a deploy landing while someone is mid-reply would hard-reload the page and silently destroy both the typed text and the staged files. Keep the element, keep `onSubmit`, keep the send button as `type="submit"`.
2. **The idempotency token stays a ref, reset by the `ticketId` effect.** Task 16 uses `tokenRef` rather than state on purpose: a retry of a failed send must reuse the token so a message that actually landed is returned instead of duplicated.

- [ ] **Step 1: Confirm the mutation variable names and the error owner**

```bash
grep -n "usePostSupportMessage" -A 40 "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main/src/hooks/useSupportTickets.ts"
```

Two things to establish:

1. The mutation variables object. It must be `{ ticketId, body, isInternal, attachments, clientToken }`, mapping onto `post_support_message(p_ticket_id, p_body, p_is_internal, p_attachments, p_client_token)`. If a field is named differently in the hook, use the hook's name in Step 3 rather than renaming the hook, since Phase 3 call sites depend on it.
2. Whether the mutation has an `onError`. The composer below calls `post.mutate(...)` with only an `onSuccess`, so the hook owns the error toast. If `usePostSupportMessage` has no `onError`, add exactly this to its `useMutation` options (and import `toastError` from `@/lib/toast` if it is not already imported):

```ts
    onError: (err: Error) =>
      toastError(err, {
        fallback: "Couldn't send that message.",
        context: "postSupportMessage",
      }),
```

- [ ] **Step 2: Edit `src/components/issues/SupportComposer.tsx`, four surgical changes**

The file already exists from Task 16. Apply these four edits to it. Do not replace the file wholesale: the `<form>` element, its `data-dirty` attribute, the `type="submit"` button, `tokenRef` and the `ticketId` reset effect are all load-bearing and all easy to lose in a rewrite.

**Edit 1, the imports.** Replace the first two lines:

```tsx
import * as React from "react";
import { Send } from "lucide-react";
```

with:

```tsx
import * as React from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
```

then add these two import blocks below the existing `import { cn } from "@/lib/utils";` line:

```tsx
import { toastError } from "@/lib/toast";
import {
  SUPPORT_FILE_ACCEPT,
  SUPPORT_MAX_FILES,
  formatSupportFileSize,
  uploadSupportAttachments,
} from "@/lib/supportAttachments";
```

and widen the existing hook import to carry the attachment type:

```tsx
import {
  usePostSupportMessage,
  type SupportAttachment,
  type SupportTicket,
} from "@/hooks/useSupportTickets";
```

The `react` import stays a namespace import, so every new hook below is `React.useState` / `React.useRef`. Do not add `import { useState } from "react"` beside it.

**Edit 2, the state and the reset effect.** Replace:

```tsx
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const post = usePostSupportMessage();
```

with:

```tsx
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const post = usePostSupportMessage();
```

and add the two file lines to the existing `ticketId` effect, so switching tickets never carries a staged file across:

```tsx
  React.useEffect(() => {
    setBody("");
    setIsInternal(false);
    setFiles([]);
    setUploading(false);
    tokenRef.current = crypto.randomUUID();
  }, [ticketId]);
```

**Edit 3, the send path.** Replace this block:

```tsx
  const trimmed = body.trim();
  const busy = post.isPending;
  const canSend = trimmed.length > 0 && !busy;
```

with:

```tsx
  const trimmed = body.trim();
  const busy = uploading || post.isPending;
  // post_support_message accepts a body-less message that carries attachments
  // (step 4 of the RPC rejects only "empty body AND no attachments"), so a
  // file on its own is a valid send.
  const dirty = trimmed.length > 0 || files.length > 0;
  const canSend = dirty && !busy;
```

then replace the whole `handleSend` from Task 16 with the async version, and add the two file handlers immediately above it:

```tsx
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Clear the input first: without this, picking the same file twice in a row
    // fires no change event the second time.
    e.target.value = "";
    if (picked.length === 0) return;

    const next = [...files, ...picked];
    if (next.length > SUPPORT_MAX_FILES) {
      toastError(
        new Error(`You can attach at most ${SUPPORT_MAX_FILES} files to one message.`),
        { fallback: "That is too many files.", context: "supportComposer.pickFiles" },
      );
      setFiles(next.slice(0, SUPPORT_MAX_FILES));
      return;
    }
    setFiles(next);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    // Single flight: `busy` gates the double tap, `client_token` gates the
    // retry, and the RPC throttles the caller at 30 messages an hour.
    if (!canSend) return;

    // Upload BEFORE the post, so a message never lands referencing bytes that
    // are not there. A failed upload names the file and aborts the send.
    let attachments: SupportAttachment[] = [];
    if (files.length > 0) {
      setUploading(true);
      try {
        attachments = await uploadSupportAttachments(ticketId, files);
      } catch (error) {
        toastError(error, {
          fallback: "Couldn't upload that file. Your message was not sent.",
          context: "uploadSupportAttachments",
        });
        return;
      } finally {
        setUploading(false);
      }
    }

    post.mutate(
      {
        ticketId,
        body: trimmed,
        isInternal: canPostInternal && isInternal,
        attachments,
        clientToken: tokenRef.current,
      },
      {
        onSuccess: () => {
          setBody("");
          setIsInternal(false);
          setFiles([]);
          tokenRef.current = crypto.randomUUID();
          onPosted?.();
        },
      },
    );
  };
```

**Edit 4, the JSX.** Three changes inside the existing `<form>`, which stays a `<form>`.

First, `handleSend` is now async, so the submit handler discards its promise explicitly (`@typescript-eslint/no-floating-promises` otherwise), and `data-dirty` follows `dirty` rather than the text alone, since a staged file is unsaved work too. Replace the opening tag:

```tsx
    <form
      // Service-worker dirty-form contract (§17): while there is unsent text,
      // an update must toast rather than silently reload the page underneath.
      data-dirty={trimmed.length > 0 ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className="space-y-3"
    >
```

with:

```tsx
    <form
      // Service-worker dirty-form contract (§17): while there is unsent text or
      // a staged file, an update must toast rather than silently reload the page
      // underneath. src/main.tsx matches on form[data-dirty="true"], so this
      // MUST stay a <form> element; a <div> is invisible to that query and the
      // reply, plus every file picked for it, is destroyed by the next deploy.
      data-dirty={dirty ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
      className="space-y-3"
    >
```

Second, insert the hidden input and the staged-file list between the `<Textarea>` and the `{reopensTicket && (` block:

```tsx
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={SUPPORT_FILE_ACCEPT}
        className="hidden"
        onChange={pickFiles}
        aria-hidden
        tabIndex={-1}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-surface-stroke/40 px-2 py-1.5 text-sm"
            >
              <Paperclip className="h-3 w-3 shrink-0 text-ink-500" aria-hidden />
              <span className="flex-1 truncate text-ink-700">{file.name}</span>
              <span className="shrink-0 text-xs text-ink-500">
                {formatSupportFileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removeFile(index)}
                disabled={busy}
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
```

Third, replace the footer row so it carries the Attach button beside the send button. The send button keeps `type="submit"`:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || files.length >= SUPPORT_MAX_FILES}
        >
          <Paperclip className="mr-2 h-4 w-4" aria-hidden />
          Attach
        </Button>
        <span className="text-xs text-ink-500">
          Up to {SUPPORT_MAX_FILES} files, 5 MB each. Images or PDF.
        </span>
        <Button
          type="submit"
          disabled={!canSend}
          className="ml-auto bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="mr-2 h-4 w-4" aria-hidden />
          )}
          {uploading
            ? "Uploading"
            : post.isPending
              ? "Sending"
              : isInternal
                ? "Save note"
                : "Send reply"}
        </Button>
      </div>
```

The `text-ink-700` on the filename is deliberate. `tailwind.config.ts` defines ink 900, 700, 600, 500 and 400 only; there is no `text-ink-800`, and a class Tailwind does not know about compiles to nothing, leaving the filename in whatever colour it inherits.

For reference, the whole file after those four edits:

```tsx
import * as React from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import {
  SUPPORT_FILE_ACCEPT,
  SUPPORT_MAX_FILES,
  formatSupportFileSize,
  uploadSupportAttachments,
} from "@/lib/supportAttachments";
import {
  usePostSupportMessage,
  type SupportAttachment,
  type SupportTicket,
} from "@/hooks/useSupportTickets";

export interface SupportComposerProps {
  ticketId: string;
  /** Super admin only. A reporter is rejected server-side if this is forged. */
  canPostInternal: boolean;
  /**
   * The ticket's current status, so a reporter replying to a resolved or
   * closed request is told, before they type, that the reply reopens it. The
   * reopen itself happens in `post_support_message`; this is only the warning.
   */
  ticketStatus?: SupportTicket["status"];
  /** Fired after a successful post, so the mounting surface can react. */
  onPosted?: () => void;
}

/**
 * Reply box for a support ticket, shared by /support and /admin/issues.
 *
 * The internal toggle restyles the whole box in amber, not just a label,
 * because a private note typed into the public field is the single most
 * expensive mistake this surface can produce.
 *
 * Errors are NOT handled here on purpose: `usePostSupportMessage` routes its
 * `onError` through `toastError`, so there is one translated message for every
 * caller of the write path (CLAUDE.md §19). The one exception is the upload,
 * which is not a mutation and therefore owns its own toast.
 *
 * Attachments upload BEFORE the message posts and their paths are handed to
 * post_support_message, so a message never lands referencing bytes that are not
 * there.
 */
export function SupportComposer({
  ticketId,
  canPostInternal,
  ticketStatus,
  onPosted,
}: SupportComposerProps) {
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const post = usePostSupportMessage();

  // One idempotency token per draft, regenerated only after a successful post.
  // A retry of a failed send reuses the token, so a message that actually
  // landed before the network died is returned rather than duplicated.
  const tokenRef = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    setBody("");
    setIsInternal(false);
    setFiles([]);
    setUploading(false);
    tokenRef.current = crypto.randomUUID();
  }, [ticketId]);

  const trimmed = body.trim();
  const busy = uploading || post.isPending;
  // post_support_message accepts a body-less message that carries attachments
  // (step 4 of the RPC rejects only "empty body AND no attachments"), so a
  // file on its own is a valid send.
  const dirty = trimmed.length > 0 || files.length > 0;
  const canSend = dirty && !busy;

  // A reporter replying to a finished request reopens it. Say so before they
  // type, not after. SALCI's own reply never reopens anything.
  const reopensTicket =
    !canPostInternal && (ticketStatus === "resolved" || ticketStatus === "closed");

  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Clear the input first: without this, picking the same file twice in a row
    // fires no change event the second time.
    e.target.value = "";
    if (picked.length === 0) return;

    const next = [...files, ...picked];
    if (next.length > SUPPORT_MAX_FILES) {
      toastError(
        new Error(`You can attach at most ${SUPPORT_MAX_FILES} files to one message.`),
        { fallback: "That is too many files.", context: "supportComposer.pickFiles" },
      );
      setFiles(next.slice(0, SUPPORT_MAX_FILES));
      return;
    }
    setFiles(next);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    // Single flight: `busy` gates the double tap, `client_token` gates the
    // retry, and the RPC throttles the caller at 30 messages an hour.
    if (!canSend) return;

    // Upload BEFORE the post, so a message never lands referencing bytes that
    // are not there. A failed upload names the file and aborts the send.
    let attachments: SupportAttachment[] = [];
    if (files.length > 0) {
      setUploading(true);
      try {
        attachments = await uploadSupportAttachments(ticketId, files);
      } catch (error) {
        toastError(error, {
          fallback: "Couldn't upload that file. Your message was not sent.",
          context: "uploadSupportAttachments",
        });
        return;
      } finally {
        setUploading(false);
      }
    }

    post.mutate(
      {
        ticketId,
        body: trimmed,
        isInternal: canPostInternal && isInternal,
        attachments,
        clientToken: tokenRef.current,
      },
      {
        onSuccess: () => {
          setBody("");
          setIsInternal(false);
          setFiles([]);
          tokenRef.current = crypto.randomUUID();
          onPosted?.();
        },
      },
    );
  };

  return (
    <form
      // Service-worker dirty-form contract (§17): while there is unsent text or
      // a staged file, an update must toast rather than silently reload the page
      // underneath. src/main.tsx matches on form[data-dirty="true"], so this
      // MUST stay a <form> element; a <div> is invisible to that query and the
      // reply, plus every file picked for it, is destroyed by the next deploy.
      data-dirty={dirty ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
      className="space-y-3"
    >
      {canPostInternal && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-card border p-3 transition-colors duration-200",
            isInternal
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-surface-stroke bg-surface-base/60",
          )}
        >
          <div className="min-w-0">
            <Label
              htmlFor={`support-internal-${ticketId}`}
              className="text-sm font-medium text-ink-900"
            >
              Internal note
            </Label>
            <p className="text-xs text-ink-500">
              {isInternal
                ? "Only SALCI can read this. The reporter is not notified."
                : "Off, so your reply goes to the reporter."}
            </p>
          </div>
          <Switch
            id={`support-internal-${ticketId}`}
            checked={isInternal}
            onCheckedChange={setIsInternal}
          />
        </div>
      )}

      <Textarea
        id={`support-composer-${ticketId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={isInternal ? "Write a note only SALCI can see." : "Write your reply"}
        rows={3}
        disabled={busy}
        aria-label={isInternal ? "Internal note" : "Reply"}
        className={cn(
          "resize-none",
          isInternal && "border-amber-500/50 bg-amber-500/5 focus-visible:ring-amber-500/40",
        )}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={SUPPORT_FILE_ACCEPT}
        className="hidden"
        onChange={pickFiles}
        aria-hidden
        tabIndex={-1}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-surface-stroke/40 px-2 py-1.5 text-sm"
            >
              <Paperclip className="h-3 w-3 shrink-0 text-ink-500" aria-hidden />
              <span className="flex-1 truncate text-ink-700">{file.name}</span>
              <span className="shrink-0 text-xs text-ink-500">
                {formatSupportFileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => removeFile(index)}
                disabled={busy}
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {reopensTicket && (
        <p className="text-xs text-ink-500">
          Replying reopens this request and tells SALCI.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || files.length >= SUPPORT_MAX_FILES}
        >
          <Paperclip className="mr-2 h-4 w-4" aria-hidden />
          Attach
        </Button>
        <span className="text-xs text-ink-500">
          Up to {SUPPORT_MAX_FILES} files, 5 MB each. Images or PDF.
        </span>
        <Button
          type="submit"
          disabled={!canSend}
          className="ml-auto bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="mr-2 h-4 w-4" aria-hidden />
          )}
          {uploading
            ? "Uploading"
            : post.isPending
              ? "Sending"
              : isInternal
                ? "Save note"
                : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
```

Confirm the dirty-form contract survived, before moving on:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "data-dirty" src/components/issues/SupportComposer.tsx
grep -n "form\[data-dirty" src/main.tsx
```

The composer's `data-dirty` must sit on the `<form>` opening tag, and `src/main.tsx` must still be querying `form[data-dirty="true"]`. If either grep comes back empty, stop and fix it: this is the failure that costs a user their typed reply and their uploaded files, and nothing in typecheck, lint or the build will ever tell you about it.

- [ ] **Step 3: Typecheck and lint**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main" && npm run typecheck && npx eslint src/components/issues/SupportComposer.tsx src/hooks/useSupportTickets.ts
```

Both must exit 0. If typecheck reports an unknown prop at a `SupportComposer` call site, the call site is passing something this contract does not define; pass `canPostInternal`, `ticketStatus` and `onPosted` from the call site instead of widening the props.

- [ ] **Step 4: Commit**

```bash
git add src/components/issues/SupportComposer.tsx src/hooks/useSupportTickets.ts
git commit -m "feat(support): attach up to 3 images or PDFs to a support message"
```

---

### Task 35: Render attachments on a message in `SupportThread`

**Files:**
- Modify: `src/components/issues/SupportThread.tsx`

**Interfaces:**
- Consumes: `useSupportAttachmentUrls`, `isSupportImageAttachment`, `formatSupportFileSize` from `src/lib/supportAttachments`; type `SupportAttachment` from `src/hooks/useSupportTickets`
- Produces: attachments rendered inside every non-internal and internal message bubble on both `/support` and `/admin/issues`, since both surfaces mount this same component

- [ ] **Step 1: Add the imports**

Task 17 wrote this file with a namespace React import and it already imports `Paperclip`:

```tsx
import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, MessageSquare, Paperclip } from "lucide-react";
```

So: **do not add an `import { useState } from "react"` line.** A named import cannot merge into `import * as React from "react"`, and a second `react` import line beside it is noise; the component below uses `React.useState`. **Do not re-add `Paperclip` either**, it is already there and a second binding is a duplicate-identifier compile error.

The only change to the existing lines is widening the `lucide-react` one with the four new icons:

```tsx
import { AlertCircle, Download, ExternalLink, ImageOff, Loader2, MessageSquare, Paperclip } from "lucide-react";
```

Then add these two new import blocks below the existing `import { cn } from "@/lib/utils";` line:

```tsx
import {
  formatSupportFileSize,
  isSupportImageAttachment,
  useSupportAttachmentUrls,
} from "@/lib/supportAttachments";
import type { SupportAttachment } from "@/hooks/useSupportTickets";
```

`SupportMessage` is already imported from `@/hooks/useSupportTickets` in Task 17's block; add `SupportAttachment` as the separate `import type` line above rather than reshaping that block, since Task 17's is a value import with a `type` modifier on one member.

- [ ] **Step 2: Add the attachment renderer above `ThreadMessage`**

Paste this component definition immediately above Task 17's `function ThreadMessage({ message }: { message: SupportMessage })` declaration, which is where Step 3 mounts it:

```tsx
/**
 * Attachments on one message.
 *
 * Signed in ONE batched storage call per message, at 300s, re-signed at 240s so
 * a thread left open on a phone never renders a dead image. Storage RLS is the
 * gate: the bucket policy resolves the first path segment back to the ticket
 * and runs can_access_support_ticket() on it, so there is nothing to check here.
 *
 * The error branch renders BEFORE the loading branch and before anything that
 * could read as "no attachments". A failed sign must never look like a message
 * that had no files.
 */
function SupportMessageAttachments({
  attachments,
}: {
  attachments: SupportAttachment[];
}) {
  const [broken, setBroken] = React.useState<Record<string, boolean>>({});
  const { data, isLoading, isError } = useSupportAttachmentUrls(
    attachments,
    attachments.length > 0,
  );

  if (attachments.length === 0) return null;

  if (isError) {
    return (
      <p className="mt-2 text-xs text-ink-600">
        Couldn't load the {attachments.length === 1 ? "attachment" : "attachments"} on
        this message. Close and reopen the request to retry.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-500">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Loading attachments
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {attachments.map((a) => {
        const url = data?.[a.path] ?? null;
        const isImage = isSupportImageAttachment(a);

        if (isImage && url && !broken[a.path]) {
          return (
            <li key={a.path} className="space-y-1">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-card border border-surface-stroke"
              >
                <img
                  src={url}
                  alt={a.name}
                  loading="lazy"
                  onError={() =>
                    setBroken((prev) => ({ ...prev, [a.path]: true }))
                  }
                  className="h-auto max-h-64 w-full bg-surface-stroke/30 object-contain"
                />
              </a>
              <div className="flex items-center gap-2 px-1 text-xs text-ink-500">
                <span className="truncate">{a.name}</span>
                <span className="shrink-0">{formatSupportFileSize(a.size)}</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-brand-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open
                </a>
              </div>
            </li>
          );
        }

        return (
          <li key={a.path}>
            <a
              href={url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!url}
              className={`flex items-center gap-2 rounded-lg bg-surface-stroke/40 px-3 py-2 text-sm transition-colors duration-200 ${
                url
                  ? "text-brand-primary hover:bg-surface-stroke/70"
                  : "pointer-events-none text-ink-500"
              }`}
            >
              {isImage && broken[a.path] ? (
                <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
              ) : url ? (
                <Download className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <span className="truncate">{a.name}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-500">
                {formatSupportFileSize(a.size)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: REPLACE the placeholder list inside `ThreadMessage`**

This is a replacement, not an insertion. Task 17's `ThreadMessage` already renders attachments as a static filename list. Leaving it in place beside the new renderer would print every filename twice, once as plain text and once inside the new block.

In `function ThreadMessage`, immediately after the body paragraph:

```tsx
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-900">
          {message.body}
        </p>
```

delete this entire block, exactly as Task 17 wrote it:

```tsx
        {message.attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {message.attachments.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-1.5 text-xs text-ink-500"
              >
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate">{file.name}</span>
              </li>
            ))}
          </ul>
        )}
```

and put this in its place, in the same position, still inside the bubble `<div>` so the images inherit the bubble width and still above the `<p className="mt-1 text-[11px] text-ink-400">{when}</p>` timestamp:

```tsx
        {message.kind === "message" && message.attachments.length > 0 && (
          <SupportMessageAttachments attachments={message.attachments} />
        )}
```

`message` is the right identifier here: `ThreadMessage` takes a single `message` prop, and the `.map(` in `SupportThread` only ever renders `<ThreadMessage key={message.id} message={message} />`, so there is no body element inside that map to attach anything to.

The `kind === "message"` guard keeps system rows, which are centred muted single lines rather than bubbles, from ever growing an attachment list. `Paperclip` stays imported: the new renderer uses it for the not-yet-signed fallback row.

Confirm there is exactly one attachment renderer left:

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "message.attachments" src/components/issues/SupportThread.tsx
```

Expect exactly two lines, both on the single `SupportMessageAttachments` mount (the `.length > 0` guard and the prop). If a `message.attachments.map(` line is still there, the old list was not deleted and every filename renders twice.

- [ ] **Step 4: Verify the whole phase**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main" && npm run typecheck && npx eslint src/components/issues/SupportThread.tsx src/components/issues/SupportComposer.tsx src/lib/supportAttachments.ts && npx vite build
```

All three must exit 0. Bundle-size warnings above 500 kB are not failures. Never silence a lint error with `// eslint-disable-next-line` or `as any`.

- [ ] **Step 5: Manual pass**

Run the dev server, then, at a 375px viewport and again in dark mode:

1. As a student, open `/support`, open a ticket, attach one PNG and one PDF, send. The PNG renders inline in the bubble, the PDF renders as a download row, and both open in a new tab.
2. Attach a fourth file: the toast says at most 3 files and the fourth is dropped, not uploaded.
3. Attach a `.mp4` renamed to `.png`: the browser reports `video/mp4`, the type check refuses it, and nothing uploads.
4. As a super admin on `/admin/issues`, open the same ticket. The reporter's attachments are visible. Post an internal note with an attachment: it appears for the super admin and, after reloading `/support` as the student, is absent there, because `get_support_thread` omits internal rows for a reporter.
5. Sign in as a different school's user and paste one of the signed URLs after 5 minutes: it 403s, and the object is unreachable without a fresh sign, which `can_access_support_ticket` denies for a non-participant.

- [ ] **Step 6: Commit**

```bash
git add src/components/issues/SupportThread.tsx
git commit -m "feat(support): render message attachments inline in the support thread"
```

---

## Phase 7 - Transcript PDF

### Task 36: Transcript PDF builder (`src/lib/supportTranscript.ts`)

**Files:**
- Create: `src/lib/supportTranscript.ts`

**Interfaces:**
- Consumes: `public.get_support_ticket_transcript(p_ticket_id uuid) RETURNS jsonb` (Phase 2), types `SupportTicket`, `SupportMessage`, `SupportAttachment` from `src/hooks/useSupportTickets.ts` (Phase 3), `supabase` from `src/integrations/supabase/client`
- Produces: `downloadSupportTranscript(ticketId: string): Promise<void>`, `SupportTranscript` type

- [ ] **Step 1: Confirm jsPDF is present and is NOT accompanied by jspdf-autotable**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n '"jspdf"' package.json
grep -n 'jspdf-autotable' package.json || echo "OK: jspdf-autotable is absent, do not import it"
```

Expected: `"jspdf": "^2.5.2"` in both `dependencies` and the overrides block, and the second grep prints the OK line. The whole document below is laid out by hand with `splitTextToSize` plus a manual y-cursor, precisely because autotable is not available.

- [ ] **Step 2: Confirm the RPC exists in prod and returns the expected shape**

Write `C:\Users\tusha\AppData\Local\Temp\claude\scratch-transcript-check.sql`:

```sql
SELECT
  p.proname,
  pg_get_function_result(p.oid)     AS returns,
  pg_get_function_arguments(p.oid)  AS args,
  p.proacl::text                    AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_support_ticket_transcript';
```

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
powershell -File scripts/run-sql.ps1 -SqlFile "C:\Users\tusha\AppData\Local\Temp\claude\scratch-transcript-check.sql" -OutFile "C:\Users\tusha\AppData\Local\Temp\claude\scratch-transcript-check.json"
```

Read the result file with encoding `utf-8-sig`. Expected: one row, `returns` = `jsonb`, `args` = `p_ticket_id uuid`, and `acl` containing NO `=X/postgres` entry and no `anon=X`. If the row is missing, Phase 2 has not been applied to prod and this phase cannot be verified end to end; stop and apply Phase 2 first.

- [ ] **Step 3: Create the transcript module**

Create `src/lib/supportTranscript.ts` with exactly this content:

```ts
import { format } from "date-fns";
import type { jsPDF } from "jspdf";

import { supabase } from "@/integrations/supabase/client";
import type { SupportMessage, SupportTicket } from "@/hooks/useSupportTickets";

/**
 * Per-ticket support transcript PDF (super admin only).
 *
 * Laid out by hand: `jspdf-autotable` is NOT a dependency of this repo and must
 * not be added. Every block runs through `ensureSpace()` before it draws, which
 * is the only page-break mechanism here.
 *
 * jsPDF is imported lazily inside `downloadSupportTranscript` so the ~350 kB
 * library never lands in the admin chunk until somebody actually exports.
 */

export interface SupportTranscript {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

/** A4 portrait, millimetres. */
const PAGE = {
  width: 210,
  height: 297,
  marginX: 16,
  top: 18,
  bottom: 16,
} as const;

const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;
const LABEL_WIDTH = 40;
const LINE = 5;

/** Greyscale levels, passed to setTextColor as a single channel. */
const INK = { heading: 25, body: 65, muted: 125 } as const;
/** --brand-primary #249ca2 as RGB. */
const ACCENT: [number, number, number] = [36, 156, 162];
/** Deliberately loud so an internal note can never read as a public reply. */
const INTERNAL_RGB: [number, number, number] = [180, 60, 20];

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

const URGENCY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

const SIDE_LABELS: Record<string, string> = {
  reporter: "Reporter",
  salci: "SALCI",
  system: "System",
};

/**
 * jsPDF's built-in fonts are WinAnsi, so anything outside Latin-1 renders as
 * garbage. Fold the common typographic characters down, then drop the rest.
 * Done with a code-point loop rather than a negated regex class so no control
 * character ever appears in a pattern literal (no-control-regex).
 */
function sanitize(value: string): string {
  const folded = value
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  let out = "";
  for (const ch of folded) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += ch;
    } else {
      out += " ";
    }
  }
  return out;
}

function stamp(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return format(parsed, "d MMM yyyy, h:mm a");
}

interface Cursor {
  y: number;
}

/** The page-break check. Every draw call goes through this first. */
function ensureSpace(doc: jsPDF, cur: Cursor, needed: number): void {
  if (cur.y + needed > PAGE.height - PAGE.bottom) {
    doc.addPage();
    cur.y = PAGE.top;
  }
}

function rule(doc: jsPDF, cur: Cursor): void {
  ensureSpace(doc, cur, 4);
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
  doc.line(PAGE.marginX, cur.y, PAGE.width - PAGE.marginX, cur.y);
  cur.y += 5;
}

function writeHeading(doc: jsPDF, cur: Cursor, text: string): void {
  ensureSpace(doc, cur, 12);
  cur.y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ACCENT);
  doc.text(sanitize(text), PAGE.marginX, cur.y);
  cur.y += 6;
}

interface ParagraphOptions {
  size?: number;
  style?: "normal" | "bold" | "italic";
  color?: number | [number, number, number];
  indent?: number;
}

function writeParagraph(
  doc: jsPDF,
  cur: Cursor,
  text: string,
  options: ParagraphOptions = {},
): void {
  const size = options.size ?? 10;
  const style = options.style ?? "normal";
  const indent = options.indent ?? 0;
  const lineHeight = size <= 9 ? 4.4 : LINE;

  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  if (Array.isArray(options.color)) {
    doc.setTextColor(...options.color);
  } else {
    doc.setTextColor(options.color ?? INK.body);
  }

  const lines: string[] = doc.splitTextToSize(sanitize(text), CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(doc, cur, lineHeight);
    doc.text(line, PAGE.marginX + indent, cur.y);
    cur.y += lineHeight;
  }
}

function writeField(doc: jsPDF, cur: Cursor, label: string, value: string): void {
  const lines: string[] = doc.splitTextToSize(sanitize(value), CONTENT_WIDTH - LABEL_WIDTH);
  ensureSpace(doc, cur, Math.max(1, lines.length) * LINE);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INK.muted);
  doc.text(sanitize(label), PAGE.marginX, cur.y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(INK.body);
  lines.forEach((line, index) => {
    doc.text(line, PAGE.marginX + LABEL_WIDTH, cur.y + index * LINE);
  });

  cur.y += Math.max(1, lines.length) * LINE;
}

function writeFooters(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(INK.muted);
    doc.text("SALCI Support, confidential", PAGE.marginX, PAGE.height - 8);
    doc.text(`Page ${page} of ${total}`, PAGE.width - PAGE.marginX, PAGE.height - 8, {
      align: "right",
    });
  }
}

function renderTranscript(doc: jsPDF, transcript: SupportTranscript): void {
  const ticket = transcript.ticket;
  const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
  const cur: Cursor = { y: PAGE.top };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...ACCENT);
  doc.text("SALCI Support Transcript", PAGE.marginX, cur.y);
  cur.y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(INK.muted);
  doc.text(`Generated ${stamp(new Date().toISOString())}`, PAGE.marginX, cur.y);
  cur.y += 5;

  rule(doc, cur);

  writeParagraph(doc, cur, ticket.subject || "Untitled request", {
    size: 13,
    style: "bold",
    color: INK.heading,
  });
  cur.y += 2;

  const priority = typeof ticket.priority === "number" ? ticket.priority : null;
  const fields: Array<[string, string]> = [
    ["Ticket ID", ticket.id],
    ["Status", STATUS_LABELS[ticket.status] ?? ticket.status],
    ["Reporter", ticket.reporter_name || "Unknown"],
    ["Email", ticket.reporter_email || "N/A"],
    ["Role", (ticket.reporter_role || "N/A").replace(/_/g, " ")],
    ["School", ticket.institution_name || "N/A"],
    ["Category", ticket.category || "N/A"],
    ["Urgency", priority === null ? "N/A" : URGENCY_LABELS[priority] ?? String(priority)],
    ["Raised at", stamp(ticket.created_at)],
    ["First response at", stamp(ticket.first_response_at)],
    ["Resolved at", stamp(ticket.resolved_at)],
    ["Last activity", stamp(ticket.last_message_at)],
  ];
  for (const [label, value] of fields) {
    writeField(doc, cur, label, value);
  }

  writeHeading(doc, cur, "What they reported");
  writeParagraph(doc, cur, ticket.description || "No description was provided.");

  writeHeading(doc, cur, "Status timeline");
  const systemRows = messages.filter((m) => m.kind === "system");
  if (systemRows.length === 0) {
    writeParagraph(doc, cur, "No status changes were recorded on this ticket.", {
      size: 9,
      color: INK.muted,
    });
  } else {
    for (const row of systemRows) {
      writeParagraph(doc, cur, `${stamp(row.created_at)}   ${row.body}`, {
        size: 9,
        color: INK.body,
      });
    }
  }

  writeHeading(doc, cur, "Conversation");
  const conversation = messages.filter((m) => m.kind !== "system");
  if (conversation.length === 0) {
    writeParagraph(doc, cur, "No replies were posted on this ticket.", {
      size: 9,
      color: INK.muted,
    });
  }

  for (const message of conversation) {
    ensureSpace(doc, cur, 16);
    cur.y += 2;

    const side = SIDE_LABELS[message.author_side] ?? message.author_side;
    const who = message.author_name || (message.author_side === "salci" ? "SALCI Support" : "Unknown");
    writeParagraph(doc, cur, `${who} (${side})   ${stamp(message.created_at)}`, {
      size: 9,
      style: "bold",
      color: INK.heading,
    });

    if (message.is_internal) {
      writeParagraph(doc, cur, "INTERNAL - not visible to the reporter", {
        size: 9,
        style: "bold",
        color: INTERNAL_RGB,
      });
    }

    writeParagraph(doc, cur, message.body || "(no text)", { size: 10, indent: 3 });

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    if (attachments.length > 0) {
      const names = attachments.map((a) => a.name || "attachment").join(", ");
      writeParagraph(doc, cur, `Attachments: ${names}`, {
        size: 9,
        style: "italic",
        color: INK.muted,
        indent: 3,
      });
    }

    cur.y += 2;
    rule(doc, cur);
  }

  writeFooters(doc);
}

/**
 * Busy guard: a second click on the same ticket while the first export is still
 * fetching or rendering resolves immediately instead of producing two files.
 * The component keeps its own `isExporting` state for the button, this is the
 * backstop that survives a remount.
 */
const inFlight = new Set<string>();

export async function downloadSupportTranscript(ticketId: string): Promise<void> {
  if (inFlight.has(ticketId)) return;
  inFlight.add(ticketId);

  try {
    const { data, error } = await supabase.rpc("get_support_ticket_transcript", {
      p_ticket_id: ticketId,
    });
    if (error) throw error;

    const transcript = data as unknown as SupportTranscript | null;
    if (!transcript || !transcript.ticket) {
      throw new Error("This ticket could not be loaded, so no transcript was created.");
    }

    const { jsPDF: JsPdf } = await import("jspdf");
    const doc = new JsPdf({ unit: "mm", format: "a4", orientation: "portrait" });
    renderTranscript(doc, transcript);
    doc.save(`salci-support-${ticketId.slice(0, 8)}.pdf`);
  } finally {
    inFlight.delete(ticketId);
  }
}
```

- [ ] **Step 4: Prove there are no em-dashes and no forbidden imports in the new file**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n $'\u2014' src/lib/supportTranscript.ts || echo "OK: no em-dashes"
grep -n "autotable" src/lib/supportTranscript.ts || echo "OK: no autotable"
grep -n "as any" src/lib/supportTranscript.ts || echo "OK: no any"
```

All three must print their OK line.

- [ ] **Step 5: Typecheck, lint and build**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/lib/supportTranscript.ts
npx vite build
```

All three must exit 0. If `supabase.rpc("get_support_ticket_transcript", ...)` is a type error, `src/integrations/supabase/types.ts` was not regenerated after Phase 2. Regenerate it, do not cast the call:

```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/supportTranscript.ts
git commit -m "feat(support): per-ticket transcript PDF builder"
```

---

### Task 37: Export action in `IssueDetailSheet`, super admin only

**Files:**
- Modify: `src/components/issues/IssueDetailSheet.tsx`

**Interfaces:**
- Consumes: `downloadSupportTranscript` from `src/lib/supportTranscript.ts` (Task 36), `useUserRole` from `src/hooks/useUserRole.ts`, `toastError` from `src/lib/toast.ts`, `Button` from `src/components/ui/button`
- Produces: nothing new; this is the only entry point to the transcript

Note on line numbers: Phase 4 and Phase 6 already rewrote this file (thread, composer, internal-note toggle, attachment viewer), so anchor on the quoted strings below rather than on line numbers.

- [ ] **Step 1: Add the four imports**

At the top of `src/components/issues/IssueDetailSheet.tsx`, extend the existing `lucide-react` import to include `Download` and `Loader2`, and add the three module imports. After the edit the import block must contain these lines (keep whatever else Phases 4 and 6 added):

```tsx
import { Download, LifeBuoy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUserRole } from "@/hooks/useUserRole";
import { toastError } from "@/lib/toast";
```

If `ExternalLink` is still in the lucide import, leave it; Phase 4 removes the Linked task button, so it may already be gone.

- [ ] **Step 2: Add the export state and handler inside the component**

Inside `export function IssueDetailSheet({ ... })`, immediately after the existing hook calls and **above** the `if (!issue) return null;` early return (React hooks must not sit below a conditional return), insert:

```tsx
  const { data: roleInfo } = useUserRole();
  const canExportTranscript = !!roleInfo?.isSuperAdmin;
  const [isExporting, setIsExporting] = React.useState(false);

  // Busy guard: jsPDF is a lazy ~350 kB import, so a double-click would
  // otherwise start two downloads. `supportTranscript` holds a second,
  // remount-proof guard keyed on the ticket id.
  const handleExportTranscript = React.useCallback(async () => {
    if (!issue || isExporting) return;
    setIsExporting(true);
    try {
      const { downloadSupportTranscript } = await import("@/lib/supportTranscript");
      await downloadSupportTranscript(issue.id);
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't build the transcript. Please try again.",
        context: "supportTranscript",
      });
    } finally {
      setIsExporting(false);
    }
  }, [issue, isExporting]);
```

- [ ] **Step 3: Render the button in the status chip row**

Find the chip row that opens the sheet body:

```tsx
        <div className="flex flex-wrap items-center gap-2">
```

It contains the status `Badge`. Insert the block below as the **last child of that div**, after the badge (and after whatever chip Phase 4 left in place):

```tsx
          {canExportTranscript && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportTranscript}
              disabled={isExporting}
              className="ml-auto gap-1.5"
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isExporting ? "Preparing PDF" : "Export transcript"}
            </Button>
          )}
```

`ml-auto` pushes it to the right edge on wide viewports and wraps below the badge at 375px, since the row is `flex-wrap`. No inline styles, shadcn `Button` only, tone comes from the `outline` variant so it flips with the theme.

- [ ] **Step 4: Verify the guard is real, not just visual**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
grep -n "canExportTranscript" src/components/issues/IssueDetailSheet.tsx
grep -n $'\u2014' src/components/issues/IssueDetailSheet.tsx || echo "OK: no em-dashes"
```

Expected: three `canExportTranscript` hits (declaration, guard on the JSX) and the no-em-dashes line. The server-side guard is `get_support_ticket_transcript`, which is super admin only per Phase 2; this button hides the affordance, the RPC refuses the call.

- [ ] **Step 5: Typecheck, lint and build**

```bash
cd "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main"
npm run typecheck
npx eslint src/components/issues/IssueDetailSheet.tsx src/lib/supportTranscript.ts
npx vite build
```

All three must exit 0. In the `vite build` output, confirm a separate `jspdf` chunk exists and that the entry chunk did not grow: the import is dynamic, so jsPDF must not appear in the entry bundle.

- [ ] **Step 6: Manual pass**

Run `npm run dev`, sign in as a super admin, open `/admin/issues`, open any ticket, and click Export transcript. Confirm:
1. The file saves as `salci-support-<first 8 chars of the ticket id>.pdf`.
2. Page 1 shows subject, ticket id, status, reporter name / email / role / school, category, urgency, raised at, first response at, resolved at, last activity.
3. The status timeline lists the `kind='system'` rows.
4. Every internal note carries the line `INTERNAL - not visible to the reporter` above its body.
5. Attachment filenames appear under their message.
6. Open a ticket with a long thread and confirm the content breaks cleanly across pages with `Page N of M` in every footer and no text drawn over the footer.
7. Double-click the button and confirm exactly one file is produced.
8. Repeat the sheet open at a 375px viewport and in dark mode: the button wraps and its tone flips.

- [ ] **Step 7: Commit**

```bash
git add src/components/issues/IssueDetailSheet.tsx
git commit -m "feat(support): export a ticket transcript PDF from the inbox, super admin only"
```
