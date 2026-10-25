import { format, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import {
  downloadAttendanceWorkbookMulti,
  type AttendanceExportColumn,
  type AttendanceReportRow,
  type WorkbookSheet,
} from "@/lib/attendanceReportExport";

const PAGE = 1000;

type SummaryRpcRow = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_name: string;
  section: string | null;
  last_sign_in_at: string | null;
  exams_taken: number | string;
  exams_submitted: number | string;
  homework_submitted: number | string;
  homework_late: number | string;
  rechecks_raised: number | string;
  present_days: number | string;
  absent_days: number | string;
  total_count: number | string;
};

const num = (v: number | string) => Number(v);
const fmtDateTime = (iso: string | null) => (iso ? format(parseISO(iso), "dd MMM yyyy, HH:mm") : "Never");
const pct = (n: number, d: number) => (d === 0 ? "N/A" : `${Math.round((n / d) * 100)}%`);
const sumBy = (rows: SummaryRpcRow[], f: (r: SummaryRpcRow) => number) => rows.reduce((s, r) => s + f(r), 0);

/** All student activity rows for the range (loops the RPC in 1000-person pages). */
async function fetchAllSummary(
  institutionId: string | null,
  from: string,
  to: string,
  classId: string | null,
): Promise<SummaryRpcRow[]> {
  const acc: SummaryRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_student_activity", {
      p_from: from, p_to: to, p_class_id: classId ?? undefined,
      p_limit: PAGE, p_offset: offset, p_institution_id: institutionId ?? undefined,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as SummaryRpcRow[];
    acc.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return acc;
}

async function fetchInstitutionName(institutionId: string | null): Promise<string> {
  if (!institutionId) return "";
  const { data } = await supabase.from("institutions").select("name").eq("id", institutionId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "";
}

/** Group students by class name (grade), preserving roster order. */
function groupByClass(rows: SummaryRpcRow[]): Map<string, SummaryRpcRow[]> {
  const m = new Map<string, SummaryRpcRow[]>();
  for (const r of rows) {
    const g = m.get(r.class_name);
    if (g) g.push(r);
    else m.set(r.class_name, [r]);
  }
  return m;
}

/**
 * Download the student-activity workbook:
 *  - Tab 1 "Summary": an overview report (totals + participation, plus a
 *    per-class breakdown when the download spans all classes).
 *  - one tab per class (grade): the detailed per-student list, all sections
 *    together, distinguished by a Section column.
 */
export async function downloadStudentActivityWorkbook(opts: {
  institutionId: string | null;
  from: string;
  to: string;
  classId: string | null;
  rangeLabel: string;
}): Promise<void> {
  const [rows, schoolName] = await Promise.all([
    fetchAllSummary(opts.institutionId, opts.from, opts.to, opts.classId),
    fetchInstitutionName(opts.institutionId),
  ]);

  const total = rows.length;
  const loggedIn = rows.filter((r) => r.last_sign_in_at).length;
  const present = sumBy(rows, (r) => num(r.present_days));
  const absent = sumBy(rows, (r) => num(r.absent_days));
  const partExam = rows.filter((r) => num(r.exams_taken) > 0).length;
  const partHw = rows.filter((r) => num(r.homework_submitted) > 0).length;
  const partRecheck = rows.filter((r) => num(r.rechecks_raised) > 0).length;

  // ── Tab 1: overview report ──
  const reportRows: AttendanceReportRow[] = [
    { cells: ["Student Activity: Summary"], bold: true },
    { cells: ["School", schoolName] },
    { cells: ["Period", opts.rangeLabel] },
    { cells: ["Generated on", format(new Date(), "dd MMM yyyy, HH:mm")] },
    { cells: [] },
    { cells: ["Metric", "Value"], fill: true },
    { cells: ["Total students", total] },
    { cells: ["Students who logged in", loggedIn] },
    { cells: ["Total exams taken", sumBy(rows, (r) => num(r.exams_taken))] },
    { cells: ["Total exams submitted", sumBy(rows, (r) => num(r.exams_submitted))] },
    { cells: ["Total homework submitted", sumBy(rows, (r) => num(r.homework_submitted))] },
    { cells: ["Total rechecks raised", sumBy(rows, (r) => num(r.rechecks_raised))] },
    { cells: ["Overall attendance %", pct(present, present + absent)] },
    { cells: [] },
    { cells: ["Participation", "Students", "%"], fill: true },
    { cells: ["Logged in at least once", loggedIn, pct(loggedIn, total)] },
    { cells: ["Attempted an exam", partExam, pct(partExam, total)] },
    { cells: ["Submitted homework", partHw, pct(partHw, total)] },
    { cells: ["Raised a recheck", partRecheck, pct(partRecheck, total)] },
  ];

  const byClass = groupByClass(rows);

  // Per-class breakdown only when the download spans all classes.
  if (!opts.classId) {
    reportRows.push({ cells: [] });
    reportRows.push({ cells: ["By class", "Students", "Exams taken", "Exams submitted", "Homework", "Attendance %"], fill: true });
    for (const [cn, crows] of byClass) {
      const p = sumBy(crows, (r) => num(r.present_days));
      const a = sumBy(crows, (r) => num(r.absent_days));
      reportRows.push({
        cells: [
          cn,
          crows.length,
          sumBy(crows, (r) => num(r.exams_taken)),
          sumBy(crows, (r) => num(r.exams_submitted)),
          sumBy(crows, (r) => num(r.homework_submitted)),
          pct(p, p + a),
        ],
      });
    }
  }

  const sheets: WorkbookSheet[] = [
    { kind: "report", sheetName: "Summary", colWidths: [32, 15, 15, 16, 14, 14], rows: reportRows },
  ];

  // ── Detail tabs: one per class (grade), per-student rows, Section column ──
  const detailColumns: AttendanceExportColumn[] = [
    { header: "Roll", width: 8, align: "left" },
    { header: "Section", width: 9, align: "left" },
    { header: "Name", width: 24, align: "left" },
    { header: "Last login", width: 18, align: "left" },
    { header: "Exams taken", width: 12, align: "center" },
    { header: "Exams submitted", width: 15, align: "center" },
    { header: "Homework submitted", width: 18, align: "center" },
    { header: "Homework late", width: 14, align: "center" },
    { header: "Rechecks", width: 10, align: "center" },
    { header: "Present", width: 9, align: "center" },
    { header: "Absent", width: 9, align: "center" },
    { header: "Attendance %", width: 13, align: "center" },
  ];
  for (const [cn, crows] of byClass) {
    sheets.push({
      sheetName: cn,
      title: `Student Activity: ${cn}`,
      subtitle: `${opts.rangeLabel} · ${crows.length} student${crows.length === 1 ? "" : "s"}`,
      columns: detailColumns,
      rows: crows.map((r) => [
        r.roll_number ?? "",
        r.section ?? "",
        r.full_name,
        fmtDateTime(r.last_sign_in_at),
        num(r.exams_taken),
        num(r.exams_submitted),
        num(r.homework_submitted),
        num(r.homework_late),
        num(r.rechecks_raised),
        num(r.present_days),
        num(r.absent_days),
        pct(num(r.present_days), num(r.present_days) + num(r.absent_days)),
      ]),
    });
  }

  const scope = opts.classId ? "class" : "all-classes";
  await downloadAttendanceWorkbookMulti({ sheets, filename: `student-activity-${scope}-${opts.from}_to_${opts.to}.xlsx` });
}
