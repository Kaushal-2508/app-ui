import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { useSchoolSubjectPerformance } from "@/hooks/dashboard/useAdminDashboardData";
import { useSubjectPerformance } from "@/hooks/dashboard/useDashboardData";
import {
  useDash5ExamPapers, useDash5Tree, type Dash5Band, type Dash5Row,
} from "@/hooks/dashboard/useDash5";

import type { AssignScope } from "./AssignPanel";
import { ChartTip, TipHit, TipLine, TipTitle } from "./ChartTip";
import { useChartTip } from "./useChartTip";
import { AssignDrawer, PaperDrawer } from "./Dash5Drawers";
import { BAND, pct0, pct1 } from "./format";
import {
  ChoiceSelect, FilterGroup, FilterLabel, FilterSelect, FilterStrip,
} from "./FilterBar";
import { useScopeFilter } from "./useScopeFilter";
import { useWingDrill } from "./useWingDrill";
import {
  BarRow, BarsH, Crumbs, LevelTag, TradTable, V5Card, V5CardHead, V5Empty,
  V5Error, V5Loading, tdBase,
} from "./primitives";

/**
 * Academics. Three of these four cards read the SAME dash5_tree the Overview
 * table reads, at whatever level the reader has drilled to, so a bar and the
 * row it came from are the same number by construction rather than by luck.
 */

const bandColor = (b: Dash5Band | null) => `hsl(var(${b ? BAND[b].varName : "--ink-400"}))`;

/**
 * The band for a SCORE, using dash5_band's own cuts so a colour means the same
 * thing here as everywhere else on the page.
 *
 * This chart plots average score, but it took its colour from the COMPOSITE
 * band, which is only 45% score and 55% coverage, attendance and lesson plans.
 * In September, when coverage is legitimately 13%, that pushed every wing into
 * Attention however well it was scoring, so a four-colour legend sat above four
 * identical red bars. A bar's colour now encodes the number the bar is showing.
 */
const SCORE_CUTS: { band: Dash5Band; min: number }[] = [
  { band: "exc", min: 84 },
  { band: "good", min: 75.5 },
  { band: "watch", min: 66 },
];
const scoreBand = (v: number | null | undefined): Dash5Band | null =>
  v == null ? null : SCORE_CUTS.find((c) => v >= c.min)?.band ?? "att";
const bandRange = (b: Dash5Band) => {
  const i = SCORE_CUTS.findIndex((c) => c.band === b);
  if (i === -1) return "below 66%";
  if (i === 0) return `${SCORE_CUTS[0].min}%+`;
  return `${SCORE_CUTS[i].min} to ${SCORE_CUTS[i - 1].min}%`;
};

/* Column-chart geometry, from the reference's barChart: a 46px gutter for the
   axis labels, and 88px under the plot for the category labels, which are
   TILTED. Horizontal labels had to be cut to fit their column, so "Social
   Science" read "Social Sc..." and "Computer Science" read "Computer ...".
   Tilting them costs vertical space and cuts nothing. The plot height itself is
   unchanged at 196. */
const CW = 640, CH = 312, CL = 46, CR = 14, CT = 16, CB = 100;
const CPH = CH - CT - CB;
const colY = (v: number) => CT + CPH - (v / 100) * CPH;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** How far the category labels lean. The d3 idiom: rotate anti-clockwise and
 *  anchor at the END, so the label finishes at its tick and trails down-left. */
const LABEL_TILT = -40;

/* ------------------------------------------- class-wise average (bars) ---- */

