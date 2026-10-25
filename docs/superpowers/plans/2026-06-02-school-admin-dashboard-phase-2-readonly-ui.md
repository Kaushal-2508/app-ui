# School-Admin Dashboard — Phase 2: Read-Only Dashboard UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Phase 1 (DB) is already applied to prod; all `dash_*` RPCs are live and typed in `src/integrations/supabase/types.ts`.

**Goal:** Replace the old `CommandCenterPage` (gradient KPIs + tabbed AlertsStrip/KpiRow/AcademicsPanel) with the new principal-first single-scroll dashboard — sticky header, KPI strip, five captioned widgets, four drill-down tables — consuming the Phase-1 RPCs. Frontend-only; no DB changes.

**Architecture:** Thin client over server-aggregated RPCs. One `useQuery` hook per RPC (explicit `staleTime`, §23). Two shared wrappers (`WidgetCard`, `DashboardTable`) make captions/click-hints/empty-states structural. Flags feed is a placeholder in Phase 2 (reads `dash_get_flags`, which returns `[]` until Phase 3). All chrome via existing primitives (`PageShell`, `PageHeader`, `StatTile`, `ListRow`, `EmptyState`, `MobileTabs`, `FilterRow`, recharts) and tokens (CLAUDE.md §20b). No gradient KPI cards, no top-level tabs.

**Tech Stack:** React 18 + TS, TanStack Query v5, recharts, shadcn/ui, Tailwind tokens.

---

## RPC return shapes (live in prod — consume these exactly)

```ts
// dash_kpi_summary() -> jsonb
{ attendance_today:{present:number,total:number,marked:boolean,pct:number|null,week_pct:number|null,prev_week_pct:number|null},
  school_avg:{pct:number|null,prev_pct:number|null,exams_count:number},
  students_need_help:{count:number,prev_count:number|null},
  decisions_waiting:{count:number} }
// dash_attendance_trend(p_days) -> { points:{date:string,present:number,total:number,pct:number|null}[], all_time_avg:number|null }
// dash_subject_performance(p_class_id) -> { has_data:boolean, subjects:{subject_id:string,subject_name:string,class_avg:number|null,school_avg:number|null}[] }
// dash_student_distribution() -> { doing_well:number,catching_up:number,needs_help:number,total:number,evaluated:number }
// dash_exam_trend(p_limit) -> { exam_id:string,title:string,exam_type:string,avg_pct:number|null,participation:number,exam_date:string }[]
// dash_subject_heatmap() -> { grouping:'wings'|'grade', rows:{band_label:string,cells:{subject_name:string,avg_pct:number,band:'red'|'amber'|'green'}[]}[] }
// dash_classes_table(p_filters,p_limit,p_offset) -> { rows:{class_id,name,students,attendance_30d:number|null,recent_avg:number|null,active_flags:number}[], total:number }
// dash_students_attention(p_weights,p_filters,p_limit,p_offset) -> { rows:{student_id,name,roll,class,band:'red'|'amber'|'yellow',reason:string,attendance:number|null,recent_pct:number|null,trend:'down'|'flat',active_flags:number}[], total:number }
// dash_teachers_table(p_filters,p_limit,p_offset) -> { rows:{user_id,name,role,wing:string|null,classes:number,attendance_30d:number|null,last_login:string|null,exams_30d:number,active_flags:number,is_new:boolean}[], total:number }
// dash_recent_exams(p_filters,p_limit,p_offset) -> { rows:{exam_id,title,status,exam_type,exam_date:string|null,subjects:string|null,classes:string|null,attempted:number,assigned:number,avg_pct:number|null,active_flags:number}[], total:number }
// dash_get_flags() -> Flag[]  (returns [] until Phase 3)
```

Call pattern: `const { data, error } = await supabase.rpc("dash_kpi_summary", {});` — the return is `Json`; cast through the typed interfaces in Task 1. RPC errors must be surfaced via `toastError` and a per-panel retry, never raw.

## File structure

