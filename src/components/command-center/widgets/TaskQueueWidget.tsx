import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTaskQueue, useTaskStats } from "@/hooks/dashboard/useCoordinatorDashboardData";

const PAGE_SIZE = 8;

function fmtDue(iso: string | null) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No due date";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done_pending_approval: "Awaiting your approval",
};

/**
 * Tasks assigned to the staff this coordinator is responsible for.
 *
 * `tasks.wing_id` is NULL on every row in production, so the scope is resolved
 * through the assignee instead: a task counts if its assignee teaches one of the
 * caller's classes. `task_assignments.task_id` is NOT NULL UNIQUE, so that join
 * can never fan a task out into duplicates.
 *
 * Overdue first, then due soonest — the ordering is the queue.
 */
export function TaskQueueWidget() {
  const stats = useTaskStats();
  const queue = useTaskQueue(PAGE_SIZE, 0);

  const rows = queue.data?.rows ?? [];
  const total = queue.data?.total ?? 0;
  const overdue = stats.data?.overdue ?? 0;

  return (
    <WidgetCard
      title="Tasks in your wing"
      caption="Work assigned to teachers you coordinate. Overdue items come first, then whatever is due soonest."
      isLoading={queue.isLoading || stats.isLoading}
      isError={queue.isError || stats.isError}
      onRetry={() => {
        void queue.refetch();
        void stats.refetch();
      }}
      isEmpty={!queue.isLoading && !queue.isError && rows.length === 0}
      emptyTitle="No open tasks"
      emptyDescription="Nothing is outstanding for the teachers in your wing."
      headerSlot={
        <Button asChild variant="outline" size="sm">
          <Link to="/tasks">Open tasks</Link>
        </Button>
      }
      className="scroll-mt-24"
    >
      <div id="dash-tasks">
        <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: "Open", value: stats.data?.open ?? 0 },
            { label: "Overdue", value: overdue, danger: overdue > 0 },
            {
              label: "Completion rate",
              value:
                stats.data?.completion_rate != null ? `${stats.data.completion_rate}%` : "n/a",
            },
            {
              label: "Avg. closure",
              value:
                stats.data?.avg_closure_days != null
                  ? `${stats.data.avg_closure_days}d`
                  : "n/a",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-[hsl(var(--surface-stroke))] bg-[hsl(var(--ink-400)/0.04)] px-3 py-2.5"
            >
              <dt className="text-[11.5px] font-medium text-ink-500">{s.label}</dt>
              <dd
                className={cn(
                  "mt-1 text-[20px] font-bold tabular-nums leading-none",
                  s.danger ? "text-rose-600" : "text-ink-900",
                )}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <ul className="divide-y divide-[hsl(var(--surface-stroke))]">
          {rows.map((t) => {
            const isOverdue = t.days_overdue != null && t.days_overdue > 0;
            return (
              <li key={t.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    isOverdue
                      ? "bg-rose-500"
                      : t.status === "done_pending_approval"
                        ? "bg-amber-500"
                        : "bg-brand-primary",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink-900">{t.title}</p>
                  <p className="truncate text-[11.5px] text-ink-500">
                    {t.assignee_name ?? "Unassigned"} ·{" "}
                    {STATUS_LABEL[t.status] ?? t.status} · due {fmtDue(t.due_date)}
                  </p>
                </div>
                {isOverdue && (
                  <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-rose-600">
                    {t.days_overdue}d late
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {total > rows.length && (
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-500">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Showing {rows.length} of {total} open tasks. Open the tasks page for the rest.
          </p>
        )}
      </div>
    </WidgetCard>
  );
}
