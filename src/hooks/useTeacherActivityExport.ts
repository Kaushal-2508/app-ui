import { useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { saveBlob } from "@/lib/native";

export type TeacherForExport = {
  id: string;
  full_name: string;
  email: string;
};

export type ActivityExportInput = {
  /** The school the teachers belong to; the RPCs drop anyone outside it. */
  institutionId: string;
  teachers: TeacherForExport[];
  /** How many days of history to include. Capped at 365 server-side. */
  daysBack: number;
};

// Every sheet comes from SECURITY DEFINER RPCs (migrations 20261005120000 and
// 20261005140000). "Last Active" used to be auth.users.last_sign_in_at, which
// only moves when someone types a password: on 2026-10-05 the export showed
// 33 of Alliance's 90 teachers active while 69 were. teacher_activity_summary
// reads the session refresh time instead (moves whenever SALCI is open) and
// was verified against the platform request logs; teacher_work_totals was
// verified against an independent recount (0 of 2,250 values differed).

type SummaryRow = {
  teacher_id: string;
  last_active_at: string | null;
  last_action_at: string | null;
  last_action: string | null;
  last_action_detail: string | null;
  active_today: boolean;
  active_yesterday: boolean;
  local_today: string;
  time_zone: string;
};

/** The count columns teacher_work_totals returns. */
type WorkKey =
  | "exams_created"
  | "exams_published"
  | "exams_marked"
  | "student_marks_entered"
  | "answers_evaluated"
  | "questions_ai"
  | "questions_manual"
  | "homework_given"
  | "homework_checked"
  | "submissions_marked"
  | "attendance_class_days"
  | "attendance_students"
  | "lessons_logged"
  | "topics_logged"
  | "period_notes"
  | "workday_checked_in"
  | "workday_checked_out"
  | "workday_late"
  | "leave_requests"
  | "tasks_assigned"
  | "tasks_submitted"
  | "tasks_approved"
  | "diary_notes_sent"
  | "study_material_uploaded"
  | "notices_published";

type WorkTotalsRow = {
  teacher_id: string;
  range_start: string;
  range_end: string;
} & Record<WorkKey, number>;

/** One workbook tab per area of work, each a per-teacher count for the range. */
const WORK_TABS: { sheet: string; title: string; columns: { key: WorkKey; label: string }[] }[] = [
  {
    sheet: "Exams",
    title: "Exams and marks",
    columns: [
      { key: "exams_created", label: "Exams Created" },
      { key: "exams_published", label: "Exams Published" },
      { key: "exams_marked", label: "Exams Marked" },
      { key: "student_marks_entered", label: "Student Marks Entered" },
      { key: "answers_evaluated", label: "Answers Evaluated" },
      { key: "questions_ai", label: "AI Questions Added to Bank" },
      { key: "questions_manual", label: "Own Questions Added to Bank" },
    ],
  },
  {
    sheet: "Homework",
    title: "Homework",
    columns: [
      { key: "homework_given", label: "Homework Given" },
      { key: "homework_checked", label: "Homework Checked" },
      { key: "submissions_marked", label: "Submissions Marked" },
    ],
  },
  {
    sheet: "Attendance",
    title: "Student attendance",
    columns: [
      { key: "attendance_class_days", label: "Class Attendance Taken (Class-Days)" },
      { key: "attendance_students", label: "Student Attendance Marks" },
    ],
  },
  {
    sheet: "Lessons",
    title: "Lessons and syllabus",
    columns: [
      { key: "lessons_logged", label: "Lessons Logged" },
      { key: "topics_logged", label: "Topics Logged" },
      { key: "period_notes", label: "Period Notes" },
    ],
  },
  {
    sheet: "Workday",
    title: "Workday check-in and leave",
    columns: [
      { key: "workday_checked_in", label: "Days Checked In" },
      { key: "workday_checked_out", label: "Days Checked Out" },
      { key: "workday_late", label: "Late Check-ins" },
      { key: "leave_requests", label: "Leave Requests" },
    ],
  },
  {
    sheet: "Tasks & Other",
    title: "Tasks, diary, notices and study material",
    columns: [
      { key: "tasks_assigned", label: "Tasks Assigned" },
      { key: "tasks_submitted", label: "Tasks Submitted" },
      { key: "tasks_approved", label: "Tasks Approved" },
      { key: "diary_notes_sent", label: "Diary Notes Sent" },
      { key: "study_material_uploaded", label: "Study Material Uploaded" },
      { key: "notices_published", label: "Notices Published" },
    ],
  },
];

type LogEvent = {
  teacher_id: string;
  at: string;
  time_known: boolean;
  action: string;
  entity_type: string | null;
  entity_name: string | null;
};

type LogPayload = {
  total: number;
  returned: number;
  time_zone: string;
  range_start: string;
  range_end: string;
  events: LogEvent[];
};

// Large enough for a 90-day log of a big school; the RPC reports the true
// total so a cut-off log is stated in the workbook, never silent.
const LOG_LIMIT = 50000;
const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The RPCs are absent from the generated types on purpose: adding any
// function to types.ts pushes useCoord.ts's generic rpc() helper past
// TypeScript's instantiation depth (TS2589). Same narrow cast as
// useExamSlotBookings.
const callRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)(fn, args);

