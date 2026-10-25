import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  ListChecks,
  ToggleLeft,
  FileQuestion,
  AlignLeft,
  FileText,
  Shuffle,
  BookOpen,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import type { SectionType } from "@/types/exam";

const ICON_MAP: Record<SectionType, LucideIcon> = {
  mcq: CheckCircle2,
  checkbox: ListChecks,
  true_false: ToggleLeft,
  fill_blank: FileQuestion,
  short_answer: AlignLeft,
  long_answer: FileText,
  matching: Shuffle,
  comprehension: BookOpen,
  case_study: Briefcase,
};

const LABEL_MAP: Record<SectionType, string> = {
  mcq: "MCQ",
  checkbox: "Multi-Select",
  true_false: "True / False",
  fill_blank: "Fill in Blank",
  short_answer: "Short Answer",
  long_answer: "Long Answer",
  matching: "Match Column",
  comprehension: "Comprehension",
  case_study: "Case Study",
};

const CATEGORY: Record<SectionType, "objective" | "subjective"> = {
  mcq: "objective",
  checkbox: "objective",
  true_false: "objective",
  fill_blank: "objective",
  matching: "objective",
  short_answer: "subjective",
  long_answer: "subjective",
  comprehension: "subjective",
  case_study: "subjective",
};

interface QuestionTypeChipProps {
  type: SectionType;
  selected: boolean;
  onToggle: (type: SectionType) => void;
  className?: string;
}

/**
 * Tappable chip representing a question type. When selected: solid fill.
 * When unselected: subtle outline. Color-coded: teal for objective, violet for subjective.
 */
export function QuestionTypeChip({
  type,
  selected,
  onToggle,
  className,
}: QuestionTypeChipProps) {
  const Icon = ICON_MAP[type] ?? CheckCircle2;
  const label = LABEL_MAP[type] ?? type;
  const cat = CATEGORY[type] ?? "objective";

  const selectedClasses =
    cat === "objective"
      ? "bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-600/25"
      : "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-600/25";

  const unselectedClasses =
    cat === "objective"
      ? "bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-100 dark:hover:bg-teal-900/50"
      : "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/50";

  return (
    <button
      type="button"
      onClick={() => onToggle(type)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 min-h-[36px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        selected ? selectedClasses : unselectedClasses,
        className
      )}
      aria-pressed={selected}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export { ICON_MAP, LABEL_MAP, CATEGORY };
