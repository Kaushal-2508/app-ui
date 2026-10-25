import * as React from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The three tones of the achievements hero row. The tone is SEMANTIC, not
 * decorative, and that is the whole point of the redesign: the page previously
 * had four pastel stat cards in four unrelated hues, so nothing signalled which
 * number mattered.
 *
 *   teal   - who you are and where you stand. The main element, and the only
 *            one that gets the full-width first row.
 *   orange - momentum: the live streak, the thing that can be lost today.
 *   violet - the goal ahead: the closest badge still to earn.
 *
 * Adding a fourth tone should be treated as a design decision, not a prop
 * value: three is what keeps the row readable.
 */
export type HeroTone = "teal" | "orange" | "violet";

const TONE_CLASS: Record<HeroTone, string> = {
  teal: "hero-card--teal",
  orange: "hero-card--orange",
  violet: "hero-card--violet",
};

export interface HeroCardProps {
  tone: HeroTone;
  /** Small uppercase label above the title. */
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A saturated gradient surface with a dot field, matching the treatment used by
 * the Olympiad school console.
 *
 * Structure only. Every tonal decision lives in the .hero-card* classes in
 * index.css, which are defined in BOTH :root and .dark, so a hero card can
 * never ship a colour that exists in only one theme.
 */
export function HeroCard({ tone, eyebrow, children, className }: HeroCardProps) {
  return (
    <section className={cn("hero-card p-5 sm:p-6", TONE_CLASS[tone], className)}>
      {/* relative + z-10: the dot field is an ::after on the card, so content
          needs its own stacking context to sit above it. */}
      <div className="relative z-10 flex h-full flex-col">
        <p className="hero-eyebrow">{eyebrow}</p>
        {children}
      </div>
    </section>
  );
}

export interface HeroActionProps {
  label: string;
  onClick: () => void;
}

/** The white pill action used at the foot of a hero card. */
export function HeroAction({ label, onClick }: HeroActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hero-action mt-4 self-start px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}