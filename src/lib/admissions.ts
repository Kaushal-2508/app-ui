import { buildAppUrl } from "@/lib/appUrl";

/**
 * Admissions module: the pure rules. Spec
 * docs/superpowers/specs/2026-10-09-admissions-module-design.md. The
 * pipeline is the one Naman described from the schools (2026-10-09): an
 * enquiry, then registration once the fee is paid, then admission when the
 * parent brings the filled form and the child gets an admission number.
 * Nothing here touches React or the network, so the node asserts can cover
 * every transition.
 */

export const ADMISSIONS_FEATURE_ID = "admissions";

export type AdmissionStage = "enquiry" | "registered" | "admitted" | "dropped";

export const STAGE_ORDER: AdmissionStage[] = ["enquiry", "registered", "admitted", "dropped"];

export const STAGE_LABEL: Record<AdmissionStage, string> = {
  enquiry: "Enquiry",
  registered: "Registered",
  admitted: "Admitted",
  dropped: "Dropped",
};

export type EnquirySource = "public_form" | "walk_in" | "phone" | "referral" | "other";

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  public_form: "Online form",
  walk_in: "Walk-in",
  phone: "Phone call",
  referral: "Referral",
  other: "Other",
};

/** The sources the front desk can pick (the online form sets its own). */
export const DESK_SOURCES: EnquirySource[] = ["walk_in", "phone", "referral", "other"];

export type PaymentMode = "cash" | "upi" | "card" | "bank" | "cheque";

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
  cheque: "Cheque",
};

export const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card", "bank", "cheque"];

