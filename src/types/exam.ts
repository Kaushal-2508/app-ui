import type { Database } from "@/integrations/supabase/types";

// Database types
export type ExamMode = Database["public"]["Enums"]["exam_mode"];
export type ExamStatus = Database["public"]["Enums"]["exam_status"];

// Base DB question type
export type DbQuestionType = Database["public"]["Enums"]["question_type"];

// Extended QuestionType used by the UI layer.
// DB enum (post-2026-04-07 migration) includes: mcq, short_answer, long_answer,
// true_false, fill_blank, matching, comprehension, numerical, match_column.
// 'checkbox' and 'case_study' remain UI-only variants that map back to DB types.
export type QuestionType = DbQuestionType | "comprehension" | "case_study" | "checkbox" | "numerical" | "match_column";

// Helper function to map extended type to DB type
export function toDbQuestionType(type: QuestionType): DbQuestionType {
  if (type === "case_study") {
    return "long_answer";
  }
  if (type === "checkbox") {
    return "mcq";
  }
  // comprehension, numerical, match_column exist in the DB enum post-migration;
  // cast is safe at runtime — types file may lag the generated Database typings.
  return type as DbQuestionType;
}

// Helper to get compatible DB types for a section
export function getCompatibleDbTypes(sectionType: SectionType): DbQuestionType[] {
  const mapping: Record<SectionType, DbQuestionType[]> = {
    mcq: ["mcq"],
    checkbox: ["mcq"],
    true_false: ["true_false"],
    fill_blank: ["fill_blank"],
    short_answer: ["short_answer"],
    long_answer: ["long_answer"],
    matching: ["matching"],
    comprehension: ["mcq", "short_answer", "long_answer"],
    case_study: ["mcq", "short_answer", "long_answer"],
  };
  return mapping[sectionType] || [];
}

// Section types for structured exam sections
export type SectionType = 
  | "mcq"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "long_answer"
  | "matching"
  | "comprehension"
  | "case_study"
  | "checkbox"; // Added checkbox type

// Form types for wizard
export interface ExamContextFormData {
  institutionId: string;
  classIds: string[];
  subjectIds: string[];
  /** Selected chapter IDs (syllabus_topics rows) for this exam */
  chapterIds: string[];
  topicIds: string[];
  customTopicIds: string[];
}

export interface ProctoringConfig {
  webcam: boolean;
  tabSwitchLock: boolean;
  fullscreenLock: boolean;
  copyPasteDisable: boolean;
}

export const DEFAULT_PROCTORING_CONFIG: ProctoringConfig = {
  webcam: true,
  tabSwitchLock: true,
  fullscreenLock: true,
  copyPasteDisable: true,
};

/**
 * Read `exams.proctoring_config` (JSONB) into a ProctoringConfig.
 *
 * Two key shapes exist in production. The exam creation flow writes camelCase
 * (`tabSwitchLock`); the original column default in migration 20260407120000 is
 * snake_case and all-false:
 *   '{"webcam":false,"tab_switch_lock":false,"fullscreen_lock":false,"copy_paste_disable":false}'
 *
 * As of 2026-07-29, 120 live online exams still carry that default. No teacher
 * ever chose it, and those exams have always run with full proctoring because
 * the attempt page ignored the column entirely. Taking the all-false default at
 * face value would therefore silently strip proctoring from a third of all
 * online exams, so a row without camelCase keys is treated as UNCONFIGURED and
 * falls back to everything-on, preserving the behaviour it has always had.
 *
 * `webcam` is spelled the same in both shapes, so it cannot discriminate them —
 * only the three multi-word keys can.
 */
