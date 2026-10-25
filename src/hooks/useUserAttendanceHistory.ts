import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, eachDayOfInterval, parseISO, startOfMonth } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { StaffAttendanceStatus } from "@/hooks/useStaffAttendance";
import type { AttendanceStatus } from "@/hooks/useAttendance";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export type AttendanceKind = "staff" | "student";

export interface AttendanceHistoryRow {
  date: string;
  status: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  className?: string | null;
  remarks?: string | null;
}

export interface AttendanceHistorySummary {
  rows: AttendanceHistoryRow[];
  byDate: Map<string, string>; // date → status code
  presentCount: number;
  lateCount: number;
  absentCount: number;
  /** Days on leave (staff on_leave; student leave / sick / casual). */
  leaveCount: number;
  /** Median check-in / check-out clock time over the window, as "h:mm a".
   *  Staff only; null when no check-in exists. Median, not mean, so one
   *  wildly late morning does not drag the "usual" time. */
  typicalCheckIn: string | null;
  typicalCheckOut: string | null;
  /** Most recent late / absent day in the window, if any. */
  lastLate: AttendanceHistoryRow | null;
  lastAbsent: AttendanceHistoryRow | null;
  rangeStart: string;
  rangeEnd: string;
}

// Minutes since midnight in LOCAL time, so a 7:52 check-in stays 7:52
// whatever the ISO string's offset was.
const minutesOfDay = (iso: string) => {
  const d = parseISO(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/** Median clock time of a list of ISO timestamps, formatted "h:mm a". */
function medianClockTime(isos: string[]): string | null {
  if (isos.length === 0) return null;
  const mins = isos.map(minutesOfDay).sort((a, b) => a - b);
  const mid = Math.floor(mins.length / 2);
  const m = mins.length % 2 === 1 ? mins[mid] : Math.round((mins[mid - 1] + mins[mid]) / 2);
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return format(d, "h:mm a");
}

// Superset map — serves BOTH planes. `late`/`on_leave` are staff-only;
// `leave`/`sick`/`casual` are student-only. Don't prune either side.
const STATUS_TO_CODE: Record<string, "P" | "A" | "L" | "O" | "H" | "X"> = {
  present: "P",
  late: "L",
  absent: "A",
  on_leave: "O",
  leave: "O",
  sick: "O",
  casual: "O",
  holiday: "H",
};

/** Inclusive date window, both ends "yyyy-MM-dd". */
export interface AttendanceDateRange {
  from: string;
  to: string;
}

/** The default window: this month so far (the 1st through today). */
export function monthToDateRange(today: Date = new Date()): AttendanceDateRange {
  return { from: ymd(startOfMonth(today)), to: ymd(today) };
}

/** Longest window the picker allows; the read below is bounded to match. */
export const MAX_HISTORY_DAYS = 366;

/**
 * Attendance for a user over a date window (default: month to date).
 * `kind='staff'` reads staff_attendance_records, `kind='student'` reads
 * attendance_records (joined with class info). Returns flat rows + a
 * date→code map + pre-computed counts for the detail page header.
 *
 * RLS scopes the read: a coordinator only sees their wing's staff /
 * students; admins see everything in their institution; a teacher /
 * student looking at their own user_id sees their own records.
 */
export function useUserAttendanceHistory(
  userId: string | null,
  kind: AttendanceKind,
  range?: AttendanceDateRange,
) {
  // Strings, not Dates, are the identity: the caller can pass a fresh object
  // every render without re-running the query or the summary.
  const fallback = monthToDateRange();
  const fromStr = range?.from ?? fallback.from;
  const toStr = range?.to ?? fallback.to;
  const start = useMemo(() => parseISO(fromStr), [fromStr]);
  const end = useMemo(() => parseISO(toStr), [toStr]);

  const query = useQuery({
    queryKey: ["user-attendance-history", kind, userId, fromStr, toStr],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<AttendanceHistoryRow[]> => {
      if (!userId) return [];
      if (kind === "staff") {
        const { data, error } = await supabase
          .from("staff_attendance_records" as never)
          .select("date, status, check_in_at, check_out_at, remarks")
          .eq("staff_id", userId)
          .gte("date", fromStr)
          .lte("date", toStr)
          .order("date", { ascending: false })
          // One row per date per user and the picker caps the window at
          // MAX_HISTORY_DAYS, so this bound is a guard, not pagination.
          .limit(MAX_HISTORY_DAYS + 1);
        if (error) throw error;
        type Sar = {
          date: string;
          status: StaffAttendanceStatus;
          check_in_at: string | null;
          check_out_at: string | null;
          remarks: string | null;
        };
        return ((data ?? []) as Sar[]).map((r) => ({
          date: r.date,
          status: r.status,
          checkInAt: r.check_in_at,
          checkOutAt: r.check_out_at,
          remarks: r.remarks,
        }));
      }

      // Student
      const { data, error } = await supabase
        .from("attendance_records")
        .select(
          "date, status, remarks, classes!attendance_records_class_id_fkey(name, section)",
        )
        .eq("student_id", userId)
        .gte("date", fromStr)
        .lte("date", toStr)
        .order("date", { ascending: false })
        // Unique per (class, student, date) and a student sits in one class,
        // so the capped window is at most MAX_HISTORY_DAYS rows. Guard only.
        .limit(MAX_HISTORY_DAYS + 1);
      if (error) throw error;
      type Ar = {
        date: string;
        status: AttendanceStatus;
        remarks: string | null;
        classes: { name: string; section: string | null } | null;
      };
      return ((data ?? []) as Ar[]).map((r) => ({
        date: r.date,
        status: r.status,
        remarks: r.remarks,
        className: r.classes
          ? r.classes.section
            ? `${r.classes.name} ${r.classes.section}`
            : r.classes.name
          : null,
      }));
    },
  });

  const summary: AttendanceHistorySummary | null = useMemo(() => {
    if (!query.data) return null;

    const allDates = eachDayOfInterval({ start, end }).map(ymd);
    const byDate = new Map<string, string>();
    allDates.forEach((d) => byDate.set(d, ""));
    query.data.forEach((r) => {
      const code = STATUS_TO_CODE[r.status] ?? "X";
      byDate.set(r.date, code);
    });

    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    byDate.forEach((code) => {
      if (code === "P") presentCount++;
      else if (code === "L") lateCount++;
      else if (code === "A") absentCount++;
      else if (code === "O") leaveCount++;
    });

    // Rows arrive newest first (ORDER BY date DESC), so the first match is
    // the most recent. Counts over at most a year of rows; no round trip.
    const rows = query.data;
    const lastLate = rows.find((r) => STATUS_TO_CODE[r.status] === "L") ?? null;
    const lastAbsent = rows.find((r) => STATUS_TO_CODE[r.status] === "A") ?? null;
    const typicalCheckIn = medianClockTime(
      rows.flatMap((r) => (r.checkInAt ? [r.checkInAt] : [])),
    );
    const typicalCheckOut = medianClockTime(
      rows.flatMap((r) => (r.checkOutAt ? [r.checkOutAt] : [])),
    );

    return {
      rows,
      byDate,
      presentCount,
      lateCount,
      absentCount,
      leaveCount,
      typicalCheckIn,
      typicalCheckOut,
      lastLate,
      lastAbsent,
      rangeStart: fromStr,
      rangeEnd: toStr,
    };
  }, [query.data, start, end, fromStr, toStr]);

  return { ...query, summary };
}

/** "2026-04-25" → "Sat, 25 Apr". */
export function formatHistoryDate(date: string) {
  try {
    return format(parseISO(date), "EEE, d MMM");
  } catch {
    return date;
  }
}
