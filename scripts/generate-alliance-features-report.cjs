// Generates an Excel report of the platform features enabled for
// Alliance International School (institution 8af718c6-ca11-482b-9d6b-832f2b767928).
//
// Catalog of features = AVAILABLE_FEATURES in
//   src/components/admin/institution-wizard/featuresData.ts  (29 features)
// Enabled set = the feature_ids in institution_features for AIS, pulled live
//   from the DB via the Management API on 2026-06-09 (21 of 29).
//
// Usage:  node scripts/generate-alliance-features-report.cjs
const XLSX = require("xlsx");
const { resolve } = require("node:path");

const MODULE_LABEL = {
  core: "Core",
  academic: "Academic",
  operations: "Operations",
  advanced: "Advanced",
};

// Mirror of AVAILABLE_FEATURES (id, name, description, category) — keep in sync
// with featuresData.ts if the catalog changes.
const CATALOG = [
  ["dashboard", "Dashboard", "Role-based dashboards with analytics and insights", "core"],
  ["user_management", "User Management", "Manage teachers, students, and coordinators", "core"],
  ["classes", "Classes & Sections", "Organize students into classes and sections", "core"],
  ["exams", "Exam Management", "Create, publish, and manage online/offline exams", "academic"],
  ["homework", "Homework and Assignment", "Create, distribute, and grade homework and assignments", "academic"],
  ["syllabus", "Syllabus & Study Materials", "Manage subjects, topics, and study resources", "academic"],
  ["evaluations", "Evaluations & Grading", "AI-assisted grading and manual evaluations", "academic"],
  ["reports", "Reports & Analytics", "Performance reports and insights for all stakeholders", "academic"],
  ["question_bank", "Question Bank", "Centralized repository of exam questions by subject and topic", "academic"],
  ["student_passport", "Student Passport / Learning Profile", "Comprehensive student learning journey and performance profile", "academic"],
  ["timetable", "Timetable & Lesson Planning", "Manage class timetables and lesson plans", "academic"],
  ["tasks", "Task Management", "Assign and track tasks with evidence submission", "operations"],
  ["wings", "Wings & Coordinators", "Organize classes into wings with coordinator oversight", "operations"],
  ["proctoring", "Live Proctoring", "Monitor online exams with face detection and alerts", "operations"],
  ["recheck_management", "Recheck Requests", "Allow students to request answer rechecks", "operations"],
  ["attendance", "Attendance Management", "Track student attendance via QR, PIN, face recognition, or biometric", "operations"],
  ["fee_management", "Fee & Finance Management", "Fee structures, installments, concessions, and receipts", "operations"],
  ["hr_payroll", "HR & Payroll", "Staff directory, salary structures, payroll runs, and leave management", "operations"],
  ["communication", "Communication & Messaging", "In-app messaging between teachers, students, and parents", "operations"],
  ["circulars", "Circulars & Notices", "Publish and track school-wide announcements and circulars", "operations"],
  ["ptm_scheduling", "PTM Scheduling", "Schedule and manage parent-teacher meetings", "operations"],
  ["holiday_calendar", "Holiday Calendar", "Manage academic calendar and holidays", "operations"],
  ["ai_question_generation", "AI Question Generation", "Generate exam questions using AI", "advanced"],
  ["ocr_scanning", "OCR Answer Scanning", "Scan and digitize offline answer sheets", "advanced"],
  ["billing", "Billing & Payments", "Subscription and payment management", "advanced"],
  ["ai_predictions", "AI Performance Predictions", "Predict student performance trends using AI analytics", "advanced"],
  ["ai_grading", "AI Grading Assistance", "AI-powered automated grading for subjective answers", "advanced"],
  ["biometric_attendance", "Biometric Attendance", "Fingerprint-based attendance tracking integration", "advanced"],
  ["olympiad", "SALCI Olympiad", "Run the SALCI Olympiad campaign for this school", "advanced"],
];

// Enabled feature_ids pulled from institution_features for AIS (2026-06-09).
const ENABLED = new Set([
  "ai_grading", "ai_predictions", "ai_question_generation", "attendance", "classes",
  "dashboard", "evaluations", "exams", "holiday_calendar", "homework", "ocr_scanning",
  "proctoring", "question_bank", "recheck_management", "reports", "student_passport",
  "syllabus", "tasks", "timetable", "user_management", "wings",
]);

const total = CATALOG.length;
const enabledCount = CATALOG.filter(([id]) => ENABLED.has(id)).length;
const TITLE = "Alliance International School";
const GEN = "Generated 09 Jun 2026  ·  Institution ID: 8af718c6-ca11-482b-9d6b-832f2b767928";

const wb = XLSX.utils.book_new();

// ---- Sheet 1: All features with enabled/not-enabled status -----------------
const allRows = [
  [`${TITLE} — Feature Access Report`],
  [`${enabledCount} of ${total} platform features enabled  ·  ${GEN}`],
  [],
  ["Module", "Feature Name", "Description", "Status"],
  ...CATALOG.map(([id, name, desc, cat]) => [
    MODULE_LABEL[cat],
    name,
    desc,
    ENABLED.has(id) ? "Enabled" : "Not enabled",
  ]),
];
const wsAll = XLSX.utils.aoa_to_sheet(allRows);
wsAll["!cols"] = [{ wch: 13 }, { wch: 34 }, { wch: 70 }, { wch: 13 }];
wsAll["!merges"] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
  { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
];
// AutoFilter over the table header + data
wsAll["!autofilter"] = { ref: `A4:D${4 + CATALOG.length}` };
// Freeze the header rows
wsAll["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
XLSX.utils.book_append_sheet(wb, wsAll, "Feature Access");

// ---- Sheet 2: Enabled features only (Module / Feature Name / Description) ---
const enabledRows = [
  [`${TITLE} — Enabled Features`],
  [`${enabledCount} features enabled  ·  ${GEN}`],
  [],
  ["Module", "Feature Name", "Description"],
  ...CATALOG.filter(([id]) => ENABLED.has(id)).map(([, name, desc, cat]) => [
    MODULE_LABEL[cat],
    name,
    desc,
  ]),
];
const wsEnabled = XLSX.utils.aoa_to_sheet(enabledRows);
wsEnabled["!cols"] = [{ wch: 13 }, { wch: 34 }, { wch: 70 }];
wsEnabled["!merges"] = [
  { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
  { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
];
wsEnabled["!autofilter"] = { ref: `A4:C${4 + enabledCount}` };
wsEnabled["!freeze"] = { xSplit: 0, ySplit: 4, topLeftCell: "A5", activePane: "bottomLeft", state: "frozen" };
XLSX.utils.book_append_sheet(wb, wsEnabled, "Enabled Features");

const out = resolve("Alliance-International-School-Features.xlsx");
XLSX.writeFile(wb, out);
console.log(`Wrote: ${out}`);
console.log(`Enabled: ${enabledCount} / ${total}`);
