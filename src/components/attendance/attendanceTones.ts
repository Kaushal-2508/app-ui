import type { DayAttendanceCode } from "@/hooks/useStudentMonthAttendance";

/** Saturated filled day-cell chip tones (calendar cells). */
export const CODE_TONES: Record<DayAttendanceCode, string> = {
  present: "bg-emerald-500/90 text-white dark:bg-emerald-400/90",
  absent:  "bg-rose-500/90 text-white dark:bg-rose-400/90",
  leave:   "bg-violet-500/90 text-white dark:bg-violet-400/90",
  sick:    "bg-violet-500/90 text-white dark:bg-violet-400/90",
  casual:  "bg-violet-500/90 text-white dark:bg-violet-400/90",
  holiday: "bg-sky-500/90 text-white dark:bg-sky-400/90",
  none:    "",
};

export const CODE_LABEL: Record<DayAttendanceCode, string> = {
  present: "Present",
  absent:  "Absent",
  leave:   "On leave",
  sick:    "Sick leave",
  casual:  "Casual leave",
  holiday: "Holiday",
  none:    "No record",
};

export type EventKind = "holiday" | "exam_block" | "event";

/** Academic-calendar event kinds: dot colour (calendar) + soft chip (detail). */
export const EVENT_KIND: Record<EventKind, { label: string; dot: string; chip: string }> = {
  holiday:    { label: "Holiday",       dot: "bg-sky-500",   chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" },
  exam_block: { label: "Exam period",   dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  event:      { label: "Special event", dot: "bg-teal-500",  chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300" },
};
