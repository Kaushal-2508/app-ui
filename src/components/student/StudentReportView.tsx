import { useMemo } from "react";
import { format, parseISO } from "date-fns";

import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { compareToClassAverage } from "@/lib/performanceLabels";
import { cn } from "@/lib/utils";
import type { YearReport } from "@/hooks/useStudentYearReport";

/**
 * On-screen rendering of the SAME payload the downloadable PDF is built from
 * (public.student_year_report / student_year_report_for).
 *
 * Deliberately reads the report payload rather than the dashboard's own hooks:
 * those are auth.uid()-scoped so staff cannot use them, and re-deriving the
 * numbers a second way is exactly how a screen and a PDF start disagreeing.
 * One payload, two presentations.
 */

function pct(v: number | null | undefined, dp = 1): string {
  return v == null ? "N/A" : `${v.toFixed(dp)}%`;
}

function d(iso: string | null | undefined, fmt = "d MMM yyyy"): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), fmt);
  } catch {
    return String(iso);
  }
}

/** Same verdict vocabulary as the PDF and the dashboard Subject snapshot. */
function verdictOf(student: number | null, cls: number | null) {
  const { verdict } = compareToClassAverage(student, cls);
  if (verdict === "above") return { key: "good", label: "Ahead of class" };
  if (verdict === "below") return { key: "warn", label: "Needs attention" };
  if (verdict === "at_par") return { key: "level", label: "About the same" };
  return { key: "none", label: "No comparison" };
}

const TAG: Record<string, string> = {
  good: "bg-brand-primary/10 text-brand-primary",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  level: "bg-ink-400/10 text-ink-700",
  none: "bg-ink-400/10 text-ink-500",
};

function Meter({ value, tone }: { value: number; tone: string }) {
  const bar =
    tone === "good" ? "bg-brand-primary" : tone === "warn" ? "bg-amber-500" : "bg-slate-400";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-400/15">
        <span
          className={cn("block h-full rounded-full", bar)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-800">
        {Math.round(value)}%
      </span>
    </span>
  );
}

