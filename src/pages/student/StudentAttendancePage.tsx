import { useMemo, useState } from "react";
import {
  format, startOfMonth, getDay, addMonths, subMonths,
  isAfter, isBefore, startOfDay,
} from "date-fns";
import { ClipboardCheck, ChevronLeft, ChevronRight, CalendarX2, CalendarPlus, ClipboardList } from "lucide-react";
import { PageShell, PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces/StatTile";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { cn } from "@/lib/utils";
import { useStudentMonthAttendance } from "@/hooks/useStudentMonthAttendance";
import {
  useStudentClass, useStudentDayAttendance, useInstitutionAcademicYears,
} from "@/hooks/useStudentAttendanceTab";
import { CODE_TONES, CODE_LABEL, EVENT_KIND } from "@/components/attendance/attendanceTones";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { ApplyLeaveSheet } from "@/components/attendance/ApplyLeaveSheet";
import { TrackLeavesSheet } from "@/components/attendance/TrackLeavesSheet";
import { useMyLeaveRequests } from "@/hooks/useStudentLeave";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const WEEKDAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];

export default function StudentAttendancePage() {
  const today = startOfDay(new Date());
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedIso, setSelectedIso] = useState<string | null>(() => ymd(startOfDay(new Date())));

  const years = useInstitutionAcademicYears();
  const yearOptions = useMemo(() => years.data ?? [], [years.data]);
  // Which AY does the visible month fall in? (for the Select value + class lookup)
  const currentYear = useMemo(
    () => yearOptions.find((y) => monthAnchor >= startOfMonth(y.start) && monthAnchor <= y.end) ?? yearOptions[0] ?? null,
    [yearOptions, monthAnchor],
  );
  const academicYear = currentYear?.code ?? "";

  const month = useStudentMonthAttendance(monthAnchor);
  const studentClass = useStudentClass(academicYear);
  const day = useStudentDayAttendance(selectedIso);

  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const myLeaves = useMyLeaveRequests(0);
  const hasLeaves = (myLeaves.data?.length ?? 0) > 0;
  const [applyOpen, setApplyOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);

  // Month-nav bounds within the selected AY, never into the future.
  const minMonth = currentYear ? startOfMonth(currentYear.start) : startOfMonth(monthAnchor);
  const maxMonth = currentYear
    ? startOfMonth(isAfter(currentYear.end, today) ? today : currentYear.end)
    : startOfMonth(today);
  const prevDisabled = !isAfter(monthAnchor, minMonth);
  const nextDisabled = !isBefore(monthAnchor, maxMonth);

  function pickYear(code: string) {
    const y = yearOptions.find((o) => o.code === code);
    if (!y) return;
    const capped = isAfter(y.end, today) ? today : y.end;      // no future
    const target = isBefore(capped, y.start) ? y.start : capped; // stay in range
    setMonthAnchor(startOfMonth(target));
    setSelectedIso(null);
  }

  const monthCells = useMemo(() => {
    const start = startOfMonth(monthAnchor);
    const blanks: (Date | null)[] = Array.from({ length: getDay(start) }, () => null);
    return [...blanks, ...(month.data?.daysInMonth ?? [])];
  }, [monthAnchor, month.data?.daysInMonth]);

  const headerControls = (
    <div className="flex items-center gap-2">
      <Select value={academicYear} onValueChange={pickYear}>
        <SelectTrigger className="h-9 w-[116px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {yearOptions.map((y) => (
            <SelectItem key={y.code} value={y.code}>{y.code}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Previous month" disabled={prevDisabled}
          onClick={() => { setMonthAnchor((a) => subMonths(a, 1)); setSelectedIso(null); }}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[7.5rem] text-center text-sm font-medium text-ink-700">
          {format(monthAnchor, "MMMM yyyy")}
        </span>
        <Button variant="ghost" size="icon" aria-label="Next month" disabled={nextDisabled}
          onClick={() => { setMonthAnchor((a) => addMonths(a, 1)); setSelectedIso(null); }}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const subtitle = studentClass.data
    ? `${studentClass.data.className}${studentClass.data.classSection ? ` – ${studentClass.data.classSection}` : ""} · ${academicYear}`
    : academicYear;

  const loading = years.isLoading || month.isLoading || studentClass.isLoading;

  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title="Attendance"
        subtitle={subtitle}
        extras={headerControls}
      />

      {loading ? (
        <Skeleton className="h-[520px] w-full rounded-2xl" />
      ) : (month.isError || studentClass.isError || years.isError) ? (
        <EmptyState icon={<CalendarX2 className="h-5 w-5" />} tone="rose"
          title="Couldn't load your attendance" description="Please try again in a moment." />
      ) : !studentClass.data ? (
        <EmptyState icon={<CalendarX2 className="h-5 w-5" />}
          title="You're not enrolled in a class yet"
          description="Ask your school admin to add you to a class. Your attendance will show here." />
      ) : (
        <div className="space-y-4">
          {/* Leave actions */}
          <div className="flex justify-end gap-2">
            {hasLeaves && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setTrackOpen(true)}>
                <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Track Leaves
              </Button>
            )}
            <Button size="sm" className="rounded-full bg-brand-primary text-white hover:bg-brand-primary/90" onClick={() => setApplyOpen(true)}>
              <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> Apply Leave
            </Button>
          </div>

          {/* Summary. The leave tile only appears once there is an excused day,
              so the usual month stays a clean three-up. Leave sits outside the
              percentage either way (present / (present + absent)). */}
          <StatTileGrid cols={2} mdCols={(month.data?.excusedCount ?? 0) > 0 ? 4 : 3}>
            <StatTile label="Present" value={month.data?.presentCount ?? 0} tone="mint" />
            <StatTile label="Absent" value={month.data?.absentCount ?? 0} tone="rose" />
            {(month.data?.excusedCount ?? 0) > 0 && (
              <StatTile label="On leave" value={month.data?.excusedCount ?? 0} tone="violet" />
            )}
            <StatTile label="Attendance"
              value={month.data?.percentage == null ? "N/A" : `${Math.round(month.data.percentage)}%`}
              tone="teal" />
          </StatTileGrid>

          {/* Calendar + detail */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Calendar */}
            <div className="lg:col-span-2 surface-card frosted-shadow rounded-card p-4">
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_HEADERS.map((d, i) => (
                  <div key={`h-${i}`} className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-400 py-1">{d}</div>
                ))}
                {monthCells.map((cell, i) => {
                  if (!cell) return <div key={`b-${i}`} aria-hidden />;
                  const iso = ymd(cell);
                  const code = month.data?.byDate.get(iso) ?? "none";
                  const events = month.data?.eventsByDate.get(iso) ?? [];
                  const isToday = iso === ymd(today);
                  const isFuture = isAfter(cell, today);
                  const isSelected = iso === selectedIso;
                  const nonHoliday = events.filter((e) => e.kind !== "holiday");
                  const dotKind = code === "holiday"
                    ? null
                    : nonHoliday.some((e) => e.kind === "exam_block") ? "exam_block"
                    : nonHoliday.length > 0 ? "event" : null;
                  const cellLabel = `${format(cell, "EEE, d MMM")} · ${CODE_LABEL[code]}${events.length ? ` · ${events.map((e) => e.title).join(", ")}` : ""}`;
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={isFuture}
                      onClick={() => setSelectedIso(iso)}
                      className="relative aspect-square flex items-center justify-center disabled:cursor-default"
                      title={cellLabel}
                      aria-label={cellLabel}
                    >
                      <span className={cn(
                        "inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-full text-xs font-medium tabular-nums",
                        code === "none" ? (isFuture ? "text-ink-400" : "text-ink-700 bg-ink-400/10") : CODE_TONES[code],
                        isSelected && "ring-2 ring-brand-primary",
                        isToday && !isSelected && "ring-2 ring-brand-primary/50",
                      )}>
                        {format(cell, "d")}
                      </span>
                      {dotKind && (
                        <span className={cn("absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full", EVENT_KIND[dotKind].dot)} aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
                <LegendDot tone="bg-emerald-500/90" label="Present" />
                <LegendDot tone="bg-rose-500/90" label="Absent" />
                <LegendDot tone="bg-violet-500/90" label="Leave" />
                <LegendDot tone="bg-sky-500/90" label="Holiday" />
                <LegendDot tone="bg-amber-500" label="Exam period" />
                <LegendDot tone="bg-teal-500" label="Special event" />
              </div>
            </div>

            {/* Detail */}
            <div className="lg:col-span-1 surface-card frosted-shadow rounded-card p-4">
              {selectedIso ? (
                <DayDetail
                  dateLabel={format(new Date(`${selectedIso}T00:00:00`), "EEEE, d MMM yyyy")}
                  code={month.data?.byDate.get(selectedIso) ?? "none"}
                  events={month.data?.eventsByDate.get(selectedIso) ?? []}
                  records={day.data ?? []}
                  isPast={!isAfter(new Date(`${selectedIso}T00:00:00`), today)}
                  loadingRecords={day.isLoading}
                />
              ) : (
                <EmptyState size="sm" icon={<ClipboardCheck className="h-4 w-4" />}
                  title="Pick a date" description="Tap any day to see its attendance and events." />
              )}
            </div>
          </div>
        </div>
      )}

      <ApplyLeaveSheet open={applyOpen} onOpenChange={setApplyOpen}
        classId={studentClass.data?.classId ?? null} institutionId={institutionId} />
      <TrackLeavesSheet open={trackOpen} onOpenChange={setTrackOpen} />
    </PageShell>
  );
}

function LegendDot({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2 w-2 rounded-full", tone)} aria-hidden />
      {label}
    </span>
  );
}

function DayDetail({
  dateLabel, code, events, records, isPast, loadingRecords,
}: {
  dateLabel: string;
  code: import("@/hooks/useStudentMonthAttendance").DayAttendanceCode;
  events: import("@/hooks/useStudentMonthAttendance").CalEventLite[];
  records: import("@/hooks/useStudentAttendanceTab").StudentDayRecord[];
  isPast: boolean;
  loadingRecords: boolean;
}) {
  const isAttendance = code !== "none" && code !== "holiday";
  const nothing = !isAttendance && code !== "holiday" && events.length === 0 && !(isPast);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-900">{dateLabel}</h3>

      {/* Attendance */}
      {isAttendance ? (
        loadingRecords ? (
          <Skeleton className="h-6 w-40" />
        ) : records.length > 0 ? (
          <div className="space-y-1.5">
            {records.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-semibold",
                  chipForStatus(r.status))}>
                  {labelForStatus(r.status)}
                </span>
                {r.className && (
                  <span className="text-ink-500">{r.className}{r.classSection ? ` – ${r.classSection}` : ""}</span>
                )}
                {r.remarks && <span className="text-ink-600 italic">“{r.remarks}”</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-500">{CODE_LABEL[code]}</p>
        )
      ) : code === "holiday" ? (
        <p className="text-xs text-ink-600">School holiday, no attendance.</p>
      ) : isPast ? (
        <p className="text-xs text-ink-500">No attendance recorded.</p>
      ) : null}

      {/* Events */}
      {events.length > 0 && (
        <div className="space-y-1.5">
          <p className="eyebrow">On the calendar</p>
          {events.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-semibold", EVENT_KIND[e.kind].chip)}>
                {EVENT_KIND[e.kind].label}
              </span>
              <span className="text-ink-800">{e.title}</span>
            </div>
          ))}
        </div>
      )}

      {nothing && <p className="text-xs text-ink-500">Nothing on this day.</p>}
    </div>
  );
}

function chipForStatus(status: string): string {
  switch (status) {
    case "present": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
    case "absent":  return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
    case "leave":
    case "sick":
    case "casual":  return "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300";
    case "holiday": return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";
    default:        return "bg-ink-400/10 text-ink-700";
  }
}
function labelForStatus(status: string): string {
  const m: Record<string, string> = {
    present: "Present", absent: "Absent", leave: "On leave",
    sick: "Sick leave", casual: "Casual leave", holiday: "Holiday",
  };
  return m[status] ?? status;
}
