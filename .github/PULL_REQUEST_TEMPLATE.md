<!-- Fill every section. Do not delete headings. If a section does not apply, write "n/a" and say why. -->

## What changed and why
<!-- 2-6 sentences a product owner understands. Which user, which screen, what was wrong, what is different now. Link the task in docs/superpowers/plans/2026-09-07-naman-work-queue.md if it came from there. -->

## Ship note
- **Migrations in this PR:** none | `supabase/migrations/<file>` (header says NOT applied to prod)
- **Ship order:** DB first | frontend first | must ship together, because: ...
- **What the app does in the gap** (between DB apply and frontend deploy, or vice versa): ...
- **Rollback:** how to undo this if it misbehaves (revert commit / migration rollback statement): ...

## Zero-error gate (CLAUDE.md §5a) - paste the tails
```
npm run typecheck
<output>
npx eslint <changed files>
<output>
npx vite build
<last 3 lines>
```

## Skills invoked before writing code (CLAUDE.md §7)
<!-- e.g. hybrid-and-offline-exams, high-concurrency-patterns, salci-design-system -->

## Scale Gate (.claude/rules/enterprise-code-quality.md) - required for any query, hook, mutation, migration or RLS change
| item | verdict | evidence (file:line) |
|---|---|---|
| 1 list queries bounded (.range/.limit) | pass / na | |
| 2 aggregates server-side | pass / na | |
| 3 explicit staleTime on every useQuery | pass / na | |
| 4 no select("*") | pass / na | |
| 5 mutations idempotent | pass / na | |
| 6 dependent writes = one RPC | pass / na | |
| 7 new FK indexed; RLS via SECURITY DEFINER helpers | pass / na | |
| 8 errors surfaced before empty states; toastError | pass / na | |
| 9 no getUser() without JWT | pass / na | |
| 10 refetchInterval >= 30s; subscriptions clean up | pass / na | |

## UI evidence (if any screen changed)
<!-- Screenshots at 375px wide AND in dark mode. -->

## Open questions / things I was unsure about
<!-- Better here than guessed. -->
