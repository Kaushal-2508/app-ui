import type { ExamFormData, ExamQuestion, ExamSection } from "@/types/exam";

/**
 * Pre-publish checks for the Review step. Pure function over the in-memory
 * draft, so the same rules can be unit-tested without React.
 *
 * "blocking" disables Publish; "warning" is shown but does not block. Keep the
 * split honest: a warning must never be something that would make the exam
 * unanswerable or ungradeable for a student.
 */
export type ReviewIssueSeverity = "blocking" | "warning";

export interface ReviewIssue {
  id: string;
  severity: ReviewIssueSeverity;
  /** Section the issue lives in, null for exam-level issues. */
  sectionTempId: string | null;
  sectionIndex: number | null;
  /** 0-based index within the section, null for section-level issues. */
  questionIndex: number | null;
  message: string;
}

export interface ReviewValidation {
  blocking: ReviewIssue[];
  warnings: ReviewIssue[];
  all: ReviewIssue[];
}

/** Option-bearing types: the answer is one (or more) of the listed options. */
const OPTION_TYPES = new Set(["mcq", "checkbox"]);
/**
 * Types whose answer lives in `correctAnswer` (or, for numerical, a single
 * synthetic option). True/False is here on purpose: AI generation, the
 * question bank and the manual form all store it as `options: null` +
 * `correctAnswer: "True" | "False"`, and the student UI renders fixed radios.
 * Requiring options for it would block every paper that contains one.
 */
const KEYED_TEXT_TYPES = new Set(["fill_blank", "numerical", "true_false"]);
const PASSAGE_TYPES = new Set(["comprehension", "case_study"]);

function sectionLabel(index: number): string {
  return `Section ${String.fromCharCode(65 + index)}`;
}

/**
 * An image the student can actually load. Uploads hand back a public https
 * URL; a `blob:` or `data:` value means the file never reached Storage (the
 * upload failed or is still in flight) and would render as a broken image.
 */
function isStoredImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return /^https?:\/\//i.test(url);
}

/**
 * `exam_questions.options` has TWO shapes in prod (salci-module-notes §9): the
 * current array of option objects, and a legacy letter-keyed map
 * `{ a: "text", b: "text" }` whose answer is the letter in `correctAnswer`.
 * The edit loader passes either through untouched, so never assume an array.
 */
function optionList(q: ExamQuestion): ExamQuestion["options"] {
  return Array.isArray(q.options) ? q.options : null;
}

function optionCount(q: ExamQuestion): number {
  const list = optionList(q);
  if (list) return list.length;
  const raw: unknown = q.options;
  return raw && typeof raw === "object" ? Object.keys(raw as object).length : 0;
}

function hasCorrectAnswer(q: ExamQuestion): boolean {
  // Bank rows can arrive with snake_case `is_correct`; accept both spellings.
  const flagged = optionList(q)?.some((o) => {
    const opt = o as { isCorrect?: boolean; is_correct?: boolean };
    return !!(opt.isCorrect || opt.is_correct);
  });
  if (flagged) return true;
  return !!(q.correctAnswer ?? "").trim();
}

export function validateExamForReview(formData: ExamFormData): ReviewValidation {
  const issues: ReviewIssue[] = [];
  const push = (
    severity: ReviewIssueSeverity,
    section: { tempId: string; index: number } | null,
    questionIndex: number | null,
    message: string,
  ) => {
    issues.push({
      id: `${severity}-${section?.tempId ?? "exam"}-${questionIndex ?? "s"}-${issues.length}`,
      severity,
      sectionTempId: section?.tempId ?? null,
      sectionIndex: section?.index ?? null,
      questionIndex,
      message,
    });
  };

  if (formData.sections.length === 0) {
    push("blocking", null, null, "Add at least one section before publishing.");
  }

  let examTotal = 0;

  formData.sections.forEach((section: ExamSection, sIdx) => {
    const sec = { tempId: section.tempId, index: sIdx };
    const label = sectionLabel(sIdx);

    if (section.questions.length === 0) {
      push("blocking", sec, null, `${label} has no questions.`);
      return;
    }

    let sectionSum = 0;

    section.questions.forEach((q: ExamQuestion, qIdx) => {
      const qLabel = `Q${qIdx + 1} in ${label}`;
      const marks = Number(q.marks);
      sectionSum += Number.isFinite(marks) ? marks : 0;

      if (!q.questionText || q.questionText.trim() === "") {
        push("blocking", sec, qIdx, `${qLabel} has no question text.`);
      }

      if (!Number.isFinite(marks) || marks <= 0) {
        push("blocking", sec, qIdx, `${qLabel} must carry more than 0 marks.`);
      }

      if (OPTION_TYPES.has(q.questionType)) {
        if (optionCount(q) < 2) {
          push("blocking", sec, qIdx, `${qLabel} needs at least two options.`);
        } else if (!hasCorrectAnswer(q)) {
          push("blocking", sec, qIdx, `${qLabel} has no correct answer marked.`);
        }
        optionList(q)?.forEach((o, oi) => {
          if (!isStoredImageUrl(o.imageUrl)) {
            push(
              "blocking",
              sec,
              qIdx,
              `${qLabel}: the image on option ${String.fromCharCode(65 + oi)} did not finish uploading.`,
            );
          }
        });
      } else if (KEYED_TEXT_TYPES.has(q.questionType) && !hasCorrectAnswer(q)) {
        // True/False cannot be marked by hand in the online flow, so a
        // missing answer there blocks; typed answers only warn.
        push(
          q.questionType === "true_false" ? "blocking" : "warning",
          sec,
          qIdx,
          q.questionType === "true_false"
            ? `${qLabel} has no correct answer (True or False) set.`
            : `${qLabel} has no stored answer, so it will need marking by hand.`,
        );
      } else if (PASSAGE_TYPES.has(q.questionType) && (q.subQuestions?.length ?? 0) === 0) {
        push("warning", sec, qIdx, `${qLabel} is a passage with no sub-questions.`);
      }

      if (!isStoredImageUrl(q.imageUrl)) {
        push("blocking", sec, qIdx, `${qLabel}: the diagram did not finish uploading.`);
      }
      q.subQuestions?.forEach((sq, sIdx2) => {
        if (!isStoredImageUrl(sq.imageUrl)) {
          push(
            "blocking",
            sec,
            qIdx,
            `${qLabel}: the diagram on part ${String.fromCharCode(97 + sIdx2)} did not finish uploading.`,
          );
        }
      });
    });

    if (
      section.totalMarks != null &&
      Number.isFinite(section.totalMarks) &&
      Math.abs(section.totalMarks - sectionSum) > 0.001
    ) {
      push(
        "warning",
        sec,
        null,
        `${label} states ${section.totalMarks} marks but its questions add up to ${sectionSum}.`,
      );
    }

    examTotal += sectionSum;
  });

  // No pass-marks rule here on purpose: metadata.passMarks is read as ABSOLUTE
  // marks by ReviewPublishScreen and as a PERCENTAGE by useSaveExam (a
  // pre-existing mismatch, noted 2026-09-04). A check written against either
  // reading would be wrong for the other; fix the units first.
  void examTotal;

  return {
    blocking: issues.filter((i) => i.severity === "blocking"),
    warnings: issues.filter((i) => i.severity === "warning"),
    all: issues,
  };
}
