import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useTeacherActionQueue,
  type ActionQueueItem,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.3 — "Do this today".
 *
 * Four rows, each a count the teacher personally owns, with the context that
 * makes the number mean something and a direct link into the page that clears
 * it. Rows with a zero count are dropped rather than shown greyed: an action
 * queue listing things you do not have to do is noise.
 *
 * Every count comes from `dash_teacher_action_queue()`, which scopes grading and
 * homework by `created_by = auth.uid()` and attendance/planning by the teacher's
 * own classes and timetable slots.
 */

/** Tone per row type. Mirrors the mockup's bubble colours, via TONES-style tokens. */
const BUBBLE_TONE: Record<ActionQueueItem["key"], string> = {
  grading: "bg-brand-primary/10 text-brand-primary",
  homework: "bg-violet-500/10 text-violet-600",
  attendance: "bg-amber-500/10 text-amber-600",
  planning: "bg-sky-500/10 text-sky-600",
};

export function TeacherActionQueue() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useTeacherActionQueue();

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  // Error state renders BEFORE empty — a failed RPC must never read as
  // "nothing to do today" (CLAUDE.md §6).
  if (isError) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <h3 className="text-base font-semibold text-ink-900">Action queue</h3>
        <div className="mt-4">
          <EmptyState
            icon={<ArrowRight className="h-7 w-7" />}
            title="Couldn't load your queue"
            description="Something went wrong fetching your outstanding work. Refresh to try again."
            reason="error"
            tone="rose"
          />
        </div>
      </section>
    );
  }

  const open = (data?.items ?? []).filter((i) => i.count > 0);

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">Action queue</h3>
        {open.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand-primary/10 px-2.5 py-1 text-[12px] font-semibold text-brand-primary">
            {data?.total} open
          </span>
        )}
      </div>

      {open.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<CheckCircle2 className="h-7 w-7" />}
            title="Nothing waiting on you"
            description="No sheets to grade, no homework to mark, attendance is in and this week's lessons are logged."
            tone="mint"
            size="sm"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            Everything below is yours to act on. Tap to jump straight in.
          </p>
          <ul className="mt-4 list-none space-y-2 p-0">
            {open.map((item) => {
              const clickable = !!item.href;
              return (
                <li key={item.key}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => navigate(item.href!) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              navigate(item.href!);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border border-[hsl(var(--surface-stroke))] p-3 transition-colors",
                      clickable &&
                        "cursor-pointer hover:bg-[hsl(var(--ink-400)/0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[17px] font-bold tabular-nums",
                        BUBBLE_TONE[item.key],
                      )}
                    >
                      {item.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink-900">
                        {item.label}
                      </span>
                      {item.context && (
                        <span className="block truncate text-[13px] leading-[18px] text-ink-500">
                          {item.context}
                        </span>
                      )}
                    </span>
                    {clickable && (
                      <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand-primary">
                        {item.action}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
