import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

export type BarDatum = { label: string; value: number };

const AXIS = { fontSize: 12, fill: "hsl(var(--ink-500))" };
const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid hsl(var(--surface-stroke))",
  background: "hsl(var(--surface-card))",
  color: "hsl(var(--ink-900))",
  fontSize: 12,
};

/**
 * Single-series bar chart for the Olympiad report. `horizontal` puts categories
 * on the Y axis (best for subject/topic names). Heights are explicit inline so
 * ResponsiveContainer computes correctly inside flex/grid parents (CLAUDE.md §20a).
 */
export function ReportBarChart({
  data,
  height = 240,
  color = "hsl(var(--brand-primary))",
  horizontal = false,
  domainMax,
  onBarClick,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  horizontal?: boolean;
  domainMax?: number;
  /** Makes bars clickable — called with the bar's label (e.g. a class name). */
  onBarClick?: (label: string) => void;
}) {
  const handleClick = onBarClick
    ? (_: unknown, index: number) => {
        const d = data[index];
        if (d) onBarClick(d.label);
      }
    : undefined;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis type="number" domain={[0, domainMax ?? "auto"]} hide />
            <YAxis type="category" dataKey="label" width={104} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "hsl(var(--ink-500) / 0.08)" }} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} maxBarSize={26}
              onClick={handleClick} cursor={onBarClick ? "pointer" : undefined} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 4 }}>
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <Tooltip cursor={{ fill: "hsl(var(--ink-500) / 0.08)" }} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={48}
              onClick={handleClick} cursor={onBarClick ? "pointer" : undefined} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// Per-row colour cycle for the dot plot — teal then orange first (matching the
// agreed mock), then a few distinct fallbacks. Explicit hex on purpose: the
// --brand-secondary token is now a lilac, not the mock's orange, so we don't
// route this through it (same hardcoded-hex approach as TIER_COLORS below).
const LOLLIPOP_PALETTE = [
  "#249ca2",
  "#fa920e",
  "#8b5cf6",
  "#0ea5e9",
  "#10b981",
  "#f43f5e",
];

/**
 * Lollipop / dot plot for a 0–100 metric across a handful of categories
 * (e.g. average % per class). Each row gets its own colour; a dot sits at the
 * value on a shared 0–100 axis with faint vertical gridlines behind. Built with
 * percentage-positioned layout so it stays responsive without distorting the
 * dots the way a stretched SVG viewBox would. The axis (0–100%) spans the plot
 * column; a w-10 right spacer reserves room so the value label can sit just
 * right of its dot (like the mock) instead of in a detached far-right column.
 * The gridline layer is inset by the gutters (w-20 + gap-3 = 92px on the left,
 * w-10 + gap-3 = 52px on the right) so its ticks line up exactly with the
 * stems. Data-driven offsets are the only inline styles (sanctioned exception).
 */
export function ReportLollipop({
  data,
  onRowClick,
}: {
  data: BarDatum[];
  /** Makes rows clickable — called with the row's label (e.g. a class name). */
  onRowClick?: (label: string) => void;
}) {
  const TICKS = [0, 25, 50, 75, 100];
  const clickable = !!onRowClick;
  return (
    <div className="py-2">
      <div className="relative">
        {/* faint vertical gridlines, aligned to the stem region */}
        <div className="pointer-events-none absolute inset-y-0 left-[92px] right-[52px]">
          {TICKS.map((t) => (
            <div key={t} className="absolute inset-y-0 w-px bg-surface-stroke" style={{ left: `${t}%` }} />
          ))}
        </div>
        {data.map((d, i) => {
          const value = Math.max(0, Math.min(100, d.value));
          const color = LOLLIPOP_PALETTE[i % LOLLIPOP_PALETTE.length];
          return (
            <div
              key={d.label}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onRowClick(d.label) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(d.label);
                      }
                    }
                  : undefined
              }
              className={`flex items-center gap-3 rounded-md py-4 transition-colors ${clickable ? "cursor-pointer hover:bg-ink-400/5" : ""}`}
            >
              <span className="w-20 shrink-0 truncate text-right text-sm font-medium text-ink-900">{d.label}</span>
              <div className="relative h-4 flex-1">
                <div
                  className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                  style={{ width: `${value}%`, backgroundColor: color, opacity: 0.5 }}
                />
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm"
                  style={{ left: `${value}%`, backgroundColor: color }}
                />
                {/* value label sits just to the right of the dot */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-3 text-sm font-semibold tabular-nums"
                  style={{ left: `${value}%`, color }}
                >
                  {Math.round(d.value)}%
                </span>
              </div>
              <span className="w-10 shrink-0" />
            </div>
          );
        })}
      </div>
      {/* x-axis ticks, centred under each gridline */}
      <div className="mt-1 flex items-center gap-3">
        <span className="w-20 shrink-0" />
        <div className="relative h-4 flex-1">
          {TICKS.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 text-[10px] text-ink-400"
              style={{ left: `${t}%` }}
            >
              {t}
            </span>
          ))}
        </div>
        <span className="w-10 shrink-0" />
      </div>
    </div>
  );
}

export type DonutDatum = { key: string; name: string; value: number };

const TIER_COLORS: Record<string, string> = {
  gold: "#f5b301",
  silver: "#9aa3af",
  bronze: "#cd7f32",
  participation: "#38bdf8",
  absent: "#fb7185",
};

/** Donut for the medal/tier distribution. */
export function ReportDonut({
  data,
  onSliceClick,
}: {
  data: DonutDatum[];
  /** Makes slices clickable — called with the slice's key (e.g. "gold"). */
  onSliceClick?: (key: string) => void;
}) {
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={88}
            paddingAngle={2}
            stroke="none"
            onClick={
              onSliceClick
                ? (_: unknown, index: number) => {
                    const d = data[index];
                    if (d) onSliceClick(d.key);
                  }
                : undefined
            }
            cursor={onSliceClick ? "pointer" : undefined}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={TIER_COLORS[d.key] ?? "#94a3b8"} />
            ))}
          </Pie>
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
