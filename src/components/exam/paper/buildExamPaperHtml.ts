import { renderTextWithMathToHtml } from "@/lib/renderMathInHtml";
import { hasOptionImages, isRedundantOptionText } from "@/components/exam/optionDisplay";
import type { ExamPaperData, ExamPaperQuestion, ExamPaperSection } from "./types";

const SUBJECTIVE_TYPES = new Set([
  "short_answer",
  "long_answer",
  "comprehension",
  "case_study",
  "numerical",
  "fill_blank",
]);

export interface BuildExamPaperHtmlOptions {
  /** When provided, replaces the network URL on `branding.logoUrl` with this
   *  data: URL so the logo renders without auth headers / network access in
   *  print windows and html2pdf invocations. Caller should pre-resolve via
   *  `loadLogoDataUrl`. */
  logoDataUrl?: string | null;
  /** When true, render answer lines under subjective questions. */
  isOffline?: boolean;
  /** When true, render the empty "Student Name / Roll No / Class / Date" box. */
  showStudentDetailsBox?: boolean;
  /** Optional document title for the browser tab. Defaults to `data.meta.title`. */
  documentTitle?: string;
  /**
   * When true, append a separate "Answer Key" page after the paper. Uses
   * `options[].isCorrect` and `correctAnswer`, which only `fromExamFormData`
   * populates. TEACHER-ONLY: never pass this for anything a student can open.
   */
  answerKey?: boolean;
}

