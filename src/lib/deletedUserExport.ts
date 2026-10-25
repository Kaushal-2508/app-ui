import type { Worksheet } from "exceljs";
import type { DuaExport } from "@/hooks/deletedUsers/useDeletedUsers";

/**
 * Excel workbook for one Deleted Users archive entry: a Summary sheet, one
 * sheet per archived table, then what stayed with the school, files and
 * traces. exceljs is imported lazily (CLAUDE.md §23: heavy libs never in the
 * entry chunk). Cell values are written as text; objects as compact JSON.
 */
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique. */
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Sheet";
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${i++})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function addRows(ws: Worksheet, rows: Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = ws.addRow(columns);
  header.font = { bold: true };
  for (const r of rows) ws.addRow(columns.map((c) => cell(r[c])));
}

export async function buildDeletedUserWorkbook(data: DuaExport): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SALCI";
  wb.created = new Date();
  const used = new Set<string>();

  const summary = wb.addWorksheet(sheetName("Summary", used));
  summary.columns = [{ width: 28 }, { width: 80 }];
  for (const [k, v] of Object.entries(data.header)) summary.addRow([k, cell(v)]);

  const tables = Object.entries(data.tables).sort((a, b) =>
    `${a[1].category} ${a[1].label}`.localeCompare(`${b[1].category} ${b[1].label}`),
  );
  for (const [table, t] of tables) {
    const ws = wb.addWorksheet(sheetName(t.label || table, used));
    ws.addRow([`${t.label} (${table})`, `${t.row_count} rows`, t.mode === "counts" ? "counts only, credentials are never stored" : ""]);
    ws.addRow([]);
    if (t.rows && t.rows.length > 0) addRows(ws, t.rows);
  }

  if (data.kept_with_school.length > 0) {
    const ws = wb.addWorksheet(sheetName("Kept with school", used));
    ws.addRow(["Table", "Column", "Rows", "Ids"]).font = { bold: true };
    for (const k of data.kept_with_school) ws.addRow([k.table, k.column, k.row_count, k.ids.join(", ")]);
    for (const k of data.kept_with_school) {
      if (!k.snapshots || k.snapshots.length === 0) continue;
      const snap = wb.addWorksheet(sheetName(`Kept ${k.table.replace(/^public\./, "")}`, used));
      addRows(snap, k.snapshots);
    }
  }

  if (data.files.length > 0) addRows(wb.addWorksheet(sheetName("Files", used)), data.files);
  if (data.traces.length > 0) {
    addRows(
      wb.addWorksheet(sheetName("Traces", used)),
      data.traces.map((t) => ({ source: t.source, payload: t.payload })),
    );
  }
  if (data.referenced_rows.length > 0) {
    addRows(
      wb.addWorksheet(sheetName("Referenced rows", used)),
      data.referenced_rows.map((r) => ({ table: r.table, pk: r.pk, row: r.row })),
    );
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: MIME });
}
