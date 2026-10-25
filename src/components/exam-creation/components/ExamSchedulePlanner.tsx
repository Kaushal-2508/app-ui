import { useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { DayContentProps } from "react-day-picker";
import {
  AlertCircle,
  AlertTriangle,
  CalendarCheck2,
  CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Info,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { MAX_LATE_ENTRY_MINUTES, formatClock, formatClockWithDayOffset } from "@/lib/examSchedule";
import {
  addDays,
  intervalsOverlap,
  localDayKey,
  mergeIntervals,
  toTimeInputValue,
  type ExamSlotBooking,
} from "@/lib/examSlots";
import type { ExamSlotPlan } from "@/hooks/useExamSlotPlan";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { cn } from "@/lib/utils";

/** Late entry this long holds the sections for most of a school day. */
const LONG_HOLD_MINUTES = 120;


interface ExamSchedulePlannerProps {
  plan: ExamSlotPlan;
  /** A paper (offline) exam: a date only, never a time. */
  isOfflineExam: boolean;
  examMode: string;
  startTime: string;
  durationMinutes: number;
  lateEntryMinutes: number;
  onDateChange: (key: string) => void;
  onStartTimeChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onLateEntryChange: (value: number) => void;
  /** The server refused the publish (another teacher booked first). */
  serverClashMessage: string | null;
  /** While checking or publishing: nothing may change the slot being sent. */
  disabled: boolean;
}

/**
 * Body of the Schedule & publish sheet. Shows the times already booked for the
 * selected sections so a teacher cannot pick an overlapping one by accident,
 * flags a clash as soon as it appears, and offers free times that fit.
 * Bookings come only from the scoped RPC (see useExamSlotBookings).
 */
export function ExamSchedulePlanner({
  plan,
  isOfflineExam,
  examMode,
  startTime,
  durationMinutes,
  lateEntryMinutes,
  onDateChange,
  onStartTimeChange,
  onDurationChange,
  onLateEntryChange,
  serverClashMessage,
  disabled,
}: ExamSchedulePlannerProps) {
  const isOffline = isOfflineExam;
  const { proposed } = plan;
  const visibleNames = plan.visibleClasses.map((c) => plan.classLabel(c.class_id));
  const classesPhrase = joinNames(visibleNames) || "these classes";
  // Nothing is known about the bookings: no dots, no counts, never "free".
  const unknown = plan.isLoading || plan.isError;

  return (
    // A disabled fieldset disables every input and button inside it, so the
    // slot on screen is always the slot being checked or published.
    <fieldset disabled={disabled} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <div className="space-y-2">
        <Label htmlFor="exam-schedule-date" className="block">
          {isOffline ? "Date of exam" : "Exam date"}
        </Label>
        <ExamDateField plan={plan} classesPhrase={classesPhrase} onDateChange={onDateChange} />
        {isOffline && (
          <p className="text-xs text-ink-600">
            The day the paper exam was conducted. After publishing, enter each student's marks from "My Exams".
          </p>
        )}
      </div>

      {!isOffline && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="exam-schedule-start" className="mb-1 block">
                Start time
              </Label>
              <Input
                id="exam-schedule-start"
                type="time"
                className="min-h-[44px] text-left dark:[color-scheme:dark] [&::-webkit-date-and-time-value]:text-left"
                value={startTime}
                onChange={(e) => onStartTimeChange(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="exam-schedule-duration" className="mb-1 block">
                Duration (min)
              </Label>
              <Input
                id="exam-schedule-duration"
                type="number"
                min={5}
                className="min-h-[44px]"
                value={durationMinutes}
                onChange={(e) => onDurationChange(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-1">
              <Label htmlFor="exam-schedule-late" className="text-sm font-medium">
                Late entry
              </Label>
              <LateEntryInfo
                durationMinutes={durationMinutes}
                lateEntryMinutes={lateEntryMinutes}
                examMode={examMode}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="exam-schedule-late"
                type="number"
                min={0}
                max={MAX_LATE_ENTRY_MINUTES}
                step={5}
                className="min-h-[44px] w-24"
                value={lateEntryMinutes}
                onChange={(e) => onLateEntryChange(Number(e.target.value))}
              />
              <span className="text-sm text-ink-600">minutes</span>
            </div>
            {proposed && (
              <p className="text-xs text-ink-600">
                Students can join until{" "}
                <strong className="text-ink-900">
                  {formatClockWithDayOffset(proposed.entryDeadline, proposed.start)}
                </strong>
                .
              </p>
            )}
          </div>

          <SlotStatus
            plan={plan}
            classesPhrase={classesPhrase}
            serverClashMessage={serverClashMessage}
            missing={!plan.selectedKey ? "date" : !startTime ? "start" : durationMinutes > 0 ? null : "duration"}
          />
        </>
      )}

      <DayBookings
        plan={plan}
        isOffline={isOffline}
        classesPhrase={classesPhrase}
        onPickStart={(d) => onStartTimeChange(toTimeInputValue(d))}
      />

      {!isOffline && proposed && proposed.lateEntryMinutes >= LONG_HOLD_MINUTES && plan.clashes.length === 0 && !unknown && (
        <Notice tone="warn">
          This exam holds {classesPhrase} from {formatClock(proposed.start)} to{" "}
          {formatClockWithDayOffset(proposed.occupiedUntil, proposed.start)} because of the{" "}
          {proposed.lateEntryMinutes} min late entry. No other exam can be booked for{" "}
          {visibleNames.length === 1 ? "it" : "them"} in that time.
        </Notice>
      )}

      {plan.hiddenClassLabels.length > 0 && (
        <Notice tone="info" icon={<EyeOff className="h-4 w-4" />}>
          Booked times for {joinNames(plan.hiddenClassLabels)} are not shown because you don't teach{" "}
          {plan.hiddenClassLabels.length === 1 ? "that class" : "those classes"}. They are still checked when you
          publish.
        </Notice>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The "i" next to the Late entry heading: what late entry means, on tap (a
 * hover tooltip never opens on a phone). With 0 there is no separate join
 * window: students may join until the end time (student_eligible_exams), and
 * an online attempt is then cut off at that end time while a hybrid one still
 * gets its full duration, so the note says which.
 */
function LateEntryInfo({
  durationMinutes,
  lateEntryMinutes,
  examMode,
}: {
  durationMinutes: number;
  lateEntryMinutes: number;
  examMode: string;
}) {
  // Opens on mouse hover and closes on leave; a tap (phones have no hover)
  // toggles it. While the mouse is over the button, a click must not close it.
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && hovering) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        {/* 44px tap target without growing the heading row. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-my-2 h-11 w-11 rounded-full text-ink-500 hover:text-ink-900"
          aria-label="What is late entry?"
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            setHovering(true);
            setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            setHovering(false);
            setOpen(false);
          }}
        >
          <Info className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        // A hover must not pull focus out of the field being typed in.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-72 max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed text-ink-600"
      >
        {lateEntryMinutes > 0 ? (
          <>
            How many minutes after the start time can students still join? Each student gets the full{" "}
            {durationMinutes} min duration from when they enter.
          </>
        ) : examMode === "hybrid" ? (
          <>
            With 0 there is no separate join window: students can join until the exam's end time and each still
            gets the full {durationMinutes} min.
          </>
        ) : (
          <>
            With 0 there is no separate join window: students can join until the exam's end time, and everyone must
            finish by then, so anyone who starts late gets less than {durationMinutes} min.
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SlotStatus({
  plan,
  classesPhrase,
  serverClashMessage,
  missing,
}: {
  plan: ExamSlotPlan;
  classesPhrase: string;
  serverClashMessage: string | null;
  /** Which input stops the slot from being checked, if any. */
  missing: "date" | "start" | "duration" | null;
}) {
  const { proposed, clashes, now } = plan;

  // The server refused this exact slot: someone booked it after the sheet
  // loaded. Shown until the teacher picks a different time.
  if (serverClashMessage && clashes.length === 0) {
    return (
      <StatusCard tone="danger" title="Someone booked this time first">
        <p className="text-sm text-ink-900">{serverClashMessage}</p>
        <p className="text-xs text-ink-600">The booked times below are refreshed. Pick a free time.</p>
      </StatusCard>
    );
  }

  if (!proposed) {
    return (
      <p className="text-xs text-ink-600">
        {missing === "duration"
          ? `Enter a duration of at least 5 minutes to check ${classesPhrase} for clashes.`
          : missing === "start"
            ? `Pick a start time to check ${classesPhrase} for clashes.`
            : `Pick a date and start time to check ${classesPhrase} for clashes.`}
      </p>
    );
  }

  if (plan.isOffline) {
    return (
      <StatusCard tone="warn" title="You're offline">
        <p className="text-xs text-ink-600">
          Booked times can't be checked until you reconnect. They load on their own once you're back online.
        </p>
      </StatusCard>
    );
  }

  if (plan.isError) {
    // Error before empty (CLAUDE.md §6): never let a failed read look free.
    return (
      <StatusCard tone="warn" title="Couldn't check booked times">
        <p className="text-xs text-ink-600">
          You can still publish. The school's system refuses a time that is already booked.
        </p>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={plan.refetch}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </StatusCard>
    );
  }

  if (plan.isLoading) {
    return <Skeleton className="h-16 w-full rounded-lg" />;
  }

  // A clash is shown inside the "Booked on" section (DayBookings): the line
  // under its heading, the free start times under the list.
  if (clashes.length > 0) return null;

  // Every selected section is hidden from this caller: nothing was checked
  // here, so never show the green "free" card.
  if (plan.visibleClasses.length === 0) {
    return (
      <p className="text-xs text-ink-600">
        Booked times for these classes aren't shown to you. The school checks this time when you publish.
      </p>
    );
  }

  const joinClosed = proposed.entryDeadline.getTime() <= now.getTime();
  const alreadyOpen = !joinClosed && proposed.start.getTime() <= now.getTime();
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-brand-primary/30 bg-brand-primary/10 p-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
        <p className="text-sm text-ink-900">
          Free for {classesPhrase}:{" "}
          <span className="tabular-nums font-medium">
            {formatClock(proposed.start)} to {formatClockWithDayOffset(proposed.occupiedUntil, proposed.start)}
          </span>
          .
        </p>
      </div>
      {joinClosed && (
        <Notice tone="warn">
          The join window closed at {formatClock(proposed.entryDeadline)}. Students can't start this exam any more.
          Pick a later time.
        </Notice>
      )}
      {alreadyOpen && (
        <Notice tone="info">
          This exam opens as soon as you publish. Students can join until {formatClock(proposed.entryDeadline)}.
        </Notice>
      )}
    </div>
  );
}

function DayBookings({
  plan,
  isOffline,
  classesPhrase,
  onPickStart,
}: {
  plan: ExamSlotPlan;
  isOffline: boolean;
  classesPhrase: string;
  onPickStart: (d: Date) => void;
}) {
  const { selectedDay, dayBookings, proposed, suggestions } = plan;
  if (!selectedDay) return null;
  const dayLabel = format(selectedDay, "EEE, d MMM");
  const answered = !plan.isError && !plan.isOffline && !plan.isLoading;
  // A paper exam has no time, so it never clashes.
  const clashCount = answered && !isOffline ? groupByExam(plan.clashes).length : 0;

  return (
    <section className="space-y-3 rounded-lg border border-border p-3" aria-label={`Exams booked on ${dayLabel}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Booked on {dayLabel}</p>
        {answered && dayBookings.length > 0 && (
          <span className="text-xs text-ink-500">
            {countLabel(new Set(dayBookings.map((b) => b.examId)).size)}
          </span>
        )}
      </div>

      {clashCount > 0 && (
        <p role="alert" className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {clashCount === 1 ? "This time clashes with another exam" : `This time clashes with ${clashCount} exams`}
        </p>
      )}

      {plan.isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
          <AlertTriangle className="h-4 w-4 shrink-0 text-signal-warn" aria-hidden="true" />
          <span className="flex-1">Couldn't load the booked times.</span>
          {/* Timed exams already get a Try again in the status card above. */}
          {isOffline && (
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={plan.refetch}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          )}
        </div>
      ) : plan.isOffline ? (
        <p className="text-sm text-ink-600">You're offline. The booked times load when you reconnect.</p>
      ) : plan.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      ) : (
        <>
          {!isOffline && (plan.visibleClasses.length > 0 || plan.proposed) && (
            <SlotTimeline plan={plan} day={selectedDay} />
          )}
          {dayBookings.length === 0 ? (
            <EmptyState
              size="sm"
              reason="noData"
              icon={<CalendarCheck2 className="h-5 w-5" />}
              title={plan.visibleClasses.length > 0 ? "Nothing booked yet" : "No classes to check"}
              description={
                plan.visibleClasses.length > 0
                  ? `No exam is booked for ${classesPhrase} on this day.`
                  : "Booked times appear here for the classes you teach."
              }
            />
          ) : (
            <BookingList plan={plan} bookings={dayBookings} isOffline={isOffline} />
          )}
          {clashCount > 0 && proposed && (
            suggestions.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-ink-600">Suggested start time</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((d) => (
                    <Button
                      key={d.getTime()}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-full px-4 tabular-nums"
                      onClick={() => onPickStart(d)}
                    >
                      {formatClock(d)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-600">
                No free time long enough is left on this day for {classesPhrase}. Try another day, or shorten
                the late entry.
              </p>
            )
          )}
          {isOffline && dayBookings.length > 0 && (
            <p className="text-xs text-ink-600">
              For reference only. A paper exam has no set time, so it never blocks these.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function BookingList({
  plan,
  bookings,
  isOffline,
}: {
  plan: ExamSlotPlan;
  bookings: ExamSlotBooking[];
  isOffline: boolean;
}) {
  const clashIds = useMemo(() => new Set(plan.clashes.map((b) => b.examId)), [plan.clashes]);
  const grouped = useMemo(() => groupByExam(bookings), [bookings]);
  return (
    <ul className="space-y-2">
      {grouped.map(({ booking: b, classIds }) => {
        const clash = !isOffline && clashIds.has(b.examId);
        return (
          <li
            key={b.examId}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3",
              clash ? "border-destructive/40 bg-destructive/5" : "border-border",
            )}
          >
            <div className="w-16 shrink-0 tabular-nums">
              <p className="text-sm font-semibold text-ink-900">{formatClock(b.start)}</p>
              <p className="text-xs text-ink-500">to {formatClockWithDayOffset(b.occupiedUntil, b.start)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">{b.subjectNames || "Exam"}</p>
              <p className="line-clamp-2 break-words text-xs text-ink-600">
                {joinNames(classIds.map(plan.classLabel))}
                {" · "}
                {b.isOwn ? (b.title ? `Your exam: ${b.title}` : "Your exam") : b.teacherName || "Another teacher"}
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "h-6 shrink-0 px-2 text-[11px]",
                clash && "border-destructive/40 text-destructive",
              )}
            >
              {clash ? "Clash" : b.runsAlongside ? "Alongside" : b.mode === "hybrid" ? "Hybrid" : "Online"}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------- Date field ---------------------------- */

/**
 * The exam date, picked from the app's own calendar rather than the browser's
 * native one, which cannot carry marks: every day that already has an exam for
 * the selected sections shows a dot per exam (up to 3). Unknown counts
 * (loading, offline, a failed read) show no dots and say so, so a failed read
 * never makes a busy day look free (CLAUDE.md §6).
 */
function ExamDateField({
  plan,
  classesPhrase,
  onDateChange,
}: {
  plan: ExamSlotPlan;
  classesPhrase: string;
  onDateChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = plan.selectedDay ?? undefined;
  const { bookedDayCounts: counts, calendarUnknown: unknown, setCalendarMonth } = plan;

  // One components object per change of marks, so DayPicker does not remount
  // every cell on each render. The calendar wrapper's nav icons are passed
  // again because `components` replaces its whole object.
  const components = useMemo(
    () => ({
      IconLeft: () => <ChevronLeft className="h-4 w-4" />,
      IconRight: () => <ChevronRight className="h-4 w-4" />,
      DayContent: (props: DayContentProps) => (
        <BookedDayContent {...props} count={unknown ? 0 : counts.get(localDayKey(props.date)) ?? 0} />
      ),
    }),
    [counts, unknown],
  );

  const pick = (key: string) => {
    onDateChange(key);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Open on the chosen day's month, not wherever it was last browsed.
        if (next) setCalendarMonth(plan.selectedDay ?? plan.now);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id="exam-schedule-date"
          type="button"
          variant="outline"
          className={cn("min-h-[44px] w-full justify-between rounded-md px-3 font-normal", FIELD_FILL)}
        >
          <span className={selected ? "text-ink-900" : "text-ink-500"}>
            {selected ? format(selected, "EEE, d MMM yyyy") : "Pick a date"}
          </span>
          <CalendarIcon className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          month={plan.calendarMonth}
          onMonthChange={setCalendarMonth}
          onSelect={(d) => {
            if (d) pick(localDayKey(d));
          }}
          components={components}
          // Today as a quiet teal outline: the default warm fill read like a
          // booked-day mark next to the dots.
          classNames={{ day_today: "border border-brand-primary/40 font-semibold text-brand-primary" }}
          initialFocus
        />
        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          {/* w-0 + flex-1: the legend wraps inside the calendar's width instead
              of widening the popover past a 375px screen. */}
          <p className="flex w-0 flex-1 items-start gap-1.5 text-xs text-ink-600">
            {plan.calendarError ? (
              "Couldn't load booked days."
            ) : unknown ? (
              "Loading booked days..."
            ) : (
              <>
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-warn" aria-hidden="true" />
                <span className="line-clamp-2">Exam already booked for {classesPhrase}</span>
              </>
            )}
          </p>
          <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => pick(localDayKey(plan.now))}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A calendar day: the date, and a dot per exam already booked (up to 3). */
function BookedDayContent({ date, activeModifiers, count }: DayContentProps & { count: number }) {
  return (
    <span className="flex flex-col items-center leading-none">
      <span>{date.getDate()}</span>
      <span className="mt-0.5 flex h-1.5 items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: Math.min(count, 3) }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              activeModifiers.selected ? "bg-primary-foreground" : "bg-signal-warn",
            )}
          />
        ))}
      </span>
      {count > 0 && <span className="sr-only">, {countLabel(count)}</span>}
    </span>
  );
}

/* ----------------------------- Timeline ----------------------------- */

const LANE_HEIGHT = 28;
const TICK_AREA = 16;

/**
 * One lane per section the caller can see, busy blocks drawn from the
 * bookings, and the exam being scheduled as a band across every lane. SVG
 * rather than positioned divs so block geometry lives in attributes, not
 * inline styles. Purely visual: the list below carries the same facts in text.
 */
function SlotTimeline({ plan, day }: { plan: ExamSlotPlan; day: Date }) {
  const dayEnd = addDays(day, 1);
  const lanes = plan.visibleClasses.length > 0 ? plan.visibleClasses.map((c) => c.class_id) : [];
  const proposed = plan.proposed;
  const clashIds = new Set(plan.clashes.map((b) => b.examId));
  const onDay = (s: Date, e: Date) => intervalsOverlap({ start: s, end: e }, { start: day, end: dayEnd });

  // Fit the axis to what is on it, never narrower than 08:00 to 18:00.
  const hours: number[] = [];
  const pushHours = (s: Date, e: Date) => {
    if (!onDay(s, e)) return;
    hours.push(Math.max(0, (s.getTime() - day.getTime()) / 3_600_000));
    hours.push(Math.min(24, (e.getTime() - day.getTime()) / 3_600_000));
  };
  plan.dayBookings.forEach((b) => pushHours(b.start, b.occupiedUntil));
  if (proposed) pushHours(proposed.start, proposed.occupiedUntil);
  const startHour = Math.max(0, Math.min(8, Math.floor(Math.min(...hours, 8))));
  const endHour = Math.min(24, Math.max(18, Math.ceil(Math.max(...hours, 18))));
  const span = endHour - startHour;
  const tickStep = span > 12 ? 3 : 2;

  const pct = (t: Date) => {
    const h = (t.getTime() - day.getTime()) / 3_600_000;
    return Math.min(100, Math.max(0, ((h - startHour) / span) * 100));
  };

  const laneCount = Math.max(1, lanes.length);
  const height = laneCount * LANE_HEIGHT + TICK_AREA;
  const ticks: number[] = [];
  for (let h = Math.ceil(startHour / tickStep) * tickStep; h <= endHour; h += tickStep) ticks.push(h);

  const nowOnDay = plan.now.getTime() >= day.getTime() && plan.now.getTime() < dayEnd.getTime();
  const proposedClash = plan.clashes.length > 0;
  const summary = `Timeline for ${format(day, "EEE d MMM")}: ${countLabel(
    new Set(plan.dayBookings.map((b) => b.examId)).size,
  )}${
    proposed && onDay(proposed.start, proposed.occupiedUntil)
      ? `, your exam ${formatClock(proposed.start)} to ${formatClockWithDayOffset(proposed.occupiedUntil, proposed.start)}${proposedClash ? ", clashes" : ""}`
      : ""
  }.`;

  return (
    <div className="flex gap-2">
      {lanes.length > 1 && (
        <div className="w-12 shrink-0" aria-hidden="true">
          {lanes.map((id) => (
            <div key={id} className="flex h-7 items-center truncate text-[11px] text-ink-600">
              {shortLabel(plan.classLabel(id))}
            </div>
          ))}
        </div>
      )}
      <svg
        role="img"
        aria-label={summary}
        width="100%"
        height={height}
        className="min-w-0 flex-1 overflow-visible"
      >
        {Array.from({ length: laneCount }, (_, i) => (
          <rect
            key={`lane-${i}`}
            x="0"
            y={i * LANE_HEIGHT + 2}
            width="100%"
            height={LANE_HEIGHT - 4}
            rx="6"
            className="fill-[hsl(var(--status-open)/0.08)]"
          />
        ))}

        {ticks.map((h) => (
          <line
            key={`tick-${h}`}
            x1={`${((h - startHour) / span) * 100}%`}
            x2={`${((h - startHour) / span) * 100}%`}
            y1="0"
            y2={laneCount * LANE_HEIGHT}
            className="stroke-[hsl(var(--status-open)/0.18)]"
            strokeWidth="1"
          />
        ))}

        {lanes.map((classId, i) => {
          const own = plan.dayBookings.filter((b) => b.classId === classId);
          const alongside = own.filter((b) => b.runsAlongside);
          const blocking = own.filter((b) => !b.runsAlongside);
          const clashing = blocking.filter((b) => clashIds.has(b.examId));
          const quiet = mergeIntervals(
            blocking.filter((b) => !clashIds.has(b.examId)).map((b) => ({ start: b.start, end: b.occupiedUntil })),
          );
          const y = i * LANE_HEIGHT + 5;
          const h = LANE_HEIGHT - 10;
          return (
            <g key={classId}>
              {alongside.map((b) => (
                <rect
                  key={`a-${b.examId}`}
                  x={`${pct(b.start)}%`}
                  y={y}
                  width={`${Math.max(0.8, pct(b.occupiedUntil) - pct(b.start))}%`}
                  height={h}
                  rx="4"
                  strokeDasharray="3 2"
                  className="fill-[hsl(var(--status-open)/0.1)] stroke-[hsl(var(--status-open)/0.6)]"
                />
              ))}
              {quiet.map((b) => (
                <rect
                  key={`q-${b.start.getTime()}`}
                  x={`${pct(b.start)}%`}
                  y={y}
                  width={`${Math.max(0.8, pct(b.end) - pct(b.start))}%`}
                  height={h}
                  rx="4"
                  className="fill-[hsl(var(--status-open)/0.32)] stroke-[hsl(var(--status-open)/0.6)]"
                />
              ))}
              {clashing.map((b) => (
                <rect
                  key={`c-${b.examId}`}
                  x={`${pct(b.start)}%`}
                  y={y}
                  width={`${Math.max(0.8, pct(b.occupiedUntil) - pct(b.start))}%`}
                  height={h}
                  rx="4"
                  className="fill-destructive/25 stroke-destructive"
                />
              ))}
            </g>
          );
        })}

        {proposed && onDay(proposed.start, proposed.occupiedUntil) && (
          <rect
            x={`${pct(proposed.start)}%`}
            y="1"
            width={`${Math.max(0.8, pct(proposed.occupiedUntil) - pct(proposed.start))}%`}
            height={laneCount * LANE_HEIGHT - 2}
            rx="6"
            strokeWidth="2"
            strokeDasharray={proposedClash ? "4 3" : undefined}
            className={
              proposedClash
                ? "fill-destructive/10 stroke-destructive"
                : "fill-brand-primary/15 stroke-brand-primary"
            }
          />
        )}

        {nowOnDay && (
          <line
            x1={`${pct(plan.now)}%`}
            x2={`${pct(plan.now)}%`}
            y1="0"
            y2={laneCount * LANE_HEIGHT}
            strokeWidth="1.5"
            strokeDasharray="2 2"
            className="stroke-ink-500"
          />
        )}

        {ticks.map((h, i) => (
          <text
            key={`label-${h}`}
            x={`${((h - startHour) / span) * 100}%`}
            y={laneCount * LANE_HEIGHT + 12}
            textAnchor={i === 0 && h === startHour ? "start" : h === endHour ? "end" : "middle"}
            className="fill-ink-500 text-[10px] tabular-nums"
          >
            {String(h % 24).padStart(2, "0")}:00
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ----------------------------- Pieces ----------------------------- */

function StatusCard({
  tone,
  title,
  children,
}: {
  tone: "danger" | "warn";
  title: string;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <div
      role={danger ? "alert" : "status"}
      className={cn(
        "space-y-2 rounded-lg border p-3",
        danger ? "border-destructive/40 bg-destructive/5" : "border-signal-warn/30 bg-signal-warn/10",
      )}
    >
      <div className="flex items-center gap-2">
        {danger ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-signal-warn" aria-hidden="true" />
        )}
        <p className={cn("text-sm font-semibold", danger ? "text-destructive" : "text-ink-900")}>{title}</p>
      </div>
      {children}
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "info";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs",
        tone === "warn" ? "border-signal-warn/30 bg-signal-warn/10 text-ink-900" : "border-border text-ink-600",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone === "warn" ? "text-signal-warn" : "text-ink-500")} aria-hidden="true">
        {icon ?? <AlertTriangle className="h-4 w-4" />}
      </span>
      <p>{children}</p>
    </div>
  );
}

/* ----------------------------- Helpers ----------------------------- */

function groupByExam(bookings: ExamSlotBooking[]): { booking: ExamSlotBooking; classIds: string[] }[] {
  const byExam = new Map<string, { booking: ExamSlotBooking; classIds: string[] }>();
  for (const b of bookings) {
    const g = byExam.get(b.examId);
    if (g) {
      if (!g.classIds.includes(b.classId)) g.classIds.push(b.classId);
    } else {
      byExam.set(b.examId, { booking: b, classIds: [b.classId] });
    }
  }
  return Array.from(byExam.values()).sort((a, b) => a.booking.start.getTime() - b.booking.start.getTime());
}

function joinNames(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function countLabel(n: number): string {
  return n === 1 ? "1 exam booked" : `${n} exams booked`;
}

/** "Class 10 - A" -> "10 A" for the narrow lane label column. */
function shortLabel(label: string): string {
  return label.replace(/^class\s+/i, "").replace(/\s+-\s+/, " ");
}
