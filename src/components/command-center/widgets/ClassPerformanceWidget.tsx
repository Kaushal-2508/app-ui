import { useMemo, useState } from "react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { cn } from "@/lib/utils";
import { useScopedClassPerformance } from "@/hooks/dashboard/useCoordinatorDashboardData";
import type { ClassPerformanceRow } from "@/hooks/dashboard/coordinatorTypes";

/**
 * Class-wise average score, as the reference mockup's COLUMN chart: one bar per
 * class, the value printed above each bar, a dashed wing-average reference line
 * across the plot, and class names on the x axis. Weakest first, so the ordering
 * is itself the recommendation.
 *
 * Drawn with flex and CSS rather than Recharts. The chart is a plain magnitude
 * comparison with no axes, tooltips or interaction to justify the library, and
 * `ResponsiveContainer` needs an explicit pixel height inside a grid parent or
 * it collapses to zero on mobile — a bug this markup cannot have.
 *
 * Every colour is a token, so the whole chart flips in dark mode.
 */

/** Bar fill by score band. Mirrors the mockup's status ramp, via tokens. */
function bandClass(pct: number) {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 65) return "bg-brand-primary";
  if (pct >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

/** Short label for the x axis — "Class 12 Science A" is unreadable at 375px. */
function shortName(name: string) {
  return name.replace(/^Class\s+/i, "").replace(/\bScience\b/i, "Sci").replace(/\bCommerce\b/i, "Com").replace(/\bHumanities\b/i, "Hum");
}

export function ClassPerformanceWidget() {
  const { data, isLoading, isError, refetch } = useScopedClassPerformance();
  const [asTable, setAsTable] = useState(false);

  const rows: ClassPerformanceRow[] = useMemo(() => data?.rows ?? [], [data]);
  const avg = data?.scope_avg_pct ?? null;

  // Domain padded around the data so short bars stay visible and the tallest
  // never touches the ceiling. Clamped to 0-100 since these are percentages.
  const { min, max } = useMemo(() => {
    const values = rows.map((r) => r.avg_pct ?? 0);
    if (avg != null) values.push(avg);
    if (values.length === 0) return { min: 0, max: 100 };
    return {
      min: Math.max(0, Math.floor((Math.min(...values) - 10) / 5) * 5),
      max: Math.min(100, Math.ceil((Math.max(...values) + 8) / 5) * 5),
    };
  }, [rows, avg]);

  const toPct = (v: number) => ((v - min) / Math.max(max - min, 1)) * 100;

  return (
    <WidgetCard
      title="Class-wise average score"
      caption="Mean result percentage per class this academic year, weakest first. The dashed line is your wing average."
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No results published yet"
      emptyDescription="Once exams in your wing are graded and published, class averages appear here."
      headerSlot={
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className={cn(
            "whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
            asTable
              ? "border-ink-900 bg-ink-900 text-[hsl(var(--surface-card))]"
              : "border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.06)] text-ink-500 hover:text-ink-900",
          )}
        >
          {asTable ? "View as chart" : "View as table"}
        </button>
      }
      className="scroll-mt-24"
    >
      <div id="dash-class-performance">
        {asTable ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="border-b border-[hsl(var(--surface-stroke))] px-2 pb-2 text-left text-[11px] font-bold text-ink-500">
                    Class
                  </th>
                  <th className="border-b border-[hsl(var(--surface-stroke))] px-2 pb-2 text-right text-[11px] font-bold text-ink-500">
                    Avg. score
                  </th>
                  <th className="border-b border-[hsl(var(--surface-stroke))] px-2 pb-2 text-right text-[11px] font-bold text-ink-500">
                    Results
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.class_id}>
                    <td className="border-b border-[hsl(var(--surface-stroke))] px-2 py-2 text-ink-700">
                      {r.class_name}
                    </td>
                    <td
                      className={cn(
                        "border-b border-[hsl(var(--surface-stroke))] px-2 py-2 text-right font-bold tabular-nums",
                        avg != null && (r.avg_pct ?? 0) < avg ? "text-rose-600" : "text-ink-700",
                      )}
                    >
                      {r.avg_pct ?? 0}%
                    </td>
                    <td className="border-b border-[hsl(var(--surface-stroke))] px-2 py-2 text-right tabular-nums text-ink-500">
                      {r.results}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            {/* Plot area. The chart scrolls horizontally rather than crushing
                18 columns into 375px. */}
            <div className="overflow-x-auto pt-5">
              <div className="min-w-[520px]">
                <div className="relative h-[186px] border-b border-[hsl(var(--surface-stroke))]">
                  {avg != null && (
                    <div
                      className="absolute inset-x-0 z-10 border-t-2 border-dashed border-ink-400"
                      style={{ bottom: `${toPct(avg)}%` }}
                    >
                      <span className="absolute -top-[17px] right-0 whitespace-nowrap rounded bg-[hsl(var(--surface-card))] px-1 text-[10px] font-bold text-ink-500">
                        Wing avg {avg}%
                      </span>
                    </div>
                  )}

                  <div className="absolute inset-0 flex items-end gap-2 px-1">
                    {rows.map((r) => {
                      const v = r.avg_pct ?? 0;
                      return (
                        <div
                          key={r.class_id}
                          className="relative flex h-full flex-1 items-end justify-center"
                        >
                          <div
                            className={cn(
                              "relative w-full max-w-[34px] rounded-t-md",
                              bandClass(v),
                            )}
                            style={{ height: `${Math.max(toPct(v), 2)}%` }}
                            title={`${r.class_name}: ${v}% from ${r.results} results`}
                          >
                            <span className="absolute -top-[18px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-extrabold tabular-nums text-ink-700">
                              {v}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2 px-1 pt-2">
                  {rows.map((r) => (
                    <div
                      key={r.class_id}
                      className="flex-1 truncate text-center text-[9.5px] font-bold text-ink-500"
                      title={r.class_name}
                    >
                      {shortName(r.class_name)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {avg != null && (
              <p className="mt-3 text-[12px] text-ink-500">
                Wing average <span className="font-bold tabular-nums text-ink-700">{avg}%</span>{" "}
                across {rows.length} class{rows.length === 1 ? "" : "es"} with published results.
              </p>
            )}
          </>
        )}
      </div>
    </WidgetCard>
  );
}
