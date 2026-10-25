import { Medal } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTeacherStanding } from "@/hooks/dashboard/useTeacherDashboardData";

/**
 * Spec 2.2 — the mockup's `.lbStrip`: a compact TWO-line row, not a card.
 *
 * Matches public/report_reference/teacher-dashboard-mockup.html:
 *   .lbStrip      14px radius, 1px border, 10px/12px padding, gold hover border
 *   .lbStripRank  32px round disc on a gold wash
 *   .lbStripMain  12px bold — "#3 of 14 this month" + the movement pill
 *   .lbMove       9.5px extrabold on a green wash
 *   .lbStripSub   10.5px muted — "88 pts · #1 in syllabus logging"
 *   .lbStripGo    16px faint chevron
 *
 * The rank is WITHHELD below three scored colleagues: "#1 of 1" is an artefact,
 * not an achievement, so the main line falls back to the point total.
 *
 * The score measures the teacher's own USE of SALCI (marking turnaround,
 * attendance logging, homework marking, syllabus logging) and never their
 * pupils' results. The mockup's two-line strip has no room for that sentence, so
 * it rides as the row's tooltip rather than a third line.
 */
export function TeacherStandingStrip() {
  const { data, isLoading, isError } = useTeacherStanding();

  if (isLoading) return <Skeleton className="h-[76px] w-full rounded-2xl" />;

  // Nothing scored yet, or the RPC failed: show nothing rather than a hollow row.
  if (isError || !data?.available) return null;

  const hasRank = data.rank != null && data.cohort_size >= 3;
  const move = data.movement;

  return (
    <section
      title="Measures your own use of SALCI: marking, attendance logging, homework and syllabus updates. Never your students' results."
      className="surface-card frosted-shadow flex items-center gap-3.5 rounded-2xl border border-[hsl(var(--surface-stroke))] px-4 py-3.5 transition-colors hover:border-yellow-600/60"
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-yellow-600/10">
        <Medal className="h-[22px] w-[22px] text-yellow-700" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-bold text-ink-900">
            {hasRank
              ? `#${data.rank} of ${data.cohort_size} this month`
              : `${Math.round(data.score)} points this month`}
          </span>
          {hasRank && move != null && move !== 0 && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[12px] font-extrabold tabular-nums",
                move > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600",
              )}
            >
              {move > 0 ? "▲" : "▼"}
              {Math.abs(move)}
            </span>
          )}
        </div>

        <p className="mt-1 truncate text-[13.5px] text-ink-500">
          {hasRank && `${Math.round(data.score)} pts · `}
          {data.badge_label ? `#1 in ${data.badge_label}` : "Your SALCI usage"}
          {!hasRank && data.cohort_size < 3 && " · not enough colleagues scored to rank yet"}
        </p>
      </div>

      <span className="shrink-0 text-[22px] leading-none text-ink-400" aria-hidden="true">
        ›
      </span>
    </section>
  );
}
