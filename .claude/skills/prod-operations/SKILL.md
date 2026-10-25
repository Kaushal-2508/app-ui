---
name: prod-operations
description: Operating SALCI's production database and deploys — running prod SQL via the Supabase Management API, why the migration ledger cannot be trusted, RLS and grant landmines (anon EXECUTE, UPDATE policies without WITH CHECK, security_invoker views), error-log triage, bulk auth writes, the deploy pipeline across two frontends and three projects, and the standing audit debt. Use when applying SQL to prod, verifying a migration landed, diagnosing prod errors or slowness, writing or auditing an RLS policy or SECURITY DEFINER function, resetting passwords in bulk, or reasoning about what a deploy actually reaches.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, PowerShell
---

# Prod & DB Operations

## 1. Running SQL against prod

**The Supabase CLI is not the path.** Use the Management API through the repo helper:

```powershell
# write your SQL to a file first, then:
powershell -File scripts/run-sql.ps1 -SqlFile scripts/my-query.sql -OutFile "$env:TEMP\out.json"
```

[scripts/run-sql.ps1](../../../scripts/run-sql.ps1) POSTs to `https://api.supabase.com/v1/projects/<ref>/database/query` (default ref `gyymkgohcijeksmrzuyw`). Mechanics that exist for a reason:

* **The PAT lives in Windows Credential Manager** under target `Supabase CLI:supabase`, stored as a **UTF-8 blob**, read via a P/Invoke `CredRead`. `Get-StoredCredential`-style helpers mangle it.
* **The body is built with `JavaScriptSerializer`, not `ConvertTo-Json`** — `ConvertTo-Json` mangles SQL strings.
* **The body is POSTed as UTF-8 bytes.** PowerShell 5.1's `Invoke-RestMethod` encodes string bodies as Latin-1 and silently corrupts any non-ASCII SQL (this bit the Olympiad result-PDF work). Always pass bytes.
* Results land in a JSON file, not the console. **Read the file** when a number matters — piping large CLI JSON through the terminal garbles Unicode.
* **`REINDEX CONCURRENTLY` and anything else that cannot run inside a transaction block will fail through this endpoint** — the endpoint wraps statements. See the "HOW TO RUN" notes in [scripts/fix-collation-mismatch.sql](../../../scripts/fix-collation-mismatch.sql).

## 2. The migration ledger is stale — verify against the catalog

**`supabase_migrations.schema_migrations` is NOT maintained in this project.** A migration file in `supabase/migrations/` may or may not be applied to prod, and the ledger will not tell you. Never conclude "it's applied" from the ledger or from the file's existence.

Verify against the actual catalog:

| Question | Where to look |
|---|---|
| Does this function exist, and with what body/ACL? | `pg_proc` (`prosrc`, `proacl`), `information_schema.routines` |
| Does this column/table exist? | `information_schema.columns` / `.tables` |
| Does this index exist? | **`pg_indexes`** |
| Does this constraint exist? | `pg_constraint` — **but see below** |
| What policies are on this table? | `pg_policies` |

**A unique INDEX is invisible to `pg_constraint`.** Check `pg_indexes` before concluding "there is no unique constraint, so `ON CONFLICT` is impossible". To validate a conflict target cheaply, probe it with a `WHERE false` statement:

```sql
INSERT INTO t (a, b) SELECT a, b FROM t WHERE false ON CONFLICT (a, b) DO NOTHING;
```

It compiles the conflict target without writing anything, so a bad target errors immediately.

Also: **`classes` has no unique key**, so a blind retry of a `classes` insert duplicates sections. Check before re-running any script that touches it.

## 3. Grants — `anon` gets EXECUTE on everything you create

Supabase's `ALTER DEFAULT PRIVILEGES` grants `EXECUTE` to `anon` on **every** new function in `public`, and **`REVOKE ... FROM PUBLIC` does NOT remove that explicit grant.** Every new SECURITY DEFINER RPC needs both, by name:

