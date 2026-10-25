# Tasks Page — Date Filter

**Date:** 2026-05-22
**Surface:** `src/pages/TasksPage.tsx` (used by `super_admin`, `super_school_admin`, `school_admin`, `coordinator`, `teacher`, `student`, `employee` — every role with task assignments).
**Status:** Design approved; implementation plan pending.

## Problem

The Tasks page shows all-time task counts and lists with no temporal lens. Users (especially admins/coordinators reviewing institution-wide activity) cannot answer "what got done yesterday?" or "what landed on me this week?" without scrolling and reading per-card timestamps. The tab counts and stat tiles always represent the full lifetime of the institution's task data, which becomes increasingly noisy as the dataset grows.

## Goal

Add a single page-level **date filter** that:

1. Lets the user scope every visible count and list to a date window (`All`, `Today`, `Yesterday`, `This Week`, `This Month`, single custom date, or custom range).
2. Re-derives the six stat tiles and the six tab counts/labels coherently — when "Yesterday" is selected, the Completed tile reads "Completed Yesterday" with the matching count, the tab reads "Completed Yesterday", and the panel shows only yesterday's completed tasks.
3. Adds zero new network round-trips, schema changes, or RLS work — the filter is a pure client-side derivation over the data already fetched by `useMyTasks`, `useTasksAwaitingApproval`, `useSupervisingTasks`, `useTasksAssignedByMe`, and `useInstitutionTasks`.

## Non-goals

- No new persisted user preference for the default filter (resets to `All` on every page load — keeps state simple, matches the existing tab-default behavior).
- No server-side date filtering or query parameterization. The existing hooks already fetch the bounded set of tasks a user can see; we filter that set in the browser.
- No changes to `useTasks.ts` queries, `TaskCard`, `TaskDetailPanel`, or `CreateTaskDialog`.
- No filter behavior change for the WorkforceOverviewPage, the role dashboards, or any other surface — the date filter is scoped to `TasksPage` only.
- No persistence of the custom-date selection across page reloads.

## Date semantics — "smart per tab"

Tasks have three relevant timestamp columns:

| Column | Source | Use case |
|---|---|---|
| `tasks.created_at` | DB default `now()` on insert | When the task came into existence; effectively "assigned date" because every task is created with its assignment row in the same transaction. |
| `tasks.updated_at` | DB trigger on update | Last modification timestamp. For tasks that are `status='completed'`, this is the moment they were marked completed (no `completed_at` column exists). |
| `tasks.due_date` | User-set on create | Optional deadline. Not used by this filter. |

The filter resolves to a single `dateField` per surface:

| Surface | Date field | Rationale |
|---|---|---|
| All Tasks tile | `created_at` | "Tasks that came into existence in the window" |
| Open tile | `created_at` | An open task hasn't moved through any state — creation is the only relevant timestamp |
| In Progress tile | `created_at` | Approximation. No state-transition log exists; use the creation date as proxy for "tasks that became visible to the user in this window". |
| Pending tile | `created_at` | Same approximation as In Progress |
| Supervising tile | `created_at` | Supervisor relationship is set at create time |
| Completed tile | `updated_at` (status guard) | Last update on a completed task = when it was marked completed |
| All Tasks tab | `created_at` | Matches its tile |
| Assigned TO Me tab | `created_at` | Matches "assigned date" |
| Assigned BY Me tab | `created_at` | Matches "assigned date" |
| Supervising tab | `created_at` | Matches its tile |
| Pending tab | `created_at` | Combined list of `done_pending_approval` + `awaitingApproval` — both keyed on creation |
| Completed tab | `updated_at` (status guard) | Matches its tile |

The "approximation" for Open/In Progress/Pending is acceptable because (a) most tasks resolve quickly so creation date is close to current state's transition date, and (b) building a state-transition log table is out of scope for this feature. If precision becomes required later, a `task_status_history` table and a `completed_at` / `started_at` denormalized column on `tasks` would replace these approximations cleanly without changing the filter UI.

