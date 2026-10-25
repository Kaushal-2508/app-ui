/**
 * Deterministic plain-language bands for Syllabus Coverage. No AI, no thresholds beyond the
 * RAG split used elsewhere on the dashboard (<50 behind, 50-80 in progress, >80 on track).
 * The metric is ONLY "Syllabus Coverage" — distinct chapters marked done over total chapters.
 * Never relabel as completion quality, mastery, or progress. British English.
 */

export interface CoverageBand {
  /** Short plain-language label for the chip. */
  label: string;
  /** Chip background + text Tailwind classes. */
  chipClass: string;
  /** Progress-bar fill Tailwind class. */
  barClass: string;
}

export function coverageBand(pct: number | null): CoverageBand {
  if (pct == null) {
    return { label: "Not set up", chipClass: "bg-slate-100 text-slate-600", barClass: "bg-slate-300" };
  }
  if (pct >= 80) {
    return { label: "On track", chipClass: "bg-emerald-100 text-emerald-700", barClass: "bg-emerald-500" };
  }
  if (pct >= 50) {
    return { label: "Underway", chipClass: "bg-amber-100 text-amber-700", barClass: "bg-amber-500" };
  }
  return { label: "Behind", chipClass: "bg-rose-100 text-rose-700", barClass: "bg-rose-500" };
}
