import * as React from "react";
import { useNavigate } from "react-router-dom";

import { useSubjectHeatmap } from "@/hooks/dashboard/useDashboardData";
import type { HeatmapBand, SubjectHeatmapCell } from "@/hooks/dashboard/types";
import { WidgetCard } from "@/components/command-center/WidgetCard";

const CAPTION =
  "Red boxes show where a group of classes is weak in a subject. Green boxes show where they're doing well.";
const CLICK_HINT = "Tap any box to see the classes in that group, in that subject.";

// Tinted backgrounds + readable foreground by band. Severity tokens: red / amber / green.
const BAND_STYLE: Record<HeatmapBand, { bg: string; fg: string }> = {
  red: { bg: "hsl(var(--destructive) / 0.14)", fg: "hsl(var(--destructive))" },
  amber: { bg: "hsl(var(--chart-2) / 0.16)", fg: "hsl(var(--chart-2))" },
  green: { bg: "hsl(var(--chart-3) / 0.16)", fg: "hsl(var(--chart-3))" },
};

export function ClassSubjectHeatmapWidget() {
  const navigate = useNavigate();
  const heatmap = useSubjectHeatmap();
  const rows = React.useMemo(() => heatmap.data?.rows ?? [], [heatmap.data]);

  // Columns = union of all subject names across every row, in first-seen order.
  const subjects: string[] = React.useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    rows.forEach((r) =>
      r.cells.forEach((c) => {
        if (!seen.has(c.subject_name)) {
          seen.add(c.subject_name);
          ordered.push(c.subject_name);
        }
      }),
    );
    return ordered;
  }, [rows]);

  // Lookup: band_label → subject_name → cell.
  const cellLookup = React.useMemo(() => {
    const map = new Map<string, Map<string, SubjectHeatmapCell>>();
    rows.forEach((r) => {
      const inner = new Map<string, SubjectHeatmapCell>();
      r.cells.forEach((c) => inner.set(c.subject_name, c));
      map.set(r.band_label, inner);
    });
    return map;
  }, [rows]);

  const isEmpty = !heatmap.isLoading && !heatmap.isError && rows.length === 0;

  return (
    <WidgetCard
      title="Class groups vs subjects"
      caption={CAPTION}
      clickHint={CLICK_HINT}
      isLoading={heatmap.isLoading}
      isError={heatmap.isError}
      onRetry={() => heatmap.refetch()}
      isEmpty={isEmpty}
      emptyTitle="No exam data yet"
      emptyDescription="This grid fills in once classes have published exams."
    >
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface-card px-2 py-1.5 text-left text-xs font-medium text-ink-500">
                Group
              </th>
              {subjects.map((s) => (
                <th
                  key={s}
                  className="px-2 py-1.5 text-center text-xs font-medium text-ink-600 whitespace-nowrap"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.band_label}>
                <th className="sticky left-0 z-10 bg-surface-card px-2 py-2 text-left text-xs font-semibold text-ink-900 whitespace-nowrap">
                  {row.band_label}
                </th>
                {subjects.map((subject) => {
                  const cell = cellLookup.get(row.band_label)?.get(subject);
                  if (!cell) {
                    return (
                      <td
                        key={subject}
                        className="rounded-lg bg-ink-400/5 px-2 py-2 text-center text-base font-medium text-ink-400"
                      >
                        N/A
                      </td>
                    );
                  }
                  const style = BAND_STYLE[cell.band];
                  return (
                    <td key={subject} className="p-0">
                      <button
                        type="button"
                        onClick={() => navigate("/school/analytics")}
                        style={{ backgroundColor: style.bg, color: style.fg }}
                        className="flex h-full w-full items-center justify-center rounded-lg px-2 py-2.5 text-base font-bold transition-opacity duration-200 hover:opacity-80"
                      >
                        {cell.avg_pct}%
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetCard>
  );
}
