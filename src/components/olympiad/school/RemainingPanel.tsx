import { Lock, CheckCircle2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchClass } from "@/lib/olympiad/batchSeating";

type Props = {
  classes: BatchClass[];
  remaining: Record<string, number>;
  totalUnassigned: number;
  canLock: boolean;
  lockHint: string | null;
  lockPending: boolean;
  onLock: () => void;
};

/** Right-side live "students remaining per class" panel + the lock gate. */
export function RemainingPanel({
  classes,
  remaining,
  totalUnassigned,
  canLock,
  lockHint,
  lockPending,
  onLock,
}: Props) {
  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-4 lg:sticky lg:top-20">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-ink-500" />
        <p className="text-sm font-semibold text-ink-900">Students remaining</p>
      </div>

      <ul className="space-y-2.5">
        {classes.map((c) => {
          const left = remaining[c.gradeLevelId] ?? 0;
          const total = c.studentIds.length;
          const seated = total - left;
          const pct = total > 0 ? Math.round((seated / total) * 100) : 0;
          return (
            <li key={c.gradeLevelId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-900">{c.classLabel}</span>
                <span className="tabular-nums text-ink-500">
                  {seated}/{total}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${left === 0 ? "bg-emerald-500" : "bg-brand-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-surface-stroke pt-3">
        {totalUnassigned === 0 ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> All students seated
          </p>
        ) : (
          <p className="text-sm text-ink-600">
            {totalUnassigned} student{totalUnassigned === 1 ? "" : "s"} unassigned
          </p>
        )}
        <Button className="mt-3 w-full" disabled={!canLock || lockPending} onClick={onLock}>
          <Lock className="h-4 w-4 mr-1" /> Lock schedule
        </Button>
        {!canLock && lockHint && <p className="mt-1.5 text-[11px] text-ink-500">{lockHint}</p>}
      </div>
    </div>
  );
}