export function normalizeProctoringConfig(raw: unknown): ProctoringConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PROCTORING_CONFIG };
  }
  const o = raw as Record<string, unknown>;

  const configured =
    "tabSwitchLock" in o || "fullscreenLock" in o || "copyPasteDisable" in o;
  if (!configured) return { ...DEFAULT_PROCTORING_CONFIG };

  // Within a configured row, a missing or non-boolean key defaults to enabled:
  // proctoring should never be dropped by malformed data.
  const read = (camel: string, snake: string): boolean => {
    const v = o[camel] ?? o[snake];
    return typeof v === "boolean" ? v : true;
  };

  return {
    webcam: read("webcam", "webcam"),
    tabSwitchLock: read("tabSwitchLock", "tab_switch_lock"),
    fullscreenLock: read("fullscreenLock", "fullscreen_lock"),
    copyPasteDisable: read("copyPasteDisable", "copy_paste_disable"),
  };
}

export interface HybridExamSettings {
  graceWindowMinutes: number;
  maxPages: number;
  /**
   * Camera-proctor this exam: gates the attempt-page camera prompt and the
   * snapshot monitor. Defaults ON, because hybrid mode's whole premise is a
   * laptop watching while the student writes on paper.
   */
  requireCamera: boolean;
  sheetNumberingInstruction: string;
}

export const DEFAULT_HYBRID_SETTINGS: HybridExamSettings = {
  graceWindowMinutes: 5,
  maxPages: 10,
  requireCamera: true,
  sheetNumberingInstruction:
    "Write the question number above each answer. Write the sheet number in the top-right corner of every page.",
};

export type ResultVisibility = "immediate" | "after_teacher_releases" | "hidden";

/**
 * Hybrid exams are marked by hand, so "immediate" results are impossible — coerce
 * them to after_teacher_releases. Single source of truth shared by useSaveExam +
 * useUpdateExam (paired-hook sync, see CLAUDE.md §10).
 */
export function resolveResultVisibility(
  examMode: ExamMode,
  resultVisibility: ResultVisibility | undefined,
): ResultVisibility {
  const v = resultVisibility ?? "after_teacher_releases";
  if (examMode === "hybrid" && v === "immediate") return "after_teacher_releases";
  return v;
}

// Mirrors the `exams.exam_type` DB column (default 'unspecified'). Drives the
// school-admin dashboard "Exam performance trend" + "Recent exams" widgets.
export type ExamType = "term" | "unit" | "weekly" | "unspecified";

// Uploaded source-paper file reference for the Already-Created offline path.
export interface SourcePaperFile {
  path: string;   // storage path inside the exam-sheets bucket
  name: string;   // original filename
  mime: string;   // content type
  size: number;   // bytes
}

export interface ExamMetadataFormData {
  title: string;
  description: string;
  examMode: ExamMode;
  // Category of the exam (term / unit / weekly / unspecified). Populates the
  // `exams.exam_type` column so dashboard analytics can group by exam kind.
  examType?: ExamType;
  scheduledDate: Date | null;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  passMarks: number | null;
  instructions: string;
  ocrConfidenceThreshold: number;
  // How many minutes after start time students can still enter (late entry window)
  lateEntryMinutes?: number;
  // Legacy — kept for DB mapping; computed from startTime + lateEntryMinutes
  availabilityStart?: Date | null;
  availabilityEnd?: Date | null;
  // Proctoring + publish-time settings
  proctoringConfig?: ProctoringConfig;
  resultVisibility?: ResultVisibility;
  visibleToStudents?: boolean;
  // Hybrid-mode-only configuration. Required at save time when examMode === "hybrid".
  hybridSettings?: HybridExamSettings;
  // Provenance
  templateId?: string | null;
  // ── Already-Created (results-only) offline path ──
  // When true, the exam is an already-conducted paper exam: no questions,
  // one synthetic "Total" section, marks entered inline.
  isResultsOnly?: boolean;
  // Uploaded paper files (optional). Maps to exams.source_paper_files.
  sourcePaperFiles?: SourcePaperFile[];
  // The exam total entered in the result-setup prompt. Overrides the
  // question-derived total when isResultsOnly. Maps to exams.total_marks.
  totalMarksOverride?: number | null;
}

