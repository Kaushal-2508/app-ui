# Slowness Diagnosis — 2026-07-07

Root-cause analysis of two reported problems, backed by production telemetry
(`pg_stat_statements`, `pg_stat_user_tables`, `pg_settings`, live RLS policy dump)
pulled from prod project `gyymkgohcijeksmrzuyw`. **No changes made — findings only.**

- **Problem A:** schools that have uploaded students + syllabus load *very* slowly.
- **Problem B:** the whole portal feels slow / data loads slowly *even for small schools*.

Both are real and both are explained below. Problem A has a **zero-risk 30-second fix**.

---

## TL;DR

| # | Root cause | Which problem | Risk to fix | Impact |
|---|---|---|---|---|
| 1 | **Planner statistics are catastrophically stale** on the content tables (`question_bank` thinks 89 rows, really **98,783**; `syllabus_topics` thinks 11, really **4,368**). Postgres picks nested-loop plans that scan the whole table → 1–5s queries. | A (primary) | **None** — `ANALYZE` only | 🔴 Huge |
| 2 | **RLS re-evaluates `auth.uid()` per row** — 1,383 bare `auth.uid()` calls across 789 policies, only 18 wrapped in `(select auth.uid())`. Every query pays per-row auth cost. | B (primary) | Low-Med (scripted + verified) | 🔴 Huge |
| 3 | **Realtime WAL polling is the #1 total DB-time consumer** — `realtime.list_changes` = 473k calls, **77 minutes** of DB time, max 12s. Constant global drag. | B | Low | 🟠 High |
| 4 | **Request storms on the hot path** — `must_reset_password` check 169k calls, badge leaderboard 285ms×1,687 client-side aggregation, per-page profile lookups. | B | Low (fixes already written) | 🟠 High |
| 5 | **Undersized compute** — Small instance (~2 GB RAM, `max_connections=90`, `work_mem=5 MB`) for a 3–5k-concurrent target. | B | None (dashboard toggle) | 🟠 High |
| 6 | **Today's fixes are written but not shipped** — working tree is uncommitted, edge-fn timeout fixes undeployed, answer-key RLS migration staged-not-applied. | Both | Low | 🟡 Medium |

---

## Problem A — schools with uploaded content load slowly

### Root cause: stale planner statistics

The query planner has **never analyzed** the content tables, so it is planning against
row-counts that are 3–4 orders of magnitude wrong:

| Table | Planner assumed (`n_live_tup`) | **Actual `count(*)`** | `last_autoanalyze` |
|---|---:|---:|---|
| `question_bank` | 89 | **98,783** | `null` (never) |
| `syllabus_topics` | 11 | **4,368** | `null` (never) |
| `study_materials` | 23 | **2,329** | `null` (never) |
| `class_assignments` | 3 | **3,287** | `null` (never) |
| `final_results` | 15 | **7,314** | `null` (never) |
| `student_exam_attempts` | 15 | **7,373** | `null` (never) |
| `topic_class_mappings` | 0 | 169 | `null` (never) |

When Postgres believes a table has ~11 rows, it chooses a **nested loop** that re-runs the
join body and the RLS policy functions once per row — perfectly fine for 11 rows, disastrous
for 4,368. That is exactly why these queries are slow, straight from `pg_stat_statements`:

- **`question_bank` list (`useQuestionBank`)** — mean **4,060 ms**, max **7,014 ms**, returning only 6–31 rows.
- **`syllabus_topics` by subject** (syllabus page / study-materials resolver) — mean **627–1,128 ms**, max **3,221 ms**.
- **`study_materials`** — mean **604 ms**, max **1,898 ms**.
- **`final_results` + attempt join** — mean **1,202 ms**.

Cache hit ratio is 99.98% and there is no bloat problem (`question_bank` is 46 MB for 98k rows
≈ 490 bytes/row, which is normal). The tables are physically healthy — the *plans* are wrong
because the *statistics* are wrong.

**Why it tracks "more content = slower":** the more a school uploads, the more rows in these
tables, the wider the gap between the assumed 11 and reality, and the worse the mis-planned scan.
A brand-new school with a few topics is genuinely fast; a loaded school hits the nested-loop wall.

### Fix (zero risk, immediate)

```sql
ANALYZE public.question_bank;
ANALYZE public.syllabus_topics;
ANALYZE public.study_materials;
ANALYZE public.class_assignments;
ANALYZE public.topic_class_mappings;
ANALYZE public.final_results;
ANALYZE public.student_exam_attempts;
```

`ANALYZE` only refreshes statistics — it does not touch data, does not lock writes, and runs in
seconds. The 1–5s queries should drop to tens of milliseconds immediately. This is the single
highest-ROI action in this document and I recommend running it first.

**Then make it durable** — autoanalyze clearly isn't keeping up on the Small compute (3 workers,
`analyze_scale_factor` 0.1). Options: tighten per-table autovacuum settings on the hot tables
(`ALTER TABLE … SET (autovacuum_analyze_scale_factor = 0.02)`), or add a nightly `ANALYZE` via
`pg_cron`. Without this, stats will rot again as content grows.

---

## Problem B — the whole portal is slow, even for small schools

These are **global** costs: they hit every request regardless of how much data a school has,
which is why even a small school feels the drag.

### B1. RLS re-evaluates `auth.uid()` once per row (systemic)