```sql
REVOKE EXECUTE ON FUNCTION public.fn(argtypes) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn(argtypes) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn(argtypes) TO authenticated, service_role;
```

**Verify with `pg_proc.proacl`, not `information_schema.routine_privileges`** — the latter does not expand PUBLIC. A leading `=X/postgres` entry in `proacl` means PUBLIC still holds EXECUTE. (The 20260814150000 support post-mortem proved each revoke alone is insufficient.)

Also make every DEFINER function **authenticate the caller, not just the argument.** An RPC that takes `_student uuid` and trusts it lets any authenticated user pass someone else's id — `student_band_resolution` and `band_slot_batches` still have that shape (audit S-1). Guard on `auth.uid()` and **fail closed on NULL**: `NULL <> _x` is NULL, and `IF NULL` skips the block, so a caller guard without an explicit NULL branch passes anonymously (the `teacher_roster_student_ids` bug, fixed 2026-08-25).

## 4. RLS landmines

* **Every UPDATE policy needs BOTH `USING` and `WITH CHECK`.** A missing `WITH CHECK` silently rejects the write. This class of bug rejected **100% of teachers' offline-marks saves for two days** via `final_results` (2026-08-25, fixes `fe181af` + `dd4706f` which swept every UPDATE policy for the same shape). Audit any UPDATE policy you touch for it.
* **A PostgREST write blocked by RLS returns success-shaped output** — empty data, no error. So a blocked save shows a green toast. For permission-sensitive writes and deletes, re-SELECT and treat "row gone / row changed" as the only success signal (CLAUDE.md §6).
* **Views that gate on the caller must stay `security_invoker=on`.** `student_eligible_exams`, `v_class_groups_with_sections` and `v_subject_class_mappings_unified` were flipped on 2026-06-20; a `SECURITY DEFINER` view evaluates RLS as its owner and leaks across tenants.
* **RLS policies call SECURITY DEFINER helpers only** — an inline cross-table `EXISTS` on a table whose own policy references the first table raises `42P17` recursion. Wrap stable per-row calls as `(select auth.uid())` so the planner hoists them (CLAUDE.md §23).
* **New columns referencing `profiles(id)` always declare `ON DELETE`** (CLAUDE.md §21). That is necessary, not sufficient: a SET NULL cascade is an UPDATE that trips BEFORE UPDATE guards, and an FK two hops down (via `student_exam_attempts`) blocks just as hard. After any migration that adds a table, FK or guard trigger, run `scripts/probe-user-delete-blockers.sql` and `scripts/probe-user-deletes.sql` (a rolled-back real delete of every account; the only way to see the actual Postgres error, since GoTrue reports every failure as "Database error deleting user").
* **User deletes are archived** (`dua`, CLAUDE.md §31). After a migration that adds a table, FK or sensitive-looking column, run `scripts/dua/test-capture.sql` and `SELECT * FROM dua.unclassified_sensitive_columns()` (must be empty). A capture error is recorded as `capture_failed` in `best_effort` mode and will BLOCK the delete once `dua.settings.capture_mode` is `required`. Probe batches through the Management API must stay at about 40 accounts: the API session has a 2 min statement_timeout and capture adds about 1.3 s per account.
* A broad `profiles` UPDATE policy is not a licence to add sensitive columns to `profiles` — four such policies exist, and any new column needs its own trigger-level guard if it must be narrower (see `profile-photos` skill for the worked example).

## 5. Error-log and slowness triage

**Grouped-error recipe.** Pull prod logs through the Management API analytics endpoint and group by message before reading anything, or the volume is meaningless. Two findings that recur:

