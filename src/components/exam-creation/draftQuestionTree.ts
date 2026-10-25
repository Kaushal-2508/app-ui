import type { ExamQuestion, QuestionOption, QuestionType } from "@/types/exam";

/** Shape of one `exam_questions` row as the exam-edit loader selects it. */
export type RawQuestionRow = {
  id: string;
  question_text: string;
  question_type: QuestionType;
  marks: number;
  negative_marks: number | null;
  options: QuestionOption[] | null;
  correct_answer: string | null;
  explanation: string | null;
  difficulty_level: number | null;
  tags: string[] | null;
  image_url: string | null;
  question_order: number | null;
  /** Set on a comprehension / case-study part; null on every standalone question and parent. */
  parent_question_id: string | null;
};

const byOrder = (a: RawQuestionRow, b: RawQuestionRow) =>
  (a.question_order ?? 0) - (b.question_order ?? 0);

function toFormQuestion(q: RawQuestionRow): ExamQuestion {
  return {
    id: q.id,
    tempId: q.id,
    questionText: q.question_text,
    questionType: q.question_type,
    marks: q.marks,
    negativeMarks: q.negative_marks || 0,
    options: q.options ?? null,
    correctAnswer: q.correct_answer,
    explanation: q.explanation,
    difficultyLevel: q.difficulty_level || 1,
    tags: q.tags || [],
    imageUrl: q.image_url || undefined,
  };
}

/**
 * Rebuild a section's questions for the authoring form from its saved rows
 * (work-queue Task 1, 2026-10-05).
 *
 * A comprehension / case-study question is saved as a PARENT row plus one
 * child row per part, each child carrying `parent_question_id` and
 * `question_order = (parentIndex + 1) * 100 + partIndex` (useSaveExam).
 * Reopening a draft used to map every row flat, so three parts came back as
 * three standalone questions, the parent link was lost for good on the next
 * save, marks were counted twice (the parent already holds the sum, see
 * ComprehensionForm "Overwrite marks with the sum") and Review warned about a
 * passage with no sub-questions. This hangs each child off its parent as
 * `subQuestions`, the way `fromFetchedExam` in normalizeExamPaperData does,
 * and never emits a nested child at top level.
 */
export function buildDraftQuestionTree(rowsIn: RawQuestionRow[] | null | undefined): ExamQuestion[] {
  const rows = (rowsIn ?? []).slice().sort(byOrder);
  const parentIds = new Set(rows.filter((q) => !q.parent_question_id).map((q) => q.id));
  const childrenByParent = new Map<string, RawQuestionRow[]>();
  for (const q of rows) {
    if (q.parent_question_id && parentIds.has(q.parent_question_id)) {
      const list = childrenByParent.get(q.parent_question_id) ?? [];
      list.push(q);
      childrenByParent.set(q.parent_question_id, list);
    }
  }
  return (
    rows
      // A child whose parent is not in this section (the parent row was deleted
      // underneath it) stays a standalone question rather than vanishing
      // silently; only children WITH a present parent nest.
      .filter((q) => !q.parent_question_id || !parentIds.has(q.parent_question_id))
      .map((q) => {
        const base = toFormQuestion(q);
        const kids = childrenByParent.get(q.id);
        if (!kids || kids.length === 0) return base;
        return {
          ...base,
          // The DB enum has no case_study: toDbQuestionType saves it as
          // long_answer. A long_answer row that owns parts can only have been a
          // case study (subjective questions never have parts), so give it its
          // authoring type back or it renders as a plain long answer and loses
          // the passage editor. Comprehension round-trips as itself.
          questionType: base.questionType === "long_answer" ? ("case_study" as QuestionType) : base.questionType,
          subQuestions: kids.slice().sort(byOrder).map((k) => ({ ...toFormQuestion(k), parentQuestionId: q.id })),
        };
      })
  );
}
