import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Three-band difficulty vocabulary shared by the AI Generate sheet and the
 * per-question chip on the Questions step.
 *
 * Storage stays on the 1..5 `difficulty_level` scale the edge function and
 * question_bank already use. The bands map onto the levels the generation
 * prompt describes: Easy = 2 (simple understanding), Medium = 3 (application),
 * Hard = 5 (the long-standing hardest/HOTS default). Reading a stored level
 * back: 1-2 Easy, 3 Medium, 4-5 Hard.
 */
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;
export type DifficultyBand = "easy" | "medium" | "hard";

export const DEFAULT_DIFFICULTY_LEVEL: DifficultyLevel = 5;

export const DIFFICULTY_BANDS: {
  key: DifficultyBand;
  label: string;
  level: DifficultyLevel;
  dotClass: string;
}[] = [
  { key: "easy", label: "Easy", level: 2, dotClass: "bg-emerald-500" },
  { key: "medium", label: "Medium", level: 3, dotClass: "bg-amber-500" },
  { key: "hard", label: "Hard", level: 5, dotClass: "bg-rose-500" },
];

export function bandForLevel(level: number): DifficultyBand {
  if (level <= 2) return "easy";
  if (level === 3) return "medium";
  return "hard";
}

export function levelForBand(band: DifficultyBand): DifficultyLevel {
  return (
    DIFFICULTY_BANDS.find((b) => b.key === band)?.level ??
    DEFAULT_DIFFICULTY_LEVEL
  );
}

export function labelForDifficultyLevel(level: number): string {
  const band = bandForLevel(level);
  return DIFFICULTY_BANDS.find((b) => b.key === band)?.label ?? "Hard";
}

interface DifficultyChipProps {
  /** Stored 1..5 level. */
  level: number;
  /** Called with the new 1..5 level when the author picks a band. */
  onChange: (level: DifficultyLevel) => void;
  /**
   * The chip stands for several questions whose levels differ. Shows
   * "Mixed" with no band selected; picking a band applies it to all of them.
   */
  mixed?: boolean;
  disabled?: boolean;
  className?: string;
}

/** True when a group of levels does not all fall in one band. */
export function isMixedDifficulty(levels: number[]): boolean {
  if (levels.length < 2) return false;
  const first = bandForLevel(levels[0]);
  return levels.some((l) => bandForLevel(l) !== first);
}

/**
 * Compact difficulty control that sits in a question row's metadata line.
 * Renders as a 24px pill (coloured dot + band label + caret) and opens a
 * three-item menu; it never grows beyond one short word so it fits beside
 * the marks text at 375px. Purely presentational: the parent owns the level.
 */
export function DifficultyChip({
  level,
  onChange,
  mixed = false,
  disabled,
  className,
}: DifficultyChipProps) {
  const band = bandForLevel(level);
  const current = DIFFICULTY_BANDS.find((b) => b.key === band) ?? DIFFICULTY_BANDS[2];
  const label = mixed ? "Mixed" : current.label;
  const dotClass = mixed ? "bg-muted-foreground" : current.dotClass;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Difficulty: ${label}. Change difficulty`}
          className={cn(
            "h-6 gap-1 rounded-full px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground",
            className
          )}
        >
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
          {label}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[8rem]">
        <DropdownMenuRadioGroup
          value={mixed ? "" : band}
          onValueChange={(v) => onChange(levelForBand(v as DifficultyBand))}
        >
          {DIFFICULTY_BANDS.map((b) => (
            <DropdownMenuRadioItem key={b.key} value={b.key} className="text-sm">
              <span
                aria-hidden
                className={cn("mr-2 h-2 w-2 rounded-full", b.dotClass)}
              />
              {b.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
