# Student Mobile UI Redesign — Implementation Plan (Phase 8)

> Pure UI work over Phase 5/7 primitives. Zero data-flow changes. Every task validates with `npx tsc --noEmit` exit 0, `npx eslint <touched paths>` zero new errors, and `npx vite build` exit 0. Pre-existing repo `any` errors out of scope (CLAUDE.md §5a).

**Goal.** Bring the student-facing surfaces onto the same mobile-first design language already shipped to teachers (Phase 5) and school-admins (Phase 7). The brand directive is explicit: **the gradient backdrop + the 12 shared primitives are the baseline for every page in the portal, regardless of role.**

**Scope.** Eight student surfaces + one shared appointment dialog + one shared appointments page (used by both teacher and student). The actual exam-taking interface inside `ExamAttemptPage` is OUT of scope; only the pre-exam landing card and the proctoring consent dialog are touched.

**Architecture.** Each task is a self-contained primitive swap on one file: imports → JSX rewrite → validation triple → commit. Hooks (`useQuery`, `useMutation`), routes, and dialog state machines are byte-identical before/after. Pattern repeats Phase 5 Task 17 / Phase 7 Tasks 28–33.

**Tech Stack.** React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query v5 (untouched), `lucide-react`, `recharts` for charts. Shared primitives at `src/components/shared/{page,surfaces,nav,sheets}/` — see `.claude/CLAUDE.md` §20a.

**Layout invariant (carried over from Phase 7).** `ProtectedRoute` already wraps children in `<AppLayout>`. Pages must NOT import or render `<AppLayout>` themselves.

**Parallelization.** Tasks 35, 36, 37, 38, 42 are independent files and can run in parallel. Tasks 39 + 41 share `BookAppointmentDialog`/`ExamAttemptPage`, so they should run sequentially. Task 43 (CLAUDE.md note) runs last.

---

## File Structure

**Modified files:**

```
src/
  pages/
    student/
      StudentResultsPage.tsx                    # Task 35
      StudentReportsPage.tsx                    # Task 36
      StudentExamsPage.tsx                      # Task 37
      StudentWeekPageV2.tsx                     # Task 39 (PageShell wrap only)
      ExamAttemptPage.tsx                       # Task 41 (landing + consent only)
      StudentRechecksPage.tsx                   # Task 42
      StudentStudyMaterialsPage.tsx             # Task 42
      StudentFeesView.tsx                       # Task 42
    school/
      AppointmentsPage.tsx                      # Task 39
  components/
    dashboards/
      ComprehensiveStudentDashboard.tsx         # Task 38
    analytics/
      StudentAnalyticsDashboard.tsx             # Task 42
    appointments/
      BookAppointmentDialog.tsx                 # Task 40
.claude/
  CLAUDE.md                                     # Task 43
```

**New files:** none. Phase 8 is composition-only.

---

# Phase 8 — Student surfaces

## Task 35: StudentResultsPage redesign

**Files:** `src/pages/student/StudentResultsPage.tsx` (~225 lines).

**Symptoms (screenshot):** four sparse full-width KPI cards (Total/Passed/Failed/Average) — each occupies one row at 375 px when they should be a 2×2 `StatTileGrid`. Exam result cards have a three-button action row (View Report / Details / Recheck) that clips at the right edge.

- [ ] **Step 35.1: Add imports**

```tsx
import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { Trophy, CheckCircle2, AlertCircle, BarChart3, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
```

- [ ] **Step 35.2: Replace the page wrapper**

Wrap the whole return in `<PageShell><PageHeader icon={<Trophy/>} title="My Results" subtitle="View your exam results and grades" /> ... </PageShell>`. Remove the freestanding `<h1>My Results</h1>` block.

- [ ] **Step 35.3: Replace the four-card stats grid with StatTileGrid**

