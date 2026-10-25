import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

export interface SectionTab {
  tempId: string;
  label: string; // e.g. "A", "B"
  title: string;
  actual: number;
  target: number;
}

interface SectionTabStripProps {
  tabs: SectionTab[];
  activeTempId: string | null;
  onSelect: (tempId: string) => void;
  /** Callback when the "+" button is tapped — adds a new section */
  onAddSection?: () => void;
}

/**
 * Horizontally scrollable pill tabs for the Questions screen.
 * Each pill shows its completion count (e.g. "A 14/20").
 * Includes a "+" button at the end to quickly add a new section.
 */
export function SectionTabStrip({
  tabs,
  activeTempId,
  onSelect,
  onAddSection,
}: SectionTabStripProps) {
  if (tabs.length === 0 && !onAddSection) return null;

  return (
    <ScrollArea className="w-full whitespace-nowrap">
      <div className="flex items-center gap-2 px-4 py-3">
        {tabs.map((tab) => {
          const isActive = tab.tempId === activeTempId;
          const complete = tab.target > 0 && tab.actual >= tab.target;
          return (
            <button
              key={tab.tempId}
              type="button"
              onClick={() => onSelect(tab.tempId)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 min-h-[44px] text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background text-foreground border-border hover:bg-muted"
              )}
              aria-pressed={isActive}
              title={tab.title}
            >
              <span className="font-semibold">{tab.label}</span>
              <span
                className={cn(
                  "text-xs",
                  isActive
                    ? "text-primary-foreground/90"
                    : "text-muted-foreground"
                )}
              >
                {tab.actual}/{tab.target}
              </span>
              {complete && (
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    isActive ? "bg-white" : "bg-emerald-500"
                  )}
                  aria-label="Complete"
                />
              )}
            </button>
          );
        })}

        {/* Quick add section button */}
        {onAddSection && (
          <button
            type="button"
            onClick={onAddSection}
            className={cn(
              "inline-flex items-center justify-center rounded-full border border-dashed border-primary/40",
              "h-10 w-10 text-primary/70 hover:text-primary hover:border-primary hover:bg-primary/5",
              "transition-all duration-200"
            )}
            title="Add new section"
            aria-label="Add new section"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
