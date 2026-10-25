# Tasks Page Date Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a page-level date filter to `/tasks` that scopes all six stat tiles, all six tab counts, all six task lists, and the empty-state copy to a chosen date window (presets + custom date + custom range). Pure client-side derivation over data already fetched by existing hooks.

**Architecture:** Three pieces — (1) pure helpers in `src/lib/taskDateFilter.ts` that resolve filter state to date ranges and produce human suffixes, (2) a self-contained `TaskDateFilter.tsx` chip + sheet component, (3) wiring in `TasksPage.tsx` that wraps every derived array with `filterTasksByDate(...)` keyed on a per-surface date field (`created_at` for assigned/open/in-progress/pending/supervising, `updated_at` for completed). One small additive prop on the shared `PageHeader` to host the chip in the action cluster.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5 (unchanged), `date-fns@3.6` (already a dep), `react-day-picker@8.10` via shadcn `Calendar` (already in the project), `MobileSheet` and `FilterChip` from `src/components/shared`. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-22-tasks-page-date-filter-design.md](../specs/2026-05-22-tasks-page-date-filter-design.md)

**No test infrastructure in this repo** (no Vitest/Jest config, no `*.test.ts` files under `src/`). Per the spec's fallback, verification is done via TS/ESLint/Vite build + manual smoke. No unit-test tasks in this plan.

---

## File Structure

```
src/
  lib/
    taskDateFilter.ts            (NEW)  — pure helpers; no React/Supabase
  components/
    tms/
      TaskDateFilter.tsx         (NEW)  — FilterChip trigger + MobileSheet
    shared/
      page/
        PageHeader.tsx           (EDIT) — add optional `extras` ReactNode prop
  pages/
    TasksPage.tsx                (EDIT) — wire filter state, derived arrays, labels
```

Each file has one clear responsibility. The helpers are pure (unit-testable later without React), the component is self-contained (controlled `value`/`onChange`), the page-level wiring stays inside `TasksPage.tsx`.

---

## Task 1: Pure date helpers

**Files:**
- Create: `src/lib/taskDateFilter.ts`

The helpers are intentionally pure — no React imports, no Supabase imports, no DOM access. Single point of truth for: filter state shape, preset → date-range resolution, filtering predicate, and human-readable suffix formatting.

- [ ] **Step 1.1: Create `src/lib/taskDateFilter.ts`**

```ts
import {
  endOfDay,
  format,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";
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

/**
 * Resolve a filter state into an inclusive [from, to] date range.
 * Returns null when the filter is "all" or a custom value is incomplete.
 * Bounds are normalized to local-time day boundaries — DB columns are
 * `timestamptz`, so `new Date(raw)` already lands in local time and
 * `isWithinInterval` compares in local time.
 */
export function resolveDateRange(
  filter: DateFilterState,
  now: Date = new Date(),
): DateRange | null {
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
      return {
        from: startOfDay(startOfWeek(now, { weekStartsOn: 1 })),
        to: endOfDay(now),
      };
    case "this_month":
      return { from: startOfDay(startOfMonth(now)), to: endOfDay(now) };
    case "custom_date":
      if (!filter.customDate) return null;
      return {
        from: startOfDay(filter.customDate),
        to: endOfDay(filter.customDate),
      };
    case "custom_range": {
      const { from, to } = filter.customRange ?? {};
      if (!from || !to) return null;
      // Defensive: if caller somehow inverted the range, swap so the
      // interval is always valid. Picker prevents this at the UI level.
      const lo = from <= to ? from : to;
      const hi = from <= to ? to : from;
      return { from: startOfDay(lo), to: endOfDay(hi) };
    }
  }
}

export type TaskDateField = "created_at" | "updated_at";

/**
 * Filter a list of tasks (or any object with the relevant timestamp fields)
 * by an inclusive local-time date range. `null` range = no filtering.
 */
export function filterTasksByDate<
  T extends Pick<Task, "created_at" | "updated_at">,
>(tasks: T[], range: DateRange | null, field: TaskDateField): T[] {
  if (!range) return tasks;
  return tasks.filter((t) => {
    const raw = t[field];
    if (!raw) return false;
    const d = new Date(raw);
    return isWithinInterval(d, { start: range.from, end: range.to });
  });
}

/**
 * Produces the suffix appended to labels when a filter is active.
 * Includes a leading space so callers can do `${baseLabel}${suffix}`.
 * Returns "" when the filter resolves to no scope.
 */
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
      return filter.customDate
        ? ` on ${format(filter.customDate, "MMM d")}`
        : "";
    case "custom_range": {
      const { from, to } = filter.customRange ?? {};
      if (!from || !to) return "";
      return ` ${format(from, "MMM d")} – ${format(to, "MMM d")}`;
    }
  }
}

/** Label for the FilterChip trigger. "Date" when inactive, the scope text when active. */
export function formatChipLabel(filter: DateFilterState): string {
  if (filter.preset === "all") return "Date";
  const suffix = formatDateScopeSuffix(filter);
  return suffix.trim() || "Date";
}

export function isFilterActive(filter: DateFilterState): boolean {
  return filter.preset !== "all" && resolveDateRange(filter) !== null;
}
```

- [ ] **Step 1.2: Typecheck the new file**

Run: `npx tsc --noEmit`
Expected: exit 0, no new errors. The `Task` import resolves through `@/hooks/useTasks` (existing alias). `date-fns` v3 exports all the functions used above.

