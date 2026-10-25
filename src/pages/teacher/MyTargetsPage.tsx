import { useState } from "react";
import { AlertTriangle, Target } from "lucide-react";
import { PageShell, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/surfaces";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyTargets, type MyTargetRow, type TargetPeriodRow } from "@/hooks/useTeacherTargets";
import { cadenceLabel, formatDisplayDate, formatPeriodRange, parseDateOnly } from "@/lib/targetPeriods";
import {
  goalSentence,
  metricVerb,
  metricIcon,
  targetStatusBadge,
  periodStatusBadge,
  periodStatusText,
} from "@/components/targets/targetDisplay";

const HISTORY_PREVIEW_COUNT = 4;

/**
 * The teacher's (and any coordinator's own) targets: live progress on the
 * open period plus closed history. This is also the notification destination
 * for a newly-assigned target (Task 9's route + FEATURE_URL_MAP entry), so it
 * must render correctly for both roles. Full build for Task 12 (Task 9
 * shipped a routing placeholder).
 */
export default function MyTargetsPage() {
  const { data: targets, isLoading, error, refetch } = useMyTargets();

  if (isLoading) {
    return <PageSkeleton />;
  }

  const list = targets ?? [];

  return (
    <PageShell>
      <PageHeader
        icon={<Target className="h-5 w-5" />}
        title="My Targets"
        subtitle="Track your exam and homework targets period by period"
      />

      {/* Error state renders BEFORE the empty state (CLAUDE.md #6). */}
      {error ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Couldn't load your targets"
          description="Something went wrong fetching your targets. Try again in a moment."
          action={{ label: "Retry", onClick: () => refetch() }}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Target className="h-6 w-6" />}
          title="No targets yet"
          description="When an admin or your coordinator sets a target for you, it shows up here."
        />
      ) : (
        <div className="mt-4 space-y-3">
          {list.map((target) => (
            <MyTargetCard key={target.id} target={target} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function MyTargetCard({ target }: { target: MyTargetRow }) {
  // History stays visible after the deadline (decision 11): a stopped or
  // completed target still renders its full history, never hidden.
  const [showAllHistory, setShowAllHistory] = useState(false);
  const period = target.open_period;
  const pct = period && period.target_value > 0
    ? Math.min(100, Math.round((period.achieved_value / period.target_value) * 100))
    : 0;
  const history = target.history ?? [];
  const visibleHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW_COUNT);

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
            {metricIcon(target.metric)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">
              {goalSentence(target.metric, target.target_value)}
            </p>
            <p className="text-xs text-ink-500">
              {target.cadence_unit
                ? `Every ${cadenceLabel(target.cadence_unit, target.cadence_n).toLowerCase()}, until ${formatDisplayDate(parseDateOnly(target.ends_on))}`
                : `by ${formatDisplayDate(parseDateOnly(target.ends_on))}`}
            </p>
          </div>
        </div>
        {targetStatusBadge(target.status)}
      </div>

      {target.note && <p className="text-sm text-ink-700">{target.note}</p>}

      {period ? (
        <div className="space-y-1.5 rounded-lg bg-ink-400/5 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink-900">
              {period.achieved_value} of {period.target_value} {metricVerb(target.metric)}
            </span>
            <span className="text-xs text-ink-500">{periodStatusText(period)}</span>
          </div>
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-ink-500">
            {target.cadence_unit
              ? `This period: ${formatPeriodRange(period.period_start, period.period_end)}`
              : formatPeriodRange(period.period_start, period.period_end)}
          </p>
          {/* An exam that is marked but unpublished does not count, and without
              this line the teacher has no way to know why their work did not
              register. */}
          {(period.awaiting_results ?? 0) > 0 && (
            <p className="text-xs font-medium text-amber-700">
              {period.awaiting_results === 1
                ? "1 exam is marked but its results are not published yet, so it does not count."
                : `${period.awaiting_results} exams are marked but their results are not published yet, so they do not count.`}
            </p>
          )}
        </div>
      ) : (
        /* Say WHY there is nothing to show. "No open period right now" was
           evaluator language and read as a fault. */
        <p className="text-xs text-ink-500">
          {target.status === "stopped"
            ? "This target was stopped before it finished."
            : parseDateOnly(target.starts_on) > new Date()
              ? `Starts ${formatDisplayDate(parseDateOnly(target.starts_on))}. Nothing to do yet.`
              : "This target has finished. See past periods below."}
        </p>
      )}

      {history.length > 0 && (
        <div className="space-y-2 border-t border-surface-stroke pt-3">
          <p className="text-xs font-medium text-ink-700">Past periods</p>
          <ul className="space-y-1.5">
            {visibleHistory.map((h: TargetPeriodRow) => (
              <li
                key={h.period_index}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate text-ink-700">
                  {formatPeriodRange(h.period_start, h.period_end)}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-ink-500">
                    {h.achieved_value} of {h.target_value}
                  </span>
                  {periodStatusBadge(h.status)}
                </span>
              </li>
            ))}
          </ul>
          {history.length > HISTORY_PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setShowAllHistory((v) => !v)}
              className="text-xs font-medium text-brand-primary"
            >
              {showAllHistory ? "Show less" : `Show all ${history.length} periods`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    </PageShell>
  );
}
