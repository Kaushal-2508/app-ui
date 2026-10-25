import type { Dash5Band } from "@/hooks/dashboard/useDash5";

/**
 * Non-component exports for the v5 dashboard.
 *
 * Kept out of primitives.tsx so that file exports components only: mixing an
 * object constant or a helper into a component module breaks Fast Refresh, and
 * this repo has already had to move one helper out for the same reason.
 */

/** Status is never colour alone: every pill carries a glyph and a word. */
export const BAND: Record<Dash5Band, { label: string; glyph: string; varName: string }> = {
  exc:   { label: "Excellent", glyph: "▲", varName: "--dash-exc" },
  good:  { label: "Good",      glyph: "●", varName: "--dash-good" },
  watch: { label: "Watch",     glyph: "◆", varName: "--dash-warning" },
  att:   { label: "Attention", glyph: "■", varName: "--dash-critical" },
};

export const CH_STATE = {
  done:    { label: "Done",        glyph: "▲", varName: "--dash-exc" },
  partial: { label: "Partly done", glyph: "◆", varName: "--dash-warning" },
  none:    { label: "Not started", glyph: "□", varName: "--ink-400" },
} as const;

export const pct1 = (v: number | null | undefined) => (v == null ? "N/A" : `${v.toFixed(1)}%`);
export const pct0 = (v: number | null | undefined) => (v == null ? "N/A" : `${Math.round(v)}%`);
export const num = (v: number | null | undefined) => (v == null ? "N/A" : v.toLocaleString());