The policy dump shows **1,383 bare `auth.uid()` occurrences across 789 policies**, and only
**18** wrapped in `(select auth.uid())`. Bare `auth.uid()` (and the helpers built on it —
`get_user_institution(auth.uid())`, `has_role(auth.uid(), …)`) is a `STABLE` call that Postgres
re-evaluates **per candidate row**. Each of those helpers runs its own sub-select against
`profiles` / `user_roles`. Wrapped as `(select auth.uid())` it becomes a one-time InitPlan
(evaluated once per statement).

`syllabus_topics` is the worst offender: **four** permissive `SELECT` policies are OR-ed together,
each calling `get_user_institution(auth.uid())` / `profiles` sub-selects / `is_super_admin(auth.uid())`
with bare `auth.uid()`. So a single syllabus read evaluates ~8–10 auth sub-queries **per row** —
and with the stale stats from Problem A compounding it, that's the 1s syllabus query. This is a
direct violation of the project's own rule (CLAUDE.md §23 rule #13 / high-concurrency-patterns §13),
and it applies platform-wide, so it taxes every query for every tenant.

*Fix:* rewrite policies to wrap stable calls in scalar subqueries. This is systemic (789 policies)
so it must be scripted and verified table-by-table, not hand-edited — but it's mechanical and the
payoff is large. Start with the hottest tables (`syllabus_topics`, `study_materials`,
`question_bank`, `class_assignments`, `profiles`, `student_exam_attempts`, `final_results`).

### B2. Realtime WAL polling is the largest single DB-time consumer

`realtime.list_changes(...)` — the Supabase Realtime WAL reader — logged **473,536 calls** and
**4,640,524 ms (77 minutes) of total DB time**, max **12,141 ms** for a single call. It runs
continuously on the shared instance regardless of tenant, so it steals CPU from every other query.

The realtime publication carries `tasks, task_assignments, task_evidence, notifications,
task_comments, conversation_messages`. `useTaskRealtime` subscribes to `postgres_changes` with
`event:'*'` and **no institution filter**, so every task/notification write *anywhere on the
platform* forces the WAL reader to fan the change out. That's both a load driver and a
cross-tenant chattiness problem.

*Fix:* filter realtime subscriptions by `institution_id`; drop tables from the publication that
don't actually need live updates; prefer `refetchInterval: 60_000` over broad subscriptions
(the project's own §23 guidance). Every message removed here is billed Realtime volume saved too.

### B3. Request storms on the critical path

- **`must_reset_password` / `password_expires_at` check** — **169,570 calls** (0.3 ms each, but
  it's a network round-trip on essentially every page/session load; source: `useAuth` +
  `PasswordExpiryWarning` mounted in the layout).
- **Badge leaderboard** (`useBadgeLeaderboard`) — **481,726 ms across 1,687 calls (285 ms mean)**,
  fetching all badges + roles + profiles and aggregating client-side.
- **Per-navigation profile "who-am-I" lookups** — repeated `profiles` selects.

These add latency to page loads directly. Good news: **fixes for several are already written**
in the working tree (useAuth module-level cache + single-flight, notification poll reduction,
study-materials debounce) — they just haven't been committed/deployed (see B6).

### B4. Undersized compute

Live settings: `shared_buffers` 512 MB, `effective_cache_size` 1.5 GB, `work_mem` 5 MB,
`max_connections` **90** → a **Small** instance (~2 GB RAM / 2 cores). The project's own scale
contract (§23) calls for **Large at 1k+** and **XL at 10k+** concurrent users. Every slow query
above is competing for 2 cores and a 90-connection ceiling. Confirm connections route through
**Supavisor (transaction pooler)**, not direct Postgres — 44 idle connections at off-peak on a
90 cap means a real concurrency spike can exhaust the pool and freeze the DB (the failure mode
from the 2026-05-16 incident).

### B5. Statement timeouts are healthy (context)

`authenticated` role has `statement_timeout=8s`, `anon` `3s`, `authenticator`
`lock_timeout=8s` — good, a runaway query can't hold a connection forever. But it also means the
1–5s content queries from Problem A are eating a large fraction of the budget and a slightly
heavier one would hit the 8s wall and error out as a "failed to load."

### B6. The fixes written today aren't live

`git status` shows the performance work from earlier today sitting **uncommitted** in the working
tree (`useAuth.ts`, `useNotifications.ts`, `useIsolatedStudyMaterials.ts`, `useTelemetry.ts`,
`GuidedTourProvider.tsx`, etc.), the edge-function timeout fixes **undeployed**, and migration
`20260707131000` (answer-key RLS tighten) **staged but not applied**. Production is still running
the pre-fix code paths. Committing + deploying reclaims wins that are already built.

---

## Recommended order (smallest / safest first)

1. **`ANALYZE` the 7 stale tables** — 30 seconds, zero risk, fixes Problem A now.
2. **Add durable autoanalyze** (per-table scale factor or nightly `pg_cron ANALYZE`) so it can't rot again.
3. **Commit + deploy today's written fixes** (working tree + edge-fn deploys) — reclaims the request-storm wins.
4. **Wrap `auth.uid()` in RLS** on the hot tables first, then the rest — scripted + verified. Biggest portal-wide latency win.
5. **Scope down Realtime** — filter `useTaskRealtime` by institution, trim the publication.
6. **Bump compute** to Medium/Large and confirm Supavisor transaction pooling for the concurrency target.

Items 1–3 are low-risk and could ship today. Items 4–6 are higher-effort but are what actually
moves the platform to the 3–5k-concurrent target.
