/**
 * CBSE Report PDF generators using html2pdf.js
 * Matches patterns from ExamReportPDF.tsx and StudentReportPDF.tsx
 */

import { formatCurrency, formatPercent } from "@/lib/formatNumber";
import { formatClassName } from "@/lib/utils";
import { escapeHtml } from "@/lib/escapeHtml";

export interface ReportData {
  schoolName: string;
  academicYear: string;
  term: string;
  schoolAvg: number;
  passRate: number;
  todayPct: number;
  todayPresent: number;
  todayTotal: number;
  studentPositioning: {
    needsAttention: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
    developing: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
    stable: { count: number; percentage: number; students: { id: string; name: string; class: string; accuracy: number }[] };
  };
  examPipeline: { draft: number; published: number; completed: number; total: number; draftExams: { id: string; title: string; class_name: string }[] };
  feeDefaulterCount: number;
  feeDefaulterAmount: number;
  feeCollectionPct: number;
  complianceScore: number;
  pendingEvals: { attemptId: string; studentName: string; examTitle: string; className: string; status: string }[];
  highestClass: { grade: string; section: string; avgPercent: number } | null;
  lowestClass: { grade: string; section: string; avgPercent: number } | null;
  aiPendingCount: number;
  improvementRate: number;
}

type HasFeatureFn = (key: string) => boolean;

// --- Shared styles ---

const baseStyles = `
  font-family: 'Segoe UI', sans-serif;
  padding: 30px;
  color: #1e293b;
  font-size: 12px;
  line-height: 1.5;
`;

const tableStyle = `width: 100%; border-collapse: collapse; font-size: 11px; margin: 12px 0;`;
const thStyle = `padding: 8px 10px; border: 1px solid #e2e8f0; text-align: left; background: #f1f5f9; font-weight: 600; font-size: 11px;`;
const tdStyle = `padding: 6px 10px; border: 1px solid #e2e8f0; font-size: 11px;`;
const tdAltBg = `background: #f8fafc;`;
const sectionTitle = `font-size: 15px; font-weight: 600; color: #0f172a; margin: 24px 0 12px 0; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0;`;
const pageBreak = `<div style="page-break-before: always;"></div>`;

