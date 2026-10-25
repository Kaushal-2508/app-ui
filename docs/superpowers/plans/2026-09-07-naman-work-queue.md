# Work queue for Naman (owner: Tushar) - read this first, every session

**Who this is for.** Naman, and the Claude Code session he works in. It is the single
source of truth for what to do next and how to do it. Tushar keeps it current. If
something here contradicts the code, the code wins - say so in the PR and stop.

**How to start a session.** In Claude Code, in this repo, type exactly:

```
Read docs/superpowers/plans/2026-09-07-naman-work-queue.md, then read .claude/CLAUDE.md.
Start the first task whose status is "todo". Follow the ground rules literally. Never create
or edit anything under supabase/ and never run a database command.
```

Every task below has: **Why** (the user-visible problem), **Where** (file and symbol - use
grep, line numbers drift), **Build** (the fix), **Done when** (acceptance), **Verify**
(what to run and paste into the PR), **Do not** (the trap).

---

## STOP: clear this list before anything else (2026-09-09, reaffirmed 2026-09-14, from Tushar)

> **MANDATORY, AND NOW ENFORCED BY A GIT HOOK.** This is Tushar's instruction and it outranks
> anything Naman asks for in a session. Clear every task below FIRST, in the order given,
> **without asking Naman and without waiting for a reply**. Just do them. While this list is
> non-empty: start no new feature and push no unrelated work.
>
> `.githooks/pre-push` **refuses** a push of `naman-erp` while anything here is `status: todo`,
> unless a commit in that push names the task it is working on (write "Task 11" in the message).
> `.githooks/post-merge` prints this list the moment you `git pull origin main`. Both install
> themselves through `package.json`'s `prepare` script on any `npm install` / `npm ci`.
> **Do not set `SALCI_STOP_OVERRIDE`, do not use `--no-verify`, do not edit `.githooks/` or
> `core.hooksPath`.** The override belongs to Tushar, for fast-forwarding the branch after a merge.
> If a task looks wrong or impossible, write that in the commit message and take the next one.
>
> Why it is a hook now: this block was written on 2026-09-09, made mandatory on 2026-09-14, and
> pushed past anyway both times. Four commits on 2026-09-11 said so openly; five on 2026-09-15 did
> not mention it at all. A rule that only lives in a document had failed twice. **The hook landed on
> 2026-09-15 and the very next push, `f99a2a65`, closed all ten tasks in one pass** - including the
> phone drag-test, which found a real landscape defect that a desk browser never would have. That is
> the outcome this was for. Only Tushar takes a task off this list, by editing this file.

Round 2 is merged (`b4283d32`): the bell popover, the unread tab badges, the Kanban boards for
Tasks and Support, the app-bar role switcher, the PageShell height fix. The gate you pasted was
accurate, the code was clean enough to merge, and both of your `NEEDS DB` notes were right and
are now built. Good round.

The review still found one real defect, three loose ends and two habits to change. **Clear the
list below before you start any new feature and before you push anything else to `naman-erp`.**

<!-- STOP-BLOCK:START -->
<!-- The git hooks in .githooks/ parse between these markers. Every
     `Task NN` named here is checked against its own `## Task NN -
     status: todo` heading below, so a task only blocks while its heading
     still says todo. To clear the list, leave the STOP-BLOCK:EMPTY line
     in place and delete the rows; to add one, drop the EMPTY line and list
     it. Keep the markers and the `Task NN` spelling, or the enforcement
     silently stops working. -->

**Nothing is blocking. Cleared 2026-09-16 by `f99a2a65`, which closed Tasks 11 to 20 in one
pass.** Take the first task marked `todo` further down this file.

STOP-BLOCK:EMPTY
<!-- STOP-BLOCK:END -->

One commit per task, or one commit for the group, whichever is cleaner. If a task turns out to be
wrong, or you cannot finish it, **stop and write the reason in the commit message**. Do not skip it
silently and do not start a new feature on top of it.

**Round 3 already landed and is merged (`bfed6aa5`): the Tasks page now follows the app-bar
Teacher/Coordinator switch.** It is not on the blocking list above, and that is fine: you branched
from `28024bde`, minutes before the STOP block existed, so you never saw it. Good find, and the
right shape. You spotted that migration `20260909150000` left a teacher+coordinator staring at a
coordinator Overview made mostly of "Not visible to you" cards, you fixed the page to switch on
`activeViewRole` instead of the raw role, and you wrote a `NEEDS DB` for the server-side half
rather than inventing a workaround and calling it done. Measured on production for the Alliance
coordinator you cited: 178 live To Do tasks, of which 110 had no readable assignment row. Your
174 was the right order of magnitude. **The five blocking tasks above are still outstanding and
still come first.**

Two notes on that round. First, your "Also for Tushar" item said CLAUDE.md §25 and the
`teacher-authority-scope` skill still call the app-bar chip an inert label. Both were corrected in
`b4283d32`, which is an ancestor of the commit you branched from, so the claim was already stale
when you wrote it. **Read the current file before reporting a doc as wrong.** Second, your change
has a consequence you did not list: a teacher+coordinator defaults to `viewRoles[0]`, which is
`"teacher"`, so the Wing Overview tab is now absent until they flip the app-bar switch. That is
consistent with how the Exams page behaves and is very likely right, but it changes what three
real Alliance coordinators see when they open the page, so it belonged in the commit body.

### Round 5 (merged 2026-09-15). Good code. Wrong work.

Five commits: the edge-to-edge page backdrop and app-bar tidy, the Activity filters dialog, the
Academic Calendar rebuild, the Tasks board declutter and scroll-trap fix, and Shared Resources.
Reviewed and merged.

**The code was clean.** Typecheck, lint and build all zero. Not one em-dash in 585 added lines, no
`any`, no disabled lint rules, no stray logging, no data fetching touched. Both page rewrites keep
every action they had, and the calendar rebuild actually restored two dialog triggers that had gone
missing earlier. You also reproduced and fixed a real wheel trap on the board columns, and reversed
your own earlier `overscroll-none` decision with a written reason, which is exactly right: the
earlier note was about rubber-banding, the trap was worse, and you said so.

**One regression, found in review and fixed during the merge.** Making PageShell cancel `<main>`'s
padding changed the height budget every page is measured against, and `BOARD_SHELL` in
`AdminIssuesPage.tsx` still subtracted that padding. The Support Inbox board ended 48px short,
putting back the exact band of bare page under the last column that the constant's own comment says
it exists to remove. When you change a shared layout primitive, grep for everything that did its
own arithmetic against the old behaviour.

**And the part that is not about code.** All ten blocking tasks were still `todo`, and this round
did not mention the STOP block once. The previous round at least disclosed it every time. That is
why the block is enforced by a git hook now rather than written more firmly: see the header above.
Nothing about your code quality prompted this. The work is good; it is the wrong work.

### Round 4 (merged 2026-09-14). Good work, and read this.

Four pieces shipped: the Activity Logs rebuild with delete/create recording on 27 call sites, the
per-row and per-question AI difficulty chips, the Classes page rebuild, and the pointer-drag
rewrite of the quick-actions button. Merged after a six-dimension review.

**The difficulty chips were correct to build.** Tushar asked for them. CLAUDE.md §8 and the
`salci-module-notes` skill said "no difficulty selector, hardcoded to 5"; you spotted the
contradiction and flagged it instead of quietly leaving it, which was the right call. Tushar has
now rewritten both to describe the override as intended behaviour. Do not revert the chips.

**What you got right, and should keep doing.** Nothing under `supabase/`; two honest `NEEDS DB`
notes with a real spec; `git pull origin main` first, so the merge was conflict-free; snapshots
taken before every delete and the log fired only after the error check; not one em-dash in 3,420
added lines; and a stale-import pass whose six "pre-existing" claims all checked out when Tushar
linted the base versions.

