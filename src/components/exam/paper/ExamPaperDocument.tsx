import { forwardRef } from "react";
import { MathText } from "@/components/ui/math-text";
import { hasOptionImages, isRedundantOptionText } from "@/components/exam/optionDisplay";
import { describeAnswer } from "./buildExamPaperHtml";
import type { ExamPaperData, ExamPaperQuestion, ExamPaperSection } from "./types";

/** Teal used for answer-key marks; matches the letterhead accent rule. */
const ANSWER_KEY_COLOR = "#0f766e";

const SUBJECTIVE_TYPES = new Set([
  "short_answer",
  "long_answer",
  "comprehension",
  "case_study",
  "numerical",
  "fill_blank",
]);

interface ExamPaperDocumentProps {
  data: ExamPaperData;
  /** When true, render answer lines under subjective questions for offline papers. */
  isOffline?: boolean;
  /** When true, render the empty "Student Name / Roll No / Class / Date" box on top of the body. */
  showStudentDetailsBox?: boolean;
  /** When true, hide the "End of Question Paper" footer line. */
  hideEndMark?: boolean;
  /**
   * TEACHER-ONLY. Marks correct options and prints an "Answer" line under
   * each question, from `options[].isCorrect` / `correctAnswer`. Only the
   * in-editor draft (`fromExamFormData`) populates those fields. Never pass
   * this on a surface a student can reach.
   */
  showAnswerKey?: boolean;
}

/**
 * Canonical printable preview of an exam paper. Single source of truth used by:
 * - ExamPreviewDialog (browsing an existing exam)
 * - ExamPreviewPrint (editor review-step)
 * - DownloadQuestionPaperButton (download dialog)
 * - OfflinePublishDialog (offline-publish preflight)
 *
 * The header is the institution's letterhead (logo + name + address line +
 * teal accent rule). Footer carries the school contact, not SALCI branding.
 *
 * Math text is rendered via <MathText>; consumers that need printable HTML
 * should use `buildExamPaperHtml` from the sibling module (raw `$...$` falls
 * back to plain text, same as today's print path).
 */
export const ExamPaperDocument = forwardRef<HTMLDivElement, ExamPaperDocumentProps>(function ExamPaperDocument(
  { data, isOffline = false, showStudentDetailsBox = false, hideEndMark = false, showAnswerKey = false },
  ref,
) {
  const { branding, meta, sections } = data;
  const hasLogo = !!branding?.logoUrl;
  const schoolName = branding?.name ?? null;
  const addressLine = branding?.address?.trim() || null;
  const contactBits = [branding?.contactPhone, branding?.contactEmail].filter(Boolean) as string[];

  let qCounter = 0;

  return (
    <div
      ref={ref}
      className="bg-white text-slate-900"
      style={{
        fontFamily: "'Times New Roman', Georgia, serif",
        padding: "32px",
        lineHeight: 1.55,
      }}
    >
      {/* Letterhead */}
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {hasLogo && branding ? (
            <img
              src={branding.logoUrl ?? ""}
              alt={branding.name}
              style={{
                width: 64,
                height: 64,
                objectFit: "contain",
                flexShrink: 0,
              }}
            />
          ) : (
            <div style={{ width: 64, height: 64, flexShrink: 0 }} aria-hidden />
          )}

          <div style={{ flex: 1, textAlign: "center" }}>
            {schoolName ? (
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: "#0f172a",
                  lineHeight: 1.15,
                }}
              >
                {schoolName}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#0f172a",
                }}
              >
                {meta.title}
              </div>
            )}
            {addressLine && (
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                {addressLine}
              </div>
            )}
            {contactBits.length > 0 && (
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                {contactBits.join(" · ")}
              </div>
            )}
          </div>

          {/* Right-side spacer so the centered name visually balances the logo */}
          <div style={{ width: 64, height: 64, flexShrink: 0 }} aria-hidden />
        </div>

        {/* Teal accent rule */}
        <div
          style={{
            height: 2,
            backgroundColor: "#249ca2",
            marginTop: 10,
            borderRadius: 1,
          }}
        />

        {/* Meta strip */}
        {(meta.contextLabels.length > 0 || meta.durationMinutes != null || meta.totalMarks > 0) && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "4px 14px",
              fontSize: 12,
              color: "#334155",
              marginTop: 10,
            }}
          >
            {meta.contextLabels.map((label, i) => (
              <span key={`ctx-${i}`}>{label}</span>
            ))}
            {meta.durationMinutes != null && (
              <span><strong>Duration:</strong> {meta.durationMinutes} min</span>
            )}
            {meta.totalMarks > 0 && (
              <span><strong>Total Marks:</strong> {meta.totalMarks}</span>
            )}
            {meta.passMarks != null && (
              <span><strong>Pass:</strong> {meta.passMarks}%</span>
            )}
            {meta.totalQuestions > 0 && (
              <span><strong>Questions:</strong> {meta.totalQuestions}</span>
            )}
          </div>
        )}

        {/* Exam title — slightly smaller than school name, the school is the brand */}
        <div style={{ textAlign: "center", marginTop: 14 }}>
          {schoolName && (
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#0f172a",
              }}
            >
              {meta.title}
            </div>
          )}
          {meta.description && (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2, fontStyle: "italic" }}>
              {meta.description}
            </div>
          )}
        </div>
      </header>

      {/* General instructions */}
      {meta.instructions && (
        <section
          style={{
            backgroundColor: "#f8fafc",
            borderLeft: "3px solid #249ca2",
            padding: "10px 14px",
            margin: "16px 0",
            fontSize: 12,
            color: "#334155",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>General Instructions</div>
          <p style={{ whiteSpace: "pre-line", margin: 0 }}>{meta.instructions}</p>
        </section>
      )}

      {/* Student details box (offline only, optional) */}
      {showStudentDetailsBox && (
        <section
          style={{
            border: "1px solid #cbd5e1",
            padding: "10px 14px",
            margin: "16px 0",
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 8,
            fontSize: 12,
          }}
        >
          <div><strong>Student Name:</strong> ____________________</div>
          <div><strong>Roll No:</strong> ____________</div>
          <div><strong>Class / Section:</strong> ____________</div>
          <div><strong>Date:</strong> ____________</div>
        </section>
      )}

      {/* Sections */}
      {sections.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            color: "#94a3b8",
            padding: "32px 0",
            fontSize: 13,
          }}
        >
          No questions in this paper yet.
        </div>
      ) : (
        sections.map((section, sectionIdx) => {
          const block = (
            <SectionBlock
              key={section.id}
              section={section}
              sectionIndex={sectionIdx}
              isOffline={isOffline}
              showAnswerKey={showAnswerKey}
              startingQuestionNumber={qCounter + 1}
            />
          );
          qCounter += section.questions.length;
          return block;
        })
      )}

      {/* Footer */}
      <footer
        style={{
          marginTop: 32,
          paddingTop: 14,
          borderTop: "1px solid #e2e8f0",
          textAlign: "center",
          fontSize: 11,
          color: "#64748b",
        }}
      >
        {!hideEndMark && <div style={{ marginBottom: 4 }}>End of Question Paper</div>}
        {schoolName && (
          <div>
            {schoolName}
            {contactBits.length > 0 && <span> · {contactBits.join(" · ")}</span>}
          </div>
        )}
      </footer>
    </div>
  );
});

