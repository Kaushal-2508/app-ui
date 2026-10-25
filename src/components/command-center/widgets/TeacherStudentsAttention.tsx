import { useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClassName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  SEVERITY_META,
  useTeacherStudentsAttention,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.6 — ONE unified list, not one card per signal type.
 *
 * Severity is how MANY signals are true (>=3 high, 2 medium, 1 watch), not which
 * one, so a pupil failing on several fronts always outranks a pupil failing on
 * one. The filter row narrows the same list rather than splitting it.
 *
 * Signals are computed server-side from the teacher's own pairs: performance in
 * their subject, attendance in their classes, non-submission across their last 5
 * homework assignments, non-attempt across their last 3 exams.
 */
export function TeacherStudentsAttention() {
  const { data, isLoading, isError } = useTeacherStudentsAttention();
  const [classId, setClassId] = useState<string | null>(null);

  const students = useMemo(() => data?.students ?? [], [data]);

  // Filtering here is presentational only. The security boundary is the RPC —
  // this list already contains nothing the teacher may not see.
  const classes = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.class_id, formatClassName(s.class_name, s.section));
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [students]);

  const visible = classId ? students.filter((s) => s.class_id === classId) : students;

  // Show four, then reveal five at a time. The list is worst-first, so the rows
  // that matter are always above the fold; the rest is opt-in rather than a wall.
  const PAGE = 5;
  const INITIAL = 4;
  const [shown, setShown] = useState(INITIAL);
  // Switching the class filter re-collapses: carrying a "load more" position
  // across a different, shorter list would show everything with no button.
  useEffect(() => setShown(INITIAL), [classId]);

  const rows = visible.slice(0, shown);
  const remaining = visible.length - rows.length;

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-56" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <h3 className="text-base font-semibold text-ink-900">Students who need attention</h3>

      {isError ? (
        <div className="mt-4">
          <EmptyState
            icon={<UserRound className="h-7 w-7" />}
            title="Couldn't load your students"
            description="Something went wrong. Refresh to try again."
            reason="error"
            tone="rose"
          />
        </div>
      ) : students.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<UserRound className="h-7 w-7" />}
            title="Nobody is flagged right now"
            description="No student in your classes is currently below par on performance, attendance, homework or test participation."
            tone="mint"
            size="sm"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            One list across every class and subject you teach. Performance, attendance, homework and
            test participation combined. Worst first.
          </p>

          {classes.length > 1 && (
            <div className="mt-3">
              <FilterRow activeCount={classId ? 1 : 0} onClear={() => setClassId(null)}>
                <FilterChip
                  label={`All students (${students.length})`}
                  active={classId === null}
                  onClick={() => setClassId(null)}
                />
                {classes.map((c) => (
                  <FilterChip
                    key={c.id}
                    label={`${c.label} (${students.filter((s) => s.class_id === c.id).length})`}
                    active={classId === c.id}
                    onClick={() => setClassId(c.id)}
                  />
                ))}
              </FilterRow>
            </div>
          )}

          <ul className="mt-4 list-none space-y-2 p-0">
            {rows.map((s) => {
              const sev = SEVERITY_META[s.severity];
              return (
                <li
                  key={s.student_id}
                  className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-ink-900">
                        {s.student_name ?? "Unnamed student"}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-[18px] text-ink-500">
                        {formatClassName(s.class_name, s.section)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]",
                        sev.tone,
                      )}
                    >
                      {sev.label}
                    </span>
                  </div>
                  {s.reasons && s.reasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.reasons.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-[hsl(var(--ink-400)/0.1)] px-2 py-0.5 text-[12px] text-ink-600"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {(remaining > 0 || shown > INITIAL) && (
            <div className="mt-3 flex gap-2">
              {remaining > 0 && (
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="flex-1 rounded-xl border border-[hsl(var(--surface-stroke))] py-2 text-[13px] font-semibold text-brand-primary transition-colors hover:bg-[hsl(var(--ink-400)/0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                >
                  Load {Math.min(PAGE, remaining)} more
                  <span className="font-normal text-ink-500"> · {remaining} left</span>
                </button>
              )}
              {/* Only offered once the list has actually been expanded, so it is
                  never a control that does nothing. */}
              {shown > INITIAL && (
                <button
                  type="button"
                  onClick={() => setShown(INITIAL)}
                  className={cn(
                    "rounded-xl border border-[hsl(var(--surface-stroke))] py-2 text-[13px] font-semibold text-ink-600 transition-colors hover:bg-[hsl(var(--ink-400)/0.05)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                    remaining > 0 ? "shrink-0 px-4" : "flex-1",
                  )}
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