- [ ] **Step 1.3: Lint the new file**

Run: `npx eslint src/lib/taskDateFilter.ts`
Expected: zero errors. No `any`, no `let` that should be `const`.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/taskDateFilter.ts
git commit -m "feat(tasks): add pure date-filter helpers for Tasks page

DateFilterState, resolveDateRange, filterTasksByDate, formatDateScopeSuffix,
formatChipLabel. Local-time boundaries; null range = no filter.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: TaskDateFilter component

**Files:**
- Create: `src/components/tms/TaskDateFilter.tsx`

A controlled component: parent owns the committed `value: DateFilterState`. Internally manages a *draft* state so partial custom-mode selections don't fire `onChange` until the user taps Apply.

- [ ] **Step 2.1: Create `src/components/tms/TaskDateFilter.tsx`**

```tsx
import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { FilterChip } from "@/components/shared/nav/FilterRow";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";

import {
  DEFAULT_FILTER,
  formatChipLabel,
  isFilterActive,
  type DateFilterPreset,
  type DateFilterState,
} from "@/lib/taskDateFilter";

interface TaskDateFilterProps {
  value: DateFilterState;
  onChange: (next: DateFilterState) => void;
}

const PRESET_ROWS: ReadonlyArray<{ value: DateFilterPreset; label: string }> = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
];

export function TaskDateFilter({ value, onChange }: TaskDateFilterProps) {
  const [open, setOpen] = React.useState(false);

  // Draft state lives only while the sheet is open. Custom modes commit on
  // Apply; presets commit + close immediately on tap.
  const [draft, setDraft] = React.useState<DateFilterState>(value);
  const [customMode, setCustomMode] = React.useState<"single" | "range">(
    value.preset === "custom_range" ? "range" : "single",
  );

  // Reset draft to the committed value every time the sheet opens.
  React.useEffect(() => {
    if (open) {
      setDraft(value);
      setCustomMode(value.preset === "custom_range" ? "range" : "single");
    }
  }, [open, value]);

  const applyPreset = (preset: DateFilterPreset) => {
    if (preset === "custom_date" || preset === "custom_range") {
      setDraft((d) => ({ ...d, preset }));
      return;
    }
    onChange({ preset });
    setOpen(false);
  };

  const isCustomDateValid = draft.preset === "custom_date" && Boolean(draft.customDate);
  const isCustomRangeValid =
    draft.preset === "custom_range" &&
    Boolean(draft.customRange?.from) &&
    Boolean(draft.customRange?.to) &&
    (draft.customRange?.from && draft.customRange?.to
      ? draft.customRange.from <= draft.customRange.to
      : false);

  const isDraftCustomMode =
    draft.preset === "custom_date" || draft.preset === "custom_range";
  const canApply = isDraftCustomMode
    ? (customMode === "single" ? isCustomDateValid : isCustomRangeValid)
    : false;

  const handleApply = () => {
    if (customMode === "single" && isCustomDateValid) {
      onChange({ preset: "custom_date", customDate: draft.customDate });
      setOpen(false);
    } else if (customMode === "range" && isCustomRangeValid) {
      onChange({ preset: "custom_range", customRange: draft.customRange });
      setOpen(false);
    }
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_FILTER });
    setOpen(false);
  };

  const today = React.useMemo(() => new Date(), []);

  return (
    <>
      <FilterChip
        label={formatChipLabel(value)}
        active={isFilterActive(value)}
        onClick={() => setOpen(true)}
        trailing={<CalendarIcon className="h-4 w-4 shrink-0 text-ink-500" />}
      />

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title="Filter by date"
        icon={<CalendarIcon className="h-4 w-4" />}
        primaryAction={
          isDraftCustomMode
            ? {
                label: "Apply",
                onClick: handleApply,
                disabled: !canApply,
              }
            : undefined
        }
        secondaryAction={
          isFilterActive(value)
            ? { label: "Reset", onClick: handleReset }
            : undefined
        }
      >
        <div className="space-y-5">
          {/* Preset rows */}
          <div className="flex flex-col gap-1">
            {PRESET_ROWS.map((p) => {
              const isSelected = draft.preset === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => applyPreset(p.value)}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-3 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-brand-primary/10 text-brand-primary font-medium"
                      : "text-ink-700 hover:bg-ink-400/5",
                  )}
                >
                  <span>{p.label}</span>
                  {isSelected && (
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom section */}
          <div className="border-t border-surface-stroke pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-3">
              Custom
            </h3>

            <Tabs
              value={customMode}
              onValueChange={(v) => {
                const mode = v === "range" ? "range" : "single";
                setCustomMode(mode);
                setDraft((d) => ({
                  ...d,
                  preset: mode === "range" ? "custom_range" : "custom_date",
                }));
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="single">Single date</TabsTrigger>
                <TabsTrigger value="range">Date range</TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="mt-3">
                <div className="flex justify-center">
                  <Calendar
                    mode="single"
                    selected={draft.customDate ?? undefined}
                    onSelect={(d) =>
                      setDraft((prev) => ({
                        ...prev,
                        preset: "custom_date",
                        customDate: d ?? null,
                      }))
                    }
                    disabled={{ after: today }}
                    initialFocus
                  />
                </div>
              </TabsContent>

              <TabsContent value="range" className="mt-3">
                <div className="flex justify-center">
                  <Calendar
                    mode="range"
                    selected={
                      draft.customRange?.from || draft.customRange?.to
                        ? {
                            from: draft.customRange?.from ?? undefined,
                            to: draft.customRange?.to ?? undefined,
                          }
                        : undefined
                    }
                    onSelect={(r) =>
                      setDraft((prev) => ({
                        ...prev,
                        preset: "custom_range",
                        customRange: {
                          from: r?.from ?? null,
                          to: r?.to ?? null,
                        },
                      }))
                    }
                    disabled={{ after: today }}
                    numberOfMonths={1}
                    initialFocus
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </MobileSheet>
    </>
  );
}
```

