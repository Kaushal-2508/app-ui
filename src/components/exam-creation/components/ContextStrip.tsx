import { cn } from "@/lib/utils";

interface ContextStripProps {
  sectionTitle: string;
  typeLabel: string;
  remaining: number;
  className?: string;
}

/**
 * Context strip shown at the top of method-picker / sub-flow sheets so the
 * teacher always knows which section + type + how many remain.
 */
export function ContextStrip({ sectionTitle, typeLabel, remaining, className }: ContextStripProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-primary truncate">{sectionTitle}</div>
          <div className="text-xs text-muted-foreground truncate">{typeLabel}</div>
        </div>
        <div className="flex-shrink-0 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold">
          {remaining} remaining
        </div>
      </div>
    </div>
  );
}
