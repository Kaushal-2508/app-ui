import * as React from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HeroTone = "teal" | "violet" | "warm";

const TONE_GRADIENT: Record<HeroTone, string> = {
  teal: "from-brand-primary via-[hsl(183_60%_32%)] to-[hsl(220_45%_22%)]",
  violet: "from-brand-secondary via-[hsl(257_40%_50%)] to-[hsl(258_45%_30%)]",
  warm: "from-[hsl(18_85%_60%)] via-[hsl(28_85%_55%)] to-[hsl(8_70%_45%)]",
};

export interface HeroCardProps {
  /** Tiny uppercase caption above the title (e.g. "Welcome back", "This week"). */
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary CTA button rendered bottom-left of the text column. */
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  /**
   * Optional decorative slot rendered on the right (md+) or below the action
   * (mobile). Pass any ReactNode — typically a large lucide icon or an SVG
   * illustration. Caller is responsible for sizing; the slot is given full
   * width on mobile and ~40% on md+.
   */
  illustration?: React.ReactNode;
  tone?: HeroTone;
  className?: string;
}

/**
 * Feature / CTA hero card. Modeled on the CoachPro "Setup training for next
 * week" card — a saturated dark gradient surface with optional illustration,
 * eyebrow, title, description, and a single primary action.
 *
 * Use for promotional / nudge blocks (next exam, new report, complete your
 * setup, etc.). For metric-value heroes (current balance / open tasks /
 * percentile rank), use HeroSummaryCard instead — it owns that role and
 * already has decorative circles + delta chip + link affordance.
 */
export function HeroCard({
  eyebrow,
  title,
  description,
  action,
  illustration,
  tone = "teal",
  className,
}: HeroCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card text-white",
        "bg-gradient-to-br",
        TONE_GRADIENT[tone],
        "shadow-hero",
        className,
      )}
    >
      {/* Soft decorative spheres for depth — invisible on dark surface but
          add subtle highlight when the gradient catches them. */}
      <span aria-hidden className="pointer-events-none absolute -top-12 -right-10 h-44 w-44 rounded-full bg-white/8" />
      <span aria-hidden className="pointer-events-none absolute -bottom-8 -left-10 h-36 w-36 rounded-full bg-white/5" />

      <div className="relative flex flex-col md:flex-row md:items-center gap-6 p-6 sm:p-7 md:p-8">
        <div className="flex-1 min-w-0 space-y-3">
          {eyebrow && (
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/70">
              {eyebrow}
            </p>
          )}
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{title}</h2>
          {description && (
            <p className="text-sm sm:text-base text-white/80 max-w-prose">{description}</p>
          )}
          {action && (
            <div className="pt-2">
              <Button
                onClick={action.onClick}
                className="bg-white text-ink-900 hover:bg-white/90 rounded-full px-5 py-2 h-auto font-medium shadow-card"
              >
                {action.icon && <span className="mr-2">{action.icon}</span>}
                {action.label}
                {!action.icon && <ArrowRight className="h-4 w-4 ml-2" />}
              </Button>
            </div>
          )}
        </div>

        {illustration && (
          <div className="md:w-2/5 flex items-center justify-center md:justify-end text-white/85">
            {illustration}
          </div>
        )}
      </div>
    </div>
  );
}
