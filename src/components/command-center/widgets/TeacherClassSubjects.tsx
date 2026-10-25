import { Layers, TrendingDown, TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClassName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  BAND_META,
  useTeacherClassSubjects,
  type TeacherClassSubject,
} from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.4 — "My classes & subjects", weakest first.
 *
 * One row per (class, subject) pair the teacher is actually assigned to. The
 * score is computed from final_results restricted to that exact pair, so a
 * teacher of one subject sees one row, not their class's whole academic life.
 *
 * A pair with no graded results shows "No results yet" and sorts LAST. It is
 * never rendered as 0%: the distinction between "not measured" and "measured
 * badly" is the whole point of the row.
 *
 * Syllabus coverage % from the mockup is deliberately absent — see the migration
 * header. It returns to this row when syllabus logging has real adoption.
 */
export function TeacherClassSubjects() {
  const { data, isLoading, isError } = useTeacherClassSubjects();

  if (isLoading) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <Skeleton className="h-6 w-52" />
        <div className="mt-4 space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  // Error before empty (CLAUDE.md §6).
  if (isError) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <h3 className="text-base font-semibold text-ink-900">My classes &amp; subjects</h3>
        <div className="mt-4">
          <EmptyState
            icon={<Layers className="h-7 w-7" />}
            title="Couldn't load your classes"
            description="Something went wrong fetching your class-subject performance. Refresh to try again."
            reason="error"
            tone="rose"
          />
        </div>
      </section>
    );
  }

  const pairs = data?.pairs ?? [];

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">My classes &amp; subjects</h3>
        {pairs.length > 1 && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--ink-400)/0.1)] px-2.5 py-1 text-[12px] font-medium text-ink-600">
            Weakest first
          </span>
        )}
      </div>

      {pairs.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Layers className="h-7 w-7" />}
            title="No classes assigned"
            description="You don't have any class and subject assignments yet. Ask your coordinator or admin."
            tone="teal"
            size="sm"
          />
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-[18px] text-ink-500">
            Only the class and subject pairs assigned to you. No other subject, no school average.
          </p>
          <ul className="mt-4 list-none space-y-3 p-0">
            {pairs.map((p) => (
              <PairRow key={`${p.class_id}:${p.subject_id}`} pair={p} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PairRow({ pair }: { pair: TeacherClassSubject }) {
  const band = pair.band ? BAND_META[pair.band] : null;
  const hasScore = pair.score_pct != null;
  const delta = pair.delta_pp;

  return (
    <li className="rounded-2xl border border-[hsl(var(--surface-stroke))] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink-900">
            {pair.subject_name} · {formatClassName(pair.class_name, pair.section)}
          </p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-ink-500">
            {pair.students} student{pair.students === 1 ? "" : "s"}
            {pair.exams_count > 0 && ` · ${pair.exams_count} exam${pair.exams_count === 1 ? "" : "s"}`}
          </p>
        </div>
        {band && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em]",
              band.tone,
            )}
          >
            {band.label}
          </span>
        )}
      </div>

      {hasScore ? (
        <>
          {/* Track + fill: a plain div bar, not a chart. Recharts would be three
              orders of magnitude of machinery for one percentage. */}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[hsl(var(--ink-400)/0.12)]">
            <div
              className="h-full rounded-full bg-brand-primary transition-[width] duration-500"
              style={{ width: `${Math.max(2, Math.min(100, pair.score_pct!))}%` }}
              role="progressbar"
              aria-valuenow={Math.round(pair.score_pct!)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${pair.subject_name} class average`}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-ink-700 tabular-nums">
              {pair.score_pct}% class average this year
            </span>
            {delta != null && Math.abs(delta) >= 0.1 && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[13px] font-medium tabular-nums",
                  delta > 0 ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {delta > 0 ? (
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {Math.abs(delta)}pp vs last year
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-[13px] leading-[18px] text-ink-500">
          No graded results yet for this subject.
        </p>
      )}
    </li>
  );
}