function coverPage(schoolName: string, reportTitle: string, year: string, term: string, sections: string[]): string {
  const date = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const termLabel = term === "full_year" ? "Full Year" : term === "term_1" ? "Term 1" : "Term 2";
  return `
    <div style="text-align: center; padding: 60px 40px; min-height: 90vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <img src="/Logo.png" style="height: 60px; margin-bottom: 20px;" onerror="this.style.display='none'" />
      <h1 style="font-size: 28px; font-weight: 700; color: #0f172a; margin: 8px 0;">${schoolName}</h1>
      <h2 style="font-size: 18px; font-weight: 500; color: #475569; margin: 8px 0;">${reportTitle}</h2>
      <p style="font-size: 13px; color: #64748b; margin: 16px 0;">Academic Year: ${year} · ${termLabel}</p>
      <p style="font-size: 12px; color: #94a3b8;">Generated: ${date}</p>
      <p style="font-size: 11px; color: #cbd5e1; margin-top: 24px; font-style: italic;">Confidential · Internal Use</p>
      <div style="margin-top: 32px; text-align: left; width: 100%; max-width: 400px;">
        <p style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 8px;">Sections included:</p>
        <ul style="font-size: 11px; color: #64748b; padding-left: 20px;">
          ${sections.map((s) => `<li style="margin: 3px 0;">${s}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function footerHtml(schoolName: string, reportType: string): string {
  return `<div style="position: fixed; bottom: 10px; left: 0; right: 0; text-align: center; font-size: 9px; color: #94a3b8;">${schoolName} · ${reportType}</div>`;
}

function notePage(excludedSections: string[]): string {
  if (excludedSections.length === 0) return "";
  return `
    ${pageBreak}
    <div style="padding: 60px 40px;">
      <h3 style="font-size: 16px; color: #475569; font-weight: 500; margin-bottom: 24px;">A note on this report</h3>
      <p style="font-size: 13px; color: #64748b; line-height: 1.8; max-width: 500px;">
        Some data sections were not included as they are not part of your current SALCI plan.
        This report reflects all information available for your school.
      </p>
      <p style="font-size: 13px; color: #64748b; line-height: 1.8; max-width: 500px; margin-top: 16px;">
        To include ${excludedSections.join(", ")}, contact your SALCI account manager.
      </p>
      <div style="position: absolute; bottom: 40px; right: 40px;">
        <img src="/Logo.png" style="height: 30px; opacity: 0.5;" onerror="this.style.display='none'" />
      </div>
    </div>
  `;
}

function studentTable(students: { name: string; class: string; accuracy: number }[], maxRows = 50): string {
  return `
    <table style="${tableStyle}">
      <thead><tr>
        <th style="${thStyle}">Name</th>
        <th style="${thStyle}">Class</th>
        <th style="${thStyle} text-align: right;">Avg %</th>
      </tr></thead>
      <tbody>
        ${students.slice(0, maxRows).map((s, i) => `
          <tr style="${i % 2 === 1 ? tdAltBg : ""}">
            <td style="${tdStyle}">${escapeHtml(s.name)}</td>
            <td style="${tdStyle}">${escapeHtml(s.class)}</td>
            <td style="${tdStyle} text-align: right; font-weight: 600; color: ${s.accuracy < 50 ? "#ef4444" : s.accuracy < 65 ? "#f59e0b" : "#10b981"};">${s.accuracy.toFixed(1)}%</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function htmlToPdfBlob(html: string): Promise<Blob> {
  const { default: html2pdf } = await import("html2pdf.js");
  const container = document.createElement("div");
  container.innerHTML = html;

  const blob: Blob = await html2pdf()
    .from(container)
    .set({
      margin: [10, 10, 15, 10],
      filename: "report.pdf",
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    })
    .outputPdf("blob");

  return blob;
}

// =========================================================================
// REPORT A: Full CBSE Compliance Report
// =========================================================================

export async function generateComplianceReport(data: ReportData, hasFeature: HasFeatureFn): Promise<Blob> {
  const allSections: { name: string; key?: string; html: string }[] = [];
  const excluded: string[] = [];

  // School overview — always
  allSections.push({
    name: "School Overview",
    html: `
      <h3 style="${sectionTitle}">School Overview</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600; width: 200px;">School Name</td><td style="${tdStyle}">${data.schoolName}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Academic Year</td><td style="${tdStyle}">${data.academicYear}</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">School Average</td><td style="${tdStyle}">${data.schoolAvg.toFixed(1)}%</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Pass Rate</td><td style="${tdStyle}">${data.passRate.toFixed(1)}%</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">Total Students Evaluated</td><td style="${tdStyle}">${data.studentPositioning.needsAttention.count + data.studentPositioning.developing.count + data.studentPositioning.stable.count}</td></tr>
        </tbody>
      </table>
    `,
  });

  // Student enrolment — always
  const total = data.studentPositioning.needsAttention.count + data.studentPositioning.developing.count + data.studentPositioning.stable.count;
  allSections.push({
    name: "Student Enrolment by Class",
    html: `
      <h3 style="${sectionTitle}">Student Enrolment Summary</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600;">At Risk (&lt;50%)</td><td style="${tdStyle}">${data.studentPositioning.needsAttention.count} students (${data.studentPositioning.needsAttention.percentage.toFixed(1)}%)</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Developing (50–65%)</td><td style="${tdStyle}">${data.studentPositioning.developing.count} students (${data.studentPositioning.developing.percentage.toFixed(1)}%)</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">Stable (&gt;65%)</td><td style="${tdStyle}">${data.studentPositioning.stable.count} students (${data.studentPositioning.stable.percentage.toFixed(1)}%)</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Total</td><td style="${tdStyle}">${total}</td></tr>
        </tbody>
      </table>
    `,
  });

  // Attendance analysis — always
  allSections.push({
    name: "Attendance Analysis",
    html: `
      <h3 style="${sectionTitle}">Attendance Analysis</h3>
      <p style="font-size: 12px; color: #475569;">Today's Attendance: <strong>${data.todayPct.toFixed(1)}%</strong> (${data.todayPresent} of ${data.todayTotal} present)</p>
      ${data.studentPositioning.needsAttention.students.length > 0 ? `
        <p style="font-size: 12px; color: #ef4444; margin-top: 12px; font-weight: 600;">Students below 50% average (debarment risk):</p>
        ${studentTable(data.studentPositioning.needsAttention.students, 30)}
      ` : `<p style="font-size: 12px; color: #10b981; margin-top: 8px;">No students below 50% threshold.</p>`}
    `,
  });

  // Exam records — always
  allSections.push({
    name: "Exam Records & Results",
    html: `
      <h3 style="${sectionTitle}">Exam Records & Results</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600;">Total Exams</td><td style="${tdStyle}">${data.examPipeline.total}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Draft</td><td style="${tdStyle}">${data.examPipeline.draft}</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">Published</td><td style="${tdStyle}">${data.examPipeline.published}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Completed</td><td style="${tdStyle}">${data.examPipeline.completed}</td></tr>
        </tbody>
      </table>
    `,
  });

  // Subject & class-wise results — always
  allSections.push({
    name: "Subject & Class-wise Results",
    html: `
      <h3 style="${sectionTitle}">Class-wise Performance</h3>
      <table style="${tableStyle}">
        <thead><tr>
          <th style="${thStyle}">Class</th>
          <th style="${thStyle} text-align: right;">Average %</th>
        </tr></thead>
        <tbody>
          ${data.highestClass ? `<tr><td style="${tdStyle}">${formatClassName(data.highestClass.grade, data.highestClass.section)} (Highest)</td><td style="${tdStyle} text-align: right; color: #10b981; font-weight: 600;">${data.highestClass.avgPercent.toFixed(1)}%</td></tr>` : ""}
          ${data.lowestClass ? `<tr style="${tdAltBg}"><td style="${tdStyle}">${formatClassName(data.lowestClass.grade, data.lowestClass.section)} (Lowest)</td><td style="${tdStyle} text-align: right; color: #ef4444; font-weight: 600;">${data.lowestClass.avgPercent.toFixed(1)}%</td></tr>` : ""}
        </tbody>
      </table>
    `,
  });

  // Teacher accountability — always
  allSections.push({
    name: "Teacher Accountability",
    html: `
      <h3 style="${sectionTitle}">Teacher Accountability</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600;">Pending Evaluations</td><td style="${tdStyle}">${data.pendingEvals.length}</td></tr>
        </tbody>
      </table>
    `,
  });

  // Finance — feature gated
  if (hasFeature("finance")) {
    allSections.push({
      name: "Finance & Fee Records",
      key: "finance",
      html: `
        <h3 style="${sectionTitle}">Finance & Fee Records</h3>
        <table style="${tableStyle}">
          <tbody>
            <tr><td style="${tdStyle} font-weight: 600;">Fee Collection Rate</td><td style="${tdStyle}">${data.feeCollectionPct.toFixed(1)}%</td></tr>
            <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Defaulters Count</td><td style="${tdStyle}">${data.feeDefaulterCount}</td></tr>
            <tr><td style="${tdStyle} font-weight: 600;">Total Overdue Amount</td><td style="${tdStyle}">${formatCurrency(data.feeDefaulterAmount)}</td></tr>
          </tbody>
        </table>
      `,
    });
  } else {
    excluded.push("Finance & Fee Records");
  }

  // Compliance scorecard — always shown (no feature gating per user decision)
  allSections.push({
    name: "Compliance Scorecard",
    html: `
      <h3 style="${sectionTitle}">Compliance Scorecard</h3>
      <p style="font-size: 12px; color: #475569; margin-bottom: 12px;">Overall Score: <strong>${data.complianceScore.toFixed(1)}%</strong></p>
      <table style="${tableStyle}">
        <thead><tr>
          <th style="${thStyle}">Requirement</th>
          <th style="${thStyle} text-align: center;">Status</th>
          <th style="${thStyle}">Data Source</th>
        </tr></thead>
        <tbody>
          <tr><td style="${tdStyle}">Attendance records</td><td style="${tdStyle} text-align: center; color: ${data.todayTotal > 0 ? "#10b981" : "#ef4444"}; font-weight: 600;">${data.todayTotal > 0 ? "✓" : "✗"}</td><td style="${tdStyle}">attendance_records</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle}">Exam records exist</td><td style="${tdStyle} text-align: center; color: ${data.examPipeline.total > 0 ? "#10b981" : "#ef4444"}; font-weight: 600;">${data.examPipeline.total > 0 ? "✓" : "✗"}</td><td style="${tdStyle}">exams</td></tr>
          <tr><td style="${tdStyle}">All evaluations submitted</td><td style="${tdStyle} text-align: center; color: ${data.pendingEvals.length === 0 ? "#10b981" : "#ef4444"}; font-weight: 600;">${data.pendingEvals.length === 0 ? "✓" : "✗"}</td><td style="${tdStyle}">evaluations</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle}">Student records exist</td><td style="${tdStyle} text-align: center; color: #10b981; font-weight: 600;">✓</td><td style="${tdStyle}">final_results</td></tr>
          <tr><td style="${tdStyle}">Fee data available</td><td style="${tdStyle} text-align: center; color: ${data.feeCollectionPct > 0 ? "#10b981" : "#ef4444"}; font-weight: 600;">${data.feeCollectionPct > 0 ? "✓" : "✗"}</td><td style="${tdStyle}">fee_analytics</td></tr>
        </tbody>
      </table>
    `,
  });

  // AI suggestions — feature gated
  if (hasFeature("ai_suggestions")) {
    allSections.push({
      name: "AI Suggestions Summary",
      key: "ai_suggestions",
      html: `
        <h3 style="${sectionTitle}">AI Suggestions Summary</h3>
        <p style="font-size: 12px; color: #475569;">${data.aiPendingCount} AI-generated task suggestions pending review.</p>
      `,
    });
  } else {
    excluded.push("AI Suggestions Summary");
  }

  const sectionNames = allSections.map((s) => s.name);
  const cover = coverPage(data.schoolName, "Full CBSE Compliance Report", data.academicYear, data.term, sectionNames);
  const sections = allSections.map((s, i) => (i > 0 ? pageBreak : "") + s.html).join("");
  const note = notePage(excluded);

  const fullHtml = `<div style="${baseStyles}">${cover}${pageBreak}${sections}${note}</div>`;
  return htmlToPdfBlob(fullHtml);
}

// =========================================================================
// REPORT B: Inspection Readiness Report
// =========================================================================

export async function generateInspectionReport(data: ReportData, hasFeature: HasFeatureFn): Promise<Blob> {
  const allSections: { name: string; html: string }[] = [];
  const excluded: string[] = [];

  // School key facts — always
  allSections.push({
    name: "School Key Facts",
    html: `
      <h3 style="${sectionTitle}">School Key Facts</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600; width: 200px;">School Name</td><td style="${tdStyle}">${data.schoolName}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Academic Year</td><td style="${tdStyle}">${data.academicYear}</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">School Average</td><td style="${tdStyle}">${data.schoolAvg.toFixed(1)}%</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Pass Rate</td><td style="${tdStyle}">${data.passRate.toFixed(1)}%</td></tr>
        </tbody>
      </table>
    `,
  });

  // Attendance snapshot — always
  allSections.push({
    name: "Attendance Snapshot",
    html: `
      <h3 style="${sectionTitle}">Attendance Snapshot</h3>
      <p style="font-size: 12px;">Today: <strong>${data.todayPresent}</strong> of <strong>${data.todayTotal}</strong> present (<strong>${data.todayPct.toFixed(1)}%</strong>)</p>
      ${data.studentPositioning.needsAttention.students.length > 0 ? `
        <p style="font-size: 12px; color: #ef4444; margin-top: 8px; font-weight: 600;">Students below 50% (at risk):</p>
        ${studentTable(data.studentPositioning.needsAttention.students, 20)}
      ` : ""}
    `,
  });

  // Exam pipeline — always
  allSections.push({
    name: "Exam Pipeline Status",
    html: `
      <h3 style="${sectionTitle}">Exam Pipeline Status</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600;">Draft</td><td style="${tdStyle}">${data.examPipeline.draft}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Published</td><td style="${tdStyle}">${data.examPipeline.published}</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">Completed</td><td style="${tdStyle}">${data.examPipeline.completed}</td></tr>
        </tbody>
      </table>
    `,
  });

  // Teacher evaluation status — always
  allSections.push({
    name: "Teacher Evaluation Status",
    html: `
      <h3 style="${sectionTitle}">Teacher Evaluation Status</h3>
      <p style="font-size: 12px;">${data.pendingEvals.length > 0 ? `<span style="color: #ef4444; font-weight: 600;">${data.pendingEvals.length} evaluations pending review</span>` : `<span style="color: #10b981;">All evaluations complete</span>`}</p>
    `,
  });

  // Fee overdue summary — feature gated
  if (hasFeature("finance")) {
    allSections.push({
      name: "Fee Overdue Summary",
      html: `
        <h3 style="${sectionTitle}">Fee Overdue Summary</h3>
        <table style="${tableStyle}">
          <tbody>
            <tr><td style="${tdStyle} font-weight: 600;">Overdue Students</td><td style="${tdStyle}">${data.feeDefaulterCount}</td></tr>
            <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Total Overdue</td><td style="${tdStyle}">${formatCurrency(data.feeDefaulterAmount)}</td></tr>
          </tbody>
        </table>
      `,
    });
  } else {
    excluded.push("Fee Overdue Summary");
  }

  // Readiness checklist — always
  const checklistItems = [
    { item: "Attendance records", status: data.todayTotal > 0 ? "Ready" : "Needs Attention" },
    { item: "Exam records", status: data.examPipeline.total > 0 ? "Ready" : "Critical Gap" },
    { item: "Teacher evaluations", status: data.pendingEvals.length === 0 ? "Ready" : "Needs Attention" },
    { item: "Student results", status: data.passRate > 0 ? "Ready" : "Critical Gap" },
    { item: "Fee records", status: hasFeature("finance") ? (data.feeCollectionPct > 50 ? "Ready" : "Needs Attention") : "Not applicable · feature not enabled" },
    { item: "Compliance data", status: data.complianceScore >= 80 ? "Ready" : "Needs Attention" },
  ];

  allSections.push({
    name: "Readiness Checklist",
    html: `
      <h3 style="${sectionTitle}">Readiness Checklist</h3>
      <table style="${tableStyle}">
        <thead><tr>
          <th style="${thStyle}">Item</th>
          <th style="${thStyle} text-align: center;">Status</th>
        </tr></thead>
        <tbody>
          ${checklistItems.map((c, i) => {
            const color = c.status === "Ready" ? "#10b981" : c.status === "Critical Gap" ? "#ef4444" : c.status.startsWith("Not applicable") ? "#94a3b8" : "#f59e0b";
            return `<tr style="${i % 2 === 1 ? tdAltBg : ""}"><td style="${tdStyle}">${c.item}</td><td style="${tdStyle} text-align: center; color: ${color}; font-weight: 600;">${c.status}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    `,
  });

  const sectionNames = allSections.map((s) => s.name);
  const cover = coverPage(data.schoolName, "Inspection Readiness Report", data.academicYear, data.term, sectionNames);
  const sections = allSections.map((s, i) => (i > 0 ? pageBreak : "") + s.html).join("");
  const note = notePage(excluded);

  const fullHtml = `<div style="${baseStyles}">${cover}${pageBreak}${sections}${note}</div>`;
  return htmlToPdfBlob(fullHtml);
}

// =========================================================================
// REPORT C: Academic Performance Report
// =========================================================================

export async function generateAcademicReport(data: ReportData, hasFeature: HasFeatureFn): Promise<Blob> {
  const allSections: { name: string; html: string }[] = [];
  const excluded: string[] = [];

  const total = data.studentPositioning.needsAttention.count + data.studentPositioning.developing.count + data.studentPositioning.stable.count;
  const allStudents = [
    ...data.studentPositioning.stable.students,
    ...data.studentPositioning.developing.students,
    ...data.studentPositioning.needsAttention.students,
  ].sort((a, b) => b.accuracy - a.accuracy);

  // School avg & trend — always
  allSections.push({
    name: "School Average & Trend",
    html: `
      <h3 style="${sectionTitle}">School Average & Trend</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600; width: 200px;">School Average</td><td style="${tdStyle}">${data.schoolAvg.toFixed(1)}%</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Improvement Rate</td><td style="${tdStyle} color: ${data.improvementRate >= 0 ? "#10b981" : "#ef4444"}; font-weight: 600;">${data.improvementRate >= 0 ? "↑" : "↓"} ${Math.abs(data.improvementRate).toFixed(1)}%</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">Pass Rate</td><td style="${tdStyle}">${data.passRate.toFixed(1)}%</td></tr>
        </tbody>
      </table>
    `,
  });

  // Class-wise performance — always
  allSections.push({
    name: "Class-wise Performance",
    html: `
      <h3 style="${sectionTitle}">Class-wise Performance</h3>
      <table style="${tableStyle}">
        <thead><tr>
          <th style="${thStyle}">Class</th>
          <th style="${thStyle} text-align: right;">Average %</th>
          <th style="${thStyle}">Remark</th>
        </tr></thead>
        <tbody>
          ${data.highestClass ? `<tr><td style="${tdStyle}">${formatClassName(data.highestClass.grade, data.highestClass.section)}</td><td style="${tdStyle} text-align: right; font-weight: 600; color: #10b981;">${data.highestClass.avgPercent.toFixed(1)}%</td><td style="${tdStyle}">Highest</td></tr>` : ""}
          ${data.lowestClass ? `<tr style="${tdAltBg}"><td style="${tdStyle}">${formatClassName(data.lowestClass.grade, data.lowestClass.section)}</td><td style="${tdStyle} text-align: right; font-weight: 600; color: #ef4444;">${data.lowestClass.avgPercent.toFixed(1)}%</td><td style="${tdStyle}">Lowest</td></tr>` : ""}
        </tbody>
      </table>
    `,
  });

  // Student positioning matrix — always
  allSections.push({
    name: "Student Positioning Matrix",
    html: `
      <h3 style="${sectionTitle}">Student Positioning Matrix</h3>
      <div style="display: flex; gap: 16px; margin: 12px 0;">
        <div style="flex: 1; padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #ef4444;">${data.studentPositioning.needsAttention.count}</div>
          <div style="font-size: 11px; color: #64748b;">At Risk (&lt;50%)</div>
        </div>
        <div style="flex: 1; padding: 12px; background: #fffbeb; border-radius: 8px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #f59e0b;">${data.studentPositioning.developing.count}</div>
          <div style="font-size: 11px; color: #64748b;">Developing (50–65%)</div>
        </div>
        <div style="flex: 1; padding: 12px; background: #f0fdf4; border-radius: 8px; text-align: center;">
          <div style="font-size: 24px; font-weight: 700; color: #10b981;">${data.studentPositioning.stable.count}</div>
          <div style="font-size: 11px; color: #64748b;">Stable (&gt;65%)</div>
        </div>
      </div>
      <p style="font-size: 11px; color: #94a3b8;">Total: ${total} students evaluated</p>
    `,
  });

  // Top 10 students — always
  const top10 = allStudents.slice(0, 10);
  allSections.push({
    name: "Top 10 Students",
    html: `
      <h3 style="${sectionTitle}">Top 10 Students</h3>
      ${studentTable(top10, 10)}
    `,
  });

  // Bottom 10 students — always
  const bottom10 = [...allStudents].reverse().slice(0, 10);
  allSections.push({
    name: "Bottom 10 Students",
    html: `
      <h3 style="${sectionTitle}">Bottom 10 Students</h3>
      ${studentTable(bottom10, 10)}
    `,
  });

  // Exam completion status — always
  allSections.push({
    name: "Exam Completion Status",
    html: `
      <h3 style="${sectionTitle}">Exam Completion Status</h3>
      <table style="${tableStyle}">
        <tbody>
          <tr><td style="${tdStyle} font-weight: 600;">Total Exams</td><td style="${tdStyle}">${data.examPipeline.total}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Completed</td><td style="${tdStyle}">${data.examPipeline.completed}</td></tr>
          <tr><td style="${tdStyle} font-weight: 600;">In Progress</td><td style="${tdStyle}">${data.examPipeline.published}</td></tr>
          <tr style="${tdAltBg}"><td style="${tdStyle} font-weight: 600;">Draft</td><td style="${tdStyle}">${data.examPipeline.draft}</td></tr>
        </tbody>
      </table>
    `,
  });

  // AI suggestions — feature gated
  if (hasFeature("ai_suggestions")) {
    allSections.push({
      name: "AI Suggestions Summary",
      html: `
        <h3 style="${sectionTitle}">AI Suggestions Summary</h3>
        <p style="font-size: 12px; color: #475569;">${data.aiPendingCount} AI-generated task suggestions pending review.</p>
      `,
    });
  } else {
    excluded.push("AI Suggestions Summary");
  }

  const sectionNames = allSections.map((s) => s.name);
  const cover = coverPage(data.schoolName, "Academic Performance Report", data.academicYear, data.term, sectionNames);
  const sections = allSections.map((s, i) => (i > 0 ? pageBreak : "") + s.html).join("");
  const note = notePage(excluded);

  const fullHtml = `<div style="${baseStyles}">${cover}${pageBreak}${sections}${note}</div>`;
  return htmlToPdfBlob(fullHtml);
}
