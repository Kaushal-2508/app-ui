/**
 * Shared tone tokens used by StatTile, FeatureTile, EmptyState icon discs,
 * and any future primitive that needs a tinted icon/disc background.
 *
 * Each tone is a pair of Tailwind class fragments: a soft tinted background
 * for the disc, and a saturated foreground color for the icon glyph.
 */
export const TONES = {
  teal:   { bg: "bg-brand-primary/10",   fg: "text-brand-primary" },
  violet: { bg: "bg-brand-secondary/10", fg: "text-brand-secondary" },
  peach:  { bg: "bg-brand-accent/10",    fg: "text-brand-accent" },
  mint:   { bg: "bg-emerald-500/10",     fg: "text-emerald-600" },
  sky:    { bg: "bg-sky-500/10",         fg: "text-sky-600" },
  rose:   { bg: "bg-rose-500/10",        fg: "text-rose-600" },
} as const;

export type Tone = keyof typeof TONES;
