import type { ExamFormData, ExamStats, ExamSection, ExamQuestion } from "@/types/exam";
import type { InstitutionBranding } from "@/hooks/useInstitutionBranding";
import type {
  ExamPaperData,
  ExamPaperMatching,
  ExamPaperOption,
  ExamPaperQuestion,
  ExamPaperSection,
} from "./types";

interface FetchedExamRow {
  title: string;
  description: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  pass_marks: number | null;
  scheduled_date: string | null;
  instructions: string | null;
}

interface FetchedQuestionRow {
  id: string;
  question_text: string;
  question_type: string;
  marks: number;
  options: unknown;
  question_order: number;
  parent_question_id?: string | null;
  image_url?: string | null;
}

interface FetchedSectionRow {
  id: string;
  title: string;
  section_type: string | null;
  instructions: string | null;
  section_order: number;
  exam_questions: FetchedQuestionRow[];
}

interface ContextLabels {
  className?: string | null;
  subjectName?: string | null;
  scheduledDate?: string | null;
}

function isOptionList(opts: unknown): opts is ExamPaperOption[] {
  return Array.isArray(opts) && opts.every(o => o && typeof o === "object" && "text" in (o as object));
}

function isMatching(opts: unknown): opts is ExamPaperMatching {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) return false;
  const o = opts as Record<string, unknown>;
  return "columnA" in o || "columnB" in o;
}

function buildContextLabels(meta: { title: string; scheduledDate?: string | null }, ctx?: ContextLabels): string[] {
  const labels: string[] = [];
  if (ctx?.className) labels.push(ctx.className);
  if (ctx?.subjectName) labels.push(ctx.subjectName);
  // We intentionally do NOT push the title here — it's rendered separately as the heading.
  const date = ctx?.scheduledDate ?? meta.scheduledDate ?? null;
  if (date) {
    try {
      labels.push(new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }));
    } catch {
      labels.push(date);
    }
  }
  return labels;
}

/**
 * Converts in-editor `ExamFormData` into the canonical `ExamPaperData` shape
 * consumed by the shared preview/print/PDF render. Used by `ExamPreviewPrint`
 * and `OfflinePublishDialog`.
 */
export function fromExamFormData(
  formData: ExamFormData,
  stats: ExamStats,
  branding: InstitutionBranding | null,
  ctx?: ContextLabels,
): ExamPaperData {
  const sections: ExamPaperSection[] = formData.sections.map((s: ExamSection, idx): ExamPaperSection => {
    const marks = s.questions.reduce((sum, q) => sum + (q.marks ?? 0), 0);
    return {
      id: s.id ?? s.tempId ?? `s-${idx}`,
      title: s.title,
      instructions: s.instructions ?? null,
      sectionType: s.sectionType ?? null,
      marks,
      questions: s.questions.map((q: ExamQuestion): ExamPaperQuestion => ({
        id: q.id ?? q.tempId,
        questionText: q.questionText,
        questionType: q.questionType,
        marks: q.marks ?? 0,
        // imageUrl must be carried here: this projection is what the printed
        // paper and the PDF read, so dropping it silently loses every
        // per-option diagram on exactly the surfaces students sit with.
        // isCorrect / correctAnswer ride along ONLY here (the in-editor draft,
        // which the teacher already owns). fromFetchedExam deliberately does
        // not project them, so a DB-backed paper can never grow an answer key
        // by accident.
        options: Array.isArray(q.options)
          ? q.options.map(o => ({
              id: o.id,
              text: o.text,
              imageUrl: o.imageUrl ?? null,
              isCorrect: o.isCorrect ?? false,
            }))
          : null,
        correctAnswer: q.correctAnswer ?? null,
        matching: q.matchingData
          ? { columnA: q.matchingData.columnA ?? [], columnB: q.matchingData.columnB ?? [] }
          : null,
        subQuestions: (q.subQuestions ?? []).map(sq => ({
          id: sq.id ?? sq.tempId,
          questionText: sq.questionText,
          marks: sq.marks ?? 0,
          imageUrl: sq.imageUrl ?? null,
        })),
        imageUrl: q.imageUrl ?? null,
      })),
    };
  });

  return {
    branding,
    meta: {
      title: formData.metadata.title || "Examination",
      description: formData.metadata.description || null,
      durationMinutes: formData.metadata.durationMinutes ?? null,
      totalMarks: stats.totalMarks,
      passMarks: formData.metadata.passMarks ?? null,
      totalQuestions: stats.totalQuestions,
      totalSections: stats.totalSections,
      scheduledDate: formData.metadata.scheduledDate ? formData.metadata.scheduledDate.toISOString() : null,
      instructions: formData.metadata.instructions || null,
      contextLabels: buildContextLabels(
        { title: formData.metadata.title, scheduledDate: formData.metadata.scheduledDate?.toISOString() ?? null },
        ctx,
      ),
    },
    sections,
  };
}

/**
 * Converts a `exams` + `exam_sections + exam_questions` fetch into the canonical
 * `ExamPaperData`. Used by `ExamPreviewDialog` and `DownloadQuestionPaperButton`.
 */
export function fromFetchedExam(
  exam: FetchedExamRow,
  sectionsIn: FetchedSectionRow[],
  branding: InstitutionBranding | null,
  ctx?: ContextLabels,
): ExamPaperData {
  // Filter out comprehension sub-questions (they're rendered nested under parents).
  const sections: ExamPaperSection[] = sectionsIn
    .slice()
    .sort((a, b) => a.section_order - b.section_order)
    .map((s, idx): ExamPaperSection => {
      const sortedQs = (s.exam_questions ?? [])
        .filter(q => !q.parent_question_id)
        .slice()
        .sort((a, b) => a.question_order - b.question_order);

      const questions: ExamPaperQuestion[] = sortedQs.map((q): ExamPaperQuestion => ({
        id: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        marks: q.marks,
        // Project to the display fields ONLY. DB rows authored in the mobile
        // flow carry `isCorrect` inside the options JSONB; passing them through
        // would put the answer key one prop away on every DB-backed surface
        // (student PDFs included). Only fromExamFormData carries correctness.
        options: isOptionList(q.options)
          ? q.options.map((o) => ({ id: o.id, text: o.text, imageUrl: o.imageUrl ?? null }))
          : null,
        matching: isMatching(q.options) ? { columnA: q.options.columnA ?? [], columnB: q.options.columnB ?? [] } : null,
        subQuestions: [],
        imageUrl: q.image_url ?? null,
      }));

      const marks = questions.reduce((sum, q) => sum + (q.marks ?? 0), 0);

      return {
        id: s.id ?? `s-${idx}`,
        title: s.title,
        instructions: s.instructions,
        sectionType: s.section_type,
        marks,
        questions,
      };
    });

  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);
  const totalMarksComputed = sections.reduce((sum, s) => sum + s.marks, 0);

  return {
    branding,
    meta: {
      title: exam.title || "Examination",
      description: exam.description,
      durationMinutes: exam.duration_minutes,
      totalMarks: exam.total_marks ?? totalMarksComputed,
      passMarks: exam.pass_marks,
      totalQuestions,
      totalSections: sections.length,
      scheduledDate: exam.scheduled_date,
      instructions: exam.instructions,
      contextLabels: buildContextLabels({ title: exam.title, scheduledDate: exam.scheduled_date }, ctx),
    },
    sections,
  };
}
