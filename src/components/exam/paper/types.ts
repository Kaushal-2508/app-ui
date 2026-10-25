import type { InstitutionBranding } from "@/hooks/useInstitutionBranding";

export interface ExamPaperOption {
  id?: string;
  text: string;
  /** Public URL of this option's own diagram, if any. */
  imageUrl?: string | null;
  /**
   * TEACHER-ONLY. Renderers must ignore this unless the caller explicitly asks
   * for an answer key (`showAnswerKey` / `answerKey`). Never populated on a
   * surface a student can reach.
   */
  isCorrect?: boolean;
}

export interface ExamPaperMatching {
  columnA: string[];
  columnB: string[];
}

export type ExamPaperQuestionType =
  | "mcq"
  | "checkbox"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "long_answer"
  | "matching"
  | "match_column"
  | "comprehension"
  | "case_study"
  | "numerical"
  | string;

export interface ExamPaperSubQuestion {
  id: string;
  questionText: string;
  marks: number;
  /** Public URL of the diagram attached to this sub-question, if any. */
  imageUrl: string | null;
}

export interface ExamPaperQuestion {
  id: string;
  questionText: string;
  questionType: ExamPaperQuestionType;
  marks: number;
  options: ExamPaperOption[] | null;
  matching: ExamPaperMatching | null;
  subQuestions: ExamPaperSubQuestion[];
  /** Public URL of the diagram attached to this question, if any. */
  imageUrl: string | null;
  /**
   * TEACHER-ONLY free-text answer (fill in the blank, numerical, true/false
   * without options). Same rule as `ExamPaperOption.isCorrect`: rendered only
   * behind an explicit answer-key flag.
   */
  correctAnswer?: string | null;
}

export interface ExamPaperSection {
  id: string;
  title: string;
  instructions: string | null;
  sectionType: string | null;
  questions: ExamPaperQuestion[];
  /** Sum of marks across direct questions in this section. */
  marks: number;
}

export interface ExamPaperMeta {
  title: string;
  description: string | null;
  durationMinutes: number | null;
  totalMarks: number;
  passMarks: number | null;
  totalQuestions: number;
  totalSections: number;
  scheduledDate: string | null;
  instructions: string | null;
  /** Free-form labels like "Class 10 A · Mathematics" — populated when the
   *  caller has class/subject context to render in the meta-strip. */
  contextLabels: string[];
}

export interface ExamPaperData {
  branding: InstitutionBranding | null;
  meta: ExamPaperMeta;
  sections: ExamPaperSection[];
}
