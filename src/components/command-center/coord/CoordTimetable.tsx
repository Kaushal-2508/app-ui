import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useCoordBacklog, useCoordCover, useCoordLessonPlans,
  type CoordPlanItem, type CoordPlanState,
} from "@/hooks/dashboard/useCoord";

import { FilterLabel, FilterStrip } from "../v5/FilterBar";
import { useScopeFilter } from "../v5/useScopeFilter";
import {
  LevelTag, V5Card, V5CardHead, V5Empty, V5Error, V5Loading,
} from "../v5/primitives";

/**
 * Timetable and substitution: the one surface where a coordinator outranks the
 * admin day to day.
 *
 * Reference: public/report_reference/salci-coordinator-dashboard2.html,
 * "Periods needing substitution today" and "Lesson logging backlog". The
 * reference's "Slot completion" grid was replaced on 2026-09-23 by the
 * lesson-plan day view below, on Tushar's instruction: the question is whether
 * each period's lesson plan was updated, not how the timetable is staffed.
 *
 * Everything here is read-only. Assigning a substitute is tt_assign_substitute
 * and editing a period is the timetable workspace; both are one click away,
 * and neither is reimplemented here to drift out of step.
 */

/* --------------------------------------------------- periods needing cover */

export function CoordCover() {
  const q = useCoordCover();
  const rows = q.data?.rows ?? [];
  const nav = useNavigate();

  return (
    <V5Card className="mb-4">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Periods needing substitution today
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            A teacher is out, or the period was never staffed. Both leave a class sitting.
          </p>
        </div>
        {q.data && (
          <LevelTag>
            {q.data.total} {q.data.total === 1 ? "period" : "periods"}
            {q.data.total > 0 ? ` · ${q.data.absent} absent · ${q.data.unassigned} unstaffed` : ""}
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load today's cover list." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="Nothing needs covering today"
            sub="Every teaching period today has a teacher who is in."
          />
        ) : (
          <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
            {rows.map((r) => (
              <li
                key={`${r.slot_id}-${r.reason}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"
              >
                <span
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[12px] font-extrabold tabular-nums"
                  style={{
                    color: "hsl(var(--brand-primary))",
                    background: "hsl(var(--brand-primary) / 0.12)",
                  }}
                  aria-hidden
                >
                  {r.period}
                </span>
                <span className="min-w-0 flex-1 basis-[210px]">
                  <span className="block text-[13px] font-semibold text-ink-900">
                    {r.class_label}
                    {r.subject ? ` · ${r.subject}` : ""}
                  </span>
                  <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                    {r.reason === "absent"
                      ? `${r.teacher ?? "The teacher"} is out${r.sub_reason ? `, ${r.sub_reason}` : ""}`
                      : "Nobody is assigned to this period"}
                    {r.period_label ? ` · ${r.period_label}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11.5px] font-semibold text-ink-500">
                  {/* A cover list with no answer is a worry, not a task. */}
                  {r.free_teachers > 0
                    ? `${r.free_teachers} free`
                    : <span style={{ color: "hsl(var(--dash-critical))" }}>nobody free</span>}
                </span>
                <button
                  type="button"
                  onClick={() => nav(`/school/timetable/${r.class_id}`)}
                  className="shrink-0 whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10"
                >
                  {r.reason === "absent" ? "Assign cover" : "Staff the period"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </V5Card>
  );
}

/* ------------------------------------------------------- lesson plans ---- */

/**
 * The states of a period's lesson plan, in the order the card cares about them.
 * `rank` decides which state a multi-subject (basket) cell shows: the worst one,
 * because a period where one of three plans is missing is a period to chase.
 *
 * `ink` follows the FILL's lightness, measured in both themes: white only where
 * the fill can carry it. In dark mode every fill is a bright tint, so the
 * `dark:` class sends all of them to near-black. "muted" is an outlined cell
 * with no fill at all.
 */
const PLAN: Record<CoordPlanState, {
  label: string; varName: string | null; ink: "light" | "dark" | "muted"; rank: number;
}> = {
  no_plan:     { label: "No lesson plan",       varName: "--dash-critical",   ink: "light", rank: 0 },
  not_updated: { label: "Planned, not marked",  varName: "--dash-warning",    ink: "dark",  rank: 1 },
  pending:     { label: "Awaiting the teacher", varName: "--brand-secondary", ink: "dark",  rank: 2 },
  unplanned:   { label: "Not planned yet",      varName: null,                ink: "muted", rank: 3 },
  planned:     { label: "Planned",              varName: "--brand-primary",   ink: "dark",  rank: 4 },
  skipped:     { label: "Marked not taught",    varName: "--ink-400",         ink: "dark",  rank: 5 },
  note:        { label: "Marked with a note",   varName: "--dash-good",       ink: "dark",  rank: 6 },
  done:        { label: "Marked done",          varName: "--dash-exc",        ink: "light", rank: 7 },
  holiday:     { label: "Holiday",              varName: null,                ink: "muted", rank: 8 },
};

const UPDATED = new Set<CoordPlanState>(["done", "note", "skipped"]);

/** The legend, grouped by the one question the card answers. */
const LEGEND: { group: string; states: CoordPlanState[] }[] = [
  { group: "Updated", states: ["done", "note", "skipped"] },
  { group: "Not updated", states: ["no_plan", "not_updated", "pending"] },
  { group: "Still ahead", states: ["planned", "unplanned"] },
];

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The day column, and the narrowest a cell may get before the grid scrolls. */
const LABEL_COL = 84;
const MIN_CELL = 70;
/** The server's window, in weeks either side of this one. */
const BACK_WEEKS = 18;
const AHEAD_WEEKS = 8;

/* Dates travel as YYYY-MM-DD and are only ever read at UTC midnight, so a
   browser in another timezone can never shift the week being shown. */
function isoAdd(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return isoAdd(iso, -((d.getUTCDay() + 6) % 7));
}
/* Spelled out rather than left to Intl: en-GB now prints September as "Sept"
   on some engines and "Sep" on others, and the grid should read the same on
   every coordinator's phone. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayMonth(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function timeLabel(ts: string) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * The chapter as a cell can hold it. "Chapter-2 Playing with Numbers" prints as
 * "Playing with Numbers", and so do "Ch 4:", "Lesson 3." and Hindi "पाठ 2:"
 * (pa-aa-tha, written as escapes below). The number carries nothing a
 * coordinator reads here, and the full name is on hover.
 * `syllabus_topics.chapter_number` is empty on every row in production, so the
 * prefix inside the NAME is the only numbering there is.
 */
const CHAPTER_PREFIX =
  /^\s*(chapter|chap|ch|lesson|unit|पाठ)\s*[-.:#]?\s*\d+\s*[:.\-)–—]?\s*/i;
function shortChapter(t: string) {
  return t.replace(CHAPTER_PREFIX, "").trim() || t;
}

/** The lesson plan, over everything: what the cell prints on its first line. */
function planText(it: CoordPlanItem): string {
  switch (it.state) {
    case "done":
    case "planned":
    case "not_updated":
      return it.topic ? shortChapter(it.topic) : "No chapter set";
    case "note":
      return `✎ ${it.note?.trim() || "Note"}`;
    case "skipped":
      return "Not taught";
    case "pending":
      return "Awaiting teacher";
    case "no_plan":
      return "No plan";
    case "unplanned":
      return "Not planned";
    case "holiday":
      return "Holiday";
  }
}

function hoverFor(items: CoordPlanItem[]) {
  return items.map((it) => [
    `${it.subject ?? "Subject"} · ${it.teacher ?? "No teacher"}`,
    it.topic ? `Chapter: ${it.topic}` : null,
    it.note ? `Note: ${it.note}` : null,
    `${PLAN[it.state].label}${it.marked_at ? `, ${timeLabel(it.marked_at)}` : ""}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function cellClasses(state: CoordPlanState) {
  const st = PLAN[state];
  if (st.ink === "muted") {
    return "border border-dashed border-ink-400/50 bg-transparent text-ink-500";
  }
  return cn(st.ink === "light" ? "text-white" : "text-[#10222C]", "dark:text-[#0D1114]");
}

function PlanCell({ items, offDay }: { items: CoordPlanItem[]; offDay: boolean }) {
  if (items.length === 0) {
    return (
      <div
        data-plan-cell="free"
        className="grid h-[42px] place-items-center rounded-[6px] bg-surface-stroke/50 text-[10.5px] font-bold text-ink-400"
        title={offDay ? "Not a school day for this class" : "Free period, no subject taught"}
      >
        -
      </div>
    );
  }
  const worst = items.reduce((a, b) => (PLAN[b.state].rank < PLAN[a.state].rank ? b : a));
  const st = PLAN[worst.state];
  const multi = items.length > 1;
  // A basket period carries several subjects: it reports how many of their
  // plans were updated, coloured by the one furthest behind.
  const top = multi ? `${items.length} subjects` : planText(items[0]);
  const bottom = multi
    ? `${items.filter((i) => UPDATED.has(i.state)).length} of ${items.length} updated`
    : items[0].subject ?? "";
  return (
    <div
      data-plan-cell={worst.state}
      className={cn(
        "flex h-[42px] min-w-0 flex-col justify-center overflow-hidden rounded-[6px] px-1.5 leading-[1.2]",
        cellClasses(worst.state),
      )}
      style={st.varName ? { background: `hsl(var(${st.varName}))` } : undefined}
      title={hoverFor(items)}
    >
      <span className="truncate text-[10.5px] font-bold">{top}</span>
      <span className="truncate text-[9.5px] font-semibold opacity-80">{bottom}</span>
    </div>
  );
}

/**
 * Lesson plans, a week of one class: the grid the Timetable tab always had,
 * days down the side and periods across, with a class filter. What each cell
 * says changed on 2026-09-23, on Tushar's instruction: not whether the period
 * is staffed, but whether its LESSON PLAN was updated, with "the lesson plan
 * over everything". So the cell's first line is the plan itself - the chapter,
 * or the teacher's note - and its colour is the plan's state.
 *
 * Periods come from tt_effective_periods, so a basket (optional-group) period
 * is a real period with real plans rather than a grey "free" cell.
 */
export function CoordLessonPlans() {
  const { classId, setClassId, classOptions } = useScopeFilter();
  const [week, setWeek] = React.useState<string | null>(null);
  const q = useCoordLessonPlans(classId, week);
  const d = q.data;

  // This week's Monday, from the server's idea of today (institution
  // timezone), kept while another week loads so the stepper keeps its bounds.
  const thisWeekRef = React.useRef<string | null>(null);
  if (d?.today) thisWeekRef.current = mondayOf(d.today);
  const thisWeek = thisWeekRef.current;
  const shownWeek = week ?? d?.week_start ?? thisWeek;
  const weekOffset = shownWeek && thisWeek
    ? Math.round((Date.parse(`${shownWeek}T00:00:00Z`) - Date.parse(`${thisWeek}T00:00:00Z`)) / (7 * 86_400_000))
    : 0;
  const isThisWeek = weekOffset === 0;
  const future = weekOffset > 0;

  const go = (dir: 1 | -1) => {
    if (!shownWeek || !thisWeek) return;
    const next = isoAdd(shownWeek, 7 * dir);
    setWeek(next === thisWeek ? null : next);
  };

  const periods = d?.periods ?? [];
  const days = d?.days ?? [];
  const sum = d?.summary;
  const effectiveClass = classId ?? d?.class_id ?? null;

  // One lookup per cell rather than a linear find: 13 periods by 6 days is 78
  // cells on every render.
  const byCell = React.useMemo(() => {
    const m = new Map<string, CoordPlanItem[]>();
    (d?.cells ?? []).forEach((c) => m.set(`${c.day}:${c.period}`, c.items));
    return m;
  }, [d]);

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Lesson plans
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Every period of the week, per class, and whether its lesson plan was updated.
          </p>
        </div>
        {sum && (
          <LevelTag>
            {future
              ? `${sum.planned} of ${sum.teaching} planned`
              : `${sum.updated_over} of ${sum.over} updated`}
          </LevelTag>
        )}
      </V5CardHead>

      <FilterStrip>
        <FilterLabel>Class</FilterLabel>
        {/* A plain class list, no "all" entry: the grid is one class. */}
        <Select value={effectiveClass ?? undefined} onValueChange={(v) => setClassId(v)}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder="Pick a class" />
          </SelectTrigger>
          <SelectContent className="max-h-[320px]">
            {classOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <FilterLabel>Week</FilterLabel>
        <div className="flex items-center gap-1.5">
          <Button
            type="button" variant="outline" size="icon" className="h-8 w-8"
            aria-label="Previous week"
            disabled={!shownWeek || weekOffset <= -BACK_WEEKS}
            onClick={() => go(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[112px] text-center text-[12.5px] font-semibold text-ink-700 tabular-nums">
            {shownWeek ? `${dayMonth(shownWeek)} to ${dayMonth(isoAdd(shownWeek, 5))}` : ""}
          </span>
          <Button
            type="button" variant="outline" size="icon" className="h-8 w-8"
            aria-label="Next week"
            disabled={!shownWeek || weekOffset >= AHEAD_WEEKS}
            onClick={() => go(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {!isThisWeek && (
          <Button
            type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-[12.5px]"
            onClick={() => setWeek(null)}
          >
            This week
          </Button>
        )}
      </FilterStrip>

      <div className="px-4 pb-4 pt-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading label="Loading the week's lesson plans…" />
        ) : q.isError || !d ? (
          <V5Error label="Couldn't load the lesson plans for this week." onRetry={() => void q.refetch()} />
        ) : !d.class_id ? (
          <V5Empty title="No classes are mapped to your wing" sub="An administrator maps classes to wings." />
        ) : periods.length === 0 ? (
          <V5Empty
            title="No timetable has been built for this class"
            sub="Periods appear here once a period structure is assigned and slots are filled in."
          />
        ) : (
          <>
            {/* Scrolls inside the card rather than crushing: thirteen periods
                of two-line cells will not fit a phone, and a cell narrower than
                its chapter name tells nobody anything. */}
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div
                className="grid gap-[3px]"
                style={{
                  gridTemplateColumns: `${LABEL_COL}px repeat(${periods.length}, minmax(${MIN_CELL}px, 1fr))`,
                  minWidth: LABEL_COL + periods.length * (MIN_CELL + 3),
                }}
              >
                <div />
                {periods.map((p) => (
                  <div key={p.period} data-period-head className="pb-1 text-center" title={p.label ?? undefined}>
                    <span className="block text-[9.5px] font-bold uppercase tracking-[0.04em] text-ink-400">
                      P{p.period}
                    </span>
                    <span className="block text-[9px] font-medium tabular-nums text-ink-400">
                      {p.start_time}
                    </span>
                  </div>
                ))}

                {days.map((day) => {
                  const isToday = day.date === d.today;
                  return (
                    <React.Fragment key={day.idx}>
                      <div className="flex min-w-0 flex-col justify-center pr-1.5">
                        <span className="flex items-center gap-1 text-[11.5px] font-bold text-ink-700">
                          {DOW_SHORT[day.idx] ?? day.dow.slice(0, 3)}
                          {isToday && (
                            <span className="text-[8.5px] font-bold uppercase tracking-[0.04em] text-brand-primary">
                              today
                            </span>
                          )}
                        </span>
                        <span className="truncate text-[10px] font-medium text-ink-400">
                          {day.holiday
                            ? day.holiday.kind === "exam_block" ? "Exam block" : "Holiday"
                            : !day.working ? "No school" : dayMonth(day.date)}
                        </span>
                      </div>
                      {periods.map((p) => (
                        <PlanCell
                          key={p.period}
                          items={byCell.get(`${day.idx}:${p.period}`) ?? []}
                          offDay={!day.working}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              {LEGEND.map((g) => (
                <div key={g.group} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] font-medium text-ink-500">
                  <span className="w-[82px] shrink-0 text-[10.5px] font-bold uppercase tracking-[0.05em] text-ink-400">
                    {g.group}
                  </span>
                  {g.states.map((k) => (
                    <span key={k} className="inline-flex items-center">
                      <i
                        className={cn(
                          "mr-[5px] inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]",
                          PLAN[k].varName ? "" : "border border-dashed border-ink-400/70",
                        )}
                        style={PLAN[k].varName ? { background: `hsl(var(${PLAN[k].varName}))` } : undefined}
                        aria-hidden
                      />
                      {PLAN[k].label}
                    </span>
                  ))}
                </div>
              ))}
            </div>

            {sum && (
              <p className="mt-3 text-[11.5px] font-medium text-ink-400">
                {d.class_label} · {sum.teaching} teaching periods this week.{" "}
                {future ? (
                  <>{sum.planned} planned, {sum.unplanned} not planned yet.</>
                ) : (
                  <>
                    {sum.over < sum.teaching ? `Of the ${sum.over} that have happened: ` : ""}
                    <b className="text-ink-600">{sum.updated_over} updated</b>
                    {sum.no_plan > 0 && (
                      <>, <b style={{ color: "hsl(var(--dash-critical))" }}>{sum.no_plan} with no lesson plan</b></>
                    )}
                    {sum.not_updated > 0 && (
                      <>, <b style={{ color: "hsl(var(--dash-warning))" }}>{sum.not_updated} planned but not marked</b></>
                    )}
                    {sum.pending > 0 && <>, {sum.pending} awaiting the teacher after a substitution</>}
                    .{sum.over < sum.teaching ? ` ${sum.teaching - sum.over} still to come.` : ""}
                  </>
                )}
                {" "}Hover a cell for the full chapter, the teacher and when it was marked.
              </p>
            )}
          </>
        )}
      </div>
    </V5Card>
  );
}

/* ----------------------------------------------------- logging backlog ---- */

/**
 * Periods this week whose lesson plan was never updated, per teacher. The same
 * definition as the lesson-plan grid above (effective periods, a plan matched
 * on its subject, only periods that have ended), so the two agree on any given
 * day. The reference calls chasing these "the cheapest accuracy you can buy":
 * nothing has to change in a classroom for the coverage figure to become true.
 */
export function CoordBacklog() {
  const q = useCoordBacklog();
  const [open, setOpen] = React.useState(false);
  const d = q.data;
  const rows = d?.rows ?? [];
  const shown = open ? rows : rows.slice(0, 5);

  return (
    <V5Card className="mb-8 overflow-hidden">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
            Lesson plan backlog
          </h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Periods this week whose lesson plan was never updated. Coverage reads low until they are.
          </p>
        </div>
        {d && (
          <LevelTag>
            {d.total} {d.total === 1 ? "period" : "periods"}
            {d.teachers > 0 ? ` · ${d.teachers} ${d.teachers === 1 ? "teacher" : "teachers"}` : ""}
          </LevelTag>
        )}
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the logging backlog." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty
            title="Every lesson plan this week has been updated"
            sub="Your syllabus coverage figure is as accurate as the register allows."
          />
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
              {shown.map((r) => (
                <li key={r.teacher_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1 basis-[190px]">
                    <span className="block text-[13px] font-semibold text-ink-900">{r.name}</span>
                    <span className="mt-px block text-[11.5px] font-medium text-ink-500">
                      {r.classes} {r.classes === 1 ? "class" : "classes"} · oldest{" "}
                      {r.oldest_days === 0
                        ? "today"
                        : `${r.oldest_days} ${r.oldest_days === 1 ? "day" : "days"} ago`}
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-[3px] text-[11.5px] font-bold tabular-nums"
                    style={{
                      color: "hsl(var(--dash-warning))",
                      background: "hsl(var(--dash-warning) / 0.12)",
                    }}
                  >
                    {r.periods} not updated
                  </span>
                </li>
              ))}
            </ul>
            {rows.length > 5 && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-3 w-full rounded-[10px] border border-surface-stroke py-2 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
              >
                {open ? "Show less" : `Show all ${rows.length} teachers`}
              </button>
            )}
          </>
        )}
      </div>
    </V5Card>
  );
}
