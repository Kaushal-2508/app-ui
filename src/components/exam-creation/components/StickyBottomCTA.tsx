import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface StickyBottomCTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: ReactNode;
  secondary?: ReactNode;
  onSecondaryClick?: () => void;
  helperText?: string;
}

/**
 * Full-width sticky bottom CTA that respects the iOS safe area.
 * Minimum 44px tap target.
 */
export function StickyBottomCTA({
  label,
  secondary,
  onSecondaryClick,
  helperText,
  disabled,
  className,
  ...rest
}: StickyBottomCTAProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur",
        "px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:px-8"
      )}
    >
      {helperText && (
        <p className="mb-2 text-xs text-muted-foreground text-center">{helperText}</p>
      )}
      <div className="flex items-center gap-2 max-w-4xl mx-auto">
        {secondary && (
          <Button
            type="button"
            variant="outline"
            onClick={onSecondaryClick}
            className="min-h-[48px] flex-1"
          >
            {secondary}
          </Button>
        )}
        <Button
          type="button"
          disabled={disabled}
          className={cn(
            "min-h-[48px] font-semibold",
            secondary ? "flex-1" : "w-full",
            className
          )}
          {...rest}
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