export function Dash5ClassPerformance() {
  // Opens inside the wing for a coordinator, who has only one, so the first
  // bar chart is their classes rather than a single wing-wide column.
  const { drill, setDrill, reset, canGoUp, rootLabel } = useWingDrill();

  const level = drill.classId ? "subjects" : drill.wingId ? "classes" : "wings";
  const q = useDash5Tree(level, drill.wingId, drill.classId);

  const rows = useMemo(
    () => (q.data?.rows ?? []).filter((r) => r.accuracy != null)
            .slice().sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)),
    [q.data],
  );
  const schoolAvg = q.data?.total?.accuracy ?? null;

  const onPick = (r: Dash5Row) => {
    if (level === "wings") setDrill({ wingId: r.id, wingName: r.name, classId: null, classLabel: null });
    else if (level === "classes") setDrill((d) => ({ ...d, classId: r.id, classLabel: r.name }));
  };

  const tip = useChartTip(CW, CH);

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[260px]">
          <Crumbs
            items={[
              { label: rootLabel, onClick: canGoUp ? reset : undefined },
              ...(drill.wingId && rootLabel === "All wings" ? [{ label: drill.wingName ?? "Wing",
                   onClick: drill.classId ? () => setDrill((d) => ({ ...d, classId: null, classLabel: null })) : undefined }] : []),
              ...(drill.classId ? [{ label: drill.classLabel ?? "Class" }] : []),
            ]}
          />
          {/* Counted only once the level has landed, or it reads "All 0 wings"
              beside the spinner. */}
          {q.data && (
            <p className="mt-1.5 text-xs font-medium text-ink-500">
              {level === "wings"
                ? `All ${rows.length} wings`
                : level === "classes"
                  ? `${rows.length} classes in ${drill.wingName ?? "this wing"}`
                  : `${rows.length} assessed subjects in ${drill.classLabel ?? "this class"}`}
              {schoolAvg != null && ` · ${level === "subjects" ? "class" : "school"} average ${pct1(schoolAvg)}`}
              {level !== "subjects" && ". Click a bar to open the level below it."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(["exc", "good", "watch", "att"] as Dash5Band[]).map((b) => (
            <span key={b} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-600">
              <i className="inline-block h-[10px] w-[10px] rounded-[3px]"
                 style={{ background: bandColor(b) }} aria-hidden />
              {BAND[b].label}
              <span className="font-medium text-ink-400">{bandRange(b)}</span>
            </span>
          ))}
        </div>
      </V5CardHead>

      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load performance." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="Nothing here has a graded paper yet"
            sub="A unit with no paper is left out rather than drawn at zero."
          />
        ) : (
          <>
            {/* The reference's column chart, to its geometry: 640x250 with a
                46px gutter for the axis, drawn as one SVG so the bars, the
                gridlines and the average line share a single coordinate space
                and cannot drift apart at any width. `mx-auto` is what centres
                it in the card, matching `svg.chart { margin: 0 auto }`. */}
            <div ref={tip.wrapRef} className="relative">
            <svg
              ref={tip.svgRef}
              viewBox={`0 0 ${CW} ${CH}`}
              className="mx-auto block h-auto w-full max-w-[720px] overflow-visible"
              role="img"
              aria-label={`Average score for each of ${rows.length} ${level}`}
            >
              {[0, 1, 2, 3, 4].map((t) => {
                const v = (100 * t) / 4;
                const y = colY(v);
                return (
                  <g key={t}>
                    <line x1={CL} x2={CW - CR} y1={y} y2={y} stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                    <text x={CL - 8} y={y + 3.5} textAnchor="end" className="fill-ink-400 text-[10.5px] font-semibold">
                      {v}%
                    </text>
                  </g>
                );
              })}
              <line x1={CL} x2={CW - CR} y1={colY(0)} y2={colY(0)}
                    stroke="hsl(var(--ink-400))" strokeWidth={1} opacity={0.55} />

              {schoolAvg != null && (
                <>
                  <line
                    x1={CL} x2={CW - CR} y1={colY(clamp(schoolAvg))} y2={colY(clamp(schoolAvg))}
                    stroke="hsl(var(--brand-secondary))" strokeWidth={1.5} opacity={0.6}
                  />
                  <text
                    x={CL + 5} y={colY(clamp(schoolAvg)) - 6}
                    className="text-[10.5px] font-bold"
                    style={{ fill: "hsl(var(--brand-secondary))" }}
                  >
                    {level === "subjects" ? "class average" : "school average"} {pct1(schoolAvg)}
                  </text>
                </>
              )}

              {rows.map((r, i) => {
                const step = (CW - CL - CR) / rows.length;
                const bw = Math.min(30, step * 0.56);
                const cx = CL + step * (i + 0.5);
                const y = colY(clamp(r.accuracy ?? 0));
                const h = colY(0) - y;
                const rad = Math.min(4, h / 2);
                const clickable = level !== "subjects";
                return (
                  <g
                    key={r.id}
                    className={clickable ? "cursor-pointer" : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onPick(r) : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r); }
                    } : undefined}
                  >
                    {/* Rounded at the tip, square on the baseline, so a short
                        bar does not turn into a lozenge floating off the axis. */}
                    <path
                      d={`M${cx - bw / 2} ${colY(0)} L${cx - bw / 2} ${y + rad} Q${cx - bw / 2} ${y} ${cx - bw / 2 + rad} ${y} L${cx + bw / 2 - rad} ${y} Q${cx + bw / 2} ${y} ${cx + bw / 2} ${y + rad} L${cx + bw / 2} ${colY(0)} Z`}
                      fill={bandColor(scoreBand(r.accuracy))}
                    />
                    <TipHit
                      x={cx - step / 2} y={CT} width={step} height={colY(0) - CT}
                      onShow={() => tip.show(cx, y, (
                        <>
                          <TipTitle>{r.name}</TipTitle>
                          <TipLine>
                            Average score {pct1(r.accuracy)} ·{" "}
                            {scoreBand(r.accuracy) ? BAND[scoreBand(r.accuracy)!].label : "not assessed"}
                          </TipLine>
                          <TipLine>
                            {level === "subjects"
                              ? `${r.teacher ?? "Unassigned"} · ${r.papers ?? 0} papers`
                              : `Coverage ${pct1(r.syllabus_pct)} · ${(r.students ?? 0).toLocaleString()} students`}
                          </TipLine>
                          {level !== "subjects" && <TipLine dim>click to open</TipLine>}
                        </>
                      ))}
                      onHide={tip.hide}
                      onClick={clickable ? () => onPick(r) : undefined}
                    />
                    {/* Anchored at the tick and tilted, so the full name is
                        always there however narrow the column gets.

                        A short STRAIGHT tick drops from the baseline to where
                        the label starts. Tilted text drifts away from its own
                        column, and without the tick the eye reads a label
                        against the bar to its right. */}
                    {(() => {
                      const ly = colY(0) + 26;
                      return (
                        <>
                          <line
                            x1={cx} y1={colY(0) + 1} x2={cx} y2={ly - 15}
                            stroke="hsl(var(--ink-400))" strokeWidth={1.5} opacity={0.65}
                          />
                          <text
                            transform={`rotate(${LABEL_TILT} ${cx} ${ly})`}
                            textAnchor="end"
                            className="text-[10.5px] font-semibold"
                          >
                            <tspan x={cx} y={ly} className="fill-ink-600">{r.name}</tspan>
                            <tspan x={cx} dy={11} className="fill-ink-400">
                              {level === "wings"
                                ? `${r.class_count ?? 0} cls`
                                : r.papers != null ? `${r.papers} papers` : "no papers"}
                            </tspan>
                          </text>
                        </>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
            <ChartTip tip={tip.tip} />
            </div>
          </>
        )}
      </div>
    </V5Card>
  );
}

/**
 * What a dot on the scatter says. The reference prints five lines here: which
 * paper, when and who taught it, how it went, who sat it, and that it opens.
 */
function paperTip(r: {
  subject_name: string | null; class_label: string; cycle: string | null;
  teacher: string | null; date: string; avg_pct: number | null;
  pass_pct: number | null; top_pct: number | null; appeared: number;
  roster: number; mode: string; total_marks: number | null;
}) {
  return (
    <>
      <TipTitle>
        {r.subject_name ?? "Subject"}{r.cycle ? ` · ${r.cycle}` : ""}
      </TipTitle>
      <TipLine>
        {new Date(r.date).toLocaleDateString()} · {r.class_label}
        {r.teacher ? ` · ${r.teacher}` : ""}
      </TipLine>
      <TipLine>
        Average <b className="text-ink-900">{pct1(r.avg_pct)}</b>
        {r.pass_pct != null && ` · pass rate ${pct0(r.pass_pct)}`}
        {r.top_pct != null && ` · top ${pct0(r.top_pct)}`}
      </TipLine>
      <TipLine>
        {r.appeared} of {r.roster} appeared · {r.mode}
        {r.total_marks != null && ` · ${r.total_marks} marks`}
      </TipLine>
      <TipLine dim>click to open the paper</TipLine>
    </>
  );
}

/* --------------------------------------------- exam performance over time - */

/** Windows the reference offers, as days back from today. 0 = the whole session. */
/** Sentinel for "the two date inputs decide", the reference's custom window. */
const CUSTOM = -1;

const PERIODS = [
  { v: 0, label: "Session to date" },
  { v: 30, label: "Last 30 days" },
  { v: 60, label: "Last 60 days" },
  { v: 90, label: "Last 90 days" },
  { v: CUSTOM, label: "Custom dates" },
];

export function Dash5ExamScatter() {
  const { wingId, wingLocked, classId, setClassId, chooseWing, wingOptions, classOptions } =
    useScopeFilter();
  // Thirty days, not the whole session. A full session puts every paper of the
  // year on one plot, where the recent weeks a principal can still act on are
  // squeezed into the right-hand edge. The session is still one click away.
  const [period, setPeriod] = useState(30);
  // Which paper the detail drawer is showing. A dot on its own can only ever
  // say four things in a tooltip; the drawer behind it carries the distribution
  // and the students at each end.
  const [paper, setPaper] = useState<{ examId: string; classId: string } | null>(null);
  // The reference's two date inputs. They only bite on the Custom period, so
  // picking a preset can never leave an old date silently pinned.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asTable, setAsTable] = useState(false);
  const tip = useChartTip(640, 300);
  // Computed, not stored: a stored date would go stale the moment the tab is
  // left open across midnight.
  const from = useMemo(() => {
    if (period === CUSTOM) return customFrom || null;
    if (!period) return null;
    const d = new Date();
    d.setDate(d.getDate() - period);
    return d.toISOString().slice(0, 10);
  }, [period, customFrom]);
  const to = period === CUSTOM ? customTo || null : null;
  const q = useDash5ExamPapers(wingId, classId, from, to);
  // What the date inputs show. The RPC reports the window it actually used, so
  // a preset like "Session to date" fills them in rather than leaving them
  // blank next to a chart that clearly has a start and an end.
  const effFrom = (period === CUSTOM ? customFrom : "") || q.data?.from || "";
  const effTo = (period === CUSTOM ? customTo : "") || q.data?.to || "";
  // Memoised so the geometry below is not recomputed on every render by a
  // fresh [] from the ?? fallback.
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);

  const geom = useMemo(() => {
    if (rows.length === 0) return null;
    const xs = rows.map((r) => new Date(r.date).getTime());
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const span = Math.max(1, x1 - x0);
    const pts = rows.map((r, i) => ({
      x: (new Date(r.date).getTime() - x0) / span,
      y: r.avg_pct ?? 0,
      r,
      k: `${r.exam_id}-${r.class_id}-${r.subject_id}-${i}`,
    }));

    // The y-axis is ZOOMED to the data, the way the reference does it. A fixed
    // 0-100 axis squashes a school whose papers all land between 60 and 95 into
    // the top third of the plot, and the trend it is meant to show disappears.
    // Rounded out to tens and widened until the span divides by 20, so all five
    // gridlines land on whole numbers.
    let lo = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.y)) - 8) / 10) * 10);
    let hi = Math.min(100, Math.ceil((Math.max(...pts.map((p) => p.y)) + 8) / 10) * 10);
    while ((hi - lo) % 20 !== 0) {
      if (hi < 100) hi += 10; else lo = Math.max(0, lo - 10);
    }
    if (hi === lo) hi = Math.min(100, lo + 20);

    // Least-squares fit, described in plain English rather than as a formula.
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let n = 0, d = 0;
    pts.forEach((p) => { n += (p.x - mx) * (p.y - my); d += (p.x - mx) ** 2; });
    const slope = d ? n / d : 0;
    const days = span / 86_400_000;
    const perMonth = days > 0 ? (slope / days) * 30 : 0;

    // Ticks that match the window. Month boundaries are right for a session,
    // and useless for three weeks: a 24-day window has ONE of them, which
    // leaves the axis a bare line. Under 50 days it steps in days instead.
    const ticks: { at: number; label: string }[] = [];
    const dayCount = span / 86_400_000;
    if (dayCount <= 50) {
      const step = dayCount <= 16 ? 3 : 7;
      const cur = new Date(x0);
      cur.setHours(0, 0, 0, 0);
      for (let guard = 0; guard < 40; guard += 1) {
        const t = cur.getTime();
        if (t > x1) break;
        if (t >= x0) {
          ticks.push({
            at: (t - x0) / span,
            label: cur.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          });
        }
        cur.setDate(cur.getDate() + step);
      }
    } else {
      const cur = new Date(x0);
      cur.setDate(1);
      cur.setHours(0, 0, 0, 0);
      for (let guard = 0; guard < 36; guard += 1) {
        const t = cur.getTime();
        if (t > x1) break;
        if (t >= x0) {
          ticks.push({ at: (t - x0) / span, label: cur.toLocaleDateString(undefined, { month: "short" }) });
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    return {
      pts, x0, x1, lo, hi, ticks,
      trendA: my + slope * (0 - mx),
      trendB: my + slope * (1 - mx),
      perMonth,
    };
  }, [rows]);

  const W = 640, H = 300, L = 62, R = 16, T = 16, B = 42;
  const PH = H - T - B;
  const px = (x: number) => L + x * (W - L - R);
  const py = (y: number) => {
    const lo = geom?.lo ?? 0, hi = geom?.hi ?? 100;
    return T + PH - ((y - lo) / Math.max(1, hi - lo)) * PH;
  };

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[260px]">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Exam performance over time</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">One dot per paper, coloured by band.</p>
        </div>
        {q.data && (
          <LevelTag>
            {q.data.count} papers
            {geom && rows.length >= 6 && Math.abs(geom.perMonth) >= 0.05
              ? ` · ${geom.perMonth > 0 ? "+" : "−"}${Math.abs(geom.perMonth).toFixed(1)} pts / month`
              : ""}
          </LevelTag>
        )}
      </V5CardHead>
      <FilterStrip>
        <FilterGroup label="Scope">
          {/* A wing-locked coordinator has no wing to choose (main, coordinator
              console). The group still names the scope so the class select is
              not left orphaned under a missing label. */}
          {!wingLocked && (
            <FilterSelect value={wingId} onChange={chooseWing} options={wingOptions} allLabel="All school" />
          )}
          <FilterSelect value={classId} onChange={setClassId} options={classOptions}
                        allLabel="All classes in scope" width="w-[190px]" />
        </FilterGroup>
        {/* The two dates belong to Period, not beside it: they are what the
            preset resolves to, and "to" is meaningless away from the pair. */}
        <FilterGroup label="Period">
          <ChoiceSelect value={period} onChange={setPeriod} options={PERIODS} width="w-[160px]" />
          {/* Always visible, as in the reference, and showing the window the
              preset actually resolved to rather than sitting blank. Editing
              either one takes over: the preset flips to Custom and both dates are
              seeded from what was on screen, so a reader never loses the window
              they were looking at by touching one end of it. */}
          <span className="flex min-w-0 items-center gap-2">
            <input
              type="date"
              value={effFrom}
              max={effTo || undefined}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setCustomTo((v) => v || effTo);
                setPeriod(CUSTOM);
              }}
              aria-label="From date"
              className="h-8 min-w-0 rounded-[10px] border border-surface-stroke bg-surface-card px-2.5 text-[12.5px] font-semibold text-ink-700"
            />
            <span className="shrink-0 text-[12.5px] font-medium text-ink-400">to</span>
            <input
              type="date"
              value={effTo}
              min={effFrom || undefined}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setCustomFrom((v) => v || effFrom);
                setPeriod(CUSTOM);
              }}
              aria-label="To date"
              className="h-8 min-w-0 rounded-[10px] border border-surface-stroke bg-surface-card px-2.5 text-[12.5px] font-semibold text-ink-700"
            />
          </span>
        </FilterGroup>
        {/* An action, not a filter, so it sits on its own rather than inside a
            named group. */}
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="h-8 shrink-0 rounded-[10px] border border-surface-stroke px-2.5 text-[12px] font-bold text-ink-600 transition-colors duration-200 hover:border-brand-primary hover:text-brand-primary"
        >
          {asTable ? "Chart" : "Table"}
        </button>
      </FilterStrip>

      {/* The band legend the reference prints above the plot. Without it a
          coloured dot means nothing, and colour is the only thing carrying
          band on a scatter. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 pt-1 sm:px-[18px]">
        {(["exc", "good", "watch", "att"] as Dash5Band[]).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-600">
            <i className="inline-block h-[10px] w-[10px] rounded-full" style={{ background: bandColor(b) }} aria-hidden />
            {BAND[b].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-600">
          <i className="inline-block h-[3px] w-4 rounded-sm" style={{ background: "hsl(var(--brand-secondary))" }} aria-hidden />
          {!geom
            ? "Trend"
            : rows.length < 6
              ? "Trend, needs at least 6 papers"
              : geom.perMonth > 0.3
                ? "Trend, scores going up"
                : geom.perMonth < -0.3
                  ? "Trend, scores going down"
                  : "Trend, holding steady"}
        </span>
      </div>

      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load exam history." onRetry={() => void q.refetch()} />
        ) : !geom ? (
          <V5Empty title="No marked papers in this window yet" />
        ) : (
          <>
            {/* Table view swaps the plot out, it does not sit beside it: the
                reference's toggle is there so a reader who wants the numbers is
                not scrolling past a chart to reach them. */}
            <div ref={tip.wrapRef} className="relative" hidden={asTable}>
            <svg ref={tip.svgRef} viewBox={`0 0 ${W} ${H}`}
                 className="mx-auto block h-auto w-full max-w-[720px] overflow-visible" role="img"
                 aria-label={`Average score for each of ${rows.length} papers over time`}>
              {[0, 1, 2, 3, 4].map((t) => {
                const v = geom.hi - ((geom.hi - geom.lo) * t) / 4;
                const y = T + (PH * t) / 4;
                return (
                  <g key={t}>
                    <line x1={L} x2={W - R} y1={y} y2={y} stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                    <text x={L - 8} y={y + 3.5} textAnchor="end"
                          className="fill-ink-400 text-[10.5px] font-semibold">{Math.round(v)}%</text>
                  </g>
                );
              })}
              <line x1={L} x2={W - R} y1={T + PH} y2={T + PH}
                    stroke="hsl(var(--ink-400))" strokeWidth={1} opacity={0.55} />

              {/* Month boundaries. Without them the horizontal axis is just a
                  line and a reader cannot tell a two-week gap from a two-month
                  one. */}
              {geom.ticks.map((tk) => (
                <g key={tk.at}>
                  <line x1={px(tk.at)} x2={px(tk.at)} y1={T} y2={T + PH + 4}
                        stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                  <text x={px(tk.at)} y={H - 22} textAnchor="middle"
                        className="fill-ink-400 text-[10.5px] font-semibold">{tk.label}</text>
                </g>
              ))}
              {/* The RPC returns newest first, so rows[0] is the LATEST paper.
                  Labelling the axis from rows[0] to rows[last] printed the
                  window backwards: "Sep 16 to Aug 23". */}
              <text x={L + (W - L - R) / 2} y={H - 6} textAnchor="middle"
                    className="fill-ink-400 text-[10.5px] font-bold">
                {new Date(geom.x0).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                {"  →  "}
                {new Date(geom.x1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </text>
              <text
                x={13} y={T + PH / 2} textAnchor="middle"
                transform={`rotate(-90 13 ${T + PH / 2})`}
                className="fill-ink-400 text-[10.5px] font-bold"
              >
                Average score (%)
              </text>

              {/* Six papers is the reference's floor for drawing a trend, and
                  it is the right one: a line through three dots is a shape, not
                  a finding. */}
              {rows.length >= 6 && (
                <line x1={px(0)} x2={px(1)} y1={py(geom.trendA)} y2={py(geom.trendB)}
                      stroke="hsl(var(--brand-secondary))" strokeWidth={2} opacity={0.9} />
              )}
              {geom.pts.map((p) => (
                <g
                  key={p.k}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-none"
                  onClick={() => setPaper({ examId: p.r.exam_id, classId: p.r.class_id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPaper({ examId: p.r.exam_id, classId: p.r.class_id });
                    }
                  }}
                >
                  {/* A 13px transparent disc under the visible dot: a 5px
                      target is unhittable on a phone. */}
                  <circle
                    cx={px(p.x)} cy={py(p.y)} r={13} fill="transparent"
                    onPointerEnter={() => tip.show(px(p.x), py(p.y) - 6, paperTip(p.r))}
                    onPointerDown={() => tip.show(px(p.x), py(p.y) - 6, paperTip(p.r))}
                    onPointerLeave={tip.hide}
                  />
                  <circle cx={px(p.x)} cy={py(p.y)} r={7} fill="hsl(var(--surface-card))" />
                  <circle cx={px(p.x)} cy={py(p.y)} r={5} fill={bandColor(p.r.band)} opacity={0.9} />
                </g>
              ))}

              {/* The trend caption sits INSIDE the plot, in whichever corner
                  holds the fewest dots. Measured, not guessed, so it never
                  lands on top of the data it is describing. */}
              {rows.length >= 6 && (() => {
                const flat = Math.abs(geom.perMonth) < 0.3;
                const head = flat
                  ? "Scores are holding steady"
                  : geom.perMonth > 0
                    ? "Scores are going up over time"
                    : "Scores are going down over time";
                const sub = flat
                  ? `Barely any change across ${rows.length} papers`
                  : `About ${Math.abs(geom.perMonth).toFixed(1)} marks ${geom.perMonth > 0 ? "higher" : "lower"} each month, across ${rows.length} papers`;
                // SVG text neither wraps nor clips to its box, so a fixed 250px
                // rect let the second line run straight out of the card: at 400
                // papers it read "...across 400 papers" outside the border. The
                // box is measured from the wider of its two lines instead, and
                // capped so it can never be wider than the plot.
                const m = 6, bh = 34;
                const bw = Math.min(
                  W - L - R - 2 * m,
                  Math.max(31 + head.length * 5.95, 9 + sub.length * 5.1) + 12,
                );
                const spots = [
                  { x: L + m, y: T + m },
                  { x: W - R - bw - m, y: T + m },
                  { x: L + m, y: T + PH - bh - m },
                  { x: W - R - bw - m, y: T + PH - bh - m },
                ];
                const cost = (sp: { x: number; y: number }) =>
                  geom.pts.reduce((c, p) => {
                    const dx = px(p.x), dy = py(p.y);
                    return dx > sp.x - 9 && dx < sp.x + bw + 9 && dy > sp.y - 9 && dy < sp.y + bh + 9
                      ? c + 1 : c;
                  }, 0);
                const best = spots.map((sp) => ({ sp, c: cost(sp) }))
                                  .sort((a, b) => a.c - b.c)[0].sp;
                return (
                  <g aria-hidden>
                    <rect x={best.x} y={best.y} width={bw} height={bh} rx={8}
                          fill="hsl(var(--surface-card))"
                          stroke="hsl(var(--brand-secondary))" strokeWidth={1.5} />
                    <line x1={best.x + 9} x2={best.x + 25} y1={best.y + 13} y2={best.y + 13}
                          stroke="hsl(var(--brand-secondary))" strokeWidth={2.5} strokeLinecap="round" />
                    <text x={best.x + 31} y={best.y + 16} className="fill-ink-900 text-[10.5px] font-extrabold">
                      {head}
                    </text>
                    <text x={best.x + 9} y={best.y + 28} className="fill-ink-500 text-[10px] font-semibold">
                      {sub}
                    </text>
                  </g>
                );
              })()}
            </svg>
            <ChartTip tip={tip.tip} />
            </div>

            {/* The trend sentence is drawn inside the plot now, so it is not
                repeated here. Only the truncation notice remains. */}
            {q.data && q.data.total > q.data.count && (
              <p className="mt-1 text-[11.5px] text-ink-500">
                Showing the most recent {q.data.count} of {q.data.total.toLocaleString()} marked papers. Narrow by
                wing or class to see further back.
              </p>
            )}

            {/* The chart is the shape; this is the way in. A dot is not
                reachable by keyboard in any useful way and cannot be read by a
                screen reader, so the same papers are listed underneath. */}
            <h4 className="mb-2 mt-5 text-xs font-extrabold uppercase tracking-[0.06em] text-ink-400">
              {asTable ? `All ${rows.length} papers in this window` : "Most recent papers"}
            </h4>
            <TradTable>
              <tbody>
                {(asTable ? rows : rows.slice(0, 8)).map((r, i) => (
                  <tr
                    key={`${r.exam_id}-${r.class_id}-${i}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPaper({ examId: r.exam_id, classId: r.class_id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPaper({ examId: r.exam_id, classId: r.class_id });
                      }
                    }}
                    className={cn(
                      "cursor-pointer",
                      i % 2 === 1 && "bg-surface-stroke/25",
                      "hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                    )}
                  >
                    <td className={tdBase}>
                      <div className="font-semibold text-ink-900">
                        {r.subject_name ?? "Subject not recorded"}
                      </div>
                      <div className="mt-px text-[11.5px] font-medium text-ink-500">
                        {r.class_label} · {new Date(r.date).toLocaleDateString()} · {r.appeared} of{" "}
                        {r.roster} appeared
                      </div>
                    </td>
                    <td className={cn(tdBase, "w-[92px] text-right tabular-nums font-bold")}>
                      {pct0(r.avg_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TradTable>
          </>
        )}
      </div>

      <PaperDrawer
        open={!!paper}
        onOpenChange={(v) => !v && setPaper(null)}
        examId={paper?.examId ?? null}
        classId={paper?.classId ?? null}
      />
    </V5Card>
  );
}

/* --------------------------------------------------- subject performance -- */

export function Dash5SubjectPerformance() {
  const { classId, setClassId, classOptions } = useScopeFilter();
  const school = useSchoolSubjectPerformance();
  // A class narrows to the per-class RPC, which also carries the school average
  // so a reader can see where this class differs rather than just its own bars.
  const perClass = useSubjectPerformance(classId);
  const [all, setAll] = useState(false);
  const tip = useChartTip(640, 1);

  // Which subjects this class teaches but has never examined. They are the
  // reason the chart below is not the whole class: charting them at 0% would
  // read as failing when the truth is unmeasured, and leaving them out silently
  // would let a reader mistake three assessed subjects for the whole timetable.
  const treeSubjects = useDash5Tree("subjects", null, classId);
  // The bars come from the subject-performance RPC; the teacher, attempts and
  // coverage behind each one live on the tree. Matched on the normalised name,
  // the same key the rest of the page dedupes subjects by.
  const byName = useMemo(() => {
    const m = new Map<string, Dash5Row>();
    (treeSubjects.data?.rows ?? []).forEach((r) => m.set(r.name.trim().toLowerCase(), r));
    return m;
  }, [treeSubjects.data]);
  const unassessed = useMemo(
    () => (classId ? (treeSubjects.data?.rows ?? []).filter((r) => r.accuracy == null) : []),
    [classId, treeSubjects.data],
  );

  const q = classId ? perClass : school;
  const rows = useMemo(() => {
    if (classId) {
      return (perClass.data?.subjects ?? [])
        .filter((x) => x.class_avg != null)
        .sort((a, b) => (a.class_avg ?? 0) - (b.class_avg ?? 0))
        .map((x) => ({
          subject_id: x.subject_id,
          subject_name: x.subject_name,
          school_avg: x.class_avg,
          caption: x.school_avg != null ? `School ${Math.round(x.school_avg)}%` : "No school average yet",
        }));
    }
    return (school.data ?? []).map((x) => ({
      subject_id: x.subject_id,
      subject_name: x.subject_name,
      school_avg: x.school_avg,
      caption: `${x.results.toLocaleString()} ${x.results === 1 ? "result" : "results"}`,
    }));
  }, [classId, perClass.data, school.data]);
  // The reference plots every assessed subject. A class has nine of them, not
  // ninety, so hiding the tail behind a button buys nothing and costs the
  // comparison the chart exists for. School-wide can still be long, so that
  // view keeps the fold.
  const shown = classId || all ? rows : rows.slice(0, 8);

  return (
    <V5Card className="mb-6">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Subject-wise performance</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            {classId
              ? treeSubjects.data
                ? `${treeSubjects.data.scope.class_label ?? "This class"} · ${treeSubjects.data.total.students} students · class average ${pct1(treeSubjects.data.total.accuracy)}. Weakest subject first.`
                : "Weakest subject first."
              : "Weakest first, averaged across every graded exam this year."}
          </p>
        </div>
      </V5CardHead>
      <FilterStrip>
        <FilterLabel>Class</FilterLabel>
        <FilterSelect value={classId} onChange={setClassId} options={classOptions}
                      allLabel="Whole school" width="w-[190px]" />
      </FilterStrip>
      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load subject performance." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty title="No graded exams yet, so subjects cannot be compared" />
        ) : (
          <>
            {/* The reference's horizontal bar chart, to its geometry: a 152px
                label gutter, a 46px value gutter, 26px rows, and the percentage
                axis UNDER the plot. A bar list without that axis leaves the
                reader estimating what a bar is worth from its length. */}
            {(() => {
              // The label gutter is sized to the longest name on the chart
              // rather than fixed, so "Information Technology" is not cut to
              // fit a width chosen for "Maths". Capped so the bars keep room.
              const longest = Math.max(0, ...shown.map((x) => x.subject_name.length));
              const HW = 640, HR = 46, HT = 8, ROW = 26;
              const HL = Math.round(Math.min(250, Math.max(120, longest * 5.5 + 14)));
              const HH = HT + shown.length * ROW + 22;
              const pw = HW - HL - HR;
              return (
                <div ref={tip.wrapRef} className="relative">
                <svg
                  ref={tip.svgRef}
                  viewBox={`0 0 ${HW} ${HH}`}
                  className="mx-auto block h-auto w-full max-w-[720px] overflow-visible"
                  role="img"
                  aria-label={`Average score for each of ${shown.length} subjects, weakest first`}
                >
                  {[0, 1, 2, 3, 4].map((t) => (
                    <g key={t}>
                      <line x1={HL + (pw * t) / 4} x2={HL + (pw * t) / 4} y1={HT}
                            y2={HT + shown.length * ROW}
                            stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                      <text x={HL + (pw * t) / 4} y={HH - 6} textAnchor="middle"
                            className="fill-ink-400 text-[10.5px] font-semibold">{(100 * t) / 4}%</text>
                    </g>
                  ))}
                  <line x1={HL} x2={HL} y1={HT} y2={HT + shown.length * ROW}
                        stroke="hsl(var(--ink-400))" strokeWidth={1} opacity={0.55} />

                  {shown.map((s, i) => {
                    const v = clamp(s.school_avg ?? 0);
                    // The reference's four bands, not three: 82 / 74 / 66. The
                    // same mark has to land in the same colour as the pills
                    // everywhere else on the page.
                    const tone = v >= 82 ? "--dash-exc"
                      : v >= 74 ? "--dash-good"
                      : v >= 66 ? "--dash-warning"
                      : "--dash-critical";
                    const y = HT + i * ROW + ROW / 2;
                    const w = Math.max(2, (v / 100) * pw);
                    const bh = 13;
                    const rad = Math.min(4, w / 2);
                    return (
                      <g key={s.subject_id}>
                        <path
                          d={`M${HL} ${y - bh / 2} L${HL + w - rad} ${y - bh / 2} Q${HL + w} ${y - bh / 2} ${HL + w} ${y - bh / 2 + rad} L${HL + w} ${y + bh / 2 - rad} Q${HL + w} ${y + bh / 2} ${HL + w - rad} ${y + bh / 2} L${HL} ${y + bh / 2} Z`}
                          fill={`hsl(var(${tone}))`}
                        />
                        <text x={HL - 10} y={y + 4} textAnchor="end"
                              className="fill-ink-600 text-[10.5px] font-semibold">
                          {s.subject_name}
                        </text>
                        <text x={HL + w + 7} y={y + 4}
                              className="fill-ink-900 text-[10.5px] font-extrabold">
                          {v.toFixed(1)}%
                        </text>
                        <TipHit
                          x={0} y={y - ROW / 2} width={HW} height={ROW}
                          onShow={() => tip.show(Math.min(HW - 80, HL + w), y - 8, (
                            <>
                              <TipTitle>{s.subject_name}</TipTitle>
                              {(() => {
                                const t = byName.get(s.subject_name.trim().toLowerCase());
                                return (
                                  <>
                                    <TipLine>
                                      {classId
                                        ? `${treeSubjects.data?.scope.class_label ?? "This class"}${t?.teacher ? ` · ${t.teacher}` : ""}`
                                        : s.caption}
                                    </TipLine>
                                    <TipLine>
                                      Average score <b className="text-ink-900">{v.toFixed(1)}%</b>
                                      {t?.attempts ? ` on ${t.attempts.toLocaleString()} attempts` : ""}
                                    </TipLine>
                                    {t && (
                                      <TipLine>
                                        Coverage {pct1(t.syllabus_pct)} · {t.papers ?? 0} paper
                                        {t.papers === 1 ? "" : "s"}
                                      </TipLine>
                                    )}
                                  </>
                                );
                              })()}
                            </>
                          ))}
                          onHide={tip.hide}
                        />
                      </g>
                    );
                  })}
                </svg>
                <ChartTip tip={tip.tip} />
                </div>
              );
            })()}
            {!classId && rows.length > 8 && (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="mt-3 w-full border-t border-surface-stroke pt-3 text-center text-[12.5px] font-bold text-brand-primary hover:underline"
              >
                {all ? "Show less" : `Show all ${rows.length} subjects`}
              </button>
            )}
            {unassessed.length > 0 && (
              <div
                className="mt-3.5 rounded-[9px] border border-surface-stroke bg-surface-stroke/30 px-[13px] py-[11px] text-xs leading-[1.55] text-ink-600"
                style={{ borderLeftWidth: 3, borderLeftColor: "hsl(var(--brand-secondary))" }}
              >
                <b className="text-ink-900">
                  {unassessed.length} subject{unassessed.length > 1 ? "s are" : " is"} not on this chart
                </b>
                . {unassessed.map((r) => r.name).join(", ")}{" "}
                {unassessed.length > 1 ? "have" : "has"} had no paper conducted in this class this
                year. Charting {unassessed.length > 1 ? "them" : "it"} at 0% would read as failing
                rather than unmeasured.
              </div>
            )}

            <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
              The result count matters: a subject with a handful of results is one paper's worth of
              evidence, not a trend.
            </p>
          </>
        )}
      </div>
    </V5Card>
  );
}

/* ---------------------------------------------------- syllabus coverage --- */

/** Which number the bars draw. Coverage is the default because it is the one
 *  figure that is comparable between a 40-chapter book and a 12-chapter one. */
type SylMetric = "coverage" | "done" | "partial" | "notstarted";

/**
 * `worst` is which end of the metric is the bad end, and therefore which end
 * sorts first. Coverage and chapters-done are bad when LOW; partly-done and
 * not-started are bad when HIGH. Sorting everything ascending put the classes
 * with the FEWEST untouched chapters at the top of a "Not started" list, which
 * is the opposite of what the reader asked for.
 */
const SYL_METRICS: { key: SylMetric; label: string; varName: string; worst: "low" | "high" }[] = [
  { key: "coverage", label: "Coverage", varName: "--dash-exc", worst: "low" },
  { key: "done", label: "Chapters done", varName: "--dash-exc", worst: "low" },
  { key: "partial", label: "Partly done", varName: "--dash-warning", worst: "high" },
  { key: "notstarted", label: "Not started", varName: "--dash-critical", worst: "high" },
];

export function Dash5SyllabusCoverage() {
  const { drill, setDrill, reset, up, canGoUp, rootLabel } = useWingDrill();
  const [metric, setMetric] = useState<SylMetric>("coverage");
  const [assign, setAssign] =
    useState<{ scope: AssignScope; title: string; subtitle?: string } | null>(null);

  const level = drill.classId ? "subjects" : drill.wingId ? "classes" : "wings";
  const q = useDash5Tree(level, drill.wingId, drill.classId);
  const t = q.data?.total;

  // The pace line: how much of the academic year has gone. Read off the same
  // scope the rows came from, so the marker and the bars are the same session.
  const pace = useMemo(() => {
    const sc = q.data?.scope;
    if (!sc?.ay_start || !sc.ay_end || !sc.today) return null;
    const a = new Date(sc.ay_start).getTime();
    const b = new Date(sc.ay_end).getTime();
    const n = new Date(sc.today).getTime();
    if (!(b > a)) return null;
    return Math.round(Math.max(8, Math.min(100, ((n - a) / (b - a)) * 100)) * 10) / 10;
  }, [q.data]);

  const valueOf = (r: { syllabus_pct: number | null; chapters: number | null;
                        chapters_done: number | null; chapters_partial: number | null }) => {
    const ch = r.chapters ?? 0;
    const done = r.chapters_done ?? 0;
    const part = r.chapters_partial ?? 0;
    if (metric === "coverage") return r.syllabus_pct ?? 0;
    if (metric === "done") return done;
    if (metric === "partial") return part;
    return Math.max(0, ch - done - part);
  };

  const worstEnd = SYL_METRICS.find((m) => m.key === metric)?.worst ?? "low";
  const rows = useMemo(
    () => (q.data?.rows ?? []).slice().sort((a, b) =>
      worstEnd === "low" ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a)),
    // valueOf closes over `metric`, so the sort has to be redone when it changes.
    [q.data, metric, worstEnd], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Counts are absolute, so the longest bar is the biggest count. Coverage is
  // already a percentage and is drawn against 100 so the pace line means
  // something.
  const scale = metric === "coverage" ? 100 : Math.max(1, ...rows.map(valueOf));

  const chapters = t?.chapters ?? 0;
  const done = t?.chapters_done ?? 0;
  const partial = t?.chapters_partial ?? 0;
  const notStarted = Math.max(0, chapters - done - partial);

  const summary: { key: SylMetric; label: string; value: string; varName: string }[] = [
    { key: "coverage", label: "Coverage", value: pct1(t?.syllabus_pct), varName: "--dash-exc" },
    { key: "done", label: "Chapters done", value: done.toLocaleString(), varName: "--dash-exc" },
    { key: "partial", label: "Partly done", value: partial.toLocaleString(), varName: "--dash-warning" },
    { key: "notstarted", label: "Not started", value: notStarted.toLocaleString(), varName: "--dash-critical" },
  ];

  return (
    <V5Card className="mb-8">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[260px]">
          <Crumbs
            items={[
              { label: rootLabel, onClick: canGoUp ? reset : undefined },
              ...(drill.wingId && rootLabel === "All wings" ? [{ label: drill.wingName ?? "Wing",
                   onClick: drill.classId ? () => setDrill((d) => ({ ...d, classId: null, classLabel: null })) : undefined }] : []),
              ...(drill.classId ? [{ label: drill.classLabel ?? "Class" }] : []),
            ]}
          />
          <p className="mt-1.5 text-xs font-medium text-ink-500">
            {/* `done` and `chapters` fall back to 0 until the total lands. */}
            {t && <>{done.toLocaleString()} of {chapters.toLocaleString()} chapters.{" "}</>}
            {level === "wings"
              ? "A partly-done chapter is worth half a finished one. Click a wing for its classes."
              : level === "classes"
                ? `${drill.wingName ?? "This wing"} · click a class for its subject breakdown.`
                : `${drill.classLabel ?? "This class"} · the catch-up goes to the subject teacher.`}
          </p>
        </div>
        {q.data && (
          <LevelTag>
            {rows.length} {level === "wings" ? "wings" : level === "classes" ? "classes" : "subjects"}
          </LevelTag>
        )}
        {canGoUp && (
          <button
            type="button"
            onClick={up}
            className="rounded-[10px] border border-surface-stroke px-3 py-1.5 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
          >
            ↑ Up one level
          </button>
        )}
      </V5CardHead>

      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load syllabus coverage." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty title="No syllabus loaded yet" sub="Coverage appears once chapters exist for a subject." />
        ) : (
          <>
            {/* The reference's summary block: four figures that are also the
                switch for what the bars below draw, so a principal can ask
                "who has the most not started" without leaving the card. */}
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {summary.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setMetric(c.key)}
                  aria-pressed={metric === c.key}
                  className={cn(
                    "rounded-[12px] border px-3.5 py-3 text-left transition-colors duration-200",
                    metric === c.key
                      ? "border-brand-primary bg-brand-primary/[0.07]"
                      : "border-surface-stroke hover:bg-surface-stroke/40",
                  )}
                >
                  <span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
                    {c.label}
                  </span>
                  <span
                    className="mt-0.5 block text-xl font-extrabold tabular-nums tracking-[-0.03em]"
                    style={{ color: `hsl(var(${c.varName}))` }}
                  >
                    {c.value}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] font-semibold text-ink-400">
                    {metric === c.key ? "Showing in chart" : "Show in chart"}
                  </span>
                </button>
              ))}
            </div>

            <div className="mb-4 rounded-[12px] border border-surface-stroke bg-surface-stroke/30 px-3.5 py-3">
              <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
                {chapters.toLocaleString()} chapters in scope
              </p>
              <span className="mt-2 flex h-3 overflow-hidden rounded-[5px] bg-surface-stroke" aria-hidden>
                <span style={{ width: `${(done / Math.max(1, chapters)) * 100}%`, background: "hsl(var(--dash-exc))" }} />
                <span style={{ width: `${(partial / Math.max(1, chapters)) * 100}%`, background: "hsl(var(--dash-warning))" }} />
              </span>
              <p className="m-0 mt-1.5 text-[11.5px] font-medium text-ink-500">
                {done.toLocaleString()} done · {partial.toLocaleString()} partly done ·{" "}
                {notStarted.toLocaleString()} not started
              </p>
            </div>

            <h4 className="mb-2.5 text-xs font-extrabold uppercase tracking-[0.06em] text-ink-400">
              {SYL_METRICS.find((m) => m.key === metric)?.label}
              {" · "}
              {level === "wings"
                ? "all wings"
                : level === "classes"
                  ? drill.wingName ?? "this wing"
                  : drill.classLabel ?? "this class"}
              {metric !== "coverage" && ` · bars scaled to the largest (${scale.toLocaleString()})`}
            </h4>

            <BarsH>
              {rows.map((r) => {
                const v = valueOf(r);
                const cov = r.syllabus_pct ?? 0;
                const tone = metric === "coverage"
                  ? cov < 40 ? "--dash-critical" : cov < 70 ? "--dash-warning" : "--dash-exc"
                  : SYL_METRICS.find((m) => m.key === metric)?.varName ?? "--dash-exc";
                const clickable = level !== "subjects";
                return (
                  <BarRow
                    key={r.id}
                    label={r.name}
                    // What the reference puts on the second line: how many
                    // classes at wing level, and the person responsible below
                    // that. `sub` on a tree row is exactly the wing head or the
                    // class teacher.
                    sub={level === "wings"
                      ? `${r.class_count ?? 0} classes${r.sub ? ` · ${r.sub}` : ""}`
                      : r.sub ?? (r.chapters ? `${r.chapters_done ?? 0} of ${r.chapters} chapters` : "no chapters loaded")}
                    pct={(v / scale) * 100}
                    color={`hsl(var(${tone}))`}
                    value={metric === "coverage" ? `${Math.round(v)}%` : v.toLocaleString()}
                    marker={metric === "coverage" ? pace : undefined}
                    action={level === "subjects" && drill.classId ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssign({
                            scope: { classId: drill.classId, subjectId: r.id },
                            title: `Assign a task: ${r.name}`,
                            subtitle: [drill.classLabel, r.teacher].filter(Boolean).join(" · ") || undefined,
                          });
                        }}
                        className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10"
                      >
                        Assign
                      </button>
                    ) : clickable ? (
                      <span className="text-[12px] text-ink-400" aria-hidden>▸</span>
                    ) : undefined}
                    onClick={clickable
                      ? () => {
                          if (level === "wings") setDrill({ wingId: r.id, wingName: r.name, classId: null, classLabel: null });
                          else setDrill((d) => ({ ...d, classId: r.id, classLabel: r.name }));
                        }
                      : undefined}
                  />
                );
              })}
            </BarsH>

            <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
              {metric === "coverage"
                ? `The marker on each bar is the pace line, ${pace}% of the year gone. A bar short of it is behind.`
                : "Bars are counts, not percentages, so they are scaled against the largest row in view rather than against 100."}
            </p>
          </>
        )}
      </div>
      <AssignDrawer
        open={!!assign}
        onOpenChange={(v) => !v && setAssign(null)}
        scope={assign?.scope ?? null}
        title={assign?.title ?? "Assign a task"}
        subtitle={assign?.subtitle}
      />
    </V5Card>
  );
}
