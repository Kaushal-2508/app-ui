# Deleted-user archive: design

Date: 2026-09-25. Owner: Tushar. Status: approved in chat (approach A), spec awaiting review.

## Goal

When an admin deletes a user, the person disappears from the live system exactly as today, but **every row the delete removes is first copied into an archive that only super admins can open**. A super admin can later look up any deleted user and see everything that was removed with them, plus which surviving records they had authored.

Success means all of the following:
1. No admin delete can remove a user without the archive being written in the same transaction. The two happen together or not at all.
2. The archive holds every row the delete removed. The delete function proves this on every run by comparing its archive against Postgres's own per-transaction counters, and records the result.
3. Only super admins can read the archive: no API exposure, no grants to `anon` / `authenticated`, and read functions that fail closed.
4. The live system after a delete is identical to today's, and the 3,402 of 3,403 accounts that are deletable today stay deletable.

## Decisions already made (chat, 2026-09-25)

| Question | Decision |
|---|---|
| View or restore? | View and download only. No restore. |
| Which deletes? | Every `admin-operations` delete: single `delete_user`, `bulk_delete_students`, and the users removed by `delete_institution`. |
| Excluded | `oly-dormancy-pass` day-60 purge (a deliberate PII wipe of non-SALCI Olympiad accounts), and the `oly-create-teacher` rollback (a brand-new account with nothing to keep). |
| Who can read it | Super admins. Today that is only team@salci.in. |
| Retention | Forever. No purge in v1. |
| Files | Storage objects are already left in their buckets on delete. The archive keeps their paths from the archived rows. Files are not copied. |
| Backfill | None. Users deleted before this ships (332 in the last 90 days, including Saganpreet Kaur) are gone. |
| Approach | A: snapshot, then delete, in one database transaction, walking the live FK graph at run time. |

## Why approach A

The delete cascade broke three times (2026-04-22, 09-11, 09-25), each time from a table or trigger nobody knew was on the path. Anything that relies on a hand-kept list of tables (per-table capture triggers, approach B) will miss the next new table the same way. A reads `pg_constraint` on every run, so a table added next month is archived with no code change. A single transaction also makes approach C's failure mode impossible: an archive without a delete, or a delete without an archive.

## Architecture

### 1. Storage: schema `deleted_user_archive`

A dedicated schema that is not in PostgREST's exposed schemas. `USAGE` and all table privileges are revoked from `PUBLIC`, `anon` and `authenticated`. So even if someone exposes the schema later, reads are still denied.

- **`deleted_user_archive.users`**: one row per deleted user (the header).
  - `id uuid pk`, `user_id uuid not null`. No FK, because the user is gone.
  - `email`, `full_name`, `roles text[]`, `institution_id uuid`, `institution_name text`. Copied, because the institution may be deleted too.
  - `deleted_at timestamptz default now()`, `deleted_by uuid`, `deleted_by_name text`, `source text` (`delete_user` | `bulk_delete_students` | `delete_institution`).
  - `row_counts jsonb`: `{table: n}` for rows removed.
  - `link_counts jsonb`: `{table.column: n}` for surviving rows whose link was cleared.
  - `observed jsonb`: the per-table deleted and updated counts from `pg_stat_xact_user_tables`.
  - `is_complete boolean`, `missing jsonb` (tables where observed ≠ archived), `total_rows int`.
  - Indexes on `deleted_at desc`, `user_id`, `institution_id`.
- **`deleted_user_archive.rows`**: `(archive_id → users ON DELETE CASCADE, table_name, row_count, rows jsonb)`, with primary key `(archive_id, table_name)`. The row images for one table are stored as one jsonb array. Postgres compresses large values automatically (TOAST), which keeps an archive to roughly 0.1 to 0.5 MB for a heavy student.
- **`deleted_user_archive.links`**: `(archive_id, table_name, column_name, references_table, row_count, row_ids jsonb)`, with primary key `(archive_id, table_name, column_name)`. These are surviving rows that pointed at something deleted and had that column set to NULL. Where `references_table` is `profiles` or `auth.users`, the row was **authored by** the deleted user (the 3,802 overrides and 118 exams in the 2026-09-25 measurement).

### 2. The delete: `public.delete_user_with_archive(_user_id uuid, _actor_id uuid, _source text) returns jsonb`

