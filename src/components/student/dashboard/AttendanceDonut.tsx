import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { CalendarCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { useStudentAttendanceSummary } from "@/hooks/useStudentMonthAttendance";
import {
  TREND_RANGE_OPTIONS,
  TREND_RANGE_PHRASE,
  type TrendRange,
} from "@/hooks/useStudentClassComparison";
import { attendanceLabel } from "@/lib/performanceLabels";
import { cn } from "@/lib/utils";
import { ToneLine } from "./toneChip";

// mint (present) / rose (absent) — tokens via fixed HSL hexes recharts can read.
const PRESENT_COLOR = "#10b981"; // emerald-500 (mint tone)
const ABSENT_COLOR = "#f43f5e"; // rose-500

/**
 * Section 4 — present-vs-absent donut over a selectable window, with a single
 * rule-based label beneath (warning only when below threshold).
 *
 * The window matters: with only one day marked so far this month a student can
 * read "100%", so the picker (same four options as Performance Overview) lets a
 * parent see the fuller picture. Totals are aggregated server-side.
 */
export function AttendanceDonut() {
  // Defaults to the calendar month so the card opens on the SAME window as the
  // "Attendance this month" tile above it. Any other default puts two different
  // attendance percentages on screen at once, which reads as a broken dashboard.
  const [range, setRange] = useState<TrendRange>("tm");
  const { data, isLoading, isFetching, isError } = useStudentAttendanceSummary(range);

  const present = data?.present ?? 0;
  const absent = data?.absent ?? 0;
  // Approved leave (and the legacy sick/casual) is excused: it stays out of
  // the ring and out of the percentage, but it is shown below so a low
  // "days marked" count has a visible explanation.
  const excused = data?.excused ?? 0;
  const total = present + absent;
  const pct = data?.percentage ?? null;
  const label = attendanceLabel(pct, TREND_RANGE_PHRASE[range]);
  const rangeLabel = TREND_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? "";

  const chartData = [
    { name: "Present", value: present, color: PRESENT_COLOR },
    { name: "Absent", value: absent, color: ABSENT_COLOR },
  ].filter((d) => d.value > 0);

  return (
    <Card className="surface-card frosted-shadow rounded-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-ink-900">
            <CalendarCheck className="h-4 w-4 text-brand-primary" />
            Attendance
          </CardTitle>

          <Select value={range} onValueChange={(v) => setRange(v as TrendRange)}>
            <SelectTrigger
              aria-label="Filter attendance by time period"
              className="h-8 w-[150px] rounded-lg text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TREND_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
        ) : isError ? (
          /* Error BEFORE empty (CLAUDE.md §6) — a failed RPC previously fell
             through to "No attendance yet", which reads as "you were never
             marked" rather than "we couldn't load it". */
          <EmptyState
            icon={<CalendarCheck className="h-7 w-7" />}
            title="Couldn't load your attendance"
            description="Please try again in a moment."
            tone="rose"
          />
        ) : total === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-7 w-7" />}
            title="No attendance yet"
            description={`Nothing was recorded ${TREND_RANGE_PHRASE[range]}. Try a longer time period.`}
            tone="sky"
          />
        ) : (
          <div className={cn("flex flex-col items-center gap-4", isFetching && "opacity-60")}>
            <div className="relative" style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={2}
                    stroke="hsl(var(--card))"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value} day${value === 1 ? "" : "s"}`,
                      name,
                    ]}
                    contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl font-bold tabular-nums text-ink-900">
                    {pct == null ? "N/A" : `${Math.round(pct)}%`}
                  </div>
                  <div className="eyebrow">Present</div>
                </div>
              </div>
            </div>

            <div className="flex justify-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRESENT_COLOR }} />
                <span className="text-ink-600">Present: {present}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ABSENT_COLOR }} />
                <span className="text-ink-600">Absent: {absent}</span>
              </span>
              {excused > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-violet-500/90 dark:bg-violet-400/90" />
                  <span className="text-ink-600">On leave: {excused}</span>
                </span>
              )}
            </div>

            {label.label && <ToneLine tone={label.tone}>{label.label}</ToneLine>}

            <p className="text-xs text-ink-500">
              {total === 1 ? "1 day marked" : `${total} days marked`}
              {" · "}
              {rangeLabel}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
