# Coordinator Dashboard Rebuild — Design

Date: 2026-08-25
Surface: `/school/snapshot` (coordinator branch of `ScopedSnapshotPage`)
Status: implemented

## Why

The coordinator view of `/school/snapshot` rendered the shared command-center
panels and nothing else. None of the things the PRD calls a coordinator's actual
job were on it: no wing standing, no adoption picture, no recheck queue, no task
queue, no digest. A mockup existed at
`public/report_reference/salci-coordinator-dashboard.html` but its data was
invented, and several of its figures contradicted the admin mockup it claimed
continuity with.

The decision taken was to stop mocking and build the real page against
production data.

## Naming

`/dashboard` is now "Home" for coordinators and `/school/snapshot` is
"Dashboard", extending the convention teachers and school admins already used.
Previously a coordinator had two sidebar entries competing for the word
"Dashboard" pointing at different pages.

Touched: `AppSidebar.tsx` (the Home/Dashboard condition), `CoordinatorDashboard.tsx`
(the landing tile, whose description also wrongly said "school overview" on a
wing-scoped page), `ScopedSnapshotPage.tsx` (page header).

## What the data actually supports

Probed against Alliance International School, Senior wing (coordinator Maninder
Kaur), AY 2026-27, on 2026-08-25:

| Signal | Reality |
|---|---|
| Wing size | 18 active classes, 579 students, 36 teachers |
| Wing average | 65.5% against a 67.4% school average, #3 of 4 wings |
| Student adoption | 167 of 579 have never signed in; 94 active in 7 days |
| Teacher adoption | 8 of 36 active this week; 2 have never signed in |
| Attendance | 10 of 18 classes missed the last school day; 7 logged nothing in 14 days |
| Tasks | 185 scoped tasks, 66 open, 49 overdue, 62.2% completion |
| Rechecks | 1 pending, open 26 days |
| Syllabus progress | **0 events** for this wing |
| Notices / circulars | **0** for the entire institution |
| Subject-level scores | `exam_subjects` unpopulated for these exams |
| Digital vs paper attendance | all 11,769 rows share one `method` value |

Roughly 60% of the specified dashboard has real data behind it. The remaining
40% renders honest empty states rather than invented numbers — for a rollout
dashboard, "nobody has ever used this module" is itself the finding.

## Architecture

Extends the existing scoped snapshot rather than forking a new page. The teacher
branch (`isTeacherScope`) and the admin Command Center are untouched; every new
panel sits behind `!isTeacherScope`.

### RPCs (11 new, all `SECURITY DEFINER`, `SET search_path = public`)

Every one resolves its own scope from `dash_resolve_scoped_classes()` and
accepts no wing or class parameter from the client.

| Function | Returns |
|---|---|
| `dash_scoped_wing_standing()` | rank, score, 4 components, wing + school average |
| `dash_scoped_student_portal_adoption(p_limit)` | totals, never-list, per-class breakdown |
| `dash_scoped_teacher_adoption(p_limit)` | 4 signals with availability, laggard list |
| `dash_scoped_class_performance()` | per-class average + scope average |
| `dash_scoped_attendance_compliance(p_days)` | per-class logging compliance |
| `dash_scoped_recheck_stats()` | pending / resolved / turnaround |
| `dash_scoped_recheck_queue(p_status, p_limit, p_offset)` | `{rows, total}` |
| `dash_scoped_resolve_recheck(p_id, p_approve, p_new_marks, p_notes)` | decision result |
| `dash_scoped_task_stats()` | open / overdue / completion / closure |
| `dash_scoped_task_queue(p_limit, p_offset)` | `{rows, total}` |
| `dash_scoped_digest()` | 7 ranked headlines, each linking to its section |

Three decisions worth recording:

**The standing RPC never returns peer wings.** It ranks every wing internally and
returns only the caller's row. Other wings are not hidden by the UI; they are
never sent.

**The resolve RPC matches the existing write path exactly.** It records the
decision and new marks against `recheck_requests` and does not rewrite
`final_results`, which is what `useResolveRecheck` on the institution-wide page
already does. Forking that would give one action two meanings depending on which
screen you opened. It is one transaction guarded on `status = 'pending'`, so a
double submit returns `already_resolved` rather than overwriting the first
decision.

**The digest calls the other scoped RPCs rather than re-deriving their SQL.**
Deriving it separately is how a summary ends up contradicting the chart directly
beneath it.

### Task scoping

`tasks.wing_id` is NULL on every row in production, so tasks are scoped through
`task_assignments.assignee_id` being a member of staff teaching one of the
caller's classes. `task_assignments.task_id` is `NOT NULL UNIQUE`, so that join
cannot fan a task out into duplicates.

### Attendance "working day"

First implementation used the institution's most recent attendance date as the
reference day. At 8am, with one class in the school having marked, that reported
"18 of 18 classes did not log attendance". A reference day now requires at least
a quarter of the institution's active classes to have marked, so a half-finished
current day is ignored instead of counted as a school-wide failure.

## Page order

Action-first, grouped:

1. Header + scope guarantee
2. `WingStandingStrip` — rank, score, breakdown sheet
3. `StartHereStrip` — up to three things to do now, cache-served
4. `KpiStrip`
5. `WingDigestCard`
6. **Students** — adoption | distribution
7. **Academics** — class performance | subjects; exam trend | heatmap; syllabus coverage
8. **Teachers** — adoption with 4 signals and laggards
9. **Attendance** — trend | logging compliance
10. **Your decisions** — recheck queue | task queue
11. **Needs attention** — flags feed
12. Drill-down tables
13. Scope guarantee footer

The footer guarantee was previously `hidden` for coordinators despite theirs
being the longer page; it now renders for both roles with role-appropriate
wording.

## Scale gate

- Pagination: every list RPC returns `{rows, total}` with clamped LIMIT/OFFSET; no unbounded selects
- Aggregation: all counts and averages computed in SQL; nothing counted client-side
- `staleTime`: explicit 60s on all eleven hooks; no polling anywhere
- `select("*")`: none
- Idempotency: resolve guarded on status server-side plus `isPending` on the button
- Transactions: the one multi-effect write is a single RPC
- Indexes: added `idx_recheck_requests_status` and `idx_recheck_requests_requested_at`; join paths already indexed
- RLS/grants: `REVOKE EXECUTE FROM PUBLIC, anon` by name on all 11, verified via `information_schema.routine_privileges`
- Error before empty: `WidgetCard` renders the error state ahead of the empty state
- No JWT-less `getUser()`
- `StartHereStrip` reuses four already-mounted hooks, adding zero queries

## Known gaps

- Communication has no card. There are zero notices institution-wide, so there is nothing to scope.
- Subject-level averages depend on `exam_subjects`, which is unpopulated for these exams.
- Two of the four teacher-adoption signals report why they cannot be measured.
- `dash_scoped_recheck_queue` is fetched at a fixed first page of 8; deeper paging goes to the Recheck Requests page.