This is SECURITY DEFINER, owned by postgres, with `search_path=public`. EXECUTE goes to `service_role` only, revoked by name from `PUBLIC`, `anon` and `authenticated`. The edge function is the only caller, and it has already run its authorization checks. The function runs in one transaction:

1. **Guard.** The user must exist in `auth.users`, otherwise raise. Lock the user row with `FOR UPDATE`. Every row walked in step 3 is also locked `FOR UPDATE`, and inserting a child row needs a key-share lock on its parent, so no new rows can appear under the user between the snapshot and the delete.
2. **Record the counters.** Snapshot `pg_stat_xact_user_tables` (`n_tup_del`, `n_tup_upd`) for `public` and `auth`.
3. **Walk the cascade graph from `auth.users`.** Keep the walked rows in a temp table `(tbl oid, row jsonb)`. For every table that gained rows, and for each FK whose `confrelid` is that table:
   - `confdeltype = 'c'` (CASCADE): select the child rows `WHERE (child cols) IN (parent key values)` with `FOR UPDATE`. Casts use the column's real type, so the FK index is used. Add rows not already walked, and repeat until no table gains rows. Multi-column FKs use a row-value `IN` built from `conkey` / `confkey`.
   - `confdeltype IN ('n','d')` (SET NULL or DEFAULT): note the FK for step 5.
   - NO ACTION or RESTRICT: nothing to capture. If a live row blocks, the DELETE in step 4 raises and the whole transaction rolls back.
4. **Links, before the delete.** Once the column is NULL you can no longer tell which rows pointed at the user, so this must happen first. For each SET NULL FK found in step 3, record the child rows whose FK columns match a walked row, excluding rows that are themselves being deleted. Store their primary-key values, or only a count when the table has no primary key.
5. **Delete.** `DELETE FROM auth.users WHERE id = _user_id`. This is the same statement and cascade that GoTrue runs, and the same one the probes ran on every account.
6. **Verify.** Read the counters again.
   - **Deletes:** for each table, compare the `n_tup_del` delta with the archived row count. `is_complete` is true only when every table matches; mismatches go into `missing`.
   - **Updates:** the `n_tup_upd` delta is compared with the link count and recorded in `observed`, but does not affect `is_complete`, because unrelated triggers can legitimately update rows too.
   - **A mismatch flags the archive; it does not block the delete.** The likeliest cause is a trigger deleting derived rows outside the FK graph (none exist on the path today), and blocking would reopen the "users can't be deleted" problem. The flag shows in the UI and in the audit row.
7. **Write** the header, row images and links. Return `{archive_id, total_rows, is_complete}`.