* **~95% of logged "problems" are ONE benign warning per connection:** `database "postgres" has a collation version mismatch`. Verified 2026-08-10 — Supabase platform maintenance bumped glibc 2.39 → 2.40 and ICU underneath the database, so `pg_database.datcollversion` (153.120) disagrees with `pg_database_collation_actual_version()` (153.121). It drags the dashboard Success Rate to ~76% while nothing is actually failing. Remedy and the safe procedure are in [scripts/fix-collation-mismatch.sql](../../../scripts/fix-collation-mismatch.sql) — **do not run it blindly through `/database/query`**, `REINDEX CONCURRENTLY` cannot run in a transaction block. The real risk it addresses is btree indexes on text columns built under the old collation (missed rows on index scans, unique constraints failing to catch duplicates).
* **Statement timeouts** are usually the second-largest group and usually mean §6 below, not a missing index.

**Slowness, in the order it has actually been the cause** ([docs/slowness-diagnosis-2026-07-07.md](../../../docs/slowness-diagnosis-2026-07-07.md)):
1. **Stale planner statistics.** `question_bank` had 98,783 real rows against 89 planned, producing catastrophic plans. `ANALYZE` the table and check `autoanalyze` thresholds before touching indexes or queries.
2. **Bare `auth.uid()` in RLS** — 1,383 occurrences. Each is re-evaluated per row; wrap as `(select auth.uid())`.
3. **Realtime** consumed 77 minutes of DB time. Prefer `refetchInterval: 60_000` over a subscription (CLAUDE.md §23).

## 6. Bulk auth writes

Passwords can be set directly by writing a pgcrypto hash into `auth.users.encrypted_password`:

```sql
UPDATE auth.users SET encrypted_password = extensions.crypt(:pw, extensions.gen_salt('bf', 10)) WHERE id = :id;
```

Note `extensions.` schema-qualification (pgcrypto is not in `public`), and **also sync the gating columns on `profiles`** (`must_reset_password`, `last_password_change`, `password_expires_at`) or the user lands in the forced-reset loop. Always snapshot into `salci_backups.*` first — e.g. `salci_backups.student_pw_ais_20260603` for the 1,433-student Alliance reset.

**`salci_backups` is the house convention for any destructive prod change**: create the snapshot table in the same migration/script, `REVOKE ALL` on the schema and table from `anon` and `authenticated`, and write the rollback statement into a comment. Existing manifests include `qb_early_years_diff5`, `reported_issues_pre_messages_20260831`, `soe_classification_20260730`, `oly_demo_seed_nfd`.

## 7. What a deploy actually reaches

* **Two production frontends share ONE Supabase project** (`gyymkgohcijeksmrzuyw`): **app.salci.ai / salci.org** (school portal, one Vercel build on both domains; app.salci.ai is primary since 2026-10-01) and **salci.sale** (LMS). Never hardcode either domain in shared code, and never narrow a CORS or origin allow-list to one — pass `window.location.origin` and validate it against a secret allowlist (the `SUPPORT_APP_ORIGINS` pattern). Note this also means every LMS login is Postgres role `authenticated` on the school portal's tables, which is why a `USING true` policy on an LMS table is a cross-system PII leak (audit C4).
* **Two entirely separate repos/projects exist and this repo's changes do NOT reach them:** the standalone Olympiad platform (own repo, project `uqbljlsxusdiffhzpxda`, olympiad.salci.ai, live 2026-07-11) and the standalone LMS "SALCI House" (project `zravthajuvcfzjnwarvt`, repo `harmony-ops`). Do not assume a shared fix propagates.
* **Vercel skips docs-only pushes on purpose.** `vercel.json` `ignoreCommand` runs [scripts/vercel-ignore-build.sh](../../../scripts/vercel-ignore-build.sh), which skips a push only when nothing outside `docs/`, `.claude/`, `supabase/` or `scripts/` changed since the **last successful deployment** (`VERCEL_GIT_PREVIOUS_SHA`). Every build stamps a new `sw.js`, which reloads every open tab. The first version compared only `HEAD^..HEAD`, so a push ending in a docs-only merge (4fe8ee77, 2026-10-05) stranded the app commits under it, and prod stayed on the 10-01 build for a day while Vercel showed nothing wrong. A skipped deployment shows as CANCELED, not failed. **To see what is really live**, decode the build time: `new Date(parseInt(<first part of the salci-… id in /sw.js>, 36))`. **To force a rebuild** (for example after changing a `VITE_*` env var), Redeploy the newest READY deployment, or untick "Use project's Ignore Build Step" in the Redeploy dialog.
* **Lovable can push to `main`** as `lovable-dev[bot]` even after the preview is unpublished. Unexplained commits on `main` are usually that, not a rogue actor. The GitHub integration is separate from the Supabase one.
* **The portal (app.salci.ai and salci.org) is deliberately `noindex/nofollow`** since 2026-08-20 (meta tag + `X-Robots-Tag`, with an open `robots.txt`) so that salci.ai ranks instead. Do not "fix" the missing indexing.
* **Ship order:** a migration that DROPs or narrows a column must not land before the frontend that stops reading it (CLAUDE.md §2).
* **Edge functions must be deployed explicitly** — editing the file does nothing: `npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw`. Four edge functions edited in the 2026-07-07 perf batch were never deployed.

