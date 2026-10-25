import { z } from "zod";
import type { ExamQuestion, QuestionOption, QuestionType } from "@/types/exam";

/** Shared metadata every per-type form collects. */
export const sharedMetaSchema = z.object({
  marks: z.coerce.number().min(0.25, "Marks must be at least 0.25"),
  difficultyLevel: z.coerce.number().int().min(1).max(5),
  explanation: z.string().optional(),
});

export type SharedMeta = z.infer<typeof sharedMetaSchema>;

export interface ManualFormBaseProps {
  /** Question type being authored (used for correct serialization). */
  questionType: QuestionType;
  /** Default marks — taken from the parent section group. */
  defaultMarks: number;
  /** Running section total (used to show the "X → Y" warning when marks are overridden). */
  sectionCurrentTotal?: number;
  /** Section max target (used for the warning). */
  sectionTargetTotal?: number;
  /** Initial values when editing an existing question. */
  initial?: Partial<ExamQuestion>;
  /** Save & close the sheet. */
  onSaveDone: (question: ExamQuestion) => void;
  /** Save & keep the sheet open with a fresh form. */
  onSaveAnother: (question: ExamQuestion) => void;
  /** Cancel out of the form. */
  onCancel: () => void;
}

let idCounter = 0;
export function nextTempId(prefix: string = "q"): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export function optionId(): string {
  return nextTempId("opt");
}

export function buildQuestion(
  questionType: QuestionType,
  meta: SharedMeta,
  partial: Partial<ExamQuestion>
): ExamQuestion {
  return {
    tempId: partial.tempId ?? nextTempId(),
    questionText: partial.questionText ?? "",
    questionType,
    marks: meta.marks,
    negativeMarks: partial.negativeMarks ?? 0,
    options: partial.options ?? null,
    correctAnswer: partial.correctAnswer ?? null,
    explanation: meta.explanation ?? null,
    difficultyLevel: meta.difficultyLevel,
    tags: partial.tags ?? [],
    imageUrl: partial.imageUrl,
    matchingData: partial.matchingData,
    subQuestions: partial.subQuestions,
    parentQuestionId: partial.parentQuestionId,
  };
}

/**
 * Helper to build MCQ options shape.
 *
 * `imageUrl` is omitted entirely rather than written as null when there is no
 * option image, so questions authored without one keep exactly the JSONB shape
 * they had before per-option images existed.
 */
export function makeOption(
  text: string,
  isCorrect = false,
  imageUrl?: string | null,
): QuestionOption {
  const option: QuestionOption = { id: optionId(), text, isCorrect };
  if (imageUrl) option.imageUrl = imageUrl;
  return option;
}