```
src/hooks/dashboard/
  types.ts              all payload interfaces (Task 1)
  useDashboardData.ts   one hook per RPC (Task 1)
src/lib/dashboardConstants.ts            SEVERITY_WEIGHTS + band cutoffs (Task 1)
src/components/command-center/
  WidgetCard.tsx        title + chart slot + caption + click-hint + loading/empty/error (Task 2)
  DashboardTable.tsx    description + filters slot + top-10 + show-all + states (Task 2)
  KpiStrip.tsx, KpiTile.tsx                                        (Task 3)
  DashboardHeader.tsx                                              (Task 4)
  FlagsFeed.tsx         placeholder reading dash_get_flags         (Task 5)
  widgets/SubjectsByPerformanceWidget.tsx                          (Task 6)
  widgets/StudentDistributionWidget.tsx                            (Task 7)
  widgets/AttendanceTrendWidget.tsx                                (Task 8)
  widgets/ExamPerformanceTrendWidget.tsx                           (Task 9)
  widgets/ClassSubjectHeatmapWidget.tsx                            (Task 10)
  tables/ClassesTable.tsx, StudentsAttentionTable.tsx,
         TeachersTable.tsx, RecentExamsTable.tsx                   (Tasks 11-14)
src/pages/school/CommandCenterPage.tsx   rewritten composition    (Task 15)
# DELETE at cutover: src/components/command-center/{AlertsStrip,KpiRow,AcademicsPanel,QuickActions}.tsx
#                    src/hooks/useCommandCenter.ts (after confirming no other importers)
# KEEP: src/components/command-center/ReportModal.tsx (reached via header kebab)
```

Verification per task: `npx tsc --noEmit` (0), `npx eslint <changed files>` (no new errors), and after Task 15 `npx vite build` (0). Visual smoke at 375px + dark mode after Task 15.

---

## Task 1: Data types, hooks, constants

**Files:** Create `src/hooks/dashboard/types.ts`, `src/hooks/dashboard/useDashboardData.ts`, `src/lib/dashboardConstants.ts`

- [ ] **Step 1: types.ts** — declare the interfaces from the "RPC return shapes" block above (KpiSummary, AttendanceTrend, SubjectPerformance, StudentDistribution, ExamTrendItem, SubjectHeatmap, ClassesTableResult, StudentsAttentionResult, TeachersTableResult, RecentExamsResult, Flag). Export all.

- [ ] **Step 2: dashboardConstants.ts** — exported, tunable; mirrors the SQL defaults in `dash_score_students`:

```ts
export const SEVERITY_WEIGHTS = {
  attendance_gap: 30, bottom_quartile: 30, dropped_half: 25, flag_count: 15,
  min_score: 20, band_red: 55, band_amber: 35,
} as const;
// passed to dash_students_attention as p_weights so tuning needs no migration.
```

- [ ] **Step 3: useDashboardData.ts** — one hook per RPC. Pattern (repeat for each, with the typed cast and an explicit staleTime):

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { KpiSummary } from "./types";

