import { Split, Ban, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TeacherTargetRow } from "@/hooks/useTeacherTargets";
import { cadenceLabel, formatDisplayDate, parseDateOnly } from "@/lib/targetPeriods";
import { metricLabel, metricIcon, targetStatusBadge, periodStatusText } from "./targetDisplay";

export interface TargetProgressCardProps {
  target: TeacherTargetRow;
  /** True on the admin overview; false on a coordinator's own scoped view. */
  isAdmin: boolean;
  currentUserId?: string;
  onSplit: () => void;
  onStop: () => void;
}

/**
 * One target row with its open-period progress. Used on the admin/coordinator
 * overview only — the teacher's own page (Task 12) has its own card shape
 * because it also renders closed history, not just the live period.
 */
export function TargetProgressCard({
  target,
  isAdmin,
  currentUserId,
  onSplit,
  onStop,
}: TargetProgressCardProps) {
  const isWing = target.scope === "wing";
  const period = target.open_period;
  const pct = period && period.target_value > 0
    ? Math.min(100, Math.round((period.achieved_value / period.target_value) * 100))
    : 0;

  // A coordinator's scoped view (tgt_targets_overview with is_admin=false) only
  // ever contains pools they own plus their own children, so any wing row
  // visible there is theirs to split. An admin sees every pool in the
  // institution, most of which belong to someone else's coordinator role, and
  // tgt_split_wing_target rejects anyone but the owning coordinator.
  const canSplit = isWing && target.status === "active" && !isAdmin;
  const canStop =
    target.status === "active" && (isAdmin || target.owner_id === currentUserId);

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
            {metricIcon(target.metric)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink-900">
              {isWing ? (target.wing_name ?? "Wing pool") : (target.owner_name ?? "Teacher")}
            </p>
            <p className="text-xs text-ink-500">
              {metricLabel(target.metric)} &middot; {cadenceLabel(target.cadence_unit, target.cadence_n)}
            </p>
          </div>
        </div>
        {targetStatusBadge(target.status)}
      </div>

      <p className="text-xs text-ink-500">
        {formatDisplayDate(parseDateOnly(target.starts_on))} to {formatDisplayDate(parseDateOnly(target.ends_on))}
      </p>

      {isWing ? (
        <div className="flex items-center gap-2 text-sm text-ink-700">
          <Users className="h-4 w-4 text-ink-400" />
          <span>
            {target.owner_name ?? "Unassigned coordinator"} &middot;{" "}
            {target.allocated ?? 0} of {target.target_value} allocated across{" "}
            {target.teacher_count ?? 0} teacher{target.teacher_count === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      {period ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink-900">
              {period.achieved_value} of {period.target_value}
            </span>
            <span className="text-xs text-ink-500">{periodStatusText(period)}</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      ) : (
        <p className="text-xs text-ink-500">No open period right now.</p>
      )}

      {(canSplit || canStop) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canSplit && (
            <Button variant="outline" size="sm" onClick={onSplit} className="gap-1.5">
              <Split className="h-3.5 w-3.5" />
              Split pool
            </Button>
          )}
          {canStop && (
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              className="gap-1.5 text-rose-600 hover:text-rose-700"
            >
              <Ban className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
      )}

      {isAdmin && isWing && (target.allocated ?? 0) < target.target_value && target.status === "active" && (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          Not fully shared out yet, the coordinator still needs to split this pool.
        </div>
      )}
    </div>
  );
}
