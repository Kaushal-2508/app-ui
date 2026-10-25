# Putting the route split back the way it was, and the crash it left behind

> **Status, 2026-09-23 (Tushar): the `src/App.tsx` revert is NOT adopted. The `src/main.tsx`
> handler IS, with three fixes.**
>
> The request fan-out was fixed in `vite.config.ts` instead: Rollup's `experimentalMinChunkSize`
> plus grouping only `lucide-react` and `date-fns`. A teacher's day goes from 169 requests to 45
> with a 1.12 MB entry. The September shape reaches 5 requests only by growing the entry to
> 6.7 MB, 4.4x over §23, and by pulling xlsx, jsPDF, KaTeX and recharts into the login download.
> The middle row fails §23 the same way at 3.0 MB.
>
> The handler shipped with: no automatic reload when `sessionStorage` throws (the 30-second guard
> failed open, 88 reloads in 15 seconds); none when offline (it reloaded onto the browser's
> offline page); and no `preventDefault` under an unsaved form (it made the import resolve to
> `undefined`, and the ErrorBoundary then took the update toast down with it).
>
> The patch file has been deleted so it cannot be applied by accident. Your measurements, the
> crash-after-deploy finding and the preloadError idea were all right, and are why both fixes
> exist. The numbers below are kept as the record of what the revert would have cost.

**Date:** 2026-09-22
**Branch:** `naman-erp`
**Author:** Naman (measurements and patch prepared with Claude)
**For:** Tushar. Both files are §28 load-bearing, so nothing here is applied. Patch:
[2026-09-22-app-eager-revert.patch](../plans/2026-09-22-app-eager-revert.patch)

---

## Summary

Commit `ba10b109` (2026-09-17) converted 126 route imports in `src/App.tsx` to `React.lazy()`,
taking the entry bundle from 6.7 MB to 1.1 MB so phones stopped parsing the whole app before the
login screen. It worked, and it traded one problem for another: the build now emits 433 files and
opening a page pulls 19 of them, 92 at worst. A six-page teacher session makes **174 requests**
where the pre-September build made 4.

The patch restores the exact shape that ran in production before 17 September: **66 pages eager,
57 left lazy**. Not a full revert. The 6.7 MB build was never fully eager, and the areas it kept
lazy are the ones most users never open, so bundling them buys nothing.

Two decisions are yours.

1. **6.57 MB is still a large entry**, about 4.4x §23's 1.5 MB limit, and it is the bundle that
   prompted the phone complaint in the first place. It needs your sign-off.
2. **The crash fix is independent** and should ship whatever you decide about the bundle.

---

## Why this shape and not a full revert

The first version of this patch made all 126 routes eager and produced an **8.08 MB** entry,
1.5 MB heavier than the bundle Naman remembered. The cause was not code growth. It was that the
6.7 MB build had 57 pages already lazy, and the full revert bundled those too: the entire
Olympiad section, homework, notices, support, admin issues, the PRD document.

All four shapes, built and measured today:

| Shape | Entry raw | Entry gzipped | JS files | Files per page (median / worst) |
|---|---|---|---|---|
| Today, all lazy | 1.07 MB | 0.31 MB | 433 | 19 / 92 |
| Dashboard + Exams + Tasks eager | 2.97 MB | 0.81 MB | 304 | 5 / 42 |
| **September shape, 66 eager (this patch)** | **6.57 MB** | **1.73 MB** | **104** | **2 / 11** |
| Everything eager | 8.08 MB | 2.06 MB | 9 | 1 / 2 |

The last two rows are the point. Full eager costs 1.5 MB more at login and buys nothing on the
number that matters, because the pages it adds are not in anyone's daily path.

## What it does to requests

Per page load, gzipped, which is what crosses the network. The plus-3 is the document, the
stylesheet and `sw.js`.

| Scenario | Requests now | KB now | Requests after | KB after |
|---|---|---|---|---|
| Teacher, 6 daily pages | 174 | 1,115 | 4 | 1,767 |
| Teacher, plus homework | 139 | 888 | 8 | 1,780 |
| Admin, plus two Olympiad pages | 167 | 1,051 | 18 | 1,849 |
| Student, 3 pages | 85 | 697 | 4 | 1,767 |

Requests fall by 90 to 98%. Bandwidth rises by roughly 60% to 150%, because everyone downloads
the eager set whether they use it or not. The lazy areas still cost a few files when opened,
which is exactly the behaviour that shipped before 17 September.

**Deploy cadence multiplies both and no bundle shape touches it.** You measured in `71d10f42`
that a one-line edit rehashes ~300 of 324 chunks, and `public/sw.js` plus `src/main.tsx:93`
force-reload every open tab. Recent pushes to `main`: 19 on 09-16, 19 on 09-17, 10 on 09-18. A
Vercel Ignored Build Step for docs-only commits, and batching merges, would cut the per-user
daily total more than anything in this document.

