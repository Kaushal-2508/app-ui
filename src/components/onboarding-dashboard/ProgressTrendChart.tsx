import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

export function ProgressTrendChart({ data }: Props) {
  if (data.trend.length === 0) {
    return null;
  }

  if (data.trend.length === 1) {
    const only = data.trend[0];
    return (
      <div className="surface-card frosted-shadow rounded-card p-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-brand-primary" />
          <div>
            <p className="eyebrow">Trend</p>
            <p className="text-sm text-ink-700">
              Today&apos;s snapshot is your first data point. A trend chart appears here once you
              have two or more days of history.
            </p>
            <p className="mt-2 text-sm text-ink-600">
              Today:{" "}
              <span className="font-semibold text-ink-900">{only.fully_complete_count}</span>{" "}
              fully complete, avg{" "}
              <span className="font-semibold text-ink-900">
                {Math.round(Number(only.avg_completion_percent))}%
              </span>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const chartData = data.trend.map((s) => ({
    date: s.snapshot_date,
    fullyComplete: s.fully_complete_count,
    avgCompletion: Number(s.avg_completion_percent),
  }));

  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Progress over time</p>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => format(parseISO(v as string), "d MMM")}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(v) => format(parseISO(v as string), "PPP")}
              formatter={(value: number, name: string) =>
                name === "Avg completion %"
                  ? [`${Math.round(value)}%`, name]
                  : [value, name]
              }
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="fullyComplete"
              name="Fully complete"
              stroke="hsl(var(--brand-primary))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="avgCompletion"
              name="Avg completion %"
              stroke="hsl(var(--brand-secondary))"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
