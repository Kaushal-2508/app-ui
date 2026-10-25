import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

import { useAttendanceTrend } from "@/hooks/dashboard/useDashboardData";
import type { AttendanceTrendPoint } from "@/hooks/dashboard/types";
import { FilterChip } from "@/components/shared/nav";
import { WidgetCard } from "@/components/command-center/WidgetCard";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";
import { useDashboardClassList } from "@/hooks/dashboard/useDashboardData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CAPTION =
  "Each point is one day's attendance. If the line is going down, attendance is dropping. The dotted line is your school's usual average.";
const CLICK_HINT = "Tap the chart to see more detailed attendance reports.";

const WINDOWS = [30, 60, 90] as const;
type Window = (typeof WINDOWS)[number];

interface ChartPoint extends AttendanceTrendPoint {
  label: string;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}

function TrendTooltip({ active, payload }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded-lg border border-surface-stroke bg-surface-card px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-ink-900">{pt.label}</p>
      <p className="mt-1 text-ink-600">
        Attendance:{" "}
        <span className="font-medium text-ink-900">{pt.pct != null ? `${pt.pct}%` : "N/A"}</span>
      </p>
      <p className="text-ink-600">
        {pt.present} of {pt.total} present
      </p>
    </div>
  );
}

export function AttendanceTrendWidget() {
  const scope = useDashboardScope();
  const navigate = useNavigate();
  const [days, setDays] = React.useState<Window>(30);
  // Options are the caller's own classes, so the picker can never offer one the
  // RPC would reject. Hidden entirely for a single-class teacher.
  const classesQuery = useDashboardClassList();
  const classOptions = React.useMemo(
    () => (classesQuery.data ?? []).map((c) => ({
      id: c.id,
      label: c.section ? `${c.name} ${c.section}` : c.name,
    })),
    [classesQuery.data],
  );
  const [classId, setClassId] = React.useState<string | null>(null);
  // Offered at every scope now: the institution RPC gained a class filter, and
  // "which class caused that dip?" is an admin question before it is a
  // teacher's.
  const showClass = classOptions.length > 1;
  // "All my classes" is a teacher's phrasing; an admin owns none of them.
  const allLabel = scope === "teacher" ? "All my classes" : "All classes";

  const trend = useAttendanceTrend(days, showClass ? classId : null);

  const points: ChartPoint[] = React.useMemo(() => {
    const raw = trend.data?.points ?? [];
    return raw.map((p) => ({ ...p, label: formatDay(p.date) }));
  }, [trend.data]);

  const allTimeAvg = trend.data?.all_time_avg ?? null;
  // Five points for every scope, not fourteen for admins.
  //
  // The teacher path was already lowered because a class with 42 attendance
  // days had only 13 inside the 30-day window and the card hid itself by one
  // day. The admin path had exactly the same bug and kept the old threshold:
  // Salci National has 12 recorded days, so a real 12-day trend was replaced by
  // "not enough attendance yet". A line needs two points to be a line; hiding
  // measured data behind an arbitrary fortnight is worse than a short chart.
  const minPoints = 5;
  const isEmpty = !trend.isLoading && !trend.isError && points.length < minPoints;
  // Narrowed to one class, the school-wide copy is a lie: the school may have
  // plenty of attendance while this class has none. Most classes here have
  // never been marked, so a picker that always said "not enough attendance
  // yet" would read as a broken filter rather than a real finding.
  const emptyClassName = classId
    ? classOptions.find((c) => c.id === classId)?.label
    : null;

  const headerSlot = (
    <div className="flex items-center gap-2">
      {showClass && (
        <Select value={classId ?? "all"} onValueChange={(v) => setClassId(v === "all" ? null : v)}>
          <SelectTrigger className="h-9 w-[150px] rounded-lg text-sm">
            <SelectValue placeholder={allLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{allLabel}</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {WINDOWS.map((w) => (
        <FilterChip
          key={w}
          label={`${w}d`}
          active={days === w}
          onClick={() => setDays(w)}
          trailing={<span aria-hidden className="hidden" />}
          className="h-8 px-3"
        />
      ))}
    </div>
  );

  return (
    <WidgetCard
      title="Attendance trend"
      caption={CAPTION}
      clickHint={CLICK_HINT}
      headerSlot={headerSlot}
      isLoading={trend.isLoading}
      isError={trend.isError}
      onRetry={() => trend.refetch()}
      isEmpty={isEmpty}
      emptyTitle={
        emptyClassName
          ? `No attendance recorded for ${emptyClassName}`
          : "Not enough attendance yet"
      }
      emptyDescription={
        emptyClassName
          ? `This class has fewer than ${minPoints} marked days in the last ${days}. Pick another class, widen the window, or mark its register.`
          : `This will appear once you have ${minPoints} days of attendance recorded.`
      }
      emptyAction={{ label: "Mark attendance", onClick: () => navigate("/school/attendance") }}
    >
      <div
        style={{ width: "100%", height: 256 }}
        className="cursor-pointer"
        onClick={() => navigate("/school/attendance")}
      >
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--surface-stroke))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--ink-500))" }}
              minTickGap={24}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "hsl(var(--ink-500))" }}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
            />
            <Tooltip content={<TrendTooltip />} />
            {allTimeAvg != null && (
              <ReferenceLine
                y={allTimeAvg}
                stroke="hsl(var(--brand-secondary))"
                strokeDasharray="5 4"
                strokeWidth={1.5}
              />
            )}
            <Line
              type="monotone"
              dataKey="pct"
              stroke="hsl(var(--brand-primary))"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  );
}
