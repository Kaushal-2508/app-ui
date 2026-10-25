/**
 * Generates scripts/import-questions.sql from an AI-generated questions
 * XLSX export. CLI:
 *
 *   node scripts/build-import-sql.cjs --xlsx <path> --topic <chapter_uuid>
 *       [--institution <uuid>] [--class-group <uuid>] [--grade <uuid>]
 *       [--subject <uuid>] [--created-by <uuid>] [--out <path>]
 *
 * Defaults to Alliance International School / Class 9 / Science (the
 * institution we've been importing into). All ids except topic come from
 * the prior import; topic must be passed because it changes per chapter.
 *
 * Idempotent-ish: each INSERT is tagged with source='ai_xlsx_import_<run_id>'
 * so the batch is reversible via:
 *
 *   DELETE FROM public.question_bank WHERE source = '<run_id>';
 */

const XLSX = require("xlsx");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

// --- Tiny argv parser ---------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const IDS = {
  institution_id: args.institution || "8af718c6-ca11-482b-9d6b-832f2b767928",
  class_group_id: args["class-group"] || "41e0a701-bdda-403b-bf4d-003aaffa605b",
  grade_level_id: args.grade || "d9ec752e-e972-447c-b099-ccf502d554ab",
  subject_id: args.subject || "362f4648-1cba-4328-ba6e-aeff99815f3d",
  topic_id: args.topic || "89bbc437-6dc5-4e77-83df-55f56c27e6cd",
  created_by: args["created-by"] || "ba219b8a-c17f-46af-b642-be52f18c80ff",
};

// Tag every row with this run id so the whole batch is reversible.
const RUN_ID = `xlsx_${new Date().toISOString().replace(/[:.]/g, "-")}`;
const SOURCE = `ai_xlsx_import_${RUN_ID}`;

const XLSX_PATH = args.xlsx
  ? path.resolve(args.xlsx)
  : path.resolve(
      __dirname,
      "..",
      "1777445171171-nru0y9_20260502_130239_questions.xlsx",
    );
const OUT_PATH = args.out
  ? path.resolve(args.out)
  : path.resolve(__dirname, "import-questions.sql");

if (!fs.existsSync(XLSX_PATH)) {
  console.error("XLSX not found:", XLSX_PATH);
  process.exit(1);
}

// Dollar-quote a string for Postgres so we never have to escape '.
// Use a tag that's astronomically unlikely to appear in question text.
const Q_TAG = "qbx";
function dq(s) {
  if (s == null) return "NULL";
  const str = String(s);
  if (str.includes("$" + Q_TAG + "$")) {
    // Defensive: pick a different tag for this row
    let i = 1;
    while (str.includes(`$qbx${i}$`)) i++;
    return `$qbx${i}$${str}$qbx${i}$`;
  }
  return `$${Q_TAG}$${str}$${Q_TAG}$`;
}

function jsonOrNull(value) {
  return value == null ? "NULL" : `${dq(JSON.stringify(value))}::jsonb`;
}

const wb = XLSX.readFile(XLSX_PATH);

// Some AI exports (English) prefix every sheet with a leading serial-number
// column and use long sheet names like "True or False"; newer exports (Hindi)
// drop the serial column and use compact names like "TrueFalse".
//
// We pick the first sheet name that exists, then auto-detect the column shift
// by reading the header row: if column 0 is anything other than a known
// content-bearing header ("Question", "Content/Paragraph", "List A") we
// assume column 0 is a serial number and shift by 1.
const SHEET_ALIASES = {
  mcq: ["MCQ"],
  fill_blank: ["Fill in the Blanks", "FillInTheBlanks", "Fill Blanks"],
  true_false: ["True or False", "TrueFalse", "True/False"],
  match_column: ["Match the Following", "MatchTheFollowing", "Match Column"],
  short_answer: ["Short Answer", "ShortAnswer", "Small Maths Problems"],
  long_answer: ["Long Answer", "LongAnswer", "Long Maths Problems"],
  case_study: ["Case Study", "CaseStudy"],
  comprehension: ["Comprehension Para", "Comprehension", "Comp Para"],
};

