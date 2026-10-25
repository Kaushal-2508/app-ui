import { useMemo, useState } from "react";
import {
  format,
  getDay,
  startOfMonth,
  addMonths,
  subMonths,
  isSameMonth,
  isAfter,
  startOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  useStudentMonthAttendance,
  type DayAttendanceCode,
} from "@/hooks/useStudentMonthAttendance";
import { CODE_TONES, CODE_LABEL } from "@/components/attendance/attendanceTones";
import { cn } from "@/lib/utils";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Compact student attendance widget for the dashboard. Renders:
 *  - a big effective-attendance percentage
 *  - a chip strip with present / late / absent counts
 *  - a calendar grid for the active month with tone-coded day cells
 *
 * Data comes from `useStudentMonthAttendance`, which is RLS-scoped via
 * `student_id = auth.uid()` so it's safe to mount unconditionally for
 * any signed-in student. The caller (RoleBasedDashboard) gates the
 * widget behind `isFeatureEnabled("attendance")` so institutions with
 * the feature off don't see it.
 */
export function StudentAttendanceWidget() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const { data, isLoading } = useStudentMonthAttendance(anchor);

  const monthLabel = format(anchor, "MMMM yyyy");

  // Calendar grid: pad the first week so the 1st of the month aligns
  // under its weekday header (Sunday-first).
  const cells = useMemo(() => {
    const start = startOfMonth(anchor);
    const leading = getDay(start); // 0 = Sun
    const blanks: (Date | null)[] = Array.from({ length: leading }, () => null);
    return [...blanks, ...(data?.daysInMonth ?? [])];
  }, [anchor, data?.daysInMonth]);

  const today = startOfDay(new Date());

  if (isLoading) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-5 sm:p-6">
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-9 w-32 mb-4" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!data) return null;

  const pct = data.percentage;
  const pctLabel = pct === null ? "N/A" : `${pct.toFixed(0)}%`;
  const totalDays = data.presentCount + data.absentCount;
  const attendedDays = data.presentCount;

  return (
    <section className="surface-card frosted-shadow rounded-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow inline-flex items-center gap-1">
            <ClipboardCheck className="h-3 w-3" />
            Your attendance
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold text-ink-900 tabular-nums">
              {pctLabel}
            </span>
            {pct !== null && (
              <span className="text-sm text-ink-500">
                {attendedDays} of {totalDays} day{totalDays === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-600">
            <Pill label="Present" count={data.presentCount} className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" />
            {data.absentCount > 0 && (
              <Pill label="Absent" count={data.absentCount} className="bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300" />
            )}
            {data.excusedCount > 0 && (
              <Pill label="On leave" count={data.excusedCount} className="bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300" />
            )}
            {data.holidayCount > 0 && (
              <Pill label="Holidays" count={data.holidayCount} className="bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" />
            )}
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setAnchor((a) => subMonths(a, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[7.5rem] text-center text-sm font-medium text-ink-700">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setAnchor((a) => addMonths(a, 1))}
            disabled={isSameMonth(anchor, new Date()) || isAfter(anchor, new Date())}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="mt-4 grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((d, i) => (
          <div
            key={`h-${i}`}
            className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-400 py-1"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`b-${i}`} aria-hidden />;
          const code = data.byDate.get(ymd(cell)) ?? "none";
          const isToday = ymd(cell) === ymd(today);
          const isFuture = isAfter(cell, today);
          return (
            <div
              key={ymd(cell)}
              className="aspect-square flex items-center justify-center"
              title={`${format(cell, "EEE, d MMM")} · ${CODE_LABEL[code]}`}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full text-xs font-medium tabular-nums",
                  code === "none"
                    ? isFuture
                      ? "text-ink-400"
                      : "text-ink-600 bg-ink-400/10"
                    : CODE_TONES[code],
                  isToday && code === "none" && "ring-2 ring-brand-primary/50",
                  isToday && code !== "none" && "ring-2 ring-offset-2 ring-brand-primary/40 ring-offset-[hsl(var(--surface-card))]",
                )}
              >
                {format(cell, "d")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <LegendDot tone="bg-emerald-500/90" label="Present" />
        <LegendDot tone="bg-rose-500/90" label="Absent" />
        <LegendDot tone="bg-violet-500/90" label="Leave" />
        <LegendDot tone="bg-sky-500/90" label="Holiday" />
      </div>
    </section>
  );
}

function Pill({ label, count, className }: { label: string; count: number; className: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-semibold tabular-nums",
        className,
      )}
    >
      {count} {label}
    </span>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2 w-2 rounded-full", tone)} aria-hidden />
      {label}
    </span>
  );
}
