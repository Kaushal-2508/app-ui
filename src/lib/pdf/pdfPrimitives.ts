import type jsPDF from "jspdf";
import { PDF_THEME } from "./pdfTheme";

const T = PDF_THEME;

export interface PdfContext {
  doc: jsPDF;
  cursorY: number;          // current draw y (mm)
  pageNumber: number;
  schoolName: string;
  salciLogoDataUrl: string;
  schoolLogoDataUrl: string | null;
  generatedDate: string;    // pre-formatted "Apr 27, 2026"
}

export function drawHeader(ctx: PdfContext): void {
  const { doc, salciLogoDataUrl, schoolLogoDataUrl, schoolName } = ctx;

  const logoY = 8;
  // SALCI logo top-left
  if (salciLogoDataUrl) {
    try {
      doc.addImage(salciLogoDataUrl, "PNG", T.page.marginX, logoY, 0, T.header.logoMaxHeight);
    } catch { /* ignore: bad image */ }
  }

  // School logo top-right + name to its left, OR name alone if no logo
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.body);
  doc.setTextColor(T.colors.text);

  const rightEdge = T.page.width - T.page.marginX;

  if (schoolLogoDataUrl) {
    try {
      const logoW = T.header.logoMaxHeight; // assume square
      const logoX = rightEdge - logoW;
      doc.addImage(schoolLogoDataUrl, "PNG", logoX, logoY, logoW, T.header.logoMaxHeight);
      doc.text(schoolName, logoX - 2, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
    } catch {
      doc.text(schoolName, rightEdge, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
    }
  } else {
    doc.text(schoolName, rightEdge, logoY + T.header.logoMaxHeight / 2 + 2, { align: "right" });
  }

  // Accent rule
  const ruleY = logoY + T.header.logoMaxHeight + 2;
  doc.setDrawColor(T.colors.primary);
  doc.setLineWidth(0.6);
  doc.line(T.page.marginX, ruleY, rightEdge, ruleY);
  doc.setDrawColor(T.colors.border);
  doc.setLineWidth(0.2);

  ctx.cursorY = ruleY + 6;
}

export function drawFooter(ctx: PdfContext, totalPages: number): void {
  const { doc, generatedDate, pageNumber } = ctx;
  const y = T.page.height - 8;

  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.muted);

  doc.text("Confidential · for internal use", T.page.marginX, y);
  doc.text(
    `Generated ${generatedDate} • Page ${pageNumber} of ${totalPages}`,
    T.page.width - T.page.marginX,
    y,
    { align: "right" },
  );
}

export function ensureRoom(ctx: PdfContext, neededHeight: number): void {
  const limit = T.page.height - T.page.marginBottom - 4;
  if (ctx.cursorY + neededHeight > limit) {
    ctx.doc.addPage();
    ctx.pageNumber += 1;
    drawHeader(ctx);
  }
}

export function drawSectionTitle(ctx: PdfContext, label: string): void {
  ensureRoom(ctx, 14);
  const { doc, cursorY } = ctx;

  // Teal accent bar
  doc.setFillColor(T.colors.primary);
  doc.rect(T.page.marginX, cursorY - 4, 2, 7, "F");

  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.h1);
  doc.setTextColor(T.colors.text);
  doc.text(label, T.page.marginX + 5, cursorY + 1);

  ctx.cursorY = cursorY + 8;
}

export function drawKVRow(
  ctx: PdfContext,
  pairs: { label: string; value: string }[],
  cols = 2,
): void {
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const colWidth = totalWidth / cols;
  const rowHeight = 8;
  const rows = Math.ceil(pairs.length / cols);
  ensureRoom(ctx, rows * rowHeight + 2);

  pairs.forEach((p, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = T.page.marginX + c * colWidth;
    const y = ctx.cursorY + r * rowHeight;

    doc.setFont(T.font.family, "normal");
    doc.setFontSize(T.font.sizes.small);
    doc.setTextColor(T.colors.muted);
    doc.text(p.label, x, y);

    doc.setFont(T.font.family, "bold");
    doc.setFontSize(T.font.sizes.body);
    doc.setTextColor(T.colors.text);
    doc.text(p.value, x, y + 4);
  });

  ctx.cursorY += rows * rowHeight + 2;
}

export interface TableColumn<Row> {
  header: string;
  width: number;                                          // proportion (sum to 1.0)
  align?: "left" | "right" | "center";
  render: (row: Row) => string;
}

