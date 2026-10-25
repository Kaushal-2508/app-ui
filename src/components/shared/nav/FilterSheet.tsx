import * as React from "react";
import { Settings2 } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { cn } from "@/lib/utils";

export interface FilterSheetProps {
  /** How many filters are currently set away from default. Drives the trigger badge. */
  activeCount: number;
  /** Apply the pending filter selections — typically commits state into the parent. */
  onApply: () => void;
  /** Reset filters to defaults. */
  onReset: () => void;
  /** Sheet body — render whatever filter controls (Selects, Switches, RadioGroups) needed. */
  children: React.ReactNode;
  /** Override the trigger label (default "Filters"). */
  triggerLabel?: string;
  className?: string;
}

/**
 * Trigger + bottom sheet for pages with 3+ filters. The trigger renders
 * inline (e.g. inside a FilterRow) — when pressed, opens a MobileSheet
 * with the filter controls and a sticky [Reset] / [Apply] footer.
 */
export function FilterSheet({
  activeCount,
  onApply,
  onReset,
  children,
  triggerLabel = "Filters",
  className,
}: FilterSheetProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 h-10 rounded-full px-4 text-sm font-medium",
          "bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm border border-surface-stroke",
          "hover:bg-ink-400/5 transition-colors duration-200",
          activeCount > 0 && "border-brand-primary text-brand-primary",
          className,
        )}
      >
        <Settings2 className="h-4 w-4" />
        <span>{triggerLabel}</span>
        {activeCount > 0 && (
          <span
            aria-label={`${activeCount} active filters`}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-primary px-1.5 text-xs font-semibold text-white"
          >
            {activeCount}
          </span>
        )}
      </button>

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title={triggerLabel}
        primaryAction={{
          label: "Apply",
          onClick: () => {
            onApply();
            setOpen(false);
          },
        }}
        secondaryAction={{
          label: "Reset",
          onClick: onReset,
        }}
      >
        <div className="space-y-4">{children}</div>
      </MobileSheet>
    </>
  );
}
