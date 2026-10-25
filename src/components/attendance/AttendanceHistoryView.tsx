import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isAfter,
  isBefore,
  startOfDay,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import {
  AttendanceRangeFilter,
  formatRange,
  presetRange,
  type RangePreset,
} from "@/components/attendance/AttendanceRangeFilter";
import {
  useUserAttendanceHistory,
  formatHistoryDate,
  type AttendanceKind,
  type AttendanceDateRange,
} from "@/hooks/useUserAttendanceHistory";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

const CODE_TONES: Record<string, string> = {
  P: "bg-emerald-500/90 text-white dark:bg-emerald-400/90",
  L: "bg-amber-500/90 text-white dark:bg-amber-400/90",
  A: "bg-rose-500/90 text-white dark:bg-rose-400/90",
  O: "bg-violet-500/90 text-white dark:bg-violet-400/90",
  H: "bg-sky-500/90 text-white dark:bg-sky-400/90",
};
const CODE_LABEL: Record<string, string> = {
  P: "Present",
  L: "Late",
  A: "Absent",
  O: "On leave / Sick / Casual",
  H: "Holiday",
};
// Superset maps — this component serves BOTH kinds. `late`/`on_leave` are
// staff-only statuses; `leave`/`sick`/`casual` are student-only.
const STATUS_LABEL: Record<string, string> = {
  present: "Present", late: "Late", absent: "Absent",
  on_leave: "On leave", leave: "On leave", sick: "Sick", casual: "Casual", holiday: "Holiday",
};
const STATUS_TONE: Record<string, string> = {
  present:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  late:     "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  absent:   "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  on_leave: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  leave:    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  sick:     "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  casual:   "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  holiday:  "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};

const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

export function useUserHeader(userId: string | null, kind: AttendanceKind) {
  return useQuery({
    queryKey: ["user-attendance-detail-header", userId, kind],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, email, roll_number")
        .eq("id", userId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!profile) return null;

      if (kind === "student") {
        const { data: ca } = await supabase
          .from("class_assignments")
          .select("classes!class_assignments_class_id_fkey(name, section)")
          .eq("user_id", userId)
          .eq("role", "student")
          .limit(1)
          .maybeSingle();
        type Row = { classes: { name: string; section: string | null } | null };
        const classes = (ca as Row | null)?.classes;
        return {
          ...profile,
          subtitle: classes
            ? classes.section
              ? `Class ${classes.name} ${classes.section}${profile.roll_number ? ` · Roll #${profile.roll_number}` : ""}`
              : classes.name
            : profile.email,
          role: "Student" as const,
        };
      }

      const { data: ca } = await supabase
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", userId)
        .eq("role", "teacher");
      const teaches = ca?.length ?? 0;
      // A staff member can hold more than one role row (coordinator + teacher,
      // admin + teacher), so this must read every relevant row. maybeSingle()
      // raised PGRST116 for them and silently mislabelled everyone "Teacher".
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["coordinator", "teacher"])
        .range(0, 9);

      if (roleError) throw roleError;
      const isCoord = (roleRows ?? []).some((r) => r.role === "coordinator");
      return {
        ...profile,
        subtitle: isCoord
          ? `Coordinator${teaches > 0 ? ` · ${teaches} class${teaches === 1 ? "" : "es"}` : ""}`
          : `Teacher · ${teaches} class${teaches === 1 ? "" : "es"}`,
        role: (isCoord ? "Coordinator" : "Teacher") as "Coordinator" | "Teacher",
      };
    },
  });
}

function CodeChip({ code }: { code: string }) {
  if (!code) return <span className="text-ink-400 text-xs">·</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full text-[11px] font-bold",
        CODE_TONES[code] ?? "bg-ink-400/15 text-ink-700",
      )}
      title={CODE_LABEL[code] ?? code}
    >
      {code}
    </span>
  );
}

interface AttendanceHistoryViewProps {
  userId: string | null;
  kind: AttendanceKind;
  /** When true, render the user header (avatar + name + role/class). */
  showHeader?: boolean;
}

