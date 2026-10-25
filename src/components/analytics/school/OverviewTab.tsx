import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Percent,
} from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { HomeworkAnalyticsSection } from "@/components/analytics/HomeworkAnalyticsSection";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OverviewPayload, ScoreBand } from "@/hooks/useSchoolAnalytics";
import { SCORE_BANDS } from "@/hooks/useSchoolAnalytics";
import { cn } from "@/lib/utils";

import { ChartFrame, ChartTable, ChartTableToggle, ChartTooltipCard } from "./charts";
import { AXIS_TICK, BAND_FILLS, CHART, GRID_PROPS, delta, longDate, num, pct, pct0, shortDate, truncate } from "./chartTokens";

interface Props {
  institutionId: string;
  query: {
    data: OverviewPayload | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  };
  onPickBand: (band: ScoreBand) => void;
}

export function OverviewTab({ institutionId, query, onPickBand }: Props) {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = query;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <KpiRow data={data} isLoading={isLoading} isError={isError} onRetry={refetch} />
      <DistributionCard
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        onPickBand={onPickBand}
      />
      {/* items-start so the shorter card does not stretch to match the taller one. */}
      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
        <SubjectsCard
          data={data}
          isLoading={isLoading}
          isError={isError}
          onRetry={refetch}
          onOpenSubject={(id) => navigate(`/school/subject/${id}`)}
        />
        <PipelineCard data={data} isLoading={isLoading} isError={isError} onRetry={refetch} />
      </div>
      <TrendCard
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        onOpenExam={(id) => navigate(`/exams/${id}/results`)}
      />
      {/* Homework marks are institution-wide and all-time: homework_analytics_rollup
          takes no window and no class. Labelled so it is not read as part of the
          filtered period above. */}
      <div>
        <HomeworkAnalyticsSection institutionId={institutionId} />
        <p className="mt-2 text-xs text-ink-500">
          Homework figures cover all published assignments for the whole school. The period and
          class filters above do not apply to them.
        </p>
      </div>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

function KpiRow({
  data,
  isLoading,
  isError,
  onRetry,
}: {
  data: OverviewPayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading && !data) {
    return (
      <StatTileGrid cols={2} mdCols={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </StatTileGrid>
    );
  }

  // Error before empty: a failed aggregate must never read as a school that
  // scored zero (CLAUDE.md §6).
  if (isError || !data) {
    return (
      <section className="surface-card frosted-shadow rounded-card p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-ink-900">
              Couldn't load this school's figures.
            </p>
            <p className="mt-1 text-sm text-ink-600">
              These numbers are unavailable right now, so nothing below should be read as a result.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const p = data.performance;

  return (
    <StatTileGrid cols={2} mdCols={4}>
      <StatTile
        label="Average score"
        value={pct(p.avg_pct)}
        icon={<Percent className="h-5 w-5" />}
        tone="teal"
        delta={delta(p.avg_pct, p.prev_avg_pct, p.prev_results)}
      />
      <StatTile
        label="Pass rate"
        value={pct0(p.pass_rate)}
        icon={<ClipboardCheck className="h-5 w-5" />}
        tone="mint"
        delta={delta(p.pass_rate, p.prev_pass_rate, p.prev_results)}
      />
      <StatTile
        /* "Students assessed" read as "students the portal tested", so a school
           whose marks are typed in from paper looked like invented data: at
           Alliance 244 of these students have never signed in yet legitimately
           hold marks a teacher entered. This is what the number counts. */
        label="Students with marks"
        value={
          <span>
            {num(p.students_assessed)}
            {/* Drop the denominator when it cannot contain the numerator, the
                same guard the class rows use. */}
            {data.roster.students >= p.students_assessed && (
              <span className="text-[15px] font-medium text-ink-500">
                {" "}
                of {num(data.roster.students)}
              </span>
            )}
          </span>
        }
        icon={<GraduationCap className="h-5 w-5" />}
        tone="sky"
      />
      <StatTile
        label="Marks recorded"
        value={num(p.results)}
        icon={<FileText className="h-5 w-5" />}
        tone="violet"
      />
    </StatTileGrid>
  );
}

// ── Distribution ─────────────────────────────────────────────────────────────

function DistributionCard({
  data,
  isLoading,
  isError,
  onRetry,
  onPickBand,
}: {
  data: OverviewPayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onPickBand: (band: ScoreBand) => void;
}) {
  const [showTable, setShowTable] = React.useState(false);

  const rows = React.useMemo(
    () =>
      (data?.distribution ?? []).map((d, i) => ({
        ...d,
        short: SCORE_BANDS.find((b) => b.band === d.band)?.short ?? d.label,
        fill: BAND_FILLS[i] ?? BAND_FILLS[BAND_FILLS.length - 1],
      })),
    [data],
  );

  const total = rows.reduce((sum, r) => sum + r.students, 0);
  const struggling = rows
    .filter((r) => r.band === "lt35" || r.band === "b35_49")
    .reduce((s, r) => s + r.students, 0);

  return (
    <WidgetCard
      title="Students by average score"
      caption={
        total > 0
          ? `Each student's own average across every result in this period. ${num(struggling)} of ${num(total)} sit below 50%.`
          : "Each student's own average across every result in this period."
      }
      clickHint="Select a band to see exactly which students are in it."
      isLoading={isLoading && !data}
      isError={isError}
      onRetry={onRetry}
      isEmpty={!isLoading && !isError && total === 0}
      emptyTitle="No results in this period"
      emptyDescription="Widen the period, or publish results for an exam to see how students are spread."
      headerSlot={
        rows.length > 0 ? (
          <ChartTableToggle chartName="students by average score" open={showTable} onToggle={() => setShowTable((v) => !v)} />
        ) : undefined
      }
    >
      <ChartFrame height={240}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="22%">
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="short"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.axis }}
              interval={0}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={36}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: CHART.seriesSoft }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof rows)[number];
                return (
                  <ChartTooltipCard
                    title={d.label}
                    lines={[
                      { label: "students", value: num(d.students), strong: true },
                      {
                        label: "of all assessed students",
                        value: total > 0 ? `${Math.round((d.students / total) * 100)}%` : "N/A",
                      },
                    ]}
                    hint="Select to list them"
                  />
                );
              }}
            />
            <Bar
              dataKey="students"
              radius={[4, 4, 0, 0]}
              maxBarSize={56}
              cursor="pointer"
              onClick={(entry: unknown) => {
                const row = entry as { band?: ScoreBand };
                if (row?.band) onPickBand(row.band);
              }}
            >
              {rows.map((r) => (
                <Cell key={r.band} fill={r.fill} stroke={CHART.surface} strokeWidth={2} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* Legend doubles as the keyboard path into each band, so the drill-down
          is never mouse-only. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map((r) => (
          <button
            key={r.band}
            type="button"
            onClick={() => onPickBand(r.band)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-surface-stroke px-3 py-1.5",
              "text-xs font-medium text-ink-700 transition-colors duration-200",
              "hover:bg-ink-400/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
            )}
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: r.fill }}
            />
            {r.label}
            <span className="tabular-nums text-ink-500">{num(r.students)}</span>
          </button>
        ))}
      </div>

      {showTable && (
        <ChartTable
          caption="Students by average score band"
          head={["Band", "Students", "Share"]}
          rows={rows.map((r) => [
            r.label,
            num(r.students),
            total > 0 ? `${Math.round((r.students / total) * 100)}%` : "N/A",
          ])}
        />
      )}
    </WidgetCard>
  );
}

