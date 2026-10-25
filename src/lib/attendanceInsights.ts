// Attendance insights — an actionable "Overview" report sheet + an "At-Risk
// Watchlist" tab, derived entirely from the fetched per-student byDate maps
// (codes: P present · A absent · O leave/sick/casual · H holiday · "" not marked).
//
// Design intent (admin/teacher): a single overall % is misleading until you know
// how much was actually marked, and every number should end in a name to call or
// a section to walk into. So we lead with a coverage/trust check, replace vanity
// totals with distribution + worst-first ranking, and ship one named call list.

import { format, parseISO } from "date-fns";

import type { StudentReportRow } from "@/hooks/useAttendanceReports";
import type {
  AttendanceExportColumn,
  AttendanceReportRow,
  WorkbookSheet,
} from "@/lib/attendanceReportExport";

const AT_RISK_CAP = 250;

interface StudentStat {
  row: StudentReportRow;
  present: number;
  absent: number;
  leave: number;
  daysMarked: number; // present + absent (marks that count toward %)
  pct: number | null; // present / (present + absent)
  streak: number; // current consecutive-absent streak as of the To date
}

function computeStat(row: StudentReportRow, dateColumns: string[]): StudentStat {
  let present = 0;
  let absent = 0;
  let leave = 0;
  for (const d of dateColumns) {
    const c = row.byDate[d];
    if (c === "P") present++;
    else if (c === "A") absent++;
    else if (c === "O") leave++;
  }
  const daysMarked = present + absent;
  const pct = daysMarked === 0 ? null : (present / daysMarked) * 100;
  // Walk backwards from the To date: skip holiday/blank (neither count nor
  // reset), count consecutive absent, stop at the first present/leave.
  let streak = 0;
  for (let i = dateColumns.length - 1; i >= 0; i--) {
    const c = row.byDate[dateColumns[i]];
    if (c === "H" || c === "" || c === undefined) continue;
    if (c === "A") streak++;
    else break;
  }
  return { row, present, absent, leave, daysMarked, pct, streak };
}

const pctOfStr = (n: number, d: number) => (d === 0 ? "N/A" : `${Math.round((n / d) * 100)}%`);
const pctStr = (p: number | null) => (p === null ? "N/A" : `${Math.round(p)}%`);

export interface InsightsOpts {
  schoolName: string;
  scopeLabel: string; // "All classes" or "Class 9 - A"
  rangeLabel: string; // "01 Jul – 13 Jul 2026"
}

/**
 * Returns [Overview report sheet, At-Risk Watchlist sheet] — prepend these to the
 * per-class pivot tabs.
 */
