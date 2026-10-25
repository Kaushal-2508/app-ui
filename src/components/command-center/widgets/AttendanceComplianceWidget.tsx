import { CalendarX2 } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { cn } from "@/lib/utils";
import { useAttendanceCompliance } from "@/hooks/dashboard/useCoordinatorDashboardData";

function fmtDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Which classes are not logging attendance.
 *
 * The reference day is the most recent date on which at least a quarter of the
 * school's active classes marked attendance — not simply the latest row in the
 * table. Using the latter meant that at 8am, when one class had marked, every
 * other class in the school read as delinquent.
 *
 * This is a compliance surface as much as a data-quality one: an absence nobody
 * recorded is an absence nobody can follow up.
 */
export function AttendanceComplianceWidget() {
  const { data, isLoading, isError, refetch } = useAttendanceCompliance(14);

  const rows = data?.rows ?? [];
  const missing = data?.missing_today ?? 0;
  const totalClasses = data?.total_classes ?? 0;
  const latest = fmtDate(data?.latest_date ?? null);
  const workingDays = data?.working_days ?? 0;
  const neverMarked = rows.filter((r) => r.last_marked == null).length;

  return (
    <WidgetCard
      title="Attendance logging compliance"
      caption="How reliably each class records attendance, measured over the last 14 days of school."
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
      isEmpty={!isLoading && !isError && (totalClasses === 0 || workingDays === 0)}
      emptyTitle="No attendance recorded yet"
      emptyDescription="Nothing has been logged for your classes in the last two weeks, so there is no compliance to measure."
      className="scroll-mt-24"
    >
      <div id="dash-attendance-compliance">
        {missing > 0 && latest && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3.5 py-3">
            <CalendarX2
              className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-amber-700">
                {missing} of {totalClasses} classes missed the last school day ({latest})
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-ink-600">
                {neverMarked > 0
                  ? `${neverMarked} class${neverMarked === 1 ? " has" : "es have"} logged nothing at all in the last two weeks.`
                  : "An absence nobody recorded is an absence nobody can follow up."}
              </p>
            </div>
          </div>
        )}

        <p className="mb-3 text-[12px] text-ink-500">
          Measured against {workingDays} school day{workingDays === 1 ? "" : "s"} · least compliant
          first
        </p>

        <ul className="space-y-2.5">
          {rows.map((r) => {
            const pct = r.pct ?? 0;
            return (
              <li
                key={r.class_id}
                className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3"
              >
                <span className="truncate text-[12.5px] font-medium text-ink-700" title={r.class_name}>
                  {r.class_name}
                </span>
                <span className="h-2.5 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-stroke))]">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      pct >= 80
                        ? "bg-emerald-500"
                        : pct >= 50
                          ? "bg-brand-primary"
                          : pct > 0
                            ? "bg-amber-500"
                            : "bg-rose-500",
                    )}
                    style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                  />
                </span>
                <span className="shrink-0 text-right text-[12px] tabular-nums">
                  <span
                    className={cn(
                      "font-bold",
                      pct >= 50 ? "text-ink-700" : "text-rose-600",
                    )}
                  >
                    {pct}%
                  </span>
                  <span className="ml-1.5 text-ink-400">
                    {r.last_marked ? fmtDate(r.last_marked) : "none"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </WidgetCard>
  );
}
