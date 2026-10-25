import { LayoutGrid, SquareKanban } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useStoredPreference } from "./useStoredPreference";

export const VIEW_MODES = ["cards", "board"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Persisted cards/board preference, one localStorage key per surface. */
export function useViewMode(storageKey: string, fallback: ViewMode = "cards") {
  return useStoredPreference<ViewMode>(storageKey, VIEW_MODES, fallback);
}

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
  /** Label for the non-board option: "Cards" on /tasks, "List" on the support surfaces. */
  cardsLabel?: string;
  className?: string;
}

export function ViewModeToggle({
  value,
  onChange,
  cardsLabel = "Cards",
  className,
}: ViewModeToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        // Radix emits "" when the active item is pressed again; keep the current mode.
        if (next === "cards" || next === "board") onChange(next);
      }}
      aria-label="View"
      className={cn(
        "h-10 shrink-0 gap-0 rounded-full border border-surface-stroke bg-surface-card p-1",
        className,
      )}
    >
      <ToggleGroupItem
        value="cards"
        aria-label={cardsLabel}
        title={cardsLabel}
        className="h-8 min-w-[44px] rounded-full px-3 data-[state=on]:bg-brand-primary data-[state=on]:text-white"
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="ml-2 hidden text-xs font-medium sm:inline">{cardsLabel}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="board"
        aria-label="Board"
        title="Board"
        className="h-8 min-w-[44px] rounded-full px-3 data-[state=on]:bg-brand-primary data-[state=on]:text-white"
      >
        <SquareKanban className="h-4 w-4" />
        <span className="ml-2 hidden text-xs font-medium sm:inline">Board</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
