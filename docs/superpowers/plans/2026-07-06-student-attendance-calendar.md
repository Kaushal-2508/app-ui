# Student Attendance Calendar Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a student-portal `/student/attendance` tab: a monthly calendar (year Select + month nav, bounded to configured academic years, no future) where each date shows the student's attendance status + a dot for any academic-calendar event, with a tap-to-detail panel and a per-month summary.

**Architecture:** Extend the existing `useStudentMonthAttendance` hook additively (broaden `cal_events` to all 3 kinds + add `eventsByDate`) so the dashboard widget is unaffected; add a shared tone module + three small bounded hooks; build one page consuming them; wire route + sidebar + feature gate; add one index. Spec: `docs/superpowers/specs/2026-07-06-student-attendance-calendar-design.md`.

**Tech Stack:** React 18 + TS + Vite, TanStack Query v5, Supabase (RLS reads, no RPC), shadcn/ui + PageShell design system, date-fns.

## Global Constraints (binding — from spec + CLAUDE.md §5a/§23)

- **This repo has NO unit-test runner.** The verification cycle for every task is the §5a triad: `npm run typecheck` (project-wide, exit 0), `npx eslint <changed files>` (0 errors), and `npx vite build` (exit 0, run once at the end / when JSX changes). Do NOT invent vitest/pytest tests.
- No `any` (hard eslint error); `prefer-const` (hard error). For a Supabase embedded to-one join typed `T | T[]`, cast via a small inline structural type (mirror `useStudentWeekV2`'s `as unknown as Row[]` pattern) — never `as any`.
- Every new `useQuery` sets explicit `staleTime: 60_000`. Every list/range query is bounded (date range, single id, or RLS-institution-scoped) — no `select("*")`, no full-history. No `refetchInterval`, no realtime. No JWT-less `supabase.auth.getUser()` (identity from `useAuth`).
- shadcn/design-system components only; colours via tokens (`text-ink-*`, `surface-card`, `frosted-shadow`, `rounded-card`, `brand-primary`); no inline styles; works at 375px; loading + empty states required; error state renders BEFORE empty state.
- Reads are already RLS-legal for students (`attendance_records` own rows; `cal_events`/`cal_academic_years` auto-scoped to the caller's institution) — NO RPC, NO new RLS policy.
- "today"/future use browser-local date (India-only convention, spec §7) — do not add an institution-timezone fetch.
- Prod SQL applies via `scripts/run-sql.ps1` (Management API); verify via `pg_indexes`, never `supabase db push`.
- Branch: `feat/student-attendance-calendar` off `main`.

## File inventory

| File | Task | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_attendance_records_student_date_idx.sql` | 1 | index `(student_id, date)` |
| `src/components/attendance/attendanceTones.ts` | 2 | shared CODE_TONES / CODE_LABEL / EVENT_KIND |
| `src/components/attendance/StudentAttendanceWidget.tsx` | 2 | import tones from the module (visual no-op) |
| `src/hooks/useStudentMonthAttendance.ts` | 3 | +all-kinds `cal_events`, +`eventsByDate`, +`CalEventLite` |
| `src/hooks/useStudentAttendanceTab.ts` | 4 | `useStudentClass`, `useStudentDayAttendance`, `useInstitutionAcademicYears` |
| `src/pages/student/StudentAttendancePage.tsx` | 5 | the tab |
| `src/App.tsx` | 6 | route |
| `src/components/layout/AppSidebar.tsx` | 6 | nav item |
| `src/components/admin/institution-wizard/featuresData.ts` | 6 | FEATURE_URL_MAP entry |

---

## Task 1: Migration — `attendance_records(student_id, date)` index (controller / DB)

**Files:** Create `supabase/migrations/20260706180000_attendance_records_student_date_idx.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260706180000_attendance_records_student_date_idx.sql
-- The student attendance calendar filters attendance_records by
-- (student_id + date range). The only existing composite index is
-- UNIQUE(class_id, student_id, date) — class-leading, so it does not serve a
-- student-leading range scan. Add the covering index.
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date
  ON public.attendance_records (student_id, date);
```

- [ ] **Step 2: Apply to prod** — `& "scripts\run-sql.ps1" -SqlFile "supabase\migrations\20260706180000_attendance_records_student_date_idx.sql"` → expect `HTTP 201` and `[]`.
- [ ] **Step 3: Verify** via `run-sql.ps1`:

```sql
SELECT count(*) AS idx FROM pg_indexes
WHERE tablename='attendance_records' AND indexname='idx_attendance_records_student_date';
```
Expected: `1`.
- [ ] **Step 4: Commit** — `git add supabase/migrations/20260706180000_attendance_records_student_date_idx.sql && git commit -m "perf(attendance): index attendance_records(student_id,date)"` (+ Co-Authored-By trailer).

---

## Task 2: Shared tone module + widget refactor

**Files:** Create `src/components/attendance/attendanceTones.ts`; Modify `src/components/attendance/StudentAttendanceWidget.tsx`

**Interfaces produced:** `CODE_TONES`, `CODE_LABEL`, `EVENT_KIND`, `EventKind`.

- [ ] **Step 1: Create `attendanceTones.ts`** verbatim:

```ts
import type { DayAttendanceCode } from "@/hooks/useStudentMonthAttendance";

/** Saturated filled day-cell chip tones (calendar cells). */
export const CODE_TONES: Record<DayAttendanceCode, string> = {
  present: "bg-emerald-500/90 text-white dark:bg-emerald-400/90",
  late:    "bg-amber-500/90 text-white dark:bg-amber-400/90",
  absent:  "bg-rose-500/90 text-white dark:bg-rose-400/90",
  sick:    "bg-violet-500/90 text-white dark:bg-violet-400/90",
  casual:  "bg-violet-500/90 text-white dark:bg-violet-400/90",
  holiday: "bg-sky-500/90 text-white dark:bg-sky-400/90",
  none:    "",
};

export const CODE_LABEL: Record<DayAttendanceCode, string> = {
  present: "Present",
  late:    "Late",
  absent:  "Absent",
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
```

- [ ] **Step 2: Refactor the widget to import the tones.** In `src/components/attendance/StudentAttendanceWidget.tsx`, DELETE the local `const CODE_TONES` (lines 26-34) and `const CODE_LABEL` (lines 36-44) blocks, and add to the imports (below the `useStudentMonthAttendance` import block):

```ts
import { CODE_TONES, CODE_LABEL } from "@/components/attendance/attendanceTones";
```
Leave everything else in the widget untouched — it still references `CODE_TONES`/`CODE_LABEL` by the same names, so it's a pure move. (The `DayAttendanceCode` type import stays.)

- [ ] **Step 3: Verify** — `npm run typecheck` (exit 0); `npx eslint src/components/attendance/attendanceTones.ts src/components/attendance/StudentAttendanceWidget.tsx` (0 errors).
- [ ] **Step 4: Commit** — `feat(attendance): shared attendance tone module (+ widget uses it)`.

---

## Task 3: Extend `useStudentMonthAttendance` (additive)

**Files:** Modify `src/hooks/useStudentMonthAttendance.ts`

**Interfaces produced:** `CalEventLite`; `StudentMonthAttendance` gains `eventsByDate: Map<string, CalEventLite[]>` (all existing fields unchanged).

- [ ] **Step 1: Add the event type + interface field.** After the `DayAttendanceCode` type (line 14) add:

```ts
export interface CalEventLite {
  kind: "holiday" | "exam_block" | "event";
  title: string;
}
```
In `interface StudentMonthAttendance`, add one field after `byDate`:
```ts
  /** All academic-calendar entries per day (holiday / exam_block / event). */
  eventsByDate: Map<string, CalEventLite[]>;
```

- [ ] **Step 2: Broaden the `cal_events` query.** Replace the `holidaysP` block (lines 78-86) with:

```ts
      const eventsP = institutionId
        ? supabase
            .from("cal_events")
            .select("starts_on, ends_on, kind, title")
            .eq("institution_id", institutionId)
            .in("kind", ["holiday", "exam_block", "event"])
            .lte("starts_on", toStr)
            .gte("ends_on", fromStr)
        : Promise.resolve({ data: [], error: null });
```
Rename the destructure + error check (lines 88-90) accordingly:
```ts
      const [recRes, evtRes] = await Promise.all([recordsP, eventsP]);
      if (recRes.error) throw recRes.error;
      if (evtRes.error) throw evtRes.error;
```

- [ ] **Step 3: Build both the holiday set AND the events map in the queryFn.** Replace the holiday-expansion block (lines 92-100) with:

```ts
      const records = ((recRes.data ?? []) as { date: string; status: string }[]);
      const holidays = new Set<string>();
      const events: Array<{ date: string; kind: CalEventLite["kind"]; title: string }> = [];
      type EvtRow = { starts_on: string; ends_on: string; kind: string; title: string };
      ((evtRes.data ?? []) as EvtRow[]).forEach((e) => {
        const kind = e.kind as CalEventLite["kind"];
        eachDayOfInterval({ start: parseISO(e.starts_on), end: parseISO(e.ends_on) }).forEach((d) => {
          const key = ymd(d);
          events.push({ date: key, kind, title: e.title });
          if (kind === "holiday") holidays.add(key);
        });
      });
      return { records, holidays, events, institutionId };
```

- [ ] **Step 4: Fold events into the memo output.** In the `useMemo` (starts line 105), (a) destructure `events` too:
```ts
    const { records, holidays, events } = query.data;
```
(b) after the `holidays.forEach(...)` block that sets holiday overrides (ends line 122), build the events map:
```ts
    const eventsByDate = new Map<string, CalEventLite[]>();
    events.forEach((e) => {
      const list = eventsByDate.get(e.date) ?? [];
      list.push({ kind: e.kind, title: e.title });
      eventsByDate.set(e.date, list);
    });
```
(c) add `eventsByDate,` to the returned object (after `byDate,`).
Also update the empty-return shape in the queryFn's `if (!user?.id)` branch (lines 55-59) to include `events: [] as Array<{ date: string; kind: CalEventLite["kind"]; title: string }>,`.

- [ ] **Step 5: Verify** — `npm run typecheck` (exit 0); `npx eslint src/hooks/useStudentMonthAttendance.ts` (0 errors). Confirm the widget still typechecks (it ignores `eventsByDate`).
- [ ] **Step 6: Commit** — `feat(attendance): month hook returns all calendar-event kinds (eventsByDate)`.

---

## Task 4: Small bounded hooks — `useStudentAttendanceTab.ts`

**Files:** Create `src/hooks/useStudentAttendanceTab.ts`

**Interfaces produced:** `StudentClassInfo`, `useStudentClass`; `StudentDayRecord`, `useStudentDayAttendance`; `AcademicYearOption`, `useInstitutionAcademicYears`.

- [ ] **Step 1: Create the file** verbatim:

```ts
import { useQuery } from "@tanstack/react-query";
import { parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { currentAcademicYear, academicYearRange } from "@/hooks/useAcademicCalendar";

// ── Student's class for an academic year (subtitle + not-enrolled gate) ──────
export interface StudentClassInfo {
  classId: string;
  className: string;
  classSection: string | null;
}

export function useStudentClass(academicYear: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-class", user?.id, academicYear],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentClassInfo | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes:class_id(id, name, section, academic_year)")
        .eq("user_id", user.id)
        .eq("role", "student");
      if (error) throw error;
      type Row = { class_id: string; classes: { id: string; name: string; section: string | null; academic_year: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const match = rows.find((r) => r.classes?.academic_year === academicYear) ?? rows[0];
      if (!match?.classes) return null;
      return { classId: match.classes.id, className: match.classes.name, classSection: match.classes.section };
    },
  });
}

// ── One date's attendance rows (status + remark + class) for the detail panel ─
export interface StudentDayRecord {
  status: string;
  remarks: string | null;
  className: string | null;
  classSection: string | null;
}

export function useStudentDayAttendance(dateIso: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-day-attendance", user?.id, dateIso],
    enabled: !!user?.id && !!dateIso,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentDayRecord[]> => {
      if (!user?.id || !dateIso) return [];
      const { data, error } = await supabase
        .from("attendance_records")
        .select("status, remarks, classes:class_id(name, section)")
        .eq("student_id", user.id)
        .eq("date", dateIso);
      if (error) throw error;
      type Row = { status: string; remarks: string | null; classes: { name: string; section: string | null } | null };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        status: r.status,
        remarks: r.remarks,
        className: r.classes?.name ?? null,
        classSection: r.classes?.section ?? null,
      }));
    },
  });
}