export const GENDERS = ["female", "male", "other"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = { female: "Girl", male: "Boy", other: "Other" };

/** What the schools charge today (Naman, 2026-10-09: "1000 rs fee"). */
export const DEFAULT_REGISTRATION_FEE_RUPEES = 1000;

export interface ChecklistItem {
  key: string;
  label: string;
}

/** The certificates a school usually collects at admission; the school
 *  edits the list in Settings. Keys are stable, labels are free. */
export const DEFAULT_DOCUMENT_CHECKLIST: ChecklistItem[] = [
  { key: "birth_certificate", label: "Birth certificate" },
  { key: "transfer_certificate", label: "Transfer certificate" },
  { key: "report_card", label: "Previous report card" },
  { key: "aadhaar_student", label: "Aadhaar card (child)" },
  { key: "aadhaar_parent", label: "Aadhaar card (parent)" },
  { key: "photos", label: "Passport photos" },
  { key: "address_proof", label: "Address proof" },
  { key: "category_certificate", label: "Category certificate" },
  { key: "medical_certificate", label: "Medical certificate" },
];

export type EnquiryAction = "register" | "admit" | "documents" | "drop" | "reopen" | "open_student";

/** What the desk may do with an enquiry at its stage, in button order. */
export function actionsFor(stage: AdmissionStage): EnquiryAction[] {
  switch (stage) {
    case "enquiry":
      return ["register", "drop"];
    case "registered":
      return ["admit", "documents", "drop"];
    case "admitted":
      return ["documents", "open_student"];
    case "dropped":
      return ["reopen"];
  }
}

export const canRegister = (stage: AdmissionStage) => stage === "enquiry";
export const canAdmit = (stage: AdmissionStage) => stage === "registered";
export const canDrop = (stage: AdmissionStage) => stage === "enquiry" || stage === "registered";
export const canReopen = (stage: AdmissionStage) => stage === "dropped";
/** The enquiry's own facts stay editable until the child is a student. */
export const canEditFacts = (stage: AdmissionStage) => stage !== "admitted";

/**
 * "2026/041" from a prefix and the next number: the number is padded to
 * three digits so a register sorts in order; a school that wants no padding
 * starts its sequence at 100. Null until the school sets a prefix (the admit
 * form then asks for it).
 */
export function admissionNumberPreview(prefix: string | null | undefined, nextSeq: number): string | null {
  const p = (prefix ?? "").trim();
  if (!p) return null;
  const n = Math.max(1, Math.floor(nextSeq || 1));
  return `${p}${String(n).padStart(3, "0")}`;
}

/** The school's public enquiry form, from its short code. */
export function enquiryFormUrl(schoolCode: string): string {
  return buildAppUrl(`/enquire/${encodeURIComponent(schoolCode)}`);
}

/**
 * Indian academic years run April to March: "2026-27" for any day from
 * April 2026 to March 2027. `offset` 1 gives the next year, which is what a
 * parent enquiring in October usually applies for.
 */
export function academicYearLabel(date: Date, offset = 0): string {
  const startYear = (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1) + offset;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** The year options the forms offer: this year and the next two. */
export function academicYearOptions(now: Date = new Date()): string[] {
  return [0, 1, 2].map((o) => academicYearLabel(now, o));
}

export interface EnquiryFields {
  studentName: string;
  applyingForLabel: string;
  academicYearLabel: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

/** The first thing wrong with an enquiry, or null. Phone is the 10 digits
 *  `PhoneInput` yields; the email is optional but must look like one. */
export function enquiryError(f: EnquiryFields): string | null {
  if (!f.studentName.trim()) return "Enter the child's name.";
  if (!f.applyingForLabel.trim()) return "Choose the class the child is applying for.";
  if (!f.academicYearLabel.trim()) return "Choose the academic year.";
  if (!f.parentName.trim()) return "Enter the parent's name.";
  if (!/^\d{10}$/.test(f.parentPhone)) return "Enter the parent's 10-digit mobile number.";
  if (f.parentEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.parentEmail.trim())) return "That email address does not look right.";
  return null;
}

export interface RegistrationFields {
  feeRupees: number;
  paymentMode: PaymentMode | "";
  receiptNo: string;
  paidOn: string;
}

export function registrationError(f: RegistrationFields): string | null {
  if (!Number.isFinite(f.feeRupees) || f.feeRupees < 0) return "Enter the fee amount.";
  if (!f.paymentMode) return "Choose how the fee was paid.";
  if (!f.receiptNo.trim()) return "Enter the receipt number.";
  if (!f.paidOn) return "Enter the date the fee was paid.";
  return null;
}

export interface AdmissionFields {
  studentName: string;
  dateOfBirth: string;
  gender: Gender | "";
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
  classId: string;
  admissionNumber: string;
  admittedOn: string;
}

export function admissionError(f: AdmissionFields): string | null {
  if (!f.studentName.trim()) return "Enter the child's full name.";
  if (!f.dateOfBirth) return "Enter the date of birth.";
  if (!f.gender) return "Choose the gender.";
  if (!f.guardianName.trim()) return "Enter the guardian's name.";
  if (!/^\d{10}$/.test(f.guardianPhone)) return "Enter the guardian's 10-digit mobile number.";
  if (f.guardianEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.guardianEmail.trim())) return "That email address does not look right.";
  if (!f.classId) return "Choose the class and section.";
  if (!f.admissionNumber.trim()) return "Enter the admission number.";
  if (!f.admittedOn) return "Enter the admission date.";
  return null;
}

/** Whole days between an ISO timestamp (or date) and now, never negative. */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

/** "Rs 1,000" in the Indian grouping; the repo never uses the rupee glyph in UI text. */
export function formatRupees(n: number): string {
  return `Rs ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}

/** Scanned certificates (Naman, 2026-10-12: "an option to upload the
 *  documents as well"). A private bucket; staff read through signed URLs. */
export const ADMISSION_DOCS_BUCKET = "admission-documents";
export const ADMISSION_DOC_MAX_BYTES = 10 * 1024 * 1024;
export const ADMISSION_DOC_ACCEPT = "image/*,application/pdf";

/** `<school>/<enquiry>/<document>.<ext>`: one object per certificate, so a
 *  second upload replaces the first. */
export function admissionDocumentPath(institutionId: string, enquiryId: string, docKey: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = (dot > 0 ? fileName.slice(dot + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${institutionId}/${enquiryId}/${docKey}.${ext}`;
}

/** Why a picked file cannot be uploaded, or null. */
export function documentFileError(file: { size: number; type: string; name: string }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > ADMISSION_DOC_MAX_BYTES) return "Keep each file under 10 MB.";
  const ok = file.type.startsWith("image/") || file.type === "application/pdf" || /\.(pdf|jpe?g|png|heic|webp)$/i.test(file.name);
  return ok ? null : "Upload a photo or a PDF.";
}

/* ---------------------------------------------------------------------------
 * The school's own questions (Naman, 2026-10-12: "edited like we create a
 * google form, different schools, different things, so they can design
 * accordingly"). The built-in fields stay; a school adds questions, marks
 * them required, and says where each is asked. Answers live in the enquiry's
 * `form.custom` keyed by question id.
 * ------------------------------------------------------------------------- */

export type FormQuestionType = "short_text" | "long_text" | "number" | "date" | "choice" | "yes_no";

export const FORM_QUESTION_TYPES: FormQuestionType[] = ["short_text", "long_text", "number", "date", "choice", "yes_no"];

export const FORM_QUESTION_TYPE_LABEL: Record<FormQuestionType, string> = {
  short_text: "Text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  choice: "Pick one",
  yes_no: "Yes / No",
};

export type FormStage = "enquiry" | "admission" | "public";

export const FORM_STAGES: FormStage[] = ["enquiry", "admission", "public"];

export const FORM_STAGE_LABEL: Record<FormStage, string> = {
  enquiry: "Front desk enquiry",
  admission: "Admission form",
  public: "Online form",
};

/** The designer offers four everyday answers to "where is it asked?"
 *  (Naman, 2026-10-12: "simplify this form, from a new person's point of
 *  view it is very confusing"); any other combination is kept as it is and
 *  shown as "Some places". */
export type AskAtPreset = "everywhere" | "online" | "school" | "admission" | "custom";

