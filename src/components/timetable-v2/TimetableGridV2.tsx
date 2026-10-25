import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { subjectAccentClass } from "./subjectAccent";
import {
  slotsForDay,
  type CalendarWindowV2,
  type PeriodSlotV2,
  type PeriodStructureV2,
  type ResolvedSlotV2,
  type Weekday,
} from "@/hooks/useTimetableV2";

// --------------------------------------------------------------
// TimetableGridV2 — days (rows) × periods (columns) grid.
//
// Holiday/exam-block overlays were removed from cells in 2026-05-07:
// `useCalendarWindowV2` returns a year-wide weekday signal, so painting
// every Wednesday "Summer Vacation" was misleading on a recurring weekly
// template. Calendar info now lives only in the academic-calendar page.
//
// Per-day overrides are surfaced two ways:
//   1) The day-name cell shows a small "Custom" badge when that day uses
//      a different schedule than the defaults (slotsForDay returns
//      override rows instead of defaults).
//   2) Period columns that don't apply to a given day render a faint
//      dashed "—" so the row stays aligned with override-only columns.
// --------------------------------------------------------------

export interface GridCellClick {
  day: Weekday;
  periodSlotId: string;
  existingSlot: ResolvedSlotV2 | null;
}

interface Props {
  structure: PeriodStructureV2;
  slots: ResolvedSlotV2[];
  /** Kept for caller compatibility; intentionally unused — calendar
   *  events don't render on the recurring grid anymore. */
  calendarWindow?: CalendarWindowV2 | null;
  readOnly?: boolean;
  onCellClick?: (args: GridCellClick) => void;
  /** Optional per-slot chapter line (key = tt_slots row id). A weekly grid
   *  shows each slot once, so slot id alone addresses a cell for the
   *  caller-chosen week. */
  chapterOverlay?: Map<string, string>;

  // ── Student-facing options. All opt-in: omitting them leaves the admin
  //    workspace rendering exactly as before. ────────────────────────────────
  /**
   * Weekday -> the real date for the week being shown. When given, each day row
   * carries its calendar date and the day matching `todayWeekday` is
   * highlighted. The admin grid deliberately does NOT pass this: that grid is a
   * recurring weekly TEMPLATE, so stamping one particular week's dates on it
   * would claim something untrue.
   */
  weekDates?: Map<Weekday, Date> | null;
  /** Which row to mark as today. Only meaningful alongside `weekDates`. */
  todayWeekday?: Weekday | null;
  /**
   * "type" (default) tints by slot_type, which is what an admin filling the
   * grid reasons about. "subject" tints by subject name, which is what a
   * student reads: with slot_type tints every academic period is the same wash
   * of teal and a six-period day reads as one block of colour.
   */
  colorBy?: "type" | "subject";
  /**
   * Render nothing instead of "N/A" when a slot has no teacher. For an admin
   * "N/A" is a useful to-do marker; for a student it reads as a fact about the
   * lesson, and it appeared under Lunch.
   */
  hideMissingTeacher?: boolean;
}

const DAY_LABELS: Record<Weekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const TYPE_TINT: Record<string, string> = {
  theory: "bg-teal-50 text-teal-900 hover:bg-teal-100 border-teal-200",
  practical: "bg-amber-50 text-amber-900 hover:bg-amber-100 border-amber-200",
  library: "bg-sky-50 text-sky-900 hover:bg-sky-100 border-sky-200",
  sports: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 border-emerald-200",
  arts: "bg-pink-50 text-pink-900 hover:bg-pink-100 border-pink-200",
  assembly: "bg-indigo-50 text-indigo-900 hover:bg-indigo-100 border-indigo-200",
  free: "bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200",
  break: "bg-slate-100 text-slate-500 border-slate-200",
  other: "bg-violet-50 text-violet-900 hover:bg-violet-100 border-violet-200",
  optional: "bg-orange-50 text-orange-900 hover:bg-orange-100 border-orange-200",
};

function formatHM(t: string): string {
  // "HH:MM:SS" → "HH:MM"
  return t.slice(0, 5);
}

