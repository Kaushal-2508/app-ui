import { useMemo } from "react";
import { BookOpen } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useStudentChapterAnalysis,
  type ChapterAnalysisRow,
} from "@/hooks/useStudentClassComparison";
import { compareToClassAverage, type ComparisonVerdict } from "@/lib/performanceLabels";
import { cn } from "@/lib/utils";

/** Width reserved per chapter. Sized for the axis label rather than the bar:
 *  chapter names are shown in full over two lines, so the column has to be wide
 *  enough for ~MAX_LABEL_CHARS of 10px text. Past this the chart scrolls
 *  sideways rather than squeezing names into ellipses. */
const MIN_PX_PER_CHAPTER = 92;

/** Roughly what fits on one line at fontSize 10 inside MIN_PX_PER_CHAPTER. */
const MAX_LABEL_CHARS = 16;
const MAX_LABEL_LINES = 2;

/**
 * Same verdict vocabulary and same colours as the dashboard's Subject snapshot,
 * so a student meets ONE colour language across the product: orange means behind
 * the class, teal means level with it, green means ahead. Recharts needs real
 * colour values rather than Tailwind classes, so these mirror the snapshot's
 * `bg-brand-accent` / `bg-brand-primary` / `bg-emerald-500` / `bg-ink-400`.
 * Verdicts come from compareToClassAverage(), the same ±5 band engine — never a
 * second threshold invented here.
 */
const VERDICT_META: Record<
  ComparisonVerdict,
  { label: string; fill: string; dot: string }
> = {
  below: { label: "Needs attention", fill: "hsl(var(--brand-accent))", dot: "bg-brand-accent" },
  at_par: { label: "About the same as class", fill: "hsl(var(--brand-primary))", dot: "bg-brand-primary" },
  above: { label: "Ahead of class", fill: "#10b981", dot: "bg-emerald-500" },
  unknown: { label: "No class comparison yet", fill: "hsl(var(--ink-400))", dot: "bg-ink-400" },
};

/** Legend order matches the snapshot's group order (weakest first). */
const VERDICT_ORDER: ComparisonVerdict[] = ["below", "at_par", "above", "unknown"];

/** The class-average marker, matching the snapshot's dark tick. */
const MARKER_STROKE = "hsl(var(--ink-900))";

type ChapterRow = ChapterAnalysisRow & { verdict: ComparisonVerdict };

interface ChapterAnalysisChartProps {
  subject: string;
  /** Applied filters, mirrored from the results page so both charts agree. */
  examType?: string | null;
  from?: string | null;
  lastN?: number | null;
  /** Plain-language description of the window, e.g. "unit tests, last 3 months". */
  windowLabel: string;
}

/**
 * Chapter-wise analysis for one subject: a bar for the student's average per
 * chapter, coloured by how it compares to the class, with the class average
 * drawn as a dotted rule across that same bar.
 *
 * The class average deliberately does NOT get a bar of its own. Doubling the
 * marks doubles the width every chapter needs, and a subject with fifteen
 * chapters then becomes a scroll marathon. As a rule across the student's own
 * bar it costs no horizontal space and reads as what it is: the line you are
 * above or below.
 *
 * Chapters are tagged on the EXAM, not on individual questions, so a chapter's
 * score is the average of the student's results on the tests covering it, and a
 * test spanning three chapters credits its score to all three. That's the honest
 * ceiling of exam-level tagging — the test count rides along in the tooltip so a
 * chapter measured once never reads as settled.
 *
 * Recharts wrapper carries an explicit inline height (a Tailwind h-NN class
 * collapses to 0 on mobile — §20).
 */
export function ChapterAnalysisChart({
  subject,
  examType = null,
  from = null,
  lastN = null,
  windowLabel,
}: ChapterAnalysisChartProps) {
  const { data, isLoading, isError } = useStudentChapterAnalysis({
    subject,
    examType,
    from,
    lastN,
  });

  const rows = useMemo<ChapterRow[]>(
    () =>
      (data?.chapters ?? []).map((c) => ({
        ...c,
        verdict: compareToClassAverage(c.student_avg, c.class_avg).verdict,
      })),
    [data],
  );

  // Only the verdicts actually on screen get a legend entry, the way the
  // snapshot only renders groups that have subjects in them.
  const presentVerdicts = useMemo(
    () => VERDICT_ORDER.filter((v) => rows.some((r) => r.verdict === v)),
    [rows],
  );

  const nExams = data?.n_exams ?? 0;
  const anySuppressed = rows.some((r) => r.class_avg == null);
  const minWidth = Math.max(rows.length * MIN_PX_PER_CHAPTER, 280);
  const showChart = !isLoading && !isError && rows.length > 0;

  return (
    <section className="surface-card frosted-shadow rounded-card ring-1 ring-ink-400/15 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <BookOpen className="h-4 w-4 text-brand-primary" />
          Chapter analysis
        </h3>
        {showChart && (
          <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
            <span className="h-3 w-[2px] rounded-full bg-ink-900" aria-hidden />
            Class average
          </span>
        )}
      </div>

      {showChart && presentVerdicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {presentVerdicts.map((v) => (
            <span key={v} className="flex items-center gap-2">
              <span
                className={cn("h-2 w-2 shrink-0 rounded-full", VERDICT_META[v].dot)}
                aria-hidden
              />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">
                {VERDICT_META[v].label}
              </span>
              <span className="text-[11px] tabular-nums text-ink-400">
                {rows.filter((r) => r.verdict === v).length}
              </span>
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-[240px] w-full rounded-2xl" />
      ) : isError ? (
        /* Error before empty (§6): a failed read must not read as "no chapters". */
        <p className="text-sm text-ink-600">
          Couldn't load the chapter breakdown. Please try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-600">
          {nExams === 0
            ? "No tests in this subject for the chosen filters."
            : "Chapters weren't recorded for these tests. Ask your teacher which chapter each test covered."}
        </p>
      ) : (
        <>
          {/* Wide content scrolls inside its own container so the page never
              scrolls sideways (§20). */}
          <div className="overflow-x-auto">
            <div style={{ width: "100%", minWidth, height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-surface-stroke" />
                  <XAxis
                    dataKey={(row: ChapterRow) => row.chapter}
                    tick={<ChapterTick />}
                    /* Room for two lines of label. */
                    height={40}
                    interval={0}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 20, 40, 60, 80, 100]}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(val) => `${val}%`}
                    className="fill-ink-500"
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--ink-400))", fillOpacity: 0.12 }}
                    content={<ChapterTooltip />}
                  />
                  <Bar
                    dataKey="student_avg"
                    name="You"
                    maxBarSize={32}
                    /* Transparent full-height backdrop: it hands the custom shape
                       the plot geometry it needs to place the class marker, and
                       widens the hover target to the whole column. */
                    background={{ fill: "transparent" }}
                    shape={<ChapterBar />}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <p className="text-xs text-ink-500">
            Each chapter averages the tests that covered it ({windowLabel}). The dotted line on a
            bar is your class average for that chapter, and the bar colour is how you compare to
            it. A test spanning several chapters counts towards each one.
            {anySuppressed &&
              " Class average appears once at least 3 classmates have published results."}
          </p>
        </>
      )}
    </section>
  );
}

