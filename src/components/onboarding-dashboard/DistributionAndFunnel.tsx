import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";
import { MILESTONE_KEYS, MILESTONE_LABELS, TIER_BUCKETS, type Tier } from "@/lib/onboardingDashboardMath";
import { cn } from "@/lib/utils";

interface Props {
  data: OnboardingDashboardData;
}

const TIER_COLOR: Record<Tier, string> = {
  "100": "bg-emerald-500",
  "80":  "bg-teal-500",
  "60":  "bg-sky-500",
  "40":  "bg-amber-500",
  "20":  "bg-orange-500",
  "0":   "bg-rose-500",
};

function DistributionPanel({ data }: Props) {
  const total = data.live.length;
  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Where everyone stands</p>
      <div className="space-y-3">
        {TIER_BUCKETS.map((tier) => {
          const count = data.distribution[tier];
          const pct = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <div key={tier}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-ink-700">{tier}% tier</span>
                <span className="tabular-nums text-ink-900">
                  {count} <span className="text-ink-500">({pct}%)</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                <div
                  className={cn("h-full rounded-full transition-all", TIER_COLOR[tier])}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MilestoneFunnel({ data }: Props) {
  const total = data.live.length;
  return (
    <div className="surface-card frosted-shadow rounded-card p-5">
      <p className="eyebrow mb-3">Milestone funnel</p>
      <div className="space-y-3">
        {MILESTONE_KEYS.map((key) => {
          const count = data.live.filter((r) => {
            switch (key) {
              case "first_task_assigned": return r.firstTaskAssigned;
              case "first_task_completed": return r.firstTaskCompleted;
              case "first_study_material_uploaded": return r.firstStudyMaterialUploaded;
              case "first_exam_published": return r.firstExamPublished;
              case "first_result_validated": return r.firstResultValidated;
            }
          }).length;
          const pct = total === 0 ? 0 : Math.round((count / total) * 100);
          const delta = data.deltas.milestones[key];
          return (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-700">{MILESTONE_LABELS[key]}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-ink-900">{count}</span>
                  <span className="text-ink-500">({pct}%)</span>
                  {data.deltas.hasBaseline && delta !== 0 && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-semibold",
                        delta > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
                      )}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-brand-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DistributionAndFunnel({ data }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DistributionPanel data={data} />
      <MilestoneFunnel data={data} />
    </div>
  );
}
