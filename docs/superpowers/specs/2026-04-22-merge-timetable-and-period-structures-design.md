# Merge Timetable & Period Structures — Design

**Status:** Approved
**Date:** 2026-04-22
**Owner:** tushar@salci.in

## Problem

The sidebar currently has two separate entries under *Operations* — **Period Structures** and **Timetable** — that users perceive as the same thing. Functionally Period Structures defines the weekly skeleton (periods + breaks + working days + class assignments) and Timetable fills in teacher/subject/room per cell; they are distinct layers, but from a user's menu-view the overlap is confusing. The existing Timetable page already links *out* to Period Structures when a class has no structure assigned, reinforcing that these belong together.

## Goal

Merge the two surfaces into a single `/school/timetable` page with three top-level tabs so admins and coordinators have one entry point for everything related to timetabling. No DB, hook, or RLS changes.

## Non-goals

- No changes to database schema, migrations, RLS policies, or Supabase hooks.
- No changes to the `timetable` feature gate in `featuresData.ts`.
- No merging of Shared Resources — it stays as its own sidebar item.
- No change to lesson-planning, student/teacher week views, copy-timetable-template edge function, print view, conflict engine, or AY rollover behavior.

## Design

### Page structure

Single page at `/school/timetable` with one unified header ("Timetable" + `CalendarClock` icon) followed by a shadcn `<Tabs>` component with three top-level tabs:

| Tab value | Label | Contents | Default |
|---|---|---|---|
| `build` | **Build** | Existing `TimetablePage` body: year/wing/class selectors card, master grid overview or class grid, teacher load panel, slot assignment sheet, class week digest | ✓ |
| `structures` | **Period Structures** | Structures card grid, "New structure" button, `PeriodStructureDialog` | |
| `assignments` | **Class Assignments** | `ClassAssignmentMatrix` preceded by the "N classes unassigned" amber alert | |

The current Period Structures sub-header (`Clock` icon + "Period Structures" + description) goes away. The tab label carries the context. The top-of-page header stays as "Timetable".

### Deep-link preservation via `?tab=`

Active tab reflected in URL as `?tab=build|structures|assignments`, managed via `useSearchParams`. Absent param → `build`. Two reasons:

1. The existing Build-empty-state alert inside `ClassGridSection` links to `/school/period-structures` — it becomes `/school/timetable?tab=structures`. In-app this is a tab switch (same route), not navigation.
2. External bookmarks, emails, or docs referencing `/school/period-structures` must continue to work.

The route `/school/period-structures` stays registered in `App.tsx` but renders `<Navigate to="/school/timetable?tab=structures" replace />`.

### Sidebar changes

`src/components/layout/AppSidebar.tsx` has three role-specific branches (`school_admin`, `super_school_admin`, `coordinator`), each containing both a "Period Structures" and a "Timetable" entry under *Operations*. Remove the "Period Structures" entry from all three. "Timetable" entry (Calendar icon, `/school/timetable`) stays. Drop the `Clock` icon import if no other sidebar item uses it.

### Role & permission parity

No RLS or permission changes.

- The merged `/school/timetable` route's `allowedRoles` is already `[school_admin, super_school_admin, coordinator, super_admin]` — identical to the old Period Structures route.
- Within the page, `canEdit` inside each tab follows the same rules as today:
  - **Build** tab: admin full; coordinator write-enabled only for classes in their wing (existing `canEdit` logic).
  - **Period Structures** tab: admin full; coordinator read-only (existing `canEdit = isSchoolAdmin || isSuperAdmin` from `PeriodStructurePage`).
  - **Class Assignments** tab: same rule as Period Structures tab.

### Component organization

Extract the two absorbed surfaces into new files under `src/components/timetable/`:

- `PeriodStructuresTab.tsx` — owns the structures card grid, "New structure" button, dialog state, and `PeriodStructureDialog`. Consumes `usePeriodStructures`. Accepts a `canEdit` prop derived inside `TimetablePage`.
- `ClassAssignmentsTab.tsx` — owns the matrix and the "N classes unassigned" alert. Consumes `useClassStructureAssignments` + `usePeriodStructures`. Accepts a `canEdit` prop.

