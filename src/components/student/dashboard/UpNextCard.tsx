import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarCheck2, ChevronRight, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TONES } from "@/components/shared/design-system";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  slotsForDay,
  useStudentWeekV2,
  type ResolvedSlotV2,
  type Weekday,
} from "@/hooks/useTimetableV2";
import { cn } from "@/lib/utils";

const WEEKDAYS: Weekday[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

/** "08:50:00" or "08:50" → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** "13:40:00" → "1:40 pm". */
function formatClock(t: string): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

const SLOT_TYPE_LABEL: Record<string, string> = {
  practical: "Practical",
  library: "Library",
  sports: "Sports",
  arts: "Arts",
  assembly: "Assembly",
  free: "Free period",
  other: "Activity",
};

function subjectOf(slot: ResolvedSlotV2 | undefined): string {
  if (!slot) return "Free period";
  return (
    slot.subject_name ??
    slot.optional_group_name ??
    slot.custom_label ??
    SLOT_TYPE_LABEL[slot.slot_type] ??
    "Class"
  );
}

/**
 * The student's current or next class, read from their published timetable
 * (the same query My Week uses, so opening My Week afterwards costs nothing).
 *
 * Renders nothing when there is no published timetable or today is not a
 * working day: My Week is where a missing timetable gets explained. The clock
 * comparison is browser-local, which CLAUDE.md §24 accepts for the frontend
 * while every school is on IST.
 */
export function UpNextCard() {
  const navigate = useNavigate();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const timetableOn = isFeatureEnabled("timetable");
  const query = useStudentWeekV2(currentAcademicYear());

  // Re-evaluate "now" every minute so the card rolls over between periods.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const today = WEEKDAYS[(now.getDay() + 6) % 7];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const plan = useMemo(() => {
    const data = query.data;
    if (!data?.structure || data.publishStatus !== "published") return null;
    const structure = data.structure;
    if (!structure.working_days.includes(today)) return null;

    const periods = slotsForDay(structure.slots, today)
      .filter((p) => p.kind === "period")
      .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    if (periods.length === 0) return null;

    const withSlot = periods.map((p) => ({
      period: p,
      slot: data.slots.find((s) => s.day === today && s.period_slot_id === p.id),
    }));
    const current = withSlot.find(
      (x) => toMinutes(x.period.start_time) <= nowMins && nowMins < toMinutes(x.period.end_time),
    );
    const next = withSlot.find((x) => toMinutes(x.period.start_time) > nowMins);
    return { current, next };
  }, [query.data, today, nowMins]);

  if (!timetableOn) return null;

  if (query.isLoading) return <Skeleton className="h-[104px] rounded-card" />;

  // Error before empty (§6): a failed read must not look like "no classes".
  if (query.isError) {
    return (
      <div className="surface-card frosted-shadow rounded-card flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-600">Couldn't load today's classes.</p>
        <Button variant="ghost" size="sm" className="text-brand-primary" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!plan) return null;

  const { current, next } = plan;
  const focus = current ?? next;

  let eyebrow: string;
  if (current) {
    eyebrow = `Now · ends ${formatClock(current.period.end_time)}`;
  } else if (next) {
    const inMins = toMinutes(next.period.start_time) - nowMins;
    eyebrow = inMins <= 60 ? `Up next · in ${inMins} min` : `Up next · ${formatClock(next.period.start_time)}`;
  } else {
    eyebrow = "Today";
  }

  const t = TONES.teal;

  return (
    <Button
      variant="ghost"
      onClick={() => navigate("/student/my-week")}
      className="surface-card frosted-shadow rounded-card h-auto w-full justify-start gap-4 p-4 text-left whitespace-normal hover:bg-surface-card active:scale-[0.99] [&_svg]:size-5"
    >
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", t.bg, t.fg)}>
        {focus ? <Clock /> : <CalendarCheck2 />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[12px] font-semibold", t.fg)}>{eyebrow}</span>
        {focus ? (
          <>
            <span className="mt-0.5 block truncate text-base font-bold text-ink-900">
              {subjectOf(focus.slot)}
            </span>
            <span className="block truncate text-[13px] text-ink-600">
              {[focus.period.label, focus.slot?.teacher_name].filter(Boolean).join(" · ")}
            </span>
            {current && next && (
              <span className="mt-1 block truncate text-[12px] text-ink-500">
                Next: {subjectOf(next.slot)} at {formatClock(next.period.start_time)}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="mt-0.5 block text-base font-bold text-ink-900">Classes are done for today</span>
            <span className="block text-[13px] text-ink-600">See the rest of your week</span>
          </>
        )}
      </span>
      <ChevronRight className="shrink-0 text-ink-400" />
    </Button>
  );
}