```tsx
<StatTileGrid mdCols={4}>
  <StatTile label="Total Results" value={formatNumber(results?.length || 0)} icon={<BarChart3 className="h-5 w-5" />} tone="teal" />
  <StatTile label="Passed" value={formatNumber(passCount)} icon={<CheckCircle2 className="h-5 w-5" />} tone="mint" />
  <StatTile label="Failed" value={formatNumber(failCount)} icon={<AlertCircle className="h-5 w-5" />} tone="rose" />
  <StatTile label="Average" value={`${avgPercentage}%`} icon={<Trophy className="h-5 w-5" />} tone="violet" />
</StatTileGrid>
```

- [ ] **Step 35.4: Convert exam result cards to compact card with kebab actions**

Each exam result becomes a single `surface-card` block. The three action buttons (View Report / Details / Recheck) collapse into a kebab `DropdownMenu` on mobile. Keep the percentage display, grade badge, and pass/fail badge prominent. Keep the `<Progress>` bar.

- [ ] **Step 35.5: Empty state via `<EmptyState>`** — replace the empty Card with `<EmptyState icon={<Trophy/>} title="No results yet" description="Your exam results will appear here once published" />`.

- [ ] **Step 35.6: Validation triple + commit**

Commit message:

```
feat(ui): redesign Student Results with shared primitives

PageShell+PageHeader wrap. Four sparse KPI cards collapse into a
2×2 StatTileGrid. Exam result cards keep score+grade prominent and
move the three-action button row (View Report / Details / Recheck)
behind a kebab so the right edge no longer clips at 375px.

No data-flow changes.
```

---

## Task 36: StudentReportsPage redesign

**Files:** `src/pages/student/StudentReportsPage.tsx` (~197 lines).

**Symptoms:** custom four-card stats row with mixed bg-color discs (primary/amber/green/blue) — should be standardized `StatTile` with the brand tone vocabulary. The 4th tile cramps an "X% pass" badge next to the value. Header has Time Range + Subject + Download Report selectors that need `FilterRow`/`PageHeader.actions` treatment on mobile.

- [ ] **Step 36.1: Add imports**

```tsx
import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { FilterRow } from "@/components/shared/nav";
```

- [ ] **Step 36.2: Wrap with PageShell + PageHeader**

Replace the `<div className="container py-6 space-y-6">` outer with PageShell. Move the title + subtitle into PageHeader. The Download Report button moves to `PageHeader.primaryAction` (icon: Download).

- [ ] **Step 36.3: Time Range + Subject filters into FilterRow**

```tsx
<FilterRow>
  <Select value={timeRange} onValueChange={setTimeRange}>...</Select>
  {subjects.length > 0 && <Select value={subjectFilter} onValueChange={setSubjectFilter}>...</Select>}
</FilterRow>
```

- [ ] **Step 36.4: Standardize the four KPI tiles via StatTile**

```tsx
<StatTileGrid cols={2} mdCols={4}>
  <StatTile label="Accuracy" value={`${analytics?.overallAccuracy?.toFixed(1) || 0}%`} icon={<Target className="h-5 w-5" />} tone="teal" />
  <StatTile label="Avg Time/Q" value={`${analytics?.avgTimePerQuestion?.toFixed(0) || 0}s`} icon={<Clock className="h-5 w-5" />} tone="peach" />
  <StatTile label="Efficiency" value={analytics?.efficiencyScore?.toFixed(2) || 0} icon={<Zap className="h-5 w-5" />} tone="mint" />
  <StatTile label="Exams Taken" value={analytics?.totalExams || 0} icon={<Trophy className="h-5 w-5" />} tone="violet" delta={undefined} />
</StatTileGrid>
```

The "X% pass" sub-badge is dropped from the 4th tile (the data is also derivable from passRate elsewhere on the page if needed). If the user really needs it, render a small `<Badge>` on the next line below the StatTileGrid — don't cram it into the tile.

- [ ] **Step 36.5: Validation triple + commit**

```
feat(ui): redesign Student Performance Reports with shared primitives

PageShell+PageHeader chrome (Download Report becomes the primary
action). Four mixed-color stat cards standardize on StatTile with
the brand tone vocabulary. Time Range + Subject selectors collapse
into FilterRow on mobile; the cramped 4th-tile pass-rate sub-badge
is dropped — the same value is derivable elsewhere.

No data-flow changes.
```

