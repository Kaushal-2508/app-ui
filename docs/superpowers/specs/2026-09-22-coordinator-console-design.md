# Coordinator Console — Design

Date: 2026-09-22
Surface: `/school/snapshot` (coordinator branch)
Reference: `public/report_reference/salci-coordinator-dashboard2.html`
Status: implemented, live in prod
Supersedes: `2026-08-25-coordinator-dashboard-rebuild-design.md`

## Why

The coordinator view of `/school/snapshot` ran on the `dash_scoped_*` family and
a set of one-off widgets. The admin Command Center had meanwhile been rebuilt as
v5 (`2026-09-16-admin-dashboard-v5-design.md`) on a single `(class, subject)`
atom, and none of it was reachable from a coordinator account.

Not "empty" — **unreachable**. Every `dash5_*` function opens with

```sql
v_inst := public.dash_resolve_institution(p_institution_id);
```

and that helper RAISES for anything but `super_admin` / `school_admin` /
`super_school_admin`. Thirty-three functions, every chart and table on the v5
page, erroring rather than returning rows.

## The decision that shaped everything: scope by CALLER, not by argument

A coordinator's scope is a wing, and a wing is an attribute of the person, not
of the request. So no function gained a parameter. Each one asks
`dash5_caller_wing()` who is calling and clamps itself.

* admin → `dash5_caller_wing()` returns NULL → behaviour byte-identical
* coordinator → returns their wing → every row clamped to it

This kept all 33 signatures, every PostgREST call site and every generated type
exactly as they were, and it makes the leak impossible to reintroduce from the
client because **there is no argument to forge**.

### Fail closed

A coordinator with no wing assignment RAISES. It does not fall through to a NULL
wing, because NULL means "the whole school" one line later. That precise
confusion shipped on 2026-09-18, when a coordinator scope guarded by
`classIds.length > 0` showed 5 of 24 production coordinators the entire
institution. **The presence of a scope is the signal, never its size.**

Verified: `Coordinator 2` at Salci National (role held, no wing) is refused by
`dash5_tree`, `dash5_filter_options` and `dash5_attendance_series` alike.

## What stays admin-only, deliberately

`dash5_coordinators`, `dash5_school_wide_needs`, `dash5_attendance_by_wing` and
the three `dash5_report_*` functions keep the OLD resolver. A coordinator
calling one gets "not authorized", which is the correct answer:
`dash5_coordinators` ranks every wing's coordinator against the others, and
`dash5_school_wide_needs` is explicitly the items that belong to no wing.

Two reused cards had to be changed because they reached for admin-only data:

| Card | Reached for | Fix |
|---|---|---|
| `Dash5TeacherActivity` | `dash5_coordinators`, only to fill a wing picker it does not show when locked | `useDash5Coordinators(enabled)` |
| `Dash5SubjectPerformance` | `dash_school_subject_performance` / `dash_subject_performance` | new `CoordSubjects` card on `dash5_coord_subjects` |

Both were found by the harness's fixture-miss list, not by reading.

## Migrations

| File | What |
|---|---|
| `20260922100000_dash5_coordinator_scope.sql` | the five helpers, then a mechanical pass that rewrites 17 functions from `pg_get_functiondef` |
| `20260922110000_..._part2.sql` | the three with no wing axis: `filter_options`, `attendance_series`, `needs_by_wing` |
| `20260922120000_dash5_coord_desk_and_classes.sql` | scope, cards, desk, classes, staff, leave, rechecks, my tasks |
| `20260922130000_dash5_coord_timetable.sql` | cover, slot grid, logging backlog, attendance by class |
| `20260922140000_dash5_coord_suggestions_comms.sql` | wing-native task suggestions, communication |
| `20260922150000_dash5_coord_subjects.sql` | subject-wise performance for a wing |

### Why the first one is a loop and not 17 edits

Seventeen functions differ only in which axis they carry, and all seventeen
opened with the identical resolver line. Hand-editing seventeen bodies to insert
two lines each is how one gets missed, and a missed one is a **silent
cross-wing leak** rather than an error. So the edit is written once, driven off
`pg_get_functiondef`, and it raises if any function does not carry the line it
expects **and** if it rewrote a count other than 17.

Both wing AND class are clamped, not just the wing: at subject level
`dash5_tree` filters by class and ignores the wing entirely, so clamping only
the wing would still hand over another wing's class if its id were passed.

## Numbers that must agree, and do

Measured against Alliance International School, Middle wing (coordinator Rosy
Sharma), 2026-09-22:

| Figure | Value | Cross-check |
|---|---|---|
| Classes | 9 | 18 `wing_class_mappings` rows, 9 to active classes |
| Students | 253 | `dash5_tree` total == band donut total == 253 |
| Subject-class pairs | 171 | equals `dash5_atom_rows` for the wing |
| Teachers | 30 | equals `dash5_teacher_activity.total` |
| Wing average | 58.8% | against school 62.7%, the admin page's figure |

`subject_pairs` was the one that disagreed: it read 321 because it counted every
class ever mapped to the wing, including the nine retired ones. The scope bar
sits directly above the table, so it uses the table's rule (`classes.is_active`).

## Traps paid for during this build