interface SectionBlockProps {
  section: ExamPaperSection;
  sectionIndex: number;
  isOffline: boolean;
  showAnswerKey: boolean;
  startingQuestionNumber: number;
}

function SectionBlock({ section, sectionIndex, isOffline, showAnswerKey, startingQuestionNumber }: SectionBlockProps) {
  return (
    <section style={{ margin: "20px 0", pageBreakInside: "avoid" }}>
      <header
        style={{
          backgroundColor: "#f1f5f9",
          padding: "8px 12px",
          borderRadius: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontWeight: 700,
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <span>
          Section {String.fromCharCode(65 + sectionIndex)}: {section.title}
        </span>
        <span style={{ fontWeight: 600, color: "#475569" }}>{section.marks} Marks</span>
      </header>

      {section.instructions && (
        <p style={{ fontStyle: "italic", color: "#64748b", margin: "0 0 12px", paddingLeft: 12, fontSize: 12 }}>
          {section.instructions}
        </p>
      )}

      {section.questions.map((question, qIdx) => (
        <QuestionRow
          key={question.id}
          question={question}
          questionNumber={startingQuestionNumber + qIdx}
          isOffline={isOffline}
          showAnswerKey={showAnswerKey}
          sectionType={section.sectionType}
        />
      ))}
    </section>
  );
}

/**
 * Diagram attached to a question or sub-question. Bounded so a large upload
 * can't push the rest of the question off the printed page, and kept inside
 * the question block so `page-break-inside: avoid` keeps figure and stem
 * together.
 */
function QuestionDiagram({ url }: { url: string }) {
  return (
    <div style={{ paddingLeft: 20, marginTop: 8 }}>
      <img
        src={url}
        alt="Question diagram"
        style={{
          display: "block",
          maxWidth: "70%",
          maxHeight: 220,
          objectFit: "contain",
          border: "1px solid #e2e8f0",
        }}
      />
    </div>
  );
}

interface QuestionRowProps {
  question: ExamPaperQuestion;
  questionNumber: number;
  isOffline: boolean;
  showAnswerKey: boolean;
  sectionType: string | null;
}

function QuestionRow({ question, questionNumber, isOffline, showAnswerKey, sectionType }: QuestionRowProps) {
  const isMatchingType = question.questionType === "matching" || question.questionType === "match_column";
  // Options that are pictures rather than text: the picture IS the answer, so
  // it prints large and the placeholder "A"/"B" text is dropped as noise.
  const isImageChoice =
    hasOptionImages(question.options) &&
    (question.options ?? []).every((opt, oi) => isRedundantOptionText(opt.text, oi));

  const showAnswerLines =
    isOffline &&
    (SUBJECTIVE_TYPES.has(question.questionType) ||
      (sectionType ? SUBJECTIVE_TYPES.has(sectionType) : false)) &&
    question.subQuestions.length === 0;

  const answerLineCount = question.questionType === "long_answer" || sectionType === "long_answer" ? 8 : 3;

  return (
    <div style={{ margin: "14px 0", paddingLeft: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 13, flex: 1 }}>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>Q{questionNumber}. </span>
          <MathText as="span" text={question.questionText} />
        </div>
        <span style={{ fontSize: 11, color: "#475569", whiteSpace: "nowrap" }}>
          [{question.marks} mark{question.marks === 1 ? "" : "s"}]
        </span>
      </div>

      {/* Diagram — any question type can carry one */}
      {question.imageUrl && <QuestionDiagram url={question.imageUrl} />}

      {/* MCQ / checkbox / true_false options */}
      {question.options && question.options.length > 0 && !isMatchingType && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "4px 24px",
            paddingLeft: 20,
            marginTop: 6,
            fontSize: 12.5,
          }}
        >
          {question.options.map((opt, oi) => {
            const letter = String.fromCharCode(65 + oi);
            const markCorrect = showAnswerKey && !!opt.isCorrect;
            return (
              <div key={opt.id ?? oi} style={markCorrect ? { color: ANSWER_KEY_COLOR, fontWeight: 700 } : undefined}>
                <strong style={{ marginRight: 6 }}>{letter})</strong>
                {markCorrect && (
                  <span aria-label="Correct option" style={{ marginRight: 4 }}>
                    ✓
                  </span>
                )}
                {!isImageChoice && <MathText as="span" text={opt.text} />}
                {opt.imageUrl && (
                  // An image-CHOICE option prints big enough to compare; a
                  // thumbnail supporting real option text stays inline so four
                  // of them don't push the question across a page break.
                  <img
                    src={opt.imageUrl}
                    alt={`Option ${letter}`}
                    style={
                      isImageChoice
                        ? {
                            display: "block",
                            margin: "4px 0 0 14px",
                            maxHeight: 150,
                            maxWidth: "92%",
                            objectFit: "contain",
                            border: "1px solid #e2e8f0",
                          }
                        : {
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginLeft: 6,
                            maxHeight: 56,
                            maxWidth: 96,
                            objectFit: "contain",
                            border: "1px solid #e2e8f0",
                          }
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Matching grid */}
      {isMatchingType && question.matching && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            paddingLeft: 20,
            marginTop: 6,
            fontSize: 12.5,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Column A</div>
            {question.matching.columnA.map((a, i) => (
              <div key={`a-${i}`}>
                {i + 1}. <MathText as="span" text={a} />
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 700, textDecoration: "underline", marginBottom: 4 }}>Column B</div>
            {question.matching.columnB.map((b, i) => (
              <div key={`b-${i}`}>
                {String.fromCharCode(65 + i)}. <MathText as="span" text={b} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-questions (comprehension / case study) */}
      {question.subQuestions.length > 0 && (
        <div style={{ marginTop: 10, paddingLeft: 16 }}>
          {question.subQuestions.map((sq, sIdx) => (
            <div key={sq.id} style={{ margin: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>
                  Q{questionNumber}{String.fromCharCode(97 + sIdx)}. <MathText as="span" text={sq.questionText} />
                </span>
                <span style={{ fontSize: 11, color: "#475569", whiteSpace: "nowrap" }}>
                  [{sq.marks} mark{sq.marks === 1 ? "" : "s"}]
                </span>
              </div>
              {sq.imageUrl && <QuestionDiagram url={sq.imageUrl} />}
              {isOffline && (
                <div style={{ marginTop: 6 }}>
                  {Array.from({ length: sq.marks <= 2 ? 3 : 6 }).map((_, i) => (
                    <div key={i} style={{ borderBottom: "1px solid #cbd5e1", height: 22, margin: "4px 0" }} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Teacher-only answer line. Correct options are already ticked above;
          this covers typed answers (fill in the blank, numerical) and makes
          the key explicit for every question. */}
      {showAnswerKey && (
        <div style={{ marginTop: 6, paddingLeft: 20, fontSize: 12, color: ANSWER_KEY_COLOR }}>
          <strong>Answer:</strong> <MathText as="span" text={describeAnswer(question)} />
        </div>
      )}

      {/* Answer lines for offline subjective questions without sub-questions */}
      {showAnswerLines && (
        <div style={{ marginTop: 8, paddingLeft: 20 }}>
          {Array.from({ length: answerLineCount }).map((_, i) => (
            <div key={i} style={{ borderBottom: "1px solid #cbd5e1", height: 22, margin: "4px 0" }} />
          ))}
        </div>
      )}
    </div>
  );
}
