import { useCallback, useEffect, useMemo, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import { endOfMonth, startOfMonth, startOfWeek } from "date-fns";
import { useExamSlotBookings } from "@/hooks/useExamSlotBookings";
import {
  addDays,
  bookingsOnDay,
  findSlotClashes,
  localDayFromKey,
  localDayKey,
  parseSlotBookings,
  proposedExamSlot,
  startOfLocalDay,
  suggestFreeStarts,
  type ExamSlotBooking,
  type ExamSlotClassRow,
  type ProposedExamSlot,
} from "@/lib/examSlots";
import { formatClassName } from "@/lib/utils";
import type { ExamFormData } from "@/types/exam";

export interface ExamSlotPlan {
  /** Online/hybrid only: offline exams carry a date, not a time. */
  checksTime: boolean;
  /** No answer yet for the chosen day: loading, or waiting for the network. */
  isLoading: boolean;
  /** The chosen day's read is paused because the device is offline. */
  isOffline: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Re-reads the chosen day and returns the clashes for the current slot. */
  recheck: () => Promise<ExamSlotBooking[] | null>;
  now: Date;
  selectedKey: string;
  selectedDay: Date | null;
  /** The month the date picker shows, and its booked-day marks. */
  calendarMonth: Date;
  setCalendarMonth: (month: Date) => void;
  /** Local "YYYY-MM-DD" -> distinct exams that would block this one that day. */
  bookedDayCounts: Map<string, number>;
  /** Loading, offline or failed: the calendar marks are unknown, not "free". */
  calendarUnknown: boolean;
  calendarError: boolean;
  classLabel: (classId: string) => string;
  /** Sections the caller may see, in display order. */
  visibleClasses: ExamSlotClassRow[];
  /** Selected sections whose bookings are withheld from this caller. */
  hiddenClassLabels: string[];
  proposed: ProposedExamSlot | null;
  dayBookings: ExamSlotBooking[];
  clashes: ExamSlotBooking[];
  suggestions: Date[];
}

/**
 * The same "YYYY-MM-DD" the publish sheet's date field shows. scheduledDate is
 * stored as UTC midnight (new Date("YYYY-MM-DD")), so it is read back the same
 * way (ReviewPublishScreen), and the day it names is then built in local time.
 */
export function scheduledDateKey(date: Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}

/**
 * The days a month grid shows (6 weeks at most, Sunday first like the picker),
 * plus a day either side for exams that run across midnight: at most 44 days,
 * inside the RPC's 45-day cap.
 */
function monthGridRange(month: Date) {
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = addDays(startOfWeek(endOfMonth(month)), 7);
  return { from: addDays(gridStart, -1), to: addDays(gridEnd, 1) };
}

export function useExamSlotPlan(formData: ExamFormData, open: boolean): ExamSlotPlan {
  const { metadata, context } = formData;
  const checksTime = metadata.examMode !== "offline";
  const hasClasses = context.classIds.length > 0;

  // A slow clock: enough for "already started" and for not suggesting a start
  // in the past, without re-rendering the sheet every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [open]);

  const selectedKey = scheduledDateKey(metadata.scheduledDate);
  const selectedDay = useMemo(() => localDayFromKey(selectedKey), [selectedKey]);
  const todayKey = localDayKey(now);

  // Two reads, both from the scoped RPC:
  //   * the chosen day, a few days either side: what the clash check, the
  //     free-time chips, the timeline and the list all use. Two days back and
  //     three forward, because a late-entry window can run past a whole day.
  //   * the month the date picker is showing: only its booked-day marks.
  const dayRange = useMemo(
    () => (selectedDay ? { from: addDays(selectedDay, -2), to: addDays(selectedDay, 3) } : null),
    [selectedDay],
  );

  const [calendarMonth, setCalendarMonthState] = useState(() =>
    startOfMonth(selectedDay ?? startOfLocalDay(new Date())),
  );
  const setCalendarMonth = useCallback((month: Date) => {
    setCalendarMonthState(startOfMonth(month));
  }, []);
  const calendarMonthKey = localDayKey(calendarMonth);
  const monthRange = useMemo(
    () => monthGridRange(localDayFromKey(calendarMonthKey) ?? new Date()),
    [calendarMonthKey],
  );

  const shared = {
    classIds: context.classIds,
    excludeExamId: formData.examId ?? null,
    subjectIds: context.subjectIds,
  };
  const dayQuery = useExamSlotBookings({
    ...shared,
    from: dayRange?.from ?? null,
    to: dayRange?.to ?? null,
    enabled: open && hasClasses && !!dayRange,
  });
  const monthQuery = useExamSlotBookings({
    ...shared,
    from: monthRange.from,
    to: monthRange.to,
    enabled: open && hasClasses,
  });

  const bookings = useMemo(() => parseSlotBookings(dayQuery.data?.bookings ?? []), [dayQuery.data]);
  const classRows = useMemo(
    () => dayQuery.data?.classes ?? monthQuery.data?.classes ?? [],
    [dayQuery.data, monthQuery.data],
  );
  const classesKnown = !!(dayQuery.data ?? monthQuery.data);

  const labelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classRows) map.set(c.class_id, formatClassName(c.name, c.section));
    return map;
  }, [classRows]);
  const classLabel = useCallback(
    (classId: string) => labelById.get(classId) ?? "Selected class",
    [labelById],
  );

  const visibleClasses = useMemo(() => classRows.filter((c) => c.authorized), [classRows]);
  const hiddenClassLabels = useMemo(() => {
    if (!classesKnown) return [];
    const authorized = new Set(visibleClasses.map((c) => c.class_id));
    return Array.from(new Set(context.classIds))
      .filter((id) => id && !authorized.has(id))
      .map((id) => labelById.get(id) ?? "a selected class");
  }, [classesKnown, visibleClasses, context.classIds, labelById]);

  const graceMinutes =
    metadata.examMode === "hybrid" ? metadata.hybridSettings?.graceWindowMinutes ?? null : null;
  const proposed = useMemo(
    () =>
      checksTime
        ? proposedExamSlot({
            scheduledDate: metadata.scheduledDate,
            startTime: metadata.startTime,
            durationMinutes: metadata.durationMinutes,
            lateEntryMinutes: metadata.lateEntryMinutes,
            examMode: metadata.examMode,
            graceMinutes,
          })
        : null,
    [
      checksTime,
      metadata.scheduledDate,
      metadata.startTime,
      metadata.durationMinutes,
      metadata.lateEntryMinutes,
      metadata.examMode,
      graceMinutes,
    ],
  );

  const dayBookings = useMemo(
    () => (selectedDay ? bookingsOnDay(bookings, selectedDay) : []),
    [bookings, selectedDay],
  );

  const clashes = useMemo(
    () =>
      proposed ? findSlotClashes(bookings, { start: proposed.start, end: proposed.occupiedUntil }) : [],
    [bookings, proposed],
  );

  const suggestions = useMemo(() => {
    if (!proposed || clashes.length === 0) return [];
    const dayStart = startOfLocalDay(proposed.start);
    return suggestFreeStarts({
      blocking: bookings
        .filter((b) => !b.runsAlongside)
        .map((b) => ({ start: b.start, end: b.occupiedUntil })),
      dayStart,
      lengthMinutes: proposed.lengthMinutes,
      preferred: proposed.start,
      notBefore: localDayKey(dayStart) === todayKey ? now : null,
    });
  }, [proposed, clashes.length, bookings, todayKey, now]);

  // Marks for every day of the month grid: distinct exams that would block this
  // one (an optional-group alternative runs alongside, so it does not count).
  const bookedDayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const blocking = parseSlotBookings(monthQuery.data?.bookings ?? []).filter((b) => !b.runsAlongside);
    if (blocking.length === 0) return counts;
    const first = addDays(monthRange.from, 1);
    for (let d = first; d.getTime() < addDays(monthRange.to, -1).getTime(); d = addDays(d, 1)) {
      const n = new Set(bookingsOnDay(blocking, d).map((b) => b.examId)).size;
      if (n > 0) counts.set(localDayKey(d), n);
    }
    return counts;
  }, [monthQuery.data, monthRange]);

  const refetchDay = dayQuery.refetch;
  const refetchMonth = monthQuery.refetch;
  const hasDay = !!dayRange;

  // Re-read on every open: another teacher may have booked (or freed) a time
  // since the last look, and a cached clash would otherwise keep Publish
  // disabled for up to a minute. cancelRefetch: false joins the fetch the
  // enabled flip may already have started instead of cancelling it.
  useEffect(() => {
    if (!open || !hasClasses) return;
    void refetchMonth({ cancelRefetch: false });
    if (hasDay) void refetchDay({ cancelRefetch: false });
  }, [open, hasClasses, hasDay, refetchDay, refetchMonth]);

  const recheck = useCallback(async () => {
    // Offline, a refetch would wait for the network indefinitely; the server
    // guard decides once the publish itself can go out.
    if (!onlineManager.isOnline()) return null;
    const result = await refetchDay();
    if (result.isError || !result.data) return null;
    if (!proposed) return [];
    return findSlotClashes(parseSlotBookings(result.data.bookings), {
      start: proposed.start,
      end: proposed.occupiedUntil,
    });
  }, [refetchDay, proposed]);

  const monthPaused = monthQuery.fetchStatus === "paused";
  return {
    checksTime,
    // Pending covers both a first fetch and one paused offline: either way
    // nothing is known yet, and "no data" must never read as "free" (§6). No
    // request goes out without classes, a date, or while closed.
    isLoading: open && hasClasses && hasDay && dayQuery.isPending,
    isOffline: open && hasClasses && hasDay && dayQuery.fetchStatus === "paused",
    isError: dayQuery.isError,
    error: dayQuery.error,
    refetch: () => {
      void refetchDay();
      void refetchMonth();
    },
    recheck,
    now,
    selectedKey,
    selectedDay,
    calendarMonth,
    setCalendarMonth,
    bookedDayCounts,
    calendarUnknown: open && hasClasses && (monthQuery.isPending || monthQuery.isError || monthPaused),
    calendarError: monthQuery.isError,
    classLabel,
    visibleClasses,
    hiddenClassLabels,
    proposed,
    dayBookings,
    clashes,
    suggestions,
  };
}
