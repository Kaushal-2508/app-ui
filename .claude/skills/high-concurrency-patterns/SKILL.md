---
name: high-concurrency-patterns
description: SALCI scaling doctrine — patterns and anti-patterns for code that must handle 3-5K concurrent users today (10K design ceiling). Use whenever writing or modifying ANY SALCI code (queries, hooks, components, edge functions, migrations, RLS policies) — including pagination, aggregation, transactions, idempotency, N+1, RLS performance, timeouts/retries, debounce, realtime. The rules in CLAUDE.md §23 are HARD requirements and .claude/rules/enterprise-code-quality.md force-triggers this skill — this is the implementation companion with concrete patterns, examples, and the pre-merge checklist every change must pass.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# High-Concurrency Patterns for SALCI

The 2026-05-16 incident proved MVP code collapses around 60 active users. Target now is 3K–5K concurrent users (design ceiling 10K) — a ~100× scale jump. Every line of code from this point onward must be written assuming it will be hit by that load.

This skill is the **implementation companion** to CLAUDE.md §23. CLAUDE.md §23 has the laws; this skill has the patterns, anti-patterns, and concrete code examples for each one.

## When to consult this skill

**Always**, before writing any non-trivial code. Specifically required when:
- Adding a new `useQuery` / `useMutation`
- Adding a new edge function or modifying an existing one
- Writing a new migration (especially RLS policies)
- Adding a new real-time subscription
- Adding a new page route
- Adding a new component that fetches data
- Importing a new heavy library

If none of those apply, you can skip — but check anyway, the cost is low.

## Pre-merge checklist (mirrors CLAUDE.md §23.6)

Before any commit on a feature branch, walk through this. Block the commit on any "no".

```
[ ] 1. Every new useQuery sets explicit staleTime (no default-0).
[ ] 2. Every new useEffect subscription has a cleanup function.
[ ] 3. Any refetchInterval <= 30s has a justification comment.
[ ] 4. No select("*") in non-admin code.
[ ] 5. New list queries paginate end-to-end (UI + hook + RPC if applicable).
[ ] 6. No new supabase.auth.getUser() calls without an explicit JWT argument.
[ ] 7. Bundle delta < 5% via CI visualizer report.
[ ] 8. Every new FK has an index in the same migration.
[ ] 9. Every new RLS policy uses SECURITY DEFINER helpers (no inline cross-table EXISTS).
[ ] 10. Features touching > 100 rows are load-tested at 100 concurrent users via k6.
[ ] 11. Every mutation is idempotent — double-click/retry produces no duplicates (single-flight guard, upsert/ON CONFLICT, or unique constraint).
[ ] 12. Two+ dependent writes are ONE RPC/transaction, never sequential client calls.
[ ] 13. New RLS policies wrap stable per-row calls: (select auth.uid()), (select has_role(...)).
[ ] 14. Edge functions validate input first; every external fetch has a timeout; retries are bounded with backoff.
```

When a checklist item is intentionally unmet (e.g. a 5-second `refetchInterval` for proctoring), leave a comment in the code explaining why so the next reviewer doesn't strip it.

## Pattern library

### 1. Reading "who is the current user?"

**Anti-pattern (forbidden):**
```ts
// Every call hits /auth/v1/user on the server
const { data: { user } } = await supabase.auth.getUser();
```

**Correct:**
```ts
// New code:
import { getCurrentUser } from "@/lib/auth";
const user = await getCurrentUser();

// Or, in React components, prefer the context:
const { user } = useAuth();
```

`supabase.auth.getUser(token)` with an explicit JWT argument is still allowed — that's the legitimate server-validation path for security-critical writes.

### 2. List queries with pagination

**Anti-pattern (forbidden):**
```ts
// Silently capped at 1000 rows
const { data } = await supabase.from("students").select("id, name");
```

**Correct (cursor pagination):**
```ts
async function fetchStudentsPage(cursor: string | null, pageSize = 50) {
  let query = supabase
    .from("students")
    .select("id, name, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })  // tie-breaker
    .limit(pageSize);
  if (cursor) {
    query = query.lt("created_at", cursor);
  }
  const { data, error } = await query;
  if (error) throw error;
  return {
    rows: data ?? [],
    nextCursor: data && data.length === pageSize ? data[data.length - 1].created_at : null,
  };
}
```

Wire this through to the UI with `useInfiniteQuery` from TanStack Query.

### 3. Aggregations — server-side, not client-side

