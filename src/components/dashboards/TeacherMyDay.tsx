import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  NotebookPen,
  PartyPopper,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TONES, type Tone } from "@/components/shared/design-system";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import { useTeacherWeekV2, type TeacherWeekSlot, type Weekday } from "@/hooks/useTimetableV2";
import { DashboardScopeProvider } from "@/hooks/dashboard/DashboardScope";
import { useTeacherActionQueue, type ActionQueueItem } from "@/hooks/dashboard/useTeacherDashboardData";
import { cn, formatClassName } from "@/lib/utils";

const WEEKDAYS: Weekday[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatClock(t: string): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

function classLabel(s: TeacherWeekSlot): string {
  return formatClassName(s.class_name, s.class_section);
}

function whatLabel(s: TeacherWeekSlot): string {
  return s.subject_name ?? s.optionalGroupName ?? s.custom_label ?? "Class";
}

/** Re-evaluates "now" every minute so the Now card rolls over between periods. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Teacher home, "My day" (2026-10-14): the period running now with its two
 * most-used actions, the server-counted to-do list, and today's timeline.
 * Everything here reads existing queries:
 *   - useTeacherWeekV2: the same week My Week loads (cache shared).
 *   - dash_teacher_action_queue: counted server-side, subject-scoped through
 *     dash_resolve_teacher_pairs (§23, §25). It only runs under the "teacher"
 *     DashboardScope, which this component provides itself.
 * Colours are the existing Tone tokens only.
 */
export function TeacherMyDay() {
  return (
    <DashboardScopeProvider scope="teacher">
      <div className="space-y-4">
        <TodaySchedule />
        <TodoCounts />
      </div>
    </DashboardScopeProvider>
  );
}

function TodaySchedule() {
  const navigate = useNavigate();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const timetableOn = isFeatureEnabled(FEATURE_URL_MAP["/teacher/my-week"] ?? "timetable");
  const attendanceOn = isFeatureEnabled(FEATURE_URL_MAP["/school/attendance"] ?? "attendance");
  const query = useTeacherWeekV2(currentAcademicYear());
  const now = useMinuteClock();

  const today = WEEKDAYS[(now.getDay() + 6) % 7];
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const periods = useMemo(
    () =>
      (query.data ?? [])
        .filter((s) => s.day === today && s.period_kind === "period")
        .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)),
    [query.data, today],
  );

  if (!timetableOn) return null;
  if (query.isLoading) return <Skeleton className="h-40 rounded-card" />;

  // Error before empty (§6): a failed read must not look like a free day.
  if (query.isError) {
    return (
      <div className="surface-card frosted-shadow rounded-card flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-600">Couldn't load today's timetable.</p>
        <Button variant="ghost" size="sm" className="text-brand-primary" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  // No periods today (not published, a day off, or none assigned): My Week
  // is where that gets explained, the home screen stays quiet.
  if (periods.length === 0) return null;

  const current = periods.find(
    (s) => toMinutes(s.start_time) <= nowMins && nowMins < toMinutes(s.end_time),
  );
  const next = periods.find((s) => toMinutes(s.start_time) > nowMins);
  const focus = current ?? next;

  let eyebrow = "";
  if (current) eyebrow = `Now · ends ${formatClock(current.end_time)}`;
  else if (next) {
    const inMins = toMinutes(next.start_time) - nowMins;
    eyebrow = inMins <= 60 ? `Up next · in ${inMins} min` : `Up next · ${formatClock(next.start_time)}`;
  }

  const teal = TONES.teal;

  return (
    <div className="surface-card frosted-shadow rounded-card overflow-hidden">
      {/* Now / next */}
      {focus ? (
        <div className="space-y-3 border-b border-surface-stroke p-4">
          <div>
            <p className={cn("text-[12px] font-semibold", teal.fg)}>{eyebrow}</p>
            <p className="mt-0.5 line-clamp-2 text-lg font-bold leading-snug text-ink-900">
              {classLabel(focus)} · {whatLabel(focus)}
            </p>
            <p className="text-[13px] text-ink-600">
              {focus.period_label}
              {current && next && ` · Next: ${classLabel(next)} at ${formatClock(next.start_time)}`}
            </p>
          </div>
          <div className="flex gap-2">
            {attendanceOn && (
              <Button className="flex-1 gap-2" onClick={() => navigate("/school/attendance")}>
                <ClipboardCheck className="h-4 w-4" />
                Mark attendance
              </Button>
            )}
            <Button variant="outline" className="flex-1 gap-2" onClick={() => navigate("/teacher/my-week")}>
              <NotebookPen className="h-4 w-4" />
              Log lesson
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-surface-stroke p-4">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", TONES.mint.bg, TONES.mint.fg)}>
            <PartyPopper className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-ink-900">Classes are done for today</p>
            <p className="text-[13px] text-ink-600">Remember to log any lesson you missed.</p>
          </div>
        </div>
      )}

      {/* Today's timeline */}
      <div className="px-4 pb-2 pt-3">
        <p className="eyebrow pb-1">Today · {periods.length} {periods.length === 1 ? "class" : "classes"}</p>
        <ul>
          {periods.map((s) => {
            const done = toMinutes(s.end_time) <= nowMins;
            const live = s === current;
            return (
              <li key={s.id} className="border-b border-surface-stroke last:border-0">
                <Button
                  variant="ghost"
                  onClick={() => navigate("/teacher/my-week")}
                  className="h-auto w-full justify-start gap-3 rounded-none px-0 py-2.5 text-left font-normal hover:bg-transparent"
                >
                  <span className="w-16 shrink-0 text-[12px] tabular-nums text-ink-500">
                    {formatClock(s.start_time)}
                  </span>
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : live ? (
                    <CircleDot className={cn("h-4 w-4 shrink-0", teal.fg)} />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-ink-400" />
                  )}
                  {/* Two lines: real class names run long ("Class 12 Science -
                      NEET"), and on one line they pushed the subject off. */}
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        live ? "font-semibold text-ink-900" : done ? "text-ink-500" : "text-ink-700",
                      )}
                    >
                      {classLabel(s)}
                    </span>
                    <span className="block truncate text-[12px] text-ink-500">
                      {whatLabel(s)} · {s.period_label}
                    </span>
                  </span>
                  {live && (
                    <span className={cn("shrink-0 text-[12px] font-semibold", teal.fg)}>Now</span>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const QUEUE_META: Record<ActionQueueItem["key"], { icon: typeof ClipboardList; tone: Tone }> = {
  grading: { icon: FileCheck2, tone: "violet" },
  homework: { icon: ClipboardList, tone: "peach" },
  attendance: { icon: ClipboardCheck, tone: "teal" },
  planning: { icon: NotebookPen, tone: "sky" },
};

function TodoCounts() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useTeacherActionQueue();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[76px] rounded-card" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="surface-card frosted-shadow rounded-card flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-600">Couldn't load your to-do list.</p>
        <Button variant="ghost" size="sm" className="text-brand-primary" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const open = (data?.items ?? []).filter((i) => i.count > 0);

  if (open.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card flex items-center gap-3 p-4">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", TONES.mint.bg, TONES.mint.fg)}>
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div>
          <p className="font-bold text-ink-900">All caught up</p>
          <p className="text-[13px] text-ink-600">Nothing waiting to be marked or logged.</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="To do">
      <p className="eyebrow pb-2">To do</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {open.map((item) => {
          const meta = QUEUE_META[item.key];
          const Icon = meta.icon;
          const t = TONES[meta.tone];
          return (
            <Button
              key={item.key}
              variant="ghost"
              disabled={!item.href}
              onClick={() => item.href && navigate(item.href)}
              className="surface-card frosted-shadow rounded-card h-auto flex-col items-start gap-2 whitespace-normal p-3 text-left hover:bg-surface-card active:scale-[0.98] [&_svg]:size-4"
            >
              <span className="flex w-full items-center justify-between">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", t.bg, t.fg)}>
                  <Icon />
                </span>
                {item.href && <ChevronRight className="text-ink-400" />}
              </span>
              <span className="text-2xl font-bold leading-none text-ink-900">{item.count}</span>
              <span className="text-[12px] font-medium leading-tight text-ink-600">{item.label}</span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