* **`tasks.priority` runs the OTHER way from `reported_issues.priority`.**
  `dash_create_task_from_flag` writes 1 for a critical flag and `PriorityPill`
  renders `priority <= 1` as High, so **lower is more urgent**. The desk tile
  shipped backwards first (8 high-priority tasks reported as 0) and the
  suggestions emitted 3 for their most urgent draft. Default for a NULL is 2,
  which is what `create_task_group` writes.
* **The slot grid was drawn the wrong way round.** The reference puts DAYS on
  the rows and PERIODS on the columns, and prints the subject's first three
  letters in every cell (`-` when free), with the teacher on hover. Built
  transposed and unlabelled it read as a heat map of something unnamed: a chart
  *about* a timetable rather than the timetable. Fixed 2026-09-22; the RPC now
  returns `subject` and `teacher` per cell, the legend carries no counts, and
  the caption states them in words the way `renderTTGrid()` does.
* **The reference paints every cell `color:#fff`,** which measures 2.3:1 on its
  amber in light mode and 1.9:1 in dark, on 9.5px type. The cell text follows
  the fill's lightness here instead - white only where the fill can carry it -
  which puts every state between 4.1:1 and 9.8:1 in both themes while leaving
  the colours, and so the at-a-glance read, identical.
* **The slot grid derived its rows from `tt_slots`.** A period nobody had been
  assigned to therefore vanished from the grid — which is precisely the case the
  card exists to surface. Class 6 A drew periods 2,4,5,6,7,9,10,11 and silently
  dropped 1, 3 and 8. Rows now come from the class's period structure; 30 free
  cells appear where there were none.
* **`REVOKE ... FROM anon` does not strip a PUBLIC grant.** CLAUDE.md §26
  records the trap in one direction; it holds in the other too. Both are now
  written by name on all five helpers.

## Frontend

`WingLockProvider` pins every reused v5 card to one wing. It is **not** a
security boundary — the server already refuses — it exists so the cards stop
drawing a wing picker whose two options ("All wings", and the one wing) mean the
same thing. The wing is stated once, in the page header.

`useWingDrill` holds the rule the reference states plainly: *"The admin's top
level was wings. A coordinator has exactly one, so the table opens one level
down and the wing row becomes the footer total."* Four cards share it, so they
agree about where the top is. The band donut skips its middle ring for the same
reason: "which wing do these students come from" has one answer.

Teachers are untouched. A teacher's scope is a set of SUBJECTS, not a wing, and
no part of the console's wing arithmetic applies to them; `ScopedSnapshotPage`
still serves them. Rebuilding that view is its own piece of work.

## Verification

A browser harness (`harness.local`, gitignored) renders the real page against
fixtures captured from production as the real coordinator, intercepting
`supabase.rpc` **by RPC name rather than by React Query key**. That choice is
load-bearing: a key guessed wrong renders a loading state that photographs as a
pass, whereas an RPC nobody seeded shows up as an explicit miss. It is how both
admin-only call sites above were found.

Checked at 1280px and 375px, light and dark: 31 cards, zero fixture misses, zero
console errors, no horizontal overflow beyond the intentionally-scrolling tab
strip. A separate pass confirms the admin dashboard still opens at wing level
with its "All wings" crumb and no page errors, since five shared components were
edited.

## 2026-09-23: the slot grid became a lesson-plan grid

Tushar's instruction: the Timetable tab's grid should answer whether each
period's **lesson plan** was updated, "the lesson plan over everything", and not
whether a class was logged. A wing-wide one-day view was built first and
rejected the same hour; the shape stayed the reference's (one class, one week,
days down the side, periods across, a class filter), and only what the cells
say changed.

* `dash5_coord_slot_grid` is **dropped**; `dash5_coord_lesson_plans(p_class_id,
  p_week_start)` replaces it (migration `20260923100000`).
* Each cell prints the plan first (its chapter, or the teacher's note) and the
  subject second, coloured by one of nine states: done, note, skipped
  (updated); no_plan, not_updated, pending (not updated); planned, unplanned
  (still ahead); holiday.
* **"Over"** = the date is past, or it is today and the period's end time has
  passed in the institution's timezone. Only over periods count as behind, and
  the headline divides by them: "1 of 21 updated", not "1 of 48".
* Periods come from **`tt_effective_periods`**. The slot grid, the backlog and
  the "Periods logged today" KPI had all asked `tt_slots` for
  `slot_type IN ('theory','practical')`, the definition that hid 518 basket
  periods until 2026-09-10. All three moved onto the view and onto the same
  lesson-plan match (slot, date, **subject**) and "over" rule in the same
  migration, so they cannot quote each other different numbers.
* The KPI now reads updated over periods that have ENDED; the old version read
  "2 / 63" at 10:00 against a day that had taught eight periods.
* `syllabus_topics.chapter_number` is empty on all 4,540 rows, so the cell
  strips the number out of the chapter NAME ("Chapter-2 Playing with Numbers",
  Hindi "पाठ 2:") and keeps the full name for the hover.
* Known gap, unchanged: `dash5_coord_cover` still reads `tt_slots`, so an absent
  basket teacher's periods do not appear on the cover list. `tt_substitutions`
  is per slot, not per subject, which is a schema question, not a query fix.