export function useDashboardKpis() {
  return useQuery({
    queryKey: ["dash", "kpi"],
    staleTime: 60_000,
    queryFn: async (): Promise<KpiSummary> => {
      const { data, error } = await supabase.rpc("dash_kpi_summary", {});
      if (error) throw error;
      return data as unknown as KpiSummary;
    },
  });
}
```

Hooks to create (queryKey / rpc / params): `useDashboardKpis` (dash_kpi_summary); `useAttendanceTrend(days)` (dash_attendance_trend `{p_days:days}`, key `["dash","attTrend",days]`); `useSubjectPerformance(classId)` (dash_subject_performance `{p_class_id:classId}`, `enabled:!!classId`); `useStudentDistribution` (dash_student_distribution); `useExamTrend(limit=8)` (dash_exam_trend `{p_limit:limit}`); `useSubjectHeatmap` (dash_subject_heatmap); `useClassesTable(filters,limit,offset)` (dash_classes_table `{p_filters:filters,p_limit:limit,p_offset:offset}`); `useStudentsAttention(filters,limit,offset)` (dash_students_attention `{p_weights:SEVERITY_WEIGHTS,p_filters:filters,p_limit:limit,p_offset:offset}`); `useTeachersTable(filters,limit,offset)`; `useRecentExams(filters,limit,offset)`; `useDashboardFlags` (dash_get_flags). All `staleTime: 60_000` (§23).

- [ ] **Step 4:** `npx tsc --noEmit` → 0. Commit `feat(dashboard): Phase 2 data hooks + types + constants`.

---

## Task 2: WidgetCard + DashboardTable wrappers

**Files:** Create `src/components/command-center/WidgetCard.tsx`, `DashboardTable.tsx`

- [ ] **Step 1: WidgetCard** — the structural guarantee that every widget has a caption + click hint. Props:

```ts
interface WidgetCardProps {
  title: string;
  caption: string;        // mandatory — what to look for
  clickHint?: string;     // visible "Tap any … to see …" line
  isLoading?: boolean; isError?: boolean; onRetry?: () => void;
  isEmpty?: boolean; emptyTitle?: string; emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  headerSlot?: React.ReactNode;  // e.g. class picker / window toggle
  children: React.ReactNode;     // the chart
}
```
Render: `surface-card frosted-shadow rounded-card p-4 sm:p-5`. Header row: `h3 text-ink-900 text-base font-semibold` + `headerSlot` (right). Body: if `isLoading` → `<Skeleton className="h-56 w-full" />`; else if `isError` → an inline "Couldn't load — retry" with `onRetry` (use `EmptyState` reason error or a small inline block); else if `isEmpty` → `<EmptyState icon={BarChart3} title={emptyTitle} description={emptyDescription} action={emptyAction} />`; else `children`. Below the chart: `<p className="mt-3 text-sm text-ink-600">{caption}</p>` and, if `clickHint`, `<p className="mt-1 text-xs text-ink-500">{clickHint}</p>`. Caption + hint render only in the success (children) state.

- [ ] **Step 2: DashboardTable** — wrapper for the four tables. Props:

```ts
interface DashboardTableProps {
  title: string; description: string;
  filterSlot?: React.ReactNode;
  isLoading?: boolean; isError?: boolean; onRetry?: () => void;
  isEmpty?: boolean; emptyTitle?: string; emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  total: number; shown: number;
  onToggleShowAll?: () => void; showingAll?: boolean;
  children: React.ReactNode;  // the ListRow list
}
```
Render: section with `h2 text-ink-900` title, `p text-ink-600 text-sm` description, `filterSlot`, then states (skeleton list / error retry / EmptyState / children). Footer: if `total > shown` (or showingAll), a full-width ghost button "Show all (N)" / "Show less" calling `onToggleShowAll`.

- [ ] **Step 3:** `npx tsc --noEmit` → 0; `npx eslint` the two files. Commit `feat(dashboard): WidgetCard + DashboardTable wrappers`.

---

## Task 3: KPI strip

**Files:** Create `src/components/command-center/KpiTile.tsx`, `KpiStrip.tsx`

- [ ] **Step 1: KpiTile** — calm card, NO gradient. Props `{ eyebrow:string; value:string; sentence:string; onClick?:()=>void; tone?:Tone }`. Render `surface-card frosted-shadow rounded-card p-4`: `<p className="eyebrow">{eyebrow}</p>`, `<p className="text-[34px] sm:text-[40px] font-bold text-ink-900 leading-tight">{value}</p>`, `<p className="mt-1 text-sm text-ink-600">{sentence}</p>`. If `onClick`, make the whole tile a button with `focus-visible:ring-2 ring-brand-primary/40`.

- [ ] **Step 2: KpiStrip** — consumes `useDashboardKpis()`. Grid: `grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4`. While loading, four `<Skeleton className="h-28 rounded-card" />`. Build the four tiles with these EXACT interpretation rules (verbatim wording from spec):

  - **Today's attendance:** value = `marked ? \`${pct}%\` : "—"`. sentence: if `!marked` → "Mark attendance to see this"; else compare `week_pct` vs `prev_week_pct`: within ±1 → `\`${pct}% — same as last week\``; else `\`${pct}% — ${diff>0?'higher':'lower'} than last week\`` using `Math.round(week_pct-prev_week_pct)`; if prev_week_pct null → just `\`${pct}% today\``.
  - **School average this term:** value = `pct!=null ? \`${pct}%\` : "—"`; if null → "Publish an exam to see this"; else if `prev_pct==null` → `\`${pct}% this year\``; else within ±1 → `\`${pct}% — about the same as last year\``; else `\`${pct}% — ${pct>prev_pct?'slightly better':'lower'} than last year\``.
  - **Students who need help:** value = `String(count)`; if `count===0` → sentence "No students flagged right now"; else `prev_count==null` → `\`${count} students need help\``; else `\`${count} students — ${Math.abs(count-prev_count)} ${count>prev_count?'more':'fewer'} than last week\``.
  - **Decisions waiting for you:** value = `String(count)`; sentence `count===0 ? "Nothing waiting right now." : \`${count} things — tap to see the list.\``; `onClick` scrolls to the flags feed (`document.getElementById("dash-flags")?.scrollIntoView({behavior:"smooth"})`).

