const XLSX = require("xlsx");
const wb = XLSX.readFile("./1777445171171-nru0y9_20260502_130239_questions.xlsx");

const sheets = [
  "MCQ",
  "Fill in the Blanks",
  "True or False",
  "Match the Following",
  "Short Answer",
  "Long Answer",
  "Case Study",
  "Comprehension Para",
];

console.log("Sheet                  rows empty partial latex-tokens long(>1500)");
for (const name of sheets) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
  const dataRows = rows.slice(1);
  const empties = dataRows.filter((r) => !r.some((c) => String(c).trim()));
  const partial = dataRows.filter(
    (r) => r.some((c) => String(c).trim()) && r.some((c) => !String(c).trim()),
  );
  const latex = dataRows.filter((r) =>
    r.some((c) => /\\frac|\\times|\\sqrt|\\alpha|\\beta|\\pi/.test(String(c))),
  );
  const longStr = dataRows.filter((r) => r.some((c) => String(c).length > 1500));
  console.log(
    name.padEnd(22),
    String(dataRows.length).padStart(3),
    String(empties.length).padStart(5),
    String(partial.length).padStart(7),
    String(latex.length).padStart(11),
    String(longStr.length).padStart(11),
  );
}

console.log("\nMCQ correct answer distribution:");
const mcq = XLSX.utils.sheet_to_json(wb.Sheets["MCQ"], { header: 1, defval: "", raw: false }).slice(1);
const dist = {};
for (const r of mcq) {
  const a = String(r[6] || "").trim();
  dist[a] = (dist[a] || 0) + 1;
}
console.log(dist);

console.log("\nTrue/False answer distribution:");
const tf = XLSX.utils.sheet_to_json(wb.Sheets["True or False"], { header: 1, defval: "", raw: false }).slice(1);
const tfDist = {};
for (const r of tf) {
  const a = String(r[2] || "").trim();
  tfDist[a] = (tfDist[a] || 0) + 1;
}
console.log(tfDist);

console.log("\nFirst 3 questions of each partial sheet:");
for (const name of ["Match the Following", "Comprehension Para"]) {
  console.log("\n--- " + name + " ---");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
  const headers = rows[0];
  for (let i = 1; i <= 3 && i < rows.length; i++) {
    console.log("Row " + i + ":");
    headers.forEach((h, idx) => {
      const v = String(rows[i][idx] || "").slice(0, 120);
      if (v) console.log("  " + h + ": " + v);
    });
  }
}

// Check for completely-empty cells inside otherwise-filled rows
console.log("\nRows with at least one blank required cell:");
for (const name of sheets) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const blanks = [];
  dataRows.forEach((r, idx) => {
    headers.forEach((h, ci) => {
      if (!String(r[ci] || "").trim()) {
        blanks.push({ row: idx + 2, col: h });
      }
    });
  });
  if (blanks.length > 0) {
    console.log(name + ": " + blanks.length + " blank cells");
    console.log("  first few: " + JSON.stringify(blanks.slice(0, 5)));
  } else {
    console.log(name + ": no blanks");
  }
}