// ── Configured academic years for the year picker (RLS auto-scopes) ──────────
export interface AcademicYearOption {
  code: string;
  start: Date;
  end: Date;
  isActive: boolean;
}

export function useInstitutionAcademicYears() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["institution-academic-years", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<AcademicYearOption[]> => {
      const { data, error } = await supabase
        .from("cal_academic_years")
        .select("code, starts_on, ends_on, is_active");
      if (error) throw error;
      type Row = { code: string; starts_on: string; ends_on: string; is_active: boolean };
      const today = new Date();
      const opts = ((data ?? []) as Row[])
        .map((r) => ({ code: r.code, start: parseISO(r.starts_on), end: parseISO(r.ends_on), isActive: r.is_active }))
        .filter((o) => o.start <= today) // drop future-only years (spec: no future)
        .sort((a, b) => b.start.getTime() - a.start.getTime());
      if (opts.length > 0) return opts;
      // Fallback: no configured years — synthesize the current Apr–Mar year.
      const code = currentAcademicYear();
      const range = academicYearRange(parseInt(code.slice(0, 4), 10));
      return [{ code, start: range.start, end: range.end, isActive: true }];
    },
  });
}
```

NOTE before finalizing: open `src/hooks/useAcademicCalendar.ts` and confirm `currentAcademicYear` and `academicYearRange` are exported with these signatures (`currentAcademicYear(): string` like "2026-27"; `academicYearRange(startYear: number): { start: Date; end: Date }`). If `academicYearRange` takes a different arg (e.g. the AY string), adapt the fallback call minimally — do NOT change the rest.

- [ ] **Step 2: Verify** — `npm run typecheck` (exit 0); `npx eslint src/hooks/useStudentAttendanceTab.ts` (0 errors).
- [ ] **Step 3: Commit** — `feat(attendance): student class / day / academic-year hooks`.

---

## Task 5: `StudentAttendancePage.tsx`

**Files:** Create `src/pages/student/StudentAttendancePage.tsx`

**Interfaces:** Consumes Task 2 (`CODE_TONES`/`CODE_LABEL`/`EVENT_KIND`), Task 3 (`useStudentMonthAttendance`, `CalEventLite`), Task 4 (all three hooks). Default export `StudentAttendancePage`.

- [ ] **Step 1: Create the page** verbatim:

```tsx
import { useMemo, useState } from "react";
import {
  format, startOfMonth, getDay, addMonths, subMonths,
  isAfter, isSameMonth, isBefore, startOfDay,
} from "date-fns";
import { ClipboardCheck, ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
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
      ) : month.isError ? (
        <EmptyState icon={<CalendarX2 className="h-5 w-5" />} tone="rose"
          title="Couldn't load your attendance" description="Please try again in a moment." />
      ) : !studentClass.data ? (
        <EmptyState icon={<CalendarX2 className="h-5 w-5" />}
          title="You're not enrolled in a class yet"
          description="Ask your school admin to add you to a class — your attendance will show here." />
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <StatTileGrid cols={2} mdCols={4}>
            <StatTile label="Present" value={month.data?.presentCount ?? 0} tone="mint" />
            <StatTile label="Late" value={month.data?.lateCount ?? 0} tone="peach" />
            <StatTile label="Absent" value={month.data?.absentCount ?? 0} tone="rose" />
            <StatTile label="Attendance"
              value={month.data?.percentage == null ? "—" : `${Math.round(month.data.percentage)}%`}
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
                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={isFuture}
                      onClick={() => setSelectedIso(iso)}
                      className="relative aspect-square flex items-center justify-center disabled:cursor-default"
                      title={`${format(cell, "EEE, d MMM")} · ${CODE_LABEL[code]}${events.length ? ` · ${events.map((e) => e.title).join(", ")}` : ""}`}
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
                <LegendDot tone="bg-amber-500/90" label="Late" />
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
        <p className="text-xs text-ink-600">School holiday — no attendance.</p>
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
    case "late":    return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
    case "absent":  return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
    case "sick":
    case "casual":  return "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300";
    case "holiday": return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";
    default:        return "bg-ink-400/10 text-ink-700";
  }
}
function labelForStatus(status: string): string {
  const m: Record<string, string> = {
    present: "Present", late: "Late", absent: "Absent",
    sick: "Sick leave", casual: "Casual leave", holiday: "Holiday",
  };
  return m[status] ?? status;
}
```

- [ ] **Step 2: Verify props against reality.** Before finalizing, confirm:
  - `StatTile` accepts `{ label, value, tone }` and `StatTileGrid` accepts `{ cols, mdCols }` (open `src/components/shared/surfaces/StatTile.tsx`; adapt prop names if they differ — e.g. if grid uses `columns` not `cols`).
  - `EmptyState` accepts `{ icon, title, description, tone?, size? }` (open `src/components/shared/surfaces/EmptyState.tsx`).
  - `PageHeader` accepts an `extras` prop (open `src/components/shared/page/PageHeader.tsx`).
  - `Tone` values used (`mint`/`peach`/`rose`/`teal`) exist in `src/components/shared/design-system.ts`.
  Adapt only the mismatching prop names; keep the structure.
- [ ] **Step 3: Verify** — `npm run typecheck` (exit 0); `npx eslint src/pages/student/StudentAttendancePage.tsx` (0 errors); `npx vite build` (exit 0).
- [ ] **Step 4: Commit** — `feat(attendance): student attendance calendar page`.

---

## Task 6: Wire route + sidebar + feature gate

**Files:** Modify `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/admin/institution-wizard/featuresData.ts`

- [ ] **Step 1: Route.** In `src/App.tsx`, add the import alongside the other student page imports (near `import StudentWeekPageV2 from "./pages/student/StudentWeekPageV2";`):
```tsx
import StudentAttendancePage from "./pages/student/StudentAttendancePage";
```
And add the route directly BELOW the `/student/my-week` route block (after its closing `} />` at line ~379, before the `/student/my-week-v2` redirect):
```tsx
          <Route path="/student/attendance" element={
            <ProtectedRoute allowedRoles={["student"]}>
              <StudentAttendancePage />
            </ProtectedRoute>
          } />
