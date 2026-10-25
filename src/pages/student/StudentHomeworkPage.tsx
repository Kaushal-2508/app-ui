import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  format,
} from "date-fns";
import { ClipboardList, CheckCircle2, AlarmClock, Lock } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClassName } from "@/lib/utils";
import { useStudentHomework, type StudentHomeworkRow } from "@/hooks/useStudentHomework";

const DUE_SOON_MS = 48 * 60 * 60 * 1000;
const TAB_DEFAULT = "pending";

/** "Due in Xd Yh" / "Due today" / "Overdue — late if submitted". */
function dueLabel(dueAt: string): { text: string; overdue: boolean } {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = differenceInMilliseconds(due, now);
  if (diffMs <= 0) {
    return { text: "Closed", overdue: true };
  }
  const days = differenceInDays(due, now);
  const hours = differenceInHours(due, now) % 24;
  if (days > 0) {
    return { text: `Due in ${days}d ${hours}h`, overdue: false };
  }
  if (hours > 0) {
    return { text: `Due in ${hours}h`, overdue: false };
  }
  return { text: "Due today", overdue: false };
}

function subtitleFor(row: StudentHomeworkRow): string {
  const subjectName =
    row.subjects.length > 0
      ? row.subjects.map((s) => s.name).join(", ")
      : (row.subject?.name ?? "Homework");
  const classNames = row.classes
    .map((c) => formatClassName(c.name, c.section))
    .join(", ");
  return classNames ? `${subjectName} · ${classNames}` : subjectName;
}

function IconDisc() {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
      <ClipboardList className="h-5 w-5" />
    </span>
  );
}

function completedStatus(row: StudentHomeworkRow): string {
  if (row.carries_marks && row.status === "checked" && row.result) {
    const awarded = row.result.marks_awarded;
    return awarded != null && row.max_marks != null
      ? `${awarded}/${row.max_marks}`
      : "N/A";
  }
  if (!row.carries_marks && row.status === "checked" && row.result) {
    return "Feedback received";
  }
  if (row.status === "checked") {
    return "Reviewed";
  }
  return "Waiting for teacher to mark";
}

export default function StudentHomeworkPage() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useStudentHomework();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab = tabParam === "completed" ? "completed" : TAB_DEFAULT;

  const { pending, completed, dueSoon } = useMemo(() => {
    // Offline assignments never get a submission, so "done" = submitted OR checked
    // (covers offline marks recorded + auto-checked unmarked work).
    const pendingRows = rows
      .filter((r) => !r.submission && r.status !== "checked")
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    const completedRows = rows
      .filter((r) => r.submission != null || r.status === "checked")
      .sort((a, b) => {
        const ta = new Date(a.submission?.submitted_at ?? a.checked_at ?? a.due_at).getTime();
        const tb = new Date(b.submission?.submitted_at ?? b.checked_at ?? b.due_at).getTime();
        return tb - ta;
      });
    const now = Date.now();
    const dueSoonCount = pendingRows.filter((r) => {
      if (r.locked) return false; // not actionable until it opens
      const diff = new Date(r.due_at).getTime() - now;
      return diff > 0 && diff <= DUE_SOON_MS;
    }).length;
    return { pending: pendingRows, completed: completedRows, dueSoon: dueSoonCount };
  }, [rows]);

  const setTab = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === TAB_DEFAULT) {
          next.delete("tab");
        } else {
          next.set("tab", value);
        }
        return next;
      },
      { replace: true },
    );
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Homework and Assignment"
        subtitle="Your assigned work"
      />

      <StatTileGrid cols={3} mdCols={3}>
        <StatTile
          label="Pending"
          value={pending.length}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="teal"
        />
        <StatTile
          label="Completed"
          value={completed.length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="sky"
        />
        <StatTile
          label="Due soon"
          value={dueSoon}
          icon={<AlarmClock className="h-5 w-5" />}
          tone="mint"
        />
      </StatTileGrid>

      <MobileTabs
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "pending", label: "Pending", count: pending.length },
          { value: "completed", label: "Completed", count: completed.length },
        ]}
      />

      {tab === "pending" ? (
        pending.length > 0 ? (
          <ul className="grid gap-3 sm:gap-4">
            {pending.map((row) => {
              const due = dueLabel(row.due_at);
              return (
                <ListRow
                  key={row.id}
                  as="li"
                  leading={<IconDisc />}
                  title={row.title}
                  subtitle={subtitleFor(row)}
                  trailing={
                    row.locked ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink-500">
                        <Lock className="h-3 w-3" aria-hidden />
                        Opens {format(new Date(row.visible_from), "MMM d")}
                      </span>
                    ) : row.offline_marks ? (
                      <span className="whitespace-nowrap text-xs font-medium text-ink-500">
                        Marked offline
                      </span>
                    ) : (
                      <span
                        className={
                          due.overdue
                            ? "text-xs font-medium text-rose-600"
                            : "text-xs font-medium text-brand-primary"
                        }
                      >
                        {due.text}
                      </span>
                    )
                  }
                  onClick={() => navigate(`/student/homework/${row.id}`)}
                />
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" />}
            title="No pending homework"
            description="You're all caught up. New assignments will show up here."
            tone="teal"
          />
        )
      ) : completed.length > 0 ? (
        <ul className="grid gap-3 sm:gap-4">
          {completed.map((row) => (
            <ListRow
              key={row.id}
              as="li"
              leading={<IconDisc />}
              title={row.title}
              subtitle={
                <span className="flex flex-col gap-1">
                  <span className="truncate">{subtitleFor(row)}</span>
                  {row.submission && (
                    <span className="text-[12px] text-ink-500">
                      Submitted {format(new Date(row.submission.submitted_at), "MMM d, yyyy")}
                    </span>
                  )}
                </span>
              }
              trailing={
                <span className="text-xs font-medium text-ink-700">
                  {completedStatus(row)}
                </span>
              }
              onClick={() => navigate(`/student/homework/${row.id}`)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="Nothing submitted yet"
          description="Your completed homework will appear here once you submit."
          tone="teal"
        />
      )}
    </PageShell>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="Homework and Assignment"
        subtitle="Your assigned work"
      />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-48 rounded-full" />
      <div className="grid gap-3 sm:gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </PageShell>
  );
}
