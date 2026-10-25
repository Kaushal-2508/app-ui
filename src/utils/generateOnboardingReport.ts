import * as XLSX from "xlsx";

export interface OnboardingReportRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  first_task_assigned: boolean;
  first_task_completed: boolean;
  first_study_material_uploaded: boolean;
  first_exam_published: boolean;
  first_result_validated: boolean;
  completed_count: number | null;
  completion_percent: number | string | null;
  is_journey_completed: boolean;
}

interface GenerateParams {
  schoolName: string;
  rows: OnboardingReportRow[];
}

const MILESTONE_COLUMNS: { key: keyof OnboardingReportRow; header: string }[] = [
  { key: "first_task_assigned", header: "First task created or received" },
  { key: "first_task_completed", header: "First task completed" },
  { key: "first_study_material_uploaded", header: "First study material uploaded" },
  { key: "first_exam_published", header: "First exam published" },
  { key: "first_result_validated", header: "First result validated/published" },
];

function toYesNo(v: boolean): string {
  return v ? "Yes" : "No";
}

function capitalizeRole(role: string | null): string {
  if (!role) return "Teacher";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function generateOnboardingWorkbook({ schoolName, rows }: GenerateParams): Blob {
  const sortedRows = [...rows].sort((a, b) => {
    const pctA = Number(a.completion_percent ?? 0);
    const pctB = Number(b.completion_percent ?? 0);
    if (pctA !== pctB) return pctB - pctA;
    return (a.full_name ?? "").localeCompare(b.full_name ?? "");
  });

  // --- Summary sheet ---
  const totalStaff = sortedRows.length;
  const completedStaff = sortedRows.filter((r) => r.is_journey_completed).length;
  const teachers = sortedRows.filter((r) => r.role === "teacher");
  const coordinators = sortedRows.filter((r) => r.role === "coordinator");
  const avgCompletion =
    totalStaff === 0
      ? 0
      : sortedRows.reduce((sum, r) => sum + Number(r.completion_percent ?? 0), 0) / totalStaff;

  const summaryAoa: (string | number)[][] = [
    ["Onboarding Report"],
    ["School", schoolName],
    ["Generated on", new Date().toLocaleString("en-IN")],
    [],
    ["Metric", "Value"],
    ["Total teachers + coordinators", totalStaff],
    ["Teachers", teachers.length],
    ["Coordinators", coordinators.length],
    ["Completed onboarding journey", completedStaff],
    ["Average completion %", Math.round(avgCompletion * 100) / 100],
    [],
    ["Milestone", "Completed by (count)", "Completed by (%)"],
    ...MILESTONE_COLUMNS.map((m) => {
      const count = sortedRows.filter((r) => Boolean(r[m.key])).length;
      const pct = totalStaff === 0 ? 0 : Math.round((count / totalStaff) * 10000) / 100;
      return [m.header, count, pct];
    }),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryAoa);
  summarySheet["!cols"] = [{ wch: 36 }, { wch: 22 }, { wch: 22 }];

  // --- Details sheet ---
  const detailRows = sortedRows.map((r) => ({
    Name: r.full_name ?? "N/A",
    Email: r.email ?? "N/A",
    Role: capitalizeRole(r.role),
    "First task created or received": toYesNo(r.first_task_assigned),
    "First task completed": toYesNo(r.first_task_completed),
    "First study material uploaded": toYesNo(r.first_study_material_uploaded),
    "First exam published": toYesNo(r.first_exam_published),
    "First result validated/published": toYesNo(r.first_result_validated),
    "Completed steps": `${r.completed_count ?? 0} / 5`,
    "Completion %": Number(r.completion_percent ?? 0),
    "Journey complete": toYesNo(r.is_journey_completed),
  }));

  const detailsSheet =
    detailRows.length > 0
      ? XLSX.utils.json_to_sheet(detailRows)
      : XLSX.utils.aoa_to_sheet([
          [
            "Name",
            "Email",
            "Role",
            "First task created or received",
            "First task completed",
            "First study material uploaded",
            "First exam published",
            "First result validated/published",
            "Completed steps",
            "Completion %",
            "Journey complete",
          ],
          ["No teachers or coordinators found for this institution."],
        ]);

  detailsSheet["!cols"] = [
    { wch: 26 },
    { wch: 30 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 26 },
    { wch: 16 },
    { wch: 14 },
    { wch: 18 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, detailsSheet, "Staff Progress");

  const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
