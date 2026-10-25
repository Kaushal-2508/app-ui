// Attendance report → styled .xlsx (exceljs, lazy-loaded per §23).
//
// A plain CSV cannot carry column widths, so Excel rendered the ISO date headers
// as "####" (a date value wider than its default column, right-aligned). This
// builds a real workbook with sized columns and TEXT date headers, so every date
// and value is always fully visible — no "####", no surprise date re-formatting.

import { saveBlob } from "@/lib/native";

export interface AttendanceExportColumn {
  header: string;
  width: number;
  align?: "left" | "center";
}

export interface AttendanceExportInput {
  sheetName: string;
  title: string;
  subtitle: string;
  columns: AttendanceExportColumn[];
  rows: (string | number)[][];
  filename: string;
}

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const C = {
  brand: "FF249CA2", // --brand-primary teal
  headerText: "FFFFFFFF",
  metaText: "FF667085",
} as const;

export interface AttendanceExportSheet {
  kind?: "table";
  sheetName: string;
  title: string;
  subtitle: string;
  columns: AttendanceExportColumn[];
  rows: (string | number)[][];
}

/** A row in a free-form "report" sheet (label/value + section blocks, not a uniform table). */
export interface AttendanceReportRow {
  cells: (string | number)[];
  bold?: boolean; // bold the row's text (title / labels)
  fill?: boolean; // brand fill + white bold (a block-header row like "Metric | Value")
}

/** A report-style sheet (e.g. an activity overview) rather than a uniform table. */
export interface AttendanceReportSheet {
  kind: "report";
  sheetName: string;
  colWidths: number[];
  rows: AttendanceReportRow[];
}

export type WorkbookSheet = AttendanceExportSheet | AttendanceReportSheet;

/** Excel sheet-name rules: <=31 chars, no : \ / ? * [ ], unique within a book. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet");
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function downloadAttendanceWorkbook(input: AttendanceExportInput): Promise<void> {
  await downloadAttendanceWorkbookMulti({
    sheets: [{
      sheetName: input.sheetName,
      title: input.title,
      subtitle: input.subtitle,
      columns: input.columns,
      rows: input.rows,
    }],
    filename: input.filename,
  });
}

export async function downloadAttendanceWorkbookMulti(input: {
  sheets: WorkbookSheet[];
  filename: string;
}): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SALCI";
  wb.created = new Date();

  const used = new Set<string>();
  const sheets: WorkbookSheet[] = input.sheets.length > 0 ? input.sheets : [{
    sheetName: "Empty", title: "No data", subtitle: "", columns: [{ header: "N/A", width: 10 }], rows: [],
  }];
  for (const sheet of sheets) {
    if (sheet.kind === "report") {
      // Free-form report sheet: label/value + section blocks.
      const ws = wb.addWorksheet(safeSheetName(sheet.sheetName, used));
      ws.columns = sheet.colWidths.map((w) => ({ width: w }));
      sheet.rows.forEach((r) => {
        const row = ws.addRow(r.cells);
        if (r.fill) {
          r.cells.forEach((_, i) => {
            const cell = row.getCell(i + 1);
            cell.font = { bold: true, color: { argb: C.headerText } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.brand } };
          });
        } else if (r.bold) {
          row.font = { bold: true };
        }
      });
      continue;
    }

    // ws is fully typed by exceljs here — write the sheet inline (no structural casts).
    const ws = wb.addWorksheet(safeSheetName(sheet.sheetName, used), {
      views: [{ state: "frozen", ySplit: 4 }],
    });
    ws.columns = sheet.columns.map((c) => ({ width: c.width }));
    const lastCol = ws.getColumn(sheet.columns.length).letter;

    ws.mergeCells(`A1:${lastCol}1`);
    const title = ws.getCell("A1");
    title.value = sheet.title;
    title.font = { bold: true, size: 14, color: { argb: C.brand } };

    ws.mergeCells(`A2:${lastCol}2`);
    const meta = ws.getCell("A2");
    meta.value = sheet.subtitle;
    meta.font = { italic: true, size: 10, color: { argb: C.metaText } };

    const header = ws.getRow(4);
    sheet.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: C.headerText } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.brand } };
      cell.alignment = { vertical: "middle", horizontal: c.align ?? "left" };
    });

    sheet.rows.forEach((r) => {
      const row = ws.addRow(r);
      sheet.columns.forEach((c, i) => {
        row.getCell(i + 1).alignment = { vertical: "middle", horizontal: c.align ?? "left" };
      });
    });

    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: sheet.columns.length } };
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf as ArrayBuffer], { type: MIME }), input.filename);
}
