// Builds the two-sheet "Lesson Plan Delivery" workbook from the
// tt_lesson_plan_export RPC payload. Uses exceljs (lazy-loaded per §23) because
// the spec needs cell fills (red Not-Filled rows + red/amber/green % bands) that
// the plain SheetJS community build cannot produce. British English throughout.
//
// Sheet 1 — Delivery Log: one row per teacher/class/section/subject/slot/date for
// every past-dated scheduled slot in the selected period; rows with no lesson plan
// show as a red "Not Filled" gap.
// Sheet 2 — Chapter Delivery: cumulative-to-today chapter delivery %, RAG-banded.
// "Delivered" = the class was conducted with the teacher present (attendance signal),
// NOT a teaching-complete marker — stated in the note line under the sheet-2 title.

export interface DeliveryLogRow {
  teacher: string;
  class: string;
  section: string;
  subject: string;
  date: string;
  period: string;
  chapter: string | null;
  notes: string | null;
  fill_status: "Filled" | "Not Filled";
  present: string;
}

export interface ChapterDeliveryRow {
  teacher: string;
  class: string;
  section: string;
  subject: string;
  chapters_delivered: number;
  total_chapters: number;
  percentage: number | null;
}

export interface LessonPlanExportMeta {
  period: string;
  period_label: string;
  from: string;
  to: string;
  generated_on: string;
  academic_year: string;
  institution: string;
  scope: "institution" | "coordinator";
}

export interface LessonPlanExportData {
  meta: LessonPlanExportMeta;
  delivery_log: DeliveryLogRow[];
  chapter_delivery: ChapterDeliveryRow[];
}

