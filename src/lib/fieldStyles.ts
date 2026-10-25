/**
 * The fill every form field wears: Input, Textarea, the Select trigger, and
 * field-like buttons (date / time pickers, comboboxes, file pickers) that show
 * a value.
 *
 * Light mode: a TRANSLUCENT ink overlay, not a fixed grey. A fixed grey only
 * works on one surface: bg-muted (96%) doubled the contrast on a white card
 * but sat just 2% under a dialog (bg-background, 98%), the same faint gap it
 * was meant to fix. 4.5% of --ink-900 darkens whatever is beneath by the same
 * step (white 100% -> 96%, dialog 98% -> ~94%, tinted cards keep their tint),
 * so a field reads the same on every surface. Hover is 10% (white -> ~91%).
 *
 * Dark mode uses the same idea the other way: --ink-900 is near-white there,
 * so 6% of it lifts a field off whatever is beneath (card 15% -> ~20%,
 * dialog 8% -> ~13%), hover 12%. The old dark fill (bg-background) was the
 * dialog's own colour, so in every dark dialog a field had no fill at all.
 *
 * Built only from existing tokens, so every theme that retints them (the
 * .native-shell phone app does) gets its own version with no extra CSS.
 * `enabled:` keeps a disabled field from reacting to the mouse. A call site
 * that passes its own bg-* class keeps it (cn / tailwind-merge).
 */
export const FIELD_FILL =
  "bg-ink-900/[0.045] transition-colors enabled:hover:bg-ink-900/10 dark:bg-ink-900/[0.06] dark:enabled:hover:bg-ink-900/[0.12]";