**Anti-pattern (forbidden):**
```ts
// Pulls every row, counts on the client. Hits 1000 cap silently.
const { data: attempts } = await supabase
  .from("student_exam_attempts")
  .select("id, exam_id, student_id, is_submitted")
  .eq("exam_id", examId);
const submittedCount = attempts.filter(a => a.is_submitted).length;
```

**Correct (RPC with SQL aggregation):**
```sql
-- in a migration
CREATE OR REPLACE FUNCTION public.exam_submission_stats(_exam_id uuid)
RETURNS TABLE(total int, submitted int, in_progress int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE is_submitted)::int,
    COUNT(*) FILTER (WHERE NOT is_submitted)::int
  FROM student_exam_attempts
  WHERE exam_id = _exam_id;
$$;
GRANT EXECUTE ON FUNCTION public.exam_submission_stats TO authenticated;
```

```ts
// in the hook
const { data } = await supabase.rpc("exam_submission_stats", { _exam_id: examId });
// data is [{ total, submitted, in_progress }] — single row, server-aggregated
```

### 4. React Query defaults

**Anti-pattern (forbidden):**
```ts
// No staleTime - refetches on every component mount
useQuery({ queryKey: ["x"], queryFn: ... });
```

**Correct (in src/main.tsx or QueryClient config):**
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,           // 1 minute
      gcTime: 5 * 60_000,          // 5 minute cache retention
      refetchOnWindowFocus: false, // tab switches do not refetch
      retry: 1,                    // do not amplify failures
    },
  },
});
```

Individual hooks can opt to shorter `staleTime` where data is genuinely volatile:
```ts
useQuery({
  queryKey: ["notifications", userId],
  queryFn: fetchNotifications,
  staleTime: 10_000,  // 10s — justified: real-time feeling without WebSocket
});
```

### 5. refetchInterval — only with justification

**Anti-pattern (forbidden):**
```ts
// Why 5 seconds? Will hit /rest/v1/X 720 times per hour per user
useQuery({ queryKey: ["x"], queryFn: ..., refetchInterval: 5_000 });
```

**Correct:**
```ts
useQuery({
  queryKey: ["proctoring-snapshot", attemptId],
  queryFn: fetchSnapshot,
  // 5s poll required: proctors need to see drift within ~5s of it happening,
  // and we accept the load cost for that. Switching to Supabase Realtime
  // would be cleaner but adds a WebSocket per active proctoring session.
  refetchInterval: 5_000,
});
```

### 6. RLS policies — SECURITY DEFINER helpers

**Anti-pattern (forbidden — caused 2026-04-26 recursion incident):**
```sql
-- Inline EXISTS between two mutually-referencing tables = recursion trap
CREATE POLICY "students see scoped questions"
  ON question_bank FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM question_bank_section_scope qs
      WHERE qs.question_id = question_bank.id
        AND qs.class_id IN (SELECT class_id FROM enrollments WHERE student_id = auth.uid())
    )
  );
```

**Correct:**
```sql
-- Wrap the check in a SECURITY DEFINER helper that bypasses RLS internally
CREATE OR REPLACE FUNCTION public.user_is_in_question_scope(_question_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM question_bank_section_scope qs
    JOIN enrollments e ON e.class_id = qs.class_id
    WHERE qs.question_id = _question_id
      AND e.student_id = _user_id
  );
$$;

CREATE POLICY "students see scoped questions"
  ON question_bank FOR SELECT TO authenticated
  USING (public.user_is_in_question_scope(id, auth.uid()));
```

### 7. Foreign keys must have indexes

**Anti-pattern (forbidden):**
```sql
CREATE TABLE my_table (
  id uuid PRIMARY KEY,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE
  -- no index on exam_id!
);
```

**Correct:**
```sql
CREATE TABLE my_table (
  id uuid PRIMARY KEY,
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE
);
CREATE INDEX my_table_exam_id_idx ON my_table(exam_id);
```

### 8. Long-running edge functions → background pattern

**Anti-pattern (forbidden at 10K users):**
```ts
// Synchronous - keeps the connection open 30+ seconds while OpenAI runs
const { data } = await supabase.functions.invoke("generate-questions", { body: ... });
```

For now, `generate-questions` is still synchronous — it's a tolerated exception because the throughput is bounded by individual teachers, not student concurrency. But any NEW long-running function must use the queue pattern:

**Correct (new long-running functions):**
```ts
// 1. Enqueue
const { data: { jobId } } = await supabase.functions.invoke("enqueue-x", { body: ... });