**What the review found.** Two high-severity defects Tushar fixed inside the merge, because they
were user-visible and shipping: the activity feed's keyset cursor could silently skip rows when
several shared a timestamp (there was no tiebreaker sort, and the boundary-key set was rebuilt
from the current page, so it forgot earlier ties), and the quick-actions menu opened downward
off-screen on short viewports because the flip only tested for room ABOVE. Three mediums, also
fixed in the merge: a band picked on a row with no quantity yet was silently discarded and then
overwritten with Hard; the aggregate top-up refilled the deficit from the LARGEST request, so
questions asked for at one band came back at another; and a failed "Load older events" replaced
the entire loaded page with an error card, because `feed.error` is set by pagination failures too
while the data is still there.

**The habit behind two of those.** A paging cursor and a popover flip are both geometry: write
down the case where the thing does not fit, or where two rows tie, BEFORE you write the happy
path. Both bugs were invisible on a normal laptop with a handful of rows and certain to appear in
production.

**Still yours: Tasks 16 to 20, added below and now at the top of the blocking list.**

### What the review found in round 2, so you can aim the next round

Kept and worth repeating: no files under `supabase/`, no SQL, two honest `NEEDS DB` notes with a
spec each, optimistic updates that snapshot and roll back, the error state before the empty state
on every new surface, explicit `staleTime` on every new query, bounded reads, no `any`, no
`eslint-disable`, and comments that explain WHY. The comment on `BoardColumn`'s three overlapping
height bounds is the kind of note that saves the next person an afternoon.

Four things to change:

1. **A view must show the whole lifecycle of whatever it renders.** The Tasks board takes the
   active tab's already-filtered list. On My Tasks that list is open plus in-progress only, so
   three of the five columns can never hold a card, and the optimistic update makes a dragged card
   vanish because it now belongs to a different tab. Before calling a view done, check that every
   column, row and empty state it can draw is actually reachable. That is Task 11, and Task 15 is
   the same defect one layer down: the page never handled the `rejected` status at all.
2. **Never name a database object from memory or from an older doc.** Round 2 cited a trigger
   called `enforce_task_status_transition` in two code comments and a spec. No such function
   exists. The live one is `validate_task_state_transition`, and an old migration comment is where
   the wrong name came from. If a comment needs a database name, ask for it or leave it out. A
   wrong name in a comment sends the next reader looking for something that is not there.
3. **Your gate cannot see a stale import, so check it separately.** This repo sets
   `@typescript-eslint/no-unused-vars` to `off`, so `npx eslint` stays silent on a symbol your
   change made dead. Round 2 left `Megaphone` imported in `AppSidebar.tsx` after the nav item
   using it was removed. Run the extra pass in the pre-push gate below, and fix only the symbols
   YOUR change made dead. Pre-existing unused symbols in a file you touched are out of scope
   (§5a); `ReportedIssue` in `AdminIssuesPage.tsx`, for instance, was already unused before you
   started.
4. **A big restructure of a shared page will conflict, so say so.** `AdminIssuesPage.tsx`
   conflicted because you restructured it while main was adding an intake-health banner to the
   same region. The merge was easy and the fix is not "restructure less", it is: pull `main` at
   the start of every session as §28 already tells you, and when you are about to rework a whole
   page, put that in the `pushed:` message so a conflict is expected rather than a surprise.

### The database half is live now. Do not touch it.

Both `NEEDS DB` items you wrote up were built and applied to production on 2026-09-09:
`coordinator_covers_task` with new wing-scoped policies, and `notice_unread_count`. Your
`useUnreadNoticeCount` replacement for the Notice Board badge is already wired in, so the
`NEEDS DB` note on that one is closed.

Three things about it that you need to know but must NOT act on:

* **Coordinators now see fewer tasks, sometimes none.** Wing membership is derived from class
  rosters, and school admins hold no class rows, so tasks an admin handed out belong to no wing.
  At the pilot school two coordinators went from 103 visible tasks to zero, correctly. If you log
  in as a coordinator and the Tasks page looks empty, **that is not your bug.** Do not "fix" it in
  the frontend and do not reconstruct names another way.
* **Two screens currently disagree** about how many tasks a wing has, because the policy counts
  the assigner as well as the assignee while the coordinator dashboard counts only the assignee.
  That is Tushar's to settle in SQL. Do not paper over it in a hook.
* **Your `HIDDEN_ASSIGNMENT_LABEL` was the right call and stays.** It now shows up mainly for
  teachers looking at a colleague's task, which is exactly what it is for.

---

## Ground rules (not negotiable)

1. **You work only on `naman-erp`. Never on `main`.** (`naman-erp` replaced `naman-branch`
   on 2026-09-07 for the ERP build-out; the old branch is fully merged, do not use it.) Start
   of every day: `git checkout naman-erp` then `git pull origin main`. If git says "conflict",
   stop and tell Tushar; do not resolve it yourself. Never force-push.
2. **You change frontend files only** (`src/`, `docs/`, `public/`). **You never write SQL.**
   No files under `supabase/`, no `supabase` or `psql` commands, no database URLs. If a task
   needs a database change, write `NEEDS DB: <what and why>` in your commit message and move
   on to the next task; Tushar does the database part.
3. **Handing in work.** `git add -A`, then `git commit -m "<what you changed and why>"`, then
   `git push origin naman-erp`, then message Tushar: `pushed: <one line>`. Tushar reviews
   the branch and merges it into `main`. There is no other step.
4. **The gate, before every push** (CLAUDE.md §5a): `npm run typecheck`,
   `npx eslint <every file you changed>`, `npx vite build`. All three must show **zero errors
   on files you touched**. Paste the last lines of each into the commit message body. Never
   `eslint-disable`, never `as any`, never `: any`.
5. **One save that needs two writes to succeed together is a database job.** Never
   `insert A` then `insert B` from the browser (CLAUDE.md §9a, §23). Write `NEEDS DB` and stop.
6. **Invoke the area skill before writing code** (CLAUDE.md §7 table). For any query, hook or
   mutation, walk the Scale Gate in `.claude/rules/enterprise-code-quality.md` and put the
   pass/na list in the commit message.
7. **Errors before empty states, `toastError` for every error** (CLAUDE.md §6, §19). No
   em-dashes in user-facing text.
8. **Check phones.** Every UI change is verified at 375px wide (DevTools device toolbar) and in
   dark mode. Send both screenshots to Tushar with the `pushed:` message.
9. **Unsure? Stop, write the question in the commit message, and tell Tushar.** A guess that
   ships is far more expensive than a question.

---

## Current production state (do not assume, this is the truth as of 2026-09-07)

| migration | prod | note |
|---|---|---|
| `20260904130000_offline_attempt_creation_bypass.sql` | **APPLIED** 2026-09-05 | staff can add offline marks after the exam window |
| `20260904150000_classroom_planning_syllabus_badges.sql` | **APPLIED** 2026-09-07 | after fixing the `0A000` trigger error (see ground rule 11). Backfill awarded 54 badges to 31 staff; coordinators are on the teacher ladder. |
| `20260907110000_teacher_badge_rarity_admits_coordinators.sql` | **APPLIED** 2026-09-07 | Task 3 below, done by Tushar's side in the same window. |
| `20260904160000_assessment_marking_teamwork_badges.sql` | **APPLIED** 2026-09-07 12:40 IST | 21 rows, 9 triggers, 4 indexes verified; backfill awarded the re-paced ladders (e.g. Publishing Pro 3, Regular Examiner 19, Question Smith 19). Task 10 is now unblocked. |
| `20260907120000_question_images_bucket_limits.sql` | **APPLIED** 2026-09-07 | `question-images`: 2 MB, jpeg/png/webp. |
| `20260907130000_offline_bypass_keyed_on_exam_mode.sql` | **APPLIED** 2026-09-07 | Probed: staff insert on a closed online exam refused, on a closed hybrid exam allowed. |
| `20260908120000_notice_publish_notifies_recipients.sql` | **APPLIED** 2026-09-08 | publish_notice fans out one notifications row per recipient; mark_notice_read clears the bell rows; anon revoked on the three comms RPCs. |
| `20260908130000_school_diary.sql` | **APPLIED** 2026-09-08 | diary_entries + diary_feed / diary_write_entry / diary_delete_entry; School Diary live for Salci National School. |
| `20260909150000_coordinator_wing_task_visibility.sql` | **APPLIED** 2026-09-09 | coordinator_covers_task helper; coordinators narrowed to wing tasks with assignment rows visible; supervisor SELECT policy on tasks. |
| `20260909151000_notice_unread_count.sql` | **APPLIED** 2026-09-09 | notice_unread_count() RPC + partial unread index for the Notice Board tab badge. |

