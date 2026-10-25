import { Check, X, AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MILESTONE_KEYS,
  MILESTONE_LABELS,
  STUCK_TRIGGER_DAYS,
  STUCK_SEVERE_DAYS,
  type MilestoneKey,
} from "@/lib/onboardingDashboardMath";
import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

interface Props {
  rows: InstitutionOnboardingRow[];
  zeroDayMap: Map<string, number>;
}

function milestoneOf(row: InstitutionOnboardingRow, key: MilestoneKey): boolean {
  switch (key) {
    case "first_task_assigned": return row.firstTaskAssigned;
    case "first_task_completed": return row.firstTaskCompleted;
    case "first_study_material_uploaded": return row.firstStudyMaterialUploaded;
    case "first_exam_published": return row.firstExamPublished;
    case "first_result_validated": return row.firstResultValidated;
  }
}

export function PendingTasksGrid({ rows, zeroDayMap }: Props) {
  const pending = rows
    .filter((r) => !r.isJourneyCompleted)
    .sort((a, b) => Number(b.completionPercent) - Number(a.completionPercent));

  if (pending.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        Everyone has finished onboarding. Nothing pending.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="eyebrow">Still onboarding ({pending.length})</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((r) => {
          const pct = Number(r.completionPercent);
          const closeToDone = pct === 80;
          const stuckDays = zeroDayMap.get(r.userId) ?? 0;
          const stuck = stuckDays >= STUCK_TRIGGER_DAYS;
          const severe = stuckDays >= STUCK_SEVERE_DAYS;
          return (
            <div
              key={r.userId}
              className={cn(
                "surface-card frosted-shadow rounded-card p-4",
                severe && "ring-1 ring-rose-400/60",
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{r.fullName ?? "N/A"}</p>
                  <p className="truncate text-xs text-ink-500">{r.email ?? r.role ?? ""}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-700">
                  {Math.round(pct)}%
                </span>
              </div>

              <ul className="space-y-1 text-sm">
                {MILESTONE_KEYS.map((k) => {
                  const ok = milestoneOf(r, k);
                  return (
                    <li key={k} className="flex items-center gap-2">
                      {ok ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-ink-400" />
                      )}
                      <span className={cn("truncate", ok ? "text-ink-600 line-through" : "text-ink-800")}>
                        {MILESTONE_LABELS[k]}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex flex-wrap gap-2">
                {closeToDone && (
                  <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200">
                    <Clock className="h-3 w-3" /> Could finish today
                  </Badge>
                )}
                {stuck && (
                  <Badge
                    className={cn(
                      "gap-1",
                      severe
                        ? "bg-rose-100 text-rose-800 hover:bg-rose-100 dark:bg-rose-900/40 dark:text-rose-200"
                        : "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/40 dark:text-orange-200",
                    )}
                  >
                    <AlertTriangle className="h-3 w-3" /> Stuck for {stuckDays} day{stuckDays === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
