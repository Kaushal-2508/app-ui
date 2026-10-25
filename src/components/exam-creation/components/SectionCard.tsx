import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  GripVertical,
} from "lucide-react";
import { QuestionTypeChip, LABEL_MAP } from "./QuestionTypeChip";
import { TypeGroupPill } from "./TypeGroupPill";
import type { ExamSection, ExamMode, SectionType } from "@/types/exam";

const OBJECTIVE_TYPES: SectionType[] = [
  "mcq",
  "true_false",
  "fill_blank",
  "matching",
];
const SUBJECTIVE_TYPES: SectionType[] = [
  "short_answer",
  "long_answer",
  "comprehension",
  "case_study",
];

const DEFAULT_MARKS: Record<SectionType, number> = {
  mcq: 1,
  checkbox: 2,
  true_false: 1,
  fill_blank: 1,
  matching: 2,
  short_answer: 2,
  long_answer: 5,
  comprehension: 4,
  case_study: 4,
};

const DEFAULT_COUNTS: Record<SectionType, number> = {
  mcq: 10,
  checkbox: 5,
  true_false: 5,
  fill_blank: 5,
  matching: 5,
  short_answer: 5,
  long_answer: 3,
  comprehension: 2,
  case_study: 2,
};

interface SectionCardProps {
  section: ExamSection;
  index: number; // 0-based, displayed as letter A, B, C...
  examMode: ExamMode;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<ExamSection>) => void;
  onDelete: () => void;
  /** Auto-focus the title when true (newly created section) */
  autoFocus?: boolean;
}

/**
 * Rich, expandable section card for the exam builder.
 * Collapsed: shows letter, title, marks, type pills.
 * Expanded: inline type picker, count/marks per type, title editor.
 */
