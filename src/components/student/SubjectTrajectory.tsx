import { TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { compareLatestToPrevious } from "@/lib/performanceLabels";
import { TONES } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface TrajectoryPoint {
  /** Used as the React key + tooltip identity. */
  id: string;
  label: string;
  date: string;
  percentage: number;
}

interface SubjectTrajectoryProps {
  subject: string;
  /** Chronological (ASC) own-data points for the filtered tests in this subject. */
  points: TrajectoryPoint[];
}

/**
 * Single-series trajectory of the student's own percentage across the FILTERED
 * tests in one subject (own-data, no class needed). Renders a mini line plus
 * exactly one rule-based direction label from compareLatestToPrevious.
 *
 * Recharts wrapper uses an explicit inline height (a Tailwind h-NN class
 * collapses to 0 on mobile — known bug, see §20).
 */
export function SubjectTrajectory({ subject, points }: SubjectTrajectoryProps) {
  const latest = points.length ? points[points.length - 1].percentage : null;
  const previous = points.length >= 2 ? points[points.length - 2].percentage : null;
  const trend = compareLatestToPrevious(latest, previous);
  const trendTone = TONES[trend.tone];

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ink-600" />
          <h3 className="text-sm font-semibold text-ink-900">{subject} trajectory</h3>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
            trendTone.bg,
            trendTone.fg,
          )}
        >
          {trend.label}
        </span>
      </div>

      {points.length >= 2 ? (
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-surface-stroke" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                className="fill-ink-500"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                tickFormatter={(val) => `${val}%`}
                className="fill-ink-500"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Your score"]}
                labelFormatter={(_label, payload) =>
                  payload && payload[0]
                    ? (payload[0].payload as TrajectoryPoint).label
                    : ""
                }
              />
              <Line
                type="monotone"
                dataKey="percentage"
                stroke="hsl(var(--brand-primary))"
                strokeWidth={2}
                dot={{ fill: "hsl(var(--brand-primary))", strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-ink-600">
          {points.length === 1
            ? "One test so far in this subject. Take another to see the trajectory."
            : "No tests in this subject for the chosen filters."}
        </p>
      )}
    </section>
  );
}