---

## Task 37: StudentExamsPage redesign

**Files:** `src/pages/student/StudentExamsPage.tsx` (~321 lines).

**Symptoms:** three KPI cards (Upcoming/In Progress/Completed) with role-specific text colors. The Upcoming Exams grid mixes detail + countdown + study material indicator + "Click for details" microcopy in one card — works at desktop, cramped on mobile. The Missed Exams section uses a loud destructive-red border-and-fill that competes with the rest of the page.

- [ ] **Step 37.1: Add imports**

```tsx
import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { Calendar, PlayCircle, Clock, FileText, BookOpen, Timer } from "lucide-react";
```

- [ ] **Step 37.2: Wrap with PageShell + PageHeader**

```tsx
<PageShell>
  <PageHeader icon={<Calendar className="h-5 w-5" />} title="My Exams" subtitle="View and attempt your scheduled exams" />
  ...
</PageShell>
```

- [ ] **Step 37.3: Three-tile StatTileGrid**

```tsx
<StatTileGrid cols={3} mdCols={3}>
  <StatTile label="Upcoming" value={upcomingExams.length} icon={<Calendar />} tone="sky" />
  <StatTile label="In Progress" value={inProgressExams.length} icon={<Clock />} tone="peach" />
  <StatTile label="Completed" value={completedExams.length} icon={<FileText />} tone="mint" />
</StatTileGrid>
```

- [ ] **Step 37.4: Upcoming exam cards stay as cards but tone down the chrome**

Keep the existing card layout for upcoming exams (it carries genuinely useful per-card metadata: countdown, time, study material count). Remove the `border-amber-200` In-Progress alert card's loud styling — switch to neutral surface-card with a small amber chip.

- [ ] **Step 37.5: Missed Exams — neutral card with subtle red accent**

Replace `border-destructive/30 bg-destructive/5 opacity-80` with a neutral `surface-card` and a small red "Missed" `Badge` in the trailing slot. Move the "Missed Exams" heading color from `text-destructive` to `text-ink-900` — the badge carries the warning tone.

- [ ] **Step 37.6: EmptyState for the no-upcoming-exams branch.**

- [ ] **Step 37.7: Validation triple + commit**

```
feat(ui): redesign Student Exams list with shared primitives

PageShell+PageHeader. Three KPI cards converge on StatTile with the
brand tones. The In-Progress alert and Missed Exams sections stop
shouting — neutral surface-cards with small amber/red chips replace
the full-card destructive backgrounds. EmptyState replaces the bare
"No upcoming exams" Card. Per-card upcoming-exam content (countdown,
time, study materials) preserved.

No data-flow changes.
```

---

## Task 38: ComprehensiveStudentDashboard redesign

**Files:** `src/components/dashboards/ComprehensiveStudentDashboard.tsx` (~584 lines).

**Symptoms:** the four `GradientKPICard` quartet (Percentile Rank purple / Consistency orange / Pass Rate emerald / Exams Taken blue) is exactly the loud full-bleed style Phase 5 spec deprecated for `StatTile`. Overview/Subjects/Study Tips sub-tabs are shadcn `<TabsList>` and clip at 375 px. The Subject-wise Scores horizontal `BarChart` doesn't size correctly inside its card on mobile (the bars don't render at all in the screenshot — recharts `ResponsiveContainer` height issue when the parent is `h-64` inside a flex column with no explicit height). The "How You Compare" 5-column table clips at the right edge.

- [ ] **Step 38.1: Add imports**

```tsx
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
```

Drop `GradientKPICard` import (and the `Tabs, TabsContent, TabsList, TabsTrigger` imports if no longer referenced after Step 38.4).

- [ ] **Step 38.2: Replace the four GradientKPICard quartet with StatTileGrid**

