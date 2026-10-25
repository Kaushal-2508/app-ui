/**
 * Tier to Tailwind class maps, shared by every achievements surface.
 *
 * Previously `BAR_FILL` was copy-pasted into BadgeTile and the hero goal card, so
 * a token rename would have updated one bar and not the other. One copy lives
 * here; both components import it.
 *
 * Every value is a literal class string (so the Tailwind JIT scanner emits it)
 * and every colour resolves to a `--tier-*` token defined in BOTH `:root` and
 * `.dark` in src/index.css.
 */

import type { ShieldTier } from "./types";

/** Progress-bar fill per tier. The Radix indicator is a direct `<div>` child. */
export const BAR_FILL: Record<ShieldTier, string> = {
  bronze: "[&>div]:bg-[hsl(var(--tier-bronze-base))]",
  silver: "[&>div]:bg-[hsl(var(--tier-silver-base))]",
  gold: "[&>div]:bg-[hsl(var(--tier-gold-base))]",
  platinum: "[&>div]:bg-[hsl(var(--tier-platinum-base))]",
  diamond: "[&>div]:bg-[hsl(var(--tier-diamond-base))]",
  legendary: "[&>div]:bg-[hsl(var(--tier-legendary-base))]",
};

/** Text on a card surface uses the `-text` ramp, not `-base` (a fill colour). */
export const TIER_TEXT: Record<ShieldTier, string> = {
  bronze: "text-[hsl(var(--tier-bronze-text))]",
  silver: "text-[hsl(var(--tier-silver-text))]",
  gold: "text-[hsl(var(--tier-gold-text))]",
  platinum: "text-[hsl(var(--tier-platinum-text))]",
  diamond: "text-[hsl(var(--tier-diamond-text))]",
  legendary: "text-[hsl(var(--tier-legendary-text))]",
};

/** Tint behind the rarity chip. Only diamond and legendary get a tier tint. */
export const RARITY_CHIP_BG: Record<ShieldTier, string> = {
  bronze: "bg-ink-400/10",
  silver: "bg-ink-400/10",
  gold: "bg-ink-400/10",
  platinum: "bg-ink-400/10",
  diamond: "bg-[hsl(var(--tier-diamond-base)/0.12)]",
  legendary: "bg-[hsl(var(--tier-legendary-glow)/0.14)]",
};

export const TIER_LABEL: Record<ShieldTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
  legendary: "Legendary",
};

/**
 * Tier colours are an EARNED signal. An unearned badge draws its shield from
 * `LOCKED_VISUAL`, so painting its tier label hot pink beside a grey shield
 * defeated the whole earned / unearned read. Unearned falls back to ink.
 */
export function tierTextClass(tier: ShieldTier, earned: boolean): string {
  return earned ? TIER_TEXT[tier] : "text-ink-500";
}

/** Same rule for the rarity chip background. */
export function rarityChipClass(tier: ShieldTier, earned: boolean): string {
  return earned ? RARITY_CHIP_BG[tier] : "bg-ink-400/10";
}