Notes for the engineer:
- `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` are the existing shadcn primitives at `src/components/ui/tabs.tsx` — verify the path resolves (`@/components/ui/tabs`). If the project uses a different export shape, adapt the imports but keep the same UI structure.
- `FilterChip` is exported from `src/components/shared/nav/FilterRow.tsx`. It accepts an optional `trailing` ReactNode that replaces the default ChevronDown — we use it to swap in the Calendar icon.
- `MobileSheet` accepts `primaryAction` / `secondaryAction`. When the user is on a preset (non-custom) selection, presets commit on tap and the sheet closes immediately — so the Apply button is hidden in that branch. Reset is always visible when a filter is active.
- The `Calendar` (react-day-picker v8) uses `mode="single" | "range"` with `selected` + `onSelect`. The `disabled={{ after: today }}` matcher blocks future dates.
- No internal Supabase calls, no global state — fully controlled by props.

- [ ] **Step 2.2: Typecheck the new file**

Run: `npx tsc --noEmit`
Expected: exit 0. If the existing `Tabs` export path differs, the compiler will flag the import — fix the import path and rerun.

- [ ] **Step 2.3: Lint the new file**

Run: `npx eslint src/components/tms/TaskDateFilter.tsx`
Expected: zero errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/tms/TaskDateFilter.tsx
git commit -m "feat(tasks): TaskDateFilter chip + sheet with presets and custom date/range

FilterChip trigger opens a MobileSheet with preset list (All / Today /
Yesterday / This Week / This Month) and a Custom section that toggles
between single-date and range-mode calendars. Controlled by parent;
custom selections commit on Apply, presets commit on tap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Extend PageHeader with `extras` slot

**Files:**
- Modify: `src/components/shared/page/PageHeader.tsx`

The existing `PageHeaderAction` shape is `{ label, onClick, icon, destructive, disabled, menuItems }`. A FilterChip with internal state (popover trigger) doesn't fit that shape — we need a slot that renders an arbitrary ReactNode in the action cluster. Add `extras?: ReactNode` that renders inline to the left of secondary actions on lg+, and inline before the primary CTA on smaller widths (so the chip is always reachable without opening the kebab).

- [ ] **Step 3.1: Read the current file to lock the line targets**

Confirm line numbers before editing. Run:

```
Grep pattern: "secondaryActions" → file path "src/components/shared/page/PageHeader.tsx", output_mode: content, -n: true
```

Confirm the `PageHeaderProps` interface ends at the line shown earlier in this plan's research; if it has changed, adapt the diff accordingly.

- [ ] **Step 3.2: Add `extras` to `PageHeaderProps`**

In `src/components/shared/page/PageHeader.tsx`, locate the `PageHeaderProps` interface and add the new optional prop just after `collapseSecondary?: boolean;`.

Old code (excerpt, with context):

```ts
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  className?: string;
  /**
   * When true, secondary actions are always rendered inside the kebab dropdown
   * (no inline display at lg+). Useful when a page has 4+ secondary actions
   * that would otherwise crowd the header row.
   */
  collapseSecondary?: boolean;
}
```

Replacement:

```ts
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  primaryAction?: PageHeaderAction;
  secondaryActions?: PageHeaderAction[];
  className?: string;
  /**
   * When true, secondary actions are always rendered inside the kebab dropdown
   * (no inline display at lg+). Useful when a page has 4+ secondary actions
   * that would otherwise crowd the header row.
   */
  collapseSecondary?: boolean;
  /**
   * Arbitrary ReactNode rendered in the action cluster, to the left of the
   * primary CTA on every breakpoint. Use for self-managing controls (e.g. a
   * filter chip with its own popover) that don't fit the `PageHeaderAction`
   * shape. Stays visible on mobile so users don't have to open the kebab to
   * reach it.
   */
  extras?: React.ReactNode;
}
```

- [ ] **Step 3.3: Thread `extras` through the component and the `ActionCluster`**

Update the destructure in `PageHeader(...)` to pull `extras`, update the action-cluster conditional, and pass it through. Locate the existing `function PageHeader(...)` block.

Old code (excerpt):

```tsx
export function PageHeader({
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryActions = [],
  className,
  collapseSecondary = false,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 py-4 sm:py-6 lg:py-8 md:flex-row md:items-start md:gap-6", className)}>
      <div className="flex flex-1 items-start gap-3 lg:gap-4 min-w-0">
        ...
      </div>
      {(primaryAction || secondaryActions.length > 0) && (
        <ActionCluster
          primaryAction={primaryAction}
          secondaryActions={secondaryActions}
          collapseSecondary={collapseSecondary}
        />
      )}
    </header>
  );
}
```