function Section({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-primary text-[11px] font-bold text-white">
          {n}
        </span>
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      </div>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const TH = "py-2 pr-3 text-left font-semibold";
const THR = "py-2 pr-3 text-right font-semibold";
const HEAD_ROW =
  "border-b border-ink-900/15 text-[11px] uppercase tracking-wide text-ink-600";

function gapClass(gap: number | null): string {
  if (gap == null) return "text-ink-500";
  return gap >= 0 ? "text-brand-primary" : "text-amber-700 dark:text-amber-400";
}

export function StudentReportView({ report }: { report: YearReport }) {
  const s = report.snapshot;
  const st = report.standing;

  const avgCmp = compareToClassAverage(s.my_avg, s.class_avg);
  const avgDelta =
    s.class_avg == null
      ? "Class average hidden, it needs 3 or more classmates"
      : avgCmp.verdict === "at_par"
        ? `In line with the class average of ${pct(s.class_avg)}`
        : `${Math.abs((s.my_avg ?? 0) - s.class_avg).toFixed(1)} pp ${
            avgCmp.verdict === "above" ? "above" : "below"
          } the class average of ${pct(s.class_avg)}`;

  const period = report.meta.window_is_synthetic
    ? "the last 12 months"
    : (report.meta.academic_year ?? "this academic year");

  const weak = useMemo(
    () => report.subjects.filter((x) => verdictOf(x.student_avg, x.class_avg).key === "warn"),
    [report.subjects],
  );

  const chaptersWeakestFirst = useMemo(
    () => [...report.chapters].sort((a, b) => a.student_avg - b.student_avg),
    [report.chapters],
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <StatTileGrid cols={2} mdCols={4}>
        <StatTile label="Overall average" value={pct(s.my_avg)} tone="teal" />
        <StatTile
          label="Assessments passed"
          value={
            s.n_assessments > 0 ? `${Math.round((s.pass_count / s.n_assessments) * 100)}%` : "0%"
          }
          tone="mint"
        />
        <StatTile
          label="Class standing"
          value={st.ahead_of == null ? "N/A" : `${st.ahead_of} of ${st.peers}`}
          tone="violet"
        />
        <StatTile
          label="Consistency"
          value={s.consistency == null ? "N/A" : `${s.consistency}/100`}
          tone="sky"
        />
      </StatTileGrid>

      <p className="rounded-card border-l-4 border-brand-primary bg-brand-primary/[0.06] px-4 py-3 text-sm leading-relaxed text-ink-700">
        <span className="font-semibold text-ink-900">In plain terms: </span>
        {s.n_assessments} published {s.n_assessments === 1 ? "assessment" : "assessments"} across{" "}
        {period} ({d(report.meta.from)} to {d(report.meta.to)}), averaging{" "}
        <span className="font-semibold text-ink-900">{pct(s.my_avg)}</span>. {avgDelta}.{" "}
        {weak.length === 0
          ? "No subject is below the class average."
          : `${weak.length === 1 ? "One subject needs" : `${weak.length} subjects need`} attention: ${weak
              .map((x) => x.subject)
              .join(", ")}.`}
      </p>

      {report.subjects.length > 0 && (
        <Section
          n={1}
          title="Subject-wise performance"
          sub="Worst gap first. The bar is the student's average and its colour matches the status."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={TH}>Subject</th>
                  <th className={TH}>Student</th>
                  <th className={THR}>Class</th>
                  <th className={THR}>Gap</th>
                  <th className={THR}>Tests</th>
                  <th className="py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.subjects.map((x) => {
                  const v = verdictOf(x.student_avg, x.class_avg);
                  const gap = x.class_avg == null ? null : x.student_avg - x.class_avg;
                  return (
                    <tr key={x.subject} className="border-b border-surface-stroke last:border-0">
                      <td className="py-2.5 pr-3 text-ink-900">{x.subject}</td>
                      <td className="w-[34%] py-2.5 pr-3">
                        <Meter value={x.student_avg} tone={v.key} />
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-500">
                        {pct(x.class_avg)}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-3 text-right font-semibold tabular-nums",
                          gapClass(gap),
                        )}
                      >
                        {gap == null ? "N/A" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-500">
                        {x.n_tests}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={cn(
                            "inline-block rounded px-2 py-0.5 text-[11px] font-semibold",
                            TAG[v.key],
                          )}
                        >
                          {v.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {chaptersWeakestFirst.length > 0 && (
        <Section
          n={2}
          title="Chapter coverage"
          sub="Chapters are recorded per test, not per question, so a test covering three chapters counts towards all three."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={TH}>Subject</th>
                  <th className={TH}>Chapter</th>
                  <th className={TH}>Score</th>
                  <th className={THR}>Class</th>
                  <th className="py-2 text-right font-semibold">Tests</th>
                </tr>
              </thead>
              <tbody>
                {chaptersWeakestFirst.map((c) => (
                  <tr key={c.chapter_id} className="border-b border-surface-stroke last:border-0">
                    <td className="py-2.5 pr-3 text-ink-500">{c.subject ?? ""}</td>
                    <td className="py-2.5 pr-3 text-ink-900">{c.chapter}</td>
                    <td className="w-[30%] py-2.5 pr-3">
                      <Meter value={c.student_avg} tone={c.student_avg < 65 ? "warn" : "good"} />
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-500">
                      {pct(c.class_avg)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-500">{c.n_tests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {report.series.length > 0 && (
        <Section n={3} title="Assessment log" sub="Every assessment in this period, in order.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={TH}>Assessment</th>
                  <th className={TH}>Date</th>
                  <th className={THR}>Score</th>
                  <th className={THR}>Marks</th>
                  <th className={THR}>Class</th>
                  <th className="py-2 text-right font-semibold">Gap</th>
                </tr>
              </thead>
              <tbody>
                {report.series.map((e) => {
                  const gap = e.class_avg == null ? null : e.my_pct - e.class_avg;
                  return (
                    <tr key={e.exam_id} className="border-b border-surface-stroke last:border-0">
                      <td className="py-2.5 pr-3 text-ink-900">{e.title}</td>
                      <td className="py-2.5 pr-3 text-ink-500">{d(e.exam_date, "d MMM yy")}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-ink-900">
                        {pct(e.my_pct)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-500">
                        {e.obtained != null && e.out_of != null
                          ? `${e.obtained}/${e.out_of}`
                          : "N/A"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-500">
                        {pct(e.class_avg)}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 text-right font-semibold tabular-nums",
                          gapClass(gap),
                        )}
                      >
                        {gap == null ? "N/A" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section n={4} title="Recognition and attendance">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border-l-4 border-brand-primary bg-brand-primary/[0.05] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Achievements</p>
            <p className="mt-1 text-lg font-bold text-ink-900">{report.engagement.points} points</p>
            <p className="mt-0.5 text-xs text-ink-600">
              {report.engagement.badge_count}{" "}
              {report.engagement.badge_count === 1 ? "badge" : "badges"} earned
              {report.engagement.badges.length > 0 &&
                ` · ${report.engagement.badges
                  .slice(0, 3)
                  .map((b) => b.name)
                  .join(", ")}`}
            </p>
          </div>
          <div className="rounded-card border-l-4 border-slate-400 bg-ink-400/[0.05] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">
              Attendance in this period
            </p>
            <p className="mt-1 text-lg font-bold text-ink-900">
              {pct(report.attendance.percentage)}
            </p>
            <p className="mt-0.5 text-xs text-ink-600">
              {report.attendance.graded_days > 0
                ? `Present ${report.attendance.present} of ${report.attendance.graded_days} marked days`
                : "No attendance marked"}
            </p>
          </div>
        </div>
      </Section>

      <p className="px-1 text-[11px] leading-relaxed text-ink-500">
        Based on {report.coverage.n_results} published{" "}
        {report.coverage.n_results === 1 ? "result" : "results"}.
        {report.coverage.n_no_chapter > 0 &&
          ` ${report.coverage.n_no_chapter} ${
            report.coverage.n_no_chapter === 1 ? "test has" : "tests have"
          } no chapter tagged and are absent from chapter coverage.`}{" "}
        Class comparisons are hidden where fewer than 3 classmates contributed, or 5 for the class
        spread and the highest score.
      </p>
    </div>
  );
}