```tsx
<StatTileGrid cols={2} mdCols={4}>
  <StatTile label="Percentile Rank" value={`${data.metrics.percentileRank.toFixed(0)}th`} icon={<Target className="h-5 w-5" />} tone="violet" />
  <StatTile label="Consistency" value={`${data.metrics.consistencyScore.toFixed(0)}%`} icon={<Clock className="h-5 w-5" />} tone="peach" />
  <StatTile label="Pass Rate" value={`${data.metrics.passRate.toFixed(0)}%`} icon={<CheckCircle2 className="h-5 w-5" />} tone="mint" />
  <StatTile label="Exams Taken" value={data.metrics.totalExams} icon={<BarChart3 className="h-5 w-5" />} tone="sky" />
</StatTileGrid>
```

- [ ] **Step 38.3: Convert sub-tabs to MobileTabs**

```tsx
const [activeSubTab, setActiveSubTab] = useState<"overview" | "subjects" | "insights">("overview");

<MobileTabs
  value={activeSubTab}
  onValueChange={(v) => setActiveSubTab(v as typeof activeSubTab)}
  options={[
    { value: "overview", label: "Overview" },
    { value: "subjects", label: "Subjects" },
    { value: "insights", label: "Study Tips" },
  ]}
/>
```

Replace the three `<TabsContent>` siblings with conditional rendering: `{activeSubTab === "overview" && (...)}` etc.

- [ ] **Step 38.4: Fix Subject-wise Scores chart sizing**

The `<div className="h-64">` wrapper is correct, but on mobile the parent `<div className="grid md:grid-cols-2 gap-6">` collapses to one column and the chart inherits the card's content padding. Confirm the `<div className="h-64">` is a direct child of `<CardContent>` with no flex shrink quirks. If the bars still don't render in DevTools at 375 px, switch the BarChart's `layout` from `vertical` to `horizontal` for narrow viewports — at 375 px, vertical bars with truncated category labels read better than tiny horizontal bars.

