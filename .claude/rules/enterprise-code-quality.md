# Enterprise Code Quality — Always-On Scale Contract (3–5K concurrent users)

<EXTREMELY-IMPORTANT>
SALCI serves 3,000–5,000 CONCURRENT users (design ceiling 10K). Every line of code you write ships to that load. The platform collapsed at 60 users on 2026-05-16 because "small internal feature" code went straight to production. MVP-grade output is a production incident, not a draft.

If a task touches ANY query, hook, mutation, data-fetching component, edge function, migration, or RLS policy, you MUST invoke the `high-concurrency-patterns` skill BEFORE writing code, and you MUST run the Scale Gate below BEFORE presenting or committing it. No task is exempt — not "small", not "internal", not "ship it today".
</EXTREMELY-IMPORTANT>

## The Scale Gate (mandatory, structural)

Before presenting or committing ANY data-access code, walk every item and state a one-line verdict (`pass` / `na` + why) for each. Skipping the gate = the task is NOT done, even if the code works.

1. Every list query has an explicit `.range()` / `.limit()` / cursor — a WHERE filter is NOT a bound.
2. Every count/sum/aggregate is computed server-side (embedded `count()`, `{ count, head: true }`, or an RPC) — never fetch rows to count them client-side.
3. Every `useQuery` sets an explicit `staleTime` (≥ 60_000 unless a comment justifies less).
4. No `select("*")` outside admin tooling.
5. Mutations are idempotent — single-flight guard (`isPending` gate/ref), upsert/`ON CONFLICT`, or unique constraint with graceful handling.
6. Two or more dependent writes are ONE RPC/transaction, never sequential client calls.
7. Every new FK gets an index in the same migration; RLS policies call SECURITY DEFINER helpers only — and wrap stable per-row calls as `(select auth.uid())`.
8. Errors are surfaced (error state rendered before empty state; `toastError` on mutations) — never swallowed.
9. No `supabase.auth.getUser()` without a JWT argument.
10. No `refetchInterval` < 30s without a justification comment; every subscription cleans up.

## Rationalizations that have already caused real violations (all invalid)

| Excuse | Reality |
|---|---|
| "The query is filtered to one class/section — that bounds it" | A filter is not a bound. Rosters merge, schools bulk-import, PostgREST silently truncates at 1000 rows. Add `.range()`. |
| "The row count is small — counting client-side is fine" | You ship N rows to compute 1 number, per user, × 5,000 concurrent users. Aggregate server-side. Always. |
| "I bounded the fetch with `.range()`, then counted client-side" | Satisfying the pagination letter while violating server-side aggregation is still a violation. |
| "It's a small internal feature / keep it quick / ship today" | The 2026-05-16 collapse WAS quick-shipped internal-feature code. Speed pressure never waives the gate. |
| "§23 is general guidance" | §23 items are HARD requirements. This file exists because they were treated as advisory. |

## Red flags — STOP and fix before returning code

- A `.select(` with no `.range(` / `.limit(` on any table that grows with students/users/attempts/rows-over-time
- `.length`, `filter(...).length`, `reduce`, or a counting loop over fetched rows
- A `useQuery` without `staleTime`
- A mutation whose double-click/retry behavior you cannot explain in one sentence
- A migration whose FK columns you didn't index
- "I'll add pagination later"

Full patterns, correct/forbidden examples, and the pre-merge checklist live in the `high-concurrency-patterns` skill — invoke it; don't code from memory.