// ── Subjects ─────────────────────────────────────────────────────────────────

function SubjectsCard({
  data,
  isLoading,
  isError,
  onRetry,
  onOpenSubject,
}: {
  data: OverviewPayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenSubject: (subjectId: string) => void;
}) {
  const [showTable, setShowTable] = React.useState(false);

  const SUBJECT_CAP = 10;
  const scored = React.useMemo(
    () => (data?.subjects ?? []).filter((s) => s.avg_pct !== null),
    [data],
  );
  const rows = React.useMemo(
    () =>
      scored
        .slice(0, SUBJECT_CAP)
        .map((s) => ({ ...s, label: truncate(s.subject_name, 18), value: Number(s.avg_pct) })),
    [scored],
  );
  // Never drop the tail silently: a capped chart that reads as the whole picture
  // is worse than one that says how much it is showing.
  const hidden = scored.length - rows.length;

  const schoolAvg = data?.performance.avg_pct ?? null;
  // A combined paper carries one whole-paper score, which is then attributed to
  // each of its subjects. Say so rather than implying per-subject marking.
  const combined = data?.pipeline.multi_subject_exams ?? 0;

  return (
    <WidgetCard
      title="Subjects by average"
      caption={
        rows.length > 0
          ? `Weakest first. The dotted line is the school average of ${pct(schoolAvg)}, so any bar left of it is pulling the school down.${
              hidden > 0 ? ` Showing the ${rows.length} weakest of ${scored.length} subjects.` : ""
            }${
              combined > 0
                ? ` ${num(combined)} combined papers carry one score across several subjects, so those subjects share it.`
                : ""
            }`
          : "Weakest first, against the school average."
      }
      clickHint="Select a bar, or a row under Show values, to open a subject."
      isLoading={isLoading && !data}
      isError={isError}
      onRetry={onRetry}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No subject scores yet"
      emptyDescription="Subjects appear once an exam linked to them has published results."
      headerSlot={
        rows.length > 0 ? (
          <ChartTableToggle chartName="subjects by average" open={showTable} onToggle={() => setShowTable((v) => !v)} />
        ) : undefined
      }
    >
      <ChartFrame height={Math.max(200, rows.length * 34 + 40)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 44, bottom: 4, left: 0 }}
            barCategoryGap="26%"
          >
            <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.axis }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={104}
            />
            <Tooltip
              cursor={{ fill: CHART.seriesSoft }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof rows)[number];
                return (
                  <ChartTooltipCard
                    title={d.subject_name}
                    lines={[
                      { label: "average", value: pct(d.avg_pct), strong: true },
                      { label: "pass rate", value: pct0(d.pass_rate) },
                      { label: `results across ${num(d.exams)} exams`, value: num(d.results) },
                    ]}
                    hint="Select to open the subject"
                  />
                );
              }}
            />
            {schoolAvg !== null && (
              <ReferenceLine
                x={schoolAvg}
                stroke={CHART.reference}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
            )}
            <Bar
              dataKey="value"
              fill={CHART.series}
              radius={[0, 4, 4, 0]}
              maxBarSize={20}
              cursor="pointer"
              onClick={(entry: unknown) => {
                const row = entry as { subject_id?: string };
                if (row?.subject_id) onOpenSubject(row.subject_id);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {showTable && (
        <ChartTable
          caption="Subject averages"
          head={["Subject", "Average", "Pass rate", "Results"]}
          rows={rows.map((s) => [s.subject_name, pct(s.avg_pct), pct0(s.pass_rate), num(s.results)])}
          onRowClick={(i) => onOpenSubject(rows[i].subject_id)}
          rowActionLabel={(i) => `Open ${rows[i].subject_name}`}
        />
      )}
    </WidgetCard>
  );
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

function PipelineCard({
  data,
  isLoading,
  isError,
  onRetry,
}: {
  data: OverviewPayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const p = data?.pipeline;

  const steps = p
    ? [
        {
          label: "Exams set",
          value: p.exams_scored,
          // "Exams held" claimed they had been sat; a published exam may not have
          // been. Hybrid papers score on a separate plane and never land here.
          hint: [
            `${num(p.exams_draft)} still in draft`,
            p.exams_hybrid > 0 ? `${num(p.exams_hybrid)} hybrid, scored elsewhere` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        },
        {
          label: "Papers accounted for",
          value: p.attempts_submitted,
          // Not "submitted": most of these are offline papers whose marks a
          // teacher entered, so no student ever submitted anything.
          hint: "Sat online or entered from paper",
        },
        {
          label: "Results recorded",
          value: p.results_published,
          hint: `${num(p.exams_with_results)} exams have results`,
        },
      ]
    : [];

  // The Awaiting evaluation row used to sit here, linking to /ocr-review. That
  // page is reachable from nowhere else in the app, so this card was its only
  // door and pointed people at a surface the product does not otherwise offer.
  // The count is still returned by the RPC if it is ever wanted again.
  const gaps = p
    ? [
        {
          key: "awaiting_result",
          label: "Submitted with no result",
          value: p.awaiting_result,
          hint: "A paper was handed in but no result row exists",
          to: "/exams",
          cta: "Open exams",
        },
      ]
    : [];

  return (
    <WidgetCard
      title="Result pipeline"
      caption="Where papers are between being written and being counted. A large gap here is why an average can look stale."
      isLoading={isLoading && !data}
      isError={isError}
      onRetry={onRetry}
      isEmpty={!isLoading && !isError && !!p && p.exams_in_window === 0}
      emptyTitle="No exams in this period"
      emptyDescription="Widen the period, or create an exam to start collecting results."
      emptyAction={{ label: "Create an exam", onClick: () => navigate("/exams/create") }}
    >
      <div className="flex flex-col gap-2">
        {steps.map((s) => (
          <div
            key={s.label}
            className="flex items-baseline justify-between gap-3 border-b border-surface-stroke pb-2 last:border-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-900">{s.label}</p>
              <p className="truncate text-xs text-ink-500">{s.hint}</p>
            </div>
            <p className="shrink-0 text-[22px] font-semibold tabular-nums text-ink-900">
              {num(s.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {gaps.map((g) => {
          const open = g.value > 0;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => navigate(g.to)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left",
                "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                open
                  ? "border-signal-warn/30 bg-signal-warn/10 hover:bg-signal-warn/15"
                  : "border-surface-stroke hover:bg-ink-400/5",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <AlertTriangle
                  aria-hidden
                  className={cn("h-4 w-4 shrink-0", open ? "text-signal-warn" : "text-ink-400")}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{g.label}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {open ? g.cta : g.hint}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-lg font-semibold tabular-nums text-ink-900">
                {num(g.value)}
              </span>
            </button>
          );
        })}
      </div>

      {/* The single most confusing thing about this page for a school that marks
          on paper: a mark does not imply a login. Say so where the counts are. */}
      {!!data && data.performance.results_offline > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          {num(data.performance.results_offline)} of{" "}
          {num(data.performance.results_offline + data.performance.results_online)} marks were entered
          from an offline paper, so they exist for students who have never signed in.{" "}
          {data.performance.results_online > 0
            ? `${num(data.performance.results_online)} came from a paper sat online.`
            : "None were sat online."}
        </p>
      )}
      {!!data && data.performance.absent_results > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          {num(data.performance.absent_results)} results are marked absent and are left out of every
          average and pass rate on this page.
        </p>
      )}
    </WidgetCard>
  );
}

// ── Trend ────────────────────────────────────────────────────────────────────

function TrendCard({
  data,
  isLoading,
  isError,
  onRetry,
  onOpenExam,
}: {
  data: OverviewPayload | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpenExam: (examId: string) => void;
}) {
  const [showTable, setShowTable] = React.useState(false);

  const rows = React.useMemo(
    () =>
      (data?.trend ?? []).map((t) => ({
        ...t,
        axisLabel: shortDate(t.exam_date),
        value: t.avg_pct === null ? 0 : Number(t.avg_pct),
      })),
    [data],
  );

  const periodAvg = data?.performance.avg_pct ?? null;
  const withResults = data?.pipeline.exams_with_results ?? 0;

  return (
    <WidgetCard
      title="Exam by exam"
      caption={
        // The RPC caps the trend at the 12 most recent scored exams, so claiming
        // "every exam" would be false on a busy term.
        withResults > rows.length
          ? `The ${rows.length} most recent of ${withResults} exams with results in this period, oldest first. The dotted line is the period average.`
          : `Every exam in this period that has results, oldest first. The dotted line is the period average.`
      }
      clickHint="Select a bar, or a row under Show values, to open an exam."
      isLoading={isLoading && !data}
      isError={isError}
      onRetry={onRetry}
      isEmpty={!isLoading && !isError && rows.length === 0}
      emptyTitle="No exam results in this period"
      emptyDescription="Once an exam's results are published it appears here."
      headerSlot={
        rows.length > 0 ? (
          <ChartTableToggle chartName="exam by exam" open={showTable} onToggle={() => setShowTable((v) => !v)} />
        ) : undefined
      }
    >
      <ChartFrame height={260}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="24%">
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              dataKey="axisLabel"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: CHART.axis }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              domain={[0, 100]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              cursor={{ fill: CHART.seriesSoft }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof rows)[number];
                return (
                  <ChartTooltipCard
                    title={d.title}
                    subtitle={longDate(d.exam_date)}
                    lines={[
                      { label: "average", value: pct(d.avg_pct), strong: true },
                      { label: "results counted", value: num(d.participation) },
                    ]}
                    hint="Select to open results"
                  />
                );
              }}
            />
            {periodAvg !== null && (
              <ReferenceLine
                y={periodAvg}
                stroke={CHART.reference}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
              />
            )}
            <Bar
              dataKey="value"
              fill={CHART.series}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              cursor="pointer"
              onClick={(entry: unknown) => {
                const row = entry as { exam_id?: string };
                if (row?.exam_id) onOpenExam(row.exam_id);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {showTable && (
        <ChartTable
          caption="Exam averages"
          head={["Exam", "Date", "Average", "Results"]}
          rows={rows.map((t) => [
            t.title,
            longDate(t.exam_date),
            pct(t.avg_pct),
            num(t.participation),
          ])}
          onRowClick={(i) => onOpenExam(rows[i].exam_id)}
          rowActionLabel={(i) => `Open results for ${rows[i].title}`}
        />
      )}
    </WidgetCard>
  );
}
