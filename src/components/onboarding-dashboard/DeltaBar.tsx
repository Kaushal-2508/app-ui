import { ArrowUp, ArrowDown, Minus, Sunrise } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";
import { MILESTONE_KEYS, MILESTONE_LABELS } from "@/lib/onboardingDashboardMath";
import { cn } from "@/lib/utils";

interface Props {
  data: OnboardingDashboardData;
}

function DeltaChip({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const positive = value > 0;
  const negative = value < 0;
  const Icon = positive ? ArrowUp : negative ? ArrowDown : Minus;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-sm dark:bg-white/5">
      <Icon
        className={cn(
          "h-4 w-4",
          positive && "text-emerald-600",
          negative && "text-rose-600",
          !positive && !negative && "text-ink-400",
        )}
      />
      <span className="text-ink-600">{label}</span>
      <span
        className={cn(
          "ml-auto font-semibold tabular-nums",
          positive && "text-emerald-700",
          negative && "text-rose-700",
          !positive && !negative && "text-ink-700",
        )}
      >
        {positive ? "+" : ""}
        {value}
        {suffix ?? ""}
      </span>
    </div>
  );
}

export function DeltaBar({ data }: Props) {
  if (!data.deltas.hasBaseline) {
    return (
      <div className="surface-card frosted-shadow flex items-center gap-3 rounded-card p-4 text-sm">
        <Sunrise className="h-5 w-5 text-brand-primary" />
        <div>
          <p className="font-semibold text-ink-900">First report</p>
          <p className="text-ink-600">
            Day-over-day deltas appear once tomorrow's snapshot is taken.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card frosted-shadow rounded-card p-4">
      <p className="eyebrow mb-3">Since yesterday</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <DeltaChip label="Fully complete" value={data.deltas.fullyComplete} />
        <DeltaChip
          label="Avg completion"
          value={data.deltas.avgCompletion}
          suffix="pp"
        />
        {MILESTONE_KEYS.map((k) => (
          <DeltaChip key={k} label={MILESTONE_LABELS[k]} value={data.deltas.milestones[k]} />
        ))}
      </div>
    </div>
  );
}