**Git push failures.** `could not read Username` is NOT an expired credential. Clear `GCM_INTERACTIVE` and `GIT_TERMINAL_PROMPT` **in the same tool call as the push** — env vars reset between calls. Commit as the local author (Kavach); Vercel build/permission oddities come from a second Vercel account having taken the GitHub link and are only fixable Vercel-side.

## 8. Per-user capability overrides

Four one-user grants exist that widen capability **without a role change**: `tt_manager_overrides`, `staff_manager_overrides`, `syllabus_manager_overrides`, `student_manager_overrides`. The pattern is: an override table keyed on `(user_id, institution_id)`, an `is_*()` SQL helper, a `useIs*` hook, and consumption at the gate. `admin-operations` reads the staff/student ones directly.

Both manager-override migrations carry a warning worth heeding: **their broad `profiles` UPDATE policy is only safe because "the app only ever sends `full_name` + `is_active` from this surface."** Any new sensitive column on `profiles` invalidates that assumption and needs its own guard.

## 9. Standing audit debt

Four audit files in `docs/`. **They are not kept updated — verify each item's current status in code or prod before acting on it, and update the file when you fix one.** Some are already fixed (e.g. the `reset_user_password` role gate, audit C1, now mirrors `update_user`).

[docs/security-audit-2026-07-07.md](../../../docs/security-audit-2026-07-07.md) — 18 confirmed exploitable (7 critical, 11 high), ~35 unverified medium/low. Two structural root causes dominate and are the shapes to look for in new code:
1. **Edge functions and RLS policies that check *a* role but never *ownership or institution scope*** — the IDOR family.
2. **Security controls enforced only in the React client** with the underlying table or RPC left open.

Named criticals worth knowing because their shape recurs: `USING true` / `WITH CHECK (true)` policies granted to `{public}` or `authenticated` (`teacher_effectiveness`, `passport_academic_records`, `passport_subject_capabilities`, `lms_lead_pocs`); the **public `answer-sheets` bucket** serving graded scans via non-expiring `getPublicUrl` (contrast the private + signed `hybrid-answer-sheets`); the **client-only exam timer** (`save_exam_answer` / `submit_exam_attempt` have no deadline predicate, and `get_attempt_remaining_time` / `should_auto_lock_attempt` have zero callers); and **`exam_questions` answer-key readability**, whose fix is staged at `supabase/migrations/20260707131000_exam_questions_student_rls_tighten.sql` — **confirm whether it is applied to prod before relying on either state.**

[docs/perf-audit-2026-07-07.md](../../../docs/perf-audit-2026-07-07.md) — 192 findings, top P0/P1 fixed. [docs/slowness-diagnosis-2026-07-07.md](../../../docs/slowness-diagnosis-2026-07-07.md) — see §5. [docs/optional-subjects-audit-2026-07-28.md](../../../docs/optional-subjects-audit-2026-07-28.md) — see `optional-subjects` skill. [docs/teacher-portal-audit-2026-08-18.md](../../../docs/teacher-portal-audit-2026-08-18.md) — see `teacher-authority-scope` skill.
