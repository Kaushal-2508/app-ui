import { useState } from "react";
import { format, parse } from "date-fns";
import { Clock, UserCircle2, ChevronRight, Check, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/surfaces";
import {
  usePendingSubstitutions,
  useFreeTeachersForSlot,
  useAssignSubstitute,
  type PendingSubstitution,
  type FreeTeacherCandidate,
} from "@/hooks/useSubstitutions";
import { formatClassName, cn } from "@/lib/utils";

const todayStr = () => format(new Date(), "yyyy-MM-dd");

// "08:30:00" → "8:30 AM"
function fmtTime(t: string) {
  try {
    return format(parse(t, "HH:mm:ss", new Date()), "h:mm a");
  } catch {
    return t;
  }
}

function rankBadge(rank: number) {
  if (rank === 1)
    return { label: "Same subject", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" };
  if (rank === 2)
    return { label: "Same class", tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" };
  return { label: "Available", tone: "bg-ink-400/15 text-ink-700 dark:text-ink-300" };
}

function SubRow({ sub }: { sub: PendingSubstitution }) {
  const {
    data: candidates,
    isLoading,
    isError,
    refetch,
  } = useFreeTeachersForSlot(sub.slot_id, sub.date);
  const assign = useAssignSubstitute();

  const list = candidates ?? [];
  const top = list[0];
  const [picked, setPicked] = useState<string | null>(null);
  const selected: FreeTeacherCandidate | undefined =
    list.find((c) => c.teacher_id === picked) ?? top;

  const handleAccept = () => {
    if (!selected) return;
    assign.mutate({ substitutionId: sub.id, substituteTeacherId: selected.teacher_id });
  };

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
      {/* Top row — class, period, original teacher */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="eyebrow">
            Period {sub.period?.period_number ?? "?"} · {sub.period?.label ?? "N/A"}
          </p>
          <h3 className="text-base font-semibold text-ink-900">
            {sub.class
              ? formatClassName(sub.class.name, sub.class.section)
              : "Class"}
          </h3>
          <p className="text-xs text-ink-500 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {sub.period
              ? `${fmtTime(sub.period.start_time)} – ${fmtTime(sub.period.end_time)}`
              : "Time TBD"}
            <span className="mx-1.5 text-ink-400">·</span>
            <UserCircle2 className="h-3 w-3" />
            {sub.original_teacher?.full_name ?? "Unassigned teacher"}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
          Pending
        </span>
      </div>

      {/* Candidate row */}
      {isLoading ? (
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1 rounded-xl" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      ) : isError ? (
        // Before "nobody is free": a failed lookup used to read as an empty
        // staff room (CLAUDE.md §6).
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 dark:bg-rose-500/10 dark:border-rose-500/20 p-3 flex flex-wrap items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-rose-700 shrink-0" />
          <span className="flex-1 text-ink-700 dark:text-ink-300">
            {"Couldn't load who is free for this period."}
          </span>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 dark:bg-rose-500/10 dark:border-rose-500/20 p-3 flex items-start gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
          <div className="text-ink-700 dark:text-ink-300">
            No free teachers right now. Once someone finishes a period, this list will refresh.
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selected?.teacher_id ?? ""}
            onValueChange={setPicked}
          >
            <SelectTrigger className="h-10 rounded-xl flex-1 min-w-[200px] sm:max-w-md">
              <SelectValue placeholder="Choose a substitute" />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => {
                const badge = rankBadge(c.rank);
                return (
                  <SelectItem key={c.teacher_id} value={c.teacher_id}>
                    <span className="flex items-center gap-2">
                      <span>{c.full_name}</span>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.tone)}>
                        {badge.label}
                      </span>
                      {c.subs_today > 0 && (
                        <span className="text-[11px] text-ink-500">· {c.subs_today} sub today</span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button
            onClick={handleAccept}
            disabled={!selected || assign.isPending}
            className="h-10 rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            {assign.isPending ? (
              <>
                <Check className="h-4 w-4 mr-1.5" /> Assigning…
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4 mr-1.5" /> Assign
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Coordinator / admin review screen. Lists the day's pending
 * substitutions (institution- or wing-scoped) and lets the user accept
 * a candidate per row. Top suggestion is pre-selected — single-tap
 * "Assign" is the happy path; the dropdown surfaces alternates and
 * their rank badge.
 */
export function SubstitutionReviewPanel() {
  const { data, isLoading, isError, refetch } = usePendingSubstitutions(todayStr());

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
    );
  }

  // Error BEFORE empty: a failed fetch used to render "All covered", telling
  // the coordinator nobody needed cover on exactly the day it broke.
  if (isError) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't load substitutions"
        description="Today's pending covers could not be fetched. Please try again."
        action={{ label: "Try again", onClick: () => void refetch() }}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<Check className="h-7 w-7" />}
        title="All covered"
        description="No pending substitutions today. New ones will show up here automatically when a teacher misses check-in."
      />
    );
  }

  return (
    <div className="space-y-3">
      {data.map((sub) => (
        <SubRow key={sub.id} sub={sub} />
      ))}
    </div>
  );
}