`TimetablePage.tsx` wraps all three in `<Tabs value={tab} onValueChange={...}>` and manages the `tab` query param via `useSearchParams`. Existing Build sections (`AdminOverviewSection`, `ClassGridSection`, `TimetableScopeEmptyState`, `CalendarEmptyHint`) remain inline in `TimetablePage.tsx` — they are already tightly coupled to its state.

`src/pages/school/PeriodStructurePage.tsx` is deleted after extraction.

### In-page link updates

- `ClassGridSection` in `TimetablePage.tsx` currently uses `<Link to="/school/period-structures">`. Replace the `<Link>` with a `<Button>` whose `onClick` calls `setSearchParams({ tab: "structures" })`. Using `setSearchParams` (same-route update) avoids a re-mount of the tab content and preserves state like selected class across tab switches.
- No other in-app or docs references to "Period Structures page" exist that need updating (verified via grep for `period-structures`).

### Mobile responsiveness

shadcn `TabsList` handles three tabs at 375px cleanly with icons+text truncation. Existing `PeriodStructurePage` was already mobile-tested at 375px with its internal two-tab layout, so a three-tab variant at the top level is within bounds. No horizontal scroll expected; if the combined label length is tight, we abbreviate to "Structures" / "Assignments" (keeping "Build" unchanged).

### Dirty-form contract

The Slot Assignment Sheet and `PeriodStructureDialog` both handle their own dirty state via form data. No new `data-dirty="true"` wiring required — the merge does not introduce new forms, it only reorganizes existing ones. The SW soft-toast path continues to work unchanged.

## File changes

| File | Change |
|---|---|
| `src/pages/school/TimetablePage.tsx` | Wrap body in `<Tabs>`. Add `useSearchParams` for `?tab=`. Update in-page "Go to Period Structures" link to switch tab. |
| `src/components/timetable/PeriodStructuresTab.tsx` | New — extracted from `PeriodStructurePage`. |
| `src/components/timetable/ClassAssignmentsTab.tsx` | New — extracted from `PeriodStructurePage`. |
| `src/pages/school/PeriodStructurePage.tsx` | Deleted. |
| `src/App.tsx` | Remove `PeriodStructurePage` import. Replace `/school/period-structures` route element with `<Navigate to="/school/timetable?tab=structures" replace />`. |
| `src/components/layout/AppSidebar.tsx` | Remove "Period Structures" entry from three role branches. Drop unused `Clock` icon import if no other item uses it. |
| `.claude/skills/timetable-module/SKILL.md` | Update §1 "Route & feature gating" note to mention the merged route + tab param. |

## Testing plan

Manual verification after implementation:

1. **Navigation** — sidebar shows only "Timetable" under Operations (no "Period Structures"). Clicking it lands on the Build tab.
2. **Tab switching** — all three tabs render their intended content. URL updates to `?tab=structures` / `?tab=assignments`. Back/forward browser buttons move between tab states.
3. **Redirect** — visiting `/school/period-structures` directly redirects to `/school/timetable?tab=structures`.
4. **Build empty-state link** — select a class with no assigned structure; click "Go to Period Structures" inside the alert — tab switches to Structures without a full navigation.
5. **Period Structures CRUD** — create, edit, delete structures and assign to classes — all work inside the tabs just as they did on the separate page. "N classes unassigned" alert still surfaces on the Class Assignments tab.
6. **Role checks** — coordinator sees Period Structures and Class Assignments tabs but cannot edit; admin can edit. Teacher cannot reach the page at all (route guarded).
7. **Mobile 375px** — no horizontal scroll on the tab bar; each tab's content is scrollable within the page.
8. **Deep link** — `/school/timetable?tab=assignments` lands directly on the Class Assignments tab.
