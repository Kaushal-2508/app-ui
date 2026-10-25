/**
 * Medal to Tailwind class maps, shared by the hero progress card and the ladder.
 *
 * Kept apart from MedalDisc.tsx so that component file exports components only
 * (react-refresh/only-export-components), and apart from teacher/medals.ts so
 * the pure engine carries no presentation. Every value is a literal class
 * string for the JIT scanner, and every colour resolves to a `--tier-*` token
 * defined in BOTH `:root` and `.dark` in src/index.css.
 */

import type { TeacherMedal } from "./teacher/medals";

/** One word, for the strip under the ladder and the ends of the progress bar. */
export const MEDAL_SHORT_LABEL: Record<TeacherMedal, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};

/**
 * The progress bar's fill, pale at the left and saturated at the right, in
 * the colour of the medal being worked toward.
 */
export const MEDAL_BAR_FILL: Record<TeacherMedal, string> = {
  bronze: "bg-gradient-to-r from-[hsl(var(--tier-bronze-light))] to-[hsl(var(--tier-bronze-base))]",
  silver: "bg-gradient-to-r from-[hsl(var(--tier-silver-light))] to-[hsl(var(--tier-silver-base))]",
  gold: "bg-gradient-to-r from-[hsl(var(--tier-gold-light))] to-[hsl(var(--tier-gold-base))]",
  diamond: "bg-gradient-to-r from-[hsl(var(--tier-diamond-light))] to-[hsl(var(--tier-diamond-base))]",
};
