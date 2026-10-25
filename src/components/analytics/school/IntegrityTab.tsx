import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Clock, Eye, Flag, ShieldCheck } from "lucide-react";

import { WidgetCard } from "@/components/command-center/WidgetCard";
import { DashboardTable } from "@/components/command-center/DashboardTable";
import { ListRow, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsIntegrity, type AnalyticsRange } from "@/hooks/useSchoolAnalytics";

import { ChartFrame, ChartTable, ChartTableToggle, ChartTooltipCard } from "./charts";
import { AXIS_TICK, CHART, GRID_PROPS, longDate, num, pct, truncate } from "./chartTokens";

/** proctoring_events.event_type is free text; these are the values the client emits. */
function eventLabel(raw: string): string {
  return raw
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

interface Props {
  institutionId: string | null;
  range: AnalyticsRange;
  classId: string | null;
  /** Super-admin, all-institutions view. */
  platform?: boolean;
}

export function IntegrityTab({ institutionId, range, classId, platform = false }: Props) {
  const navigate = useNavigate();
  const query = useAnalyticsIntegrity(institutionId, range, classId, platform);
  const [showTable, setShowTable] = React.useState(false);

  const data = query.data;
  const sessions = data?.sessions;
  const severity = data?.severity;

  const typeRows = React.useMemo(
    () =>
      (data?.event_types ?? []).map((e) => ({
        ...e,
        label: truncate(eventLabel(e.event_type), 19),
        full: eventLabel(e.event_type),
      })),
    [data],
  );

  const examRows = data?.exams ?? [];
  // Both lists are server-capped at 8. Never present a truncated list as the
  // whole picture.
  const typesHidden = Math.max((data?.event_types_total ?? 0) - typeRows.length, 0);
  const examsHidden = Math.max((data?.exams_total ?? 0) - examRows.length, 0);
  const inexactRange = data?.window?.range_is_exact === false;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* The advisory framing has to sit above the numbers, not below them:
          a flag count read without it looks like a verdict. */}
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-ink-900">
              Proctoring flags are advisory, never a verdict
            </p>
            <p className="mt-1 text-sm text-ink-600">
              Nothing here penalises a student automatically. A flag means the session is worth a
              human look, not that anything improper happened. Only online exams are proctored, so
              offline and hybrid papers never appear.
              {inexactRange
                ? " Across all institutions there is no single academic year, so that period covers the last twelve months."
                : ""}
            </p>
          </div>
        </div>
      </section>

      {query.isLoading && !data ? (
        <StatTileGrid cols={2} mdCols={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </StatTileGrid>
      ) : query.isError || !sessions ? (
        <section className="surface-card frosted-shadow rounded-card p-5">
          <p className="text-[15px] font-semibold text-ink-900">Couldn't load proctoring figures.</p>
          <p className="mt-1 text-sm text-ink-600">These counts are unavailable right now.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </section>
      ) : (
        <StatTileGrid cols={2} mdCols={4}>
          <StatTile
            label="Sessions recorded"
            value={num(sessions.total)}
            icon={<Eye className="h-5 w-5" />}
            tone="sky"
          />
          <StatTile
            label="Awaiting review"
            value={num(sessions.pending)}
            icon={<Clock className="h-5 w-5" />}
            tone="peach"
          />
          <StatTile
            label="Marked for a look"
            value={num(sessions.requires_review)}
            icon={<Flag className="h-5 w-5" />}
            tone="rose"
          />
          {/* `settled` is reviewed + cleared + flagged. Summing only the first
              two dropped every session a human had judged suspicious, so the
              tiles did not add up to "Sessions recorded". */}
          <StatTile
            label="Reviewed"
            value={num(sessions.settled)}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="mint"
          />
        </StatTileGrid>
      )}

      {/* items-start: without it the grid stretches the short chart card to
          the height of the long table beside it, leaving a wall of empty card. */}
      <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-2">
        <WidgetCard
          title="What the proctor recorded"
          caption={
            severity
              ? `Every event across all ${num(sessions?.total ?? 0)} sessions, not only the flagged ones. ${num(severity.high)} high, ${num(severity.medium)} medium and ${num(severity.low)} low severity.${
                  typesHidden > 0 ? ` Showing the ${typeRows.length} most common of ${num(data?.event_types_total ?? 0)} types.` : ""
                }`
              : "The events that fired most often across these sessions."
          }
          isLoading={query.isLoading && !data}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          isEmpty={!query.isLoading && !query.isError && typeRows.length === 0}
          emptyTitle="No proctoring events"
          emptyDescription="Either no online exam ran in this period, or nothing was flagged."
          headerSlot={
            typeRows.length > 0 ? (
              <ChartTableToggle chartName="what the proctor recorded" open={showTable} onToggle={() => setShowTable((v) => !v)} />
            ) : undefined
          }
        >
          <ChartFrame height={Math.max(200, typeRows.length * 32 + 40)}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={typeRows}
                layout="vertical"
                margin={{ top: 4, right: 20, bottom: 4, left: 0 }}
                barCategoryGap="26%"
              >
                <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: CHART.axis }}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={156}
                />
                <Tooltip
                  cursor={{ fill: CHART.seriesSoft }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof typeRows)[number];
                    return (
                      <ChartTooltipCard
                        title={d.full}
                        lines={[{ label: "events", value: num(d.events), strong: true }]}
                      />
                    );
                  }}
                />
                <Bar dataKey="events" fill={CHART.series} radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>

          {showTable && (
            <ChartTable
              caption="Proctoring events by type"
              head={["Event", "Count"]}
              rows={typeRows.map((t) => [t.full, num(t.events)])}
            />
          )}
        </WidgetCard>

        <DashboardTable
          title="Exams with the most flags"
          description={
            examsHidden > 0
              ? `The ${examRows.length} most flagged of ${num(data?.exams_total ?? 0)} exams with a flag. Select a row to open that exam.`
              : "Sorted by how many sessions were marked for review. Select a row to open that exam."
          }
          isLoading={query.isLoading && !data}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          isEmpty={!query.isLoading && !query.isError && examRows.length === 0}
          emptyTitle="No flagged exams"
          emptyDescription="No online exam in this period had a session marked for review."
          total={examRows.length}
          shown={examRows.length}
        >
          <ul className="flex flex-col gap-2">
            {examRows.map((row) => (
              <ListRow
                key={row.exam_id}
                as="li"
                title={row.title}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-normal">
                    <span>{longDate(row.exam_date)}</span>
                    {row.institution_name && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{row.institution_name}</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span>
                      {num(row.sessions)} {row.sessions === 1 ? "session" : "sessions"}
                    </span>
                  </span>
                }
                trailing={
                  <div className="text-right">
                    <p className="text-[17px] font-semibold tabular-nums text-ink-900">
                      {num(row.flagged)}
                    </p>
                    <p className="text-xs tabular-nums text-ink-500">{pct(row.flag_rate, 0)} of sessions</p>
                  </div>
                }
                onClick={() => navigate(`/exams/${row.exam_id}/results`)}
              />
            ))}
          </ul>
        </DashboardTable>
      </div>
    </div>
  );
}
