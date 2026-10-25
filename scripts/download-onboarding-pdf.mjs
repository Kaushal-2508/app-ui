// Render the onboarding-journey report (already fetched into
// scripts/.alliance-data.json by `supabase db query --linked --file
// scripts/onboarding-alliance.sql --output json`) as a PDF.
//
// Usage:
//   node scripts/download-onboarding-pdf.mjs \
//     scripts/.alliance-data.json "Alliance International School"

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const dataPath = process.argv[2];
const schoolName = process.argv[3] || "School";
if (!dataPath || !fs.existsSync(dataPath)) {
  console.error("Pass path to the JSON fetched via supabase db query --output json");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const rows = payload.rows ?? payload;

const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 32;

const total = rows.length;
const fullyDone = rows.filter((r) => r.is_journey_completed).length;
const avgPct =
  total === 0
    ? 0
    : Math.round(
        rows.reduce((s, r) => s + Number(r.completion_percent ?? 0), 0) / total,
      );
const ms = (key) => rows.filter((r) => r[key]).length;
const counts = {
  first_task_assigned: ms("first_task_assigned"),
  first_task_completed: ms("first_task_completed"),
  first_study_material_uploaded: ms("first_study_material_uploaded"),
  first_exam_published: ms("first_exam_published"),
  first_result_validated: ms("first_result_validated"),
};
const generatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

// Header band
doc.setFillColor(36, 156, 162);
doc.rect(0, 0, pageW, 70, "F");
doc.setTextColor(255, 255, 255);
doc.setFont("helvetica", "bold");
doc.setFontSize(18);
doc.text("Onboarding Journey Report", margin, 32);
doc.setFont("helvetica", "normal");
doc.setFontSize(11);
doc.text(schoolName, margin, 52);
doc.setFontSize(9);
doc.text(`Generated: ${generatedAt}`, pageW - margin, 52, { align: "right" });

doc.setTextColor(33, 33, 33);

// Summary tiles
let y = 96;
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text("Summary", margin, y);
y += 14;
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
const summaryCells = [
  ["Total teachers / coordinators", String(total)],
  [
    "Fully complete",
    `${fullyDone} (${total === 0 ? 0 : Math.round((fullyDone / total) * 100)}%)`,
  ],
  ["Average completion", `${avgPct}%`],
];
let sx = margin;
for (const [label, value] of summaryCells) {
  doc.setDrawColor(220);
  doc.setFillColor(247, 247, 247);
  doc.roundedRect(sx, y, 200, 46, 6, 6, "FD");
  doc.setTextColor(110);
  doc.setFontSize(8);
  doc.text(label.toUpperCase(), sx + 12, y + 16);
  doc.setTextColor(33);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(value, sx + 12, y + 36);
  doc.setFont("helvetica", "normal");
  sx += 212;
}
y += 60;

// Milestone tiles
doc.setFontSize(10);
doc.setTextColor(33);
const milestoneLabels = [
  ["First task created or received", counts.first_task_assigned],
  ["First task completed", counts.first_task_completed],
  ["First study material uploaded", counts.first_study_material_uploaded],
  ["First exam published", counts.first_exam_published],
  ["First result validated/published", counts.first_result_validated],
];
doc.setFont("helvetica", "bold");
doc.text("Milestone completion (count of users)", margin, y);
y += 14;
doc.setFont("helvetica", "normal");
let mx = margin;
const mTileW = (pageW - margin * 2 - 16) / 5;
for (const [label, count] of milestoneLabels) {
  doc.setDrawColor(220);
  doc.setFillColor(252, 252, 252);
  doc.roundedRect(mx, y, mTileW, 52, 6, 6, "FD");
  doc.setFontSize(8);
  doc.setTextColor(90);
  const wrapped = doc.splitTextToSize(label, mTileW - 16);
  doc.text(wrapped, mx + 8, y + 14);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(36, 156, 162);
  doc.text(`${count} / ${total}`, mx + 8, y + 44);
  doc.setFont("helvetica", "normal");
  mx += mTileW + 4;
}
y += 68;

// Table
const headers = ["Name", "Email", "Role", "T1", "T2", "SM", "EX", "RV", "%", "Done"];
const colWidths = [140, 200, 60, 28, 28, 28, 28, 28, 44, 50];
const tableW = colWidths.reduce((a, b) => a + b, 0);
const startX = margin;

const drawHeader = () => {
  doc.setFillColor(36, 156, 162);
  doc.setDrawColor(36, 156, 162);
  doc.rect(startX, y, tableW, 22, "F");
  doc.setTextColor(255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    const align = i <= 2 ? "left" : "center";
    const tx = align === "left" ? x + 6 : x + colWidths[i] / 2;
    doc.text(headers[i], tx, y + 15, { align });
    x += colWidths[i];
  }
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(33);
};
drawHeader();

const yesNo = (v) => (v ? "Y" : "-");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "Teacher");

doc.setFontSize(9);
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const rowH = 18;
  if (y + rowH > pageH - margin) {
    doc.addPage();
    y = margin;
    drawHeader();
  }
  if (i % 2 === 0) {
    doc.setFillColor(248, 248, 248);
    doc.rect(startX, y, tableW, rowH, "F");
  }
  let x = startX;
  const cells = [
    r.full_name ?? "—",
    r.email ?? "—",
    cap(r.role),
    yesNo(r.first_task_assigned),
    yesNo(r.first_task_completed),
    yesNo(r.first_study_material_uploaded),
    yesNo(r.first_exam_published),
    yesNo(r.first_result_validated),
    `${Math.round(Number(r.completion_percent ?? 0))}%`,
    r.is_journey_completed ? "Yes" : "No",
  ];
  for (let j = 0; j < cells.length; j++) {
    const align = j <= 2 ? "left" : "center";
    const tx = align === "left" ? x + 6 : x + colWidths[j] / 2;
    let txt = String(cells[j]);
    if (j <= 2) {
      const trimmed = doc.splitTextToSize(txt, colWidths[j] - 10)[0] ?? txt;
      txt = trimmed;
    }
    if (j === 9 && cells[j] === "Yes") doc.setTextColor(36, 156, 162);
    doc.text(txt, tx, y + 12, { align });
    doc.setTextColor(33);
    x += colWidths[j];
  }
  y += rowH;
}

if (y + 40 > pageH - margin) {
  doc.addPage();
  y = margin;
}
y += 8;
doc.setFontSize(8);
doc.setTextColor(110);
doc.text(
  "Legend — T1: First task created/received  ·  T2: First task completed  ·  SM: First study material uploaded  ·  EX: First exam published  ·  RV: First result validated/published",
  margin,
  y,
);

const safeName = schoolName.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
const dateStamp = new Date().toISOString().slice(0, 10);
const outPath = path.join(repoRoot, `${safeName}_Onboarding_Journey_${dateStamp}.pdf`);
fs.writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log(`Wrote: ${outPath}`);
