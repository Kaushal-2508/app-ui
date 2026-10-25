import * as React from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

export interface FilterChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className"> {
  label: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  /** Override the chevron with a custom trailing element. */
  trailing?: React.ReactNode;
}

/**
 * Pill-shaped Select trigger. Use as the visible part of a shadcn Select,
 * or as a standalone button when paired with a popover/sheet.
 *
 * Remaining button attributes are forwarded, so the chip works as an
 * `asChild` trigger for DropdownMenu / Popover, which drive it through
 * pointer and aria props rather than `onClick`.
 */
export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ label, active, onClick, className, trailing, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-pressed={active ?? false}
        {...rest}
        className={cn(
          "inline-flex items-center gap-2 h-10 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors duration-200",
          "bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm border",
          active
            ? "border-brand-primary text-brand-primary hover:bg-brand-primary/5"
            : "border-surface-stroke text-ink-700 hover:bg-ink-400/5",
          className,
        )}
      >
        <span>{label}</span>
        {trailing ?? <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" />}
      </button>
    );
  },
);
FilterChip.displayName = "FilterChip";

export interface FilterRowProps {
  /** Optional active filter count (drives the "Clear all" button visibility). */
  activeCount?: number;
  /** Callback for the "Clear all" affordance. Hidden if activeCount is 0/undefined. */
  onClear?: () => void;
  /** Pass FilterChip / shadcn Select / etc. as children — they sit in a horizontal scroll row on mobile. */
  children: React.ReactNode;
  className?: string;
}

export function FilterRow({ activeCount, onClear, children, className }: FilterRowProps) {
  const showClear = (activeCount ?? 0) > 0 && Boolean(onClear);
  return (
    <div className={cn("flex items-center gap-2 overflow-x-auto scrollbar-hide py-1", className)}>
      {children}
      {showClear && (
        <Button
          type="button"
          variant="outline"
          onClick={onClear}
          className="ml-auto shrink-0 rounded-full border-surface-stroke h-10 text-xs font-medium text-ink-600 hover:bg-ink-400/5"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear all
        </Button>
      )}
    </div>
  );
}
