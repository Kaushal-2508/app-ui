# Correction: commit c17c08d message overstates the fix

**Commit:** `c17c08d fix(types): regen types.ts from prod - prior regen was stale`
**Date:** 2026-07-25
**Correction issued:** 2026-07-25 (same day)

## What the commit actually changed

`src/integrations/supabase/types.ts` grew by 28 lines. The added lines are
entirely a `graphql_public` schema wrapper block — a Supabase built-in schema
key that was omitted from the prior regen in `2dfb76f` (likely due to a CLI
version or flag difference).

## What the commit message claims (that is not true)

> lacked tt_slots.custom_label (the very column its migration added),
> tt_manager_overrides, staff_manager_overrides, is_staff_manager, and four
> recent RPCs.

None of those items were missing from `2dfb76f`'s regen output. Verified
via `git show 2dfb76f -- src/integrations/supabase/types.ts` and grep for
each name — all present at that commit.

## Why the correction is a separate commit rather than an amended message

`c17c08d` had already been pushed to `origin/main` at the moment the
inaccuracy was discovered. Amending the message would require a force-push,
which CLAUDE.md forbids without explicit user consent for destructive git
operations. The user chose the non-destructive path: leave the commit,
publish this correction so anyone reading the log or running `git blame`
finds the accurate account.

## What actually needed fixing in the codebase (nothing)

`2dfb76f`'s regen was functionally complete for the timetable "Other" slot
type work. The `graphql_public` schema wrapper that `c17c08d` added is
additive-only, doesn't affect the `public` schema types, and does not touch
any application code path. Typecheck, ESLint, and Vite build were all clean
both before and after `c17c08d`.
