# Student Attendance Calendar Tab — Design

- **Date:** 2026-07-06
- **Status:** Approved in brainstorming — pending spec review
- **Scope:** New student-portal tab `/student/attendance`: a monthly calendar (changeable month + year) where each date cell shows the student's own attendance status AND the school's academic-calendar entries (holidays, exam blocks, special events), with a tap-to-detail panel. Additive only.
- **Principle:** Reuse existing prior art; extend one hook additively (don't break the dashboard widget); no new backend surface except one index. Every read is already RLS-legal for students.

## 1. Summary

Students today can only see their attendance as a compact dashboard widget (`StudentAttendanceWidget`, holiday-only). This adds a dedicated **Attendance** tab: a full-page month calendar with month/year navigation, a per-month summary (present/late/absent/%), color-coded day cells (attendance status + a corner dot when a calendar event also falls that day), and a tap-to-detail panel listing the day's attendance status (+ remark) and every academic-calendar entry (holiday / exam block / special event) with its title.

## 2. Investigation findings that shaped this design (verified in code)

- **All reads are already student-legal (no RPC, no new RLS).**
  - `attendance_records` — RLS `"Students select own attendance"` (`student_id = auth.uid() AND has_role(...,'student')`, migration `20260225070945`). Status CHECK `('present','absent','late','sick','casual','holiday')`; one row per `(class_id, student_id, date)`; plain `DATE` column.
  - `cal_events` — RLS `cal_events_select_in_institution` (`institution_id = get_user_institution(auth.uid())`, migration `20260424100000:745`). Everyone in the institution reads; admins-only write. `kind IN ('holiday','exam_block','event')`; `title`, `starts_on`, `ends_on` (multi-day spans; `ends_on = starts_on` for single day), `color` (nullable, unused).
- **"Approved by admin/coordinator" = the admin-authored calendar.** There is NO approval/publish/status column on `cal_events` or `cal_academic_years`; a row's presence IS its visibility. Writes are admin-only (`AnnualCalendarPage.tsx:111` `canEdit = isSchoolAdmin || isSuperAdmin` — coordinators/teachers/students read-only). `tt_class_structure.publish_status` gates the *timetable*, not the calendar; the attendance tab needs no publish gate.
- **Strong prior art to extend/reuse:**
  - `src/hooks/useStudentMonthAttendance.ts` — student-scoped, month-bounded, merges attendance + holidays into `byDate: Map<'YYYY-MM-DD', DayAttendanceCode>` + counts + `percentage`. **Gap:** only queries `kind='holiday'`, discards exam blocks/events + titles. Query key `["student-month-attendance", user.id, fromStr, toStr]`.
  - `src/components/attendance/StudentAttendanceWidget.tsx` — the month-grid pattern (Sunday-first, `getDay()`-padded, `grid grid-cols-7 gap-1`, `aspect-square` cells, `w-8 h-8 sm:w-9 sm:h-9` chips, month prev/next with future-disable, legend, count pills). Consumes the hook. Stays as-is.
  - `src/pages/school/AnnualCalendarPage.tsx` — the calendar+detail layout precedent (`grid-cols-1 lg:grid-cols-3`, calendar spans 2, detail panel spans 1; year `Select` via `listAcademicYears(6)` + month prev/next; `EVENT_COLORS` per kind; `eventsByDate` map + dominant-priority).
- **Tone conventions (reuse verbatim):** solid day-cell chips (`StudentAttendanceWidget.tsx:26-34`) — present `bg-emerald-500/90 text-white`, late `bg-amber-500/90`, absent `bg-rose-500/90`, sick/casual `bg-violet-500/90`, holiday `bg-sky-500/90`. Event kinds (from `AnnualCalendarPage EVENT_COLORS`): holiday=rose/sky, exam_block=amber, event/special=teal. Letters: P/L/A/O(leave)/H.
- **Scale gap:** `attendance_records` has NO index leading with `student_id` (only `UNIQUE(class_id, student_id, date)` — class-leading — and `idx_attendance_records_substitution`). A per-student month range scan is unbacked. Add `(student_id, date)`.
- **Routing/nav:** no `/student/attendance` today. Student routes are `<Route path="/student/..." element={<ProtectedRoute allowedRoles={["student"]}>...}>` (`App.tsx:339+`, plain default imports, NOT `React.lazy`). Student sidebar items are built imperatively in `AppSidebar.tsx:588+` ("Academics" group holds only "My Week"). Feature `attendance` already exists (`featuresData.ts:38`); `FEATURE_URL_MAP` maps URL→feature and the sidebar auto-hides mapped URLs when the feature is off (`AppSidebar.tsx:141-147`).
- **Auth:** one plane, `useAuth().user.id`; students share the staff JWT (Olympiad is the only separate auth plane — irrelevant).

## 3. Data layer — extend `useStudentMonthAttendance` (additive)

Modify `src/hooks/useStudentMonthAttendance.ts`:

1. **Broaden the `cal_events` query** from `.eq("kind","holiday")` → `.in("kind", ["holiday","exam_block","event"])`, and select `starts_on, ends_on, kind, title` (add `title`).
2. **Keep the existing outputs unchanged** — `byDate`, `presentCount/lateCount/absentCount/excusedCount/holidayCount`, `percentage`, `totalGradedDays`, `daysInMonth`, `monthAnchor`. `byDate` still folds ONLY `kind='holiday'` rows as the holiday override (unchanged behavior → the widget is unaffected).
3. **Add one new output** `eventsByDate: Map<string, CalEventLite[]>` where `CalEventLite = { kind: 'holiday'|'exam_block'|'event'; title: string }`. Build it by expanding every fetched `cal_events` row across `eachDayOfInterval(parseISO(starts_on)..parseISO(ends_on))` (clamped to the month), pushing `{kind, title}` onto each covered `YYYY-MM-DD`. Multiple events on a day → array with all.
4. Query key gains no new dimension (same month range covers events). staleTime inherits the 60s global default. `institutionId` still resolved server-trust-free from `profiles.institution_id` (unchanged).

Export `CalEventLite`. The `DayAttendanceCode` type and existing shape are unchanged.

## 4. Shared tone module (DRY)

Create `src/components/attendance/attendanceTones.ts` exporting the day-cell tone map + letter map currently duplicated in `StudentAttendanceWidget`/`AttendanceHistoryView`:

```ts
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
  present:"Present", late:"Late", absent:"Absent", sick:"Sick leave",
  casual:"Casual leave", holiday:"Holiday", none:"No record",
};
// Event-kind chip tones (soft) for the corner dot + detail panel:
export const EVENT_KIND: Record<'holiday'|'exam_block'|'event', { label: string; dot: string; chip: string }> = {
  holiday:    { label: "Holiday",       dot: "bg-sky-500",  chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" },
  exam_block: { label: "Exam period",   dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  event:      { label: "Special event", dot: "bg-teal-500", chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300" },
};
```

Refactor `StudentAttendanceWidget` to import `CODE_TONES`/`CODE_LABEL` from here (drop its local copies) — a small, safe DRY cleanup that keeps the widget visually identical. (Do not touch `AttendanceHistoryView`'s single-letter `CodeChip` — different register, out of scope.)

## 5. The page — `src/pages/student/StudentAttendancePage.tsx`

Structure (top→bottom):

- **`PageShell` + `PageHeader`** — `icon={<ClipboardCheck/>}`, `title="Attendance"`, `subtitle` = `"{className}{section?} · {academicYear}"` (class resolved like §6). Header `extras`: an inline control cluster =
  - **Year `Select`** — options are the institution's **configured** academic years: the `cal_academic_years.code` rows for the student's institution (ordered newest-first), via a small `useInstitutionAcademicYears()` hook (`.select("code, starts_on, ends_on, is_active")`, RLS-readable, `staleTime: 60_000`). Fallback to `listAcademicYears(3)` (pure Apr–Mar generator) only if the school has configured no rows. Default = the active year (`is_active`), else `currentAcademicYear()`.
  - **Month prev / next** ghost icon buttons. Next is **disabled** when the visible month is the current month or later (mirrors `StudentAttendanceWidget.tsx:133-140`). Prev/next never cross out of the selected academic year's `[starts_on, ends_on]` range (buttons disable at the year's edges); to change year the student uses the Select.
  - **Single source of truth = `monthAnchor: Date` state.** Both controls mutate it; it's passed to the month hook. **Picking a year** sets `monthAnchor` to the most recent non-future month within that year: the current month if the year is ongoing (contains today), else that year's final in-range month (its `ends_on` month). The **academic-year string** (for the subtitle + class lookup, §6) is derived from `monthAnchor` by finding the `cal_academic_years` row whose `[starts_on, ends_on]` contains it (fallback: the Apr–Mar heuristic `currentAcademicYear`-style).
- **Summary strip** — `StatTileGrid` with `StatTile`s: Present, Late, Absent (counts), and Attendance % (`percentage`, or "—" when `totalGradedDays === 0`). Values from the hook for the visible month.
- **Calendar + detail** — a `grid grid-cols-1 lg:grid-cols-3 gap-4` block:
  - **Calendar card** (`lg:col-span-2`, `surface-card frosted-shadow rounded-card p-4`): single-letter weekday header row `["S","M","T","W","T","F","S"]`; a `grid grid-cols-7 gap-1` body with `getDay(startOfMonth)` leading blanks + `daysInMonth` cells. Each cell = an `aspect-square` button:
    - Attendance chip: `w-8 h-8 sm:w-9 sm:h-9 rounded-full` tinted by `CODE_TONES[byDate.get(iso) ?? 'none']`; shows the day-of-month number. `code==='none'` → neutral (`text-ink-700`, no fill).
    - **Event dot:** if `eventsByDate.get(iso)` is non-empty AND the cell code is not `holiday` (holiday already fills the cell), render a `absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full` dot colored by the highest-priority event kind present (priority `exam_block > event`; holiday never reaches here). Multiple events still one dot.
    - Today → `ring-1 ring-brand-primary/60`. Future days (`isAfter(day, today)`) → dimmed + not clickable.
    - Selected → `ring-2 ring-brand-primary`. `title` tooltip = `CODE_LABEL[code]` + event titles.
    - `onClick` sets `selectedIso`.
  - **Detail panel** (`lg:col-span-1`, `surface-card ... p-4`, stacks below on mobile): header = the selected date (`format(d,"EEEE, d MMM yyyy")`). Body:
    - Attendance row: a status chip (`EVENT_KIND`/attendance tone) + label from `CODE_LABEL`; if a remark exists show it (see §6 note on remarks). If no record and not a holiday → "No attendance recorded."
    - Events list: one row per `eventsByDate.get(selectedIso)` → an `EVENT_KIND[kind].chip` badge (label) + the event `title`.
    - If neither → `EmptyState size="sm"` "Nothing on this day."
  - Legend row under the calendar: attendance tones + the three event-kind dots.
- **Gating states** (in order): hook `isLoading` → `Skeleton`; not enrolled (no class resolved) → `EmptyState` "You're not enrolled in a class yet — ask your school admin to add you to a class."; hook `isError` → error `EmptyState` (rendered BEFORE any empty state, §6). A month with zero records/events still renders the (empty) grid — normal, not an error.

Default `selectedIso` = today (institution-local; §7) when the visible month is the current month, else null (nothing pre-selected).

## 6. Student class + institution resolution

- **Institution** — `profiles.institution_id` for `auth.uid()` (the hook already does this at `useStudentMonthAttendance.ts:64-69`; reuse for holiday scoping; the page needs it only indirectly).
- **Class label** (for the subtitle + not-enrolled gate) — reuse the `useStudentWeekV2(academicYear)` resolution shape (`class_assignments` where `role='student'`, pick the row whose `classes.academic_year === academicYear`), OR add a tiny dedicated `useStudentClass(academicYear)` hook returning `{ classId, className, classSection } | null`. Prefer a small dedicated hook (single responsibility; `useStudentWeekV2` also fetches timetable slots we don't need). It reads `class_assignments` → `classes(id,name,section,academic_year)`, `staleTime: 60_000`.
- **Remarks in the detail panel:** the extended month hook selects only `date, status` (no `remarks`). To show a remark on the selected day, the page issues a **single-row** fetch on demand — `attendance_records` `.select("status, remarks, classes:class_id(name, section)").eq("student_id", user.id).eq("date", selectedIso)` (bounded to one date, RLS-safe) — via a small `useStudentDayAttendance(dateIso)` hook (enabled only when `selectedIso` set). Keeps the month query lean while giving the detail panel the remark + which class marked it. (A student in multiple classes could have >1 row/day; render all.)

## 7. Timezone ("today")

Per §24, institution-local time is the source of truth. For this **read-only** calendar the "today" highlight and future-disable use **browser-local date** (`new Date()`), consistent with the codebase's documented India-only convention (`isPastCutoff` in `useStaffAttendance.ts` uses browser-local for the same reason). This is a conscious approximation: correct for all current (IST) deployments; the only symptom for a hypothetical non-IST school is the today-ring/future-disable being off by up to a day near midnight. No institution-timezone fetch is added. (If SALCI onboards a non-IST school, revisit here and in `isPastCutoff` together.)

## 8. Routing, nav, feature gating

- **Route** (`App.tsx`, student block ~`:339`, plain default import):
  ```tsx
  import StudentAttendancePage from "./pages/student/StudentAttendancePage";
  <Route path="/student/attendance" element={
    <ProtectedRoute allowedRoles={["student"]}><StudentAttendancePage /></ProtectedRoute>
  } />
  ```
- **Sidebar** (`AppSidebar.tsx`, student "Academics" group ~`:590-599`): add `{ title: "Attendance", url: "/student/attendance", icon: ClipboardCheck }` next to "My Week" (`ClipboardCheck` already imported).
- **Feature gate** (`featuresData.ts`): add `"/student/attendance": "attendance"` to `FEATURE_URL_MAP` (the `attendance` feature already exists). The sidebar filter then auto-hides the tab when the feature is off — same mechanism as the dashboard widget. The route stays role-gated only (consistent with `/student/my-week`, which is not hard-blocked when its feature is off — sidebar-hide is the product convention).

## 9. Migration — one index

`supabase/migrations/<ts>_attendance_records_student_date_idx.sql`:
```sql
CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date
  ON public.attendance_records (student_id, date);
```
Backs the per-student month range scan (the existing `UNIQUE(class_id, student_id, date)` is class-leading and doesn't serve it). Apply to prod via `scripts/run-sql.ps1`; verify via `pg_indexes`. Non-concurrent `CREATE INDEX` is fine (table small; brief write lock acceptable). No types regen needed (index only).

## 10. §23 / §24 compliance

Three new `useQuery`s (`useStudentClass`, `useStudentDayAttendance`, `useInstitutionAcademicYears`) get explicit `staleTime: 60_000`; the extended month hook keeps its inherited 60s. All are date/id/institution-bounded — the month query stays `.gte/.lte("date")` (≤31 rows), the day query is a single date, the class query is one student's assignments. No `select("*")` (explicit columns). No JWT-less `getUser` (identity from `useAuth`). No realtime, no `refetchInterval`. New FK/query index shipped in the same migration. Errors surfaced via error-state-before-empty-state; no `toast.error` (read-only page, no mutations). Loading + empty states present (UI/UX rules).

## 11. Component/file inventory

| File | Change |
|---|---|
| `src/hooks/useStudentMonthAttendance.ts` | MODIFY — broaden `cal_events` query to 3 kinds + `title`; add `eventsByDate` + export `CalEventLite`; existing outputs unchanged |
| `src/components/attendance/attendanceTones.ts` | CREATE — shared `CODE_TONES`/`CODE_LABEL`/`EVENT_KIND` |
| `src/components/attendance/StudentAttendanceWidget.tsx` | MODIFY — import tones from the shared module (visual no-op) |
| `src/hooks/useStudentClass.ts` | CREATE — `{classId, className, classSection}` for the derived AY |
| `src/hooks/useInstitutionAcademicYears.ts` | CREATE — `cal_academic_years` codes+ranges for the year Select (or inline in the page) |
| `src/hooks/useStudentDayAttendance.ts` | CREATE — single-date status + remark for the detail panel |
| `src/pages/student/StudentAttendancePage.tsx` | CREATE — the tab (header controls, summary, calendar, detail) |
| `src/App.tsx` | MODIFY — route |
| `src/components/layout/AppSidebar.tsx` | MODIFY — nav item |
| `src/components/admin/institution-wizard/featuresData.ts` | MODIFY — `FEATURE_URL_MAP` entry |
| `supabase/migrations/<ts>_attendance_records_student_date_idx.sql` | CREATE — index |

## 12. Non-goals / accepted gaps

- No new attendance write path (students are read-only by design/RLS).
- No institution-timezone fetch for the today-ring (India-only convention, §7).
- Dashboard `StudentAttendanceWidget` stays the compact summary; not merged into the page.
- No sub-tabs (calendar only, per brainstorming) — no separate "history/list" view (the existing 60-day `useUserAttendanceHistory` remains admin/teacher-facing).
- No per-period attendance (the table is daily; a student in multiple classes with >1 row/day renders all, last-write-wins in `byDate` for the cell fill, full list in the detail panel).
- No hard route-block when the feature is off (sidebar-hide + role-gate only, matching `/student/my-week`).
