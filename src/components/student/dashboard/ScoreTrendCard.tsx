import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { LineChart as LineChartIcon } from "lucide-react";

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
import {
  useStudentPerformanceTrend,
  TREND_RANGE_OPTIONS,
  type TrendRange,
} from "@/hooks/useStudentClassComparison";
import { compareLatestToPrevious } from "@/lib/performanceLabels";
import { cn } from "@/lib/utils";
import { ToneLine } from "./toneChip";

/** Radix Select forbids an empty-string value, so "all subjects" needs a sentinel. */
const ALL = "__all__";

/**
 * Section 5 — the student's score per test over time, as one clean line (no
 * class/topper lines). Two filters sit in the header: subject and time window.
 *
 * "All subjects" plots every published result in the window, one point per test.
 * Picking a subject narrows the line to the tests that included that subject —
 * the schema has no per-subject mark, so this matches how My Results' subject
 * trajectory and the subject snapshot already read.
 */
export function ScoreTrendCard() {
  const navigate = useNavigate();
  const [subject, setSubject] = useState<string>(ALL);
  const [range, setRange] = useState<TrendRange>("3m");

  const { data, isLoading, isFetching } = useStudentPerformanceTrend(
    subject === ALL ? null : subject,
    range,
  );

  const points = useMemo(() => data?.points ?? [], [data]);
  const subjects = data?.subjects ?? [];

  const chartData = useMemo(
    () =>
      points.map((p) => ({
        label: p.exam_date ? format(new Date(p.exam_date), "d MMM") : "",
        title: p.title,
        percentage: Math.round(p.percentage),
        resultId: p.result_id,
      })),
    [points],
  );

  /**
   * Clicking anywhere in the plot opens the nearest test's result.
   *
   * Recharts hands back the point the cursor resolved to, which is a far more
   * forgiving target than the 4px dot itself — that matters most on a phone,
   * where hitting an exact dot is close to impossible.
   */
  const openNearestResult = (state: { activePayload?: Array<{ payload?: unknown }> }) => {
    const point = state?.activePayload?.[0]?.payload as { resultId?: string | null } | undefined;
    if (point?.resultId) navigate(`/student/results/${point.resultId}`);
  };

  const trend =
    points.length >= 2
      ? compareLatestToPrevious(
          points[points.length - 1].percentage,
          points[points.length - 2].percentage,
        )
      : null;

  // No published results at all is a different story from "your filters match nothing".
  const hasAnyResults = subjects.length > 0 || points.length > 0;
  const rangeLabel = TREND_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? "";

  return (
    <Card className="surface-card frosted-shadow rounded-card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base text-ink-900">
            <LineChartIcon className="h-4 w-4 text-brand-primary" />
            Performance Overview
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger
                aria-label="Filter by subject"
                className="h-8 w-[140px] rounded-lg text-xs"
              >
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={range} onValueChange={(v) => setRange(v as TrendRange)}>
              <SelectTrigger
                aria-label="Filter by time period"
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
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[240px] w-full rounded-2xl" />
        ) : !hasAnyResults ? (
          <EmptyState
            icon={<LineChartIcon className="h-7 w-7" />}
            title="No test scores yet"
            description="Once your results are published, your score trend will appear here."
            tone="sky"
          />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={<LineChartIcon className="h-7 w-7" />}
            title="No tests in this period"
            description={
              subject === ALL
                ? "Try a longer time period to see more of your results."
                : `No ${subject} tests in this period. Try a longer time period or another subject.`
            }
            tone="sky"
          />
        ) : (
          <div className={cn("flex flex-col gap-3", isFetching && "opacity-60")}>
            <div style={{ width: "100%", height: 240, cursor: "pointer" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
                  onClick={openNearestResult}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickMargin={8}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value}%`, "Score"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.title ?? "Test"}
                    contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="percentage"
                    stroke="hsl(var(--brand-primary))"
                    strokeWidth={3}
                    dot={{ fill: "hsl(var(--brand-primary))", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {trend && <ToneLine tone={trend.tone}>{trend.label}</ToneLine>}

            <p className="text-xs text-ink-500">
              {points.length === 1 ? "1 test" : `${points.length} tests`}
              {" · "}
              {subject === ALL ? "All subjects" : subject}
              {" · "}
              {rangeLabel}
            </p>

            {/* The chart is an SVG, so the click target carries no affordance of
                its own. Say so, and keep a keyboard-reachable route to the same
                place for anyone who can't tap a plot. */}
            <button
              type="button"
              onClick={() => navigate("/student/results")}
              className="self-start rounded-md text-xs font-medium text-brand-primary transition-colors hover:text-brand-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
            >
              Tap any point to open that test, or see all results
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
