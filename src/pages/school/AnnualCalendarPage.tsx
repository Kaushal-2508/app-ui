import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Plus,
  Upload,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  Palmtree,
  FileWarning,
  CalendarClock,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell, PageHeader, type PageHeaderAction } from "@/components/shared/page";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsTimetableManager } from "@/hooks/useIsTimetableManager";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useAcademicCalendar,
  useCalAcademicYear,
  currentAcademicYear,
  academicYearRange,
  listAcademicYears,
  type AcademicCalendarEvent,
  type AcademicEventType,
  type EventInput,
} from "@/hooks/useAcademicCalendar";
import { AcademicEventDialog } from "@/components/school/AcademicEventDialog";
import { BulkHolidayImportDialog } from "@/components/school/BulkHolidayImportDialog";
import { NewYearSetupDialog } from "@/components/calendar/NewYearSetupDialog";
import { AcademicYearSetupCard } from "@/components/school/AcademicYearSetupCard";
import type { SeedHoliday } from "@/lib/indiaHolidays";

// --------------------------------------------------------------
// Color map for each event type. Tailwind utilities only, never inline
// styles (design rules). Tints are alpha over the card so they read on
// both the light and the dark card surface; text carries a dark variant.
// --------------------------------------------------------------
const EVENT_COLORS: Record<
  AcademicEventType,
  { bg: string; text: string; dot: string; label: string }