- [ ] **Step 3:** tsc 0; eslint. Commit `feat(dashboard): KPI strip with interpretation sentences`.

---

## Task 4: Sticky header

**Files:** Create `src/components/command-center/DashboardHeader.tsx`

- [ ] **Step 1:** Props `{ institutionName:string; logoUrl:string|null; onDownload:()=>void; onOpenCbseReports:()=>void; bannerSlot?:React.ReactNode }`. Render a sticky bar (`sticky top-0 z-20 app-bar-frost` — but note this sits inside AppLayout which already has a header; use a non-conflicting offset or a normal in-page header block, NOT a second fixed bar — render as a normal flex row at the top of the page content). Left: logo (`<img>` if logoUrl else a `GraduationCap` icon disc) + `h1 text-ink-900 text-xl font-bold` institutionName + a subtitle line with today's date (`new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})`). Center: `bannerSlot` (Phase 3 auto-create banner; null in Phase 2). Right: a "Last updated" placeholder text `text-xs text-ink-500` reading "Updated just now" (static in Phase 2; Phase 4 makes it live) + a primary `Button` "Download Report" (Download icon) calling `onDownload`, and a `PageHeader`-style kebab (or a small `DropdownMenu`) with one item "CBSE reports" calling `onOpenCbseReports`.

- [ ] **Step 2:** tsc 0; eslint. Commit `feat(dashboard): sticky dashboard header`.

---

## Task 5: Flags feed (Phase-2 placeholder)

**Files:** Create `src/components/command-center/FlagsFeed.tsx`

- [ ] **Step 1:** `<section id="dash-flags">`. Consumes `useDashboardFlags()`. Phase 2: the RPC returns `[]`, so render an `EmptyState` (icon `Flag`, title "Nothing needs your attention right now", description "Flags will appear here as your school uses SALCI — low attendance, overdue results, classes without a teacher, and more."). If data is non-empty (forward-compat), render a simple grouped list by `category` with title + description + a severity dot — but keep it minimal; the rich flag UI (lifecycle, task actions, banner) is Phase 3. Loading → skeleton.

- [ ] **Step 2:** tsc 0; eslint. Commit `feat(dashboard): flags feed placeholder (Phase 3 fills it)`.

---

## Tasks 6-10: Widgets

Each: a component consuming its hook, rendering a recharts chart inside `WidgetCard` with the **verbatim** caption + click hint below, cold-start via `WidgetCard.isEmpty`, and a click target. Recharts MUST use an explicit inline-height wrapper (`<div style={{width:"100%",height:256}}>`) per CLAUDE.md §20a. Colors via tokens (`hsl(var(--brand-primary))` etc.) — never rainbow. Use `useNavigate` for click targets; where a target route is uncertain, navigate to the closest existing analytics/detail route and leave a `// TODO(phase2): confirm exact drill route` — do NOT invent routes; grep `src/App.tsx` for the real paths first.