// Matching question structure
export interface MatchingData {
  columnA: string[];
  columnB: string[];
  matches?: string; // e.g., "1-A, 2-B, 3-C"
}

export interface ExamQuestion {
  id?: string;
  tempId: string; // For client-side tracking before save
  questionText: string;
  questionType: QuestionType;
  marks: number;
  negativeMarks: number;
  options: QuestionOption[] | null;
  correctAnswer: string | null;
  explanation: string | null;
  difficultyLevel: number;
  tags: string[];
  // Comprehension parent reference
  parentQuestionId?: string;
  subQuestions?: ExamQuestion[];
  // For matching questions - alternative storage
  matchingData?: MatchingData;
  // Image/diagram URL
  imageUrl?: string;
}

export interface QuestionOption {
  id: string;
  text: string;
  isCorrect?: boolean;
  /**
   * Per-option diagram. Rendered as a small thumbnail beside the option text,
   * deliberately much smaller than the question-level `imageUrl` so four of
   * them don't push the answer controls off the screen.
   *
   * Purely additive in the `options` JSONB: the save paths spread the option
   * object (`{ ...o, text }`) and the legacy `{a,b,c,d}` map shape simply has
   * no image, so nothing needed a migration.
   */
  imageUrl?: string | null;
}

export interface ExamSection {
  id?: string;
  tempId: string;
  sectionType?: SectionType; // Optional/deprecated - sections are now marks-based
  title: string;
  description: string;
  instructions: string;
  sectionOrder: number;
  defaultMarks: number;
  negativeMarking: number;
  // Explicit section total. Used by the results-only path and persisted to
  // exam_sections.total_marks. When undefined, the save path computes it from
  // the section's question marks.
  totalMarks?: number;
  expectedQuestionCount?: number; // Informational guide for paper framework
  questions: ExamQuestion[];
  // Per-section chapter assignment (subset of exam-level chapterIds)
  chapterIds?: string[];
  // Per-section topic selection
  topicIds?: string[];
  customTopicIds?: string[];
  // Study material tagging
  studyMaterialIds?: string[];
  // Allowed question types for this section
  allowedQuestionTypes?: SectionType[];
  // Per-type question counts: e.g. { mcq: 5, true_false: 3 }
  questionTypeCounts?: Record<string, number>;
  // Per-topic distribution within each question type: { mcq: { "topic-1": 4, "topic-2": 6 } }
  topicTypeDistribution?: Record<string, Record<string, number>>;
  // Difficulty level for AI generation
  difficultyLevel?: "easy" | "medium" | "hard";
  // Mobile-first flow additions
  randomizeOrder?: boolean;          // online only
  partialMarksAllowed?: boolean;     // match-the-column only
  negativeMarkingEnabled?: boolean;  // MCQ only; amount lives on question.negativeMarks
  // Type-group marks overrides (marks per question for a given type inside the section)
  questionTypeMarks?: Record<string, number>;
}

// Exam Template — snapshot of an exam for reuse
/** Lightweight blueprint stored inside a template — only structural info, no questions or context. */
export interface TemplateBlueprintSection {
  title: string;
  sectionType: SectionType;
  allowedQuestionTypes: SectionType[];
  questionTypeCounts: Record<string, number>;
  questionTypeMarks: Record<string, number>;
  defaultMarks: number;
  negativeMarking: number;
  instructions?: string;
}

export interface TemplateBlueprint {
  examMode: ExamMode;
  sections: TemplateBlueprintSection[];
}