---

## Task 1 - status: done 2026-10-05 (naman-erp) - HIGH - comprehension sub-questions are flattened when a draft is reopened

**Why.** A teacher saves a draft with a comprehension (or case study) question that has
three parts, later taps "Continue draft", then Continue. The three parts come back as three
standalone questions, the parent link is lost for good, the marks are counted twice, and the
Review step warns "passage with no sub-questions" on a paper that was fine. Verified reachable
in production.

**Where.** `src/components/exam-creation/ExamCreationFlow.tsx`: `type RawQuestionRow`,
`function useExamFormLoader`, and the map over `s.exam_questions` (grep `RawQuestionRow`).
The select list for `exam_questions(...)` does not include `parent_question_id`, and the map
never builds `subQuestions`. Compare with `fromFetchedExam` in
`src/components/exam/paper/normalizeExamPaperData.ts`, which handles this correctly.

**Build.** Select `parent_question_id`. After mapping, split rows into parents (null
`parent_question_id`) and children; attach each child to its parent as `subQuestions`
sorted by `question_order`; do not emit children at top level. Keep the parent's `marks` as
stored (it is already the sum, see `ComprehensionForm.tsx` "Overwrite marks with the sum").
Skills: `salci-module-notes` (exam creation flow, options dual shape).

**Done when.** Reopen a draft with a 3-part comprehension question: the Questions step shows
one passage with three parts; Review shows no passage warning; saving again does not change
the row count in `exam_questions` for that exam (check with a SELECT in the PR description:
Tushar will run it). Marks total unchanged.

**Verify.** Gate. Then in the app (dev): create the draft, leave the flow, reopen, Continue,
publish to a test class. Screenshot the Questions step before and after reopen.

**Do not.** Do not touch `useSaveExam.ts` / `useUpdateExam.ts` blueprint synthesis (§10).
Do not change the DB shape.

**Done (2026-10-05, Naman).** The loader selects `parent_question_id` and maps the rows through
`buildDraftQuestionTree` (`src/components/exam-creation/draftQuestionTree.ts`): children hang off
their parent as `subQuestions` in part order and never appear at top level; a parent saved as
`long_answer` with parts gets `case_study` back (the DB enum has no case_study); an orphan part
whose parent row is gone stays visible as a standalone question. The parent's stored marks are kept.
Proven two ways: 7 node assertions on the helper (tree shape, no double count, type restore, orphan,
empty) and a browser run of the real edit flow against a stubbed draft at 375px, light and dark,
with the pre-fix loader aliased in for the "before": before = Review warns "Q2 in Section A is a
passage with no sub-questions", Questions shows MCQ 4/4 + Short Answer 1/1 with the three parts
standalone; after = no warning, MCQ 2/2, one passage "6 marks · 3 sub-questions". Screenshots:
`~/Desktop/Task1-draft-reopen-2026-10-05`. Also fixed the mojibake "┬╖" separator in that row. For
Tushar's row-count check, before and after a re-save of a reopened draft:
`SELECT count(*) FROM exam_questions q JOIN exam_sections s ON s.id = q.section_id WHERE s.exam_id = '<id>';`
Not touched: `src/hooks/useExamEditor.ts` has the same select without `parent_question_id`, but
nothing imports it (dead code, Task 8 territory).

---

## Task 2 - status: done 2026-10-05 (naman-erp; bucket size limit still Tushar's) - MEDIUM - question and option images are too heavy for students on phones

**Why.** Diagrams and option images are now stored at up to 2000px, JPEG quality 0.9, and
the **same master file** is what every student's phone downloads and renders inline at
about 390px wide. One image-choice question is 3 to 6 MB per student. 200 students on one
school link need minutes to load a paper while the exam timer runs, and the `<img>` has no
error state, so they see empty boxes. The 2000px master is right for the enlarge lightbox;
it is wrong for the inline grid.

**Where.** `src/components/ui/question-image-upload.tsx` (`MAX_EDGE`,
`KEEP_PNG_UP_TO_BYTES`, the `resizeImageForUpload` call); `src/components/exam/OptionChoiceGrid.tsx`,
`src/components/exam/QuestionDiagram.tsx`, `src/components/exam/OptionImage.tsx` (the inline `<img>`s);
`src/utils/imageResize.ts`.

