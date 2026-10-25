import { saveBlob } from "@/lib/native";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, parseISO } from "date-fns";

import { supabase } from "@/integrations/supabase/client";

export const REPORT_PAGE_SIZE = 40;

export type ReportStatusCode = "P" | "A" | "L" | "O" | "H" | "";

export interface StaffReportRow {
  staffId: string;
  fullName: string;
  role: "teacher" | "coordinator" | "school_admin" | "super_school_admin" | string;
  byDate: Record<string, ReportStatusCode>;
}

export interface StudentReportRow {
  studentId: string;
  fullName: string;
  rollNumber: string | null;
  classId: string;
  className: string; // grade only, e.g. "Class 1"
  section: string | null;
  byDate: Record<string, ReportStatusCode>;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

function toStaffStatusCode(status: string): ReportStatusCode {
  switch (status) {
    case "present": return "P";
    case "late":    return "L";
    case "absent":  return "A";
    case "on_leave": return "O";
    case "holiday": return "H";
    default: return "";
  }
}

function toStudentStatusCode(status: string): ReportStatusCode {
  switch (status) {
    case "present": return "P";
    case "absent":  return "A";
    // "O" = on leave. Approved leave (either path), plus the legacy
    // sick/casual values, all report as leave and stay out of the
    // present/absent percentage in attendanceInsights.
    case "leave":
    case "sick":
    case "casual":  return "O";
    case "holiday": return "H";
    default: return "";
  }
}

/** Set of YYYY-MM-DD strings that are full-day holidays for the institution. */
export function useHolidaysInRange(institutionId: string | null, from: string | null, to: string | null) {
  return useQuery({
    queryKey: ["attendance-report", "holidays", institutionId, from, to],
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      if (!institutionId || !from || !to) return new Set();
      const { data, error } = await supabase
        .from("cal_events")
        .select("starts_on, ends_on, kind")
        .eq("institution_id", institutionId)
        .eq("kind", "holiday")
        .lte("starts_on", to)
        .gte("ends_on", from);
      if (error) throw error;
      const set = new Set<string>();
      type Row = { starts_on: string; ends_on: string };
      ((data ?? []) as Row[]).forEach((r) => {
        eachDayOfInterval({ start: parseISO(r.starts_on), end: parseISO(r.ends_on) }).forEach((d) => {
          set.add(ymd(d));
        });
      });
      return set;
    },
    enabled: !!institutionId && !!from && !!to,
  });
}

// ── shared mapping: raw RPC by_date + holidays -> per-day ReportStatusCode ──
function datesInRange(from: string, to: string): string[] {
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map(ymd);
}

function overlay(
  raw: Record<string, string>,
  allDates: string[],
  holidays: Set<string>,
  toCode: (s: string) => ReportStatusCode,
): Record<string, ReportStatusCode> {
  const out: Record<string, ReportStatusCode> = {};
  allDates.forEach((d) => {
    if (holidays.has(d)) out[d] = "H"; // holiday wins over any record (as before)
    else out[d] = raw[d] ? toCode(raw[d]) : "";
  });
  return out;
}

type StudentRpcRow = {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_id: string;
  class_name: string;
  section: string | null;
  by_date: Record<string, string> | null;
  total_count: number | string;
};
type StaffRpcRow = {
  staff_id: string;
  full_name: string;
  role: string;
  by_date: Record<string, string> | null;
  total_count: number | string;
};

function mapStudentRows(data: StudentRpcRow[], from: string, to: string, holidays: Set<string>): StudentReportRow[] {
  const allDates = datesInRange(from, to);
  return data.map((r) => ({
    studentId: r.student_id,
    fullName: r.full_name,
    rollNumber: r.roll_number,
    classId: r.class_id,
    className: r.class_name,
    section: r.section,
    byDate: overlay(r.by_date ?? {}, allDates, holidays, toStudentStatusCode),
  }));
}
function mapStaffRows(data: StaffRpcRow[], from: string, to: string, holidays: Set<string>): StaffReportRow[] {
  const allDates = datesInRange(from, to);
  return data.map((r) => ({
    staffId: r.staff_id,
    fullName: r.full_name,
    role: r.role,
    byDate: overlay(r.by_date ?? {}, allDates, holidays, toStaffStatusCode),
  }));
}

