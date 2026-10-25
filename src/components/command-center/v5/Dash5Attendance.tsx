import { useMemo, useState } from "react";
import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useDash5AttendanceByWing, useDash5AttendanceSeries, useDash5ChronicAbsentees,
  useDash5NeedsByWing, type Dash5NeedItem,
} from "@/hooks/dashboard/useDash5";

import { ChartTip, TipHit, TipLine, TipTitle } from "./ChartTip";
import { useChartTip } from "./useChartTip";
import { pct1 } from "./format";
import { AssignDrawer, StudentDrawer } from "./Dash5Drawers";
import {
  BarRow, BarsH, LevelTag, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "./primitives";
import {
  ChoiceSelect, FilterGroup, FilterSelect, FilterStrip,
} from "./FilterBar";
import { useScopeFilter } from "./useScopeFilter";

/* ------------------------------------------------------- attendance trend - */

export function Dash5AttendanceTrend() {
  const q = useDash5AttendanceSeries(20);
  const days = q.data?.days ?? [];
  const tip = useChartTip(640, 230);
  const [hover, setHover] = useState<number | null>(null);

  // R is the right gutter. It was 14, just enough to stop the last dot
  // touching the frame, so the end-of-line labels had to be printed back over
  // the plot and landed on the lines they label. It is 44 now and the labels
  // sit beside their final point instead of on top of it.
  const W = 640, H = 230, L = 42, R = 44, T = 14, B = 30;
  // The reference pins this to 80-100: real student attendance lives between
  // 88 and 96, and on a 0-100 axis both lines crowd the top fifth and every
  // day looks identical. The teacher line is measured against the whole
  // roster, so it runs lower (73% to 89% at Alliance) and a hard floor of 80
  // would clip it flat against the bottom, which is the same failure this
  // change set out to fix. The floor drops to the nearest 5 below the lowest
  // point instead, and never rises above 80.
  const HI = 100;
  const lows = days.flatMap((d) => [d.student_pct, d.staff_pct].filter((v): v is number => v != null));
  const LO = lows.length
    ? Math.max(0, Math.min(80, Math.floor((Math.min(...lows) - 2) / 5) * 5))
    : 80;
  // Five gridlines spanning whatever range the floor settled on. Hardcoded
  // 80/85/90/95/100 ticks left the labels bunched at the top with two thirds
  // of the plot unruled the moment the floor dropped below 80.
  const TICKS = Array.from({ length: 5 }, (_, i) => LO + ((HI - LO) * i) / 4);
  const px = (i: number) => L + (days.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (days.length - 1));
  const py = (v: number) =>
    T + (H - T - B) - ((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * (H - T - B);

  const line = (key: "student_pct" | "staff_pct") =>
    days.map((d, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(d[key] ?? 0).toFixed(1)}`).join(" ");

  return (
    <V5Card className="mb-4">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Attendance trend</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            {/* `days` is [] until the series lands, which printed "the last 0 days". */}
            Students against teachers
            {q.data ? `, over the last ${days.length} days the school took a register` : ""}.
          </p>
        </div>
        {/* How to read the chart used to sit under it as a six-line paragraph, which
            on a phone was taller than the chart itself and pushed the next card off
            screen. It is the same words, behind this button, read when wanted. */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="How to read this chart"
              className="-mr-1 h-7 w-7 shrink-0 rounded-full text-ink-400 hover:text-ink-600"
            >
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(20rem,calc(100vw-2rem))] text-[11.5px] leading-[1.55] text-ink-500"
          >
            <p className="m-0 mb-1.5 text-xs font-semibold text-ink-900">How to read this</p>
            {LO > 0 && (
              <p className="m-0 mb-2">
                The axis starts at {LO}%, not zero, because attendance here lives near the top and
                a full axis flattens every day into the same line.
              </p>
            )}
            <p className="m-0">
              Both lines are counted against the whole roll: every student on the roster, every
              teacher on the roster, so someone who was never marked counts against the day instead
              of vanishing from it. That means a low student day usually says the register was not
              taken rather than that the children were away, and the tooltip prints how many were
              registered so the two can be told apart.
            </p>
          </PopoverContent>
        </Popover>
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the attendance trend." onRetry={() => void q.refetch()} />
        ) : days.length === 0 ? (
          <V5Empty title="No register has been taken yet" />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
              {[["Students", "--dash-teal"], ["Teachers", "--brand-secondary"]].map(([label, v]) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600">
                  <i className="inline-block h-[11px] w-[11px] rounded-[3px]"
                     style={{ background: `hsl(var(${v}))` }} aria-hidden />
                  {label}
                </span>
              ))}
            </div>
            <div ref={tip.wrapRef} className="relative">
            <svg ref={tip.svgRef} viewBox={`0 0 ${W} ${H}`}
                 className="mx-auto block h-auto w-full max-w-[720px] overflow-visible" role="img"
                 aria-label="Daily student and teacher attendance">
              {TICKS.map((v) => (
                <g key={v}>
                  <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} stroke="hsl(var(--surface-stroke))" strokeWidth={1} />
                  <text x={L - 8} y={py(v) + 3.5} textAnchor="end"
                        className="fill-ink-400 text-[10.5px] font-semibold">{Math.round(v)}%</text>
                </g>
              ))}
              {hover != null && (
                <line
                  x1={px(hover)} x2={px(hover)} y1={T} y2={H - B}
                  stroke="hsl(var(--ink-400))" strokeWidth={1} opacity={0.45}
                />
              )}
              <path d={line("student_pct")} fill="none" stroke="hsl(var(--dash-teal))" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round" />
              <path d={line("staff_pct")} fill="none" stroke="hsl(var(--brand-secondary))" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round" />
              {days.map((d, i) => (
                <g key={d.date}>
                  <circle cx={px(i)} cy={py(d.student_pct ?? 0)} r={hover === i ? 4.5 : 3}
                          fill="hsl(var(--dash-teal))" />
                  <circle cx={px(i)} cy={py(d.staff_pct ?? 0)} r={hover === i ? 4.5 : 3}
                          fill="hsl(var(--brand-secondary))" />
                </g>
              ))}
              {/* One full-height band per day. Hitting a 3px dot exactly is not a
                  reasonable ask, and the reference does not ask it: anywhere in
                  the column shows BOTH series for that day. */}
              {days.map((d, i) => {
                const half = days.length > 1 ? (W - L - R) / (days.length - 1) / 2 : (W - L - R) / 2;
                return (
                  <TipHit
                    key={`hit-${d.date}`}
                    x={px(i) - half} y={T} width={half * 2} height={H - B - T}
                    onShow={() => {
                      setHover(i);
                      tip.show(px(i), T + 6, (
                        <>
                          <TipTitle>
                            {new Date(d.date).toLocaleDateString(undefined,
                              { weekday: "short", day: "numeric", month: "short" })}
                          </TipTitle>
                          <TipLine>
                            <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-[-1px]"
                               style={{ background: "hsl(var(--dash-teal))" }} />
                            Students {pct1(d.student_pct)}
                            <span className="block pl-4 text-ink-400">
                              {d.student_present} of {d.student_total} present
                              {d.student_marked < d.student_total &&
                                ` · ${d.student_marked} registered`}
                            </span>
                          </TipLine>
                          <TipLine>
                            <i className="mr-1.5 inline-block h-[9px] w-[9px] rounded-[3px] align-[-1px]"
                               style={{ background: "hsl(var(--brand-secondary))" }} />
                            Teachers {pct1(d.staff_pct)}
                            <span className="block pl-4 text-ink-400">
                              {d.staff_present} of {d.staff_total} checked in
                            </span>
                          </TipLine>
                        </>
                      ));
                    }}
                    onHide={() => { setHover(null); tip.hide(); }}
                  />
                );
              })}

              {/* The latest value on each line, printed. The reference does
                  this so today's figure is readable without hovering, which
                  matters on a touch screen where there is no hover at all.
                  In the right gutter, level with the point, and pushed apart
                  when the two lines finish within a line-height of each other
                  so the labels never sit on top of one another either. */}
              {(() => {
                const ends = (["student_pct", "staff_pct"] as const)
                  .map((k) => ({ k, v: days[days.length - 1][k] }))
                  .filter((e): e is { k: typeof e.k; v: number } => e.v != null)
                  .map((e) => ({ ...e, y: py(e.v) }))
                  .sort((a, b) => a.y - b.y);
                if (ends.length === 2 && ends[1].y - ends[0].y < 12) {
                  const mid = (ends[0].y + ends[1].y) / 2;
                  ends[0].y = mid - 6;
                  ends[1].y = mid + 6;
                }
                return ends.map((e) => (
                  <text
                    key={e.k}
                    x={W - R + 6}
                    y={e.y + 3.5}
                    className="text-[10.5px] font-extrabold"
                    style={{ fill: e.k === "student_pct" ? "hsl(var(--dash-teal))" : "hsl(var(--brand-secondary))" }}
                  >
                    {Math.round(e.v)}%
                  </text>
                ));
              })()}
              <text x={L} y={H - 6} className="fill-ink-400 text-[10.5px] font-semibold">
                {new Date(days[0].date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </text>
              <text x={W - R} y={H - 6} textAnchor="end" className="fill-ink-400 text-[10.5px] font-semibold">
                {new Date(days[days.length - 1].date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </text>
            </svg>
            <ChartTip tip={tip.tip} />
            </div>
          </>
        )}
      </div>
    </V5Card>
  );
}

/* -------------------------------------------------------- by wing -------- */

export function Dash5AttendanceByWing() {
  const q = useDash5AttendanceByWing();
  const rows = q.data?.rows ?? [];

  return (
    <V5Card className="mb-6">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Attendance by wing</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">Student-weighted average.</p>
        </div>
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? <V5Loading />
          : q.isError ? <V5Error label="Couldn't load attendance by wing." onRetry={() => void q.refetch()} />
          : rows.length === 0 ? <V5Empty title="No wings set up yet" />
          : (
            <BarsH>
              {rows.map((r) => {
                const v = r.pct ?? 0;
                const tone = v < 75 ? "--dash-critical" : v < 90 ? "--dash-warning" : "--dash-exc";
                return (
                  <BarRow
                    key={r.wing_id}
                    label={r.wing_name}
                    sub={`${r.students} students`}
                    pct={v}
                    color={`hsl(var(${tone}))`}
                    value={`${Math.round(v)}%`}
                  />
                );
              })}
            </BarsH>
          )}
      </div>
    </V5Card>
  );
}

/* ------------------------------------------------- chronic absentees ----- */

/** Same order as the Students section, so a wing keeps one colour page-wide. */
const WING_TONES = ["--dash-teal", "--brand-secondary", "--dash-exc", "--dash-warning", "--dash-critical"];

const WINDOWS = [
  { v: 7, label: "Last 7 school days" },
  { v: 14, label: "Last 14 school days" },
  { v: 30, label: "Last 30 school days" },
  { v: 60, label: "Last 60 school days" },
  { v: 250, label: "Whole year to date" },
];
const THRESHOLDS = [
  { v: 75, label: "75%, the CBSE floor" },
  { v: 65, label: "65%" },
  { v: 55, label: "55%" },
];
const STREAKS = [
  { v: 0, label: "Any" },
  { v: 3, label: "3 or more in a row" },
  { v: 5, label: "5 or more in a row" },
  { v: 10, label: "10 or more in a row" },
];

export function Dash5ChronicAbsentees() {
  const [open, setOpen] = useState(false);
  // Which absentee the detail drawer is showing. The row says how bad it is;
  // the drawer says whose number to ring about it.
  const [student, setStudent] = useState<string | null>(null);
  // The wing whose whole follow-up is being handed to its coordinator.
  const [assignWing, setAssignWing] = useState<{ id: string; name: string } | null>(null);
  const [days, setDays] = useState(250);
  const [threshold, setThreshold] = useState(75);
  const [streak, setStreak] = useState(0);
  const { wingId, wingLocked, classId, setClassId, chooseWing, wingOptions, classOptions } =
    useScopeFilter();
  const q = useDash5ChronicAbsentees(wingId, classId, days, threshold, streak);

  return (
    <V5Card className="mb-8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Chronic absentees</span>
            {q.data && (
              <span className="rounded-md bg-brand-secondary/12 px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-brand-secondary">
                {q.data.total.toLocaleString()} students
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs font-medium text-ink-500">
            {q.data
              ? `${q.data.total_school.toLocaleString()} students below ${q.data.threshold}% across the ${q.data.window_days} days counted.`
              : "Recomputed from the register over the window you pick."}
          </span>

          {/* Where they are, before anyone opens the list, plus the filter the
              numbers were produced under. A count with no visible filter behind
              it is a number nobody can check. */}
          {q.data && q.data.total > 0 && (
            <>
              <span className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-surface-stroke" aria-hidden>
                {q.data.by_wing.map((w, i) => (
                  <span
                    key={w.wing_id}
                    style={{
                      width: `${(w.n / Math.max(1, q.data.total)) * 100}%`,
                      background: `hsl(var(${WING_TONES[i % WING_TONES.length]}))`,
                    }}
                  />
                ))}
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {q.data.by_wing.filter((w) => w.n > 0).map((w, i) => (
                  <span
                    key={w.wing_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
                  >
                    <i
                      className="inline-block h-[9px] w-[9px] rounded-[3px]"
                      style={{ background: `hsl(var(${WING_TONES[i % WING_TONES.length]}))` }}
                      aria-hidden
                    />
                    {w.wing_name} {w.n}
                  </span>
                ))}
                <span className="inline-flex items-center rounded-full border border-dashed border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                  under {q.data.threshold}% ·{" "}
                  {WINDOWS.find((x) => x.v === days)?.label.toLowerCase() ?? `${days} days`}
                  {q.data.streak > 0 && ` · ${q.data.streak}+ days absent in a row`}
                </span>
              </span>
            </>
          )}
        </span>
        <span className={cn("text-xs text-ink-400 transition-transform", open && "rotate-90")} aria-hidden>▸</span>
      </button>

      {open && (
        <div className="border-t border-surface-stroke">
          <FilterStrip>
            <FilterGroup label="Where">
              {/* A wing-locked coordinator has no wing to choose (main,
                  coordinator console); the class select keeps its label. */}
              {!wingLocked && (
                <FilterSelect value={wingId} onChange={chooseWing} options={wingOptions} allLabel="All wings" />
              )}
              <FilterSelect value={classId} onChange={setClassId} options={classOptions}
                            allLabel="All classes in scope" width="w-[190px]" />
            </FilterGroup>
          </FilterStrip>
          <FilterStrip>
            <FilterGroup label="Window">
              <ChoiceSelect value={days} onChange={setDays} options={WINDOWS} width="w-[180px]" />
            </FilterGroup>
            <FilterGroup label="Below">
              <ChoiceSelect value={threshold} onChange={setThreshold} options={THRESHOLDS} width="w-[160px]" />
            </FilterGroup>
            <FilterGroup label="Absent">
              <ChoiceSelect value={streak} onChange={setStreak} options={STREAKS} width="w-[170px]" />
            </FilterGroup>
            {/* Always on screen, as in the reference. Five controls is enough
                to get lost in, and a reset that appears only once you are lost
                is one you have to discover at the worst moment. */}
            <button
              type="button"
              disabled={(wingLocked || !wingId)
                && !classId && days === 250 && threshold === 75 && streak === 0}
              onClick={() => {
                chooseWing(null);
                setClassId(null);
                setDays(250);
                setThreshold(75);
                setStreak(0);
              }}
              className="rounded-[10px] border border-surface-stroke px-2.5 py-1.5 text-[12px] font-bold text-ink-600 transition-colors duration-200 hover:border-brand-primary hover:text-brand-primary disabled:opacity-40 disabled:hover:border-surface-stroke disabled:hover:text-ink-600"
            >
              Reset filters
            </button>
            {q.data && (
              <span className="text-[11.5px] font-medium text-ink-500">
                {q.data.total.toLocaleString()} match
                {q.data.total === 1 ? "es" : ""}
              </span>
            )}
          </FilterStrip>

          <div className="px-4 py-4 sm:px-[18px]">
            {q.isLoading ? (
              <V5Loading />
            ) : q.isError ? (
              <V5Error label="Couldn't load absentees." onRetry={() => void q.refetch()} />
            ) : (q.data?.rows.length ?? 0) === 0 ? (
              <V5Empty
                title="Nobody meets these filters"
                sub="Widen the window, lower the threshold, or drop the run of consecutive absences."
              />
            ) : (
              <>
                {/* One hand-over per wing, so a principal can pass a whole
                    wing's follow-up to its coordinator without opening twenty
                    students one at a time. */}
                {(q.data?.by_wing.filter((w) => w.n > 0).length ?? 0) > 0 && (
                  <div className="mb-3.5 flex flex-col divide-y divide-surface-stroke border-y border-surface-stroke">
                    {q.data?.by_wing.filter((w) => w.n > 0).map((w) => (
                      <div key={w.wing_id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1 basis-[220px]">
                          <span className="block text-[13px] font-semibold text-ink-900">
                            Follow up on {w.n} student{w.n === 1 ? "" : "s"} under{" "}
                            {q.data?.threshold}% · {w.wing_name}
                          </span>
                          {/* Wraps rather than truncates: at 375px this line
                              runs past its box, and the names it cuts are the
                              students the row exists to name. */}
                          <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                            {w.coordinator ?? "No coordinator assigned"}
                            {w.worst.length > 0 && ` · ${w.worst.join(", ")}`}
                            {w.n > w.worst.length && ` and ${w.n - w.worst.length} more`}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setAssignWing({ id: w.wing_id, name: w.wing_name })}
                          className="shrink-0 rounded-[9px] border border-brand-primary bg-brand-primary px-3 py-1.5 text-xs font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
                        >
                          Assign to {(w.coordinator ?? "the wing").split(" ").slice(-1)[0]}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <p className="m-0 mb-2 text-[11.5px] font-medium text-ink-500">
                  Recomputed over {q.data?.window_days} school days, so this is attendance in that
                  window and not the year figure filtered afterwards.
                </p>
                <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
                  {q.data?.rows.map((s, i) => (
                    <li key={s.student_id} className="p-0">
                    <button
                      type="button"
                      onClick={() => setStudent(s.student_id)}
                      className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left transition-colors duration-200 hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-ink-900">
                          <span className="text-ink-400">{i + 1}.</span> {s.name}
                        </span>
                        <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                          {s.class_label}
                          {s.roll && ` · roll ${s.roll}`}
                          {s.class_teacher && ` · ${s.class_teacher}`}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <span
                            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{
                              color: "hsl(var(--dash-critical))",
                              background: "hsl(var(--dash-critical) / 0.1)",
                            }}
                          >
                            {s.absent_streak > 0 ? `${s.absent_streak}d absent now` : "in today"}
                          </span>
                          {/* The year figure only earns its place when the
                              window is shorter than the year. */}
                          {days < 250 && s.year_pct != null && (
                            <span className="rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600">
                              {Math.round(s.year_pct)}% <span className="font-medium text-ink-400">year</span>
                            </span>
                          )}
                          {s.score != null && (
                            <span className="rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600">
                              {Math.round(s.score)}% <span className="font-medium text-ink-400">score</span>
                            </span>
                          )}
                          <span className="rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-medium text-ink-500">
                            {s.days_counted} days counted
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span
                          className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold tabular-nums"
                          style={{
                            color: "hsl(var(--dash-critical))",
                            background: "hsl(var(--dash-critical) / 0.12)",
                          }}
                        >
                          {Math.round(s.pct)}%
                        </span>
                        <span className="whitespace-nowrap text-[11.5px] font-bold text-brand-primary">
                          Message parents →
                        </span>
                      </span>
                    </button>
                    </li>
                  ))}
                </ul>
                {(q.data?.total ?? 0) > (q.data?.rows.length ?? 0) && (
                  <p className="mt-3 text-center text-[12.5px] font-medium text-ink-500">
                    Showing the {q.data?.rows.length} lowest of {q.data?.total.toLocaleString()}.
                  </p>
                )}
                <StudentDrawer
                  open={!!student}
                  onOpenChange={(v) => !v && setStudent(null)}
                  studentId={student}
                />
                <AssignDrawer
                  open={!!assignWing}
                  onOpenChange={(v) => !v && setAssignWing(null)}
                  scope={assignWing ? { wingId: assignWing.id } : null}
                  title={`Attendance follow-up · ${assignWing?.name ?? ""}`}
                  subtitle="Every student in this wing under the threshold, as one task."
                />
              </>
            )}
          </div>
        </div>
      )}
    </V5Card>
  );
}

/* ------------------------------------------------------ needs by wing ---- */

const SEV: Record<Dash5NeedItem["severity"], { glyph: string; varName: string }> = {
  High:   { glyph: "■", varName: "--dash-critical" },
  Medium: { glyph: "◆", varName: "--dash-warning" },
  Low:    { glyph: "●", varName: "--dash-exc" },
};

export function Dash5NeedsByWing({ onGoto }: { onGoto?: (section: string) => void }) {
  const q = useDash5NeedsByWing();
  // A SET, not one id. The reference lets several wings sit open side by side,
  // which is how a principal compares two of them without losing the first.
  const [openWings, setOpenWings] = useState<Set<string>>(() => new Set());
  // The wing whose whole queue is being handed to its coordinator.
  const [assignWing, setAssignWing] = useState<{ id: string; name: string } | null>(null);
  const wings = useMemo(() => q.data?.wings ?? [], [q.data]);

  return (
    <V5Card className="mb-8 overflow-hidden">
      <V5CardHead className="items-center">
        <div className="flex-1 basis-[240px]">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">By wing</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            {q.data
              ? `${q.data.total} open items across ${wings.length} wings. Busiest first.`
              : "Open items counted per wing."}
          </p>
        </div>
        {q.data && <LevelTag>{q.data.total} items</LevelTag>}
      </V5CardHead>

      {q.isLoading ? (
        <div className="px-4 pb-4"><V5Loading /></div>
      ) : q.isError ? (
        <div className="px-4 pb-4"><V5Error label="Couldn't load the queue." onRetry={() => void q.refetch()} /></div>
      ) : wings.length === 0 ? (
        <div className="px-4 pb-4"><V5Empty title="Nothing needs your attention right now" /></div>
      ) : (
        <div className="border-t border-surface-stroke">
          {wings.map((w) => {
            const isOpen = openWings.has(w.wing_id);
            return (
              <div key={w.wing_id} className="border-b border-surface-stroke last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenWings((prev) => {
                    const next = new Set(prev);
                    if (next.has(w.wing_id)) next.delete(w.wing_id);
                    else next.add(w.wing_id);
                    return next;
                  })}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-bold tracking-[-0.01em] text-ink-900">{w.wing_name}</span>
                    {/* Wraps rather than truncates: at 375px this line runs
                        past its box and loses the student count. */}
                    <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">
                      {w.coordinator ?? "No coordinator assigned"} · {w.classes} classes ·{" "}
                      {w.students.toLocaleString()} students
                    </span>
                    {/* Preview chips, so a wing can be triaged without opening
                        it. The reference shows the high count and the first two
                        titles; anything longer is cut rather than wrapped. */}
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {w.high > 0 && (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                          style={{
                            color: "hsl(var(--dash-critical))",
                            background: "hsl(var(--dash-critical) / 0.1)",
                            borderColor: "hsl(var(--dash-critical) / 0.24)",
                          }}
                        >
                          ■ {w.high} High
                        </span>
                      )}
                      {w.items.slice(0, 2).map((it) => (
                        <span
                          key={it.title}
                          className="max-w-full truncate rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
                        >
                          {it.title.length > 38 ? `${it.title.slice(0, 37)}…` : it.title}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-xl font-extrabold tabular-nums tracking-[-0.03em] text-ink-900">{w.count}</span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.05em] text-ink-400">items</span>
                  </span>
                  <span className={cn("text-xs text-ink-400 transition-transform", isOpen && "rotate-90")} aria-hidden>▸</span>
                </button>

                {isOpen && (
                  <>
                  {/* The reference's hand-over row. Every item under this wing
                      has the same owner, so a principal should be able to pass
                      the whole set on without opening them one at a time. */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-surface-stroke bg-surface-stroke/30 px-4 py-2.5 sm:px-[18px]">
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
                      Coordinator
                    </span>
                    <span className="min-w-0 flex-1 basis-[200px] text-[11.5px] font-medium text-ink-500">
                      {w.coordinator
                        ? `${w.coordinator} owns every item below. You can hand over the whole set without opening them one by one.`
                        : `${w.wing_name} has no coordinator, so this would go to the school admin instead.`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAssignWing({ id: w.wing_id, name: w.wing_name })}
                      className="shrink-0 rounded-[9px] border border-brand-primary bg-brand-primary px-3 py-1.5 text-xs font-bold text-white transition-colors duration-200 hover:bg-brand-primary/90"
                    >
                      Assign all {w.count} to {(w.coordinator ?? "the admin").split(" ").slice(-1)[0]}
                    </button>
                  </div>
                  <ul className="m-0 list-none divide-y divide-surface-stroke border-t border-surface-stroke p-0">
                    {w.items.map((it) => {
                      const sv = SEV[it.severity];
                      return (
                        <li key={it.title} className="p-0">
                        <button
                          type="button"
                          onClick={() => onGoto?.(`sec-${it.goto}`)}
                          disabled={!onGoto}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary disabled:hover:bg-transparent sm:px-[18px]">
                          <span
                            className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-lg text-xs font-extrabold"
                            style={{ color: `hsl(var(${sv.varName}))`, background: `hsl(var(${sv.varName}) / 0.12)` }}
                            aria-hidden
                          >
                            {sv.glyph}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold tracking-[-0.01em] text-ink-900">{it.title}</span>
                            <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">{it.detail}</span>
                          </span>
                          {onGoto && (
                            <span className="self-center whitespace-nowrap text-[11.5px] font-bold text-brand-primary">
                              {it.cta} →
                            </span>
                          )}
                        </button>
                        </li>
                      );
                    })}
                  </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AssignDrawer
        open={!!assignWing}
        onOpenChange={(v) => !v && setAssignWing(null)}
        scope={assignWing ? { wingId: assignWing.id } : null}
        title={`Hand over ${assignWing?.name ?? ""}`}
        subtitle="Everything open in this wing, as one task for its coordinator."
      />
    </V5Card>
  );
}
