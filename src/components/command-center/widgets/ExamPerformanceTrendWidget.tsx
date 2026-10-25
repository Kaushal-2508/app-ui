import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { useDashboardClassList, useExamTrend } from "@/hooks/dashboard/useDashboardData";
import { DashClassFilter } from "@/components/command-center/dash/primitives";
import {
  TREND_RANGE_OPTIONS,
  TREND_RANGE_PHRASE,
  type TrendRange,
} from "@/hooks/useStudentClassComparison";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";
import { useTeacherClassSubjects } from "@/hooks/dashboard/useTeacherDashboardData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExamDeliveryModes } from "@/hooks/useExamDeliveryModes";
import { OfflineMarksSheet } from "@/components/exam/OfflineMarksSheet";
import { toastError } from "@/lib/toast";
import type { ExamTrendItem } from "@/hooks/dashboard/types";
import { WidgetCard } from "@/components/command-center/WidgetCard";

const CAPTION =
  "Each bar is one test. If bars are getting taller over time, marks are improving across the school.";
const CLICK_HINT = "Tap any bar to see that exam's full results.";

// Distinction colors only — NOT severity. Four distinct non-red/amber/green-coded
// chart tokens mapped to exam type so the eye can group like exams.
const TYPE_COLORS: Record<string, string> = {
  term: "hsl(var(--chart-4))", // blue
  unit: "hsl(var(--chart-1))", // teal
  weekly: "hsl(var(--brand-secondary))", // lilac
};
const UNSPECIFIED_COLOR = "hsl(var(--ink-400))"; // neutral grey for unspecified/other

function colorForType(examType: string): string {
  return TYPE_COLORS[examType?.toLowerCase()] ?? UNSPECIFIED_COLOR;
}

interface ChartRow extends ExamTrendItem {
  label: string;
  axisLabel: string;
  avgValue: number;
}

function shortTitle(title: string): string {
  return title.length > 14 ? `${title.slice(0, 13)}…` : title;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Axis form: no year, so eight of them fit on a phone. */
function axisDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

interface ExamTooltipProps {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}

function ExamTooltip({ active, payload }: ExamTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-surface-stroke bg-surface-card px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-ink-900">{row.title}</p>
      <p className="mt-1 text-ink-600">{formatDate(row.exam_date)}</p>
      <p className="text-ink-600">
        Participation: <span className="font-medium text-ink-900">{row.participation}</span>
      </p>
      <p className="text-ink-600">
        Average:{" "}
        <span className="font-medium text-ink-900">
          {row.avg_pct != null ? `${row.avg_pct}%` : "N/A"}
        </span>
      </p>
    </div>
  );
}

