import { jsPDF } from "jspdf";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const teachers = [
  // Apr 25
  { date: "2026-04-25", time: "07:29", name: "Amandeep Kaur",         email: "amannartej58@gmail.com" },
  { date: "2026-04-25", time: "07:34", name: "Sarbjeet Kaur",         email: "sarbjeetkaurkalra@gmail.com" },
  { date: "2026-04-25", time: "07:36", name: "Mansi Verma",           email: "mansiverma2416@gmail.com" },
  { date: "2026-04-25", time: "07:36", name: "Amandeep Kaur Saini",   email: "amansaini1300@gmail.com" },
  { date: "2026-04-25", time: "07:41", name: "Navdeep Kaur",          email: "navdeepkaur00@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Kajal",                 email: "kajalahuja0212@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Reema Vermani",         email: "koyalkinger4243@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Rekha Rani",            email: "rrani571248@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Manpreet Kaur",         email: "mkaur788872@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Simrat Kaur Narang",    email: "simratkaurnarang@gmail.com" },
  { date: "2026-04-25", time: "07:49", name: "Saurabh Sharma",        email: "mr.saurabh707@gmail.com" },
  // May 1
  { date: "2026-05-01", time: "07:14", name: "Tamanpreet kaur",       email: "tamanpreet7518@gmail.com" },
  { date: "2026-05-01", time: "07:30", name: "Urvashi",               email: "urvashibatra13@gmail.com" },
  { date: "2026-05-01", time: "08:02", name: "sarbjeet kaur",         email: "sarbkalra15@gmail.com" },
  { date: "2026-05-01", time: "08:03", name: "HARJOT KAUR",           email: "18harjotkaur1998@gmail.com" },
  { date: "2026-05-01", time: "09:58", name: "Gursharan kaur",        email: "manrajkang563@gmail.com" },
  { date: "2026-05-01", time: "09:59", name: "RAMANJEET KAUR",        email: "jeetraman2122@gmail.com" },
  { date: "2026-05-01", time: "10:25", name: "kamal",                 email: "kamal088007@gmail.com" },
];

const doc = new jsPDF({ unit: "pt", format: "a4" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 40;

// Brand stripe
doc.setFillColor(36, 156, 162); // SALCI teal
doc.rect(0, 0, pageW, 6, "F");

// Header
doc.setFont("helvetica", "bold");
doc.setFontSize(18);
doc.setTextColor(20, 30, 50);
doc.text("Alliance International School", margin, 50);

doc.setFont("helvetica", "normal");
doc.setFontSize(11);
doc.setTextColor(90, 100, 120);
doc.text("Teachers created — last 7 days", margin, 70);

doc.setFontSize(9);
doc.setTextColor(120, 130, 150);
doc.text("Window: 25 Apr 2026 – 1 May 2026  ·  Generated 1 May 2026", margin, 86);

// Summary band
const bandY = 104;
doc.setFillColor(247, 250, 252);
doc.roundedRect(margin, bandY, pageW - margin * 2, 50, 6, 6, "F");

doc.setFont("helvetica", "bold");
doc.setFontSize(22);
doc.setTextColor(36, 156, 162);
doc.text("18", margin + 16, bandY + 32);

doc.setFont("helvetica", "normal");
doc.setFontSize(10);
doc.setTextColor(80, 90, 110);
doc.text("teachers created", margin + 50, bandY + 25);
doc.text("11 on 25 Apr  ·  7 on 1 May  ·  0 on 26–30 Apr", margin + 50, bandY + 39);

// Table
const tableTop = 180;
const colX = {
  num: margin,
  date: margin + 30,
  time: margin + 100,
  name: margin + 145,
  email: margin + 295,
};
const rowH = 22;

function header(y) {
  doc.setFillColor(36, 156, 162);
  doc.rect(margin, y - 14, pageW - margin * 2, rowH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("#",     colX.num + 2,  y);
  doc.text("Date",  colX.date,     y);
  doc.text("Time",  colX.time,     y);
  doc.text("Name",  colX.name,     y);
  doc.text("Email", colX.email,    y);
}

let y = tableTop;
header(y);
y += rowH;

doc.setFont("helvetica", "normal");
doc.setFontSize(10);

teachers.forEach((t, i) => {
  if (y > pageH - 60) {
    doc.addPage();
    y = 60;
    header(y);
    y += rowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  }

  // Zebra rows
  if (i % 2 === 0) {
    doc.setFillColor(250, 251, 253);
    doc.rect(margin, y - 14, pageW - margin * 2, rowH, "F");
  }

  doc.setTextColor(40, 50, 70);
  doc.text(String(i + 1), colX.num + 2, y);
  doc.text(t.date,        colX.date,    y);
  doc.text(t.time,        colX.time,    y);
  doc.text(t.name,        colX.name,    y);
  doc.setTextColor(80, 90, 110);
  doc.text(t.email,       colX.email,   y);

  y += rowH;
});

// Footer
doc.setFont("helvetica", "italic");
doc.setFontSize(8);
doc.setTextColor(140, 150, 170);
doc.text(
  "SALCI · Self Analysis For Learning & Competency Improvement",
  margin,
  pageH - 20,
);

const out = resolve("Alliance-Teachers-Last7Days.pdf");
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log("Wrote:", out);
