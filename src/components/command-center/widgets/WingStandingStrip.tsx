import { useState } from "react";
import { Medal } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWingStanding } from "@/hooks/dashboard/useCoordinatorDashboardData";

/**
 * The wing's own position and score, as a compact two-line strip.
 *
 * SCOPE DOCTRINE: `dash_scoped_wing_standing` computes the ranking across every
 * wing server-side and then returns ONLY the caller's row. No other wing's name,
 * average, students or teachers are in the payload at all — not hidden by the
 * UI, simply never sent. The breakdown sheet shows how the caller's own four
 * components add up, never a peer comparison table.
 *
 * The rank is withheld when the school has fewer than two wings: "#1 of 1" is an
 * artefact of the org chart, not a standing.
 */
export function WingStandingStrip() {
  const { data, isLoading, isError } = useWingStanding();
  const [open, setOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-[76px] w-full rounded-2xl" />;

  // No wing assigned, or the RPC failed: render nothing rather than a hollow row.
  if (isError || !data?.has_wing) return null;

  const hasRank = data.rank != null && (data.total_wings ?? 0) >= 2;
  const score = Math.round(data.score ?? 0);
  const avg = data.avg_pct;
  const schoolAvg = data.school_avg_pct;
  const diff = avg != null && schoolAvg != null ? Number((avg - schoolAvg).toFixed(1)) : null;

  return (
    <>
      <section
        role="button"
        tabIndex={0}
        aria-label="How your wing is scored"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          // The mockup's strip was click-only. A keyboard user has to be able to
          // open the breakdown too.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="surface-card frosted-shadow flex w-full cursor-pointer items-center gap-3.5 rounded-2xl border border-[hsl(var(--surface-stroke))] px-4 py-3.5 text-left transition-colors hover:border-yellow-600/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
      >
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-yellow-600/10">
          <Medal className="h-[22px] w-[22px] text-yellow-700" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold text-ink-900">
              {hasRank
                ? `${data.wing_name} wing is #${data.rank} of ${data.total_wings} this month`
                : `${data.wing_name} wing · ${score} points this month`}
            </span>
            {diff != null && (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[12px] font-extrabold tabular-nums",
                  diff >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600",
                )}
              >
                {diff >= 0 ? "▲" : "▼"}
                {Math.abs(diff)}pp
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[13.5px] text-ink-500">
            {score} of 100 points
            {avg != null && ` · wing average ${avg}%`}
            {schoolAvg != null && ` against ${schoolAvg}% school-wide`}
            {" · tap for the breakdown"}
          </p>
        </div>

        <span className="shrink-0 text-[22px] leading-none text-ink-400" aria-hidden="true">
          ›
        </span>
      </section>

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        placement="center"
        title="How your wing is scored"
        subtitle={`${data.wing_name} wing · ${score} of 100 points this month`}
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-[19px] text-ink-600">
            Four equally weighted components, 25 points each, computed for your wing only. No other
            wing&apos;s students, teachers or averages are shown here or sent to this page.
          </p>

          <ul className="space-y-3">
            {(data.components ?? []).map((c) => {
              const pct = c.pct ?? 0;
              return (
                <li key={c.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-semibold text-ink-900">{c.label}</span>
                    <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink-700">
                      {c.points ?? 0} / {c.max_points}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--surface-stroke))]">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        pct >= 75
                          ? "bg-emerald-500"
                          : pct >= 50
                            ? "bg-brand-primary"
                            : pct >= 25
                              ? "bg-amber-500"
                              : "bg-rose-500",
                      )}
                      style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                    />
                  </div>
                  <p className="text-[12px] text-ink-500 tabular-nums">{pct}%</p>
                </li>
              );
            })}
          </ul>

          <p className="rounded-xl bg-[hsl(var(--ink-400)/0.06)] px-3 py-2.5 text-[12px] leading-[17px] text-ink-600">
            Recheck turnaround and syllabus pacing are not scored. Neither has enough data behind it
            yet, and scoring a wing on a module nobody uses would read as a failure by your teachers
            rather than a gap in the rollout.
          </p>
        </div>
      </MobileSheet>
    </>
  );
}