### Task 6: SubjectsByPerformanceWidget
**Files:** `src/components/command-center/widgets/SubjectsByPerformanceWidget.tsx`
- [ ] Needs the class list for the picker: query `classes` for the institution (`select id, name, section` where `institution_id` + `is_active`, ordered by name) via a small inline `useQuery` (or reuse an existing class-list hook if one exists — grep `useInstitutionClasses`/`useClasses`). Default to first class alphabetically; state `selectedClassId`. Picker in `WidgetCard.headerSlot` (a shadcn `Select`).
- [ ] Consume `useSubjectPerformance(selectedClassId)`. Render a horizontal recharts `BarChart` (`layout="vertical"`), one bar per subject = `class_avg`, sorted ascending (RPC already sorts), with a `ReferenceLine`/marker per bar for `school_avg` (use a thin `Bar` overlay or a custom dot; simplest: a second faint bar or a `<ReferenceLine>` is global — instead render a small tick: overlay a `Scatter`/custom shape at school_avg). Acceptable Phase-2 approach: bar = class_avg, plus a contrasting thin vertical tick drawn at school_avg via a custom bar `shape`. Keep readable.
- [ ] Caption (verbatim): "Bars at the top show the subjects this class is weakest in. The thin line on each bar shows the school's average — if a bar is much shorter than the line, this class is behind other classes in that subject."
- [ ] Click hint: "Tap any subject bar to see how each student is doing in that subject." On bar click → navigate to the class+subject student view (confirm route; fallback to the existing analytics drilldown).
- [ ] Cold-start: `has_data===false` → `isEmpty` with title "No exam data yet for this class." description + action "Create an exam" (navigate to exam creation).
- [ ] tsc/eslint; commit.

### Task 7: StudentDistributionWidget
**Files:** `widgets/StudentDistributionWidget.tsx`
- [ ] Consume `useStudentDistribution()`. recharts `PieChart` donut (innerRadius) with 3 segments: Doing well (`doing_well`, green token), Catching up (`catching_up`, amber token), Needs help (`needs_help`, red token). Center label = `total`. Segment label = count.
- [ ] Caption: "The red segment shows children who need extra help. Tap any segment to see those students."
- [ ] Click hint: "Tap a segment to see the list of students in that group." On segment click → set a shared "band filter" and scroll to the Students-needing-attention table (lift state to CommandCenterPage via a callback prop `onSelectBand(band)`).
- [ ] Cold-start: `evaluated < 10` → `isEmpty` title "Not enough exam data yet" description "This will show where your students stand once we have exam data from at least ten students."
- [ ] tsc/eslint; commit.

### Task 8: AttendanceTrendWidget
**Files:** `widgets/AttendanceTrendWidget.tsx`
- [ ] State `days` (30 default / 60 / 90), toggle via `MobileTabs` or three `FilterChip`s in `headerSlot`. Consume `useAttendanceTrend(days)`. recharts `LineChart`, single line of `pct` over `points`, plus a dashed `ReferenceLine y={all_time_avg}`.
- [ ] Caption: "Each point is one day's attendance. If the line is going down, attendance is dropping. The dotted line is your school's usual average."
- [ ] Click hint: "Tap the chart to see more detailed attendance reports." On click → navigate to the attendance analytics page (grep route, e.g. `/school/attendance`).
- [ ] Cold-start: `points.length < 14` → `isEmpty` title "Not enough attendance yet" description "This will appear once you have 14 days of attendance recorded." action "Mark attendance".
- [ ] tsc/eslint; commit.

### Task 9: ExamPerformanceTrendWidget
**Files:** `widgets/ExamPerformanceTrendWidget.tsx`
- [ ] Consume `useExamTrend(8)`. recharts vertical `BarChart`, bar = `avg_pct` per exam, chronological. Color by `exam_type` for DISTINCTION only (map term/unit/weekly/unspecified → four distinct non-severity tokens, e.g. `--chart-1..4`). Tooltip shows title, date, participation, avg.
- [ ] Caption: "Each bar is one test. If bars are getting taller over time, marks are improving across the school."
- [ ] Click hint: "Tap any bar to see that exam's full results." On bar click → navigate to that exam's results page (grep route).
- [ ] Cold-start: `< 2` items → `isEmpty` title "Not enough exams yet" description "This appears once you have at least two published exams."
- [ ] tsc/eslint; commit.