---

## The second bug: a crash screen after every deploy

There is no `vite:preloadError` handler anywhere in `src/`. When a tab is open across a deploy
and the user reaches a page they have not visited yet, the browser requests a file whose name the
deploy changed. `vercel.json` excludes `/assets/` from the SPA rewrite, so Vercel returns 404, the
dynamic import rejects, and `src/components/ErrorBoundary.tsx` paints "Something went wrong" with
no way out but a manual refresh. Impossible before `ba10b109`.

It stays reachable under this patch two ways: the 57 routes that remain lazy, and the libraries
every page imports on demand (`heic2any`, `exceljs`, `mathlive`, `html2pdf`, 29 call sites).

The handler reloads once, guards against a reload loop with a 30-second session-scoped timestamp,
and honours the §17 dirty-form contract by raising `salci-update-ready` instead of reloading when
a form has unsaved input.

---

## What the patch changes

**`src/App.tsx`.** 66 `const X = lazy(() => import(...))` become static imports; 57 stay lazy. The
route table is untouched. This is not a `git revert` of `ba10b109`: `CommandCenterV5Page`,
`TeacherTargetsPage` and `MyTargetsPage` were added since and `CommandCenterPage` was deleted, so
a revert would drop routes. Those three arrived lazy and stay lazy.

Three declarations are **deleted rather than converted**, being routed nowhere:

| Page | Still reachable? |
|---|---|
| `SchoolCoordinatorsPage` | Yes, `ManageUsersPage.tsx:4` imports it as a tab |
| `ManageAdminsPage` | Yes, `ManageUsersPage.tsx:3` imports it as a tab |
| `ProctoringReviewPage` | **No importer and no route anywhere.** Fully dead; its file is a Task 8 candidate. Flagged, not done. |

Comments that would otherwise lie are rewritten, including the `RouteFallback` docblock.

**`src/main.tsx`.** The `vite:preloadError` handler, 25 lines including comments.

---

## Verification

Everything ran against a probe build of the exact patched files. The working tree was never
modified: `App.tsx` and `main.tsx` were substituted at build time through a Vite `load()` hook,
and `git status` was clean throughout.

| Check | Result |
|---|---|
| `tsc -p tsconfig.app.json --noEmit` | exit 0 |
| `eslint src/App.tsx src/main.tsx` | exit 0 |
| Stale-import pass (§28 step 3) | clean |
| `vite build` | exit 0, size warning only |
| `npm run test:cache` | 14 passed, 0 failed |
| Chunk import cycles | 0 (the TDZ hazard from `71d10f42`) |
| Browser sweep, 122 concrete routes | **122 passed, 0 failed** |
| Crash-fix behaviour, 6 assertions | **all pass** |
| `git apply --check` | applies cleanly to HEAD |

The sweep loads every concrete path in headless Chromium with Supabase blocked, failing a route
on a blank `#root` or any console error matching `Cannot access`, `before initialization` or
`Failed to fetch dynamically imported module`. Static imports change module initialisation order,
so a circular import inside `src/` that `lazy()` was masking surfaces only here: typecheck and
build both exit 0 either way, which is how the `manualChunks` vendor split got through.

**The sweep was proven able to fail.** A TDZ error injected into a copy of the entry chunk made
the same harness report 3 of 3 routes failing. A test that cannot fail proves nothing.

**Not done: the phone timing.** See below.

---

## What you have to decide

**1. Is 6.57 MB acceptable on a phone?** 1.73 MB gzipped is a few seconds of transfer on Indian
4G, and 6.5 MB of JavaScript is several more to parse on a mid-range Android, before the login
screen appears. This is the bundle that produced the complaint on 17 September, so the honest
answer is that it was already judged too slow once. What has changed is that we now know what the
split cost in exchange.

If it is too slow, the middle row of the first table is built and measured: **Dashboard, Exams
and Tasks eager, 2.97 MB, 5 files per page**, which is 76% of the request reduction for 45% of
the bundle. Say the word and the patch is regenerated for that set.

**2. Deploy cadence.** Independent of bundle shape and still the largest lever.

**3. `public/sw.js` is dead weight, as you already flagged.** `CACHE` is declared and never used;
there is no `caches.open` or `put` anywhere, so the cache-first branch always misses. Its only
function is deploy detection plus the forced reload. Not touched here, since it changes §17's
contract. Worth noting that the 2026-04-19 stale-PWA incident was a service-worker *caching* bug,
and that caching no longer exists.

---

## Applying it

```
git apply docs/superpowers/plans/2026-09-22-app-eager-revert.patch
npm run typecheck && npx vite build && npm run test:cache
```

To take only the crash fix and leave the bundle alone, apply the `src/main.tsx` hunk on its own.
The two changes are independent.
