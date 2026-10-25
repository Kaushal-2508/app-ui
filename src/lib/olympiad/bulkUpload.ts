// Shared helpers for the Olympiad bulk-upload sheets (students + teachers).
// xlsx is dynamically imported per §23 (heavy libs stay out of the entry bundle).

import { saveBlob } from "@/lib/native";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build and download an .xlsx with a header row + demo rows. */
export async function downloadXlsxTemplate(
  filename: string,
  headers: string[],
  demoRows: (string | number)[][],
) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...demoRows]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveBlob(new Blob([out], { type: XLSX_MIME }), filename);
}

/** Download tabular results (e.g. credentials) as .xlsx. */
export async function downloadXlsxData(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveBlob(new Blob([out], { type: XLSX_MIME }), filename);
}

/** Parse the first sheet of an uploaded .xlsx/.xls into raw row objects.
 *  raw:true keeps Excel dates as serial numbers so DOB parsing is deterministic. */
export async function parseXlsxRows(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    raw: true,
    defval: "",
  });
}

/** Cell value from a header-keyed row, trimmed. Headers are matched loosely so
 *  "Parent Phone" also matches "Parent Phone *" or "parent phone". */
export function cellText(row: Record<string, unknown>, header: string): string {
  const want = normalizeKey(header);
  for (const [k, v] of Object.entries(row)) {
    if (normalizeKey(k).startsWith(want)) {
      if (v === null || v === undefined) return "";
      return String(v).trim();
    }
  }
  return "";
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** DOB from an Excel cell: serial number, "YYYY-MM-DD", or day-first "DD-MM-YYYY"
 *  / "DD/MM/YYYY". Returns ISO "YYYY-MM-DD" or null when unparseable. */
export function excelCellToDobIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Excel serial: days since 1899-12-30
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  let y = 0, m = 0, d = 0;
  let match = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else {
    match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return null;
    // Day-first (Indian convention)
    d = Number(match[1]); m = Number(match[2]); y = Number(match[3]);
  }
  if (y < 1950 || y > 2030 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type ClassOption = { gradeLevelId: string; label: string };

/** Resolve a free-typed class cell ("Class 9", "9", "class-9", or a full
 *  grade name like "Class 11 Commerce") to one of the school's classes. */
export function resolveClass(input: string, classes: ClassOption[]): ClassOption | null {
  const norm = normalizeKey(input);
  if (!norm) return null;
  const exact = classes.find((c) => normalizeKey(c.label) === norm);
  if (exact) return exact;
  // Bare number ("9") matches "Class 9" when unambiguous
  const numeric = classes.filter((c) => {
    const n = normalizeKey(c.label).replace(/^class/, "");
    return n === norm || normalizeKey(c.label) === `class${norm}`;
  });
  return numeric.length === 1 ? numeric[0] : null;
}

export const PHONE_RE = /^[6-9]\d{9}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