const CONTENT_HEADERS = new Set([
  "question",
  "content/paragraph",
  "content / paragraph",
  "passage",
  "list a",
  "column a",
]);

function resolveSheet(kind) {
  for (const alias of SHEET_ALIASES[kind] || []) {
    if (wb.Sheets[alias]) return alias;
  }
  return null;
}

function readSheet(kind) {
  const name = resolveSheet(kind);
  if (!name) return { header: [], rows: [], offset: 0 };
  const all = XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    defval: "",
    raw: false,
  });
  const header = (all[0] || []).map((h) => String(h || "").trim());
  const firstHeader = (header[0] || "").toLowerCase();
  const offset = CONTENT_HEADERS.has(firstHeader) ? 0 : 1;
  // Strip rows that are entirely blank.
  const rows = all.slice(1).filter((r) => r.some((c) => String(c || "").trim()));
  return { sheet: name, header, rows, offset };
}

// MCQ answer in the XLSX comes in several shapes:
//   "c) बुद्धिहीन"  → letter prefix, take "c"
//   "C", "c"        → bare letter
//   "ये सभी"        → just the option text — match it against the options
// Returns the lowercase a/b/c/d letter or "" if unresolvable.
function parseMcqAnswerLetter(raw, options) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const letterPrefix = s.match(/^([a-dA-D])[\)\.\:\-]/);
  if (letterPrefix) return letterPrefix[1].toLowerCase();
  if (/^[a-dA-D]$/.test(s)) return s.toLowerCase();
  // Text match against the option texts (normalised).
  const norm = (x) => String(x || "").replace(/\s+/g, " ").trim();
  const target = norm(s);
  for (const opt of options || []) {
    if (norm(opt.text) === target) return opt.id;
  }
  // Substring fallback — handles answers like "उत्तर: ये सभी" where the option
  // text appears inside a longer phrase.
  for (const opt of options || []) {
    const ot = norm(opt.text);
    if (ot && (target.includes(ot) || ot.includes(target))) return opt.id;
  }
  return "";
}

// True/False answer recognises English and Hindi forms.
//   True:  "True" | "T" | "Yes" | "सत्य" | "हाँ"
//   False: "False" | "F" | "No" | "असत्य" | "नहीं"
// Pre-fix the parser only matched /^t/i, so 21 of 99 Hindi rows in Ch1
// (`सत्य`) were silently flipped to False.
function parseTrueFalseAnswer(raw) {
  const s = String(raw || "").trim();
  if (!s) return "False";
  if (/^सत्य/.test(s)) return "True";
  if (/^असत्य/.test(s)) return "False";
  if (/^हाँ/.test(s) || /^हां/.test(s)) return "True";
  if (/^नहीं/.test(s)) return "False";
  if (/^(t|true|y|yes)/i.test(s)) return "True";
  if (/^(f|false|n|no)/i.test(s)) return "False";
  return "False";
}

// "a) बुद्धिमान" → "बुद्धिमान"; "A. Foo" → "Foo".
function stripOptionPrefix(raw) {
  return String(raw || "")
    .replace(/^\s*[a-dA-D][\)\.\:\-]\s*/, "")
    .trim();
}

