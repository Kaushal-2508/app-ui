import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookMarked,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Inbox,
  NotebookPen,
  PauseCircle,
  UserCheck,
  XCircle,
} from "lucide-react";
import { addDays, format, getDaysInMonth, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  useTeacherWeekV2,
  useTeacherTimetableStatusV2,
  useTeacherPlansForWeek,
  useTeacherMonthLessonPlanCount,
  useMyCovers,
  type LessonPlanStatus,
  type LessonPlanRow,
  type LessonPlanWeekRow,
  type MyCoverRow,
  type TeacherWeekSlot,
  type Weekday,
} from "@/hooks/useTimetableV2";
import LessonPlanDialogV2 from "@/components/timetable-v2/LessonPlanDialogV2";
import { useTeacherPendingSyllabusDays, useTeacherProjection } from "@/hooks/useSyllabusProgress";
import { CheckInBacklogSheet } from "@/components/lesson-completion/CheckInBacklogSheet";

// --------------------------------------------------------------
// TeacherMyWeekPageV2 — week-window timetable for the teacher.
//
// Layout matches the wireframe:
//   * Header  : "Timetable" + month picker + plans-this-month progress.
//   * Toolbar : ← / → navigates the visible 7-day window by 1 week.
//   * Body    : one card per date; each card shows that day's periods
//               inline (subject / class / status). Tap a period to plan
//               or edit the lesson — the LessonPlanDialog upserts so
//               edits to a saved plan are first-class.
// --------------------------------------------------------------

const JS_DAY_TO_WEEKDAY: Weekday[] = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];

// One colour per period state, light + dark. Empty is neutral grey, the same
// as a past Empty in LOG_VISUAL below: rose belongs to "Not logged", the one
// state that asks the teacher to act. Planned is a calm blue.
const STATUS_VISUAL: Record<LessonPlanStatus, {
  label: string;
  icon: typeof CheckCircle2;
  badge: string;
}> = {
  planned: {
    label: "Planned",
    icon: CalendarCheck,
    badge: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  },
  done: {
    label: "Done",
    icon: CheckCircle2,
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  },
  pending: {
    label: "Pending",
    icon: PauseCircle,
    badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  },
  skipped: {
    label: "Skipped",
    icon: XCircle,
    badge: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30",
  },
};
const EMPTY_BADGE =
  "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/30";
const NOTE_ONLY_BADGE =
  "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30";

/**
 * What was actually recorded for a period that has happened, read from the
 * syllabus log. The lesson-plan row only says what was intended: partial logs
 * never touch it, and a Completed log flips only ONE period of the day, so on
 * past days it kept saying "Planned" for periods that were taught.
 * `unknown` = the log has not loaded (or failed), so claim nothing.
 */
type PeriodLog = "done" | "partial" | "note" | "unlogged" | "empty" | "planned" | "unknown";

/**
 * The two-timeline syllabus log went live on 2026-07-04 (migration
 * 20260704140000). From then on the log, not a plan row's status, is what says
 * a period was taught.
 */
const SYLLABUS_LOG_SINCE = "2026-07-04";