export function ExamPerformanceTrendWidget() {
  const navigate = useNavigate();
  const scope = useDashboardScope();

  // Options come from the teacher's own (class, subject) assignment pairs — the
  // same source that scopes the RPC — so a picker can never offer something the
  // query would reject.
  const pairsQuery = useTeacherClassSubjects();
  const pairs = React.useMemo(() => pairsQuery.data?.pairs ?? [], [pairsQuery.data]);

  const classOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pairs) m.set(p.class_id, p.section ? `${p.class_name} ${p.section}` : p.class_name);
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [pairs]);

  const subjectOptions = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pairs) m.set(p.subject_id, p.subject_name);
    return Array.from(m, ([id, label]) => ({ id, label }));
  }, [pairs]);

  const [classId, setClassId] = React.useState<string | null>(null);
  const [subjectId, setSubjectId] = React.useState<string | null>(null);

  // Each picker appears only when there is a real choice to make: a teacher with
  // one class and one subject sees no chrome at all.
  const showClass = scope === "teacher" && classOptions.length > 1;
  const showSubject = scope === "teacher" && subjectOptions.length > 1;

  // The admin's class picker is a different list from the teacher's: every
  // class in the school rather than the caller's own pairs. Offered only at
  // institution scope, because dash_scoped_exam_trend (coordinators) still
  // takes p_limit alone and a picker there would silently do nothing.
  const schoolClasses = useDashboardClassList();
  const showSchoolClass = scope === "institution";

  // The five windows come from TREND_RANGE_OPTIONS, which the student
  // dashboard's Score Trend and Attendance cards already use. Reusing the same
  // tokens means "Last 3 months" means the same thing to an admin as to a
  // student, which is what that file calls itself the single source of truth
  // for. Institution scope only: the teacher and coordinator RPCs take no
  // window, so a picker there would look live and do nothing.
  //
  // Opens on the current month. The card is read as "how are we doing right
  // now", and the longer windows are there to answer "and how does that compare"
  // once the question has been asked.
  const [range, setRange] = React.useState<TrendRange>("tm");
  const showRange = scope === "institution";

  const trend = useExamTrend(
    8,
    showClass || showSchoolClass ? classId : null,
    showSubject ? subjectId : null,
    showRange ? range : null,
  );

  const chartRows: ChartRow[] = React.useMemo(() => {
    const items = trend.data ?? [];
    // Chronological — RPC returns newest-first by exam_date for the limit window;
    // sort ascending so time flows left → right.
    return items
      .filter((e) => e.avg_pct != null)
      .slice()
      .sort((a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime())
      .map((e) => ({
        ...e,
        label: shortTitle(e.title),
        axisLabel: axisDate(e.exam_date),
        avgValue: e.avg_pct as number,
      }));
  }, [trend.data]);

  // ── Where a bar goes ───────────────────────────────────────────────────────
  // An offline exam has no attempts to evaluate, so /exams/:id/results renders
  // its whole class as 0 out of the paper's marks with "0/0 evaluated". Bars
  // now route the way the My Exams list already does: offline exams open the
  // marks window, hybrid goes to hybrid evaluation, online keeps the results
  // page.
  const examIds = React.useMemo(() => chartRows.map((r) => r.exam_id), [chartRows]);
  const { map: deliveryMap, ensure: ensureDelivery } = useExamDeliveryModes(examIds);
  const [offlineExam, setOfflineExam] = React.useState<{
    id: string;
    isResultsOnly: boolean;
  } | null>(null);
  const openingRef = React.useRef(false);
  const queryClient = useQueryClient();

  const handleBarClick = React.useCallback(
    async (examId: string) => {
      if (openingRef.current) return; // single-flight: a double tap resolves once
      let delivery = deliveryMap?.[examId];
      if (!delivery) {
        openingRef.current = true;
        try {
          delivery = (await ensureDelivery())[examId];
        } catch (err) {
          toastError(err, {
            fallback: "Couldn't open that exam.",
            context: "examTrendBarClick",
          });
          return;
        } finally {
          openingRef.current = false;
        }
      }
      // Still unknown means the row is not readable (an exam outside the
      // caller's institution should never be plotted); the results page is the
      // safe destination and states its own error.
      if (delivery?.mode === "offline") {
        setOfflineExam({ id: examId, isResultsOnly: delivery.isResultsOnly });
      } else if (delivery?.mode === "hybrid") {
        navigate(`/evaluations/hybrid?examId=${examId}`);
      } else {
        navigate(`/exams/${examId}/results`);
      }
    },
    [deliveryMap, ensureDelivery, navigate],
  );

  const handleOfflineOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) return;
      setOfflineExam(null);
      // Marks may have been entered or published in the sheet, which moves the
      // very averages this chart plots. The offline hooks only invalidate their
      // own keys, so refresh the trend on the way out.
      queryClient.invalidateQueries({ queryKey: ["dash", scope, "examTrend"] });
    },
    [queryClient, scope],
  );

  // One bar is a fact, not a trend, but hiding it behind "not enough exams"
  // when the school HAS a graded exam reads as a broken card. The attendance
  // chart had the same arbitrary floor and the same complaint.
  const isEmpty = !trend.isLoading && !trend.isError && chartRows.length === 0;
  // Zero rows and "rows that carry no average" are different problems and want
  // different answers: the first means nothing is published, the second means
  // the papers are published but nothing has been graded yet. A single generic
  // "not enough exams" for both made a grading backlog look like an empty
  // school.
  const returnedRows = trend.data?.length ?? 0;
  // The two pickers draw from different lists (the school's classes for an
  // admin, the caller's own pairs for a teacher) and never both render, so the
  // name is looked up in whichever one is active.
  const narrowedName = !classId
    ? null
    : showSchoolClass
      ? (() => {
          const c = (schoolClasses.data ?? []).find((x) => x.id === classId);
          return c ? [c.name, c.section].filter(Boolean).join(" ") : null;
        })()
      : classOptions.find((c) => c.id === classId)?.label ?? null;
  // Once a window can be picked, "no graded exams yet" is usually a lie: the
  // school has plenty, just none inside the chosen months. Naming the window is
  // the difference between a filter the reader can widen and a card that looks
  // broken.
  // TREND_RANGE_PHRASE is written to slot into a sentence ("in the last 3
  // months", "this month"), so it needs no preposition of its own.
  const scopePhrase = [
    narrowedName ? `for ${narrowedName}` : null,
    showRange ? TREND_RANGE_PHRASE[range] : null,
  ]
    .filter(Boolean)
    .join(" ");
  const emptyCopy =
    returnedRows > 0
      ? {
          title: "No exam has an average yet",
          description:
            "These exams are published but nothing has been graded, so there is no percentage to plot. Averages appear as results are entered.",
        }
      : scopePhrase
        ? {
            title: `No graded exams ${scopePhrase}`,
            description: `Nothing published and graded in this window${
              narrowedName ? " for this class" : ""
            }. Widen the date range${narrowedName ? " or pick another class" : ""} to see more.`,
          }
        : {
            title: "No graded exams yet",
            description:
              "This appears once an exam has been published and its results recorded.",
          };

  const headerSlot =
    showClass || showSubject || showSchoolClass || showRange ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {showRange && (
          <Select value={range} onValueChange={(v) => setRange(v as TrendRange)}>
            <SelectTrigger className="h-9 w-[160px] rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TREND_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {showSchoolClass && (
          <DashClassFilter
            value={classId}
            onChange={setClassId}
            classes={schoolClasses.data}
            className="h-9 rounded-lg text-sm"
          />
        )}
        {showClass && (
          <Select value={classId ?? "all"} onValueChange={(v) => setClassId(v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-[150px] rounded-lg text-sm">
              <SelectValue placeholder="All my classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my classes</SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {showSubject && (
          <Select value={subjectId ?? "all"} onValueChange={(v) => setSubjectId(v === "all" ? null : v)}>
            <SelectTrigger className="h-9 w-[150px] rounded-lg text-sm">
              <SelectValue placeholder="All my subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my subjects</SelectItem>
              {subjectOptions.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>{sub.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    ) : undefined;

  return (
    <>
      <WidgetCard
        title="Exam performance over time"
        caption={CAPTION}
        clickHint={CLICK_HINT}
        headerSlot={headerSlot}
        isLoading={trend.isLoading}
        isError={trend.isError}
        onRetry={() => trend.refetch()}
        isEmpty={isEmpty}
        emptyTitle={emptyCopy.title}
        emptyDescription={emptyCopy.description}
      >
        <div style={{ width: "100%", height: 256 }}>
          <ResponsiveContainer>
            <BarChart data={chartRows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--surface-stroke))" />
              {/* Dates, not titles. Exam names are arbitrary length -- eight of
                  them truncated to 14 characters still overlapped into an
                  unreadable smear ("DEMO — SDEMO — CoDEMO..."), and interval={0}
                  forced every one to render on top of its neighbour. This is a
                  chart of performance over TIME, so the time is what the axis
                  should carry; the full title, date, participation and average
                  all stay in the tooltip. The category is keyed on exam_id so
                  two exams sharing a date still get their own bar, and
                  minTickGap lets Recharts drop labels rather than overlap them
                  on a narrow screen. */}
              <XAxis
                dataKey="exam_id"
                tickFormatter={(id: string) =>
                  chartRows.find((r) => r.exam_id === id)?.axisLabel ?? ""
                }
                tick={{ fontSize: 11, fill: "hsl(var(--ink-500))" }}
                minTickGap={8}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "hsl(var(--ink-500))" }}
                tickFormatter={(v: number) => `${v}%`}
                width={36}
              />
              <Tooltip content={<ExamTooltip />} cursor={{ fill: "hsl(var(--ink-400) / 0.06)" }} />
              <Bar
                dataKey="avgValue"
                radius={[6, 6, 0, 0]}
                maxBarSize={44}
                cursor="pointer"
                // Every filter change refetches and remounts these bars, and
                // Recharts' 1.5s grow-from-zero would replay on each one -- so a
                // 95% bar spends a second looking like a 37% bar. On a chart with
                // two pickers above it, an instant redraw is the honest one.
                isAnimationActive={false}
                onClick={(entry: ChartRow) => {
                  if (entry?.exam_id) void handleBarClick(entry.exam_id);
                }}
              >
                {chartRows.map((row) => (
                  <Cell key={row.exam_id} fill={colorForType(row.exam_type)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </WidgetCard>

      {/* Outside WidgetCard: its children render only in the success state, and
          the sheet must survive the chart going empty or reloading under it. */}
      <OfflineMarksSheet
        examId={offlineExam?.id ?? null}
        isResultsOnly={offlineExam?.isResultsOnly ?? false}
        onOpenChange={handleOfflineOpenChange}
      />
    </>
  );
}
