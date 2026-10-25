import { Award, Crown, Gem, Medal, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import type { TeacherMedal } from "./teacher/medals";

/* ────────────────────────────────────────────────────────────────────────
   Geometry. One 160x160 viewBox for every medal so the four line up in the
   ladder strip whatever decoration they carry.

   straps            two bands crossing from the top edge down to y 56
   disc              centre (80, 100), r 54
   inner ring        r 44
   outer ring        r 59, gold and diamond only
   ──────────────────────────────────────────────────────────────────────── */

const STRAP_FAR = "M50 0 H70 L92 56 H72 Z";
const STRAP_NEAR = "M90 0 H110 L88 56 H68 Z";

/**
 * Per-medal artwork. Every value is a literal Tailwind class string so the
 * JIT scanner emits it, and every colour resolves to a `--tier-*` token that
 * is defined in BOTH `:root` and `.dark` in src/index.css. The medal palette
 * is the badge palette on purpose: a Gold Medal and a gold badge are the same
 * gold, so the ladder and the tiles read as one system.
 */
interface MedalVisual {
  stopLight: string;
  stopBase: string;
  stopDeep: string;
  rim: string;
  glyph: string;
  strapFar: string;
  strapNear: string;
  ring: boolean;
  glow: string;
}

const MEDAL_VISUALS: Record<TeacherMedal, MedalVisual> = {
  bronze: {
    stopLight: "[stop-color:hsl(var(--tier-bronze-light))]",
    stopBase: "[stop-color:hsl(var(--tier-bronze-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-bronze-deep))]",
    rim: "[stroke:hsl(var(--tier-bronze-light))]",
    glyph: "text-[hsl(var(--tier-bronze-ink))]",
    strapFar: "[fill:hsl(var(--tier-bronze-deep))]",
    strapNear: "[fill:hsl(var(--tier-bronze-base))]",
    ring: false,
    glow: "",
  },
  silver: {
    stopLight: "[stop-color:hsl(var(--tier-silver-light))]",
    stopBase: "[stop-color:hsl(var(--tier-silver-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-silver-deep))]",
    rim: "[stroke:hsl(var(--tier-silver-light))]",
    glyph: "text-[hsl(var(--tier-silver-ink))]",
    strapFar: "[fill:hsl(var(--tier-silver-deep))]",
    strapNear: "[fill:hsl(var(--tier-silver-base))]",
    ring: false,
    glow: "",
  },
  gold: {
    stopLight: "[stop-color:hsl(var(--tier-gold-light))]",
    stopBase: "[stop-color:hsl(var(--tier-gold-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-gold-deep))]",
    rim: "[stroke:hsl(var(--tier-gold-light))]",
    glyph: "text-[hsl(var(--tier-gold-ink))]",
    strapFar: "[fill:hsl(var(--tier-gold-deep))]",
    strapNear: "[fill:hsl(var(--tier-gold-base))]",
    ring: true,
    glow: "drop-shadow-[0_6px_14px_hsl(var(--tier-gold-base)/0.35)]",
  },
  diamond: {
    stopLight: "[stop-color:hsl(var(--tier-diamond-light))]",
    stopBase: "[stop-color:hsl(var(--tier-diamond-base))]",
    stopDeep: "[stop-color:hsl(var(--tier-diamond-deep))]",
    rim: "[stroke:hsl(var(--tier-diamond-light))]",
    glyph: "text-[hsl(var(--tier-diamond-ink))]",
    strapFar: "[fill:hsl(var(--tier-diamond-deep))]",
    strapNear: "[fill:hsl(var(--tier-diamond-base))]",
    ring: true,
    glow: "drop-shadow-[0_6px_16px_hsl(var(--tier-diamond-base)/0.42)]",
  },
};

/** A medal not yet earned keeps its shape and ribbon, drained of colour. */
const LOCKED_VISUAL: MedalVisual = {
  stopLight: "[stop-color:hsl(var(--tier-locked))]",
  stopBase: "[stop-color:hsl(var(--tier-locked))]",
  stopDeep: "[stop-color:hsl(var(--tier-locked-deep))]",
  rim: "[stroke:hsl(var(--tier-locked-line))]",
  glyph: "text-ink-400",
  strapFar: "[fill:hsl(var(--tier-locked-deep))]",
  strapNear: "[fill:hsl(var(--tier-locked))]",
  ring: false,
  glow: "",
};

/** The glyph on each disc climbs with the medal: laurel, medal, crown, gem. */
const MEDAL_GLYPH: Record<TeacherMedal, LucideIcon> = {
  bronze: Award,
  silver: Medal,
  gold: Crown,
  diamond: Gem,
};

const SIZES = {
  /** Inline, beside text (the Home chip). Too small for a glyph: ribbon and disc only. */
  xs: { box: "h-6 w-6", icon: 0 },
  sm: { box: "h-9 w-9", icon: 13 },
  md: { box: "h-14 w-14", icon: 19 },
  lg: { box: "h-[84px] w-[84px]", icon: 28 },
  xl: { box: "h-[120px] w-[120px]", icon: 38 },
} as const;

export type MedalDiscSize = keyof typeof SIZES;

export interface MedalDiscProps {
  medal: TeacherMedal;
  /** Earned discs are medal-coloured; unearned ones render muted. */
  earned?: boolean;
  size?: MedalDiscSize;
  /**
   * Accessible name. Omit when the disc sits next to the medal name in the
   * DOM, so screen readers do not read it twice.
   */
  label?: string;
  className?: string;
}

/**
 * A round medal on a ribbon, as distinct from the heraldic BadgeShield: a
 * badge is one thing done, a medal is the standing all of them add up to, and
 * the two must never be mistaken for each other on a page that shows both.
 *
 * Decoration climbs with the medal: bronze and silver are a plain disc, gold
 * and diamond add an outer ring and a glow.
 */
export function MedalDisc({ medal, earned = false, size = "md", label, className }: MedalDiscProps) {
  const v = earned ? MEDAL_VISUALS[medal] : LOCKED_VISUAL;
  const { box, icon } = SIZES[size];
  const Glyph = MEDAL_GLYPH[medal];
  // One gradient id per medal and state, never a random one: the disc is
  // rendered in a list of four and in the hero at once, and a duplicated id
  // would make every later disc paint with the first one's colours.
  const gradientId = `medal-disc-${medal}-${earned ? "earned" : "locked"}`;

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
            <stop offset="55%" className={v.stopBase} />
            <stop offset="100%" className={v.stopDeep} />
          </linearGradient>
        </defs>

        {/* Ribbon: the far strap first so the near one crosses over it. */}
        <path d={STRAP_FAR} className={v.strapFar} />
        <path d={STRAP_NEAR} className={v.strapNear} />

        {/* Outer ring, gold and above. */}
        {v.ring && (
          <circle cx="80" cy="100" r="59" strokeWidth={1.2} opacity={0.5} className={v.rim} />
        )}

        {/* The disc. */}
        <circle cx="80" cy="100" r="54" fill={`url(#${gradientId})`} strokeWidth={2.5} className={v.rim} />
        {/* Inner bevel. */}
        <circle
          cx="80"
          cy="100"
          r="44"
          strokeWidth={1.2}
          className="[stroke:hsl(0_0%_100%/0.28)]"
        />
        {/* Top gloss. */}
        <ellipse cx="80" cy="76" rx="30" ry="10" className="[fill:hsl(0_0%_100%/0.16)]" />
      </svg>

      {/* The disc centre sits at 62.5% of the box, below the ribbon. */}
      {icon > 0 && (
        <Glyph
          size={icon}
          className={cn(
            "absolute left-1/2 top-[62.5%] z-[1] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_1px_1px_hsl(0_0%_0%/0.25)]",
            v.glyph,
          )}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
