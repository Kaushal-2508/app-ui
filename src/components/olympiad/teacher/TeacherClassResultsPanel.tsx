import { useMemo, useState } from "react";
import { BarChart3, ChevronRight, Crown, Layers, Loader2 } from "lucide-react";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { Button } from "@/components/ui/button";
import { ReportBarChart, ReportDonut } from "@/components/olympiad/school/report/ReportCharts";
import { useTeacherOlympiadClassReport } from "@/hooks/olympiad/useTeacherOlympiadClassReport";
import { useOlympiadStudentResults, type StudentResultRow } from "@/hooks/olympiad/useOlympiadStudentResults";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import type { ClassMetric } from "@/components/olympiad/teacher/ClassMetricSheet";

const TIER_PILL: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  silver: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  bronze: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  participation: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};
const TIER_LABEL: Record<string, string> = {
  gold: "Gold", silver: "Silver", bronze: "Bronze", participation: "Part.", absent: "Absent",
};

function Section({ eyebrow, title, subtitle, children }: {
  eyebrow: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="text-xs text-ink-600 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * Class-scoped results report for the teacher — only their assigned grade.
 * Aggregates (avg, distribution, tier mix, subject perf, weak topics) come from
 * the grade-scoped oly_teacher_class_report RPC; the ranked student list joins
 * the (already grade-filtered) roster to the teacher-readable per-student results.
 * Tapping a student opens their scorecard.
 */
export function TeacherClassResultsPanel({
  olySchoolId,
  gradeLevelId,
  roster,
  onOpenStudent,
  onMetric,
}: {
  olySchoolId: string | undefined;
  gradeLevelId: string | undefined;
  roster: RosterStudent[];
  onOpenStudent: (studentId: string) => void;
  /** Open the KPI drill-down sheet for a metric (Appeared / Average / …). */
  onMetric?: (m: ClassMetric) => void;
}) {
  const { data: report, isLoading, isError, refetch } = useTeacherOlympiadClassReport(olySchoolId, gradeLevelId);
  const { data: studentResults } = useOlympiadStudentResults(olySchoolId);
  // Leaderboard starts at the top 5; "Load 5 more" / "Load all" expand it.
  const [visibleCount, setVisibleCount] = useState(5);

  // Ranked list: roster students (already grade-scoped) joined to their published
  // result, appeared only, highest first.
  const ranked = useMemo(() => {
    const rows: Array<{ student: RosterStudent; result: StudentResultRow }> = [];
    for (const s of roster) {
      if (s.status !== "active") continue;
      const result = studentResults?.[s.id];
      if (!result || result.certificate_tier === "absent") continue;
      rows.push({ student: s, result });
    }
    rows.sort((a, b) => b.result.percentage - a.result.percentage);
    return rows;
  }, [roster, studentResults]);

  if (isLoading) {
    return (
      <div className="surface-card frosted-shadow rounded-card flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  // Error BEFORE empty (§6) — an RPC failure must never read as "no results".
  if (isError) {
    return (
      <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center">
        <p className="text-sm text-ink-600">Couldn't load the class report.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!report?.results_available) {
    return (
      <Section eyebrow="Results" title="Class results">
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title="Results not published yet"
          description="Once your students sit the exam and results are published, the class report appears here."
          reason="noData"
        />
      </Section>
    );
  }

  const td = report.tier_distribution;
  const donutData = [
    { key: "gold", name: "Gold", value: td?.gold ?? 0 },
    { key: "silver", name: "Silver", value: td?.silver ?? 0 },
    { key: "bronze", name: "Bronze", value: td?.bronze ?? 0 },
    { key: "participation", name: "Participation", value: td?.participation ?? 0 },
    { key: "absent", name: "Absent", value: td?.absent ?? 0 },
  ].filter((d) => d.value > 0);
  const hasTiers = report.results_published && donutData.length > 0;

  return (
    <div className="space-y-4">
      <Section eyebrow="Results" title="Class performance" subtitle="How your class did in the Olympiad">
        <StatTileGrid cols={2} mdCols={4}>
          <StatTile label="Appeared" value={`${report.appeared}/${report.enrolled}`} icon={<Crown className="h-4 w-4" />} tone="teal" onClick={onMetric ? () => onMetric("appeared") : undefined} />
          <StatTile label="Average" value={`${report.avg_percentage}%`} icon={<BarChart3 className="h-4 w-4" />} tone="violet" onClick={onMetric ? () => onMetric("average") : undefined} />
          <StatTile label="Highest" value={`${report.max_percentage}%`} icon={<Crown className="h-4 w-4" />} tone="sky" onClick={onMetric ? () => onMetric("highest") : undefined} />
          <StatTile label="Absent" value={String(report.absent)} icon={<Layers className="h-4 w-4" />} tone="rose" onClick={onMetric ? () => onMetric("absent") : undefined} />
        </StatTileGrid>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
          <div>
            <p className="eyebrow mb-1">Score distribution</p>
            <ReportBarChart
              data={report.score_distribution.map((b) => ({ label: b.bucket, value: b.count }))}
              color="#fa920e"
              height={180}
            />
          </div>
          {hasTiers && (
            <div>
              <p className="eyebrow mb-1">Medal mix</p>
              <ReportDonut data={donutData} />
            </div>
          )}
        </div>
      </Section>

      {(report.subject_performance.length > 0 || report.weak_topics.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {report.subject_performance.length > 0 && (
            <Section eyebrow="Where the class does well / lags" title="Subject performance" subtitle="Average % correct per subject">
              <ReportBarChart
                horizontal
                domainMax={100}
                data={report.subject_performance.map((s) => ({ label: s.subject_name, value: s.pct_correct }))}
              />
            </Section>
          )}
          {report.weak_topics.length > 0 && (
            <Section eyebrow="Where the class lags" title="Weakest concepts" subtitle="Lowest % correct by topic">
              <ul className="divide-y divide-surface-stroke">
                {report.weak_topics.map((t) => (
                  <li key={`${t.subject_name}-${t.topic_name}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
                      <p className="text-[11px] text-ink-500">{t.subject_name} · {t.questions} question{t.questions === 1 ? "" : "s"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${t.pct_correct < 40 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : t.pct_correct < 60 ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>
                      {t.pct_correct}%
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      <Section eyebrow="Leaderboard" title="Student results" subtitle="Tap a student for their full scorecard">
        {ranked.length === 0 ? (
          <EmptyState icon={<Crown className="h-7 w-7" />} title="No results yet" reason="noData" />
        ) : (
          <ol className="space-y-1.5">
            {ranked.slice(0, visibleCount).map(({ student, result }, i) => (
              <li
                key={student.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenStudent(student.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenStudent(student.id); }
                }}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 odd:bg-muted/40 transition-colors hover:bg-ink-400/10"
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-amber-400 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-950" : "bg-muted text-ink-600"}`}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{student.full_name}</p>
                  <p className="text-[11px] text-ink-500">{student.roll_number}</p>
                </div>
                {TIER_LABEL[result.certificate_tier] && result.certificate_tier !== "absent" && (
                  <span className={`hidden sm:inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_PILL[result.certificate_tier] ?? ""}`}>
                    {TIER_LABEL[result.certificate_tier]}
                  </span>
                )}
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{result.percentage}%</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
              </li>
            ))}
          </ol>
        )}

        {/* Top 5 by default — expand on demand */}
        {visibleCount < ranked.length && (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((c) => Math.min(c + 5, ranked.length))}
            >
              Load 5 more
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVisibleCount(ranked.length)}>
              Load all ({ranked.length})
            </Button>
          </div>
        )}
        {visibleCount >= ranked.length && ranked.length > 5 && (
          <div className="flex justify-center pt-3">
            <Button variant="ghost" size="sm" onClick={() => setVisibleCount(5)}>
              Show top 5
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