export function SectionCard({
  section,
  index,
  examMode,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onDelete,
  autoFocus,
}: SectionCardProps) {
  const letter = String.fromCharCode(65 + index);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-focus title when first expanded (new section)
  useEffect(() => {
    if (isExpanded && autoFocus && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [isExpanded, autoFocus]);

  // Derived data
  const enabledTypes = section.allowedQuestionTypes || [];
  const questionTypeCounts = section.questionTypeCounts || {};
  const questionTypeMarks = section.questionTypeMarks || {};

  const totalQuestions = Object.values(questionTypeCounts).reduce(
    (sum, c) => sum + c,
    0
  );
  const totalMarks = Object.entries(questionTypeCounts).reduce(
    (sum, [type, count]) => sum + count * (questionTypeMarks[type] ?? 1),
    0
  );

  const availableTypes =
    examMode === "online"
      ? OBJECTIVE_TYPES
      : [...OBJECTIVE_TYPES, ...SUBJECTIVE_TYPES];

  // Toggle a question type on/off
  const handleTypeToggle = (type: SectionType) => {
    const isCurrentlyEnabled = enabledTypes.includes(type);
    let newEnabled: SectionType[];
    let newCounts = { ...questionTypeCounts };
    let newMarks = { ...questionTypeMarks };

    if (isCurrentlyEnabled) {
      newEnabled = enabledTypes.filter((t) => t !== type);
      delete newCounts[type];
      delete newMarks[type];
    } else {
      newEnabled = [...enabledTypes, type];
      newCounts[type] = DEFAULT_COUNTS[type] ?? 5;
      newMarks[type] = DEFAULT_MARKS[type] ?? 1;
    }

    onUpdate({
      allowedQuestionTypes: newEnabled,
      questionTypeCounts: newCounts,
      questionTypeMarks: newMarks,
      sectionType: newEnabled[0] ?? "mcq",
    });
  };

  const handleCountChange = (type: string, count: number) => {
    const whole = Math.max(0, Math.round(count));
    onUpdate({
      questionTypeCounts: { ...questionTypeCounts, [type]: whole },
    });
  };

  const handleMarksChange = (type: string, marks: number) => {
    onUpdate({
      questionTypeMarks: {
        ...questionTypeMarks,
        [type]: Math.max(0.25, marks),
      },
    });
  };

  // Gradient accent colors per section letter
  const gradients = [
    "from-teal-500 to-emerald-500",
    "from-violet-500 to-purple-500",
    "from-sky-500 to-blue-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-pink-500",
    "from-indigo-500 to-cyan-500",
  ];
  const gradient = gradients[index % gradients.length];

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border bg-card overflow-hidden transition-all duration-300",
        isExpanded
          ? "shadow-lg ring-1 ring-primary/20"
          : "shadow-sm hover:shadow-md"
      )}
    >
      {/* Gradient left accent */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b",
          gradient
        )}
      />

      {/* Collapsed header — always visible */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        aria-expanded={isExpanded}
      >
        {/* Drag handle placeholder + Letter badge */}
        <div className="flex items-center gap-1.5">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white bg-gradient-to-br",
              gradient
            )}
          >
            {letter}
          </div>
        </div>

        {/* Title + stats */}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">
            {section.title || "Untitled section"}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
            <span>{totalQuestions} questions</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{totalMarks} marks</span>
            {enabledTypes.length > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>{enabledTypes.length} type{enabledTypes.length !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>

        {/* Type pills — collapsed only */}
        {!isExpanded && enabledTypes.length > 0 && (
          <div className="hidden xl:flex flex-wrap gap-1 max-w-[150px]">
            {Object.entries(questionTypeCounts)
              .slice(0, 3)
              .map(([type, count]) => (
                <TypeGroupPill
                  key={type}
                  type={type}
                  count={count}
                  marksPerQuestion={questionTypeMarks[type] ?? 1}
                />
              ))}
            {Object.keys(questionTypeCounts).length > 3 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{Object.keys(questionTypeCounts).length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Expand chevron */}
        <div className="flex-shrink-0">
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 animate-in slide-in-from-top-2 fade-in duration-200 md:px-5 md:pb-5">
          {/* Divider */}
          <div className="border-t border-border" />

          {/* Section title editor */}
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Section title
            </Label>
            <Input
              ref={titleRef}
              value={section.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="e.g. Section A: Objective Questions"
              className="min-h-[44px] font-medium"
            />
          </div>

          {/* Question type picker */}
          <div>
            <Label className="mb-2 block text-xs font-medium text-muted-foreground">
              Question types in this section
            </Label>
            <p className="text-[11px] text-muted-foreground mb-3">
              Tap to add or remove question types. You can mix multiple types in one section.
            </p>

            {/* Objective types */}
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400 mb-1.5">
                Objective
              </div>
              <div className="flex flex-wrap gap-2">
                {OBJECTIVE_TYPES.map((type) => (
                  <QuestionTypeChip
                    key={type}
                    type={type}
                    selected={enabledTypes.includes(type)}
                    onToggle={handleTypeToggle}
                  />
                ))}
              </div>
            </div>

            {/* Subjective types — offline only */}
            {examMode !== "online" && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-1.5">
                  Subjective
                </div>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTIVE_TYPES.map((type) => (
                    <QuestionTypeChip
                      key={type}
                      type={type}
                      selected={enabledTypes.includes(type)}
                      onToggle={handleTypeToggle}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Per-type configuration (count + marks) */}
          {enabledTypes.length > 0 && (
            <div className="space-y-2">
              <Label className="block text-xs font-medium text-muted-foreground">
                Questions & marks per type
              </Label>
              <div className="space-y-2">
                {enabledTypes.map((type) => (
                  <div
                    key={type}
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {LABEL_MAP[type] ?? type}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground mb-0.5">
                          Count
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="w-16 min-h-[36px] text-center text-sm"
                          value={questionTypeCounts[type] ?? 5}
                          onChange={(e) =>
                            handleCountChange(type, Number(e.target.value))
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground mb-0.5">
                          Marks
                        </div>
                        <Input
                          type="number"
                          min={0.25}
                          step={0.25}
                          className="w-16 min-h-[36px] text-center text-sm"
                          value={questionTypeMarks[type] ?? 1}
                          onChange={(e) =>
                            handleMarksChange(type, Number(e.target.value))
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary bar */}
              <div className="flex items-center justify-between rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <div className="flex items-center gap-3 font-semibold">
                  <span>{totalQuestions} Qs</span>
                  <span className="text-primary">{totalMarks} marks</span>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {enabledTypes.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              Tap the question type chips above to configure this section.
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
              <span className="text-xs">Delete</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
