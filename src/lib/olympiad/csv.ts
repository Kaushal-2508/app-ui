import { saveBlob } from "@/lib/native";
import Papa from "papaparse";

export type CsvQuestionRow = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  topic: string;
};

export type CsvImportRow = {
  rowNumber: number;
  raw: CsvQuestionRow;
  errors: string[];
};

const REQUIRED_COLUMNS: (keyof CsvQuestionRow)[] = [
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_answer",
];

export function downloadCsvTemplate() {
  const csv =
    "question_text,option_a,option_b,option_c,option_d,correct_answer,topic\n" +
    '"What is $1 + 1$?","1","2","3","4",B,Arithmetic\n';
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveBlob(blob, "olympiad-questions-template.csv");
}

export async function parseCsv(file: File): Promise<CsvImportRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data ?? []).map((raw, i) =>
          validateRow(raw as CsvQuestionRow, i + 2),
        );
        resolve(rows);
      },
      error: (err) => reject(err),
    });
  });
}

function validateRow(raw: CsvQuestionRow, rowNumber: number): CsvImportRow {
  const errors: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!raw[col] || String(raw[col]).trim() === "") {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (
    raw.correct_answer &&
    !["A", "B", "C", "D"].includes(
      String(raw.correct_answer).trim().toUpperCase(),
    )
  ) {
    errors.push(
      `correct_answer must be A, B, C, or D (got "${raw.correct_answer}")`,
    );
  }
  return { rowNumber, raw, errors };
}

export function validateAgainstTopics(
  rows: CsvImportRow[],
  validTopics: { id: string; name: string }[],
): CsvImportRow[] {
  const byLowerName = new Map(
    validTopics.map((t) => [t.name.trim().toLowerCase(), t.id]),
  );
  return rows.map((r) => {
    if (r.errors.length > 0) return r;
    const key = r.raw.topic.trim().toLowerCase();
    if (key && !byLowerName.has(key)) {
      return {
        ...r,
        errors: [`Topic "${r.raw.topic}" not found in this subject × class`],
      };
    }
    return r;
  });
}

export function rowsToPayload(
  rows: CsvImportRow[],
  topicLookup: Map<string, string>,
  subjectId: string,
  gradeLevelId: string,
) {
  return rows
    .filter((r) => r.errors.length === 0)
    .map((r) => ({
      subject_id: subjectId,
      grade_level_id: gradeLevelId,
      topic_id: topicLookup.get(r.raw.topic.trim().toLowerCase()) ?? null,
      question_text: r.raw.question_text,
      option_a: r.raw.option_a,
      option_b: r.raw.option_b,
      option_c: r.raw.option_c,
      option_d: r.raw.option_d,
      correct_answer: r.raw.correct_answer.trim().toUpperCase(),
      status: "active",
    }));
}