```

- [ ] **Step 2: Sidebar.** In `src/components/layout/AppSidebar.tsx`, the student "Academics" group (lines 590-599) currently holds only "My Week". Add the Attendance item after it:
```tsx
          {
            title: "My Week",
            url: "/student/my-week",
            icon: CalendarDays,
          },
          {
            title: "Attendance",
            url: "/student/attendance",
            icon: ClipboardCheck,
          },
```
(`ClipboardCheck` is already imported in this file — confirm via the lucide import block; if not, add it.)

- [ ] **Step 3: Feature gate.** In `src/components/admin/institution-wizard/featuresData.ts`, add to `FEATURE_URL_MAP` (after the `"/school/attendance": "attendance",` line ~66):
```ts
  "/student/attendance": "attendance",
```

- [ ] **Step 4: Verify** — `npm run typecheck`; `npx eslint src/App.tsx src/components/layout/AppSidebar.tsx src/components/admin/institution-wizard/featuresData.ts`; `npx vite build` — all clean.
- [ ] **Step 5: Commit** — `feat(attendance): route + sidebar + feature gate for student attendance tab`.

---

## Task 7: Full verification + final review + push

- [ ] **Step 1:** `npm run typecheck` (exit 0).
- [ ] **Step 2:** `npx eslint` on every file touched this feature (the tones module, widget, month hook, tab hooks, page, App.tsx, AppSidebar.tsx, featuresData.ts) → 0 errors.
- [ ] **Step 3:** `npx vite build` → exit 0.
- [ ] **Step 4:** Scale-gate walk (one-line verdict each): explicit staleTime on all 3 new queries · month query date-bounded, day query single-date, AY query RLS-scoped · no select("*") · no realtime/poll · no JWT-less getUser · index shipped (Task 1) · read-only (no mutations, so no toastError needed) · loading+empty+error states present.
- [ ] **Step 5:** Final whole-branch review; fix findings; push branch. Merge to main only after the user smoke-tests (open `/student/attendance` as a student: month/year nav, cell colors + event dots, tap-to-detail, summary, not-enrolled + feature-off behavior).

## Self-review notes (author)
- Spec §3 (extend hook additively) → Task 3; §4 (tone module) → Task 2; §5 (page) → Task 5; §6 (class/day/AY resolution) → Task 4; §8 (route/nav/gate) → Task 6; §9 (index) → Task 1; §10 (§23) → Task 7 gate. All spec sections covered.
- Type consistency: `DayAttendanceCode`/`CalEventLite` (hook) ↔ `CODE_TONES`/`EVENT_KIND` (tones) ↔ page/`DayDetail` props — names match. `StudentClassInfo`/`StudentDayRecord`/`AcademicYearOption` defined in Task 4, consumed in Task 5.
- Placeholder scan: the only `<ts>` is the migration timestamp, resolved in Task 1 to `20260706180000`. Tasks 4/5 carry explicit "confirm exports/props before finalizing" notes (real API-surface checks, not placeholders).