### Task 10: ClassSubjectHeatmapWidget (full width)
**Files:** `widgets/ClassSubjectHeatmapWidget.tsx`
- [ ] Consume `useSubjectHeatmap()`. Build a grid: union of all `cells[].subject_name` across rows = columns; rows = `rows[].band_label`. Each cell = the `avg_pct` (large, readable) on a tinted background by `band` (red/amber/green tokens). Empty cell (subject not in that band) → muted dash. Horizontal scroll on mobile (`overflow-x-auto`). NOT recharts — a CSS grid/table.
- [ ] Caption: "Red boxes show where a group of classes is weak in a subject. Green boxes show where they're doing well."
- [ ] Click hint: "Tap any box to see the classes in that group, in that subject." On cell click → navigate to a filtered class+subject view (grep route; fallback analytics).
- [ ] Cold-start: `rows.length === 0` → `isEmpty` title "No exam data yet" description "This grid fills in once classes have published exams."
- [ ] tsc/eslint; commit.

---

## Tasks 11-14: Tables

Each: consumes its paginated hook with `limit=10, offset=0` and a `showAll` toggle (when on, `limit=100`); renders rows as `ListRow` (mobile-first) inside `DashboardTable` with the verbatim above-table description; row click via `useNavigate` (grep real routes, no invention). Filters via `FilterRow`/`FilterChip` (≤2) or `FilterSheet` (≥3). Numbers like attendance/avg render `value ?? "—"`.

### Task 11: ClassesTable
**Files:** `tables/ClassesTable.tsx` — `useClassesTable`. Description: "All your classes, with the ones needing most attention at the top." Row: `ListRow` title=`name`, subtitle=`\`${students} students · ${attendance_30d ?? '—'}% attendance\``, trailing=`recent_avg ?? '—'%` + flag count badge if `active_flags>0`. Filters: wing (grep a wings hook), "only classes with flags" chip (`p_filters.only_flagged`). Row click → class detail route. Commit.

### Task 12: StudentsAttentionTable
**Files:** `tables/StudentsAttentionTable.tsx` — `useStudentsAttention`. Accepts an optional `bandFilter` prop (set by the distribution widget). Description: "Students who may need extra help, based on attendance, recent marks, and any drop in performance." Row: `ListRow` leading = a colored dot (red/amber/yellow per `band`), title=`name`, subtitle=`reason` (+ `\`Roll ${roll} · ${class}\``), trailing=`\`${recent_pct ?? '—'}%\`` with an up/down arrow from `trend`. Filters: class, severity ("All who need attention"/"Only red"/"Red and amber" → `p_filters.band`). Row click → student passport route. **Note:** in current prod this is empty (attendance cold-start) — that's expected; show `EmptyState` "No students need attention right now." Commit.

### Task 13: TeachersTable
**Files:** `tables/TeachersTable.tsx` — `useTeachersTable`. Description: "All teachers and staff, with anyone needing attention at the top." Row: title=`name`, subtitle=`\`${role}${wing?` · ${wing}`:''} · ${classes} classes\``, trailing = last-login text from `last_login` (humanize: "today"/"N days ago"/"Never"; amber after 3 days, red after 7 — colour the text). Show `exams_30d` + flag badge. Filters: role multi (teacher/coordinator/employee → `p_filters.roles`), wing. Row click → teacher detail route. Commit.

### Task 14: RecentExamsTable
**Files:** `tables/RecentExamsTable.tsx` — `useRecentExams`. Description: "Recent exams across the school. Tap any row to see results." Row: title=`title`, subtitle=`\`${classes ?? ''}${subjects?` · ${subjects}`:''}\``, trailing = status label (map raw status → "Scheduled"/"In progress"/"Waiting for grading"/"Results published") + `\`${attempted} of ${assigned} attempted\`` + `avg_pct ?? "Not graded yet"`. Filters: status, class, subject (use `FilterSheet`, ≥3). Row click → exam results route. Commit.