interface ChapterBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChapterRow;
  /** Full-height column rect supplied by Bar's `background` prop. */
  background?: { x: number; y: number; width: number; height: number };
}

/**
 * The student's bar, tinted by verdict, plus a dotted class-average rule.
 *
 * The rule is positioned from the column's full-height backdrop rather than from
 * the bar itself, because a bar's own height carries no usable scale when the
 * student scored 0. It intentionally overhangs the bar by a few pixels so it
 * still reads as a marker when the class average sits above the bar's top.
 */
function ChapterBar({ x = 0, y = 0, width = 0, height = 0, payload, background }: ChapterBarProps) {
  const classAvg = payload?.class_avg ?? null;
  const studentAvg = payload?.student_avg ?? null;
  const fill = VERDICT_META[payload?.verdict ?? "unknown"].fill;

  let zeroY: number | null = null;
  let pxPerPct: number | null = null;
  if (background && background.height > 0) {
    zeroY = background.y + background.height;
    pxPerPct = background.height / 100;
  } else if (studentAvg && studentAvg > 0 && height > 0) {
    // Fallback: derive the scale from the bar we were given.
    zeroY = y + height;
    pxPerPct = height / studentAvg;
  }

  const markerY =
    classAvg != null && zeroY != null && pxPerPct != null ? zeroY - classAvg * pxPerPct : null;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} ry={4} fill={fill} />
      {markerY != null && (
        <line
          x1={x - 4}
          x2={x + width + 4}
          y1={markerY}
          y2={markerY}
          stroke={MARKER_STROKE}
          strokeWidth={2}
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

/** Custom tooltip: with one bar per chapter the class average no longer has a
 *  series of its own, so it is stated here explicitly alongside the verdict. */
function ChapterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChapterRow }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  const meta = VERDICT_META[row.verdict];

  return (
    <div className="rounded-xl border border-border bg-card p-2.5 text-xs shadow-md">
      <p className="font-medium text-ink-900">{row.chapter}</p>
      <p className="mt-1 tabular-nums text-ink-700">
        You: {row.student_avg == null ? "N/A" : `${row.student_avg.toFixed(1)}%`}
      </p>
      <p className="tabular-nums text-ink-700">
        Class average: {row.class_avg == null ? "not shown yet" : `${row.class_avg.toFixed(1)}%`}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-ink-600">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
        {meta.label}
      </p>
      <p className="mt-1 text-ink-500">
        {row.n_tests} {row.n_tests === 1 ? "test" : "tests"}
      </p>
    </div>
  );
}

/**
 * Axis tick that shows the chapter name in full, wrapped onto up to two lines.
 *
 * Recharts' built-in tick is a single <text> run, so a long chapter name either
 * overflows into its neighbours or gets clipped. Splitting on word boundaries
 * into tspan-equivalent lines keeps "The Last Lesson" readable instead of
 * "The Last Le...". The tooltip still carries the untruncated title for the rare
 * name too long even for two lines.
 */
function ChapterTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}) {
  const lines = wrapLabel(payload?.value ?? "", MAX_LABEL_CHARS, MAX_LABEL_LINES);
  return (
    <g transform={`translate(${x},${y})`}>
      {lines.map((line, i) => (
        <text
          key={`${line}-${i}`}
          x={0}
          y={0}
          dy={12 + i * 11}
          textAnchor="middle"
          fontSize={10}
          className="fill-ink-500"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/**
 * Break a label onto at most `maxLines` lines of at most `maxChars` each,
 * preferring word boundaries. A single word wider than a line is hard-split
 * rather than allowed to overflow, and anything that still does not fit ends in
 * an ellipsis so the label never silently misrepresents the chapter.
 */
function wrapLabel(label: string, maxChars: number, maxLines: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  let i = 0;

  while (i < words.length && lines.length < maxLines) {
    const word = words[i];

    if (!current && word.length > maxChars) {
      lines.push(word.slice(0, maxChars));
      words[i] = word.slice(maxChars);
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      i += 1;
    } else {
      lines.push(current);
      current = "";
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }

  // Anything left over means the name did not fit; mark the truncation.
  const truncated = i < words.length || current.length > 0;
  if (truncated && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  return lines;
}