import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  useDash5BandClasses, useDash5BandDonut,
  type Dash5Band, type Dash5BandSlice,
} from "@/hooks/dashboard/useDash5";

import { ChartTip, TipLine, TipTitle } from "./ChartTip";
import { useChartTip } from "./useChartTip";
import { FilterLabel, FilterSelect, FilterStrip } from "./FilterBar";
import { BAND, pct1 } from "./format";
import {
  BarRow, BarsH, Crumbs, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "./primitives";
import { useScopeFilter } from "./useScopeFilter";

/**
 * The band donut from public/report_reference/salci-admin-dashboard-v5.html.
 *
 * Three levels, as the reference draws them. The ring is REDRAWN at each one,
 * rather than dimming and handing off to a list: bands, then the wings inside a
 * band, then that wing's share against the rest of it, with the classes listed
 * underneath. Redrawing is the point. The question at level two is "which wing
 * is this band coming from", and that is a question about proportions, which is
 * what a ring answers and a bar list does not.
 *
 * Drawn as an SVG arc rather than pulled from a chart library: a few segments
 * and a centre label do not justify shipping Recharts into this route, and an
 * arc keeps its shape at 375px where a library legend would wrap into the plot.
 */

const R_OUT = 130;
const R_IN = 78;
const CX = 150;
const CY = 150;

/** Wing colours, matching the rest of the Students section. */
const WING_TONES = ["--dash-teal", "--brand-secondary", "--dash-exc", "--dash-warning", "--dash-critical"];

/** An SVG arc path for one slice of the ring, drawn clockwise from 12 o'clock. */
function ringSlice(from: number, to: number) {
  // A full circle cannot be drawn as one arc: start and end land on the same
  // point and the path collapses. Two half-arcs is the usual fix.
  if (to - from >= 0.9999) {
    return [
      `M ${CX} ${CY - R_OUT}`, `A ${R_OUT} ${R_OUT} 0 1 1 ${CX} ${CY + R_OUT}`,
      `A ${R_OUT} ${R_OUT} 0 1 1 ${CX} ${CY - R_OUT}`, "Z",
      `M ${CX} ${CY - R_IN}`, `A ${R_IN} ${R_IN} 0 1 0 ${CX} ${CY + R_IN}`,
      `A ${R_IN} ${R_IN} 0 1 0 ${CX} ${CY - R_IN}`, "Z",
    ].join(" ");
  }
  const a0 = from * 2 * Math.PI - Math.PI / 2;
  const a1 = to * 2 * Math.PI - Math.PI / 2;
  const big = to - from > 0.5 ? 1 : 0;
  const p = (r: number, a: number) => `${CX + r * Math.cos(a)} ${CY + r * Math.sin(a)}`;
  return [
    `M ${p(R_OUT, a0)}`,
    `A ${R_OUT} ${R_OUT} 0 ${big} 1 ${p(R_OUT, a1)}`,
    `L ${p(R_IN, a1)}`,
    `A ${R_IN} ${R_IN} 0 ${big} 0 ${p(R_IN, a0)}`,
    "Z",
  ].join(" ");
}

interface Seg {
  key: string;
  label: string;
  n: number;
  color: string;
  onClick?: () => void;
}

export function Dash5BandDonut() {
  const { wingId, wingLocked, chooseWing, wingOptions } = useScopeFilter();
  const q = useDash5BandDonut(wingId);
  const [picked, setPicked] = useState<Dash5Band | null>(null);
  const [wing, setWing] = useState<{ id: string; name: string } | null>(null);

  // On the coordinator console the middle ring would be one slice: "which wing
  // holds these students" has a single answer. So the wing is pre-picked and
  // the ring goes straight from a band to that band's classes.
  const lockedWing = useMemo(
    () => (wingLocked && wingId
      ? { id: wingId, name: wingOptions.find((o) => o.value === wingId)?.label ?? "Your wing" }
      : null),
    [wingLocked, wingId, wingOptions],
  );
  const effWing = lockedWing ?? wing;

  const bands = useMemo(() => q.data?.bands ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const open: Dash5BandSlice | null = picked ? bands.find((b) => b.band === picked) ?? null : null;

  // Only fetched once a wing inside a band is chosen, so the landing view costs
  // one request and the third level costs one more.
  const cls = useDash5BandClasses(picked, effWing?.id ?? null);

  const segs: Seg[] = useMemo(() => {
    if (!open) {
      return bands.filter((b) => b.n > 0).map((b) => ({
        key: b.band,
        label: BAND[b.band].label,
        n: b.n,
        color: `hsl(var(${BAND[b.band].varName}))`,
        onClick: () => { setPicked(b.band); setWing(null); },
      }));
    }
    if (!effWing) {
      return open.by_wing.filter((w) => w.n > 0).map((w, i) => ({
        key: w.wing_id,
        label: w.wing_name,
        n: w.n,
        color: `hsl(var(${WING_TONES[i % WING_TONES.length]}))`,
        onClick: () => setWing({ id: w.wing_id, name: w.wing_name }),
      }));
    }
    const here = open.by_wing.find((w) => w.wing_id === effWing.id)?.n ?? 0;
    // With a wing locked every student in the band is already inside it, so
    // "this wing against the rest of the band" would draw a full circle beside
    // an empty one. Only a principal has a rest to compare against.
    if (lockedWing) {
      return [{ key: "here", label: effWing.name, n: here || open.n,
                color: `hsl(var(${BAND[open.band].varName}))` }];
    }
    return [
      { key: "here", label: effWing.name, n: here, color: `hsl(var(${BAND[open.band].varName}))` },
      { key: "rest", label: "Rest of this band", n: Math.max(0, open.n - here),
        color: "hsl(var(--surface-stroke))" },
    ];
  }, [bands, open, effWing, lockedWing]);

  const segTotal = segs.reduce((a, s) => a + s.n, 0);

  const tip = useChartTip(300, 300);

  /** Anchored at the middle of the slice's arc, not at the centre of the ring,
   *  so the panel points at the wedge the reader is actually over. */
  const showSeg = (s: Seg, from: number, to: number) => {
    const a = ((from + to) / 2) * 2 * Math.PI - Math.PI / 2;
    const r = (R_OUT + R_IN) / 2;
    tip.show(CX + r * Math.cos(a), CY + r * Math.sin(a), (
      <>
        <TipTitle>{s.label}</TipTitle>
        <TipLine>
          {s.n.toLocaleString()} students ·{" "}
          {segTotal > 0 ? `${Math.round((s.n / segTotal) * 100)}%` : "0%"} of this view
        </TipLine>
        {s.onClick && <TipLine dim>click to open</TipLine>}
      </>
    ));
  };

  // Laid out from the running total so the ring always closes, even when
  // rounding would make the percentages add to 99 or 101.
  const laid = useMemo(() => {
    let run = 0;
    return segs.map((s) => {
      const from = run / Math.max(segTotal, 1);
      run += s.n;
      return { s, from, to: run / Math.max(segTotal, 1) };
    });
  }, [segs, segTotal]);

  const centreN = effWing && open
    ? open.by_wing.find((w) => w.wing_id === effWing.id)?.n ?? open.n
    : open ? open.n : total;
  // With a wing locked the ring is already about that wing, so repeating its
  // name in the middle says nothing the header has not. The band does.
  const centreLabel = (lockedWing ? null : wing?.name)
    ?? (open ? BAND[open.band].label.toLowerCase() : "students");

  const subtitle = open
    ? lockedWing
      ? `${centreN.toLocaleString()} of your students sit in ${BAND[open.band].label.toLowerCase()}, listed by class below.`
      : effWing
        ? `${centreN.toLocaleString()} of ${effWing.name}'s students sit in ${BAND[open.band].label.toLowerCase()}, by class.`
        : `${open.n.toLocaleString()} students in this band. Click a wing to see its classes.`
    : lockedWing
      ? `All ${total.toLocaleString()} of your students, bucketed by the band their work sits in. Click a segment for its classes.`
      : `All ${total.toLocaleString()} students, bucketed by the band their work sits in. Click a segment to see which wings it comes from.`;

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[220px]">
          <Crumbs
            items={[
              { label: "All bands", onClick: picked ? () => { setPicked(null); setWing(null); } : undefined },
              ...(open ? [{ label: BAND[open.band].label, onClick: wing ? () => setWing(null) : undefined }] : []),
              ...(wing ? [{ label: wing.name }] : []),
            ]}
          />
          {/* `total` falls back to 0 before the donut lands, and "All 0 of your
              students" beside the spinner read as an empty roster. */}
          {q.data && <p className="mt-1.5 text-xs font-medium text-ink-500">{subtitle}</p>}
        </div>
      </V5CardHead>
      {!wingLocked && (
        <FilterStrip>
          <FilterLabel>Wing</FilterLabel>
          <FilterSelect
            value={wingId}
            onChange={(v) => { chooseWing(v); setPicked(null); setWing(null); }}
            options={wingOptions}
            allLabel="All wings"
          />
        </FilterStrip>
      )}

      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the band breakdown." onRetry={() => void q.refetch()} />
        ) : total === 0 ? (
          <V5Empty title="No students on the roster yet" />
        ) : (
          <div className="flex flex-wrap items-center gap-5">
            <div ref={tip.wrapRef} className="relative mx-auto shrink-0">
            <svg
              ref={tip.svgRef}
              viewBox="0 0 300 300"
              className="mx-auto block h-auto w-[210px] sm:w-[240px]"
              role="img"
              aria-label={`Ring chart of ${centreN} students`}
            >
              {laid.map(({ s, from, to }) => (
                <path
                  key={s.key}
                  d={ringSlice(from, to)}
                  fill={s.color}
                  className={cn("transition-opacity duration-200", s.onClick && "cursor-pointer")}
                  role={s.onClick ? "button" : undefined}
                  tabIndex={s.onClick ? 0 : undefined}
                  onClick={s.onClick}
                  onKeyDown={(e) => {
                    if (s.onClick && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      s.onClick();
                    }
                  }}
                  onPointerEnter={() => showSeg(s, from, to)}
                  onPointerDown={() => showSeg(s, from, to)}
                  onPointerLeave={tip.hide}
                />
              ))}
              <text
                x={CX} y={CY - 6} textAnchor="middle"
                className="fill-ink-900 text-[40px] font-extrabold"
                style={{ letterSpacing: "-0.03em" }}
              >
                {centreN.toLocaleString()}
              </text>
              <text x={CX} y={CY + 22} textAnchor="middle" className="fill-ink-400 text-[14px] font-semibold">
                {centreLabel.length > 16 ? `${centreLabel.slice(0, 15)}…` : centreLabel}
              </text>
            </svg>
            <ChartTip tip={tip.tip} />
            </div>

            <div className="min-w-[180px] flex-1">
              {wing ? (
                cls.isLoading ? (
                  <V5Loading label="Loading classes…" />
                ) : cls.isError ? (
                  <V5Error label="Couldn't load the classes." onRetry={() => void cls.refetch()} />
                ) : (cls.data?.rows.length ?? 0) === 0 ? (
                  <V5Empty title="No class in this wing has students in this band" />
                ) : (
                  <BarsH>
                    {cls.data?.rows.map((r) => (
                      <BarRow
                        key={r.class_id}
                        label={r.class_label}
                        sub={`${r.n} of ${r.of} in the class`}
                        pct={r.pct ?? 0}
                        color={open ? `hsl(var(${BAND[open.band].varName}))` : "hsl(var(--dash-teal))"}
                        value={`${r.n} / ${r.of}`}
                      />
                    ))}
                  </BarsH>
                )
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {segs.map((s) => (
                    <li key={s.key}>
                      <button
                        type="button"
                        onClick={s.onClick}
                        disabled={!s.onClick}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1 text-left",
                          s.onClick && "hover:bg-surface-stroke/40",
                        )}
                      >
                        <i
                          className="mt-[3px] inline-block h-3 w-3 shrink-0 rounded-[4px]"
                          style={{ background: s.color }}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-semibold text-ink-600">
                            {s.label}
                          </span>
                          <span className="block text-[13.5px] font-extrabold tabular-nums text-ink-900">
                            {s.n.toLocaleString()}
                            <span className="ml-1.5 font-bold text-ink-400">
                              {segTotal > 0 ? `${Math.round((s.n / segTotal) * 100)}%` : ""}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-500">
          {wing && open && cls.data
            ? `${pct1(cls.data.in_band > 0 ? (centreN / cls.data.in_band) * 100 : null)} of everyone in this band sits in ${wing.name}.`
            : "A band is the composite of marks, attendance, coverage and lesson plans, not marks alone, which is why a student can sit in Watch on good marks and poor attendance."}
        </p>
      </div>
    </V5Card>
  );
}