/** One page (REPORT_PAGE_SIZE) of the student report pivot + total row count. */
export function useStudentAttendanceReport(
  institutionId: string | null,
  from: string | null,
  to: string | null,
  classId: string | null,
  page: number,
  holidays: Set<string>,
) {
  return useQuery({
    queryKey: ["attendance-report", "students", institutionId, from, to, classId, page, holidays.size],
    enabled: !!institutionId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: StudentReportRow[]; totalCount: number }> => {
      if (!from || !to) return { rows: [], totalCount: 0 };
      // Bounded admin on-demand report: LIMIT/OFFSET is intentional (page-jump + count).
      const { data, error } = await supabase.rpc("report_student_attendance", {
        p_from: from,
        p_to: to,
        p_class_id: classId ?? undefined,
        p_limit: REPORT_PAGE_SIZE,
        p_offset: page * REPORT_PAGE_SIZE,
        p_institution_id: institutionId ?? undefined, // follow super-admin "Manage Institution"
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as StudentRpcRow[];
      return {
        rows: mapStudentRows(rows, from, to, holidays),
        totalCount: rows.length > 0 ? Number(rows[0].total_count) : 0,
      };
    },
  });
}

/** One page (REPORT_PAGE_SIZE) of the staff report pivot + total row count. */
export function useStaffAttendanceReport(
  institutionId: string | null,
  from: string | null,
  to: string | null,
  page: number,
  holidays: Set<string>,
) {
  return useQuery({
    queryKey: ["attendance-report", "staff", institutionId, from, to, page, holidays.size],
    enabled: !!institutionId && !!from && !!to,
    staleTime: 60_000,
    queryFn: async (): Promise<{ rows: StaffReportRow[]; totalCount: number }> => {
      if (!from || !to) return { rows: [], totalCount: 0 };
      const { data, error } = await supabase.rpc("report_staff_attendance", {
        p_from: from,
        p_to: to,
        p_limit: REPORT_PAGE_SIZE,
        p_offset: page * REPORT_PAGE_SIZE,
        p_institution_id: institutionId ?? undefined, // follow super-admin "Manage Institution"
      });
      if (error) throw error;
      const rows = (data ?? []) as unknown as StaffRpcRow[];
      return {
        rows: mapStaffRows(rows, from, to, holidays),
        totalCount: rows.length > 0 ? Number(rows[0].total_count) : 0,
      };
    },
  });
}

const EXPORT_PAGE = 1000;

/** All student rows (loops the RPC in 1000-person pages) — for the Excel export. */
export async function fetchAllStudentReportRows(
  institutionId: string | null,
  from: string,
  to: string,
  classId: string | null,
  holidays: Set<string>,
): Promise<StudentReportRow[]> {
  const acc: StudentRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_student_attendance", {
      p_from: from,
      p_to: to,
      p_class_id: classId ?? undefined,
      p_limit: EXPORT_PAGE,
      p_offset: offset,
      p_institution_id: institutionId ?? undefined,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as StudentRpcRow[];
    acc.push(...batch);
    if (batch.length < EXPORT_PAGE) break;
    offset += EXPORT_PAGE;
  }
  return mapStudentRows(acc, from, to, holidays);
}

/** All staff rows (loops the RPC in 1000-person pages) — for the Excel export. */
export async function fetchAllStaffReportRows(
  institutionId: string | null,
  from: string,
  to: string,
  holidays: Set<string>,
): Promise<StaffReportRow[]> {
  const acc: StaffRpcRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("report_staff_attendance", {
      p_from: from,
      p_to: to,
      p_limit: EXPORT_PAGE,
      p_offset: offset,
      p_institution_id: institutionId ?? undefined,
    });
    if (error) throw error;
    const batch = (data ?? []) as unknown as StaffRpcRow[];
    acc.push(...batch);
    if (batch.length < EXPORT_PAGE) break;
    offset += EXPORT_PAGE;
  }
  return mapStaffRows(acc, from, to, holidays);
}

/**
 * Quote a single CSV field per RFC 4180: wrap in quotes when it contains
 * a comma, double-quote, newline or carriage return; doubling any
 * embedded quotes.
 */
function csvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const out: string[] = [];
  out.push(headers.map(csvField).join(","));
  rows.forEach((r) => out.push(r.map(csvField).join(",")));
  return out.join("\r\n");
}

export function downloadCsv(filename: string, content: string) {
  // BOM so Excel correctly opens UTF-8 (avoids "₹" / Devanagari mojibake).
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, filename);
}
