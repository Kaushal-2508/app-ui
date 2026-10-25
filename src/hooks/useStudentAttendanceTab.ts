import { useQuery } from "@tanstack/react-query";
import { parseISO, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { currentAcademicYear, academicYearRange } from "@/hooks/useAcademicCalendar";

// ── Student's class for an academic year (subtitle + not-enrolled gate) ──────
export interface StudentClassInfo {
  classId: string;
  className: string;
  classSection: string | null;
}

export function useStudentClass(academicYear: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-class", user?.id, academicYear],
    enabled: !!user?.id && !!academicYear,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentClassInfo | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes:class_id(id, name, section, academic_year)")
        .eq("user_id", user.id)
        .eq("role", "student");
      if (error) throw error;
      type Row = { class_id: string; classes: { id: string; name: string; section: string | null; academic_year: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const match = rows.find((r) => r.classes?.academic_year === academicYear) ?? rows[0];
      if (!match?.classes) return null;
      return { classId: match.classes.id, className: match.classes.name, classSection: match.classes.section };
    },
  });
}

// ── One date's attendance rows (status + remark + class) for the detail panel ─
export interface StudentDayRecord {
  status: string;
  remarks: string | null;
  className: string | null;
  classSection: string | null;
}

export function useStudentDayAttendance(dateIso: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-day-attendance", user?.id, dateIso],
    enabled: !!user?.id && !!dateIso,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentDayRecord[]> => {
      if (!user?.id || !dateIso) return [];
      const { data, error } = await supabase
        .from("attendance_records")
        .select("status, remarks, classes:class_id(name, section)")
        .eq("student_id", user.id)
        .eq("date", dateIso);
      if (error) throw error;
      type Row = { status: string; remarks: string | null; classes: { name: string; section: string | null } | null };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        status: r.status,
        remarks: r.remarks,
        className: r.classes?.name ?? null,
        classSection: r.classes?.section ?? null,
      }));
    },
  });
}

// ── Configured academic years for the year picker (RLS auto-scopes) ──────────
export interface AcademicYearOption {
  code: string;
  start: Date;
  end: Date;
  isActive: boolean;
}

export function useInstitutionAcademicYears() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["institution-academic-years", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<AcademicYearOption[]> => {
      const { data, error } = await supabase
        .from("cal_academic_years")
        .select("code, starts_on, ends_on, is_active");
      if (error) throw error;
      type Row = { code: string; starts_on: string; ends_on: string; is_active: boolean };
      // Date-only "today": ends_on parses to local midnight, so comparing a
      // wall-clock `new Date()` would make an AY whose ends_on == today fail the
      // membership test on its final day and spuriously synthesize a duplicate.
      const today = startOfDay(new Date());
      const opts = ((data ?? []) as Row[])
        .map((r) => ({ code: r.code, start: parseISO(r.starts_on), end: parseISO(r.ends_on), isActive: r.is_active }))
        .filter((o) => o.start <= today) // drop future-only years (no future)
        .sort((a, b) => b.start.getTime() - a.start.getTime());
      // Ensure the CURRENT academic year is always selectable, even if the
      // school hasn't configured its row yet (admin lag at rollover) — otherwise
      // today's month maps to no AY and the picker/nav get stuck on an old year.
      const containsToday = opts.some((o) => o.start <= today && o.end >= today);
      if (!containsToday) {
        const code = currentAcademicYear();
        // Guard against colliding with an already-configured row of the same
        // code (duplicate React key / Radix Select value).
        if (!opts.some((o) => o.code === code)) {
          const range = academicYearRange(code); // academicYearRange takes the AY STRING
          opts.unshift({ code, start: range.start, end: range.end, isActive: opts.length === 0 });
          opts.sort((a, b) => b.start.getTime() - a.start.getTime());
        }
      }
      return opts;
    },
  });
}