// Brand + status colours (ARGB).
const C = {
  brand: "FF249CA2",
  white: "FFFFFFFF",
  headerText: "FFFFFFFF",
  notFilledFill: "FFFCE4E4",
  notFilledText: "FFB42318",
  redFill: "FFF8D7DA",
  redText: "FF842029",
  amberFill: "FFFFF3CD",
  amberText: "FF664D03",
  greenFill: "FFD1E7DD",
  greenText: "FF0F5132",
  metaText: "FF667085",
  naFill: "FFEEF1F4",
  naText: "FF98A2B3",
} as const;

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build the workbook and return it as a Blob ready for download. */
export async function buildLessonPlanWorkbook(data: LessonPlanExportData): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SALCI";
  wb.created = new Date();

  const scopeLabel = data.meta.scope === "institution" ? "Whole institution" : "My wings";

  // ---------------------------------------------------------------- Sheet 1
  const ws1 = wb.addWorksheet("Delivery Log", { views: [{ state: "frozen", ySplit: 4 }] });
  ws1.columns = [
    { key: "teacher", width: 22 },
    { key: "class", width: 22 },
    { key: "section", width: 10 },
    { key: "subject", width: 18 },
    { key: "date", width: 14 },
    { key: "period", width: 12 },
    { key: "chapter", width: 30 },
    { key: "notes", width: 34 },
    { key: "status", width: 12 },
    { key: "present", width: 16 },
  ];
  const lastCol1 = "J";

  ws1.mergeCells(`A1:${lastCol1}1`);
  const t1 = ws1.getCell("A1");
  t1.value = "Lesson Plan Delivery Log";
  t1.font = { bold: true, size: 14, color: { argb: C.brand } };

  ws1.mergeCells(`A2:${lastCol1}2`);
  const m1 = ws1.getCell("A2");
  m1.value = `${data.meta.institution} · ${data.meta.period_label} (${data.meta.from} – ${data.meta.to}) · Generated ${data.meta.generated_on} · ${scopeLabel}`;
  m1.font = { italic: true, size: 10, color: { argb: C.metaText } };

  const header1 = ws1.getRow(4);
  header1.values = [
    "Teacher", "Class", "Section", "Subject", "Date", "Period",
    "Chapter", "Teacher's Notes", "Status", "Teacher Present",
  ];
  header1.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.headerText } };
    cell.fill = solid(C.brand);
    cell.alignment = { vertical: "middle" };
  });

  data.delivery_log.forEach((r) => {
    const row = ws1.addRow({
      teacher: r.teacher,
      class: r.class,
      section: r.section,
      subject: r.subject,
      date: r.date,
      period: r.period,
      chapter: r.chapter ?? "",
      notes: r.notes ?? "",
      status: r.fill_status,
      present: r.present,
    });
    row.alignment = { vertical: "top", wrapText: true };
    if (r.fill_status === "Not Filled") {
      // Loud red gap — fill the whole row, bold-red the Status cell.
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = solid(C.notFilledFill);
      });
      const statusCell = row.getCell("status");
      statusCell.font = { bold: true, color: { argb: C.notFilledText } };
    }
  });
  ws1.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 10 } };

  // ---------------------------------------------------------------- Sheet 2
  const ws2 = wb.addWorksheet("Chapter Delivery", { views: [{ state: "frozen", ySplit: 5 }] });
  ws2.columns = [
    { key: "teacher", width: 22 },
    { key: "class", width: 22 },
    { key: "section", width: 10 },
    { key: "subject", width: 18 },
    { key: "delivered", width: 18 },
    { key: "total", width: 16 },
    { key: "pct", width: 20 },
  ];
  const lastCol2 = "G";

  ws2.mergeCells(`A1:${lastCol2}1`);
  const t2 = ws2.getCell("A1");
  t2.value = "Chapter Delivery";
  t2.font = { bold: true, size: 14, color: { argb: C.brand } };

  ws2.mergeCells(`A2:${lastCol2}2`);
  const note = ws2.getCell("A2");
  note.value =
    "Note: ‘Delivered’ means the class was conducted with the teacher present; it does not confirm the chapter was taught to completion.";
  note.font = { italic: true, size: 10, color: { argb: C.metaText } };
  note.alignment = { wrapText: true };
  ws2.getRow(2).height = 28;

  ws2.mergeCells(`A3:${lastCol2}3`);
  const m2 = ws2.getCell("A3");
  m2.value = `${data.meta.institution} · Cumulative to ${data.meta.generated_on} · Academic year ${data.meta.academic_year} · ${scopeLabel}`;
  m2.font = { italic: true, size: 10, color: { argb: C.metaText } };

  const header2 = ws2.getRow(5);
  header2.values = [
    "Teacher", "Class", "Section", "Subject",
    "Chapters Delivered", "Total Chapters", "Chapter Delivery %",
  ];
  header2.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.headerText } };
    cell.fill = solid(C.brand);
    cell.alignment = { vertical: "middle" };
  });

  data.chapter_delivery.forEach((r) => {
    const row = ws2.addRow({
      teacher: r.teacher,
      class: r.class,
      section: r.section,
      subject: r.subject,
      delivered: r.chapters_delivered,
      total: r.total_chapters,
      pct: r.percentage,
    });
    const pctCell = row.getCell("pct");
    if (r.percentage == null) {
      pctCell.value = "N/A";
      pctCell.fill = solid(C.naFill);
      pctCell.font = { color: { argb: C.naText } };
    } else {
      pctCell.value = r.percentage / 100;
      pctCell.numFmt = "0%";
      // RAG triage band: red < 50, amber 50–80, green > 80.
      if (r.percentage < 50) {
        pctCell.fill = solid(C.redFill);
        pctCell.font = { bold: true, color: { argb: C.redText } };
      } else if (r.percentage <= 80) {
        pctCell.fill = solid(C.amberFill);
        pctCell.font = { bold: true, color: { argb: C.amberText } };
      } else {
        pctCell.fill = solid(C.greenFill);
        pctCell.font = { bold: true, color: { argb: C.greenText } };
      }
    }
    pctCell.alignment = { horizontal: "center" };
  });
  ws2.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 7 } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: MIME });
}