export function buildAttendanceInsightsSheets(
  rows: StudentReportRow[],
  dateColumns: string[],
  opts: InsightsOpts,
): WorkbookSheet[] {
  const stats = rows.map((r) => computeStat(r, dateColumns));
  const n = stats.length;

  // ── per-day aggregates ──
  const dayPresent = new Map<string, number>();
  const dayAbsent = new Map<string, number>();
  const dayLeave = new Map<string, number>();
  for (const d of dateColumns) {
    dayPresent.set(d, 0);
    dayAbsent.set(d, 0);
    dayLeave.set(d, 0);
  }
  for (const s of stats) {
    for (const d of dateColumns) {
      const c = s.row.byDate[d];
      if (c === "P") dayPresent.set(d, (dayPresent.get(d) ?? 0) + 1);
      else if (c === "A") dayAbsent.set(d, (dayAbsent.get(d) ?? 0) + 1);
      else if (c === "O") dayLeave.set(d, (dayLeave.get(d) ?? 0) + 1);
    }
  }
  const recordedDates = dateColumns.filter((d) => (dayPresent.get(d) ?? 0) + (dayAbsent.get(d) ?? 0) > 0);
  const daysRecorded = recordedDates.length;

  const totalPresent = stats.reduce((s, x) => s + x.present, 0);
  const totalAbsent = stats.reduce((s, x) => s + x.absent, 0);
  // Coverage = share of possible marks actually recorded. Leave is counted only
  // on recorded days so the numerator shares the denominator's day-domain
  // (present/absent already only occur on recorded days) — keeps coverage <= 100%.
  const recordedLeave = recordedDates.reduce((s, d) => s + (dayLeave.get(d) ?? 0), 0);
  const coverage = daysRecorded === 0 || n === 0
    ? 0
    : ((totalPresent + totalAbsent + recordedLeave) / (n * daysRecorded)) * 100;

  // ── sections (class + section) ──
  interface SecAgg {
    className: string;
    section: string;
    students: number;
    present: number;
    absent: number;
    marked: Set<string>;
  }
  const secMap = new Map<string, SecAgg>();
  for (const s of stats) {
    const key = `${s.row.className}|||${s.row.section ?? ""}`;
    let sec = secMap.get(key);
    if (!sec) {
      sec = { className: s.row.className, section: s.row.section ?? "", students: 0, present: 0, absent: 0, marked: new Set() };
      secMap.set(key, sec);
    }
    sec.students++;
    sec.present += s.present;
    sec.absent += s.absent;
    for (const d of dateColumns) {
      const c = s.row.byDate[d];
      if (c === "P" || c === "A") sec.marked.add(d);
    }
  }
  const secRows = [...secMap.values()]
    .map((s) => ({ ...s, pct: s.present + s.absent === 0 ? null : (s.present / (s.present + s.absent)) * 100, markedN: s.marked.size }))
    .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  const sectionsBelow75 = secRows.filter((s) => s.pct !== null && s.pct < 75).length;

  // widest section spread within a single grade
  const gradePcts = new Map<string, number[]>();
  for (const s of secRows) {
    if (s.pct === null) continue;
    const arr = gradePcts.get(s.className) ?? [];
    arr.push(s.pct);
    gradePcts.set(s.className, arr);
  }
  let widestGap = 0;
  let widestGrade = "—";
  for (const [grade, pcts] of gradePcts) {
    if (pcts.length < 2) continue;
    const gap = Math.max(...pcts) - Math.min(...pcts);
    if (gap > widestGap) {
      widestGap = gap;
      widestGrade = grade;
    }
  }

  // ── distribution (only students with >= 4 marked days are banded) ──
  const computable = stats.filter((s) => s.daysMarked >= 4 && s.pct !== null);
  const compN = computable.length;
  const perfect = computable.filter((s) => (s.pct ?? 0) >= 100).length;
  const healthy = computable.filter((s) => (s.pct ?? 0) >= 90).length;
  const watch = computable.filter((s) => (s.pct ?? 0) >= 75 && (s.pct ?? 0) < 90).length;
  const concern = computable.filter((s) => (s.pct ?? 0) >= 60 && (s.pct ?? 0) < 75).length;
  const critical = computable.filter((s) => (s.pct ?? 0) < 60).length;
  const notComputable = n - compN;
  const below75 = computable.filter((s) => (s.pct ?? 0) < 75).length;
  const streak3 = stats.filter((s) => s.streak >= 3).length;

  // ── Overview report sheet ──
  const R: AttendanceReportRow[] = [];
  R.push({ cells: ["Attendance Insights"], bold: true });
  R.push({ cells: ["School", opts.schoolName] });
  R.push({ cells: ["Scope", opts.scopeLabel] });
  R.push({ cells: ["Date range", `${opts.rangeLabel} (${dateColumns.length} days)`] });
  R.push({ cells: ["Generated", format(new Date(), "dd MMM yyyy, HH:mm")] });
  R.push({ cells: ["Note", "Blank = not marked, NOT absent. Check 'Days marked' before trusting any %."] });
  R.push({ cells: [] });

  R.push({ cells: ["At a glance", ""], fill: true });
  R.push({ cells: ["Overall attendance %", pctOfStr(totalPresent, totalPresent + totalAbsent)] });
  R.push({ cells: ["Coverage (of possible marks)", `${Math.round(coverage)}%`] });
  R.push({ cells: ["Days attendance recorded", `${daysRecorded} of ${dateColumns.length}`] });
  R.push({ cells: ["Students in scope", n] });
  R.push({ cells: ["Sections below 75%", `${sectionsBelow75} of ${secRows.length}`] });
  R.push({ cells: ["Students below 75%", n ? `${below75} (${Math.round((below75 / n) * 100)}% of school)` : "0"] });
  R.push({ cells: ["Students absent 3+ days in a row", streak3] });
  R.push({ cells: ["Widest section gap within a grade", widestGrade === "—" ? "N/A" : `${widestGrade} · ${Math.round(widestGap)} pts`] });
  R.push({ cells: [] });

  R.push({ cells: ["Attendance distribution", "Range", "Students", "% of computable"], fill: true });
  R.push({ cells: ["Healthy", `>= 90% (100%: ${perfect})`, healthy, pctOfStr(healthy, compN)] });
  R.push({ cells: ["Watch", "75-89%", watch, pctOfStr(watch, compN)] });
  R.push({ cells: ["Concern", "60-74%", concern, pctOfStr(concern, compN)] });
  R.push({ cells: ["Critical", "< 60%", critical, pctOfStr(critical, compN)] });
  R.push({ cells: ["Not computable", "< 4 days marked", notComputable, pctOfStr(notComputable, n)] });
  R.push({ cells: [] });

  R.push({ cells: ["Sections: worst first", "Section", "Students", "Attendance %", "Absent days", "Days marked", "Flag"], fill: true });
  for (const s of secRows) {
    const lowMarking = s.markedN <= Math.floor(daysRecorded / 2);
    const flag = s.pct !== null && s.pct < 75 ? "BELOW TARGET" : lowMarking && daysRecorded > 0 ? "Low marking · % unreliable" : "";
    R.push({ cells: [s.className, s.section, s.students, pctStr(s.pct), s.absent, `${s.markedN} of ${daysRecorded}`, flag] });
  }
  R.push({ cells: [] });

  R.push({ cells: ["Daily attendance", "Weekday", "Marked", "Present", "Absent", "Attendance %", "vs prev", "Flag"], fill: true });
  const dayPcts = recordedDates.map((d) => {
    const p = dayPresent.get(d) ?? 0;
    const a = dayAbsent.get(d) ?? 0;
    return p + a === 0 ? 0 : (p / (p + a)) * 100;
  });
  const meanPct = dayPcts.length ? dayPcts.reduce((x, y) => x + y, 0) / dayPcts.length : 0;
  const maxMarked = Math.max(1, ...recordedDates.map((d) => (dayPresent.get(d) ?? 0) + (dayAbsent.get(d) ?? 0) + (dayLeave.get(d) ?? 0)));
  let prevPct: number | null = null;
  for (const d of recordedDates) {
    const p = dayPresent.get(d) ?? 0;
    const a = dayAbsent.get(d) ?? 0;
    const lv = dayLeave.get(d) ?? 0;
    const marked = p + a + lv;
    const pct = p + a === 0 ? 0 : (p / (p + a)) * 100;
    const delta = prevPct === null ? "" : `${pct - prevPct >= 0 ? "+" : ""}${Math.round(pct - prevPct)} pts`;
    const flags: string[] = [];
    if (pct <= meanPct - 10) flags.push("DIP");
    if (marked < 0.5 * maxMarked) flags.push("LOW-COVERAGE");
    R.push({ cells: [format(parseISO(d), "dd MMM yyyy"), format(parseISO(d), "EEE"), marked, p, a, `${Math.round(pct)}%`, delta, flags.join(", ")] });
    prevPct = pct;
  }

  const overview: WorkbookSheet = {
    kind: "report",
    sheetName: "Overview",
    colWidths: [34, 14, 12, 16, 14, 16, 14, 14],
    rows: R,
  };

  // ── At-Risk Watchlist ──
  const atRisk = stats
    .filter((s) => s.streak >= 3 || (s.pct !== null && s.pct < 75 && s.daysMarked >= 5))
    .sort((a, b) => b.streak - a.streak || (a.pct ?? 999) - (b.pct ?? 999));
  const flagReason = (s: StudentStat) => {
    const isStreak = s.streak >= 3;
    const isChronic = s.pct !== null && s.pct < 75 && s.daysMarked >= 5;
    return isStreak && isChronic ? "BOTH" : isStreak ? "STREAK" : "CHRONIC";
  };
  const atRiskCols: AttendanceExportColumn[] = [
    { header: "Name", width: 24, align: "left" },
    { header: "Roll", width: 8, align: "left" },
    { header: "Class", width: 16, align: "left" },
    { header: "Section", width: 9, align: "left" },
    { header: "Attendance %", width: 13, align: "center" },
    { header: "Present", width: 9, align: "center" },
    { header: "Absent", width: 9, align: "center" },
    { header: "Leave", width: 8, align: "center" },
    { header: "Absent streak", width: 13, align: "center" },
    { header: "Days marked", width: 12, align: "center" },
    { header: "Flag", width: 12, align: "left" },
  ];
  const pad = (first: string): (string | number)[] => [first, "", "", "", "", "", "", "", "", "", ""];
  const atRiskRows: (string | number)[][] = atRisk.slice(0, AT_RISK_CAP).map((s) => [
    s.row.fullName,
    s.row.rollNumber ?? "",
    s.row.className,
    s.row.section ?? "",
    pctStr(s.pct),
    s.present,
    s.absent,
    s.leave,
    s.streak,
    s.daysMarked,
    flagReason(s),
  ]);
  if (atRisk.length === 0) {
    atRiskRows.push(pad("No students at a 3+ day streak or below 75% over this range. (An empty list can also mean attendance was under-recorded. Check 'Days marked' on the Overview.)"));
  } else if (atRisk.length > AT_RISK_CAP) {
    atRiskRows.push(pad(`Showing ${AT_RISK_CAP} of ${atRisk.length} at-risk students (most urgent first). Narrow the date range or use the class tabs for the rest.`));
  }

  const atRiskSheet: WorkbookSheet = {
    sheetName: "At-Risk Watchlist",
    title: "At-Risk Watchlist: students to contact",
    subtitle: `${opts.rangeLabel} · flagged: absent 3+ days in a row, or below 75% with 5+ days marked · ${atRisk.length} student${atRisk.length === 1 ? "" : "s"}`,
    columns: atRiskCols,
    rows: atRiskRows,
  };

  return [overview, atRiskSheet];
}
