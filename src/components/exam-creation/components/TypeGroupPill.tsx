import { Badge } from "@/components/ui/badge";
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

interface TypeGroupPillProps {
  type: string;
  count: number;
  marksPerQuestion: number;
  className?: string;
}

const LABELS: Record<string, string> = {
  mcq: "MCQ",
  checkbox: "Multi",
  true_false: "T/F",
  fill_blank: "Fill",
  matching: "Match",
  match_column: "Match",
  numerical: "Num",
  comprehension: "Comp",
  case_study: "Case",
  short_answer: "Short",
  long_answer: "Long",
};

const ICONS: Record<string, LucideIcon> = {
  mcq: CheckCircle2,
  checkbox: ListChecks,
  true_false: ToggleLeft,
  fill_blank: FileQuestion,
  short_answer: AlignLeft,
  long_answer: FileText,
  matching: Shuffle,
  match_column: Shuffle,
  comprehension: BookOpen,
  case_study: Briefcase,
};

const OBJECTIVE_TYPES = new Set([
  "mcq",
  "checkbox",
  "true_false",
  "fill_blank",
  "matching",
  "match_column",
  "numerical",
]);

export function TypeGroupPill({ type, count, marksPerQuestion, className }: TypeGroupPillProps) {
  const label = LABELS[type] ?? type;
  const Icon = ICONS[type] ?? CheckCircle2;
  const isObjective = OBJECTIVE_TYPES.has(type);

  return (
    <Badge
      variant="secondary"
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-medium border gap-1 inline-flex items-center",
        isObjective
          ? "bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800"
          : "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800",
        className
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      {label} · {count}×{marksPerQuestion}m
    </Badge>
  );
}
