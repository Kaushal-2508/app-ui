import { ArrowRight, CalendarX2, ClipboardList, ScrollText, UserX } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useAttendanceCompliance,
  useRecheckStats,
  useStudentPortalAdoption,
  useTaskStats,
} from "@/hooks/dashboard/useCoordinatorDashboardData";

interface Action {
  key: string;
  icon: typeof UserX;
  label: string;
  detail: string;
  target: string;
  urgent: boolean;
}

/**
 * "Start here" — the three things worth doing before reading any chart.
 *
 * The adoption playbook frames a coordinator's first daily action as clearing
 * one pending recheck or task, so those outrank the analytics on the page.
 *
 * Every hook here is already mounted by a card further down, so this strip adds
 * no queries of its own: React Query serves all four from cache.
 *
 * It renders nothing when there is nothing to do, rather than three green
 * "all clear" tiles competing with the digest for the top of the page.
 */
export function StartHereStrip() {
  const recheck = useRecheckStats();
  const tasks = useTaskStats();
  const students = useStudentPortalAdoption(6);
  const attendance = useAttendanceCompliance(14);

  const isLoading =
    recheck.isLoading || tasks.isLoading || students.isLoading || attendance.isLoading;

  if (isLoading) return <Skeleton className="h-[92px] w-full rounded-card" />;

  const actions: Action[] = [];

  const pending = recheck.data?.pending ?? 0;
  if (pending > 0) {
    const oldest = recheck.data?.oldest_pending_days ?? 0;
    actions.push({
      key: "recheck",
      icon: ScrollText,
      label: `Clear ${pending} recheck${pending === 1 ? "" : "s"}`,
      detail:
        oldest > 0
          ? `Oldest has waited ${oldest} days`
          : "Waiting on your decision",
      target: "dash-rechecks",
      urgent: oldest > 5,
    });
  }

  const overdue = tasks.data?.overdue ?? 0;
  if (overdue > 0) {
    actions.push({
      key: "tasks",
      icon: ClipboardList,
      label: `Chase ${overdue} overdue task${overdue === 1 ? "" : "s"}`,
      detail: `${tasks.data?.open ?? 0} open in your wing`,
      target: "dash-tasks",
      urgent: overdue >= 10,
    });
  }

  const worstClass = students.data?.by_class?.[0];
  if (worstClass && (worstClass.pct ?? 100) < 50) {
    actions.push({
      key: "adoption",
      icon: UserX,
      label: `${worstClass.class_name} is barely using SALCI`,
      detail: `${worstClass.pct ?? 0}% active · ${worstClass.never} never signed in`,
      target: "dash-student-adoption",
      urgent: (worstClass.pct ?? 100) < 25,
    });
  }

  const missing = attendance.data?.missing_today ?? 0;
  if (actions.length < 3 && missing > 0) {
    actions.push({
      key: "attendance",
      icon: CalendarX2,
      label: `${missing} classes missed attendance`,
      detail: "On the last full school day",
      target: "dash-attendance-compliance",
      urgent: missing * 2 >= (attendance.data?.total_classes ?? 0),
    });
  }

  if (actions.length === 0) return null;

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section aria-label="Start here" className="space-y-2.5">
      <p className="eyebrow">Start here</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.slice(0, 3).map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => scrollTo(a.target)}
              className={cn(
                "surface-card frosted-shadow rounded-card flex items-center gap-3 px-4 py-3.5 text-left transition-[box-shadow,transform] duration-200 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                a.urgent
                  ? "border border-rose-500/30"
                  : "border border-[hsl(var(--surface-stroke))]",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  a.urgent ? "bg-rose-500/10" : "bg-brand-primary/10",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px]",
                    a.urgent ? "text-rose-600" : "text-brand-primary",
                  )}
                  aria-hidden="true"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-ink-900">
                  {a.label}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-500">{a.detail}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