/** Formats instants as wall-clock time in the school's time zone (CLAUDE.md 24). */
function makeZonedFormatter(timeZone: string) {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: DEFAULT_TIME_ZONE });
  }
  const parts = (iso: string) => {
    const out: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(iso))) out[p.type] = p.value;
    return out;
  };
  return {
    date: (iso: string) => {
      const p = parts(iso);
      return `${p.year}-${p.month}-${p.day}`;
    },
    time: (iso: string) => {
      const p = parts(iso);
      return `${p.hour}:${p.minute}`;
    },
    dateTime: (iso: string) => {
      const p = parts(iso);
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    },
  };
}

/** "2026-09-06" -> "06 Sep 2026" */
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-");
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

/** Whole days between two YYYY-MM-DD dates. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const statusFor = (row: SummaryRow, daysSince: number | null): string => {
  if (!row.last_active_at || daysSince === null) return "Never signed in";
  if (row.active_today) return "Active today";
  if (row.active_yesterday) return "Active yesterday";
  if (daysSince < 7) return "Active this week";
  if (daysSince < 30) return "Inactive 7+ days";
  return "Inactive 30+ days";
};

const columnWidths = (rows: Record<string, unknown>[]) =>
  Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.min(80, Math.max(key.length, ...rows.map((r) => String(r[key] ?? "").length)) + 2),
  }));

const plainSheet = (rows: Record<string, unknown>[]) => {
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = columnWidths(rows);
  return sheet;
};

/** A heading line, a blank line, then the table (with a totals row). */
const headedSheet = (heading: string, rows: Record<string, unknown>[]) => {
  const sheet = XLSX.utils.aoa_to_sheet([[heading], []]);
  XLSX.utils.sheet_add_json(sheet, rows, { origin: "A3" });
  sheet["!cols"] = columnWidths(rows);
  return sheet;
};

