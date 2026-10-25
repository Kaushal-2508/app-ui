import type { Tone } from "@/components/shared/design-system";
import type { AdmissionStage } from "@/lib/admissions";

/** Stronger accents than the soft TONES tints (Naman, 2026-10-09: "make it
 *  more highlight"; 2026-10-12: "make it more distinguished"): the header
 *  band, the card's edge and the step chip of a SectionCard or a record
 *  Panel. Written out in full so Tailwind keeps them. */
export const SECTION_ACCENT: Record<Tone, { band: string; edge: string; chip: string }> = {
  teal: { band: "from-teal-500/30 via-teal-500/10", edge: "border-l-teal-500", chip: "bg-teal-500" },
  violet: { band: "from-violet-500/30 via-violet-500/10", edge: "border-l-violet-500", chip: "bg-violet-500" },
  peach: { band: "from-orange-400/35 via-orange-400/10", edge: "border-l-orange-400", chip: "bg-orange-400" },
  mint: { band: "from-emerald-500/30 via-emerald-500/10", edge: "border-l-emerald-500", chip: "bg-emerald-500" },
  sky: { band: "from-sky-500/30 via-sky-500/10", edge: "border-l-sky-500", chip: "bg-sky-500" },
  rose: { band: "from-rose-500/30 via-rose-500/10", edge: "border-l-rose-500", chip: "bg-rose-500" },
};

/** The quiet icon square of a record panel (Naman, 2026-10-12: "more
 *  professional, currently looking a bit childish"): a tinted square and a
 *  coloured glyph, nothing else. Written out in full so Tailwind keeps them. */
export const PANEL_TINT: Record<Tone, string> = {
  teal: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  peach: "bg-orange-400/15 text-orange-700 dark:text-orange-300",
  mint: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** What lifts a record panel off the page without a band or a pebble
 *  (Naman, 2026-10-12: "highlight the boxes more", after "more
 *  professional"): a 2px top edge in the tone and a faint tint behind the
 *  header. Written out in full so Tailwind keeps them. */
export const PANEL_EDGE: Record<Tone, { top: string; head: string }> = {
  teal: { top: "border-t-teal-500", head: "bg-teal-500/[0.06]" },
  violet: { top: "border-t-violet-500", head: "bg-violet-500/[0.06]" },
  peach: { top: "border-t-orange-400", head: "bg-orange-400/[0.08]" },
  mint: { top: "border-t-emerald-500", head: "bg-emerald-500/[0.06]" },
  sky: { top: "border-t-sky-500", head: "bg-sky-500/[0.06]" },
  rose: { top: "border-t-rose-500", head: "bg-rose-500/[0.06]" },
};

/** The tone each stage wears on avatars and chips. */
export const STAGE_TONE: Record<AdmissionStage, Tone> = {
  enquiry: "sky",
  registered: "violet",
  admitted: "mint",
  dropped: "rose",
};

/** The lifted search field of the admin pages (Naman, 2026-10-08). */
export const FIELD_LIFT =
  "border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40";