**Sensitive data is never archived.** From `auth.users`, the password hash and every token column are dropped: `encrypted_password`, `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `phone_change_token`, `reauthentication_token`. The session and credential tables (`auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors`, `auth.mfa_challenges`, `auth.mfa_amr_claims`, `auth.one_time_tokens`, `auth.flow_state`) are recorded as counts only. This list is a constant in the function.

**Limits:**
- Statement timeout is 8s (inherited from `authenticator`). The heaviest student today is about 2,200 rows across ~25 tables, a few hundred indexed lookups, well under a second.
- `pg-safeupdate` is preloaded, so every UPDATE or DELETE in the function carries a WHERE clause.

### 3. Reading: four super-admin RPCs in `public`

All four are SECURITY DEFINER. Each first checks `public.is_super_admin((select auth.uid()))` and raises 42501 otherwise, failing closed on a NULL uid. EXECUTE is revoked from `PUBLIC` and `anon` and granted to `authenticated`, so the check inside is the only gate.

| RPC | Returns |
|---|---|
| `archive_deleted_users(_search text, _limit int, _offset int)` | `{total, rows[]}`, counted server-side. `_limit` is capped at 50. Search is ILIKE on name, email and school. |
| `archive_deleted_user(_archive_id uuid)` | The header plus per-table counts (with a count-only flag) and link counts. |
| `archive_deleted_user_rows(_archive_id uuid, _table text, _limit int, _offset int)` | One page of row images for one table. `_limit` is capped at 50. |
| `archive_deleted_user_export(_archive_id uuid)` | The whole archive as one JSON document, for download. |

### 4. Edge function: `admin-operations`

The three `auth.admin.deleteUser` calls become `adminClient.rpc("delete_user_with_archive", { _user_id, _actor_id: user.id, _source })`:
- `delete_user` keeps its existing authorization block unchanged.
- `delete_institution` calls it per user, as it calls deleteUser today.
- `bulk_delete_students` does the same.

On error, the existing `explainDeleteFailure` path is unchanged (friendly toast, `user_delete_blocked` audit row). The RPC's own error now carries the real Postgres message too. The `user_deleted` audit row gains `archive_id` and `is_complete` in `old_values`. The action name is unchanged, so the §29 deletion alerts keep working.

What changes compared with GoTrue's `deleteUser`: GoTrue also writes one row to `auth.audit_log_entries`. The `system_audit_logs` row replaces it. Sessions and refresh tokens are still removed by the cascade. An access token that was already issued stays valid until it expires (about an hour), exactly as with GoTrue.

### 5. Frontend: `/admin/deleted-users` (super admin only)

- Lazy-loaded page `src/pages/admin/DeletedUsersPage.tsx`, routed under the existing super-admin route guard, with a sidebar entry next to Users. The feature-gating sync rule applies (`ui-invariants`).
- **List:** search (debounced 300 ms), paginated at 20 per page. Each card shows name, email, role chips, school, "Deleted {date} by {name}", rows archived, and a "Partial" badge when `is_complete` is false.
- **Detail** (MobileSheet): stat tiles (rows archived, tables, records they authored).
  - "Removed with them" lists each table with a human label and count. Opening one pages its rows as key/value cards.
  - "Still in the system, their name cleared" lists the link counts.
  - A Download button saves the export as JSON.
- Hooks live in `src/hooks/useDeletedUserArchive.ts`, with explicit `staleTime` (5 min, since archives never change), `.range`-style limit and offset, and error state before empty state.
- Built to the design system (PageShell, StatTile, EmptyState, MobileSheet, tokens only, 375px, dark mode). No em-dashes.

## Security

- The archive tables are unreachable except through the RPCs above.
- The delete RPC is service_role only. The read RPCs are gated inside on super admin.
- Every new DEFINER function revokes `anon` by name, and `pg_proc.proacl` is checked afterwards (§26).
- Password hashes, tokens and session rows are never archived.
- Reads are not audited in v1. There is one reader account, and the archive holds only data that was already visible to that account.

## Scale Gate (for the plan)

- Bounded lists: yes, limit ≤ 50 plus offset.
- Server-side counts: yes, `total` comes from the RPC.
- staleTime: set.
- No `select *`.
- Idempotent: the delete runs once per user and raises if the user is already gone; the UI keeps its existing single-flight on delete.
- One transaction: yes.
- FK index: `rows.archive_id` and `links.archive_id` are covered by their primary keys.
- Errors surfaced: yes.
- No `getUser()` calls, no polling.

## Testing

1. **Completeness, rolled back:** a new `scripts/probe-user-archive.sql`, the archive sibling of `probe-user-deletes.sql`, runs `delete_user_with_archive` for every account on prod in batches inside aborted subtransactions. Expect `is_complete = true` for all 3,402 deletable accounts, and team@salci.in to raise the support-owner error. Compare the archived counts for the heavy student and teacher with the 2026-09-25 measurements.
2. **Sensitive data:** the archived `auth.users` image has none of the dropped columns, and the session tables are count-only.
3. **Access:** as `anon`, as a non-super `authenticated` user (JWT claims set in-transaction), and as the super admin: the read RPCs are denied, denied and allowed; the delete RPC is denied, denied and denied (service_role only). Confirm `proacl`.
4. **Atomicity:** force a failure after the walk (a user blocked by the RESTRICT FK) and confirm that neither the header nor any rows remain.
5. **End to end** after deploy: a throwaway account created for the purpose is deleted through `admin-operations`, then appears on `/admin/deleted-users` with its rows.
6. The §5a gate (typecheck, eslint on changed files, build), plus 375px and dark-mode checks of the page.

## Ship order

1. Migration: schema, tables, delete RPC and read RPCs. Harmless while nothing calls them.
2. Tests 1 to 4 on prod, rolled back.
3. Deploy `admin-operations` with the switched call sites (from this point every delete archives).
4. Frontend page, route and sidebar. Commit and push `main` for Vercel.
5. Test 5, then docs (CLAUDE.md new §30, prod-operations skill, `probe-user-deletes.sql` note) and memory.

## Out of scope

- Restoring a deleted user.
- Copying storage files.
- Archive purge or retention rules.
- Read auditing.
- Archiving the Olympiad dormancy purge.
- Archiving institution-level data removed by `delete_institution` (classes, exams and so on); only the users inside it are archived.
