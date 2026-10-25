import * as React from "react";

import { Button } from "@/components/ui/button";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Icon rendered inside the tinted disc. Target size: h-7 w-7 (28px) to fill the 64×64 disc. */
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
  /** Documentation-only hint about which empty case is being rendered. Visual treatment is
   * identical across reasons — it's just a signal to the consumer. */
  reason?: "noResults" | "noData" | "error";
  /** "sm" renders a compact version (smaller disc/title/padding) — use inside
   * dense column panels where the default illustrative size feels oversized. */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Centered illustrative empty state. Replaces the bland inline "No X yet"
 * placeholders. The reason prop is documentation-oriented; visual treatment
 * is identical across reasons — it's just a hint to the consumer about
 * which empty case they're rendering.
 */
export function EmptyState({
  icon,
  title,
  description,
  tone = "teal",
  action,
  size = "default",
  className,
}: EmptyStateProps) {
  const t = TONES[tone];
  const sm = size === "sm";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 text-center",
        sm ? "gap-2.5 py-6" : "gap-4 py-10",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-2xl",
          sm ? "h-11 w-11" : "h-16 w-16",
          t.bg,
          t.fg,
        )}
      >
        {icon}
      </span>
      <div className={cn("space-y-1", sm ? "max-w-[240px]" : "max-w-[280px]")}>
        <h3
          className={cn(
            "font-semibold text-ink-700",
            sm ? "text-[15px] leading-[20px]" : "text-[20px] leading-[28px]",
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              "text-ink-500",
              sm ? "text-[12px] leading-[16px]" : "text-[13px] leading-[18px]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          onClick={action.onClick}
          className="bg-brand-primary text-white hover:bg-brand-primary/90 rounded-xl"
        >
          {action.icon && <span className="mr-2">{action.icon}</span>}
          {action.label}
        </Button>
      )}
    </div>
  );
}
