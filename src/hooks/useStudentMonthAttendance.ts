import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
} from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useScopedStudentId } from "@/contexts/StudentScopeContext";
import type { TrendRange } from "@/hooks/useStudentClassComparison";

export type DayAttendanceCode =
  | "present"
  | "absent"
  | "leave"
  | "sick"
  | "casual"
  | "holiday"
  | "none";

export interface CalEventLite {
  kind: "holiday" | "exam_block" | "event";
  title: string;
}

export interface StudentMonthAttendance {
  monthAnchor: Date;
  daysInMonth: Date[];
  byDate: Map<string, DayAttendanceCode>; // YYYY-MM-DD → code
  /** All academic-calendar entries per day (holiday / exam_block / event). */
  eventsByDate: Map<string, CalEventLite[]>;
  presentCount: number;
  absentCount: number;
  excusedCount: number; // leave + sick + casual
  holidayCount: number;
  /**
   * Effective attendance % — present / (present + absent). Leave / sick /
   * casual / holiday are excluded from the denominator (excused or off).
   * Returns null when there are no graded days yet.
   */
  percentage: number | null;
  totalGradedDays: number;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Fetches student attendance + institution holidays for the given month
 * and returns a precomputed pivot the dashboard widget renders directly.
 *
 * RLS scopes `attendance_records` to `student_id = auth.uid()` for the
 * student role, so this hook is safe to call as a plain student.
 */
export function useStudentMonthAttendance(monthAnchor: Date = new Date()) {
  const { user } = useAuth();

  const start = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const end = useMemo(() => endOfMonth(monthAnchor), [monthAnchor]);
  const fromStr = ymd(start);
  const toStr = ymd(end);

  const query = useQuery({
    queryKey: ["student-month-attendance", user?.id, fromStr, toStr],
    queryFn: async () => {
      if (!user?.id) {
        return {
          records: [] as { date: string; status: string }[],
          holidays: new Set<string>(),
          events: [] as Array<{ date: string; kind: CalEventLite["kind"]; title: string }>,
          institutionId: null as string | null,
        };
      }

      // Tenant scope: read the student's institution from their profile so we
      // only fetch holidays for the school they belong to.
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle();
      const institutionId = (profile as { institution_id: string | null } | null)?.institution_id ?? null;

      const recordsP = supabase
        .from("attendance_records")
        .select("date, status")
        .eq("student_id", user.id)
        .gte("date", fromStr)
        .lte("date", toStr);

      const eventsP = institutionId
        ? supabase
            .from("cal_events")
            .select("starts_on, ends_on, kind, title")
            .eq("institution_id", institutionId)
            .in("kind", ["holiday", "exam_block", "event"])
            .lte("starts_on", toStr)
            .gte("ends_on", fromStr)
        : Promise.resolve({ data: [], error: null });

      const [recRes, evtRes] = await Promise.all([recordsP, eventsP]);
      if (recRes.error) throw recRes.error;
      if (evtRes.error) throw evtRes.error;

      const records = ((recRes.data ?? []) as { date: string; status: string }[]);
      const holidays = new Set<string>();
      const events: Array<{ date: string; kind: CalEventLite["kind"]; title: string }> = [];
      type EvtRow = { starts_on: string; ends_on: string; kind: string; title: string };
      ((evtRes.data ?? []) as EvtRow[]).forEach((e) => {
        const kind = e.kind as CalEventLite["kind"];
        eachDayOfInterval({ start: parseISO(e.starts_on), end: parseISO(e.ends_on) }).forEach((d) => {
          const key = ymd(d);
          events.push({ date: key, kind, title: e.title });
          if (kind === "holiday") holidays.add(key);
        });
      });
      return { records, holidays, events, institutionId };
    },
    enabled: !!user?.id,
    // Keep the previous month's grid on screen while paging to an un-cached
    // month, so Prev/Next (the page's primary interaction) doesn't flash the
    // whole calendar + summary to a full-height skeleton on every click.
    placeholderData: keepPreviousData,
  });

  const data: StudentMonthAttendance | null = useMemo(() => {
    if (!query.data) return null;
    const { records, holidays, events } = query.data;
    const daysInMonth = eachDayOfInterval({ start, end });
    const byDate = new Map<string, DayAttendanceCode>();

    daysInMonth.forEach((d) => byDate.set(ymd(d), "none"));

    records.forEach((r) => {
      const code = r.status as DayAttendanceCode;
      // Records win over the "none" baseline. Holidays will overwrite below.
      byDate.set(r.date, code);
    });

    holidays.forEach((d) => {
      // Holiday flag overrides any record — the day is school-wide off.
      if (byDate.has(d)) byDate.set(d, "holiday");
    });

    const eventsByDate = new Map<string, CalEventLite[]>();
    events.forEach((e) => {
      const list = eventsByDate.get(e.date) ?? [];
      list.push({ kind: e.kind, title: e.title });
      eventsByDate.set(e.date, list);
    });

    let presentCount = 0;
    let absentCount = 0;
    let excusedCount = 0;
    let holidayCount = 0;
    byDate.forEach((code) => {
      switch (code) {
        case "present": presentCount++; break;
        case "absent":  absentCount++;  break;
        case "leave":
        case "sick":
        case "casual":  excusedCount++; break;
        case "holiday": holidayCount++; break;
      }
    });

    const totalGradedDays = presentCount + absentCount;
    const percentage =
      totalGradedDays === 0 ? null : (presentCount / totalGradedDays) * 100;

    return {
      monthAnchor,
      daysInMonth,
      byDate,
      eventsByDate,
      presentCount,
      absentCount,
      excusedCount,
      holidayCount,
      percentage,
      totalGradedDays,
    };
  }, [query.data, start, end, monthAnchor]);

  return { ...query, data };
}

export interface StudentAttendanceSummary {
  range: TrendRange;
  from: string;
  to: string;
  academic_year: string | null;
  present: number;
  absent: number;
  excused: number;
  holiday: number;
  /** present + absent — the days that actually count toward the percentage. */
  graded_days: number;
  /** present / (present + absent), or null when nothing is graded yet. */
  percentage: number | null;
}

/**
 * Attendance totals over a chosen window (1m / 3m / 6m / academic year) for the
 * dashboard card's time picker.
 *
 * Aggregated SERVER-SIDE by `student_attendance_summary` (migration 20260805130000)
 * rather than counting rows in the browser — an academic-year window would otherwise
 * ship every attendance row to the client just to tally it (§23). The RPC applies the
 * same holiday-override and percentage rules as `useStudentMonthAttendance`, so the
 * card and the attendance page always agree.
 */
export function useStudentAttendanceSummary(range: TrendRange) {
  const { user } = useAuth();
  const scopedId = useScopedStudentId();
  return useQuery({
    queryKey: ["student-attendance-summary", user?.id, range, scopedId ?? "self"],
    enabled: !!user?.id,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<StudentAttendanceSummary> => {
      const { data, error } = scopedId
        ? await supabase.rpc("student_attendance_summary_for", {
            p_student_id: scopedId,
            p_range: range,
          })
        : await supabase.rpc("student_attendance_summary", { p_range: range });
      if (error) throw error;
      return data as unknown as StudentAttendanceSummary;
    },
  });
}