Replacement:

```tsx
export function PageHeader({
  title,
  subtitle,
  icon,
  primaryAction,
  secondaryActions = [],
  className,
  collapseSecondary = false,
  extras,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 py-4 sm:py-6 lg:py-8 md:flex-row md:items-start md:gap-6", className)}>
      <div className="flex flex-1 items-start gap-3 lg:gap-4 min-w-0">
        {icon && (
          <span className="mt-0.5 inline-flex h-10 w-10 lg:h-12 lg:w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-[26px] leading-[32px] font-bold text-ink-900 sm:text-[32px] sm:leading-[40px] lg:text-[40px] lg:leading-[48px] xl:text-[44px] xl:leading-[52px] tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 lg:mt-2 line-clamp-2 text-sm text-ink-600 sm:text-[15px] sm:leading-[22px] lg:text-base lg:leading-[24px]">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {(primaryAction || secondaryActions.length > 0 || extras) && (
        <ActionCluster
          primaryAction={primaryAction}
          secondaryActions={secondaryActions}
          collapseSecondary={collapseSecondary}
          extras={extras}
        />
      )}
    </header>
  );
}
```

(The full `<div className="flex flex-1 ...">` block is repeated above so the engineer doesn't have to read other parts of this plan to apply this step.)

- [ ] **Step 3.4: Render `extras` inside `ActionCluster`**

Old code (excerpt):

```tsx
function ActionCluster({
  primaryAction,
  secondaryActions,
  collapseSecondary,
}: {
  primaryAction?: PageHeaderAction;
  secondaryActions: PageHeaderAction[];
  collapseSecondary: boolean;
}) {
  // CSS-only responsive split: same array rendered twice, with one branch
  // hidden per breakpoint. SSR-safe; no JS viewport detection.
  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Inline secondary actions (lg+ only, suppressed when collapseSecondary) */}
      ...
```

Replacement (only the function signature, the props type, and the first child inside the `<div>` change — keep everything below the `{extras}` insertion identical to the existing file):

```tsx
function ActionCluster({
  primaryAction,
  secondaryActions,
  collapseSecondary,
  extras,
}: {
  primaryAction?: PageHeaderAction;
  secondaryActions: PageHeaderAction[];
  collapseSecondary: boolean;
  extras?: React.ReactNode;
}) {
  // CSS-only responsive split: same array rendered twice, with one branch
  // hidden per breakpoint. SSR-safe; no JS viewport detection.
  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* Extras slot — visible on every breakpoint, leftmost in the cluster.
          Use for self-managing controls (e.g. filter chip) that don't fit
          the PageHeaderAction shape. */}
      {extras}

      {/* Inline secondary actions (lg+ only, suppressed when collapseSecondary) */}
      {/* ...rest of the existing JSX stays unchanged... */}
```

The engineer should preserve every existing line below the `{extras}` insertion. Use `Edit` with a unique `old_string` that anchors on `return (\n    <div className="flex shrink-0 items-center gap-2">\n      {/* Inline secondary actions` to insert the `{extras}` block immediately before that comment.

- [ ] **Step 3.5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. The shared `PageHeader` is used widely across the codebase — `extras` is optional so no other call sites need updates.

- [ ] **Step 3.6: Lint**

Run: `npx eslint src/components/shared/page/PageHeader.tsx`
Expected: zero errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/components/shared/page/PageHeader.tsx
git commit -m "feat(page-header): add optional extras slot for custom controls

ReactNode rendered leftmost in the action cluster on every breakpoint.
Lets stateful controls (e.g. filter chips with their own popover) live
in the header without forcing them through the PageHeaderAction shape.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Wire the filter into TasksPage

**Files:**
- Modify: `src/pages/TasksPage.tsx`

The page already declares all the derived arrays as plain `const` expressions. We replace each with a `useMemo` that runs the array through `filterTasksByDate(...)` with the right field, and we append the suffix to every tab/tile label + every empty-state title.

- [ ] **Step 4.1: Add new imports at the top of `TasksPage.tsx`**

Old code (lines 1–24, current file):

```ts
import { Skeleton } from "@/components/ui/skeleton";
import { useMyTasks, useTasksAwaitingApproval, useSupervisingTasks, useTasksAssignedByMe, useInstitutionTasks, type Task } from "@/hooks/useTasks";
import { useTaskRealtime } from "@/hooks/useTaskRealtime";
import { TaskCard } from "@/components/tms/TaskCard";
import { TaskDetailPanel } from "@/components/tms/TaskDetailPanel";
import { CreateTaskDialog } from "@/components/tms/CreateTaskDialog";
import { useUserRole } from "@/hooks/useUserRole";
import {
  Inbox,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Plus,
  Building2,
  Users,
  ClipboardList,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
```

Replacement (add the two new imports — keep everything else identical):

```ts
import { Skeleton } from "@/components/ui/skeleton";
import { useMyTasks, useTasksAwaitingApproval, useSupervisingTasks, useTasksAssignedByMe, useInstitutionTasks, type Task } from "@/hooks/useTasks";
import { useTaskRealtime } from "@/hooks/useTaskRealtime";
import { TaskCard } from "@/components/tms/TaskCard";
import { TaskDetailPanel } from "@/components/tms/TaskDetailPanel";
import { CreateTaskDialog } from "@/components/tms/CreateTaskDialog";
import { TaskDateFilter } from "@/components/tms/TaskDateFilter";
import { useUserRole } from "@/hooks/useUserRole";
import {
  Inbox,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Plus,
  Building2,
  Users,
  ClipboardList,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import {
  DEFAULT_FILTER,
  filterTasksByDate,
  formatDateScopeSuffix,
  resolveDateRange,
  type DateFilterState,
} from "@/lib/taskDateFilter";
```

- [ ] **Step 4.2: Add filter state + resolved range right after the existing state hooks**

Locate the block (around lines 43–50 of the current file):

```ts
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Controlled state for CreateTaskDialog so both the desktop
  // "Create Task" button (in PageHeader.primaryAction) and the
  // MobileFab open the same dialog. The dialog itself is rendered once
  // — see the `fab` prop on PageShell below.
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const navigate = useNavigate();
```

Add right after the `useNavigate` line, before the `isLoading` const:

```ts
  // Page-level date filter. Resets to "all" on every mount — no persistence
  // (matches the existing tab-default behavior). The resolved DateRange is
  // memoized so it's stable across renders that don't change the filter.
  const [dateFilter, setDateFilter] = useState<DateFilterState>(DEFAULT_FILTER);
  const dateRange = useMemo(() => resolveDateRange(dateFilter), [dateFilter]);
  const scopeSuffix = formatDateScopeSuffix(dateFilter);
```

- [ ] **Step 4.3: Replace every derived array with a date-aware `useMemo`**

Locate the existing block (lines ~55–76 in the current file):

```ts
  const openTasks = myTasks?.filter(t => t.status === "open") || [];
  const inProgressTasks = myTasks?.filter(t => t.status === "in_progress") || [];
  const pendingApprovalTasks = myTasks?.filter(t => t.status === "done_pending_approval") || [];
  const completedTasks = myTasks?.filter(t => t.status === "completed") || [];
  const activeSupervisingTasks = supervisingTasks?.filter(t => t.status !== "completed") || [];
  const activeAssignedByMe = assignedByMe?.filter(t => t.status !== "completed") || [];
  const combinedPending = [...pendingApprovalTasks, ...(awaitingApproval || [])];

  // Institution-wide tasks for school admin and coordinator view
  const allInstitutionTasks = institutionTasks || [];
  const activeInstitutionTasks = allInstitutionTasks.filter(t => t.status !== "completed");
  const completedInstitutionTasks = allInstitutionTasks.filter(t => t.status === "completed");
  // Institution-wide status breakdowns — used by the stat tiles when an admin
  // or coordinator is viewing the page. Without these the Open/In Progress/
  // Pending/Supervising tiles read from `myTasks`/`supervisingTasks`, which
  // are 0 for an admin who isn't the assignee of any task.
  const openInstitutionTasks = allInstitutionTasks.filter(t => t.status === "open");
  const inProgressInstitutionTasks = allInstitutionTasks.filter(t => t.status === "in_progress");
  const pendingInstitutionTasks = allInstitutionTasks.filter(t => t.status === "done_pending_approval");
  const supervisedInstitutionTasks = allInstitutionTasks.filter(
    t => t.status !== "completed" && t.assignment?.supervisor_id
  );
```

Replace the entire block with:

```ts
  // Status-derived arrays — pre-filter; date filter wraps each one below.
  // Completed tasks use updated_at as the date field (the moment the task
  // was marked completed); everything else uses created_at as a proxy for
  // "when the task entered visibility for the user".
  const openTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "open") ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  const inProgressTasks = useMemo(
    () => filterTasksByDate(myTasks?.filter((t) => t.status === "in_progress") ?? [], dateRange, "created_at"),
    [myTasks, dateRange],
  );
  const pendingApprovalTasks = useMemo(
    () =>
      filterTasksByDate(
        myTasks?.filter((t) => t.status === "done_pending_approval") ?? [],
        dateRange,
        "created_at",
      ),
    [myTasks, dateRange],
  );
  const completedTasks = useMemo(
    () =>
      filterTasksByDate(
        myTasks?.filter((t) => t.status === "completed") ?? [],
        dateRange,
        "updated_at",
      ),
    [myTasks, dateRange],
  );
  const activeSupervisingTasks = useMemo(
    () =>
      filterTasksByDate(
        supervisingTasks?.filter((t) => t.status !== "completed") ?? [],
        dateRange,
        "created_at",
      ),
    [supervisingTasks, dateRange],
  );
  const activeAssignedByMe = useMemo(
    () =>
      filterTasksByDate(
        assignedByMe?.filter((t) => t.status !== "completed") ?? [],
        dateRange,
        "created_at",
      ),
    [assignedByMe, dateRange],
  );
  const combinedPending = useMemo(
    () => [...pendingApprovalTasks, ...filterTasksByDate(awaitingApproval ?? [], dateRange, "created_at")],
    [pendingApprovalTasks, awaitingApproval, dateRange],
  );

  // Institution-wide arrays — same per-field mapping. activeInstitutionTasks
  // and the status breakdowns all use created_at; completedInstitutionTasks
  // uses updated_at.
  const allInstitutionTasks = institutionTasks ?? [];
  const activeInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status !== "completed"),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const completedInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status === "completed"),
        dateRange,
        "updated_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const openInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status === "open"),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const inProgressInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status === "in_progress"),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const pendingInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter((t) => t.status === "done_pending_approval"),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
  const supervisedInstitutionTasks = useMemo(
    () =>
      filterTasksByDate(
        allInstitutionTasks.filter(
          (t) => t.status !== "completed" && t.assignment?.supervisor_id,
        ),
        dateRange,
        "created_at",
      ),
    [allInstitutionTasks, dateRange],
  );
```

- [ ] **Step 4.4: Append `scopeSuffix` to every tab label**

Locate the `tabs` `useMemo` block (lines ~83–134 in the current file).

Old code:

```ts
  const tabs: MobileTabOption[] = useMemo(() => {
    const base: MobileTabOption[] = [];
    if (showInstitutionView) {
      base.push({
        value: "all-tasks",
        label: isSchoolAdmin ? "All Tasks" : "Overview",
        icon: <Building2 className="h-4 w-4" />,
        count: activeInstitutionTasks.length || undefined,
      });
    }
    base.push(
      {
        value: "my-tasks",
        label: "Assigned TO Me",
        icon: <Inbox className="h-4 w-4" />,
        count: (openTasks.length + inProgressTasks.length) || undefined,
      },
      {
        value: "assigned-by-me",
        label: "Assigned BY Me",
        icon: <Users className="h-4 w-4" />,
        count: activeAssignedByMe.length || undefined,
      },
      {
        value: "supervising",
        label: "Supervising",
        icon: <Eye className="h-4 w-4" />,
        count: activeSupervisingTasks.length || undefined,
      },
      {
        value: "pending",
        label: "Pending",
        icon: <AlertCircle className="h-4 w-4" />,
        count: combinedPending.length || undefined,
      },
      {
        value: "completed",
        label: "Completed",
        icon: <CheckCircle2 className="h-4 w-4" />,
      },
    );
    return base;
  }, [
    showInstitutionView,
    isSchoolAdmin,
    activeInstitutionTasks.length,
    openTasks.length,
    inProgressTasks.length,
    activeAssignedByMe.length,
    activeSupervisingTasks.length,
    combinedPending.length,
  ]);
```

Replacement:

```ts
  const tabs: MobileTabOption[] = useMemo(() => {
    const base: MobileTabOption[] = [];
    if (showInstitutionView) {
      base.push({
        value: "all-tasks",
        label: `${isSchoolAdmin ? "All Tasks" : "Overview"}${scopeSuffix}`,
        icon: <Building2 className="h-4 w-4" />,
        count: activeInstitutionTasks.length || undefined,
      });
    }
    base.push(
      {
        value: "my-tasks",
        label: `Assigned TO Me${scopeSuffix}`,
        icon: <Inbox className="h-4 w-4" />,
        count: (openTasks.length + inProgressTasks.length) || undefined,
      },
      {
        value: "assigned-by-me",
        label: `Assigned BY Me${scopeSuffix}`,
        icon: <Users className="h-4 w-4" />,
        count: activeAssignedByMe.length || undefined,
      },
      {
        value: "supervising",
        label: `Supervising${scopeSuffix}`,
        icon: <Eye className="h-4 w-4" />,
        count: activeSupervisingTasks.length || undefined,
      },
      {
        value: "pending",
        label: `Pending${scopeSuffix}`,
        icon: <AlertCircle className="h-4 w-4" />,
        count: combinedPending.length || undefined,
      },
      {
        value: "completed",
        label: `Completed${scopeSuffix}`,
        icon: <CheckCircle2 className="h-4 w-4" />,
      },
    );
    return base;
  }, [
    showInstitutionView,
    isSchoolAdmin,
    scopeSuffix,
    activeInstitutionTasks.length,
    openTasks.length,
    inProgressTasks.length,
    activeAssignedByMe.length,
    activeSupervisingTasks.length,
    combinedPending.length,
  ]);
```

- [ ] **Step 4.5: Add the date filter to the PageHeader and update tile labels**

Locate the `<PageHeader …/>` JSX block (around lines 157–184) and the `<StatTileGrid>` block (lines 186–225).

Old code:

```tsx
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Tasks"
        subtitle="Manage your assigned tasks and approvals"
        primaryAction={{
          label: "Assign Task",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setCreateTaskOpen(true),
        }}
        secondaryActions={
          showInstitutionView
            ? [
                {
                  label: "Workforce Overview",
                  icon: <Users className="h-4 w-4" />,
                  onClick: () => navigate("/school/workforce"),
                },
              ]
            : undefined
        }
      />

      <StatTileGrid mdCols={3} lgCols={6} className="mt-2">
        {showInstitutionView && (
          <StatTile
            label={isSchoolAdmin ? "All Tasks" : "Wing Tasks"}
            value={activeInstitutionTasks.length}
            icon={<Building2 className="h-5 w-5" />}
            tone="violet"
          />
        )}
        <StatTile
          label="Open"
          value={showInstitutionView ? openInstitutionTasks.length : openTasks.length}
          icon={<Inbox className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label="In Progress"
          value={showInstitutionView ? inProgressInstitutionTasks.length : inProgressTasks.length}
          icon={<Clock className="h-5 w-5" />}
          tone="sky"
        />
        <StatTile
          label="Pending"
          value={showInstitutionView ? pendingInstitutionTasks.length : combinedPending.length}
          icon={<AlertCircle className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label="Supervising"
          value={showInstitutionView ? supervisedInstitutionTasks.length : activeSupervisingTasks.length}
          icon={<Eye className="h-5 w-5" />}
          tone="violet"
        />
        <StatTile
          label="Completed"
          value={showInstitutionView ? completedInstitutionTasks.length : completedTasks.length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
        />
      </StatTileGrid>
```

Replacement:

```tsx
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Tasks"
        subtitle="Manage your assigned tasks and approvals"
        extras={<TaskDateFilter value={dateFilter} onChange={setDateFilter} />}
        primaryAction={{
          label: "Assign Task",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setCreateTaskOpen(true),
        }}
        secondaryActions={
          showInstitutionView
            ? [
                {
                  label: "Workforce Overview",
                  icon: <Users className="h-4 w-4" />,
                  onClick: () => navigate("/school/workforce"),
                },
              ]
            : undefined
        }
      />

      <StatTileGrid mdCols={3} lgCols={6} className="mt-2">
        {showInstitutionView && (
          <StatTile
            label={`${isSchoolAdmin ? "All" : "Wing"}${scopeSuffix || " Tasks"}`}
            value={activeInstitutionTasks.length}
            icon={<Building2 className="h-5 w-5" />}
            tone="violet"
          />
        )}
        <StatTile
          label={scopeSuffix ? `Opened${scopeSuffix}` : "Open"}
          value={showInstitutionView ? openInstitutionTasks.length : openTasks.length}
          icon={<Inbox className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label={scopeSuffix ? `Started${scopeSuffix}` : "In Progress"}
          value={showInstitutionView ? inProgressInstitutionTasks.length : inProgressTasks.length}
          icon={<Clock className="h-5 w-5" />}
          tone="sky"
        />
        <StatTile
          label={`Pending${scopeSuffix}`}
          value={showInstitutionView ? pendingInstitutionTasks.length : combinedPending.length}
          icon={<AlertCircle className="h-5 w-5" />}
          tone="peach"
        />
        <StatTile
          label={`Supervising${scopeSuffix}`}
          value={showInstitutionView ? supervisedInstitutionTasks.length : activeSupervisingTasks.length}
          icon={<Eye className="h-5 w-5" />}
          tone="violet"
        />
        <StatTile
          label={`Completed${scopeSuffix}`}
          value={showInstitutionView ? completedInstitutionTasks.length : completedTasks.length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="mint"
        />
      </StatTileGrid>
```

Note: the All/Wing tile uses a slightly different fallback because the all-time label is the two-word "All Tasks" / "Wing Tasks", but when a scope is applied the noun "Tasks" reads weird so it becomes "All Yesterday" / "Wing Yesterday". The expression `${prefix}${scopeSuffix || " Tasks"}` yields exactly those two shapes.

- [ ] **Step 4.6: Update every empty-state title with the suffix**

Locate the six EmptyState renders inside the `<div className="mt-6">` block (lines ~232–376).

Replace the static titles + descriptions with `scopeSuffix`-aware versions. Six edits, one per `<EmptyState>`:

**A. All Tasks (institution) empty state** — locate:

```tsx
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title="No active tasks"
              description={isSchoolAdmin ? "No active tasks in your institution." : "No active tasks to manage."}
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title={`No active tasks${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No active tasks in this window."
                  : isSchoolAdmin
                  ? "No active tasks in your institution."
                  : "No active tasks to manage."
              }
            />
```

**B. My Tasks empty state** — locate:

```tsx
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              title="No pending tasks"
              description="You're all caught up! No tasks assigned to you."
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              title={`No pending tasks${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No tasks assigned to you in this window."
                  : "You're all caught up! No tasks assigned to you."
              }
            />
```

**C. Assigned BY Me empty state** — locate:

```tsx
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title="No tasks assigned by you"
              description="Tasks you assign to others will appear here."
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<Inbox className="h-7 w-7" />}
              title={`No tasks assigned by you${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No tasks were assigned by you in this window."
                  : "Tasks you assign to others will appear here."
              }
            />
```

**D. Supervising empty state** — locate:

```tsx
            <EmptyState
              icon={<Eye className="h-7 w-7" />}
              title="No tasks to supervise"
              description="Tasks where you are tagged as supervisor will appear here."
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<Eye className="h-7 w-7" />}
              title={`No tasks to supervise${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No tasks under your supervision in this window."
                  : "Tasks where you are tagged as supervisor will appear here."
              }
            />
```

**E. Pending empty state** — locate:

```tsx
            <EmptyState
              icon={<AlertCircle className="h-7 w-7" />}
              title="No pending tasks"
              description="Tasks awaiting approval or pending action will appear here."
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<AlertCircle className="h-7 w-7" />}
              title={`No pending tasks${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No tasks were pending in this window."
                  : "Tasks awaiting approval or pending action will appear here."
              }
            />
```

**F. Completed empty state** — locate:

```tsx
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              title="No completed tasks"
              description="Completed tasks will appear here."
            />
```

Replace with:

```tsx
            <EmptyState
              icon={<CheckCircle2 className="h-7 w-7" />}
              title={`No completed tasks${scopeSuffix}`}
              description={
                scopeSuffix
                  ? "No tasks were completed in this window."
                  : "Completed tasks will appear here."
              }
            />
```

- [ ] **Step 4.7: Typecheck the page**

Run: `npx tsc --noEmit`
Expected: exit 0. All the derived arrays still have type `Task[]` because `filterTasksByDate<T extends Pick<Task,...>>(T[], ..., ...): T[]` preserves the element type.

- [ ] **Step 4.8: Lint touched files**

Run: `npx eslint src/pages/TasksPage.tsx src/lib/taskDateFilter.ts src/components/tms/TaskDateFilter.tsx src/components/shared/page/PageHeader.tsx`
Expected: zero errors. No `any`, no `let` that should be `const`. If you see `react-hooks/exhaustive-deps` warnings about the `useMemo` arrays, double-check the dep arrays match the closures.

- [ ] **Step 4.9: Production build**

Run: `npx vite build`
Expected: exit 0. Bundle-size warnings (>500 kB) are fine — only treat exit ≠ 0 as a block. The build catches issues `tsc` misses (lazy chunk imports, dynamic import path mistakes).

- [ ] **Step 4.10: Manual smoke**

This step is the user's verification — it can't be automated. Run the dev server and walk through the matrix below at 375 px viewport. (If you're inside an isolated worktree, start the dev server from there.)

Run: `npm run dev` (or whatever the project's dev script is — check `package.json`)

Then in the browser (375 px width via DevTools mobile emulation):

1. **All filter (default)** — page renders identically to pre-change: tab labels are plain "Assigned TO Me" / "Completed" / etc., tile labels are "Open" / "Completed" / etc., counts match the old behavior. Chip says "Date".
2. **Today** — tap chip → sheet opens → tap "Today" → sheet closes immediately, chip turns brand-primary and reads "Today". Stat tiles re-label: "Opened Today", "Completed Today". Tab labels gain " Today". Counts decrease (only today's tasks shown). Switching tabs reflects the same scope.
3. **Yesterday** — same path as Today; verify tile + tab labels read " Yesterday" and counts are different from Today.
4. **This Week / This Month** — verify counts grow vs. Today.
5. **Custom single date** — tap chip → tap "Single date" tab → pick a date from the calendar → tap "Apply" → sheet closes. Chip reads "on May 15" (or your chosen date). Counts reflect that exact day.
6. **Custom range** — tap chip → tap "Date range" tab → pick a start date → pick an end date → tap "Apply" → chip reads "May 1 – May 15". Verify counts reflect the full inclusive range.
7. **Reset** — with any filter active, tap chip → tap "Reset" → chip returns to "Date", labels and counts return to all-time baseline.
8. **Empty state with scope** — switch to "Completed Yesterday" on a day with no completions → the empty state title reads "No completed tasks Yesterday" and the description reads "No tasks were completed in this window."
9. **Dark mode** — toggle dark mode at the OS / app level. Chip, sheet, calendar, and tab strip all re-skin via tokens.
10. **Realtime resilience** — keep the page open with "Yesterday" applied. From another window or browser, mark one of yesterday's tasks complete. The Completed tile and tab should update without changing the active filter.

If any of steps 1–10 fail, that's a regression — fix it before committing.

- [ ] **Step 4.11: Commit**

```bash
git add src/pages/TasksPage.tsx
git commit -m "feat(tasks): scope tiles, tabs, lists, empty states by date filter

Wires TaskDateFilter into PageHeader extras. Each derived array runs
through filterTasksByDate with the per-surface field — created_at for
assigned/open/in-progress/pending/supervising, updated_at for completed.
Tile and tab labels gain a scope suffix when a filter is active; empty
states pick up scope-aware descriptions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Final verification

**Files:** none — verification only.

- [ ] **Step 5.1: Run full typecheck across the repo**

Run: `npx tsc --noEmit`
Expected: exit 0 with no new errors over the main-branch baseline.

- [ ] **Step 5.2: Run lint across all touched files**

Run: `npx eslint src/pages/TasksPage.tsx src/lib/taskDateFilter.ts src/components/tms/TaskDateFilter.tsx src/components/shared/page/PageHeader.tsx`
Expected: zero errors.

- [ ] **Step 5.3: Run production build**

Run: `npx vite build`
Expected: exit 0.

- [ ] **Step 5.4: Confirm git state is clean**

Run: `git status`
Expected: no unstaged changes. Five commits ahead on the current branch (helpers, component, PageHeader extras, page wiring, plus this plan + spec from earlier).

---

## Notes for the engineer

- **Do not write `toast.error(err.message)` anywhere.** This feature has no toast surface, but if you find yourself adding error handling (e.g. if a calendar throws on a malformed Date), route through `toastError` from `src/lib/toast.ts` per §19 of `.claude/CLAUDE.md`.
- **Do not change `useTasks.ts`, `useTaskRealtime`, or any DB query.** Filtering is purely client-side over the existing query results.
- **Do not edit `src/components/ui/calendar.tsx` or any shadcn primitive.** The shared `Calendar` already supports `mode="single"` and `mode="range"`.
- **Do not add CSS classes for new colors.** Every surface in this feature uses existing tokens (`bg-brand-primary`, `text-ink-700`, `border-surface-stroke`, `bg-ink-400/5`, etc.) — they already flip with `.dark`.
- **Do not persist filter state.** If you find yourself reaching for `localStorage` or a URL query param, stop — the spec's non-goals explicitly defer this.
- **`isWithinInterval` from date-fns is inclusive on both ends.** That's intentional and matches the `[startOfDay, endOfDay]` bounds we construct.