export function useTeacherActivityExport() {
  return useMutation({
    mutationFn: async ({ institutionId, teachers, daysBack }: ActivityExportInput) => {
      if (teachers.length === 0) {
        throw new Error("Select at least one teacher to export.");
      }
      if (!institutionId) {
        throw new Error("Couldn't tell which school these teachers belong to.");
      }

      const teacherIds = teachers.map((t) => t.id);
      const teacherById = new Map(teachers.map((t) => [t.id, t]));
      const safeDays = Math.max(1, Math.min(365, Math.round(daysBack)));
      const args = { p_institution_id: institutionId, p_teacher_ids: teacherIds, p_days: safeDays };

      // Any failure aborts the export and reaches toastError: a workbook
      // built from part of the data would read as "these teachers did nothing".
      const [summaryRes, totalsRes, logRes] = await Promise.all([
        callRpc("teacher_activity_summary", args),
        callRpc("teacher_work_totals", args),
        callRpc("teacher_activity_log", { ...args, p_limit: LOG_LIMIT }),
      ]);
      if (summaryRes.error) throw summaryRes.error;
      if (totalsRes.error) throw totalsRes.error;
      if (logRes.error) throw logRes.error;

      const summary = (summaryRes.data ?? []) as SummaryRow[];
      const totals = (totalsRes.data ?? []) as WorkTotalsRow[];
      const log = (logRes.data ?? null) as unknown as LogPayload | null;
      if (!log) throw new Error("The activity log didn't come back. Please try again.");

      const summaryById = new Map(summary.map((r) => [r.teacher_id, r]));
      const totalsById = new Map(totals.map((r) => [r.teacher_id, r]));
      // Both RPCs keep exactly the teachers of this school, so a gap between
      // them is a fault, not "zero work": refuse rather than print zeros.
      if (summary.some((r) => !totalsById.has(r.teacher_id))) {
        throw new Error("The work totals didn't come back for every teacher. Please try again.");
      }

      const timeZone = summary[0]?.time_zone ?? log.time_zone ?? DEFAULT_TIME_ZONE;
      const fmt = makeZonedFormatter(timeZone);
      const localToday = summary[0]?.local_today ?? log.range_end;
      const rangeStart = totals[0]?.range_start ?? log.range_start;
      const rangeEnd = totals[0]?.range_end ?? log.range_end;
      const dayWord = `day${safeDays === 1 ? "" : "s"}`;
      const rangeText = `last ${safeDays} ${dayWord} (${longDate(rangeStart)} to ${longDate(rangeEnd)})`;

      // Selected accounts that are not teachers of this school are left out
      // by the server; name them instead of dropping them silently.
      const exported = teachers.filter((t) => summaryById.has(t.id));
      const skipped = teachers.filter((t) => !summaryById.has(t.id));

      // Tab 1: who is active. Most-inactive first so problem rows sit on top.
      const ordered = exported
        .map((teacher) => ({ teacher, row: summaryById.get(teacher.id) as SummaryRow }))
        .sort((a, b) => {
          const at = a.row.last_active_at ? Date.parse(a.row.last_active_at) : 0;
          const bt = b.row.last_active_at ? Date.parse(b.row.last_active_at) : 0;
          return at - bt;
        });
      const summarySheetRows = ordered.map(({ teacher, row }, idx) => {
        const daysSince = row.last_active_at
          ? daysBetween(fmt.date(row.last_active_at), localToday)
          : null;
        const detail = row.last_action_detail?.trim();
        const what = row.last_action
          ? detail
            ? `${row.last_action}: ${detail}`
            : row.last_action
          : null;
        return {
          "S.No": idx + 1,
          "Teacher Name": teacher.full_name,
          "Email": teacher.email,
          "Status": statusFor(row, daysSince),
          "Last Active": row.last_active_at ? fmt.dateTime(row.last_active_at) : "N/A",
          "Last Activity":
            what && row.last_action_at ? `${what} · ${fmt.dateTime(row.last_action_at)}` : "N/A",
        };
      });

      // Work tabs: alphabetical, one row per teacher, then a school total.
      const alphabetical = [...exported].sort((a, b) => a.full_name.localeCompare(b.full_name));
      const workSheets = WORK_TABS.map((tab) => {
        const rows: Record<string, string | number>[] = alphabetical.map((teacher, idx) => {
          const t = totalsById.get(teacher.id) as WorkTotalsRow;
          const row: Record<string, string | number> = {
            "S.No": idx + 1,
            "Teacher Name": teacher.full_name,
            "Email": teacher.email,
          };
          for (const c of tab.columns) row[c.label] = t[c.key];
          return row;
        });
        const totalRow: Record<string, string | number> = {
          "S.No": "",
          "Teacher Name": "Total (all teachers)",
          "Email": "",
        };
        for (const c of tab.columns) {
          totalRow[c.label] = alphabetical.reduce(
            (sum, teacher) => sum + (totalsById.get(teacher.id)?.[c.key] ?? 0),
            0,
          );
        }
        rows.push(totalRow);
        return { name: tab.sheet, sheet: headedSheet(`${tab.title} · ${rangeText}`, rows) };
      });

      // Activity log: newest first.
      const events = log.events ?? [];
      const logSheetRows = events.map((e, idx) => {
        const t = teacherById.get(e.teacher_id);
        return {
          "S.No": idx + 1,
          "Teacher Name": t?.full_name ?? "Unknown",
          "Email": t?.email ?? "N/A",
          "Date": fmt.date(e.at),
          "Time": e.time_known ? fmt.time(e.at) : "N/A",
          "Action": e.action,
          "Type": e.entity_type ?? "N/A",
          "Details": e.entity_name?.trim() || "N/A",
        };
      });
      const total = log.total ?? events.length;
      const truncated = total > events.length;

      const aboutRows = [
        { Item: "Range", Value: `Last ${safeDays} ${dayWord}: ${longDate(rangeStart)} to ${longDate(rangeEnd)}, school time (${timeZone})` },
        { Item: "Generated", Value: fmt.dateTime(new Date().toISOString()) },
        { Item: "Teachers", Value: `${exported.length} exported` },
        ...(skipped.length > 0
          ? [{
              Item: "Not included",
              Value: `${skipped.length} selected account(s) are not teachers of this school: ${skipped.map((t) => t.full_name).join(", ")}`,
            }]
          : []),
        {
          Item: "Activity Log rows",
          Value: truncated
            ? `Newest ${events.length} of ${total} events (older events left out)`
            : `${events.length} events`,
        },
        { Item: "Status", Value: "Active today, Active yesterday, Active this week, Inactive 7+ days, Inactive 30+ days, or Never signed in. Days are school days in school time." },
        { Item: "Last Active", Value: "The last time the teacher had SALCI open on any device (the sign-in session refreshing), signed in, or did any recorded work. Staying signed in on a phone counts." },
        { Item: "Last Activity", Value: "The last piece of work recorded, with its time." },
        { Item: "Work tabs", Value: `Each count is work the teacher did in the ${rangeText}. Deleted items are not counted.` },
        { Item: "Exams", Value: "Exams Marked: exams where the teacher entered marks. Student Marks Entered: one per student per exam. Answers Evaluated: answers the teacher graded or corrected." },
        { Item: "Attendance", Value: "Counted by attendance date: each class once per day. Attendance counts for whoever saved it last. The Activity Log also lists older days re-saved in this range, so its rows can run slightly higher." },
        { Item: "Lessons", Value: "Lessons Logged: each class, subject and day in the syllabus log. Topics Logged: each topic logged. Period Notes: periods logged without a chapter (a test, an activity)." },
        { Item: "Tasks & Other", Value: "Tasks Assigned counts one instruction once, even when sent to several people. Diary Notes Sent counts one note once, however many students it went to." },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, plainSheet(summarySheetRows), "Activity Summary");
      for (const w of workSheets) XLSX.utils.book_append_sheet(workbook, w.sheet, w.name);
      XLSX.utils.book_append_sheet(
        workbook,
        logSheetRows.length > 0
          ? plainSheet(logSheetRows)
          : plainSheet([{ Note: `No activity recorded for the selected teachers in the ${rangeText}.` }]),
        "Activity Log",
      );
      XLSX.utils.book_append_sheet(workbook, plainSheet(aboutRows), "About this report");

      const filename = `Teacher_Activity_Log_${localToday}.xlsx`;
      const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      saveBlob(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        filename,
      );

      return {
        teacherCount: exported.length,
        skippedCount: skipped.length,
        eventCount: events.length,
        totalEvents: total,
        activeToday: summary.filter((r) => r.active_today).length,
        filename,
      };
    },
  });
}
