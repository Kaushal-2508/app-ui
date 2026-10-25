import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import {
  fetchCalendarEvents,
  insertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/timetableCompat";

export type AcademicEventType =
  | "working_day"
  | "holiday"
  | "exam_block"
  | "term_start"
  | "term_end"
  | "ptm"
  | "special_event";

export interface AcademicCalendarEvent {
  id: string;
  institution_id: string;
  academic_year: string;
  title: string;
  date: string;            // ISO yyyy-mm-dd
  end_date: string | null;
  event_type: AcademicEventType;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventInput {
  title: string;
  date: string;
  end_date?: string | null;
  event_type: AcademicEventType;
  description?: string | null;
}

export function currentAcademicYear(today = new Date()): string {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function academicYearRange(year: string): { start: Date; end: Date } {
  const [startYearStr, endSuffix] = year.split("-");
  const startYear = parseInt(startYearStr, 10);
  const endYear =
    endSuffix && endSuffix.length === 2
      ? Math.floor(startYear / 100) * 100 + parseInt(endSuffix, 10)
      : startYear + 1;
  return {
    start: new Date(startYear, 3, 1),       // Apr 1
    end:   new Date(endYear, 2, 31),        // Mar 31
  };
}

export function listAcademicYears(count = 5): string[] {
  const current = currentAcademicYear();
  const startYear = parseInt(current.split("-")[0], 10);
  const out: string[] = [];
  for (let i = -2; i < count - 2; i++) {
    const s = startYear + i;
    out.push(`${s}-${String((s + 1) % 100).padStart(2, "0")}`);
  }
  return out;
}

export function useAcademicCalendar(academicYear: string) {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();

  // Supported event types after the rebuild. Legacy enum is wider
  // (working_day, term_start, term_end) but those map to nothing in
  // the new cal_events schema — surfaced to callers as an error.
  const SUPPORTED_TYPES = new Set<AcademicEventType>([
    "holiday",
    "exam_block",
    "ptm",
    "special_event",
  ]);

  const query = useQuery({
    queryKey: ["academic-calendar", institutionId, academicYear],
    queryFn: async (): Promise<AcademicCalendarEvent[]> => {
      if (!institutionId) return [];
      const rows = await fetchCalendarEvents(institutionId, academicYear);
      return rows.map((r): AcademicCalendarEvent => ({
        ...r,
        event_type: r.event_type as AcademicEventType,
      }));
    },
    enabled: !!institutionId && !!academicYear,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["academic-calendar", institutionId, academicYear] });
    queryClient.invalidateQueries({ queryKey: ["working-days", institutionId, academicYear] });
  };

  const createEvent = useMutation({
    mutationFn: async (input: EventInput) => {
      if (!institutionId) throw new Error("Institution not resolved");
      if (!SUPPORTED_TYPES.has(input.event_type)) {
        throw new Error(`Event type '${input.event_type}' is no longer supported in the rebuilt calendar.`);
      }
      const row = await insertCalendarEvent(institutionId, academicYear, {
        title: input.title,
        date: input.date,
        end_date: input.end_date ?? null,
        event_type: input.event_type as "holiday" | "exam_block" | "ptm" | "special_event",
        description: input.description ?? null,
      });
      return { ...row, event_type: row.event_type as AcademicEventType } as AcademicCalendarEvent;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event added");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't add the event.", context: "createCalendarEvent" }),
  });

  const updateEvent = useMutation({
    mutationFn: async (input: EventInput & { id: string }) => {
      if (!SUPPORTED_TYPES.has(input.event_type)) {
        throw new Error(`Event type '${input.event_type}' is no longer supported in the rebuilt calendar.`);
      }
      const row = await updateCalendarEvent(input.id, {
        title: input.title,
        date: input.date,
        end_date: input.end_date ?? null,
        event_type: input.event_type as "holiday" | "exam_block" | "ptm" | "special_event",
        description: input.description ?? null,
      });
      return { ...row, event_type: row.event_type as AcademicEventType } as AcademicCalendarEvent;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event updated");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't update the event.", context: "updateCalendarEvent" }),
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: string) => {
      await deleteCalendarEvent(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event deleted");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't delete the event.", context: "deleteCalendarEvent" }),
  });

  const bulkInsertHolidays = useMutation({
    mutationFn: async (items: { title: string; date: string; description?: string }[]) => {
      if (items.length === 0) return [];
      if (!institutionId) throw new Error("Institution not resolved");
      const inserted: AcademicCalendarEvent[] = [];
      for (const h of items) {
        const row = await insertCalendarEvent(institutionId, academicYear, {
          title: h.title,
          date: h.date,
          end_date: null,
          event_type: "holiday",
          description: h.description ?? null,
        });
        inserted.push({ ...row, event_type: row.event_type as AcademicEventType } as AcademicCalendarEvent);
      }
      return inserted;
    },
    onSuccess: (rows) => {
      invalidate();
      toast.success(`Imported ${rows.length} holiday${rows.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't import the holidays.", context: "bulkInsertHolidays" }),
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    createEvent,
    updateEvent,
    deleteEvent,
    bulkInsertHolidays,
  };
}

export interface WorkingDaysResponse {
  academic_year: string;
  month: number | null;
  range: { start: string; end: string };
  working_days: string[];
  holidays: string[];
  exam_blocks: string[];
  total_working_days: number;
  total_holidays: number;
  total_exam_block_days: number;
}

// =============================================================
// Academic year date range — first-step admin setup
//
// Reads + writes the `cal_academic_years` row that defines the
// authoritative start/end dates for an AY at this institution.
// The Annual Calendar page gates everything else behind this row
// being present: admins land on a "Set up academic year" card if
// no row exists, so the rest of the calendar always has a valid
// span to render against.
// =============================================================

export interface CalAcademicYearRow {
  id: string;
  code: string;
  starts_on: string;          // ISO yyyy-mm-dd
  ends_on: string;            // ISO yyyy-mm-dd
  is_active: boolean;
}

export function useCalAcademicYear(academicYear: string) {
  const { institutionId } = useEffectiveInstitution();
  return useQuery({
    queryKey: ["cal-academic-year-row", institutionId, academicYear],
    enabled: !!institutionId && !!academicYear,
    queryFn: async (): Promise<CalAcademicYearRow | null> => {
      const { data, error } = await supabase
        .from("cal_academic_years" as never)
        .select("id, code, starts_on, ends_on, is_active")
        .eq("institution_id", institutionId!)
        .eq("code", academicYear)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as CalAcademicYearRow | null) ?? null;
    },
  });
}

export interface UpsertCalAcademicYearInput {
  code: string;
  starts_on: string;          // ISO yyyy-mm-dd
  ends_on: string;            // ISO yyyy-mm-dd
}

export function useUpsertCalAcademicYear() {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertCalAcademicYearInput) => {
      if (!institutionId) throw new Error("Missing institution context.");
      // Upsert by (institution_id, code). Marking the row as active here
      // matches the partial-unique constraint expectation of "exactly one
      // active year per institution" — switching active years is a future
      // concern; for now the row exists ⇒ the AY is set up and active.
      const { error } = await supabase
        .from("cal_academic_years" as never)
        .upsert(
          {
            institution_id: institutionId,
            code: input.code,
            starts_on: input.starts_on,
            ends_on: input.ends_on,
            is_active: true,
          } as never,
          { onConflict: "institution_id,code" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Academic year saved");
      queryClient.invalidateQueries({ queryKey: ["cal-academic-year-row"] });
      queryClient.invalidateQueries({ queryKey: ["cal-academic-years"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the academic year.", context: "upsertCalAcademicYear" }),
  });
}

export function useWorkingDays(academicYear: string, month?: number) {
  const { institutionId } = useEffectiveInstitution();

  return useQuery({
    queryKey: ["working-days", institutionId, academicYear, month ?? null],
    queryFn: async (): Promise<WorkingDaysResponse> => {
      const { data, error } = await supabase.functions.invoke<WorkingDaysResponse>(
        "get-working-days",
        { body: { institution_id: institutionId, academic_year: academicYear, month } },
      );
      if (error) throw error;
      if (!data) throw new Error("Empty response from get-working-days");
      return data;
    },
    enabled: !!institutionId && !!academicYear,
  });
}
