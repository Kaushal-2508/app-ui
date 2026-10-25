/**
 * Chart chrome for School Analytics.
 *
 * Colour policy, deliberately narrow: every bar and line wears ONE hue
 * (--chart-series). Sort order and a reference line carry the story, so hue
 * never has to. The five score bands are the single exception and use an
 * ordinal ramp of that same hue. Nothing here is a literal colour; every value
 * resolves through a token defined in both :root and .dark, which is what makes
 * the page flip cleanly at night.
 */

export const CHART = {
  series: "hsl(var(--chart-series))",
  seriesSoft: "hsl(var(--chart-series) / 0.16)",
  grid: "hsl(var(--chart-grid))",
  axis: "hsl(var(--chart-axis))",
  tick: "hsl(var(--ink-500))",
  reference: "hsl(var(--ink-400))",
  surface: "hsl(var(--surface-card))",
} as const;

/** Ordinal ramp, lowest band first. Index by band position, never by value. */
export const BAND_FILLS = [
  "hsl(var(--chart-band-1))",
  "hsl(var(--chart-band-2))",
  "hsl(var(--chart-band-3))",
  "hsl(var(--chart-band-4))",
  "hsl(var(--chart-band-5))",
] as const;

// ── Formatters ───────────────────────────────────────────────────────────────

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${Number(value).toFixed(digits)}%`;
}

export function pct0(value: number | null | undefined): string {
  return pct(value, 0);
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return new Intl.NumberFormat("en-IN").format(Number(value));
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Minimum results the previous period must hold before a delta is worth
 * printing. Salci National's academic year has 2,060 results behind it and the
 * period before it has 5: a change computed off five papers is noise wearing an
 * arrow, so below this floor the tile simply shows no delta.
 */
export const MIN_DELTA_SAMPLE = 20;

/** Signed change with an explicit unit, or undefined when there is nothing trustworthy to compare. */
export function delta(
  current: number | null | undefined,
  previous: number | null | undefined,
  previousSample?: number,
): { value: string; direction: "up" | "down" } | undefined {
  if (current === null || current === undefined) return undefined;
  if (previous === null || previous === undefined) return undefined;
  if (previousSample !== undefined && previousSample < MIN_DELTA_SAMPLE) return undefined;
  const diff = Number(current) - Number(previous);
  if (Math.abs(diff) < 0.05) return undefined;
  // Signed, and short enough not to wrap a StatTile at 375px. The sign carries
  // the direction in text, so the arrow and its colour are not the only cue.
  return {
    value: `${diff > 0 ? "+" : "-"}${Math.abs(diff).toFixed(1)} pts`,
    direction: diff > 0 ? "up" : "down",
  };
}

export const AXIS_TICK = { fill: CHART.tick, fontSize: 11 } as const;

export const GRID_PROPS = {
  stroke: CHART.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;