export function drawTable<Row>(
  ctx: PdfContext,
  columns: TableColumn<Row>[],
  rows: Row[],
  emptyText = "No data.",
): void {
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const headerHeight = 7;
  const rowHeight = 6;

  if (rows.length === 0) {
    ensureRoom(ctx, 8);
    doc.setFont(T.font.family, "italic");
    doc.setFontSize(T.font.sizes.body);
    doc.setTextColor(T.colors.muted);
    doc.text(emptyText, T.page.marginX, ctx.cursorY);
    ctx.cursorY += 6;
    return;
  }

  // Header band
  ensureRoom(ctx, headerHeight + rowHeight);
  doc.setFillColor(T.colors.bandFill);
  doc.rect(T.page.marginX, ctx.cursorY - 4, totalWidth, headerHeight, "F");
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.text);

  let x = T.page.marginX;
  columns.forEach(col => {
    const w = totalWidth * col.width;
    const tx = col.align === "right" ? x + w - 2 : col.align === "center" ? x + w / 2 : x + 2;
    doc.text(col.header, tx, ctx.cursorY + 1, { align: col.align ?? "left" });
    x += w;
  });
  ctx.cursorY += headerHeight;

  // Rows
  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.body);
  rows.forEach((row, idx) => {
    ensureRoom(ctx, rowHeight);
    if (idx % 2 === 1) {
      doc.setFillColor("#fafafa");
      doc.rect(T.page.marginX, ctx.cursorY - 4, totalWidth, rowHeight, "F");
    }
    let cx = T.page.marginX;
    columns.forEach(col => {
      const w = totalWidth * col.width;
      const tx = col.align === "right" ? cx + w - 2 : col.align === "center" ? cx + w / 2 : cx + 2;
      const value = col.render(row);
      // Truncate to fit cell width (rough: 1mm ~ 1.8 chars at 10pt helvetica)
      const maxChars = Math.floor(w / 1.8);
      const display = value.length > maxChars ? value.slice(0, maxChars - 1) + "…" : value;
      doc.setTextColor(T.colors.text);
      doc.text(display, tx, ctx.cursorY + 1, { align: col.align ?? "left" });
      cx += w;
    });
    ctx.cursorY += rowHeight;
  });
  ctx.cursorY += 2;
}

export function drawProgressBar(
  ctx: PdfContext,
  label: string,
  value: number,           // 0–100
  trend: "improving" | "declining" | null,
): void {
  const rowHeight = 7;
  ensureRoom(ctx, rowHeight + 1);
  const { doc } = ctx;
  const totalWidth = T.page.width - T.page.marginX * 2;
  const barX = T.page.marginX + 110;
  const barWidth = T.page.width - T.page.marginX - barX - 20;

  // Label
  doc.setFont(T.font.family, "normal");
  doc.setFontSize(T.font.sizes.body);
  doc.setTextColor(T.colors.text);
  const maxLabelChars = 60;
  const labelText = label.length > maxLabelChars ? label.slice(0, maxLabelChars - 1) + "…" : label;
  doc.text(labelText, T.page.marginX, ctx.cursorY);

  // Bar background
  doc.setFillColor(T.colors.border);
  doc.rect(barX, ctx.cursorY - 3, barWidth, 3, "F");

  // Bar fill colored by bucket
  const fillColor =
    value > 80 ? T.colors.bucket.mastered :
    value >= 60 ? T.colors.bucket.proficient :
    value >= 40 ? T.colors.bucket.developing :
    T.colors.bucket.needsWork;
  doc.setFillColor(fillColor);
  doc.rect(barX, ctx.cursorY - 3, (barWidth * Math.min(Math.max(value, 0), 100)) / 100, 3, "F");

  // Percentage + trend
  doc.setFont(T.font.family, "bold");
  doc.setFontSize(T.font.sizes.small);
  doc.setTextColor(T.colors.muted);
  const trendMark = trend === "improving" ? "  ↑" : trend === "declining" ? "  ↓" : "";
  doc.text(`${value.toFixed(0)}%${trendMark}`, T.page.width - T.page.marginX, ctx.cursorY, {
    align: "right",
  });

  ctx.cursorY += rowHeight;

  // suppress unused-var warning in environments where this file is consumed without all helpers
  void totalWidth;
}