Concrete fix: replace the chart wrapper with a width-aware variant — either:
- `min-h-[256px] w-full` instead of `h-64` (recharts ResponsiveContainer needs an explicit numeric height when its parent is flex/grid), OR
- wrap in `<div style={{ width: "100%", height: 256 }}>` (bypasses Tailwind's potential flex-basis gotcha).

Test on real device.

- [ ] **Step 38.5: Replace the How You Compare table with ListRow rows**

The 5-column table (Metric / You / Class Avg / Topper / Remark) is the worst-clipping element on the page. Convert each row to a `ListRow`:

```tsx
{data.classComparison.map((row, idx) => (
  <ListRow
    key={idx}
    title={<span className="font-medium">{row.metric}</span>}
    subtitle={
      <span className="flex items-center gap-3 text-xs text-ink-600 tabular-nums">
        <span><span className="font-bold text-ink-900">{row.you.toFixed(1)}</span> you</span>
        <span>{row.classAvg.toFixed(1)} avg</span>
        <span className="text-emerald-600">{row.topper.toFixed(1)} top</span>
      </span>
    }
    trailing={<Badge variant={row.remarkVariant}>{row.remark}</Badge>}
  />
))}
```

(The exact prop name for the remark variant differs in the file — preserve the existing logic.)

- [ ] **Step 38.6: Validation triple + commit**

```
feat(ui): redesign Comprehensive Student Dashboard with shared primitives

Replace the four loud GradientKPICard tiles (Percentile/Consistency/
Pass Rate/Exams Taken) with neutral StatTile in the brand tone
vocabulary. Swap shadcn Tabs for MobileTabs scroll-snap pills
(resolves Overview/Subjects/Study Tips clipping at 375px). Convert
the five-column "How You Compare" table to ListRow rows so the
right edge no longer clips. Fix the Subject-wise Scores chart
height so bars render on mobile.

No data-flow changes.
```

---

## Task 39: StudentWeekPageV2 + AppointmentsPage shell wrap

**Files:**
- `src/pages/student/StudentWeekPageV2.tsx` (~83 lines)
- `src/pages/school/AppointmentsPage.tsx` (~83 lines)

**Symptoms:** StudentWeekPageV2 renders a hand-rolled gradient-icon header instead of PageShell+PageHeader. The TimetableGridV2 horizontal scroll already works (sticky day column + scrollable periods), but the surrounding chrome is inconsistent. AppointmentsPage has the title + Book Appointment button colliding at 375 px.

> Note: TimetableGridV2 is shared with the teacher view (already redesigned in Phase 5). Don't touch it here — it's known good.

- [ ] **Step 39.1: StudentWeekPageV2 — wrap with PageShell + PageHeader**

```tsx
import { PageShell, PageHeader } from "@/components/shared/page";
import { CalendarClock, CalendarX2 } from "lucide-react";

<PageShell>
  <PageHeader
    icon={<CalendarClock className="h-5 w-5" />}
    title="My week"
    subtitle={data?.className ? `${data.classSection ? `${data.className} – ${data.classSection}` : data.className} · ${academicYear}` : academicYear}
  />
  <div className="mt-4">
    {/* existing alert / loading / TimetableGridV2 branches */}
  </div>
</PageShell>
```

- [ ] **Step 39.2: AppointmentsPage — PageShell + PageHeader; book button → primaryAction**

The student branch's title-and-button collision resolves by moving the Book Appointment button into `PageHeader.primaryAction`. Use the hidden-trigger ref pattern from Phase 5 Task 17 if `BookAppointmentDialog` doesn't expose controlled `open`/`onOpenChange` props (Step 39.3 will check). The teacher branch gets the same shell wrap with no primary action.

- [ ] **Step 39.3: Verify BookAppointmentDialog props**

Check `BookAppointmentDialog.tsx` — if it self-manages `open` state (it does, per the survey), the cleanest path is to give it a `ref` exposing `openDialog()`, OR (simpler) refactor it to accept an external trigger via the hidden `<DialogTrigger>` pattern. Since Task 40 is going to migrate this dialog to `MobileSheet` anyway, prefer to do that work in Task 40 first and have Task 39 land second so the AppointmentsPage trigger pattern uses the new sheet API.

> **Sequencing:** Task 40 lands BEFORE Task 39 to avoid rework.

- [ ] **Step 39.4: Validation triple + commit**

```
feat(ui): redesign Student Week + Appointments with PageShell

Apply PageShell + PageHeader to StudentWeekPageV2 and AppointmentsPage
(both teacher and student branches). The student-side
"My Appointments" + Book Appointment button collision at 375px
resolves by promoting Book Appointment to PageHeader.primaryAction.
TimetableGridV2 itself is shared with the teacher view and untouched.

No data-flow changes.
```

---

## Task 40: BookAppointmentDialog → MobileSheet

**Files:** `src/components/appointments/BookAppointmentDialog.tsx` (~95 lines).

**Symptoms:** raw shadcn `Dialog` with self-managed open state. The Date input renders as a thin empty bar on iPhone Safari (the iOS date input invisible-text bug, which `MobileSheet` doesn't fix — but the global CSS rule in `src/index.css` `input[type="date"]::-webkit-datetime-edit` already does, per CLAUDE.md §20a). Submit button is full-width with mismatched contrast.

- [ ] **Step 40.1: Migrate to MobileSheet**

Use `MobileSheet` from `@/components/shared/sheets`. Expose a controlled `open`/`onOpenChange` prop on the component so the parent (AppointmentsPage / future callers) can drive it via `PageHeader.primaryAction`.

```tsx
interface BookAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BookAppointmentDialog({ open, onOpenChange }: BookAppointmentDialogProps) {
  // ... existing form state ...
  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Book an Appointment"
      primaryAction={{
        label: "Submit Request",
        onClick: handleSubmit,
        disabled: createAppointment.isPending || !teacherId || !date || !purpose.trim(),
        loading: createAppointment.isPending,
      }}
    >
      {/* form fields */}
    </MobileSheet>
  );
}
```

Drop the `<DialogTrigger>` — the parent now handles triggering.

- [ ] **Step 40.2: Form fields layout**

Stack the form fields vertically with `space-y-4` inside the sheet. Keep the Start Time / End Time as a 2-column inner grid. Verify the Date input shows its placeholder correctly on iOS Safari at 375 px (the global CSS rule should handle it).

- [ ] **Step 40.3: Validation triple + commit**

```
feat(ui): migrate Book Appointment to MobileSheet

Replace shadcn Dialog with MobileSheet (sheet-based bottom presentation
on mobile, regular dialog on desktop). Expose controlled open/onOpenChange
so callers can wire the trigger to PageHeader.primaryAction. Drop the
internal DialogTrigger button — parent now controls visibility.

No data-flow changes; mutation, query, and form state untouched.
```

---

## Task 41: ExamAttemptPage — start landing + proctoring consent

**Files:** `src/pages/student/ExamAttemptPage.tsx` (~1415 lines, but only ~150 lines of changes — pre-exam UI only).

**Symptom (screenshots):** the pre-attempt landing card with date/time/duration/marks list and Start Exam Now CTA isn't wrapped in PageShell — the page sits on a flat grey backdrop instead of the brand gradient. The proctoring consent dialog uses raw shadcn `Dialog` with full-bleed margins on mobile.

> **Out of scope:** the actual exam-taking interface (the question + navigator + camera preview screens). Those screens have load-bearing fullscreen+proctoring behavior and warrant their own design pass.

- [ ] **Step 41.1: Wrap the pre-attempt landing branch with PageShell**

Locate the branch that renders before `state.attemptId` is set (the "Start Exam Now" card). Wrap with `<PageShell>`. Don't add a PageHeader here — the exam title functions as the header.

- [ ] **Step 41.2: Migrate proctoring consent dialog to MobileSheet**

The dialog at line ~1200 (`This online exam requires proctoring...`) becomes a `MobileSheet` with primary action "I Consent" and secondary "Cancel". Three checkboxes for the consent items remain as form fields inside the sheet.

- [ ] **Step 41.3: Missed Exams card on the landing branch**

If a missed-exams card is rendered alongside the Start Exam landing (per screenshot 9), apply the same neutral-card-with-red-chip pattern from Task 37.

- [ ] **Step 41.4: Validation triple + commit**

```
feat(ui): redesign exam start landing + proctoring consent

Wrap the pre-attempt landing card in PageShell so the brand gradient
backdrop and safe-area handling apply. Migrate the proctoring consent
modal from shadcn Dialog to MobileSheet (sheet on mobile, dialog on
desktop). The exam-taking interface itself (questions, navigator,
camera preview) is unchanged — out of scope for this cosmetic phase.

No data-flow changes.
```

---

## Task 42: StudentAnalyticsDashboard + small student pages

**Files (each independent — can run in parallel sub-tasks):**
- `src/components/analytics/StudentAnalyticsDashboard.tsx` (~278 lines)
- `src/pages/student/StudentRechecksPage.tsx` (~280 lines)
- `src/pages/student/StudentStudyMaterialsPage.tsx` (~357 lines)
- `src/pages/student/StudentFeesView.tsx` (~201 lines)
- `src/pages/student/StudentPassportPage.tsx` (~16 lines)

**Why bundled:** each is a small primitive swap (PageShell wrap + StatTile substitution where applicable). No surface-specific decisions.

- [ ] **Step 42.1: StudentAnalyticsDashboard — replace the StatCard helper with shared StatTile**

The local `StatCard` helper duplicates `StatTile`'s job. Replace:

```tsx
<StatCard title="Average Score" value={...} icon={Target} trend="up" />
```

with:

```tsx
<StatTile label="Average Score" value={...} icon={<Target className="h-5 w-5" />} tone="teal" delta={trend === "up" ? { value: "Up", direction: "up" } : { value: "Down", direction: "down" }} />
```

The `trend` chip already maps to `StatTile.delta`. The local `StatCard` function is then dead code — delete it.

Wrap the whole component in `<StatTileGrid cols={2} mdCols={4}>` for the four stats, and apply `surface-card frosted-shadow rounded-2xl p-4` styling to the Strengths/Improvement/Subject Performance/Exam History blocks. Don't introduce PageShell here — this component is a child of `AnalyticsPage` which already has PageShell.

- [ ] **Step 42.2: StudentRechecksPage — PageShell wrap**

Read the current shape; if it follows the same `space-y-6` + `h1` + content pattern, wrap with PageShell+PageHeader. Standardize any KPI cards on StatTile.

- [ ] **Step 42.3: StudentStudyMaterialsPage — PageShell wrap**

Same treatment. Likely has filter chips for subject/chapter — wire through FilterRow if present.

- [ ] **Step 42.4: StudentFeesView — PageShell wrap**

Same treatment. Money values stay tabular-num.

- [ ] **Step 42.5: StudentPassportPage — PageShell wrap**

16 lines — likely a thin wrapper around a passport component. PageShell + PageHeader at minimum.

- [ ] **Step 42.6: Single commit (all five files)**

```
feat(ui): apply shared primitives to remaining student pages

PageShell+PageHeader on StudentRechecksPage, StudentStudyMaterialsPage,
StudentFeesView, StudentPassportPage so the brand gradient backdrop
applies consistently. StudentAnalyticsDashboard's local StatCard
helper deduplicated against the shared StatTile primitive.

No data-flow changes.
```

---

## Task 43: Update CLAUDE.md §20a + final review

**Files:** `.claude/CLAUDE.md`

- [ ] **Step 43.1: Append Phase 8 surface coverage note**

After the Phase 7 paragraph in §20a, append:

```markdown
**Phase 8 (2026-04-28) — Student coverage.** Student surfaces now sit on the same primitives: `StudentResultsPage`, `StudentReportsPage` (My Performance Reports), `StudentExamsPage`, `ComprehensiveStudentDashboard`, `StudentWeekPageV2`, `StudentRechecksPage`, `StudentStudyMaterialsPage`, `StudentFeesView`, `StudentPassportPage`, `StudentAnalyticsDashboard`, plus the shared `AppointmentsPage` and `BookAppointmentDialog`. The four-tile `GradientKPICard` quartet on the student dashboard collapsed to neutral `StatTile` (Phase 5 spec deprecated the loud full-bleed colored cards). The exam-taking interface inside `ExamAttemptPage` remains its own design surface — only the pre-attempt landing card and the proctoring consent dialog were redesigned. Plan: `docs/superpowers/plans/2026-04-28-student-mobile-ui-redesign.md`.

**iOS Safari fullscreen.** iPhone Safari does not implement `requestFullscreen` on arbitrary elements. All exam-flow fullscreen calls go through `src/lib/fullscreen.ts` helpers (`requestFullscreen`, `exitFullscreen`, `getFullscreenElement`, `onFullscreenChange`, `isFullscreenSupported`) which feature-detect the API and resolve to a no-op when unavailable — preventing the synchronous "requestFullscreen is not a function" crash that previously kicked the React error boundary on iPhone. Don't bypass these helpers; calling `el.requestFullscreen()` directly will reintroduce the bug.
```

- [ ] **Step 43.2: Validation + commit**

```
docs(claude): note Phase 8 student coverage + iOS fullscreen helper in §20a
```

---

## Self-Review Checklist (post-implementation)

Run after Task 43 commits:

1. `npx tsc --noEmit` exit 0
2. `npx eslint src/pages/student/ src/components/dashboards/ComprehensiveStudentDashboard.tsx src/components/analytics/StudentAnalyticsDashboard.tsx src/components/appointments/BookAppointmentDialog.tsx src/pages/school/AppointmentsPage.tsx src/lib/fullscreen.ts` — zero new errors over HEAD baseline.
3. `npx vite build` exit 0.
4. Manual smoke at 375 px on Safari:
   - Every student route renders the gradient backdrop.
   - StudentResultsPage card actions reachable behind the kebab.
   - ComprehensiveStudentDashboard four KPIs are neutral StatTile, sub-tabs scroll-snap, Subject-wise Scores bars actually render.
   - StudentExamsPage Missed Exams section is no longer screaming-red.
   - Book Appointment opens as a bottom sheet, Date input shows correctly.
   - Online exam attempt on iPhone: page does NOT crash with "requestFullscreen is not a function" — proctoring still records tab-switch events; fullscreen-exit auto-submit gracefully disabled.