> = {
  working_day:   { bg: "bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", label: "Working day" },
  holiday:       { bg: "bg-rose-500/15",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500",    label: "Holiday" },
  exam_block:    { bg: "bg-amber-500/15",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500",   label: "Exam block" },
  term_start:    { bg: "bg-sky-500/15",     text: "text-sky-700 dark:text-sky-300",         dot: "bg-sky-500",     label: "Term start" },
  term_end:      { bg: "bg-sky-500/15",     text: "text-sky-700 dark:text-sky-300",         dot: "bg-sky-500",     label: "Term end" },
  ptm:           { bg: "bg-violet-500/15",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500",  label: "PTM" },
  special_event: { bg: "bg-teal-500/15",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500",    label: "Special event" },
};

// Ordered for the legend strip
const LEGEND: AcademicEventType[] = [
  "holiday",
  "exam_block",
  "term_start",
  "ptm",
  "special_event",
  "working_day",
];

function toIso(d: Date): string {
  // Use local-date components to avoid a TZ shift on toISOString.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function spanDates(event: AcademicCalendarEvent): string[] {
  const start = new Date(event.date + "T00:00:00");
  const end = new Date((event.end_date ?? event.date) + "T00:00:00");
  const out: string[] = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(toIso(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AnnualCalendarPage() {
  const { data: roleInfo } = useUserRole();
  // Per-user override grant (tt_manager_overrides): full Academic Calendar
  // management for a named non-admin user — same powers as a school admin.
  const { isTimetableManager } = useIsTimetableManager();
  const canEdit = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) || isTimetableManager;

  const [academicYear, setAcademicYear] = useState<string>(currentAcademicYear());
  const [displayMonth, setDisplayMonth] = useState<Date>(() => {
    const today = new Date();
    const { start, end } = academicYearRange(currentAcademicYear());
    if (today < start) return start;
    if (today > end) return start;
    return today;
  });
  const [selectedDateIso, setSelectedDateIso] = useState<string | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AcademicCalendarEvent | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);

  const { institutionId } = useEffectiveInstitution();

  // First-step gate: the academic year must have a `cal_academic_years` row
  // (start/end dates) before the rest of the page is meaningful. Admins
  // see the setup card; non-admins land on a friendly read-only message.
  const calYearQuery = useCalAcademicYear(academicYear);
  const ayDatesSet = !!calYearQuery.data;

  // Slot count for the selected year — used to detect "empty year"
  // and auto-prompt admins with the setup dialog.
  const slotCountQuery = useQuery({
    queryKey: ["timetable-slot-count", institutionId, academicYear],
    queryFn: async (): Promise<number> => {
      if (!institutionId) return 0;
      const { count, error } = await supabase
        .from("tt_slots" as never)
        .select("*", { count: "exact", head: true })
        .eq("institution_id", institutionId)
        .eq("academic_year", academicYear);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!institutionId && !!academicYear && canEdit,
  });

  const {
    events,
    isLoading,
    isError,
    error,
    createEvent,
    updateEvent,
    deleteEvent,
    bulkInsertHolidays,
  } = useAcademicCalendar(academicYear);

  // Auto-prompt: once per session per year, when the admin selects
  // a year that has no events AND no timetable slots yet.
  const yearIsEmpty =
    !isLoading &&
    !slotCountQuery.isLoading &&
    events.length === 0 &&
    (slotCountQuery.data ?? 0) === 0;

  useEffect(() => {
    if (!canEdit || !yearIsEmpty) return;
    const key = `ay-setup-prompted:${academicYear}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    setSetupDialogOpen(true);
  }, [canEdit, yearIsEmpty, academicYear]);

  const candidateSourceYears = useMemo(
    () => listAcademicYears(6).filter((y) => y < academicYear),
    [academicYear],
  );
  const defaultSourceYear = useMemo(() => {
    if (candidateSourceYears.length === 0) return undefined;
    return candidateSourceYears.sort().reverse()[0];
  }, [candidateSourceYears]);

  // --------------------------------------------------------------
  // Build a date ⇒ events map so we can colour the grid and drive
  // the right-hand detail panel in O(1).
  // --------------------------------------------------------------
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AcademicCalendarEvent[]>();
    for (const e of events) {
      for (const iso of spanDates(e)) {
        const bucket = map.get(iso) ?? [];
        bucket.push(e);
        map.set(iso, bucket);
      }
    }
    return map;
  }, [events]);

  // The "dominant" event for colouring a day: priority
  // exam_block > holiday > ptm > term_start/end > special_event > working_day
  const priority: AcademicEventType[] = [
    "exam_block",
    "holiday",
    "ptm",
    "term_start",
    "term_end",
    "special_event",
    "working_day",
  ];

  const dominant = (iso: string): AcademicEventType | null => {
    const bucket = eventsByDate.get(iso);
    if (!bucket || bucket.length === 0) return null;
    for (const p of priority) {
      if (bucket.some((b) => b.event_type === p)) return p;
    }
    return null;
  };

  const { start: ayStart, end: ayEnd } = useMemo(
    () => academicYearRange(academicYear),
    [academicYear],
  );

  // --------------------------------------------------------------
  // Summary strip metrics
  // --------------------------------------------------------------
  const summary = useMemo(() => {
    let working = 0;
    let holidays = 0;
    let examDays = 0;
    let remainingFromToday = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cur = new Date(ayStart.getTime());
    while (cur.getTime() <= ayEnd.getTime()) {
      const iso = toIso(cur);
      const dow = cur.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const bucket = eventsByDate.get(iso);
      const hasHoliday   = !!bucket?.some((b) => b.event_type === "holiday");
      const hasExamBlock = !!bucket?.some((b) => b.event_type === "exam_block");
      const hasExplicitWorking = !!bucket?.some((b) => b.event_type === "working_day");

      const isWorking =
        hasExplicitWorking || (!isWeekend && !hasHoliday && !hasExamBlock);

      if (isWorking) {
        working += 1;
        if (cur.getTime() >= today.getTime()) remainingFromToday += 1;
      }
      if (hasHoliday) holidays += 1;
      if (hasExamBlock) examDays += 1;

      cur.setDate(cur.getDate() + 1);
    }

    return { working, holidays, examDays, remainingFromToday };
  }, [ayStart, ayEnd, eventsByDate]);

  // --------------------------------------------------------------
  // Bucketed DayPicker modifiers — each event type becomes a
  // modifier so we can style them with Tailwind via modifiersClassNames.
  // --------------------------------------------------------------
  const modifiers = useMemo(() => {
    const buckets: Record<AcademicEventType, Date[]> = {
      working_day: [],
      holiday: [],
      exam_block: [],
      term_start: [],
      term_end: [],
      ptm: [],
      special_event: [],
    };
    eventsByDate.forEach((_bucket, iso) => {
      const d = dominant(iso);
      if (!d) return;
      buckets[d].push(new Date(iso + "T00:00:00"));
    });
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsByDate]);

  // Day-cell tints: same alpha approach as EVENT_COLORS so they flip with
  // the theme instead of staying pastel on the dark card.
  const modifiersClassNames: Record<string, string> = {
    working_day:   "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/25",
    holiday:       "bg-rose-500/15 text-rose-800 dark:text-rose-200 hover:bg-rose-500/25",
    exam_block:    "bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-500/25",
    term_start:    "bg-sky-500/15 text-sky-800 dark:text-sky-200 hover:bg-sky-500/25",
    term_end:      "bg-sky-500/15 text-sky-800 dark:text-sky-200 hover:bg-sky-500/25",
    ptm:           "bg-violet-500/15 text-violet-800 dark:text-violet-200 hover:bg-violet-500/25",
    special_event: "bg-teal-500/15 text-teal-800 dark:text-teal-200 hover:bg-teal-500/25",
  };

  // --------------------------------------------------------------
  // Event handlers
  // --------------------------------------------------------------
  const handleSelectDate = (d: Date | undefined) => {
    if (!d) return;
    setSelectedDateIso(toIso(d));
  };

  const openCreateForSelected = () => {
    if (!canEdit || !selectedDateIso) return;
    setEditingEvent(null);
    setEventDialogOpen(true);
  };

  const openEditEvent = (ev: AcademicCalendarEvent) => {
    if (!canEdit) return;
    setEditingEvent(ev);
    setSelectedDateIso(ev.date);
    setEventDialogOpen(true);
  };

  const submitEvent = async (payload: EventInput) => {
    if (editingEvent) {
      await updateEvent.mutateAsync({ id: editingEvent.id, ...payload });
    } else {
      await createEvent.mutateAsync(payload);
    }
  };

  const removeEvent = async (id: string) => {
    await deleteEvent.mutateAsync(id);
  };

  const importHolidays = async (picked: SeedHoliday[]) => {
    await bulkInsertHolidays.mutateAsync(
      picked.map((h) => ({ title: h.title, date: h.date, description: h.description })),
    );
  };

  const existingHolidayDates = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.event_type === "holiday") {
        for (const iso of spanDates(e)) set.add(iso);
      }
    }
    return set;
  }, [events]);

  const selectedEvents = selectedDateIso
    ? eventsByDate.get(selectedDateIso) ?? []
    : [];

  const shiftMonth = (delta: number) => {
    const next = new Date(displayMonth);
    next.setDate(1);
    next.setMonth(next.getMonth() + delta);
    // Clamp to the academic year range.
    if (next < ayStart) return;
    if (next > ayEnd) return;
    setDisplayMonth(next);
  };

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  const showEditActions = canEdit && ayDatesSet;
  const primaryAction: PageHeaderAction | undefined = showEditActions
    ? {
        label: "Add event",
        icon: <Plus className="h-4 w-4" />,
        onClick: () => {
          setEditingEvent(null);
          setSelectedDateIso(selectedDateIso ?? toIso(new Date()));
          setEventDialogOpen(true);
        },
      }
    : undefined;
  // Both dialogs were already mounted below but had lost their triggers in
  // an earlier header rewrite; the kebab gives them a home again.
  const secondaryActions: PageHeaderAction[] = showEditActions
    ? [
        {
          label: "Import holidays",
          icon: <Upload className="h-4 w-4" />,
          onClick: () => setBulkImportOpen(true),
        },
        {
          label: "Set up year",
          icon: <Wand2 className="h-4 w-4" />,
          onClick: () => setSetupDialogOpen(true),
        },
      ]
    : [];

  return (
    <PageShell>
      <PageHeader
        title="Academic Calendar"
        subtitle="Declare working days, holidays, exam blocks, PTMs and term boundaries for the year. Drives the timetable and attendance."
        icon={<CalendarDays className="h-5 w-5" />}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        collapseSecondary
        extras={
          <Select value={academicYear} onValueChange={setAcademicYear}>
            <SelectTrigger className="w-[132px]" aria-label="Academic year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {listAcademicYears(6).map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="space-y-6">

      {/* Step 1 gate: pin the page on a "set the AY dates first" card if no
          cal_academic_years row exists yet. Admins fill it in here; everyone
          else sees a quiet read-only notice. */}
      {!calYearQuery.isLoading && !ayDatesSet && (
        canEdit ? (
          <AcademicYearSetupCard
            academicYear={academicYear}
            defaultStart={toIso(ayStart)}
            defaultEnd={toIso(ayEnd)}
          />
        ) : (
          <Alert>
            <AlertTitle>Academic year not set up yet</AlertTitle>
            <AlertDescription>
              Your school admin hasn&apos;t set the start and end dates for{" "}
              {academicYear}. Once they do, the calendar will appear here.
            </AlertDescription>
          </Alert>
        )
      )}

      {ayDatesSet && (<>
      {/* Summary strip */}
      <StatTileGrid cols={2} mdCols={4}>
        <StatTile
          icon={<CalendarCheck className="h-5 w-5" />}
          label="Working days"
          value={isLoading ? "N/A" : summary.working}
          tone="mint"
        />
        <StatTile
          icon={<Palmtree className="h-5 w-5" />}
          label="Holidays"
          value={isLoading ? "N/A" : summary.holidays}
          tone="rose"
        />
        <StatTile
          icon={<FileWarning className="h-5 w-5" />}
          label="Exam block days"
          value={isLoading ? "N/A" : summary.examDays}
          tone="peach"
        />
        <StatTile
          icon={<CalendarClock className="h-5 w-5" />}
          label="Remaining from today"
          value={isLoading ? "N/A" : summary.remainingFromToday}
          tone="sky"
        />
      </StatTileGrid>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the calendar</AlertTitle>
          <AlertDescription>
            {error?.message ?? "Please refresh and try again."}
          </AlertDescription>
        </Alert>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {LEGEND.map((t) => (
          <div key={t} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${EVENT_COLORS[t].dot}`} />
            <span className="text-xs text-ink-600">
              {EVENT_COLORS[t].label}
            </span>
          </div>
        ))}
      </div>

      {/* Calendar + detail panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="surface-card frosted-shadow lg:col-span-2">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => shiftMonth(-1)}
                disabled={displayMonth.getTime() <= ayStart.getTime()}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-sm font-semibold text-ink-900">
                {displayMonth.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
                disabled={
                  new Date(
                    displayMonth.getFullYear(),
                    displayMonth.getMonth() + 1,
                    1,
                  ).getTime() > ayEnd.getTime()
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <Calendar
                mode="single"
                month={displayMonth}
                onMonthChange={setDisplayMonth}
                selected={
                  selectedDateIso
                    ? new Date(selectedDateIso + "T00:00:00")
                    : undefined
                }
                onSelect={handleSelectDate}
                fromDate={ayStart}
                toDate={ayEnd}
                modifiers={modifiers}
                modifiersClassNames={modifiersClassNames}
                className="w-full p-0"
                classNames={{
                  months: "flex flex-col space-y-4",
                  month: "space-y-4 w-full",
                  caption: "hidden",
                  nav: "hidden",
                  // Grid lines: the table carries the top/left edge, every
                  // cell its own right/bottom edge, so the lines meet with no
                  // doubling and the outer frame closes on all four sides.
                  table: "w-full border-collapse overflow-hidden rounded-lg border-t border-l border-border",
                  head_row: "grid grid-cols-7",
                  head_cell:
                    "text-muted-foreground font-normal text-xs py-2 text-center border-r border-b border-border bg-muted/30",
                  row: "grid grid-cols-7",
                  cell: "h-12 p-1 text-center text-sm relative border-r border-b border-border",
                  day: "h-10 w-full rounded-md font-normal aria-selected:ring-2 aria-selected:ring-primary transition-colors",
                  day_today: "ring-1 ring-primary/60",
                }}
              />
            )}
          </div>
        </div>

        <div className="surface-card frosted-shadow">
          <div className="p-4 md:p-6 space-y-4">
            {selectedDateIso ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="eyebrow">Selected date</p>
                    <p className="text-base font-semibold text-ink-900">
                      {formatDate(selectedDateIso)}
                    </p>
                  </div>
                  {canEdit && (
                    <Button size="sm" onClick={openCreateForSelected} className="flex-shrink-0">
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  )}
                </div>

                {selectedEvents.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={<CalendarDays className="h-5 w-5" />}
                    title="No events on this day"
                    description="It follows the default rule: weekdays are working days, weekends are not."
                    action={
                      canEdit
                        ? { label: "Add event", onClick: openCreateForSelected, icon: <Plus className="h-4 w-4" /> }
                        : undefined
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {selectedEvents.map((e) => {
                      const colors = EVENT_COLORS[e.event_type];
                      return (
                        <button
                          type="button"
                          key={e.id}
                          onClick={() => canEdit && openEditEvent(e)}
                          disabled={!canEdit}
                          className={`w-full text-left rounded-lg border border-transparent p-3 ${colors.bg} ${colors.text} ${
                            canEdit ? "hover:opacity-90 cursor-pointer" : "cursor-default"
                          } transition-colors`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-sm">{e.title}</div>
                            <Badge variant="secondary" className="text-xs">
                              {colors.label}
                            </Badge>
                          </div>
                          {e.end_date && e.end_date !== e.date && (
                            <div className="text-xs mt-1 opacity-80">
                              {formatDate(e.date)} → {formatDate(e.end_date)}
                            </div>
                          )}
                          {e.description && (
                            <div className="text-xs mt-1 opacity-80">
                              {e.description}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                size="sm"
                icon={<CalendarDays className="h-5 w-5" />}
                title="Pick a date"
                description={`Select a day on the calendar to ${canEdit ? "view or manage" : "see"} its events.`}
              />
            )}

            {(createEvent.isPending ||
              updateEvent.isPending ||
              deleteEvent.isPending ||
              bulkInsertHolidays.isPending) && (
              <div className="flex items-center gap-2 text-xs text-ink-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </div>
            )}
          </div>
        </div>
      </div>
      </>
      )}
      </div>

      {canEdit && (
        <>
          <AcademicEventDialog
            open={eventDialogOpen}
            onOpenChange={setEventDialogOpen}
            selectedDate={selectedDateIso}
            existing={editingEvent}
            events={events}
            onSubmit={submitEvent}
            onDelete={removeEvent}
            isSubmitting={
              createEvent.isPending || updateEvent.isPending || deleteEvent.isPending
            }
          />

          <BulkHolidayImportDialog
            open={bulkImportOpen}
            onOpenChange={setBulkImportOpen}
            academicYear={academicYear}
            existingHolidayDates={existingHolidayDates}
            onImport={importHolidays}
            isImporting={bulkInsertHolidays.isPending}
          />

          <NewYearSetupDialog
            open={setupDialogOpen}
            onClose={() => setSetupDialogOpen(false)}
            targetYear={academicYear}
            candidateSourceYears={candidateSourceYears}
            defaultSourceYear={defaultSourceYear}
            onCompleted={() => {
              // Refresh the slot count so the banner condition updates.
              slotCountQuery.refetch();
            }}
          />
        </>
      )}
    </PageShell>
  );
}
