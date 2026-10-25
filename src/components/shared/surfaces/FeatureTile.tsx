import * as React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import type { Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface FeatureTileProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Link>, "to" | "className"> {
  icon: React.ReactNode;
  title: string;
  description?: string;
  to: string;
  tone?: Tone;
  className?: string;
}

// Written out in full so Tailwind keeps every class (index.css, "Clay tiles").
const CLAY_TONE: Record<Tone, string> = {
  teal: "clay-tone-teal",
  violet: "clay-tone-violet",
  peach: "clay-tone-peach",
  mint: "clay-tone-mint",
  sky: "clay-tone-sky",
  rose: "clay-tone-rose",
};

const TILE_CLASS = "clay-tile p-4 sm:p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40";

/** The icon's puffy clay pebble on its own, e.g. beside a section title. */
export function ClayPebble({ tone = "teal", size = "md", className, children }: {
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("clay-pebble", size === "sm" && "clay-pebble-sm", CLAY_TONE[tone], className)} aria-hidden="true">
      {children}
    </span>
  );
}

function TileBody({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <>
      <span className="clay-pebble mb-4" aria-hidden="true">
        {icon}
      </span>
      <div className="space-y-1">
        <h3 className="text-base leading-[21px] sm:text-[18px] sm:leading-[24px] font-semibold text-ink-900">{title}</h3>
        {description && (
          <p className="text-[13px] leading-[18px] text-ink-500 line-clamp-2">{description}</p>
        )}
      </div>
      <span className="clay-go" aria-hidden="true">
        <ChevronRight />
      </span>
    </>
  );
}

/**
 * Whole-card link for the dashboard hub grids (Teacher, Coordinator, School Admin,
 * Super Admin and the Olympiad launchers). Click anywhere on the card to navigate.
 *
 * Styled as a "clay tile" (2026-09-29) to match the Clay School 3D banner above it: a
 * soft clay slab washed with its tone in one corner, the icon in a puffy clay pebble,
 * a lift + pebble bounce + arrow on hover, a squish on press. Pure CSS in index.css,
 * no images; every colour is a token in both themes.
 */
export function FeatureTile({ icon, title, description, to, tone = "teal", className, ...rest }: FeatureTileProps) {
  return (
    <Link to={to} className={cn(TILE_CLASS, CLAY_TONE[tone], className)} {...rest}>
      <TileBody icon={icon} title={title} description={description} />
    </Link>
  );
}

export interface FeatureTileButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "type"> {
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  className?: string;
}

/**
 * The same clay tile as a button, for a tile that opens something in place instead of
 * navigating (the School Admin dashboard's category cards open their sub-grid).
 */
export function FeatureTileButton({ icon, title, description, tone = "teal", className, ...rest }: FeatureTileButtonProps) {
  return (
    <button type="button" className={cn(TILE_CLASS, "w-full text-left", CLAY_TONE[tone], className)} {...rest}>
      <TileBody icon={icon} title={title} description={description} />
    </button>
  );
}
