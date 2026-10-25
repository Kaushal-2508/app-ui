import { useId } from "react";

import { BadgeIcon } from "@/components/badges/BadgeIcon";
import { cn } from "@/lib/utils";

import type { ShieldTier } from "./types";

/* ────────────────────────────────────────────────────────────────────────
   Geometry. One 160x160 viewBox for every tier so shields line up in a grid
   no matter how much decoration they carry.

   center            (80, 80)
   shield            x 28..132, top y ~24.5, tip y 147
   rays  (gold+)     r 56 -> 76, eight lines at 45 degree increments
   ring 1 (diamond+) r 66
   ring 2 (legendary) r 74
   ──────────────────────────────────────────────────────────────────────── */

const SHIELD = "M28 32 Q80 17 132 32 V90 C132 120 108 138 80 147 C52 138 28 120 28 90 Z";
const SHIELD_INNER = "M40 41 Q80 28.5 120 41 V88 C120 112 102 127 80 135 C58 127 40 112 40 88 Z";
const SHIELD_GLOSS = "M28 32 Q80 17 132 32 V56 Q80 74 28 56 Z";
const RAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/**
 * Per-tier artwork. Every value is a literal Tailwind class string so the JIT
 * scanner picks them up, and every colour resolves to a `--tier-*` token that
 * is defined in BOTH `:root` and `.dark` in src/index.css.
 */
interface TierVisual {
  /** linearGradient stops, top to bottom. */
  stopLight: string;
  stopBase: string;
  stopDeep: string;
  /** Shield rim stroke. */
  rim: string;
  /** Glyph colour sitting on the shield. */
  glyph: string;
  /** Ray + ring stroke. */
  spoke: string;
  rays: boolean;
  rings: 0 | 1 | 2;
  /** Outer glow on the whole shield. */
  glow: string;
  /** Legendary only: slow ray rotation + pulsing aura. */
  animated: boolean;
}

const TIER_VISUALS: Record<ShieldTier, TierVisual> = {
  bronze: {
    stopLight: "[stop-color:hsl(var(--tier-bronze-light))]",
    stopBase: "[stop-color:hsl(var(--tier-bronze-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-bronze-deep))]",
    rim: "[stroke:hsl(var(--tier-bronze-light))]",
    glyph: "text-[hsl(var(--tier-bronze-ink))]",
    spoke: "[stroke:hsl(var(--tier-bronze-base))]",
    rays: false,
    rings: 0,
    glow: "",
    animated: false,
  },
  silver: {
    stopLight: "[stop-color:hsl(var(--tier-silver-light))]",
    stopBase: "[stop-color:hsl(var(--tier-silver-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-silver-deep))]",
    rim: "[stroke:hsl(var(--tier-silver-light))]",
    glyph: "text-[hsl(var(--tier-silver-ink))]",
    spoke: "[stroke:hsl(var(--tier-silver-base))]",
    rays: false,
    rings: 0,
    glow: "",
    animated: false,
  },
  gold: {
    stopLight: "[stop-color:hsl(var(--tier-gold-light))]",
    stopBase: "[stop-color:hsl(var(--tier-gold-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-gold-deep))]",
    rim: "[stroke:hsl(var(--tier-gold-light))]",
    glyph: "text-[hsl(var(--tier-gold-ink))]",
    spoke: "[stroke:hsl(var(--tier-gold-base))]",
    rays: true,
    rings: 0,
    glow: "drop-shadow-[0_6px_14px_hsl(var(--tier-gold-base)/0.35)]",
    animated: false,
  },
  platinum: {
    stopLight: "[stop-color:hsl(var(--tier-platinum-light))]",
    stopBase: "[stop-color:hsl(var(--tier-platinum-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-platinum-deep))]",
    rim: "[stroke:hsl(var(--tier-platinum-light))]",
    glyph: "text-[hsl(var(--tier-platinum-ink))]",
    spoke: "[stroke:hsl(var(--tier-platinum-base))]",
    rays: true,
    rings: 0,
    glow: "drop-shadow-[0_6px_14px_hsl(var(--tier-platinum-base)/0.38)]",
    animated: false,
  },
  diamond: {
    stopLight: "[stop-color:hsl(var(--tier-diamond-light))]",
    stopBase: "[stop-color:hsl(var(--tier-diamond-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-diamond-deep))]",
    rim: "[stroke:hsl(var(--tier-diamond-light))]",
    glyph: "text-[hsl(var(--tier-diamond-ink))]",
    spoke: "[stroke:hsl(var(--tier-diamond-base))]",
    rays: true,
    rings: 1,
    glow: "drop-shadow-[0_6px_16px_hsl(var(--tier-diamond-base)/0.42)]",
    animated: false,
  },
  legendary: {
    stopLight: "[stop-color:hsl(var(--tier-legendary-light))]",
    stopBase: "[stop-color:hsl(var(--tier-legendary-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-legendary-deep))]",
    rim: "[stroke:hsl(var(--tier-legendary-light))]",
    glyph: "text-[hsl(var(--tier-legendary-ink))]",
    spoke: "[stroke:hsl(var(--tier-legendary-light))]",
    rays: true,
    rings: 2,
    glow: "drop-shadow-[0_8px_22px_hsl(var(--tier-legendary-glow)/0.55)]",
    animated: true,
  },
};