// 2. Poll
const { data } = useQuery({
  queryKey: ["x-job", jobId],
  queryFn: () => supabase.from("ai_jobs").select("status, result").eq("id", jobId).single(),
  refetchInterval: (q) => q.state.data?.status === "complete" ? false : 2000,
});
```

### 9. Lazy-load every page route

**Anti-pattern (current state of App.tsx — needs fixing):**
```tsx
import { CommandCenterPage } from "@/pages/school/CommandCenterPage";
import { ExamAttemptPage } from "@/pages/student/ExamAttemptPage";
// ...50+ static imports = 6.4 MB main chunk
```

**Correct:**
```tsx
const CommandCenterPage = React.lazy(() => import("@/pages/school/CommandCenterPage"));
const ExamAttemptPage = React.lazy(() => import("@/pages/student/ExamAttemptPage"));

// In routes:
<Route path="/school/command-center" element={
  <Suspense fallback={<PageSkeleton />}>
    <CommandCenterPage />
  </Suspense>
} />
```

### 10. Real-time subscriptions — one per feature

**Anti-pattern (forbidden):**
```tsx
// Each list item opens its own channel - 100 items = 100 WebSockets per user
function ListItem({ id }) {
  useEffect(() => {
    const ch = supabase.channel(`item-${id}`).on(...).subscribe();
    return () => supabase.removeChannel(ch);
  }, [id]);
}
```

**Correct:**
```tsx
// One channel at the list level, broadcast to children via context or query cache
function ListPage() {
  useEffect(() => {
    const ch = supabase
      .channel("list-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ["items"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  // ...
}
```

### 11. Atomic multi-step writes — one RPC, one transaction

**Anti-pattern (forbidden):**
```ts
// Three sequential client calls. If call 2 fails, call 1's row is orphaned —
// and under load, partial failures are a WHEN, not an IF.
await supabase.from("exams").insert(exam);
await supabase.from("exam_subjects").insert(subjects);
await supabase.from("exam_questions").insert(questions);
```

**Correct (single RPC = single transaction):**
```sql
CREATE OR REPLACE FUNCTION public.create_exam_bundle(_exam jsonb, _subjects jsonb, _questions jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _exam_id uuid;
BEGIN
  -- all-or-nothing: any raise rolls back every statement below
  INSERT INTO exams SELECT * FROM jsonb_populate_record(null::exams, _exam) RETURNING id INTO _exam_id;
  INSERT INTO exam_subjects SELECT * FROM jsonb_populate_recordset(null::exam_subjects, _subjects);
  INSERT INTO exam_questions SELECT * FROM jsonb_populate_recordset(null::exam_questions, _questions);
  RETURN _exam_id;
END $$;
```

If a flow truly cannot move server-side yet, the partial-failure handling must be explicit and documented at the call site (what state remains after step N fails, and how the user recovers).

### 12. Idempotent mutations — double-click/retry safe

Every mutation must survive a double-click, a retry, and a stale UI. The AIGenerateQuestions single-flight guard (`isAddingRef`) exists because removing it shipped duplicated questions.

**Anti-pattern (forbidden):**
```tsx
<Button onClick={() => markReviewed.mutate(studentId)}>Mark reviewed</Button>
// double-click = two inserts (duplicate rows or a raw 23505 toast)
```

**Correct (all three layers where applicable):**
```tsx
// 1. UI single-flight
<Button disabled={markReviewed.isPending} onClick={() => markReviewed.mutate(studentId)}>

// 2. DB natural key
//    ALTER TABLE review_flags ADD CONSTRAINT uq UNIQUE (student_id, exam_id);

// 3. Idempotent write
await supabase.from("review_flags").upsert(row, { onConflict: "student_id,exam_id", ignoreDuplicates: true });
```

### 13. RLS initplan caching — `(select auth.uid())`

`auth.uid()` bare in a policy is re-evaluated PER ROW. Wrapped in a scalar subquery it is evaluated once per statement (Postgres initplan) — orders-of-magnitude faster on row scans of large tables.

**Anti-pattern (slow at scale):**
```sql
USING (public.has_role(auth.uid(), 'teacher') AND institution_id = public.get_user_institution(auth.uid()))
```

**Correct (new policies MUST do this):**
```sql
USING (
  public.has_role((select auth.uid()), 'teacher')
  AND institution_id = public.get_user_institution((select auth.uid()))
)
```

Existing policies get rewritten in the dedicated perf audit — do NOT mass-rewrite them ad hoc; apply this to every NEW policy.

### 14. Edge function hygiene — validate, timeout, bounded retry

**Order of operations in every function:** validate input → auth check → work → structured result. Never touch the DB or an external API before the payload is validated.

```ts
// 1. Validate FIRST — reject garbage before spending any IO
const { examId, studentIds } = await req.json().catch(() => ({}));
if (!examId || !Array.isArray(studentIds) || studentIds.length === 0 || studentIds.length > 500) {
  return json({ error: "Invalid payload" }, 400);
}

// 2. Every external fetch gets a timeout — a hung upstream must not hold a connection open
const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

// 3. Retries are bounded with backoff + jitter — never amplify a failing upstream
for (let attempt = 0; attempt < 2; attempt++) {
  try { return await callUpstream(); }
  catch (e) {
    if (attempt === 1) throw e;
    await new Promise(r => setTimeout(r, 500 * (attempt + 1) + Math.random() * 250));
  }
}
```

Expensive functions (AI calls, PDF generation, bulk email) additionally need rate limiting per user/institution — return 429, don't queue unbounded work.

### 15. N+1 — never query inside a loop

**Anti-pattern (forbidden):**
```ts
// 40 students = 40 round-trips, serialized. ×5,000 users = meltdown.
for (const s of students) {
  const { data } = await supabase.from("review_flags").select("id").eq("student_id", s.id);
}
```

**Correct (one batched call):**
```ts
const { data: flags } = await supabase
  .from("review_flags")
  .select("student_id")
  .eq("exam_id", examId)
  .in("student_id", students.map(s => s.id))
  .range(0, 499);
```

If the batch itself would exceed a page, move the whole join server-side into an RPC.

### 16. Debounced search + bounded rendering

**Anti-pattern (forbidden):**
```tsx
// One server query per keystroke — "priya" = 5 queries × every typing teacher
useQuery({ queryKey: ["students", search], queryFn: () => searchStudents(search) });
```

**Correct — pick one:**
```tsx
// A. Client-side filter of the already-fetched (paginated) page — best for ≤ a few hundred rows
const filtered = useMemo(() => rows.filter(r => r.name.toLowerCase().includes(q)), [rows, q]);

// B. Debounce the server query when the dataset is genuinely server-side
const debounced = useDebouncedValue(search, 300);
useQuery({ queryKey: ["students", debounced], queryFn: () => searchStudents(debounced), enabled: debounced.length >= 2, staleTime: 60_000 });
```

Lists that can exceed ~100 rendered rows get pagination in the UI or virtualization — never render an unbounded array of row components.

## Quick reference: SALCI hot paths

These get the most concurrent hits and need extra scrutiny:

| Path | Why it's hot | Watch for |
|---|---|---|
| `/auth/v1/*` | Every page load validates auth | `getUser()` storms |
| `/rest/v1/profiles` | Every page does a who-am-I lookup | Repeated identical queries |
| `/rest/v1/exam_questions` | Loaded during exam attempts | N+1 queries, no pagination |
| `/rest/v1/student_exam_attempts` | Updated every few seconds during exams | Connection pool exhaustion |
| `/rest/v1/notifications` | Polled on every page | Refetch interval too aggressive |
| `LiveProctoringPage` | 5s polling × many proctors × many students | Compounds fast |
| `useNotificationRealtime` | One WebSocket per logged-in user | Total connection cap |
| `generate-questions` edge fn | 30s OpenAI calls | Concurrency cap |

## Deeper guides (when you need them)

These supplement the rules above. Pull them in when relevant:

- **Bundle analysis (visualizer setup):** TODO — `rollup-plugin-visualizer` config to add to `vite.config.ts`. Run on every PR to see chunk deltas.
- **k6 load tests:** TODO — scripts go in `scripts/loadtest/`. Start with a "100 concurrent logins + dashboard load" baseline.
- **Sentry integration:** TODO — `@sentry/react` + `@sentry/vite-plugin` with release tagging.
- **Supabase Advisors:** Run `supabase` Dashboard → Advisors → Performance + Security periodically. Surfaces missing indexes, RLS gaps.

These aren't built yet. They'll be added as we set them up.

## How this skill is enforced

Solo developer, no PR review process — enforcement is layered:

1. **[.claude/rules/enterprise-code-quality.md](../../rules/enterprise-code-quality.md) auto-loads into EVERY session** (same mechanism that injects design-rules.md — no hook needed). It mandates invoking this skill before any data-access code and walking its Scale Gate (a structural 10-item verdict list) before presenting code. Baseline-tested 2026-07-02: without it, 3/5 agents shipped unbounded lists or client-side aggregation on a "quick internal feature" task even with §23 in context; the gate + rationalization counters target those exact failures.
2. **CLAUDE.md §23** holds the laws; this skill holds the patterns. Keep all three documents in sync when a rule changes.

If something in the checklist would block speed-of-delivery on something critical, leave a `// PERF-DEBT:` comment with a description of what's missing and why. Track those in a separate doc; they're the "next sprint" list.