export interface ExamTemplate {
  id: string;
  institutionId: string;
  name: string;
  description?: string | null;
  subjectId?: string | null;
  /** New lean blueprint (preferred) or legacy full ExamFormData for old templates */
  templateData: TemplateBlueprint | ExamFormData;
  createdBy: string;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

// Offline marks entry row for a student
export interface OfflineSectionMark {
  id?: string;
  attemptId?: string;
  sectionId: string;
  marksObtained: number;
  isAbsent: boolean;
}

export interface EvaluationBlueprint {
  questionId: string;
  tempQuestionId: string;
  maxMarks: number;
  markingScheme: string;
  keywords: string[];
  partialMarkingAllowed: boolean;
  negativeMarking: number;
  aiEvaluationEnabled: boolean;
  aiConfidenceThreshold: number;
  // Enhanced fields per PRD
  coreConcepts: string[];
  expectedStructure: string;
  weightage: BlueprintWeightage[];
}

export interface BlueprintWeightage {
  id: string;
  criterion: string;
  marks: number;
  description: string;
}

// Teacher Override types
export interface TeacherOverride {
  id: string;
  answerId: string;
  teacherId: string;
  teacherName?: string;
  previousMarks: number | null;
  finalMarks: number;
  maxMarks: number;
  feedbackToStudent: string;
  internalNotes: string;
  isAiAccepted: boolean;
  reviewedAt: string;
  /**
   * Read by EvaluationWorkspace to paint the "Auto-graded" banner and purple
   * question circles. Nothing writes it today, so those surfaces are dormant.
   */
  isAutoGraded?: boolean;
}

// AI Evaluation types
export interface AiEvaluation {
  id: string;
  answerId: string;
  suggestedMarks: number;
  maxMarks: number;
  confidenceScore: number;
  matchedKeywords: string[];
  evaluationReasoning: string;
  feedbackSuggestion: string;
  requiresTeacherReview: boolean;
  isAccepted: boolean | null;
  modelUsed: string;
}

// Student Answer with evaluation data
export interface StudentAnswerWithEvaluation {
  id: string;
  attemptId: string;
  questionId: string;
  questionText: string;
  /** Diagram attached to the question — the marker needs it to judge the answer. */
  questionImageUrl: string | null;
  questionType: QuestionType;
  answerText: string | null;
  answerOptions: Record<string, unknown> | null;
  answerSource: "online" | "offline_ocr";
  ocrExtractedText: string | null;
  ocrConfidence: number | null;
  ocrNeedsReview: boolean;
  maxMarks: number;
  // NEW: Include question options and correct answer for evaluation display
  options: QuestionOption[] | null;
  correctAnswer: string | null;
  blueprint: EvaluationBlueprint | null;
  aiEvaluation: AiEvaluation | null;
  teacherOverride: TeacherOverride | null;
}

// Evaluation status for an attempt
export interface AttemptEvaluationStatus {
  attemptId: string;
  studentName: string;
  /** "Roll 12 · Adm AIS/2024/019" — empty when the profile carries neither. */
  studentIdLine: string;
  /** Raw roll number, kept separate from the display line so lists can order by it. */
  studentRollNumber: string | null;
  examTitle: string;
  className: string;
  submittedAt: string;
  totalQuestions: number;
  objectiveQuestions: number;
  subjectiveQuestions: number;
  evaluatedQuestions: number;
  aiEvaluatedCount: number;
  teacherReviewedCount: number;
  pendingReviewCount: number;
  status: "pending" | "ai_processing" | "needs_review" | "in_progress" | "ready_to_finalize" | "finalized";
  isFinalized: boolean;
}

export interface ExamFormData {
  examId?: string; // Track existing exam ID for draft updates
  context: ExamContextFormData;
  metadata: ExamMetadataFormData;
  sections: ExamSection[];
  blueprints: EvaluationBlueprint[];
}

// Wizard step configuration - 4-step flow
export type WizardStep = 
  | "details"      // Step 1: Exam Details (class, subject, title, settings)
  | "sections"     // Step 2: Section Building (paper framework)
  | "questions"    // Step 3: Add Questions
  | "review";      // Step 4: Review, Blueprint & Publish

export interface WizardStepConfig {
  id: WizardStep;
  title: string;
  description: string;
  isComplete: (data: ExamFormData) => boolean;
  canAccess: (data: ExamFormData, currentStep: WizardStep) => boolean;
}

// Validation types
export interface ValidationError {
  field: string;
  message: string;
}

export interface StepValidation {
  isValid: boolean;
  errors: ValidationError[];
}

// Computed exam stats
export interface ExamStats {
  totalSections: number;
  totalQuestions: number;
  totalMarks: number;
  objectiveQuestions: number;
  subjectiveQuestions: number;
  blueprintsCovered: number;
  blueprintsRequired: number;
}

// Section type configuration for UI
export interface SectionTypeConfig {
  label: string;
  icon: string;
  description: string;
  defaultTitle: string;
  defaultInstructions: string;
  defaultMarks: number;
  defaultNegativeMarking: number;
  suggestedTimePerQuestion: number;
  isObjective: boolean;
}

export const SECTION_TYPE_CONFIGS: Record<SectionType, SectionTypeConfig> = {
  mcq: {
    label: "Multiple Choice (MCQ)",
    icon: "CheckCircle2",
    description: "Single correct answer from 4 options",
    defaultTitle: "Multiple Choice Questions",
    defaultInstructions: "Choose the correct option for each question.",
    defaultMarks: 1,
    defaultNegativeMarking: 0.25,
    suggestedTimePerQuestion: 60,
    isObjective: true,
  },
  checkbox: {
    label: "Checkbox (Multi-Select)",
    icon: "ListChecks",
    description: "Multiple correct answers allowed",
    defaultTitle: "Multi-Select Questions",
    defaultInstructions: "Select all correct options for each question.",
    defaultMarks: 2,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 90,
    isObjective: true,
  },
  true_false: {
    label: "True/False",
    icon: "ToggleLeft",
    description: "Mark statements as true or false",
    defaultTitle: "True or False",
    defaultInstructions: "State whether the following statements are True or False.",
    defaultMarks: 1,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 30,
    isObjective: true,
  },
  fill_blank: {
    label: "Fill in the Blanks",
    icon: "FileQuestion",
    description: "Complete sentences with missing words",
    defaultTitle: "Fill in the Blanks",
    defaultInstructions: "Fill in the blanks with appropriate words.",
    defaultMarks: 1,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 45,
    isObjective: true,
  },
  short_answer: {
    label: "Short Answer",
    icon: "AlignLeft",
    description: "Brief 1-2 sentence responses",
    defaultTitle: "Short Answer Questions",
    defaultInstructions: "Answer the following questions briefly in 1-2 sentences.",
    defaultMarks: 2,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 120,
    isObjective: false,
  },
  long_answer: {
    label: "Long Answer",
    icon: "FileText",
    description: "Detailed paragraph or essay responses",
    defaultTitle: "Long Answer Questions",
    defaultInstructions: "Answer the following questions in detail.",
    defaultMarks: 5,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 300,
    isObjective: false,
  },
  matching: {
    label: "Matching",
    icon: "Shuffle",
    description: "Match items from two columns",
    defaultTitle: "Match the Following",
    defaultInstructions: "Match the items in Column A with Column B.",
    defaultMarks: 1,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 60,
    isObjective: true,
  },
  comprehension: {
    label: "Comprehension",
    icon: "BookOpen",
    description: "Reading passage with related questions",
    defaultTitle: "Reading Comprehension",
    defaultInstructions: "Read the passage carefully and answer the questions.",
    defaultMarks: 2,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 180,
    isObjective: false,
  },
  case_study: {
    label: "Case Study",
    icon: "Briefcase",
    description: "Scenario-based analytical questions",
    defaultTitle: "Case Study",
    defaultInstructions: "Read the case study and answer based on your analysis.",
    defaultMarks: 3,
    defaultNegativeMarking: 0,
    suggestedTimePerQuestion: 240,
    isObjective: false,
  },
};