**Build.** Keep the 2000px master. At upload, ALSO produce an 800px long-edge JPEG (quality
0.75) with the same helper and upload it next to the master using a naming convention:
`<uuid>.jpg` and `<uuid>-w800.jpg`. No schema change. Inline renders derive the small URL
from the stored one (`url.replace(/(\.\w+)$/, "-w800$1")`) and fall back to the master via
`onError` (so every image uploaded before this change still works). The lightbox keeps the
master. Add a visible fallback for a failed inline image (a neutral box with "Image could
not be loaded, tap to retry") instead of alt text. Fix the comment that says quality 0.92
while the code passes 0.9.

The bucket size limit is a database setting; Tushar sets it (see the Tushar-owned list). Not your part.

**Done when.** A new option image results in two objects in the bucket; the attempt page's
Network tab shows the `-w800` file for the grid and the master only when enlarged; an old
image (no `-w800` object) still renders via the fallback; a broken URL shows the fallback
box, not an empty area.

**Verify.** Gate. DevTools Network tab screenshots at 375px for: new image, old image, broken
URL. Note the bytes per question before and after in the PR.

**Do not.** Do not lower the master below 2000px (the lightbox needs it). Do not add a column.
Do not change `avatarImage.ts` (avatars must stay `fit: "cover"`).

**Done (2026-10-05, Naman).** `QuestionImageUpload` keeps the 2000px master and also stores an
800px long-edge copy (JPEG 0.75; a small PNG stays PNG under the same 400 KB rule, read from the
same original, so master and copy always share an extension) as `<uuid>-w800.<ext>`; the copy is
best effort (a failed copy upload is logged, the question is not held up) and Remove deletes both.
`src/lib/imageVariants.ts` derives the small URL (`-w800` before the extension) and the new
`InlineImage` (`src/components/exam/InlineImage.tsx`) renders it inline, falls back to the master
on error (every pre-2026-10-05 image), and on a second failure shows a dashed box "Image could not
be loaded, tap to retry" that re-requests with a cache-buster. Wired into `OptionChoiceGrid`,
`QuestionDiagram` and `OptionImage`; their picture wrappers became `div role="button"` so the retry
box receives its own tap on WebKit. The lightbox still opens the master. Comment fixed (0.9).
Verified in the browser at 375px light and dark against a stubbed storage (26 checks): a new image
fetches only `-w800` inline (29.9 KB vs 109.9 KB master for the same test picture, 73% smaller;
on a real 1 to 2 MB photo master the copy is ~100 to 150 KB), an old image misses `-w800` then
loads the master, a broken URL shows three retry boxes and no empty area, retry re-requests
without selecting the option, Enlarge fetches the master; an upload stores two objects (2000x1500
and 800x600, 117 KB and 21 KB) and Remove deletes both. Screenshots and request log:
`~/Desktop/Task2-images-2026-10-05`. Still Tushar's: the bucket size limit.

---

## Task 3 - status: done 2026-09-07 (Tushar, migration `20260907110000`, applied) - MEDIUM - `teacher_badge_rarity()` still excludes coordinators

**Why.** The badges migration admits coordinators to the teacher ladder, but the rarity
function that says "earned by 12% of teachers" still counts only `role = 'teacher'` in both
the numerator and the denominator. The moment `useTeacherBadgeRarity` is wired into a tile,
a coordinator will see "earned by 0% of teachers" on a badge they hold.

**Where.** `supabase/migrations/20260818130000_teacher_achievements_read_api.sql`,
function `teacher_badge_rarity()`, the two predicates `ur.role = 'teacher'` and
`ur2.role = 'teacher'`.

**Build.** A NEW migration file (never edit the old one) that `CREATE OR REPLACE`s
`teacher_badge_rarity()` with both predicates changed to `IN ('teacher','coordinator')`,
re-asserts `REVOKE ALL ... FROM PUBLIC, anon;` and `GRANT EXECUTE ... TO authenticated;`
(CLAUDE.md §26: revoke anon BY NAME). Header: `NOT applied to prod`. Copy the full body from
the old file and change only those two lines; diff the two in the PR.

**Done when.** The diff between old and new function bodies is exactly the two predicates
plus the header comment.

**Verify.** Gate (typecheck still runs; the SQL file itself is reviewed by Tushar). Ship
order in the PR: "DB only, apply together with 20260904150000".

**Do not.** Do not touch `evaluate_teacher_badges` or `teacher_achievements()`.

---

## Task 4 - status: done 2026-10-05 (naman-erp) - MEDIUM - P0001 messages can leak internal identifiers

**Why.** `translateError` now shows any short P0001 trigger message verbatim. 299 distinct
`RAISE EXCEPTION` messages exist; some interpolate UUIDs or `snake_case` values
(`Not authorised for institution 3f2a...`). CLAUDE.md §19 exists to prevent exactly that.

**Where.** `src/lib/errorMessages.ts`: the `if (code === "P0001" && message && isLikelyUserFriendly(message))`
block and `function isLikelyUserFriendly`.

**Build.** Keep the four explicit rewordings that were added for the attempt-window
messages. Replace the generic pass-through with an allowlist: a small array of regexes for
messages we have read and approve (start with the attempt-window ones and any you find in
`supabase/migrations` that are plain sentences with no interpolation). Everything else falls
back to the existing generic P0001 title. Add a UUID regex and a `\b[a-z]+_[a-z_]+\b` regex
to the technical markers in `isLikelyUserFriendly` as a second line of defence.

**Done when.** A unit-style check (a small script or test) shows: the four attempt messages
pass through; `Not authorised for institution <uuid>` and `Invalid publish_status: x` do not.

**Verify.** Gate. Paste the check's output.

**Do not.** Do not change `toastError`'s signature.

**Done (2026-10-05, Naman).** The generic pass-through is gone. A P0001 is shown verbatim only when
`isApprovedP0001(message, hint)` AND `isLikelyUserFriendly(message)` both agree. The allowlist
(`P0001_ALLOWLIST` in `src/lib/errorMessages.ts`) was built from a survey of all 422 distinct
`RAISE EXCEPTION` strings in `supabase/migrations` (369 plain, 53 interpolated): it names the
approved sentence openings ("You / Your / Only / Pick / Choose / Please / Keep / ...", "This / That
/ The / A / Each / Every / Cannot / ...", the module nouns "Booking / Feedback / Slot / Exam /
Attendance / Period slot / Roll number / ...", "Time clash:") and a few approved tails for
messages that open with a name or a count ("... is archived. Pick an active section.", "... Use a
different roll number."). A message carrying a HINT from the two families our RPCs write for the
screen (`ptm_*`, `exam_slot_*`) is approved as a whole. Second line of defence added to
`isLikelyUserFriendly`: a UUID regex, `\b[a-z]+_[a-z_]+\b`, and `^[a-z0-9_]+: ` (the
"dashboard: class not in scope" developer tags). Side effect worth having: the terse guard texts
("Not authenticated", "not signed in", "dashboard: not authenticated") now read "You're signed out.
Sign in and try again.", and "Not authorized ..." / "Not authorised ..." get the permission
wording instead of the raw line. `toastError`'s signature is unchanged. The check script
(scratchpad `task4/test-errors.mjs`, esbuild bundle + node asserts) passes 33/33: the four
attempt-window rewordings still win; 12 approved sentences pass verbatim; `Not authorised for
institution <uuid>` and `Invalid publish_status: x` do not; a UUID or a column name inside an
approved shape still falls back; a hinted message with an id still falls back; a plain `Error`
without a code (edge-function preflights) still passes unless it carries an id. Output pasted in
the commit body.

---

## Task 5 - status: owner Tushar, deferred (needs a database RPC, tested before the hook ships) - MEDIUM - section-marks save is 3 sequential writes per student (make it one RPC)

**Naman: skip this task.** It is a database job; Tushar writes the RPC and then changes the hook. Listed here so the reasoning is in one place.

**Why.** For results-only exams, saving 60 students fires ~181 sequential HTTP writes
(attempt insert, section marks upsert, final_results upsert, per student). It is slow, and
a failure in the middle leaves half a class saved with no clean recovery. The file already
carries a `PERF-DEBT` comment saying so. This is the pattern CLAUDE.md §9a/§23 forbids.

**Where.** `src/hooks/useOfflineMarksEntry.ts`: the `PERF-DEBT` comment and the
`for (const student of targets)` loop. Compare with `publishFinalResults` in
`src/hooks/useOfflineMarks.ts` (batched but still non-transactional).

**Build.** One SECURITY DEFINER RPC `save_offline_section_marks(_exam_id uuid, _rows jsonb, _publish boolean)`
in a NEW migration (`NOT applied to prod`): validates the caller may mark this exam
(reuse the existing helpers `is_assigned_to_exam_class` / school-admin role check, see the
live policies on `offline_section_marks`), creates missing attempts, upserts section marks,
upserts `final_results` when publishing, all in ONE transaction, returns `{saved, failed:[{student_id, reason}]}`.
Never write `final_results.percentage` (§9). `REVOKE ALL ... FROM PUBLIC, anon` by name,
`GRANT EXECUTE TO authenticated`. Then make the hook call the RPC once per save.
Skills: `hybrid-and-offline-exams` (two pipelines never cross), `high-concurrency-patterns`,
`prod-operations` (RLS/grant landmines).

**Done when.** One save = one request; a forced failure for one student (e.g. not in the
class) rolls back nothing for the others AND is named in the response; the two pipelines'
React Query keys are unchanged.

**Verify.** Gate. Scale Gate items 5, 6, 7, 9 recorded as pass with evidence. Ship order:
DB first; the old hook keeps working until the RPC exists, so gate the new call on the RPC
being present is NOT needed - just ship the frontend after Tushar applies.

**Do not.** Do not merge the two offline-marks pipelines. Do not change query keys.

---

## Task 6 - status: done 2026-10-05 (naman-erp; item 3 stays Tushar's) - LOW - three small offline-marks fixes (one PR)

1. **onBlur write-through publishes a first-time student without the confirm.**
   `src/components/exam/OfflineMarksEntry.tsx`, `commitRow` and the absent toggle: the branch
   `if (anyPublished && isMarkRowDecided(row))` calls `updateMark` for ANY decided row. Change
   the condition to `row.isPublished` (correcting a live mark) and route unpublished rows to
   the draft save; first-time publishing stays behind the Update button's confirm.
2. **Update can double-send a row whose blur save is in flight.** Same file, the Update
   button: add `updateMark.isPending || saveDraft.isPending` to its `disabled` condition.
3. ~~Trigger bypass should key on the exam's mode~~ - database job, moved to the Tushar-owned list. Naman does items 1 and 2 only.

**Done when.** On a partially published exam, typing a mark for an unmarked student and
tabbing away does NOT publish them; Update asks "Confirm publish N new?"; double-tapping
Update sends one request.

**Done (2026-10-05, Naman), items 1 and 2.** `commitRow` and `toggleAbsent` write through only
when `row.isPublished` (correcting a live mark); an unpublished row goes to the draft save. Because
a drafted row is no longer dirty, Update's candidate list became "decided and (dirty or not yet
published)", so the newly drafted student is exactly what Update offers to publish, behind the
existing "Confirm publish N new?" two-tap. Update is also disabled while `updateMark` or `saveDraft`
is pending. One more guard was needed to meet the "double tap sends one request" line:
`isPending` alone has a render-cycle gap (the second tap of a double tap lands before React
disables the button) and the stubbed run sent two publishes; a synchronous `sendInFlight` ref on
Publish and Update closes it. Verified in the browser (OfflineMarksEntry mounted against a stubbed
client recording every write, a 3-student exam with one published mark, 600 ms round trips, 375px
light and dark, 28 checks): blur on an unmarked student writes one `offline_student_marks` upsert
and nothing to `final_results`; Update is disabled through the in-flight save (sampled every
50 ms) and enabled after; Update reads "Confirm publish 1 new?"; a double tap on the confirm
produces exactly one `offline_student_marks` upsert, one `student_exam_attempts` insert, one
`final_results` upsert and one "Updated results for 1 student" toast; correcting the already
published student writes through on blur with no confirm. Screenshots:
`~/Desktop/Task6-offline-marks-2026-10-05`.

---

## Task 7 - status: done 2026-10-05 (naman-erp; the AuthContext.tsx line is NEEDS CORE) - LOW - comments and docs that now lie

Fix each so the next reader is not misled:
- `docs/superpowers/plans/2026-09-04-classroom-badges-db-rollout.md`: §1 says "3 triggers", the file creates 4; the table row "Read RPC the page calls (no role guard; catalog-driven)" must say `teacher_badge_rarity()` filters `role = 'teacher'` (Task 3); precondition P4 about a NULL timezone is impossible (column is NOT NULL DEFAULT 'Asia/Kolkata').
- `.claude/skills/salci-module-notes/SKILL.md` around "activeViewRole is teacher or coordinator" for the OnboardingJourneyPanel: there is no page-level switcher any more; the panel shows whenever the resolved badge type is teacher.
- `src/contexts/AuthContext.tsx` header comment: the 5-minute cache + single-flight already existed before the provider (commit 1e43906); the provider removed the N listeners and the per-mount loading flash, not a SELECT storm.
- `src/components/ui/question-image-upload.tsx`: "quality 0.92" vs code 0.9 (if not already fixed in Task 2).

**Done (2026-10-05, Naman), three of four.** Rollout doc: "3 triggers" is "4 triggers" (the file
creates `trg_zz_teacher_badges_lesson_planned`, `_lesson_planned_upd`, `_syllabus`,
`_syllabus_upd`); the read-RPC table row now says `teacher_badge_rarity()` filtered `role =
'teacher'` and that `20260907110000` (Task 3) widened it; P4 is marked "(none)" because
`institutions.timezone` is `TEXT NOT NULL DEFAULT 'Asia/Kolkata'` since `20260525120000`. Skill:
the OnboardingJourneyPanel note now says the panel shows whenever the page's resolved badge type is
`teacher` (`showOnboardingJourney = userBadgeType === "teacher"` in `AchievementsPage.tsx`) and that
there is no page-level switcher. `question-image-upload.tsx`: fixed in Task 2 (reads 0.9). **Not
done: `src/contexts/AuthContext.tsx` header comment**, because that file is on the load-bearing list
(section 28: "Do NOT edit without Tushar, and never as a drive-by"), a rule written after this task.
NEEDS CORE: replace the "sustained /rest/v1/profiles storm" sentence in the header with: the
5-minute cache and single-flight dedupe predate the provider (commit 1e43906); the provider removed
the N `onAuthStateChange` listeners and the per-mount loading flash.

---

## Task 8 - status: done 2026-10-05 (naman-erp) - LOW - dead code

- `src/hooks/useAuth.ts`: `useRequireAuth` has zero consumers; delete it and its now-unused imports.
- `src/hooks/useOfflineMarks.ts`: `useUpsertOfflineMark` has zero consumers and its `onError` uses raw `toast.error(err.message)` (§19); delete it.

Confirm zero consumers with `git grep -n <name> -- src` and paste the (empty) result.

**Done (2026-10-05, Naman).** `useRequireAuth` deleted from `src/hooks/useAuth.ts` with its
`useEffect` / `useNavigate` / context imports (the file is now the two re-exports and the comment);
`useUpsertOfflineMark` deleted from `src/hooks/useOfflineMarks.ts`. Before deletion `git grep -n
useRequireAuth -- src` and `git grep -n useUpsertOfflineMark -- src` each returned only the
definition line; after deletion both return nothing (pasted in the commit body). `src/hooks/useExamEditor.ts`
(no importers, spotted in Task 1) is left for a separate decision; it is a whole hook, not a stray
function.

---

## Task 9 - status: done (already the case on main; recorded 2026-10-05) - LOW - lazy-load the heavy exam routes

`src/App.tsx` imports `CreateExam`, `AchievementsPage`, `ExamAttemptPage` and
`HybridEvaluatePage` statically, so the paper renderer, validator, lightbox and marking
tools ship in the 7 MB main chunk to every login. Convert those four to
`lazy(() => import(...))` inside the existing `Suspense` (see how `SupportPage` is done at the
top of the file). Verify by comparing `dist/assets/index.*.js` size before and after in the
PR. Do this last; it touches routing for everyone.

**Done (recorded 2026-10-05, Naman; no change needed).** `src/App.tsx` on `main` already has all
four as `lazy(() => import(...))`: `CreateExam` (line 107), `AchievementsPage` (117),
`ExamAttemptPage` (125), `HybridEvaluatePage` (129), next to `SupportPage` (42). A fresh
`npx vite build` on 2026-10-05 puts the entry at `dist/assets/index.*.js` = 1,242 KB (the "7 MB
main chunk" above predates this), with `ExamAttemptPage.*.js` its own 691 KB chunk. `App.tsx` is
on the section 28 load-bearing list, so nothing was edited; this entry only records the fact.

---

## Task 10 - status: done 2026-10-05 (naman-erp) - LOW - delete the pending-catalog bridge

**Why.** `src/components/achievements/teacher/pendingTeacherCatalog.ts` exists only to show
the 21 round-3 tiles before their migration is applied. Once every row comes from the server
its only remaining effect is a trap: any teacher badge later deactivated server-side would be
resurrected by the mirror as a fake "pending" tile.

**Where.** `pendingTeacherCatalog.ts`; the `mergePendingCatalog` call in
`src/hooks/useTeacherAchievements.ts`; `isPendingBadge` / `PENDING_BADGE_HINT` in
`src/components/achievements/teacher/TeacherAchievementsView.tsx`.

**Build.** Delete the file and the three call sites; the `display` prop goes back to
`toBadgeDisplay(badge, data?.progress[badge.id])` and `candidates` back to
`toNextBadgeCandidates(data)`.

**Done when.** `git grep -n pending -- src/components/achievements src/hooks` is empty and the
Achievements page shows exactly the server catalog (count in the hero equals
`SELECT count(*) FROM badge_definitions WHERE badge_type='teacher' AND is_active`).

**Do not.** Do not start before the prod-state table above says `20260904160000` is APPLIED.

**Done (2026-10-05, Naman).** `pendingTeacherCatalog.ts` deleted; `useTeacherAchievements` returns
the server payload as is; `TeacherAchievementsView` passes `toBadgeDisplay(badge,
data?.progress[badge.id])` and `toNextBadgeCandidates(data)` again. `git grep -n pending --
src/components/achievements src/hooks` returns only the dashboard hooks' unrelated `pending`
counters (leave requests, grading), none in `src/components/achievements`; pasted in the commit
body. The hero count now equals the server catalog by construction; Tushar's SELECT is the
cross-check.

**Measured rungs for that migration (prod, 2026-09-07), for the re-pacing decision:**

| metric | people ≥1 | ≥5 | ≥10 | ≥25 | ≥50 | max | file rungs | note |
|---|---|---|---|---|---|---|---|---|
| exams_published | 95 | 62 | 43 | 19 | 3 | 78 | 1/10/25 | gold 25 = 19 day-one golds, not a summit |
| results_published | 91 | 47 | 27 | 7 | 1 | 54 | 1/10/25 | |
| ai_questions_saved | 63 | 62 | 57 | 50 | 41 | 789 | 1 | single rung |
| questions_authored | 19 | 4 | 2 | 0 | 0 | 16 | 10/50/200 | bronze 10 reachable by 2 people; only 82 manual questions exist platform-wide |
| students_remarked | 10 | 1 | 1 | 0 | 0 | 12 | 5/20/50 | bronze 5 reachable by 1 person |
| leave_reviews_done | 16 | 3 | 1 | 0 | 0 | 11 | 1/10/30 | |
| substitutions_covered | 6 | 0 | 0 | 0 | 0 | 1 | 1/5/15 | only 6 covers ever assigned in prod |
| templates_created | 16 | 0 | 0 | 0 | 0 | 3 | 1 | single rung |
| templates_shared | 1 | 0 | 0 | 0 | 0 | 1 | 1 | single rung |

---

## Task 11 - status: done 2026-09-16 (f99a2a65) - MEDIUM - the Tasks board swallows cards on the My Tasks tab

**Problem (found in the 2026-09-09 review of round 2).** `TaskBoardView` is fed the active tab's list. On
"My tasks" that list is `[...inProgressTasks, ...openTasks]`, so the In Review, Done and Rejected columns
can never hold a card, and a card dragged from In Progress to In Review disappears the moment the
optimistic update lands (it now lives on the Pending tab). Admins and coordinators on "All tasks" get the
full lifecycle; the teacher, who is the main user, gets three dead columns and vanishing cards.

**Fix.** When the board view is active, give it the whole lifecycle for that tab's source: for
"my-tasks" every live row from `myTasks` (open, in_progress, done_pending_approval, rejected) plus the
completed ones from the same source, all through the same date filter. Do the equivalent for
"assigned-by-me" and "supervising" (include completed). The Cards view keeps today's tab split.

**Do not:** change what the Cards view shows; add a query or a hook; touch the database.

**Verify:** as a teacher, drag a card To Do -> In Progress -> In Review; it stays visible in each column.
375px and dark-mode screenshots of the board, ungrouped and grouped by assignee.

## Task 12 - status: done 2026-09-16 (f99a2a65) - LOW - one role switcher, not two

`src/pages/ExamsPage.tsx` still renders its own `ScopeSwitcher` (about line 526) and its comment blocks
(about lines 172-182 and 1208-1220) say the app-bar chip is a static label. Since 2026-09-09 the compact
`RoleSwitcher` in `AppLayout` covers every page, so the page shows two controls for one state. Remove
the page-local switcher and rewrite the stale comments; check `AchievementsPage.tsx` (about line 512) for
the same stale wording. Do not touch `ActiveRoleContext`.

`TasksPage.tsx` after `bfed6aa5` is the reference: it reads `activeViewRole` and `hasDualRole`, gates on
`isCoordinator && (!hasDualRole || activeViewRole === "coordinator")`, keeps admin first, and mounts no
switcher of its own. Copy that shape.

## Task 13 - status: done 2026-09-16 (f99a2a65) - LOW - mirror the evidence rule on the board, drop a dead export

The database trigger `validate_task_state_transition` refuses In Progress -> In Review when the task has
no evidence (`task_has_evidence`). `dropRefusal` in `src/lib/taskBoard.ts` does not check
`task.evidence?.length`, so that drop goes to the server, fails, rolls back and toasts the trigger's
message. Add the check next to the other refusals with plain copy ("Attach evidence before sending this
for review.") so the refusal is instant and the card never moves. Also delete the unused
`SUPPORT_MOVE_DENIED` export in `src/lib/supportBoard.ts`.

## Task 14 - status: done 2026-09-16 (f99a2a65) - LOW - screenshots owed for round 2

Commits `0613acbe` and `ce1122fb` say "Not verified: no 375px or dark-mode screenshots". Send them with
the next `pushed:` message: Tasks board (ungrouped and grouped), Support Inbox board, `/support` board,
the bell popover (list, empty, error), the compact role switcher at 375px for a teacher+coordinator.

---

## Task 15 - status: done 2026-09-16 (f99a2a65) - MEDIUM - rejected work is invisible on /tasks

**Problem (2026-09-09 review).** `TasksPage` builds its tabs from four statuses, `open`,
`in_progress`, `done_pending_approval` and `completed`, plus the cancelled bucket. The string
`"rejected"` appears nowhere on the page. So a task an approver sent back for rework sits on no
tab in Cards view, and the board's Rejected column can never fill in either view. Production has
13 rejected tasks right now. The assignee is told to redo the work and then cannot find it.

**Fix.** Rejected work belongs on My Tasks, because the assignee is the person who has to act on
it: include `status === "rejected"` in that tab's source alongside open and in-progress, and make
sure the card reads as needing rework rather than as finished. Task 11 already widens the same
source, so do the two in one pass. Tabs that show other people's work (Assigned by me,
Supervising, All tasks) should carry rejected rows too.

**Do not:** add a new tab; add a query or a hook; touch the database.

**Verify:** as a teacher holding a rejected task, it appears on My Tasks in Cards view and in the
board's Rejected column, and dragging it back to In Progress works. 375px and dark mode.

---

## Task 16 - status: done 2026-09-16 (f99a2a65) - MEDIUM - the quick-actions button drifts, and the phone test you owe

**16.1** `src/components/layout/FloatingActionButton.tsx` (~line 122). The resize handler re-clamps
from the CURRENT position and commits the result, so the user's intended coordinates are destroyed.
Every transient viewport shrink (a mobile keyboard opening, a rotation, a desktop window resize)
moves the button permanently up the screen, and it never returns when the viewport grows back.
Fix: keep the intended position in a ref, set it on load and on drag end, and on resize clamp from
THAT for display instead of overwriting it.

**16.2** Same file (~line 314). The drag handle now declares `role="button"` and an `aria-label`
but has no `tabIndex` and no key handler, so a screen reader announces an operable control that
cannot be operated. Either make it properly keyboard-operable (arrow keys nudge the position) or
drop the role and label it presentational.

**16.3** You wrote "Tushar: please drag-test on a phone before merging". Nobody has. The menu flip
and the viewport clamp were both fixed during the merge on geometry alone. **Drag-test on a real
phone**: portrait and landscape, drag to all four corners, open the menu at each, rotate mid-drag.

**Do not:** change the Nova mascot reserved zone; touch data fetching.

## Task 17 - status: done 2026-09-16 (f99a2a65) - MEDIUM - the Activity Logs can assert deletions that never happened

The new timeline is the one surface people will trust to answer "who removed this", so a false row
is worse than a missing one. Four ways it can currently lie, all introduced by round 4:

**17.1** Nine or more `logDeletion` sites write the audit row on the bare "no error" signal from a
PostgREST delete. CLAUDE.md §6: a DELETE blocked by RLS returns exactly that, empty data and no
error. So a delete the database refused is recorded as a completed deletion. Use the repo's
existing proof pattern (`useDeleteSchoolSubject`): re-select by id, and treat "row gone" as the
only success signal, before logging.

**17.2** `src/hooks/useExamDrafts.ts` (~line 264): the delete is filtered and can match zero rows,
yet "Exam draft deleted" is logged unconditionally.

**17.3** `src/hooks/useTasks.ts` (~line 854): `logCreation` sits BETWEEN two dependent writes, so a
task whose assignment row failed is recorded as created while the user is told the save failed.

**17.4** `src/hooks/diary/useDiaryMutations.ts` (~line 68): `diary_write_entry` returns early
without writing when the entry id already exists, but the log fires anyway, so a re-save records a
second "Diary entry created" for one entry.

**Do not:** write SQL. The real fix is the server-side capture in your own
`docs/superpowers/specs/2026-09-11-activity-logs-design.md`, which is Tushar's. This task is only
about not asserting things the client cannot know.

## Task 18 - status: done 2026-09-16 (f99a2a65) - LOW - four places the Activity page states what it cannot know

All in `src/pages/admin/ActivityLogsPage.tsx` and `src/hooks/useActivityLogs.ts`:

**18.1** Each day header prints the number of LOADED events for that day as if it were the day's
total. Either label it as loaded-so-far or drop the number.
**18.2** The empty state decides "filters are active" with `filters !== EMPTY_FILTERS`, an
object-identity check that is true for every fresh filter object the filter bar builds. A school
with genuinely no activity is told "Nothing matches these filters". Compare by value.
**18.3** Export CSV exports only the pages already loaded, further narrowed by the client-side
search, and reports plain success. Say what it exported, in the button or the toast.
**18.4** In the deletion ledger, an actor whose `profiles` row the viewer cannot read renders as
"System", so a human deletion is attributed to the platform on the one screen built to say who did
it. Render "Unknown" or the raw id instead, and never "System" unless the actor really is null.

## Task 19 - status: done 2026-09-16 (f99a2a65) - LOW - AI Generate: cap the fan-out, reconcile the band

**19.1** One Generate click can now fire up to `2R+1` sequential edge-function calls, where R is the
number of distinct bands across all rows, with no cap, no warning and no single-flight guard on the
Generate button itself. Add the guard, and tell the author when their picks will split a row into
several requests.
**19.2** The band the author picks is never checked against what comes back: the stored and
displayed `difficulty_level` is whatever the model echoed, and for Class 1 and below the server
clamps the level with no signal in the UI. Either stamp the requested band onto the returned rows
or show what was actually returned, and say so when early-years clamping applied.
**19.3** A per-batch failure toast names only the chapter, so with a row split across bands the
author cannot tell which part failed. Include the band.

**Do not:** change the default (Hard = 5), the Easy 2 / Medium 3 / Hard 5 mapping, or the
server-side early-years clamp.

## Task 20 - status: done 2026-09-16 (f99a2a65) - NIT - Classes page polish

`src/pages/school/SchoolClassesPage.tsx`: cards override the radius token with `rounded-xl` (12px)
where `--radius-card` is 20px and every other page that overrides uses `rounded-2xl`, so these
cards are visibly squarer than cards elsewhere; the Active status dot uses a raw Tailwind palette
colour that does not flip in dark mode; the Retry button gives no feedback while refetching (the
query stays in the error state and nothing changes on screen); and `StatCell` is now defined twice
in two different pages rather than living next to the `StatTile` primitive.

## Task 21 - status: done 2026-10-05 (naman-erp) - MEDIUM - the phone input, redone without corrupting numbers

`62668057` (fixed +91, 10-digit limit) was held back from the round-9 merge. Its five files were
restored to main's versions, so after you pull, `PhoneInput.tsx` is gone and the four forms are
as they were. Redo it with these two fixed; both were confirmed by running your function:

1. **A leading 0 silently corrupts the number.** Many people type `09876543210`. The cleanup
   drops a leading `91` but not a leading `0`, then keeps the first 10 digits, so the saved
   number is `0987654321` and the real last digit is gone. `0091 98765 43210` saves as
   `0091987654`. The `91` rule also fires on a REAL mobile that starts with 91: `9123456789`
   plus one accidental extra digit becomes `234567890`. Normalise a leading `0`, `+91` and
   `0091` first, strip a bare `91` only when exactly 12 digits remain, and if more than 10
   digits are left, refuse with a message rather than cutting.
2. **A school's contact phone is not a mobile.** `institutions.contact_phone` is printed on every
   question-paper letterhead and every exam and student PDF. A landline such as `0172-2345678`
   is cut to `0172234567`. Keep that field free text, or give it a landline-aware input.

Also, smaller: nothing enforces 10 digits before save, so a 7-digit number is stored and the
phone-login lookup (which needs exactly 10) never matches it; there is no `maxLength`, so typing
into a full field quietly rewrites digits; existing non-Indian numbers are displayed rewritten
(`+44 7911 123456` shows as `4479111234`) and would be saved that way if the form is re-saved;
the `+91` is 14px beside 16px digits at 375px; and the file exports a helper beside the
component (a `react-refresh/only-export-components` warning). Prove that opening and re-saving
an OLD record never changes a stored number nobody touched.

**Done (2026-10-05, Naman).** Helpers live in `src/lib/phone.ts` (no export beside the component):
`normalizeIndianMobile` removes prefixes only when the length says they are prefixes (`0091` at 14
digits, `91` at exactly 12, a trunk `0` at 11) and NEVER cuts: anything not landing on 10 digits is
refused with a reason (`too_short` with the count, `too_long`, `not_a_number`). `phoneToSave(current,
stored)` returns the stored value byte for byte when the field was not edited, null when cleared, the
10 digits when valid, or a message. `src/components/shared/PhoneInput.tsx`: `+91` drawn inside the box
at the Input's own type scale (`text-base md:text-sm`, measured 16px = 16px at 375px), digits only,
an 11th typed digit on a full field is ignored, pastes with `+91` / `0091` / `0` normalise, over-long
input is kept whole with the "more than 10 digits" message. A stored value that is not an Indian
mobile (`+44 7911 123456`, a landline) renders exactly as saved, read-only, with Replace; only
Replace or typing starts a 10-digit entry. Wired into `AddUserDialog` (blocks a student phone that is
not 10 digits before the create call, sends the digits), `EditUserDialog` and `ProfilePage` (both
save through `phoneToSave`). `institutions.contact_phone` in `EditInstitutionDialog` stays free text
(it is a landline on the letterhead). Proof: 23 node assertions on the helpers (every case above
including `09876543210` -> `9876543210`, `0091 98765 43210` -> `9876543210`, `9123456789` untouched,
`91234567890` refused not trimmed, `+44 7911 123456` refused never rewritten, untouched stored values
returned unchanged for five shapes); 29 browser checks at 375px light and dark against a stubbed
client (typing digit by digit, the 11th digit, both pastes, the two refusals, the font-size pair, the
read-only legacy view with no onChange on open; the real `EditUserDialog` over a profile stored as
`+44 7911 123456`: Save sends `phone: "+44 7911 123456"` unchanged, a 7-digit edit is not saved, a
full edit saves `9876543210`). Screenshots: `~/Desktop/Task21-phone-2026-10-05`. Note for the
compiler: the project has `strictNullChecks: false`, so the call sites narrow with `=== false`.

---

## Task 22 - status: done 2026-10-09 (naman-erp; server halves live, status note items 13 to 49) - HIGH - finish the online (residential) PTM

The database half of your `61a0087a` is live (migrations `20261005160000` to `20261005160300`).
What exists and where it differs from your contract:
`docs/superpowers/specs/2026-10-05-ptm-online-server-status.md`. The rest is yours; anything more
you need from the server, write it as `NEEDS DB` / `NEEDS EDGE FN` as usual.

**Done (2026-10-05 to 2026-10-09, Naman).** Followed the live shapes in `bf2df903` (cutoff 0,
`ptm_booking_meet`, `user_google_accounts`, jsonb pick options, `slot_starts_at` / `slot_ends_at`),
then the rest of the online PTM on `naman-erp`: "Online PTM" wording and the class-first admin flow
(`0f4b8f15`), per-teacher hours and Meet rooms (`a23ff4fc`, `2f337875`), class sessions
(`860dacd3`, spec 2026-10-06), teachers pick their students from Edit (`17537a99`), your merge
review of 2026-10-07 (`aa6b96aa`), and Separately only with several teachers per student
(`e9d4897d`, spec 2026-10-09). Every NEEDS DB from those commits is applied on prod (status note
items 13 to 49). Nothing open on the frontend; the APK gets rebuilt from `main` after the merge.

---

## Owned by Tushar (not Naman) - listed so they are not lost

- ~~Three migrations waiting to be applied~~ all three applied and verified 2026-09-07 12:40 IST
  (`20260904160000` took 3.5 s). Nothing is pending on the database.
- ~~Task 6.3~~ done: `20260907130000` applied.
- ~~`question-images` bucket limits~~ done: `20260907120000` applied.
- Task 5 (`save_offline_section_marks` RPC + hook change): deferred. It rewrites a live marks
  pipeline and must be functionally tested against a database before the hook that calls it
  ships; do it in a session with prod SQL access or a local Supabase, RPC first, hook second.
- ~~Round-1 ERP database halves (notice fan-out, School Diary)~~ both applied 2026-09-08 (`20260908120000`, `20260908130000`), probed end to end, types regenerated. Diary is live for Salci National School.
- All database work in general: Naman writes none.
- **OPEN, correctness + authorization (2026-09-16, found reviewing round 6).** Every rule in
  `validate_task_state_transition` is keyed on the OLD status, so any transition whose OLD value
  no rule anticipated skips EVERY check. It is not hypothetical: `task_audit_logs` records
  `open -> completed` 3 times, `in_progress -> completed` 2, `open -> done_pending_approval` 2,
  `in_progress -> rejected` 1, `in_progress -> open` 3. The first two mean a task reached Completed
  with no approver check and no self-approval check; the third means evidence was never asked for.
  **The obvious fix, keying the rules on the DESTINATION, would break Salci Support.**
  `_support_apply_status` moves a linked task `open|in_progress|rejected -> completed` and
  `open|in_progress -> rejected`, and steps `done_pending_approval -> in_progress`, all as a super
  admin who is neither the assignee nor the assigner. So a destination-keyed rule must carry an
  exemption for the support institution, shaped like `guard_support_task_mutations`. Do it
  deliberately, with the support flow probed, not as a drive-by.
- **OPEN, Naman's NEEDS DB (round 6):** make evidence optional when submitting to review. Note the
  board is currently STRICTER than the server: it requires evidence on every path into In Review,
  because the trigger only checks the In Progress path and To Do -> In Review would otherwise be a
  one-drag way round the rule. If the requirement is dropped, remove `TASK_NEEDS_EVIDENCE` in
  `src/lib/taskBoard.ts` in the same change.
- **OPEN, three pre-existing things Naman spotted while shooting round 6** (none introduced by him):
  `useClasses` filters `is_active = true` server-side, so `SchoolClassesPage`'s "Archived" label and
  `opacity-60` branch are unreachable in production; filter chips using `bg-white/85` (ExamsPage
  Status/Filters, the TaskDateFilter "Date" chip, support "Awaiting SALCI"/"All schools") render as
  near-white pills in dark mode; and `TaskCard.tsx:110` renders `priority === 1` as "High Priority"
  while the board and `CreateTaskDialog` treat 1 as Low, so one of the two is lying.
- ~~Activity feed indexes~~ done 2026-09-14: `20260914120000_activity_feed_indexes.sql` applied.
  `task_audit_logs` and `exam_publication_logs` had no index on `created_at` while the new feed
  orders both by it on every page plus a HEAD count each per KPI refresh. Both now carry
  `(created_at DESC, id DESC)`, which also serves the id tiebreaker the cursor fix added.
- OPEN, from round 4's `NEEDS DB`: capture activity SERVER-side. Naman's spec
  (`docs/superpowers/specs/2026-09-11-activity-logs-design.md`) proposes a generic row-audit
  trigger, indexes, an optional `activity_feed` RPC and retention. This is the real fix for Task
  17: client-side logging can be skipped, can be wrong when RLS blocks the write, and is
  forgeable (see the next item). Worth doing properly before the page is leaned on.
- OPEN, SECURITY, pre-existing but newly load-bearing: `log_audit_event` is SECURITY DEFINER and
  granted to `authenticated`, so ANY signed-in user can write a `system_audit_logs` row with any
  action, entity, values and `metadata.institution_id`. `actor_id` is stamped from `auth.uid()`
  so WHO cannot be forged, but WHAT can, and the read policy keys on
  `metadata->>'institution_id'`, so a row can be aimed at another school's Activity page. Round 4
  turns that table into a trusted surface. Fix with the server-side capture above, then revoke
  the RPC from `authenticated`.
- OPEN, pre-existing, found during the round-4 review and worth its own look:
  `SchoolClassesPage` falls through to the WHOLE institution's class list when a coordinator's
  wing lookup returns nothing (no mapping, or a failed wing query), which is a scope leak, not a
  cosmetic issue; `ChangeRoleDialog` replaces roles with a client DELETE then INSERT and
  `useClassGroups` deletes a group's sections then the group, both two dependent client writes
  that §9a forbids; `useClasses` uses `select("*")` with no `range()` and then fans out two HEAD
  counts per class (1 + 2N round trips per page); and `csvCell` in the activity export escapes
  quotes but not leading formula characters, so audit text becomes a live formula in Excel.
- OPEN (2026-09-09, raised by Naman in `bfed6aa5`, spec item 4 now DECIDED): drop the policy
  "Teachers can view all tasks in their institution" (`20260128064058`) so a teacher reads only
  tasks they were assigned, assigned themselves, or supervise. The participant policy plus the
  supervisor policy from `20260909150000` already cover those three, and `task_assignments`,
  `task_comments` and `task_evidence` have no teacher-wide policy to match. His reasoning is
  sound and it retires the "Not visible to you" label entirely. Before applying, check the two
  hooks that count tasks institution-wide without going through `useInstitutionTasks`:
  `useDashboardData.ts` (a `{ count, head: true }` over `tasks`) and `useWorkforceData.ts`, so a
  teacher-facing tile does not silently drop to near zero.
- OPEN (2026-09-09, found reviewing the migration I had just applied): `coordinator_covers_task`
  matches the task's assignee OR its assigner, while `dash_scoped_task_queue` and
  `dash_scoped_task_stats` scope on the assignee alone. So the coordinator dashboard tile and the
  Tasks page now disagree (Alliance coordinator aac76667: 463 vs 634; pilot Primary Wing: 53 vs
  96). The assigner arm is also not really a wing scope: at the pilot school one teacher with a
  single Primary Wing class row assigned 48 of 103 tasks, so all 48 became Primary Wing tasks
  whoever they are for. Recommended fix, one small migration: drop the assigner arm so the policy
  matches the dashboard exactly; coordinators keep what they personally assigned through the
  existing participant policy.
- OPEN (2026-09-09): wing membership comes from class rosters, so admin-assigned tasks belong to
  no wing and are invisible to every coordinator (about half the pilot school's 103). Options:
  put admins on a wing, start writing `tasks.wing_id` at creation, or accept it and say so on the
  page. `tasks.wing_id` is NULL on all 1,027 production rows.
- ~~NEEDS DB (round 2): coordinator wing-scoped task visibility~~ done 2026-09-09: `20260909150000_coordinator_wing_task_visibility.sql` applied and probed as a pure coordinator (institution-wide tasks with zero visible assignment rows before; wing + own + supervised tasks after, every one with its assignment row). Teacher+coordinator accounts still see the institution through the teacher policy, now with names on wing tasks. Teachers themselves left as is (spec item 4), and `tasks` gained the supervisor SELECT policy it never had.
- ~~NEEDS DB (round 2): `notice_unread_count()`~~ done 2026-09-09: `20260909151000_notice_unread_count.sql` applied (RPC + partial index); `useUnreadNoticeCount` in `src/hooks/notices/useNoticeFeeds.ts` replaces the page-load count in `CommunicationPage.tsx`.
- Product call (round 2): `SupportThread` now aligns the VIEWER's own messages on the right (chat convention). The 2026-08-31 design pinned the reporter on the right on both surfaces so screenshots read the same everywhere. Keep or revert; five lines either way.

- ~~Apply `20260904150000` (with Task 3's rarity fix); run the runbook §5 checks.~~ done 2026-09-07, all §5 checks green.
- ~~`HybridEvaluatePage` renders `markingPanel` twice on phones, duplicating `hybrid-feedback-<id>` ids.~~ done 2026-09-07 (the panel is a render function with an id prefix per copy).
- ~~Add `ORDER BY tb.id` to both `INSERT ... SELECT FROM tb` statements in `20260904150000`~~ done 2026-09-07 in the unapplied file (deadlock safety between two evaluator runs for the same teacher).

---

## How Tushar reviews `naman-erp`

1. `git fetch origin`, then `git diff main..origin/naman-erp --stat`. Anything under `supabase/` is a stop: ask him to remove it and do the DB part yourself.
2. Run the gate on a worktree of the branch (typecheck, eslint on changed files, vite build); do not trust the pasted output alone.
3. Read the diff against the task's "Do not" items; check 375px + dark-mode screenshots arrived.
4. Merge with `git merge --no-ff origin/naman-erp` (no squash, no rebase) and push.
5. Move the task's status to `done - <date> - <commit>` here in the same push.

Rounds so far: 2026-09-05 `naman-branch` (70846b6), 2026-09-07 badges (cd62bd83), 2026-09-08 `naman-erp` round 1 Communication rebuild (90114c44), 2026-09-09 round 2 (bell redesign, unread tab badges, Kanban boards for tasks and support, app-bar role switcher; conflict in `AdminIssuesPage.tsx` resolved by Tushar, Tasks 11-14 opened).
