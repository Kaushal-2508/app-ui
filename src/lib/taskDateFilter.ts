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
  /**
   * Custom range; both `from` and `to` must be non-null for the filter to
   * resolve to a range. Either field being null causes `resolveDateRange`
   * to return null (treated as "no filter").
   */
  customRange?: { from: Date | null; to: Date | null };
};

export type DateRange = { from: Date; to: Date };

export const DEFAULT_FILTER: DateFilterState = Object.freeze({ preset: "all" }) as DateFilterState;

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
 * Filter a list of tasks (or a Task subtype with `created_at` / `updated_at`)
 * by an inclusive local-time date range. `null` range = no filtering.
 * Rows with a null timestamp on the selected field are excluded.
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

export function isFilterActive(filter: DateFilterState, now: Date = new Date()): boolean {
  return filter.preset !== "all" && resolveDateRange(filter, now) !== null;
}