/** Unearned shields keep the silhouette and the decoration, drained of colour. */
const LOCKED_VISUAL: TierVisual = {
  stopLight: "[stop-color:hsl(var(--tier-locked))]",
  stopBase: "[stop-color:hsl(var(--tier-locked))]",
  stopDeep: "[stop-color:hsl(var(--tier-locked-deep))]",
  rim: "[stroke:hsl(var(--tier-locked-line))]",
  glyph: "text-ink-400",
  spoke: "[stroke:hsl(var(--tier-locked-line))]",
  rays: false,
  rings: 0,
  glow: "",
  animated: false,
};

const SIZES = {
  sm: { box: "h-11 w-11", icon: 15 },
  md: { box: "h-[60px] w-[60px]", icon: 20 },
  lg: { box: "h-[84px] w-[84px]", icon: 28 },
  xl: { box: "h-[112px] w-[112px]", icon: 38 },
} as const;

export type BadgeShieldSize = keyof typeof SIZES;

export interface BadgeShieldProps {
  tier: ShieldTier;
  /** `badge_definitions.icon_name`, resolved through the shared BadgeIcon map. */
  iconName: string;
  /** Earned shields are tier-coloured; unearned ones render muted. */
  earned?: boolean;
  size?: BadgeShieldSize;
  /**
   * Accessible name. Omit when the shield sits next to the badge name in the
   * DOM (BadgeTile does), so screen readers do not read it twice.
   */
  label?: string;
  className?: string;
}

/**
 * The badge frame: a heraldic shield, not a circle.
 *
 * Tier treatment, in ascending rarity:
 *   bronze, silver  flat shield, no decoration
 *   gold, platinum  + eight radiating rays at 45 degree increments
 *   diamond         + one thin orbital ring
 *   legendary       + a second ring, a molten gold rim over a deep violet
 *                     body, a pulsing aura and a very slow ray rotation
 *
 * Movement is itself a tier signal: only legendary animates, and only when
 * the viewer has not asked for reduced motion (the keyframes in index.css
 * live inside a `prefers-reduced-motion: no-preference` block).
 */
export function BadgeShield({
  tier,
  iconName,
  earned = false,
  size = "md",
  label,
  className,
}: BadgeShieldProps) {
  const uid = useId().replace(/:/g, "");
  const gradientId = `shield-body-${uid}`;
  const auraId = `shield-aura-${uid}`;
  const v = earned ? TIER_VISUALS[tier] : LOCKED_VISUAL;
  const { box, icon } = SIZES[size];

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", box, className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        viewBox="0 0 160 160"
        fill="none"
        className={cn("absolute inset-0 h-full w-full", v.glow)}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className={v.stopLight} />
            <stop offset="52%" className={v.stopBase} />
            <stop offset="100%" className={v.stopDeep} />
          </linearGradient>
          {v.animated && (
            <radialGradient id={auraId}>
              <stop
                offset="45%"
                className="[stop-color:hsl(var(--tier-legendary-glow))]"
                stopOpacity={0.55}
              />
              <stop
                offset="100%"
                className="[stop-color:hsl(var(--tier-legendary-glow))]"
                stopOpacity={0}
              />
            </radialGradient>
          )}
        </defs>

        {/* Legendary aura, behind everything. */}
        {v.animated && (
          <circle cx="80" cy="80" r="70" fill={`url(#${auraId})`} className="badge-glow-pulse" />
        )}

        {/* Eight rays, gold and above. */}
        {v.rays && (
          <g className={cn("badge-rays", v.animated && "badge-rays-rotate")} opacity={0.85}>
            {RAY_ANGLES.map((angle) => (
              <line
                key={angle}
                x1="80"
                y1="24"
                x2="80"
                y2="4"
                strokeWidth={1.6}
                strokeLinecap="round"
                transform={`rotate(${angle} 80 80)`}
                className={v.spoke}
              />
            ))}
          </g>
        )}

        {/* Orbital rings: one for diamond, two for legendary. */}
        {v.rings >= 1 && (
          <circle cx="80" cy="80" r="66" strokeWidth={1.1} opacity={0.55} className={v.spoke} />
        )}
        {v.rings >= 2 && (
          <circle cx="80" cy="80" r="74" strokeWidth={0.8} opacity={0.32} className={v.spoke} />
        )}

        {/* Shield body. */}
        <path d={SHIELD} fill={`url(#${gradientId})`} strokeWidth={2} className={v.rim} />
        {/* Inner bevel. */}
        <path
          d={SHIELD_INNER}
          fill="none"
          strokeWidth={1.1}
          className="[stroke:hsl(0_0%_100%/0.24)]"
        />
        {/* Top gloss. */}
        <path d={SHIELD_GLOSS} className="[fill:hsl(0_0%_100%/0.14)]" />
      </svg>

      <BadgeIcon
        iconName={iconName}
        size={icon}
        className={cn("relative z-[1] drop-shadow-[0_1px_1px_hsl(0_0%_0%/0.25)]", v.glyph)}
      />
    </span>
  );
}