export const ASK_AT_PRESETS: { value: Exclude<AskAtPreset, "custom">; label: string; stages: FormStage[] }[] = [
  { value: "everywhere", label: "Everywhere", stages: ["enquiry", "admission", "public"] },
  { value: "online", label: "Online form only", stages: ["public"] },
  { value: "school", label: "At the school only", stages: ["enquiry", "admission"] },
  { value: "admission", label: "Admission form only", stages: ["admission"] },
];

export function askAtPreset(askAt: FormStage[]): AskAtPreset {
  const key = FORM_STAGES.filter((s) => askAt.includes(s)).join(",");
  return ASK_AT_PRESETS.find((p) => p.stages.join(",") === key)?.value ?? "custom";
}

export function askAtStages(preset: AskAtPreset, current: FormStage[]): FormStage[] {
  return ASK_AT_PRESETS.find((p) => p.value === preset)?.stages ?? current;
}

export interface FormQuestion {
  id: string;
  label: string;
  type: FormQuestionType;
  required: boolean;
  /** Choice only: the options, in order. */
  options: string[];
  /** Where the question is asked; at least one. */
  ask_at: FormStage[];
  help: string | null;
}

export function newFormQuestion(type: FormQuestionType, id = `q_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`): FormQuestion {
  return { id, label: "", type, required: false, options: type === "choice" ? ["", ""] : [], ask_at: ["enquiry", "admission", "public"], help: null };
}

/** Why a question cannot be saved yet, or null. */
export function formQuestionError(q: FormQuestion): string | null {
  if (!q.label.trim()) return "Type the question.";
  if (q.ask_at.length === 0) return "Choose where to ask it.";
  if (q.type === "choice") {
    const opts = q.options.map((o) => o.trim()).filter(Boolean);
    if (opts.length < 2) return "Add at least two options, one per line.";
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return "Two options say the same thing.";
  }
  return null;
}

/** The first problem in the whole designer, or null. */
export function formSchemaError(schema: FormQuestion[]): string | null {
  for (const q of schema) {
    const e = formQuestionError(q);
    if (e) return `${q.label.trim() || "A question"}: ${e}`;
  }
  return null;
}

/** The questions asked at a stage, in the designer's order. */
export function questionsFor(schema: FormQuestion[] | null | undefined, stage: FormStage): FormQuestion[] {
  return (schema ?? []).filter((q) => q.ask_at.includes(stage));
}

/** The first missing or malformed answer, or null. */
export function customAnswersError(questions: FormQuestion[], answers: Record<string, string>): string | null {
  for (const q of questions) {
    const v = (answers[q.id] ?? "").trim();
    if (!v) {
      if (q.required) return `Answer "${q.label}".`;
      continue;
    }
    if (q.type === "number" && !/^-?\d+(\.\d+)?$/.test(v)) return `"${q.label}" needs a number.`;
    if (q.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `"${q.label}" needs a date.`;
    if (q.type === "choice" && !q.options.map((o) => o.trim()).includes(v)) return `Choose one of the options for "${q.label}".`;
    if (q.type === "yes_no" && v !== "yes" && v !== "no") return `Answer yes or no to "${q.label}".`;
  }
  return null;
}

/** Only the answers of the given questions, trimmed, empty ones dropped. */
export function cleanAnswers(questions: FormQuestion[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const v = (answers[q.id] ?? "").trim();
    if (v) out[q.id] = v;
  }
  return out;
}

/** What the designer saves: trimmed labels, options and help; no blank options. */
export function normalizeFormSchema(schema: FormQuestion[]): FormQuestion[] {
  return schema.map((q) => ({
    id: q.id,
    label: q.label.trim(),
    type: q.type,
    required: q.required,
    options: q.type === "choice" ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    ask_at: FORM_STAGES.filter((s) => q.ask_at.includes(s)),
    help: q.help?.trim() || null,
  }));
}

/** The enquiry's answers after a form at `stage` is saved: the asked
 *  questions take the new answers (a cleared one goes), the rest stay. */
export function mergeCustomAnswers(existing: Record<string, string> | null | undefined, asked: FormQuestion[], answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...(existing ?? {}) };
  for (const q of asked) delete out[q.id];
  return { ...out, ...cleanAnswers(asked, answers) };
}

/** Move a question up (-1) or down (+1); out of range is a no-op. */
export function moveQuestion(schema: FormQuestion[], index: number, delta: -1 | 1): FormQuestion[] {
  const to = index + delta;
  if (index < 0 || index >= schema.length || to < 0 || to >= schema.length) return schema;
  const next = [...schema];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A yes_no answer as words, a choice as itself, for the record. */
export function formatAnswer(q: FormQuestion, value: string | undefined): string {
  if (!value) return "";
  if (q.type === "yes_no") return value === "yes" ? "Yes" : value === "no" ? "No" : value;
  return value;
}

/** "ENQ-2026-0041" is the server's; this only tells a row apart in the UI. */
export function shortReference(reference: string | null | undefined): string {
  return reference ?? "";
}