function escapeHtml(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOptions(question: ExamPaperQuestion): string {
  if (!question.options || question.options.length === 0) return "";
  if (question.questionType === "matching" || question.questionType === "match_column") return "";

  // When the options are pictures rather than text, the picture IS the answer
  // and has to print big enough to tell apart. A supporting thumbnail beside
  // real option text stays small so four of them don't break the page.
  const imageChoice =
    hasOptionImages(question.options) &&
    question.options.every((opt, oi) => isRedundantOptionText(opt.text, oi));

  const items = question.options
    .map((opt, oi) => {
      const letter = String.fromCharCode(65 + oi);
      const img = opt.imageUrl
        ? `<img class="${imageChoice ? "opt-diagram-lg" : "opt-diagram"}" src="${escapeHtml(opt.imageUrl)}" alt="Option ${letter}" />`
        : "";
      const text = imageChoice ? "" : ` ${renderTextWithMathToHtml(opt.text)}`;
      return `<div><strong>${letter})</strong>${text}${img}</div>`;
    })
    .join("");

  return `<div class="options-grid">${items}</div>`;
}

function renderMatching(question: ExamPaperQuestion): string {
  if (!question.matching) return "";
  const a = question.matching.columnA
    .map((v, i) => `<div>${i + 1}. ${renderTextWithMathToHtml(v)}</div>`)
    .join("");
  const b = question.matching.columnB
    .map((v, i) => `<div>${String.fromCharCode(65 + i)}. ${renderTextWithMathToHtml(v)}</div>`)
    .join("");
  return `<div class="matching-grid">
    <div><div class="matching-head">Column A</div>${a}</div>
    <div><div class="matching-head">Column B</div>${b}</div>
  </div>`;
}

/** Diagram attached to a question or sub-question. Any type can carry one. */
function renderDiagram(url: string | null | undefined): string {
  if (!url) return "";
  return `<div class="q-diagram"><img src="${escapeHtml(url)}" alt="Question diagram" /></div>`;
}

function renderAnswerLines(lineCount: number): string {
  return `<div class="answer-lines">${Array.from({ length: lineCount })
    .map(() => `<div class="answer-line"></div>`)
    .join("")}</div>`;
}

function renderSubQuestions(question: ExamPaperQuestion, questionNumber: number, isOffline: boolean): string {
  if (question.subQuestions.length === 0) return "";
  return `<div class="subquestions">${question.subQuestions
    .map((sq, sIdx) => `
      <div class="subquestion">
        <div class="q-row">
          <div class="q-text">
            <strong>Q${questionNumber}${String.fromCharCode(97 + sIdx)}.</strong> ${renderTextWithMathToHtml(sq.questionText)}
          </div>
          <span class="q-marks">[${sq.marks} mark${sq.marks === 1 ? "" : "s"}]</span>
        </div>
        ${renderDiagram(sq.imageUrl)}
        ${isOffline ? renderAnswerLines(sq.marks <= 2 ? 3 : 6) : ""}
      </div>
    `)
    .join("")}</div>`;
}

function renderQuestion(
  question: ExamPaperQuestion,
  questionNumber: number,
  sectionType: string | null,
  isOffline: boolean,
): string {
  const isMatching = question.questionType === "matching" || question.questionType === "match_column";
  const showAnswerLines =
    isOffline &&
    question.subQuestions.length === 0 &&
    (SUBJECTIVE_TYPES.has(question.questionType) ||
      (sectionType ? SUBJECTIVE_TYPES.has(sectionType) : false));
  const lineCount = question.questionType === "long_answer" || sectionType === "long_answer" ? 8 : 3;

  return `<div class="question">
    <div class="q-row">
      <div class="q-text">
        <strong>Q${questionNumber}.</strong> ${renderTextWithMathToHtml(question.questionText)}
      </div>
      <span class="q-marks">[${question.marks} mark${question.marks === 1 ? "" : "s"}]</span>
    </div>
    ${renderDiagram(question.imageUrl)}
    ${renderOptions(question)}
    ${isMatching ? renderMatching(question) : ""}
    ${renderSubQuestions(question, questionNumber, isOffline)}
    ${showAnswerLines ? renderAnswerLines(lineCount) : ""}
  </div>`;
}

function renderSection(section: ExamPaperSection, sectionIndex: number, startingNumber: number, isOffline: boolean): string {
  const questionsHtml = section.questions
    .map((q, qIdx) => renderQuestion(q, startingNumber + qIdx, section.sectionType, isOffline))
    .join("");

  const instructions = section.instructions
    ? `<p class="section-instructions">${escapeHtml(section.instructions)}</p>`
    : "";

  return `<section class="paper-section">
    <header class="section-header">
      <span>Section ${String.fromCharCode(65 + sectionIndex)}: ${escapeHtml(section.title)}</span>
      <span class="section-marks">${section.marks} Marks</span>
    </header>
    ${instructions}
    ${questionsHtml}
  </section>`;
}

function renderLetterhead(data: ExamPaperData, logoDataUrl: string | null | undefined): string {
  const { branding, meta } = data;
  const schoolName = branding?.name ?? null;
  const addressLine = branding?.address?.trim() || null;
  const contactBits = [branding?.contactPhone, branding?.contactEmail].filter(Boolean) as string[];

  const logoHtml = logoDataUrl
    ? `<img class="letterhead-logo" src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(branding?.name ?? "")}" />`
    : `<div class="letterhead-spacer" aria-hidden="true"></div>`;

  const metaParts: string[] = [];
  for (const label of meta.contextLabels) metaParts.push(escapeHtml(label));
  if (meta.durationMinutes != null) metaParts.push(`<strong>Duration:</strong> ${meta.durationMinutes} min`);
  if (meta.totalMarks > 0) metaParts.push(`<strong>Total Marks:</strong> ${meta.totalMarks}`);
  if (meta.passMarks != null) metaParts.push(`<strong>Pass:</strong> ${meta.passMarks}%`);
  if (meta.totalQuestions > 0) metaParts.push(`<strong>Questions:</strong> ${meta.totalQuestions}`);

  return `<header class="letterhead">
    <div class="letterhead-row">
      ${logoHtml}
      <div class="letterhead-center">
        ${schoolName
          ? `<div class="school-name">${escapeHtml(schoolName)}</div>`
          : `<div class="school-name fallback">${escapeHtml(meta.title)}</div>`}
        ${addressLine ? `<div class="school-address">${escapeHtml(addressLine)}</div>` : ""}
        ${contactBits.length > 0 ? `<div class="school-contact">${contactBits.map(escapeHtml).join(" · ")}</div>` : ""}
      </div>
      <div class="letterhead-spacer" aria-hidden="true"></div>
    </div>
    <div class="accent-rule"></div>
    ${metaParts.length > 0 ? `<div class="meta-strip">${metaParts.map(p => `<span>${p}</span>`).join("")}</div>` : ""}
    <div class="exam-title-block">
      ${schoolName ? `<div class="exam-title">${escapeHtml(meta.title)}</div>` : ""}
      ${meta.description ? `<div class="exam-description">${escapeHtml(meta.description)}</div>` : ""}
    </div>
  </header>`;
}

function renderInstructions(data: ExamPaperData): string {
  if (!data.meta.instructions) return "";
  return `<section class="general-instructions">
    <div class="gi-title">General Instructions</div>
    <p>${escapeHtml(data.meta.instructions)}</p>
  </section>`;
}

function renderStudentBox(): string {
  return `<section class="student-box">
    <div><strong>Student Name:</strong> ____________________</div>
    <div><strong>Roll No:</strong> ____________</div>
    <div><strong>Class / Section:</strong> ____________</div>
    <div><strong>Date:</strong> ____________</div>
  </section>`;
}

/**
 * One line per question: the correct option letter(s) when the options carry
 * `isCorrect`, else the free-text `correctAnswer`, else "Teacher-marked"
 * (subjective questions have no stored answer). Sub-questions carry no answer
 * in the paper model, so a comprehension parent shows as teacher-marked.
 */
export function describeAnswer(question: ExamPaperQuestion): string {
  const letters = (question.options ?? [])
    .map((opt, oi) => (opt.isCorrect ? String.fromCharCode(65 + oi) : null))
    .filter((l): l is string => l !== null);
  const objective =
    question.questionType === "mcq" ||
    question.questionType === "checkbox" ||
    question.questionType === "true_false";
  if (objective && letters.length > 0) return letters.join(", ");
  const text = (question.correctAnswer ?? "").trim();
  if (text) return text;
  if (letters.length > 0) return letters.join(", ");
  return "Teacher-marked";
}

function renderAnswerKey(data: ExamPaperData): string {
  let qCounter = 0;
  const rows = data.sections
    .map((section, sIdx) => {
      const items = section.questions
        .map((q) => {
          qCounter += 1;
          return `<tr><td class="ak-q">Q${qCounter}</td><td>${renderTextWithMathToHtml(describeAnswer(q))}</td></tr>`;
        })
        .join("");
      return `<tr class="ak-section"><td colspan="2">Section ${String.fromCharCode(65 + sIdx)}: ${escapeHtml(section.title)}</td></tr>${items}`;
    })
    .join("");
  return `<section class="answer-key">
    <div class="ak-title">Answer Key</div>
    <div class="ak-subtitle">${escapeHtml(data.meta.title)} · For the examiner only</div>
    <table class="ak-table"><tbody>${rows}</tbody></table>
  </section>`;
}

function renderFooter(data: ExamPaperData): string {
  const { branding } = data;
  const contactBits = [branding?.contactPhone, branding?.contactEmail].filter(Boolean) as string[];
  return `<footer class="paper-footer">
    <div>End of Question Paper</div>
    ${branding?.name
      ? `<div>${escapeHtml(branding.name)}${contactBits.length > 0 ? " · " + contactBits.map(escapeHtml).join(" · ") : ""}</div>`
      : ""}
  </footer>`;
}

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Times New Roman', Georgia, serif; color: #0f172a; line-height: 1.55; padding: 32px; max-width: 800px; margin: 0 auto; }
  .letterhead { margin-bottom: 18px; }
  .letterhead-row { display: flex; align-items: center; gap: 16px; }
  .letterhead-logo { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
  .letterhead-spacer { width: 64px; height: 64px; flex-shrink: 0; }
  .letterhead-center { flex: 1; text-align: center; }
  .school-name { font-size: 22px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #0f172a; line-height: 1.15; }
  .school-name.fallback { font-size: 18px; text-transform: none; }
  .school-address { font-size: 12px; color: #475569; margin-top: 2px; }
  .school-contact { font-size: 11px; color: #64748b; margin-top: 1px; }
  .accent-rule { height: 2px; background-color: #249ca2; margin-top: 10px; border-radius: 1px; }
  .meta-strip { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; font-size: 12px; color: #334155; margin-top: 10px; }
  .exam-title-block { text-align: center; margin-top: 14px; }
  .exam-title { font-size: 16px; font-weight: 700; color: #0f172a; }
  .exam-description { font-size: 12px; color: #475569; margin-top: 2px; font-style: italic; }
  .general-instructions { background-color: #f8fafc; border-left: 3px solid #249ca2; padding: 10px 14px; margin: 16px 0; font-size: 12px; color: #334155; }
  .gi-title { font-weight: 700; margin-bottom: 4px; }
  .general-instructions p { white-space: pre-line; margin: 0; }
  .student-box { border: 1px solid #cbd5e1; padding: 10px 14px; margin: 16px 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12px; }
  .paper-section { margin: 20px 0; }
  .section-header { background-color: #f1f5f9; padding: 8px 12px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; margin-bottom: 12px; font-size: 13px; }
  .section-marks { font-weight: 600; color: #475569; }
  .section-instructions { font-style: italic; color: #64748b; margin: 0 0 12px; padding-left: 12px; font-size: 12px; }
  .question { margin: 14px 0; padding-left: 12px; page-break-inside: avoid; break-inside: avoid; }
  .section-header { break-after: avoid; page-break-after: avoid; }
  .q-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .q-text { font-size: 13px; flex: 1; }
  .q-marks { font-size: 11px; color: #475569; white-space: nowrap; }
  .q-diagram { padding-left: 20px; margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
  .q-diagram img { display: block; max-width: 100%; width: auto; height: auto; max-height: 300px; object-fit: contain; border: 1px solid #e2e8f0; }
  .opt-diagram { display: inline-block; vertical-align: middle; margin-left: 6px; max-height: 56px; max-width: 96px; object-fit: contain; border: 1px solid #e2e8f0; }
  .opt-diagram-lg { display: block; margin: 4px 0 0 14px; max-height: 150px; max-width: 92%; object-fit: contain; border: 1px solid #e2e8f0; }
  .options-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 24px; padding-left: 20px; margin-top: 6px; font-size: 12.5px; }
  .matching-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding-left: 20px; margin-top: 6px; font-size: 12.5px; }
  .matching-head { font-weight: 700; text-decoration: underline; margin-bottom: 4px; }
  .subquestions { margin-top: 10px; padding-left: 16px; }
  .subquestion { margin: 10px 0; }
  .answer-lines { margin-top: 8px; padding-left: 20px; }
  .answer-line { border-bottom: 1px solid #cbd5e1; height: 22px; margin: 4px 0; }
  .paper-footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #64748b; }
  .paper-footer div { margin-bottom: 4px; }
  .answer-key { break-before: page; page-break-before: always; padding-top: 8px; }
  .ak-title { font-size: 18px; font-weight: 700; text-align: center; }
  .ak-subtitle { font-size: 12px; color: #475569; text-align: center; margin-bottom: 14px; }
  .ak-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .ak-table td { padding: 4px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .ak-table .ak-q { width: 56px; font-weight: 700; white-space: nowrap; }
  .ak-table .ak-section td { background-color: #f1f5f9; font-weight: 700; padding-top: 8px; }
  math { font-family: inherit; font-size: 1em; }
  math[display="block"] { display: block; margin: 8px 0; text-align: center; }
  @media print { body { padding: 16px; } }
`;

export function buildExamPaperHtml(data: ExamPaperData, opts: BuildExamPaperHtmlOptions = {}): string {
  const { logoDataUrl = null, isOffline = false, showStudentDetailsBox = false, documentTitle, answerKey = false } = opts;
  const titleAttr = escapeHtml(documentTitle ?? data.meta.title ?? "Exam Paper");

  let qCounter = 0;
  const sectionsHtml = data.sections
    .map((section, sIdx) => {
      const html = renderSection(section, sIdx, qCounter + 1, isOffline);
      qCounter += section.questions.length;
      return html;
    })
    .join("");

  const body = `
    ${renderLetterhead(data, logoDataUrl)}
    ${renderInstructions(data)}
    ${showStudentDetailsBox ? renderStudentBox() : ""}
    ${sectionsHtml}
    ${renderFooter(data)}
    ${answerKey ? renderAnswerKey(data) : ""}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${titleAttr}</title>
  <style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Renders just the letterhead block (logo + name + address + accent rule + meta).
 * Used by results-PDF templates (`ExamReportPDF`, `StudentReportPDF`) so their
 * existing html2pdf body stays unchanged — we only prepend branding.
 */
export function buildLetterheadHtml(
  branding: { name: string; address: string | null; contactEmail: string | null; contactPhone: string | null } | null,
  reportTitle: string,
  logoDataUrl: string | null,
  reportSubtitle?: string,
): string {
  const schoolName = branding?.name ?? null;
  const addressLine = branding?.address?.trim() || null;
  const contactBits = [branding?.contactPhone, branding?.contactEmail].filter(Boolean) as string[];

  const logoHtml = logoDataUrl
    ? `<img src="${escapeHtml(logoDataUrl)}" alt="${escapeHtml(branding?.name ?? "")}" style="width: 56px; height: 56px; object-fit: contain; flex-shrink: 0;" />`
    : `<div style="width: 56px; height: 56px; flex-shrink: 0;" aria-hidden="true"></div>`;

  return `<header style="margin-bottom: 14px;">
    <div style="display: flex; align-items: center; gap: 14px;">
      ${logoHtml}
      <div style="flex: 1; text-align: center;">
        ${schoolName
          ? `<div style="font-size: 20px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #0f172a; line-height: 1.15;">${escapeHtml(schoolName)}</div>`
          : ""}
        ${addressLine ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">${escapeHtml(addressLine)}</div>` : ""}
        ${contactBits.length > 0 ? `<div style="font-size: 10px; color: #64748b; margin-top: 1px;">${contactBits.map(escapeHtml).join(" · ")}</div>` : ""}
      </div>
      <div style="width: 56px; height: 56px; flex-shrink: 0;" aria-hidden="true"></div>
    </div>
    <div style="height: 2px; background-color: #249ca2; margin-top: 8px; border-radius: 1px;"></div>
    <div style="text-align: center; margin-top: 10px;">
      <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${escapeHtml(reportTitle)}</div>
      ${reportSubtitle ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${escapeHtml(reportSubtitle)}</div>` : ""}
    </div>
  </header>`;
}