## Period definitions

All comparisons are done in the **user's local timezone**, not UTC. The DB stores `created_at` / `updated_at` as `timestamptz`; the JS Date object handles the conversion to local time on read. Period bounds:

| Preset | From | To |
|---|---|---|
| `all` | `null` (no filter) | `null` |
| `today` | Local start of today (00:00:00.000) | Local end of today (23:59:59.999) |
| `yesterday` | Local start of yesterday | Local end of yesterday |
| `this_week` | Local start of Monday this week | Local end of today |
| `this_month` | Local start of day 1 of current month | Local end of today |
| `custom_date` | Local start of the picked day | Local end of the picked day |
| `custom_range` | Local start of `from` | Local end of `to` |

Week starts on Monday (Indian school convention; SALCI is a domestic product). "This Week" and "This Month" are anchored to **today** as the upper bound, not the end of the week/month — viewing the future-half of a week or month would only ever return zero results for `created_at` and is noise.

## UI

### Filter control — `FilterChip` in `PageHeader.secondaryActions`

The chip sits in `PageHeader.secondaryActions` alongside the existing "Workforce Overview" item (visible to admins/coordinators only). For other roles the chip is the sole secondary action.

- **Label:** `"Date"` when filter is `all`; otherwise the active preset name (`"Today"`, `"Yesterday"`, `"This Week"`, `"This Month"`, `"on May 12"`, `"May 1 – May 15"`).
- **Active indicator:** when filter ≠ `all`, the chip shows the brand-primary tint and a small dot. No numeric badge — the count is implicit in the visible content below.
- **Icon:** `Calendar` from lucide-react.
- **Click:** opens a `MobileSheet` (NOT shadcn `Dialog` — per §20a, MobileSheet bypasses the project's DialogContent-ScrollArea fork).

### Filter sheet — `MobileSheet`

Bottom sheet on mobile, side sheet on desktop. Content:

1. **Sheet title:** "Filter by date"
2. **Preset list** — vertically stacked rows, each a tappable button with a checkmark on the active option:
   - All time *(default)*
   - Today
   - Yesterday
   - This Week
   - This Month
3. **Custom section** — header "Custom"
   - Segmented `Tabs` with two values: "Single date" | "Date range"
   - Single date mode: one shadcn `Calendar` (single-select, max date = today)
   - Range mode: one shadcn `Calendar` (`mode="range"`, max date = today, both ends required)
4. **Sticky footer:** "Reset" (left, secondary) + "Apply" (right, primary). Apply is disabled until the custom selection is valid (range mode: both `from` and `to` chosen and `from <= to`).

The sheet closes on Apply and on tapping a preset. Selecting a preset applies it immediately and closes the sheet — no double-tap required. Custom modes require the explicit Apply tap because they have multi-step inputs.

### Dynamic labels

A pure helper `formatDateScopeSuffix(filter)` returns the human suffix:

| Filter | Suffix |
|---|---|
| `all` | `""` |
| `today` | `" Today"` |
| `yesterday` | `" Yesterday"` |
| `this_week` | `" This Week"` |
| `this_month` | `" This Month"` |
| `custom_date` | `" on {Mon DD}"` (e.g. `" on May 12"`) |
| `custom_range` | `" {Mon DD} – {Mon DD}"` (e.g. `" May 1 – May 15"`) |

**Tab labels** are produced as `${baseLabel}${suffix}`:

| Tab | All | Yesterday |
|---|---|---|
| All Tasks | "All Tasks" | "All Tasks Yesterday" |
| Assigned TO Me | "Assigned TO Me" | "Assigned TO Me Yesterday" |
| Assigned BY Me | "Assigned BY Me" | "Assigned BY Me Yesterday" |
| Supervising | "Supervising" | "Supervising Yesterday" |
| Pending | "Pending" | "Pending Yesterday" |
| Completed | "Completed" | "Completed Yesterday" |

**Stat tile labels** follow a small per-tile mapping because the verb changes (Open → Opened, In Progress → Started, Completed → Completed):

| Tile | All | Yesterday |
|---|---|---|
| All Tasks / Wing Tasks | "All Tasks" / "Wing Tasks" | "All Yesterday" / "Wing Yesterday" |
| Open | "Open" | "Opened Yesterday" |
| In Progress | "In Progress" | "Started Yesterday" |
| Pending | "Pending" | "Pending Yesterday" |
| Supervising | "Supervising" | "Supervising Yesterday" |
| Completed | "Completed" | "Completed Yesterday" |

For custom date / range presets, the verb-and-suffix shape stays: `"Opened on May 12"`, `"Completed May 1 – May 15"`.

**Empty states** also pick up the suffix:

- All-time empty state: "No completed tasks" / "Completed tasks will appear here."
- With filter: "No completed tasks Yesterday" / "No tasks were completed in this window."

The empty-state description is shortened to the scope-aware version when the filter is active; the icon stays the same.

## Implementation

### New files

#### `src/lib/taskDateFilter.ts`

Pure helpers — no React, no Supabase, no DOM.

```ts
import { startOfDay, endOfDay, startOfWeek, startOfMonth, subDays, format, isWithinInterval } from "date-fns";
import type { Task } from "@/hooks/useTasks";

export type DateFilterPreset =
  | "all"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "custom_date"
  | "custom_range";

export type DateFilterState = {
  preset: DateFilterPreset;
  customDate?: Date | null;
  customRange?: { from: Date | null; to: Date | null };
};

export type DateRange = { from: Date; to: Date };

export const DEFAULT_FILTER: DateFilterState = { preset: "all" };

export function resolveDateRange(filter: DateFilterState, now: Date = new Date()): DateRange | null {
  switch (filter.preset) {
    case "all":
      return null;
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this_week":
      return { from: startOfDay(startOfWeek(now, { weekStartsOn: 1 })), to: endOfDay(now) };
    case "this_month":
      return { from: startOfDay(startOfMonth(now)), to: endOfDay(now) };
    case "custom_date":
      if (!filter.customDate) return null;
      return { from: startOfDay(filter.customDate), to: endOfDay(filter.customDate) };
    case "custom_range":
      if (!filter.customRange?.from || !filter.customRange?.to) return null;
      return { from: startOfDay(filter.customRange.from), to: endOfDay(filter.customRange.to) };
  }
}

export type TaskDateField = "created_at" | "updated_at";

export function filterTasksByDate<T extends Pick<Task, "created_at" | "updated_at">>(
  tasks: T[],
  range: DateRange | null,
  field: TaskDateField,
): T[] {
  if (!range) return tasks;
  return tasks.filter((t) => {
    const raw = t[field];
    if (!raw) return false;
    const d = new Date(raw);
    return isWithinInterval(d, { start: range.from, end: range.to });
  });
}

export function formatDateScopeSuffix(filter: DateFilterState): string {
  switch (filter.preset) {
    case "all":
      return "";
    case "today":
      return " Today";
    case "yesterday":
      return " Yesterday";
    case "this_week":
      return " This Week";
    case "this_month":
      return " This Month";
    case "custom_date":
      return filter.customDate ? ` on ${format(filter.customDate, "MMM d")}` : "";
    case "custom_range": {
      const { from, to } = filter.customRange ?? {};
      if (!from || !to) return "";
      return ` ${format(from, "MMM d")} – ${format(to, "MMM d")}`;
    }
  }
}

export function formatChipLabel(filter: DateFilterState): string {
  if (filter.preset === "all") return "Date";
  return formatDateScopeSuffix(filter).trim();
}

export function isFilterActive(filter: DateFilterState): boolean {
  return filter.preset !== "all" && resolveDateRange(filter) !== null;
}
```

`date-fns` is already in the project (`package.json`); no new dependency.

#### `src/components/tms/TaskDateFilter.tsx`

The `FilterChip`-shaped trigger + `MobileSheet` with preset list and custom calendars. Receives `value: DateFilterState` and `onChange: (v: DateFilterState) => void`.

- Uses `Calendar` from `@/components/ui/calendar`.
- Uses `MobileSheet` from `@/components/shared/sheets`.
- Sticky footer is a flex row inside the sheet body (the sheet's own scrollable region already has a bottom-safe-area inset).
- `Reset` sets `{ preset: "all" }`; `Apply` commits the local draft state to `onChange` and closes the sheet.
- Local draft state inside the sheet so partially-typed custom ranges don't fire spurious re-renders on the parent.

### Edited file: `src/pages/TasksPage.tsx`

- Add `const [dateFilter, setDateFilter] = useState<DateFilterState>(DEFAULT_FILTER);`
- Derive `const dateRange = useMemo(() => resolveDateRange(dateFilter), [dateFilter]);`
- Wrap every derived task array with `filterTasksByDate(..., dateRange, field)` using the field from the table in [§Date semantics](#date-semantics--smart-per-tab):
  ```ts
  const openTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "open") ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  const completedTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "completed") ?? [], dateRange, "updated_at"),
    [myTasks, dateRange],
  );
  // …similarly for inProgressTasks, pendingApprovalTasks, combinedPending,
  // activeSupervisingTasks, activeAssignedByMe, activeInstitutionTasks,
  // completedInstitutionTasks, openInstitutionTasks, inProgressInstitutionTasks,
  // pendingInstitutionTasks, supervisedInstitutionTasks
  ```
- Append `formatDateScopeSuffix(dateFilter)` to every tab label and rebuild the existing tile labels via a small `tileLabel(base: string)` helper:
  ```ts
  const suffix = formatDateScopeSuffix(dateFilter);
  const tileLabel = (allTimeLabel: string, withFilterVerb: string) =>
    suffix ? `${withFilterVerb}${suffix}` : allTimeLabel;
  // tileLabel("Open", "Opened"), tileLabel("In Progress", "Started"), etc.
  ```
- Add the `TaskDateFilter` to `PageHeader.secondaryActions`. The existing "Workforce Overview" action becomes the second entry (admins/coordinators only); the date filter is the first entry for all roles.
- Empty-state descriptions get a suffix-aware second variant:
  ```tsx
  <EmptyState
    icon={<CheckCircle2 className="h-7 w-7" />}
    title={`No completed tasks${suffix}`}
    description={
      suffix
        ? `No tasks were completed in this window.`
        : `Completed tasks will appear here.`
    }
  />
  ```

### Edited file: `src/components/shared/page/PageHeader.tsx` (if needed)

`PageHeader.secondaryActions` already accepts arbitrary `ReactNode` entries via its existing array prop — the date filter is rendered as one entry. If the current prop shape only accepts `{ label, icon, onClick }` objects, extend it with an optional `render?: () => ReactNode` variant so a chip with internal state can sit in the kebab/inline strip without losing the existing button entries. Verify against current source before editing.

### Data flow

```
useMyTasks → myTasks ─┐
useInstitutionTasks ──┤
useSupervisingTasks ──┼─► filterTasksByDate(…, dateRange, fieldPerSurface) ─► derived arrays ─► tabs/tiles/empty states/list
useTasksAssignedByMe ─┤
useTasksAwaitingApproval ┘
                ▲
                │
           dateFilter (page state) ─► resolveDateRange ─► dateRange
```

No fetch is repeated. `useTaskRealtime` continues to invalidate the underlying queries; the derived arrays naturally recompute on every refetch + every filter change because both feed into the same `useMemo` keys.

## Edge cases

| Case | Behavior |
|---|---|
| `created_at` / `updated_at` is null | Excluded from filtered result. Defensive — these columns are `NOT NULL` in the schema so this should never trigger in practice. |
| User selects `custom_range` with `from > to` | Apply button stays disabled in the sheet. Invariant never reaches state. |
| User picks `custom_date` in the future | Calendar's `disabled` prop blocks future dates. Defensive check in `resolveDateRange` is unnecessary because the input is blocked at the picker level. |
| User toggles "Single date" ↔ "Date range" with state in the other mode | The opposite mode's state is preserved locally inside the sheet until Apply. Apply only commits the active mode's state to the page. |
| User has no tasks at all and applies a filter | Existing empty state renders with the suffix-aware copy. |
| Real-time update fires while filter is applied | `useMemo` keyed on `[myTasks, dateRange]` re-runs automatically; filter stays applied across realtime invalidations. |
| Page navigated away and back | Filter resets to `all` (component remounts). Acceptable per non-goals. |
| Wing-scoped coordinator viewing institution tasks | `useInstitutionTasks` already scopes data by RLS. Date filter operates on the post-RLS set; no leakage. |
| Tasks count crosses the 6-tile sum (e.g. "All: 120" vs "Open 40 + InProgress 29 + Pending 44 + Completed 289 = 402") | Pre-existing behavior — tiles count overlapping sets (My + Institution + Supervising). The date filter does not change this; it just scopes each set to its own window. Out of scope to reconcile. |
| Task with `created_at` 2026-05-21 23:59:00 UTC viewed by IST user (UTC+5:30) on 2026-05-22 | Date conversion via `new Date(raw)` lands at 2026-05-22 05:29:00 local. "Today" filter (local start = 00:00 local) includes it. Correct. |

## Quality bar (§5a)

Before claiming done:

1. `npx tsc --noEmit` exit 0 — no new TS errors.
2. `npx eslint src/pages/TasksPage.tsx src/lib/taskDateFilter.ts src/components/tms/TaskDateFilter.tsx` — zero new errors over baseline.
3. `npx vite build` exit 0.
4. Manual smoke at 375 px width: chip in header doesn't overflow, sheet opens cleanly, presets apply on tap, custom range Apply works, dark mode flips correctly.
5. Functional smoke: with seeded data, switch through every preset and confirm tab counts + tile counts both update; switch to a tab whose filtered set is empty and confirm the empty-state copy carries the suffix.

## Testing strategy

The pure helpers in `taskDateFilter.ts` are unit-testable without React. If a tests directory exists with a Vitest config, add:

- `resolveDateRange` cases for every preset, with a fixed `now` argument.
- `filterTasksByDate` cases for in-window / on-boundary / out-of-window dates.
- `formatDateScopeSuffix` cases for every preset.

If no test infra is wired up (verify before writing tests), the manual smoke above is sufficient and we defer to a future testing-infrastructure spec.

## Risk + rollback

- **Risk: tile label changes confuse users on first encounter.** Mitigation: the verb stays consistent ("Open" → "Opened Yesterday" reads naturally). If users push back, simplify to `"Open Yesterday"` across the board.
- **Risk: client-side filtering on a very large institution dataset is slow.** Mitigation: max institution task counts observed today are ~300 (per stat tile "Completed: 289"). At 1k+, `useMemo` keeps O(n) filters off the render path. At 10k+ we revisit and push the date predicate into the Supabase query via a `range` param on the hooks — non-trivial because each hook has its own `.eq()` chain. Not needed for v1.
- **Risk: realtime mutations during an active custom range cause flicker.** Mitigation: `useMemo` deps include the underlying arrays — the filter recomputes once and the list re-renders once. No double-paint.
- **Rollback:** the feature is additive (one new state hook, one new component, one new lib file). To rollback, revert the `TasksPage.tsx` diff and delete the two new files. No DB or hook changes to unwind.

## Out of scope (explicit deferrals)

- Filter persistence across reloads (localStorage or URL query param).
- Server-side date filtering in the hooks.
- A `task_status_history` audit table that would let us filter Open/In Progress on actual state-transition timestamps rather than `created_at` proxies.
- Applying the same filter to `WorkforceOverviewPage` (different surface, separate stat aggregation — would benefit from the same primitive but is a follow-up).
- A "Custom Year" / "Custom Quarter" preset.
- Multi-select chips (combining "Yesterday" with a status pre-filter beyond the tab itself).
