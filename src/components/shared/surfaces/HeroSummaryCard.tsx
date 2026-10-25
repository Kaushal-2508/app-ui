import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, ArrowDownRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface HeroSummaryCardProps {
  /** Top label, e.g. "Welcome back, Tushar 👋" or "This week". */
  eyebrow: string;
  /** Big metric value. */
  value: React.ReactNode;
  /** Description for the value, e.g. "Open Tasks". */
  metric: string;
  delta?: { value: string; direction: "up" | "down" };
  /** Optional link rendered bottom-right ("View all →"). */
  link?: { label: string; to: string };
  className?: string;
}

/**
 * Big teal→violet gradient hero card. Used on the Teacher and Coordinator
 * dashboards only — never on inner pages. Inspired by the credit-card
 * hero in the mobile finance reference.
 */
export function HeroSummaryCard({ eyebrow, value, metric, delta, link, className }: HeroSummaryCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl p-6 text-white",
        "bg-gradient-to-br from-brand-primary to-brand-secondary",
        "shadow-[0_12px_40px_-8px_hsl(var(--brand-primary)/0.45)]",
        className,
      )}
    >
      {/* Decorative floating circles top-right (matches mobile-finance reference) */}
      <span aria-hidden className="pointer-events-none absolute -top-8 -right-8 h-40 w-40 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute top-6 right-16 h-16 w-16 rounded-full bg-white/10" />

      <div className="relative space-y-4">
        <p className="text-sm font-medium text-white/80">{eyebrow}</p>
        <div className="space-y-1">
          <p className="text-4xl font-semibold tabular-nums">{value}</p>
          <p className="text-base text-white/80">{metric}</p>
        </div>
        <div className="flex items-end justify-between gap-4 pt-2">
          {delta ? (
            <div className="inline-flex items-center gap-1 text-sm font-medium">
              {delta.direction === "up" ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              {delta.value}
            </div>
          ) : (
            <span />
          )}
          {link && (
            <Link
              to={link.to}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/25 transition-colors"
            >
              {link.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