/**
 * Reusable attendance-history block. Used both inside
 * UserAttendanceDetailPage (full-page detail with back button) and
 * inside the teacher's "My Attendance" tab on SchoolAttendancePage
 * (just the data, no chrome). Owns no routing — pure render.
 */
export function AttendanceHistoryView({ userId, kind, showHeader = false }: AttendanceHistoryViewProps) {
  const headerQ = useUserHeader(userId, kind);

  // Date window, default this month to date (asked 2026-09-26; it was a
  // fixed last-60-days). The chip beside the counts changes it.
  const [preset, setPreset] = useState<RangePreset>("mtd");
  const [range, setRange] = useState<AttendanceDateRange>(() => presetRange("mtd"));
  const { summary, isLoading, isError } = useUserAttendanceHistory(userId, kind, range);

  const rangeStart = useMemo(() => parseISO(range.from), [range.from]);
  const rangeEnd = useMemo(() => parseISO(range.to), [range.to]);

  // The calendar shows one month at a time, starting on the window's last
  // month, and pages only through months the window touches.
  const [monthOffset, setMonthOffset] = useState(0);
  const lastMonth = startOfMonth(rangeEnd);
  const firstMonth = startOfMonth(rangeStart);
  const monthAnchor = subMonths(lastMonth, monthOffset);
  const canGoBack = isAfter(monthAnchor, firstMonth);
  const canGoForward = monthOffset > 0;
  const changeRange = (r: AttendanceDateRange, p: RangePreset) => {
    setRange(r);
    setPreset(p);
    setMonthOffset(0);
  };

  const monthStart = startOfMonth(monthAnchor);
  const monthEnd = endOfMonth(monthAnchor);
  const monthCells = useMemo(() => {
    const leading = getDay(monthStart);
    const blanks: (Date | null)[] = Array.from({ length: leading }, () => null);
    return [...blanks, ...eachDayOfInterval({ start: monthStart, end: monthEnd })];
  }, [monthStart, monthEnd]);
  const today = startOfDay(new Date());
  const rangeLabel = formatRange(range);

  const fullName = headerQ.data?.full_name ?? "Loading…";
  const subtitle = headerQ.data?.subtitle ?? "";
  const count = (n: number | undefined) => (isLoading ? "…" : n ?? 0);

  const header = showHeader && (
    <div className="flex items-start gap-3 pt-2">
      <Avatar className="h-12 w-12 mt-0.5">
        <AvatarFallback className="text-sm">
          {fullName
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-semibold text-ink-900 mt-0.5 truncate">{fullName}</h2>
        <p className="text-sm text-ink-600 truncate">{subtitle}</p>
      </div>
    </div>
  );

  // Error state before anything else: a failed fetch must not render as
  // "0 Present, 100%" over an empty calendar (§6).
  if (isError) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          tone="rose"
          icon={<Clock className="h-7 w-7" />}
          title="Couldn't load attendance"
          description="Please try again in a moment."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {/* Plain counts for the window, not a rate. The old "100% attended"
          headline counted late as attended (platform rule), so five late
          mornings still read as perfect and nobody could act on it
          (2026-09-26). Four numbers plus the usual times say what happened. */}
      <section className="space-y-3">
        {/* Exact dates as the heading, the picker chip at the right end of
            the same row (the placement Naman confirmed, 2026-09-26). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">{rangeLabel}</p>
          <AttendanceRangeFilter value={range} preset={preset} onChange={changeRange} />
        </div>
        <StatTileGrid cols={2} mdCols={4}>
          <StatTile label="Present" value={count(summary?.presentCount)} tone="mint" className="p-4" />
          <StatTile label="Late" value={count(summary?.lateCount)} tone="peach" className="p-4" />
          <StatTile label="Absent" value={count(summary?.absentCount)} tone="rose" className="p-4" />
          <StatTile label="On leave" value={count(summary?.leaveCount)} tone="violet" className="p-4" />
        </StatTileGrid>
        {summary && (summary.typicalCheckIn || summary.lastLate || summary.lastAbsent) && (
          <div className="surface-card frosted-shadow rounded-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {kind === "staff" && summary.typicalCheckIn && (
              <div>
                <p className="eyebrow">Usual check-in</p>
                <p className="mt-0.5 font-medium text-ink-900 tabular-nums">
                  {summary.typicalCheckIn}
                  {summary.typicalCheckOut && (
                    <span className="font-normal text-ink-500"> · out {summary.typicalCheckOut}</span>
                  )}
                </p>
              </div>
            )}
            {summary.lastLate && (
              <div>
                <p className="eyebrow">Last late</p>
                <p className="mt-0.5 font-medium text-ink-900">
                  {formatHistoryDate(summary.lastLate.date)}
                  {summary.lastLate.checkInAt && (
                    <span className="font-normal text-ink-500"> · in at {format(parseISO(summary.lastLate.checkInAt), "h:mm a")}</span>
                  )}
                </p>
              </div>
            )}
            {summary.lastAbsent && (
              <div>
                <p className="eyebrow">Last absent</p>
                <p className="mt-0.5 font-medium text-ink-900">{formatHistoryDate(summary.lastAbsent.date)}</p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {/* Pager only when the window spans more than one month. */}
            {canGoBack || canGoForward ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                disabled={!canGoBack}
                onClick={() => setMonthOffset((o) => o + 1)}
                className="h-7 w-7 rounded-full text-ink-500"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <p className="eyebrow">{format(monthAnchor, "MMMM yyyy")}</p>
            {canGoBack || canGoForward ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next month"
                disabled={!canGoForward}
                onClick={() => setMonthOffset((o) => Math.max(0, o - 1))}
                className="h-7 w-7 rounded-full text-ink-500"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-ink-400">P present · L late · A absent · O leave · H holiday</p>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {WEEKDAY_HEADERS.map((d, i) => (
            <div
              key={`h-${i}`}
              className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-400 py-1"
            >
              {d}
            </div>
          ))}
          {monthCells.map((cell, i) => {
            if (!cell) return <div key={`b-${i}`} aria-hidden />;
            // Days outside the chosen window show their number only, dimmed,
            // so a month that the window cuts through still reads as a month.
            const outside = isBefore(cell, rangeStart) || isAfter(cell, rangeEnd);
            const code = outside ? "" : (summary?.byDate.get(ymd(cell)) ?? "");
            const isFuture = isAfter(cell, today);
            return (
              <div
                key={ymd(cell)}
                // Fixed height, not aspect-square: the grid spans the full card,
                // so a square cell grew to ~220px tall on a laptop and the month
                // needed three screens of scrolling.
                className={cn("h-14 sm:h-16 flex flex-col items-center justify-center gap-0.5", outside && "opacity-40")}
                title={`${format(cell, "EEE, d MMM")}${code ? ` · ${CODE_LABEL[code] ?? code}` : ""}`}
              >
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isFuture || outside ? "text-ink-300" : "text-ink-500",
                  )}
                >
                  {format(cell, "d")}
                </span>
                {outside ? <span className="h-7 sm:h-8" aria-hidden /> : <CodeChip code={code} />}
              </div>
            );
          })}
        </div>
      </section>

      <section className="surface-card frosted-shadow rounded-card p-5">
        <p className="eyebrow">Recent activity</p>
        {isLoading ? (
          <div className="mt-3 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : !summary || summary.rows.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-7 w-7" />}
            title="No records in this range"
            description={`Attendance wasn't marked between ${rangeLabel}.`}
          />
        ) : (
          <ul className="mt-3 divide-y divide-[hsl(var(--surface-stroke))] list-none p-0">
            {summary.rows.slice(0, 30).map((r, idx) => (
              <li key={`${r.date}-${idx}`} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900">{formatHistoryDate(r.date)}</p>
                  <p className="text-xs text-ink-500 truncate">
                    {kind === "staff"
                      ? r.checkInAt
                        ? `Check-in ${format(parseISO(r.checkInAt), "h:mm a")}${r.checkOutAt ? ` · out ${format(parseISO(r.checkOutAt), "h:mm a")}` : ""}`
                        : "No check-in recorded"
                      : r.className ?? ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                    STATUS_TONE[r.status] ?? "bg-ink-400/15 text-ink-600",
                  )}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