// "1. Q1\n2. Q2\n3. Q3" → ["Q1", "Q2", "Q3"]; tolerates "(i)", "1)", "१." etc.
function splitNumberedQuestions(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n+/)
    .map((line) =>
      line
        .replace(/^\s*[\(\[]?[0-9०-९ivxIVX]+[\)\.\]\:\-]\s*/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

// ---- Build INSERT rows for each sheet ----

const standaloneRows = [];      // mcq, fill_blank, true_false, match_column, short_answer, long_answer
const parentChildPairs = [];    // case_study + comprehension

// MCQ
let unresolvedMcq = 0;
{
  const { rows, offset } = readSheet("mcq");
  for (const r of rows) {
    const qText = String(r[offset] || "").trim();
    if (!qText) continue;
    const optionsJson = [
      { id: "a", text: stripOptionPrefix(r[offset + 1]) },
      { id: "b", text: stripOptionPrefix(r[offset + 2]) },
      { id: "c", text: stripOptionPrefix(r[offset + 3]) },
      { id: "d", text: stripOptionPrefix(r[offset + 4]) },
    ];
    const letter = parseMcqAnswerLetter(r[offset + 5], optionsJson);
    if (!letter) unresolvedMcq++;
    standaloneRows.push({
      question_text: qText,
      question_type: "mcq",
      options: optionsJson,
      correct_answer: letter,
    });
  }
}

// Fill in the Blanks
{
  const { rows, offset } = readSheet("fill_blank");
  for (const r of rows) {
    const qText = String(r[offset] || "").trim();
    if (!qText) continue;
    standaloneRows.push({
      question_text: qText,
      question_type: "fill_blank",
      options: null,
      correct_answer: String(r[offset + 1] || ""),
    });
  }
}

// True or False
{
  const { rows, offset } = readSheet("true_false");
  for (const r of rows) {
    const qText = String(r[offset] || "").trim();
    if (!qText) continue;
    standaloneRows.push({
      question_text: qText,
      question_type: "true_false",
      options: [
        { id: "t", text: "True" },
        { id: "f", text: "False" },
      ],
      correct_answer: parseTrueFalseAnswer(r[offset + 1]),
    });
  }
}

// Match the Following — two supported shapes:
//   (a) Old: one row = full question with 5 column-A cells + 5 column-B cells + mapping.
//   (b) New: one row = one (A, B) pair → group every MATCH_GROUP rows into one question.
{
  const { rows, offset, header } = readSheet("match_column");
  const colCount = Math.max(header.length, ...rows.map((r) => r.length));
  const isPairFormat = colCount - offset <= 2;
  if (isPairFormat) {
    const pairs = rows
      .map((r) => ({
        a: String(r[offset] || "").trim(),
        b: String(r[offset + 1] || "").trim(),
      }))
      .filter((p) => p.a && p.b);
    const MATCH_GROUP = 4; // 4 pairs per match question
    for (let i = 0; i < pairs.length; i += MATCH_GROUP) {
      const group = pairs.slice(i, i + MATCH_GROUP);
      if (group.length < 2) break;
      const colA = group.map((p) => p.a);
      const colB = group.map((p) => p.b);
      const mapping = group.map((_, idx) => `A${idx + 1}→B${idx + 1}`).join(", ");
      standaloneRows.push({
        question_text: "Match the items in Column A with the correct entries in Column B.",
        question_type: "match_column",
        options: colA.map((a, idx) => ({ id: String(idx + 1), text: a })),
        correct_answer: JSON.stringify({ columnA: colA, columnB: colB, matches: mapping }),
      });
    }
  } else {
    for (const r of rows) {
      if (!String(r[offset] || "").trim()) continue;
      const colA = [
        r[offset], r[offset + 1], r[offset + 2], r[offset + 3], r[offset + 4],
      ].map((c) => String(c || "")).filter((c) => c.trim());
      const colB = [
        r[offset + 5], r[offset + 6], r[offset + 7], r[offset + 8], r[offset + 9],
      ].map((c) => String(c || "")).filter((c) => c.trim());
      const mapping = String(r[offset + 10] || "");
      standaloneRows.push({
        question_text: "Match the items in Column A with the correct entries in Column B.",
        question_type: "match_column",
        options: colA.map((a, idx) => ({ id: String(idx + 1), text: a })),
        correct_answer: JSON.stringify({ columnA: colA, columnB: colB, matches: mapping }),
      });
    }
  }
}

// Short Answer
{
  const { rows, offset } = readSheet("short_answer");
  for (const r of rows) {
    const qText = String(r[offset] || "").trim();
    if (!qText) continue;
    standaloneRows.push({
      question_text: qText,
      question_type: "short_answer",
      options: null,
      correct_answer: null,
    });
  }
}

// Long Answer
{
  const { rows, offset } = readSheet("long_answer");
  for (const r of rows) {
    const qText = String(r[offset] || "").trim();
    if (!qText) continue;
    standaloneRows.push({
      question_text: qText,
      question_type: "long_answer",
      options: null,
      correct_answer: null,
    });
  }
}

// Case Study (parent: long_answer; children: short_answer).
// Supports both legacy 3-question-columns and new newline-joined cell.
{
  const { rows, offset, header } = readSheet("case_study");
  const newlineFormat = (header[offset + 1] || "").toLowerCase().includes("question")
    && (header[offset + 2] || "").trim() === "";
  for (const r of rows) {
    const passage = String(r[offset] || "").trim();
    if (!passage) continue;
    const subs = newlineFormat
      ? splitNumberedQuestions(r[offset + 1])
      : [r[offset + 1], r[offset + 2], r[offset + 3]]
          .map((c) => String(c || "").trim())
          .filter(Boolean);
    if (subs.length === 0) continue;
    parentChildPairs.push({
      parent: {
        question_text: passage,
        question_type: "long_answer",
        sub_question_count: subs.length,
      },
      children: subs.map((t) => ({ question_text: t })),
    });
  }
}

// Comprehension Para (parent: comprehension; children: short_answer).
{
  const { rows, offset, header } = readSheet("comprehension");
  const newlineFormat = (header[offset + 1] || "").toLowerCase().includes("question")
    && (header[offset + 2] || "").trim() === "";
  for (const r of rows) {
    const passage = String(r[offset] || "").trim();
    if (!passage) continue;
    const subs = newlineFormat
      ? splitNumberedQuestions(r[offset + 1])
      : [r[offset + 1], r[offset + 2], r[offset + 3], r[offset + 4]]
          .map((c) => String(c || "").trim())
          .filter(Boolean);
    if (subs.length === 0) continue;
    parentChildPairs.push({
      parent: {
        question_text: passage,
        question_type: "comprehension",
        sub_question_count: subs.length,
      },
      children: subs.map((t) => ({ question_text: t })),
    });
  }
}

// ---- Generate SQL ----

const stmts = [];

stmts.push("-- AUTO-GENERATED. Imports questions from XLSX into question_bank.");
stmts.push(`-- Run id: ${RUN_ID}`);
stmts.push(`-- Source tag: ${SOURCE}`);
stmts.push("-- To roll back this batch:");
stmts.push(`--   DELETE FROM public.question_bank WHERE source = '${SOURCE}';`);
stmts.push("");
stmts.push("BEGIN;");
stmts.push("");

const COMMON_COLS = `
  institution_id, subject_id, topic_id, grade_level_id, class_group_id,
  question_text, question_type, options, correct_answer,
  marks, difficulty_level, tags, source, created_by, is_approved`.replace(/\s+/g, " ").trim();

const COMMON_WITH_PARENT = COMMON_COLS + ", parent_question_id, sub_question_count, sequence_order";

// `mode` controls how many trailing columns are emitted:
//   "standalone" → 15 base columns, no parent/seq trio
//   "parent"     → 18 columns: base + parent_question_id + sub_question_count + sequence_order(NULL)
//   "child"      → 18 columns: base + parent_question_id + sub_question_count(NULL) + sequence_order
function commonValues(row, mode, parentId, sequenceOrder) {
  const opts = row.options !== undefined ? jsonOrNull(row.options) : "NULL";
  const base = [
    `'${IDS.institution_id}'`,
    `'${IDS.subject_id}'`,
    `'${IDS.topic_id}'`,
    `'${IDS.grade_level_id}'`,
    `'${IDS.class_group_id}'`,
    dq(row.question_text),
    `'${row.question_type}'::question_type`,
    opts,
    row.correct_answer != null ? dq(row.correct_answer) : "NULL",
    "1",                              // marks
    "5",                              // difficulty_level (CLAUDE.md §8: hardcoded 5)
    `ARRAY[]::text[]`,                // tags
    `'${SOURCE}'`,
    `'${IDS.created_by}'`,
    "true",                           // is_approved
  ];
  if (mode === "standalone") return base;
  if (mode === "parent") {
    return [
      ...base,
      "NULL",                                                       // parent_question_id
      row.sub_question_count != null ? String(row.sub_question_count) : "NULL",
      "NULL",                                                       // sequence_order
    ];
  }
  if (mode === "child") {
    return [
      ...base,
      `'${parentId}'`,                                              // parent_question_id
      "NULL",                                                       // sub_question_count
      String(sequenceOrder),                                        // sequence_order
    ];
  }
  throw new Error("unknown mode " + mode);
}

// 1. Standalone questions — batch into chunks of 200 rows per INSERT
const CHUNK = 200;
for (let i = 0; i < standaloneRows.length; i += CHUNK) {
  const chunk = standaloneRows.slice(i, i + CHUNK);
  stmts.push(`INSERT INTO public.question_bank (${COMMON_COLS}) VALUES`);
  const valuesList = chunk.map((row, idx) => {
    const vals = commonValues(row, "standalone").join(", ");
    return `  (${vals})${idx === chunk.length - 1 ? ";" : ","}`;
  });
  stmts.push(...valuesList);
  stmts.push("");
}

// 2. Parent + child for case_study / comprehension.
//    Generate UUIDs in JS so parent_question_id is known up-front.
let parentInserts = [];
let childInserts = [];

for (const pc of parentChildPairs) {
  const parentId = crypto.randomUUID();
  parentInserts.push({
    id: parentId,
    row: pc.parent,
  });
  pc.children.forEach((c, idx) => {
    childInserts.push({
      parentId,
      row: { ...c, question_type: "short_answer", options: null, correct_answer: null },
      sequence_order: idx + 1,
    });
  });
}

// Parent batch (with explicit id)
const PARENT_COLS = "id, " + COMMON_WITH_PARENT;
for (let i = 0; i < parentInserts.length; i += CHUNK) {
  const chunk = parentInserts.slice(i, i + CHUNK);
  stmts.push(`INSERT INTO public.question_bank (${PARENT_COLS}) VALUES`);
  const valuesList = chunk.map((p, idx) => {
    const v = [
      `'${p.id}'`,
      ...commonValues(p.row, "parent"),
    ];
    return `  (${v.join(", ")})${idx === chunk.length - 1 ? ";" : ","}`;
  });
  stmts.push(...valuesList);
  stmts.push("");
}

// Child batch
for (let i = 0; i < childInserts.length; i += CHUNK) {
  const chunk = childInserts.slice(i, i + CHUNK);
  stmts.push(`INSERT INTO public.question_bank (${COMMON_WITH_PARENT}) VALUES`);
  const valuesList = chunk.map((c, idx) => {
    const vals = commonValues(c.row, "child", c.parentId, c.sequence_order);
    return `  (${vals.join(", ")})${idx === chunk.length - 1 ? ";" : ","}`;
  });
  stmts.push(...valuesList);
  stmts.push("");
}

stmts.push("COMMIT;");
stmts.push("");
stmts.push("-- Verification:");
stmts.push(`SELECT question_type, COUNT(*) FROM public.question_bank WHERE source = '${SOURCE}' GROUP BY question_type ORDER BY question_type;`);

fs.writeFileSync(OUT_PATH, stmts.join("\n"));

console.log("Generated:", OUT_PATH);
console.log("Run id:", RUN_ID);
console.log("Source tag:", SOURCE);
console.log();
console.log("Counts to be inserted:");
const countsByType = {};
for (const r of standaloneRows) {
  countsByType[r.question_type] = (countsByType[r.question_type] || 0) + 1;
}
const parentTypes = {};
for (const p of parentInserts) {
  parentTypes[p.row.question_type] = (parentTypes[p.row.question_type] || 0) + 1;
}
console.log("  standalone:", countsByType);
console.log("  parents:   ", parentTypes);
console.log("  children:  ", { short_answer: childInserts.length });
console.log("  total rows:", standaloneRows.length + parentInserts.length + childInserts.length);
console.log();
if (unresolvedMcq > 0) {
  console.log();
  console.log(
    `  ⚠ ${unresolvedMcq} MCQ row(s) had an answer that could not be matched to`,
  );
  console.log(
    "    a letter or option text — their correct_answer was written as ''.",
  );
  console.log(
    "    Spot-check the XLSX and edit those questions in the admin UI.",
  );
}
console.log();
console.log("Rollback (if needed):");
console.log(`  DELETE FROM public.question_bank WHERE source = '${SOURCE}';`);
