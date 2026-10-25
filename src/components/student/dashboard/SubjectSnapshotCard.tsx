import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import {
  useStudentSubjectComparison,
  type SubjectComparisonRow,
} from "@/hooks/useStudentClassComparison";
import { compareToClassAverage, type ComparisonVerdict } from "@/lib/performanceLabels";
import { cn } from "@/lib/utils";

/**
 * Subjects are GROUPED by verdict, and each subject is ONE aligned row.
 *
 * Two things made the earlier versions read as a cluster: sorting purely
 * weakest-first interleaved the verdicts so the colours scattered down the card,
 * and every subject occupied three stacked lines (name+value, bar, metadata) —
 * nine subjects meant twenty-seven lines running the full width of the card.
 *
 * Now: three labelled blocks, and one line per subject with the name, bar, value
 * and metadata each in a fixed column so they align all the way down. Colour is
 * confined to the group marker and the bar fill; the surface stays neutral.
 */
const GROUPS: { verdict: ComparisonVerdict; label: string; dot: string; bar: string }[] = [
  { verdict: "below", label: "Needs attention", dot: "bg-brand-accent", bar: "bg-brand-accent" },
  { verdict: "at_par", label: "About the same as class", dot: "bg-brand-primary", bar: "bg-brand-primary" },
  { verdict: "above", label: "Ahead of class", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  { verdict: "unknown", label: "No class comparison yet", dot: "bg-ink-400", bar: "bg-ink-400" },
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Section 6 — subjects grouped by how they compare to the class, weakest-first
 *  inside each group. The coloured bar is the student's average; the dark tick on
 *  it is the class average. */
export function SubjectSnapshotCard() {
  const navigate = useNavigate();
  const { data, isLoading } = useStudentSubjectComparison();

  const subjects = useMemo(() => data?.subjects ?? [], [data]);

  const grouped = useMemo(() => {
    const map = new Map<ComparisonVerdict, SubjectComparisonRow[]>();
    subjects.forEach((s) => {
      const { verdict } = compareToClassAverage(s.student_avg, s.class_avg);
      const list = map.get(verdict) ?? [];
      list.push(s);
      map.set(verdict, list);
    });
    return map;
  }, [subjects]);

  const visibleGroups = GROUPS.filter((g) => (grouped.get(g.verdict) ?? []).length > 0);

  return (
    <Card className="surface-card frosted-shadow rounded-card ring-1 ring-ink-400/15">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <CardTitle className="flex items-center gap-2 text-base text-ink-900">
            <BookOpen className="h-4 w-4 text-brand-primary" />
            Subject snapshot
          </CardTitle>
          {subjects.length > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
              <span className="h-3 w-[2px] rounded-full bg-ink-900" aria-hidden />
              Class average
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="grid gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title="No subject scores yet"
            description="Subject-wise performance will appear here once your results are published."
            tone="sky"
          />
        ) : (
          <div className="space-y-5">
            {visibleGroups.map((g, gi) => {
              const rows = grouped.get(g.verdict) ?? [];

              return (
                <section
                  key={g.verdict}
                  className={cn(gi > 0 && "border-t border-surface-stroke pt-5")}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", g.dot)} aria-hidden />
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">
                      {g.label}
                    </h3>
                    <span className="text-[11px] tabular-nums text-ink-400">{rows.length}</span>
                  </div>

                  <ul className="mt-2.5 space-y-2.5">
                    {rows.map((s) => {
                      const studentAvg = s.student_avg ?? 0;
                      const classPct = s.class_avg == null ? null : clamp(s.class_avg);

                      return (
                        <li key={s.subject}>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(
                                `/student/results?subject=${encodeURIComponent(s.subject)}`,
                              )
                            }
                            aria-label={`View your ${s.subject} results`}
                            className={cn(
                              "grid w-full items-center gap-x-4 gap-y-2 rounded-lg text-left",
                              "-mx-2 px-2 py-1.5 transition-colors hover:bg-ink-400/[0.07]",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                              // Mobile: name + value on one line, bar and metadata beneath.
                              "grid-cols-[minmax(0,1fr)_auto]",
                              // Desktop: name | bar | value | metadata | chevron, in fixed columns.
                              "sm:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_2.75rem_8.5rem_1rem]",
                            )}
                          >
                          <span className="order-1 truncate text-sm font-medium text-ink-900">
                            {s.subject}
                          </span>

                          <span className="order-2 justify-self-end text-[15px] font-semibold tabular-nums text-ink-900 sm:order-3">
                            {Math.round(studentAvg)}%
                          </span>

                          {/* Track + bar + class-average tick. The tick sits above the
                              track so the fill's overflow-hidden can never clip it. */}
                          <div className="relative order-3 col-span-2 h-2.5 sm:order-2 sm:col-span-1">
                            <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-ink-400/15">
                              <div
                                className={cn("h-full rounded-full", g.bar)}
                                style={{ width: `${clamp(studentAvg)}%` }}
                              />
                            </div>
                            {classPct != null && (
                              <span
                                className="absolute top-0 h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-ink-900"
                                style={{ left: `${classPct}%` }}
                                aria-hidden
                              />
                            )}
                          </div>

                          <span className="order-4 col-span-2 text-[11px] tabular-nums text-ink-500 sm:col-span-1 sm:justify-self-end sm:text-right">
                            {s.class_avg != null && `Class ${Math.round(s.class_avg)}% · `}
                            {s.n_tests === 1 ? "1 test" : `${s.n_tests} tests`}
                          </span>

                            <ChevronRight
                              className="order-5 hidden h-4 w-4 shrink-0 text-ink-400 sm:block"
                              aria-hidden
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