export default function TimetableGridV2({
  structure,
  slots,
  readOnly,
  onCellClick,
  chapterOverlay,
  weekDates = null,
  todayWeekday = null,
  colorBy = "type",
  hideMissingTeacher = false,
}: Props) {
  const allPeriods = structure.slots; // every slot row, sorted by start_time
  const days = structure.working_days;

  // Collapse duplicate columns: when a default row and an override row share
  // the same `(start_time, end_time, label, kind)` signature, render them as
  // a single column. Otherwise an admin who saved a Saturday override that
  // mirrors the defaults would see every period repeated twice in the header.
  const columnSig = (p: PeriodSlotV2): string =>
    `${p.start_time}|${p.end_time}|${p.label.trim()}|${p.kind}`;
  const columns: PeriodSlotV2[] = (() => {
    const seen = new Map<string, PeriodSlotV2>();
    for (const p of allPeriods) {
      const sig = columnSig(p);
      const prior = seen.get(sig);
      // Prefer the default row (days === null) as the canonical column so
      // its label/time stays stable when overrides are dropped later.
      if (!prior || (prior.days !== null && p.days === null)) {
        seen.set(sig, p);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.start_time.localeCompare(b.start_time));
  })();

  // For each day, map column-signature → the period_slot row that actually
  // applies on that day. Lets a single column show data from defaults on
  // Mon-Fri and from overrides on Sat without rendering as two columns.
  const periodIdByDayAndSig = new Map<Weekday, Map<string, string>>();
  const customScheduleDays = new Set<Weekday>();
  for (const day of days) {
    const dayPeriods = slotsForDay(allPeriods, day);
    const sigToId = new Map<string, string>();
    for (const p of dayPeriods) {
      sigToId.set(columnSig(p), p.id);
    }
    periodIdByDayAndSig.set(day, sigToId);
    if (dayPeriods.some((p) => p.days !== null && p.days.includes(day))) {
      customScheduleDays.add(day);
    }
  }

  // Index for O(1) lookup by (day, period_slot_id).
  const byKey = new Map<string, ResolvedSlotV2>();
  for (const s of slots) {
    byKey.set(`${s.day}|${s.period_slot_id}`, s);
  }

  return (
    <Card>
      <CardContent className="p-2 md:p-3">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[560px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background z-10 text-left text-xs font-medium text-muted-foreground px-2 py-2 min-w-[96px]">
                  Day
                </th>
                {columns.map((p) => (
                  <th
                    key={columnSig(p)}
                    className={cn(
                      "text-xs font-medium px-2 py-2 text-center border-l",
                      p.kind === "break" && "bg-slate-50 text-slate-500",
                    )}
                  >
                    <div className="truncate">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {formatHM(p.start_time)} – {formatHM(p.end_time)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const isCustom = customScheduleDays.has(day);
                const date = weekDates?.get(day) ?? null;
                const isToday = todayWeekday === day;
                return (
                  <tr key={day} className={cn(isToday && "bg-brand-primary/[0.045]")}>
                    <td
                      className={cn(
                        "sticky left-0 z-10 px-2 py-2 border-t align-top",
                        isToday ? "bg-brand-primary/[0.09]" : "bg-background",
                      )}
                    >
                      <div
                        className={cn(
                          "text-xs font-semibold",
                          isToday && "text-brand-primary",
                        )}
                      >
                        {DAY_LABELS[day]}
                      </div>
                      {/* The date is the whole point of the student view: the
                          grid is weekly-recurring, so without it "Thu" could be
                          any Thursday of the year. */}
                      {date && (
                        <div
                          className={cn(
                            "text-[11px] tabular-nums",
                            isToday ? "text-brand-primary font-medium" : "text-muted-foreground",
                          )}
                        >
                          {format(date, "d MMM")}
                        </div>
                      )}
                      {isToday && (
                        <Badge
                          variant="outline"
                          className="mt-1 h-4 border-brand-primary/40 bg-brand-primary/10 px-1.5 py-0 text-[9px] font-semibold text-brand-primary"
                        >
                          Today
                        </Badge>
                      )}
                      {isCustom && (
                        <Badge
                          variant="outline"
                          className="mt-1 gap-1 px-1.5 py-0 h-4 text-[9px] bg-amber-50 text-amber-700 border-amber-200"
                          title={`${DAY_LABELS[day]} uses a custom schedule`}
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          Custom
                        </Badge>
                      )}
                    </td>
                    {columns.map((col) => {
                      const sig = columnSig(col);
                      // Resolve which underlying period_slot row applies on
                      // *this* day for *this* column. Defaults map every
                      // working day to the same id; overrides remap a
                      // particular day to a different id with the same sig.
                      const periodIdForDay = periodIdByDayAndSig.get(day)?.get(sig) ?? null;
                      if (!periodIdForDay) {
                        return (
                          <td
                            key={sig}
                            className="border-t border-l align-top p-0"
                            aria-label={`Not applicable on ${DAY_LABELS[day]}`}
                          >
                            <div className={cn("m-0.5 rounded border border-dashed border-slate-200 bg-slate-50/40 p-1.5 flex items-center justify-center", chapterOverlay ? "h-[72px]" : "h-[60px]")}>
                              <span className="text-[11px] text-muted-foreground italic">N/A</span>
                            </div>
                          </td>
                        );
                      }
                      const existing = byKey.get(`${day}|${periodIdForDay}`) ?? null;
                      const type =
                        col.kind === "break"
                          ? "break"
                          : existing?.optional_group_id
                          ? "optional"
                          : existing?.slot_type ?? "free";
                      // Subject mode colours academic cells by subject name and
                      // leaves structural cells (break / free / not-yet-filled)
                      // on the neutral treatment, so colour only ever means
                      // "which subject" and never competes with itself.
                      const subjectKey =
                        existing?.subject_name ?? existing?.custom_label ?? null;
                      const useSubjectTint =
                        colorBy === "subject" && type !== "break" && !!subjectKey;
                      const tint = useSubjectTint
                        ? cn("subj-cell border-l-[3px]", subjectAccentClass(subjectKey))
                        : TYPE_TINT[type] ?? TYPE_TINT.free;
                      const clickable = !readOnly && col.kind !== "break";
                      return (
                        <td
                          key={sig}
                          className={cn(
                            "border-t border-l align-top p-0",
                            clickable && "cursor-pointer",
                          )}
                          onClick={
                            clickable
                              ? () =>
                                  onCellClick?.({
                                    day,
                                    periodSlotId: periodIdForDay,
                                    existingSlot: existing,
                                  })
                              : undefined
                          }
                        >
                          <div
                            className={cn(
                              "m-0.5 rounded border p-1.5 flex flex-col gap-0.5 transition-colors",
                              chapterOverlay ? "h-[72px]" : "h-[60px]",
                              tint,
                            )}
                          >
                            {col.kind === "break" ? (
                              // Name the break rather than labelling every one
                              // of them "Break": the column header already says
                              // Assembly or Lunch, so repeating "Break" in the
                              // cell spent a row on no information.
                              <span className="text-xs italic">{col.label}</span>
                            ) : existing ? (
                              <>
                                <span className="text-xs font-medium truncate">
                                  {existing.optional_group_id
                                    ? (existing.subject_name ?? existing.optional_group_name ?? "Optional")
                                    : existing.slot_type === "other"
                                    ? (existing.custom_label ?? "Other")
                                    : (existing.subject_name ?? labelForType(existing.slot_type))}
                                </span>
                                {(() => {
                                  const sub =
                                    existing.optional_group_id && !existing.teacher_name
                                      ? existing.subject_name
                                        ? "Optional"
                                        : "Optionals in parallel"
                                      : existing.teacher_name ??
                                        (hideMissingTeacher ? null : "N/A");
                                  return sub ? (
                                    <span className="text-[11px] text-muted-foreground truncate">
                                      {sub}
                                    </span>
                                  ) : null;
                                })()}
                                {chapterOverlay?.get(existing.id) && (
                                  <span
                                    className={cn(
                                      "text-[10px] truncate",
                                      useSubjectTint ? "subj-text" : "text-teal-700",
                                    )}
                                  >
                                    → {chapterOverlay.get(existing.id)}
                                  </span>
                                )}
                              </>
                            ) : (
                              // "Empty" describes the database. "Free" describes
                              // the student's day, which is what they are here to
                              // read.
                              <span className="text-[11px] text-muted-foreground italic">
                                {hideMissingTeacher ? "Free" : "Empty"}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function labelForType(t: string): string {
  switch (t) {
    case "library": return "Library";
    case "sports": return "Sports";
    case "arts": return "Arts";
    case "assembly": return "Assembly";
    case "free": return "Free";
    case "break": return "Break";
    case "practical": return "Practical";
    case "other": return "Other";
    default: return t;
  }
}