const LOG_VISUAL: Record<Exclude<PeriodLog, "unknown">, {
  label: string;
  icon: typeof CheckCircle2;
  badge: string;
}> = {
  done: {
    label: "Done",
    icon: CheckCircle2,
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  },
  partial: {
    label: "Partial",
    icon: CircleDot,
    badge: "bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-400/10 dark:text-yellow-200 dark:border-yellow-400/30",
  },
  note: {
    label: "Logged",
    icon: NotebookPen,
    badge: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
  },
  unlogged: {
    label: "Not logged",
    icon: AlertTriangle,
    badge: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  },
  empty: {
    label: "Empty",
    icon: Inbox,
    badge: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/30",
  },
  // A plan row that claims "done" before anything is logged is still a plan.
  // Same look as STATUS_VISUAL.planned: to the teacher it IS a plan.
  planned: {
    label: "Planned",
    icon: CalendarCheck,
    badge: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
  },
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHM(t: string): string {
  return t.slice(0, 5);
}

export default function TeacherMyWeekPageV2() {
  const academicYear = currentAcademicYear();
  const statusQuery = useTeacherTimetableStatusV2(academicYear);
  const ready = statusQuery.data?.status === "ready";
  const weekQuery = useTeacherWeekV2(ready ? academicYear : "");

  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUid(data.user?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  // ---- Week-of-the-month state ----
  // The window is anchored to the 1st of the month, not Monday. Pages
  // step in fixed 7-day blocks: 1–7, 8–14, 15–21, 22–28, 29-end. Pressing
  // Next at the last block of a month rolls forward to day 1 of the next
  // month; Prev at block 1 rolls back to the last block of the previous
  // month. The month picker is the explicit jump.
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [weekStartDay, setWeekStartDay] = useState<number>(() => {
    const today = new Date();
    return Math.floor((today.getDate() - 1) / 7) * 7 + 1;
  });

  const daysInMonth = useMemo(() => getDaysInMonth(monthAnchor), [monthAnchor]);
  // Boundaries of valid week-start days for the current month: always 1,
  // 8, 15, 22, plus the last 7-day block whose first day is ≤ daysInMonth.
  const lastWeekStartDay = useMemo(() => {
    // 1, 8, 15, 22, 29 are all valid as long as they're ≤ daysInMonth.
    if (daysInMonth >= 29) return 29;
    if (daysInMonth >= 22) return 22;
    if (daysInMonth >= 15) return 15;
    if (daysInMonth >= 8) return 8;
    return 1;
  }, [daysInMonth]);

  // Build the visible day list — bounded by the month, so the last block
  // can be a partial week (e.g. May 29–31).
  const weekDates = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = weekStartDay + i;
      if (day > daysInMonth) break;
      out.push(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day));
    }
    return out;
  }, [monthAnchor, weekStartDay, daysInMonth]);
  const weekIsos = useMemo(() => weekDates.map(isoDate), [weekDates]);

  // ---- Slots & plans ----
  const slots = useMemo(() => weekQuery.data ?? [], [weekQuery.data]);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const slotsByDay = useMemo(() => {
    const m = new Map<Weekday, TeacherWeekSlot[]>();
    for (const s of slots) {
      if (s.period_kind !== "period") continue;
      if (!m.has(s.day)) m.set(s.day, []);
      m.get(s.day)!.push(s);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return m;
  }, [slots]);

  const plansQuery = useTeacherPlansForWeek(slotIds, weekIsos);
  const plans = useMemo(() => plansQuery.data ?? new Map<string, LessonPlanWeekRow>(), [plansQuery.data]);

  const monthCountQuery = useTeacherMonthLessonPlanCount(
    slotIds,
    monthAnchor.getFullYear(),
    monthAnchor.getMonth(),
    uid,
  );
  const totalPeriodsThisMonth = useMemo(() => {
    if (slotsByDay.size === 0) return 0;
    const start = startOfMonth(monthAnchor);
    const end = endOfMonth(monthAnchor);
    let total = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const wd = JS_DAY_TO_WEEKDAY[d.getDay()];
      total += slotsByDay.get(wd)?.length ?? 0;
    }
    return total;
  }, [monthAnchor, slotsByDay]);
  const plansThisMonth = monthCountQuery.data ?? 0;

  // Months to show in the dropdown — span the academic year so the user
  // can jump to any month without scrolling outside.
  const monthOptions = useMemo(() => {
    const [startYearStr] = academicYear.split("-");
    const startYear = parseInt(startYearStr, 10);
    const out: Date[] = [];
    // April of startYear → March of startYear+1
    for (let i = 0; i < 12; i++) {
      out.push(new Date(startYear, 3 + i, 1));
    }
    return out;
  }, [academicYear]);

  // ---- Plan dialog target ----
  const [planTarget, setPlanTarget] = useState<{ slot: TeacherWeekSlot; date: string } | null>(null);

  // Passive backlog reminder — the non-blocking counterpart of the check-in popup.
  const pendingSyllabus = useTeacherPendingSyllabusDays({ includeToday: false });
  const backlogCount = pendingSyllabus.data?.unresolved_day_count ?? 0;
  const [backlogOpen, setBacklogOpen] = useState(false);

  // Auto-timeline for the visible window: projected chapters per period +
  // actual entries for past days. One call, cached 60s.
  const projFrom = weekIsos[0] ?? "";
  const projTo = weekIsos[weekIsos.length - 1] ?? "";
  const projection = useTeacherProjection({
    fromIso: projFrom, toIso: projTo, enabled: !!projFrom && !!projTo,
  });
  // Device-local today for the past/future split — IST-only deployment, same
  // convention as isPastCutoff (see CLAUDE.md §24 note).
  const todayIso = isoDate(new Date());
  const projBySlotDate = useMemo(() => {
    const m = new Map<string, { topic_id: string; topic_name: string; chapter_ord: number }>();
    for (const p of projection.data?.projected ?? []) {
      m.set(`${p.slot_id}|${p.date}`, { topic_id: p.topic_id, topic_name: p.topic_name, chapter_ord: p.chapter_ord });
    }
    return m;
  }, [projection.data]);
  const actualByGroupDate = useMemo(() => {
    const m = new Map<string, { topic_name: string; action: string }[]>();
    for (const a of projection.data?.actual ?? []) {
      const k = `${a.class_id}|${a.subject_id}|${a.date}`;
      const list = m.get(k) ?? [];
      list.push({ topic_name: a.topic_name, action: a.action });
      m.set(k, list);
    }
    return m;
  }, [projection.data]);

  // A note on one period resolves its whole (class, subject, day) group, the
  // same rule teacher_pending_syllabus_days applies, so a second period of that
  // class on that day reads as logged too.
  const noteGroups = useMemo(() => {
    const s = new Set<string>();
    for (const p of plans.values()) {
      if (p.is_note_only && p.subject_id) s.add(`${p.class_id}|${p.subject_id}|${p.date}`);
    }
    return s;
  }, [plans]);

  // The server's own list of unlogged groups, the one the "N days unlogged"
  // button counts. "Not logged" comes only from here, never from "nothing
  // found", so a holiday, an exam block or a subject with no chapters does not
  // read as a missed log, and the chips agree with the button.
  const unloggedGroups = useMemo(() => {
    const s = new Set<string>();
    for (const d of pendingSyllabus.data?.days ?? []) {
      for (const g of d.groups) {
        if (!g.filled) s.add(`${g.class_id}|${g.subject_id}|${d.date}`);
      }
    }
    return s;
  }, [pendingSyllabus.data]);

  const logsReady = projection.isSuccess && plansQuery.isSuccess;
  const logsFailed = projection.isError || plansQuery.isError;

  /**
   * The badge for a period that has happened (or today, once logged): what the
   * syllabus log says, not the lesson-plan row. `null` = keep the plan badge,
   * which is all there is before a period happens.
   */
  function periodLogFor(slot: TeacherWeekSlot, dayIso: string, plan: LessonPlanRow | null): PeriodLog | null {
    // No subject, nothing to log: the plan row reads as it is.
    if (!slot.subject_id) return null;
    if (plan?.is_note_only) return "note";
    // ONLY the syllabus log can say a period was taught. A plan row's own
    // "done" is never shown for a day that is not over (2 such rows existed on
    // 2026-09-29, both for that day, with nothing logged).
    const planOnly: PeriodLog | null = plan?.status === "done" ? "planned" : null;
    if (dayIso > todayIso) return planOnly;
    const isPast = dayIso < todayIso;
    if (!logsReady) return isPast ? "unknown" : planOnly;
    const key = `${slot.class_id}|${slot.subject_id}|${dayIso}`;
    const entries = actualByGroupDate.get(key);
    if (entries && entries.length > 0) {
      return entries.some((e) => e.action === "completed") ? "done" : "partial";
    }
    if (noteGroups.has(key)) return "note";
    // Today is not over: until something is logged, the plan is what there is.
    if (!isPast) return planOnly;
    // The server's unlogged list outranks the plan row. A plan row can say
    // "done" with nothing logged: 148 did on 2026-09-29, mostly notes turned
    // back into teaching rows that kept the note's status. Showing "Done" for
    // those put a Done card next to a Not logged card for the same class and day.
    if (unloggedGroups.has(key)) return "unlogged";
    // Before the syllabus log existed a period was closed on the plan row
    // itself, and those rows are the only record of that teaching.
    if (dayIso < SYLLABUS_LOG_SINCE && (plan?.status === "done" || plan?.status === "skipped")) return null;
    return "empty";
  }

  // Covers for the visible window. Date-specific, so they sit on the day card
  // for that date only, never on the recurring weekday grid.
  const coversQuery = useMyCovers(projFrom, projTo);
  const { coveringByDate, coveredByKey } = useMemo(() => {
    const covering = new Map<string, MyCoverRow[]>();
    const covered = new Map<string, string | null>();
    for (const c of coversQuery.data ?? []) {
      if (c.cover_role === "covering") {
        const list = covering.get(c.cover_date) ?? [];
        list.push(c);
        covering.set(c.cover_date, list);
      } else {
        covered.set(`${c.slot_id}|${c.cover_date}`, c.other_teacher_name);
      }
    }
    return { coveringByDate: covering, coveredByKey: covered };
  }, [coversQuery.data]);

  function shiftWeek(direction: 1 | -1) {
    if (direction === -1) {
      if (weekStartDay > 1) {
        setWeekStartDay((d) => Math.max(1, d - 7));
        return;
      }
      // Rolling back from week 1: jump to the last block of the previous month.
      const prevMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1);
      const prevDays = getDaysInMonth(prevMonth);
      const prevLastStart =
        prevDays >= 29 ? 29 : prevDays >= 22 ? 22 : prevDays >= 15 ? 15 : prevDays >= 8 ? 8 : 1;
      setMonthAnchor(prevMonth);
      setWeekStartDay(prevLastStart);
      return;
    }
    if (weekStartDay < lastWeekStartDay) {
      setWeekStartDay((d) => Math.min(lastWeekStartDay, d + 7));
      return;
    }
    // Rolling forward from the last block: jump to day 1 of the next month.
    const nextMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
    setMonthAnchor(nextMonth);
    setWeekStartDay(1);
  }

  function handleMonthChange(value: string) {
    const picked = monthOptions.find((d) => isoDate(d) === value);
    if (!picked) return;
    setMonthAnchor(picked);
    // New month always starts on day 1 — explicit jump, no smart sync.
    setWeekStartDay(1);
  }

  // Render --------------------------------------------------------
  if (statusQuery.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // An errored query must never fall through to a blocked state: telling a
  // teacher "you have no classes" when the request merely failed sends them
  // to chase an assignment they already hold.
  if (statusQuery.isError || !statusQuery.data) {
    return <BlockedStateScreen academicYear={academicYear} status="load-failed" />;
  }

  if (statusQuery.data.status !== "ready") {
    return <BlockedStateScreen academicYear={academicYear} status={statusQuery.data.status} />;
  }

  const monthLabel = format(monthAnchor, "MMM yyyy");
  const weekRangeLabel = weekDates.length > 0
    ? `${format(weekDates[0], "MMM d")} – ${format(weekDates[weekDates.length - 1], "MMM d, yyyy")}`
    : monthLabel;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 text-white shadow-sm">
              <CalendarClock className="h-4 w-4" />
            </div>
            Timetable
          </h1>
          <p className="text-muted-foreground text-sm">
            Tap any period to plan or edit the lesson.
          </p>
        </div>

        {/* flex-wrap: four controls do not fit one row at 375px. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/teacher/my-syllabus">
              <BookMarked className="h-4 w-4 mr-1" />
              My syllabus
            </Link>
          </Button>
          {backlogCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              onClick={() => setBacklogOpen(true)}
            >
              {backlogCount} day{backlogCount === 1 ? "" : "s"} unlogged
            </Button>
          )}
          <Select value={isoDate(monthAnchor)} onValueChange={handleMonthChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((d) => (
                <SelectItem key={isoDate(d)} value={isoDate(d)}>
                  {format(d, "MMM yyyy")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge
            variant="outline"
            className="px-2.5 py-1 text-xs bg-primary/5 text-primary border-primary/20 font-semibold tabular-nums"
            title={`${plansThisMonth} lesson plan${plansThisMonth === 1 ? "" : "s"} saved out of ${totalPeriodsThisMonth} periods this ${monthLabel}`}
          >
            {plansThisMonth} / {totalPeriodsThisMonth}
          </Badge>
        </div>
      </div>

      {/* Week navigator */}
      <Card>
        <CardContent className="p-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <div className="text-sm font-medium text-center">{weekRangeLabel}</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      {/* Covers are additive: a failure here must not hide the teacher's own
          periods, but it must not read as "no covers" either (CLAUDE.md §6). */}
      {coversQuery.isError && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm dark:border-rose-500/20 dark:bg-rose-500/10">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" />
          <span className="flex-1 text-ink-700 dark:text-ink-300">
            {"Couldn't load the periods you are covering this week."}
          </span>
          <Button variant="outline" size="sm" onClick={() => void coversQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {/* Past-period badges come from these two reads. A failure must not read
          as "nothing was logged" (CLAUDE.md §6), so the badges stay blank and
          this says why. */}
      {logsFailed && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm dark:border-rose-500/20 dark:bg-rose-500/10">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" />
          <span className="flex-1 text-ink-700 dark:text-ink-300">
            {"Couldn't load what was logged this week, so past periods show no status."}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (projection.isError) void projection.refetch();
              if (plansQuery.isError) void plansQuery.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {/* Day cards */}
      <div className="space-y-3">
        {weekDates.map((date, idx) => {
          const wd = JS_DAY_TO_WEEKDAY[date.getDay()];
          const dayIso = weekIsos[idx];
          const daySlots = slotsByDay.get(wd) ?? [];
          return (
            <DayCard
              key={dayIso}
              date={date}
              dayIso={dayIso}
              slots={daySlots}
              covers={coveringByDate.get(dayIso) ?? []}
              coveredByFor={(slot) => coveredByKey.get(`${slot.id}|${dayIso}`)}
              plans={plans}
              onPickSlot={(slot) => setPlanTarget({ slot, date: dayIso })}
              logFor={(slot, plan) => periodLogFor(slot, dayIso, plan)}
              chapterLineFor={(slot) => {
                // What was logged wins whenever there is any, today included
                // (check-out logs today). Otherwise, today and later: the
                // chapter the teacher planned for this period, else the
                // projected one (arrowed, so it reads as a recommendation).
                const entries = dayIso <= todayIso
                  ? actualByGroupDate.get(`${slot.class_id}|${slot.subject_id}|${dayIso}`)
                  : undefined;
                if (entries && entries.length > 0) {
                  const first = entries[0];
                  const mark = first.action === "completed" ? "✓" : "◐";
                  return entries.length > 1
                    ? `${mark} ${first.topic_name} +${entries.length - 1}`
                    : `${mark} ${first.topic_name}`;
                }
                if (dayIso >= todayIso) {
                  // Past days never read the plan row's chapter: it may be one
                  // that was never taught, or one whose log was deleted
                  // (delete_syllabus_progress reverts the row to planned and
                  // keeps topic_id).
                  const planned = plans.get(`${slot.id}|${dayIso}|${slot.subject_id ?? ""}`);
                  if (planned && planned.status === "planned" && !planned.is_note_only && planned.topic_name) {
                    return planned.topic_name;
                  }
                  const p = projBySlotDate.get(`${slot.id}|${dayIso}`);
                  return p ? `→ ${p.topic_name}` : null;
                }
                return null;
              }}
            />
          );
        })}
      </div>

      {planTarget && uid && (
        <LessonPlanDialogV2
          open
          onOpenChange={(o) => {
            if (!o) setPlanTarget(null);
          }}
          slot={planTarget.slot}
          ownerTeacherId={uid}
          classIdFallback={planTarget.slot.class_id}
          subjectIdFallback={planTarget.slot.subject_id}
          // Pre-seed the dialog's date to the cell the teacher tapped so
          // they don't have to re-pick. Edit-after-submit is implicit:
          // the dialog upserts on (slot_id, date), so opening a tapped
          // cell that already has a plan loads it for editing.
          initialDate={planTarget.date}
          todayIso={todayIso}
          projectionByDate={(() => {
            const m = new Map<string, { topic_id: string; topic_name: string; chapter_ord: number }>();
            for (const p of projection.data?.projected ?? []) {
              if (p.slot_id === planTarget.slot.id) {
                m.set(p.date, { topic_id: p.topic_id, topic_name: p.topic_name, chapter_ord: p.chapter_ord });
              }
            }
            return m;
          })()}
          overflowCount={
            projection.data?.overflow.find(
              (o) => o.class_id === planTarget.slot.class_id && o.subject_id === planTarget.slot.subject_id,
            )?.unscheduled ?? 0
          }
        />
      )}

      <CheckInBacklogSheet open={backlogOpen} onOpenChange={setBacklogOpen} />
    </div>
  );
}

// --------------------------------------------------------------
// DayCard — one date's strip of period chips. Empty days collapse
// into a quiet "No periods today" state instead of an empty card.
// --------------------------------------------------------------
function DayCard({
  date,
  dayIso,
  slots,
  covers,
  coveredByFor,
  plans,
  onPickSlot,
  logFor,
  chapterLineFor,
}: {
  date: Date;
  dayIso: string;
  slots: TeacherWeekSlot[];
  /** Other teachers' periods this teacher covers on this exact date. */
  covers: MyCoverRow[];
  /** Name of whoever covers one of this teacher's own periods on this date. */
  coveredByFor: (slot: TeacherWeekSlot) => string | null | undefined;
  plans: Map<string, LessonPlanWeekRow>;
  onPickSlot: (slot: TeacherWeekSlot) => void;
  logFor: (slot: TeacherWeekSlot, plan: LessonPlanRow | null) => PeriodLog | null;
  chapterLineFor: (slot: TeacherWeekSlot) => string | null;
}) {
  const dateLabel = format(date, "EEE, dd MMM");
  // One strip in time order: own periods and covers interleaved.
  const items = [
    ...slots.map((s) => ({ kind: "own" as const, start: s.start_time, slot: s })),
    ...covers.map((c) => ({ kind: "cover" as const, start: c.start_time, cover: c })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const count = items.length;
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{dateLabel}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {count} period{count === 1 ? "" : "s"}
            {covers.length > 0 && ` · ${covers.length} cover${covers.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {count === 0 ? (
          <div className="text-xs text-muted-foreground italic px-1 py-2">
            No periods today.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            {items.map((it) => {
              if (it.kind === "cover") {
                return <CoverChip key={`cover-${it.cover.substitution_id}`} cover={it.cover} />;
              }
              const plan = plans.get(`${it.slot.id}|${dayIso}|${it.slot.subject_id ?? ""}`) ?? null;
              return (
                <PeriodChip
                  key={it.slot.id}
                  slot={it.slot}
                  plan={plan}
                  log={logFor(it.slot, plan)}
                  onClick={() => onPickSlot(it.slot)}
                  line={chapterLineFor(it.slot)}
                  coveredBy={coveredByFor(it.slot)}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------
// CoverChip - a period this teacher covers for a colleague on one date.
// Not tappable: the lesson plan belongs to the teacher whose period it is.
// --------------------------------------------------------------
function CoverChip({ cover }: { cover: MyCoverRow }) {
  const classLabel = cover.class_section
    ? `${cover.class_name} – ${cover.class_section}`
    : cover.class_name;
  const forLine = cover.other_teacher_name ? `Covering for ${cover.other_teacher_name}` : "Covering";
  return (
    <div
      className={cn(
        "shrink-0 min-w-[180px] max-w-[220px] text-left rounded-lg border p-3",
        "border-purple-200 bg-purple-50/60 dark:border-purple-500/30 dark:bg-purple-500/10",
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
        <span className="truncate">{cover.period_label}</span>
        <span className="tabular-nums">
          {formatHM(cover.start_time)}–{formatHM(cover.end_time)}
        </span>
      </div>
      <div className="font-semibold text-sm truncate">{cover.subject_name ?? "Cover period"}</div>
      <div className="text-xs text-muted-foreground truncate">{classLabel}</div>
      <div
        className="text-[10px] truncate text-purple-700 dark:text-purple-300"
        title={cover.reason ? `${forLine} · ${cover.reason}` : forLine}
      >
        {forLine}
      </div>
      <div className="mt-2">
        <Badge
          variant="outline"
          className="gap-1 text-[10px] py-0 h-5 font-medium border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-500/40 dark:bg-purple-500/20 dark:text-purple-200"
        >
          <UserCheck className="h-2.5 w-2.5" />
          Cover
        </Badge>
      </div>
    </div>
  );
}

// --------------------------------------------------------------
// PeriodChip — compact card per period. Shows subject/class/time
// and a status pill that reflects the lesson plan (or "Empty").
// --------------------------------------------------------------
function PeriodChip({
  slot,
  plan,
  log,
  onClick,
  line,
  coveredBy,
}: {
  slot: TeacherWeekSlot;
  plan: LessonPlanWeekRow | null;
  /** What was recorded for this period; `null` = show the plan status. */
  log: PeriodLog | null;
  onClick: () => void;
  line?: string | null;
  /** Set when a colleague covers this period on this date (null = name unknown). */
  coveredBy?: string | null;
}) {
  const classLabel = slot.class_section
    ? `${slot.class_name} – ${slot.class_section}`
    : slot.class_name;
  const subjectLabel =
    slot.slot_type === "other"
      ? (slot.custom_label ?? "Other")
      : (slot.subject_name ?? "Free period");
  // A note-only period is neither "Planned" nor "Done": it is a logged period
  // with no chapter. Branch before the status lookup so the chip reads honestly
  // rather than borrowing whatever status the row happens to carry.
  const isNoteOnly = plan?.is_note_only ?? false;
  const visual = plan && !isNoteOnly ? STATUS_VISUAL[plan.status] : null;
  // A period that has happened shows what was recorded; the plan badge is only
  // for periods that have not happened (or today, until something is logged).
  const logVisual = log && log !== "unknown" ? LOG_VISUAL[log] : null;
  const Icon = logVisual?.icon ?? (isNoteOnly ? NotebookPen : (visual?.icon ?? Inbox));
  const badgeClass = logVisual?.badge ?? (isNoteOnly ? NOTE_ONLY_BADGE : visual ? visual.badge : EMPTY_BADGE);
  const badgeLabel = logVisual?.label ?? (isNoteOnly ? "Logged" : visual ? visual.label : "Empty");
  // In note-only mode the teacher's own words are more useful than a projected
  // chapter they explicitly did not teach. A cover outranks both: the teacher
  // is not in that room on that date. A planned chapter arrives through `line`.
  const isCovered = coveredBy !== undefined;
  const chipLine = isCovered
    ? `Covered by ${coveredBy ?? "a colleague"}`
    : isNoteOnly ? plan?.note : line;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 min-w-[180px] max-w-[220px] text-left rounded-lg border p-3 transition-all",
        "bg-background hover:border-primary/40 hover:shadow-sm",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
        <span className="truncate">{slot.period_label}</span>
        <span className="tabular-nums">
          {formatHM(slot.start_time)}–{formatHM(slot.end_time)}
        </span>
      </div>
      <div className="font-semibold text-sm truncate">{subjectLabel}</div>
      <div className="text-xs text-muted-foreground truncate">{classLabel}</div>
      {chipLine && (
        <div
          className={cn(
            "text-[10px] truncate",
            isCovered
              ? "text-purple-700 dark:text-purple-300"
              : isNoteOnly
                ? "text-violet-700 dark:text-violet-300"
                : "text-teal-700 dark:text-teal-300",
          )}
          title={chipLine}
        >
          {chipLine}
        </div>
      )}
      {/* Unknown keeps the badge's height so nothing jumps when the log lands. */}
      <div className="mt-2 h-5">
        {log !== "unknown" && (
          <Badge
            variant="outline"
            className={cn("gap-1 text-[10px] py-0 h-5 font-medium", badgeClass)}
          >
            <Icon className="h-2.5 w-2.5" />
            {badgeLabel}
          </Badge>
        )}
      </div>
    </button>
  );
}

// --------------------------------------------------------------
// BlockedStateScreen — covers the three "not ready" states with
// the same NotificationCard shape used on other empty-state pages.
// --------------------------------------------------------------
function BlockedStateScreen({
  academicYear,
  status,
}: {
  academicYear: string;
  status:
    | "no-class-assignments"
    | "awaiting-admin"
    | "awaiting-coordinator"
    | "ready"
    | "load-failed";
}) {
  const failed = status === "load-failed";
  const copy = (() => {
    switch (status) {
      case "load-failed":
        return {
          title: "Couldn't load your timetable",
          body: "Something went wrong reaching the server, so we can't tell which classes you have. This is not a change to your assignments. Check your connection and reload the page; if it keeps happening, contact your admin.",
        };
      case "awaiting-coordinator":
        return {
          title: "Time table is yet to be approved by the coordinator",
          body: "Your school admin has set up the class timetable. The coordinator is now assigning subjects and teachers to each period. Your periods will appear here as soon as they finish.",
        };
      case "awaiting-admin":
        return {
          title: "Time table is yet to be approved by the admin",
          body: "Your school admin is still setting up the timetable for your classes. Once they publish it, your periods will show up here.",
        };
      default:
        return {
          title: "Time table is yet to be approved by the admin",
          body: `You haven't been assigned to any class for ${academicYear} yet. Once your school admin assigns you to a class, the timetable will appear here automatically.`,
        };
    }
  })();
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 text-white shadow-sm">
          <CalendarClock className="h-4 w-4" />
        </div>
        Timetable
      </h1>
      <Card className="border-dashed">
        <CardContent className="p-8 sm:p-10 text-center space-y-3">
          <div
            className={
              failed
                ? "mx-auto h-14 w-14 rounded-full bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 flex items-center justify-center"
                : "mx-auto h-14 w-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center"
            }
          >
            {failed ? <AlertTriangle className="h-7 w-7" /> : <Inbox className="h-7 w-7" />}
          </div>
          <h2 className="text-xl font-semibold">{copy.title}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{copy.body}</p>
        </CardContent>
      </Card>
    </div>
  );
}