---

## Task 15: Compose CommandCenterPage + cutover

**Files:** Modify `src/pages/school/CommandCenterPage.tsx`; delete old sub-components.

- [ ] **Step 1:** Rewrite `CommandCenterPage` to render, inside `PageShell`:
  1. `<DashboardHeader institutionName logoUrl onDownload onOpenCbseReports />` (institution name/logo: reuse the value the old page used — grep how `data.institutionName`/`institutionId` were sourced; likely `useUserRole`/an institution hook).
  2. `<KpiStrip />`
  3. `<FlagsFeed />`
  4. Widgets grid: row1 `SubjectsByPerformanceWidget` + `StudentDistributionWidget` (`grid lg:grid-cols-2 gap-4`); row2 `AttendanceTrendWidget` + `ExamPerformanceTrendWidget`; row3 `ClassSubjectHeatmapWidget` (full width). Single column on mobile.
  5. Tables stacked: `ClassesTable`, `StudentsAttentionTable` (wired to the distribution widget's `onSelectBand` via lifted state), `TeachersTable`, `RecentExamsTable`.
  6. Keep `ReportModal` mounted, opened by the header's "CBSE reports" kebab item (`onOpenCbseReports`). The header's primary "Download Report" wires to `onDownload` → for Phase 2, open the same `ReportModal` (the new snapshot report is Phase 4); leave a `// TODO(phase4): swap to DashboardSnapshotReport`.
- [ ] **Step 2:** Delete `AlertsStrip.tsx`, `KpiRow.tsx`, `AcademicsPanel.tsx`, `QuickActions.tsx`. Grep each for other importers first; if only `CommandCenterPage` imported them, delete. Grep `useCommandCenter` importers; if only this page, delete `src/hooks/useCommandCenter.ts` (and confirm its sub-hooks like `usePrincipalOverview` aren't used elsewhere — if they are, leave them).
- [ ] **Step 3:** `npx tsc --noEmit` → 0; `npx eslint` all new/changed files → no new errors; `npx vite build` → 0.
- [ ] **Step 4:** Visual smoke (run the app, log in as a school admin for Alliance International if possible): the dashboard loads; KPI strip shows real numbers + sentences; widgets render with captions + click hints visible; tables show data; the parent-meeting path works (pick a class in Subjects widget → click weakest subject bar → ranked students → student → passport). At 375px: no horizontal scroll, KPI 2×2, captions/hints visible. Toggle dark mode: backdrop/cards/text/shadows flip.
- [ ] **Step 5:** Commit `feat(dashboard): compose new read-only Command Center + retire old gradient/tab UI`.

---

## Self-review (author)
**Spec coverage:** sticky header ✓(T4); KPI strip + interpretation sentences + cold-start ✓(T3); flags feed (placeholder, Phase 3 fills) ✓(T5); 5 widgets with mandatory captions + visible click hints + cold-start + click targets ✓(T6-10); 4 tables with above-table descriptions + filters + show-all + row click ✓(T11-14); progressive reveal via independent useQuery + per-panel WidgetCard/DashboardTable states ✓; mobile + dark via tokens ✓; no gradient KPIs / no tabs / captions mandatory (structural via WidgetCard) ✓. Realtime trust signal + snapshot report = Phase 4 (header shows static "Updated just now" + reuses ReportModal meanwhile). Flag lifecycle/auto-task/banner = Phase 3.
**Placeholder scan:** the only deliberate deferrals are click-route confirmations (executor greps `src/App.tsx` for real routes — explicit instruction, not invented) and the Phase-3/4 TODOs (banner slot, snapshot report, live last-updated). No silent gaps.
**Type consistency:** hook return types (Task 1) match the RPC shapes and are consumed unchanged by every widget/table. `onSelectBand` lifted state connects StudentDistributionWidget → StudentsAttentionTable consistently.
**Risk:** the subjects widget's per-bar school-average marker is the fiddliest recharts bit — acceptable to render as a thin overlay tick; correctness of the comparison matters more than pixel-perfection.
