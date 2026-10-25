/**
 * Shared severity color-grading for percentage chips on the Analytics tab
 * (Weakest-concepts rows, Subjects vs Class heatmap, per-student drill-down).
 */
export const pctChip = (pct: number) =>
  pct < 40
    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
    : pct < 60
      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
