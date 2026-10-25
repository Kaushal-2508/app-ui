# School Analytics rebuild — design

Date: 2026-09-10
Surface: `/school/analytics` (also `/analytics`, `/performance`, `/coordinator/analytics`, `/admin/analytics`)
Branch: `feat/school-analytics-rebuild`

## 1. Why

The School Analytics tab is the school admin's only "how is the school performing" surface, and today it
is neither correct nor connected.

### Data defects found in the live code (verified against prod 2026-09-10)

| # | Defect | Evidence |
|---|---|---|
| D1 | Student and teacher totals come from `user_roles`, not the canonical roster. | `get_school_exam_analytics` counts `user_roles WHERE role='student'` → Salci National reads **253**; `institution_student_count()` reads **252**. The Command Center shows 252 on the same school. This is exactly the drift `20260905190000_one_canonical_student_roster.sql` was written to end. |
| D2 | The Proctoring tab fetches **every** proctoring session on the platform and filters client-side. | `useProctoringAnalytics` runs `proctoring_sessions.select("*", …)` with no filter and no `range()`, then `proctoring_events.select("*")`. Prod holds **2,914 sessions and 26,525 events**; PostgREST silently caps at 1,000, so both are truncated. Salci National owns only **38** of those sessions. Every number on that tab is wrong. |
| D3 | The Proctoring tab counts review statuses that cannot exist. | It counts `review_status` values `approved` and `dismissed`; the CHECK constraint allows only `pending`, `reviewed`, `cleared`, `flagged`. "Approved", "Dismissed" and the whole "false positive rate" are therefore hardwired to 0, and `cleared` / `flagged` sessions are invisible. |
| D4 | The Performance drill-down invents per-subject scores. | For a section it takes each exam's whole-paper average and attributes it to *every* subject on that exam. There are no per-subject marks in `final_results`, so the "subject" level is a relabelled exam average. |
| D5 | Absent results are averaged in as 0%. | `final_results.is_absent` exists (**1,176 of 20,826 rows** platform-wide) and no analytics query excludes it. |
| D6 | Three of the six Exam Health tiles are permanently 0. | Salci National has statuses `draft=28, published=74, completed=11`. `ready`, `active` and `archived` rows do not exist, so half the tile row is dead space. |
| D7 | Nothing on the page links anywhere. | Zero `navigate()` calls. A principal who sees a weak class, a failing cohort or a flagged exam has no way to reach the class, the students, or the results. |
| D8 | No time window at all. | Every figure is all-time, so "average score" mixes last year's exams with this week's and can never move. |

### Design-system defects

- Raw Tailwind palette (`bg-blue-50`, `text-green-600`, `bg-gradient-to-br from-yellow-50`) that does not flip in dark mode.
- Hardcoded `hsl(142 71% 45%)` / `hsl(38 92% 50%)` / `hsl(0 84% 60%)` chart colors: a red/amber/green value-ramp applied to nominal categories, which double-encodes bar length as hue and is not colorblind-safe.
- shadcn `Tabs` for a top-level strip (clips at 375 px), local `StatCard` instead of `StatTile`, bare `<Card>` instead of `surface-card frosted-shadow`, plain centered text instead of `EmptyState`.
- No error state on the Proctoring tab: a failed query renders as "No proctoring data available."

## 2. Shape of the rebuild

One page, one filter row, four tabs. Every figure is computed server-side, in the institution's own
timezone, inside an explicit window, and every row or bar leads somewhere.

```
PageShell
 └ PageHeader  "School Analytics"  · subtitle names the window and the institution
 └ FilterRow   [Institution (super admin only)] [Period ▾] [Class ▾]      ← scopes all four tabs
 └ MobileTabs  Overview · Classes · Exams · Integrity
```

### Tab 1 — Overview

1. **KPI row** (`StatTile` × 4): Average score · Pass rate · Students assessed · Results published.
   Each carries a delta against the immediately preceding window of equal length.
2. **Students by average score** — five ordered bands over each student's mean score in the window.
   Clicking a band opens a sheet listing those students; each row links to `/school/student/:id`.
3. **Subjects by average** — horizontal bars, weakest first, with a reference line at the school
   average. Clicking a bar goes to `/school/subject/:subjectId`.
4. **Result pipeline** — exams held → attempts submitted → results published, and the two gaps
   (awaiting evaluation, submitted with no result). The evaluation gap links to `/ocr-review`.
5. **Exam trend** — one bar per exam over time with a period-average reference line; a bar links to
   `/exams/:examId/results`.
6. **Homework marks** — the existing `HomeworkAnalyticsSection`, unchanged.

### Tab 2 — Classes

League table of every active class: students assessed, results, average, pass rate, awaiting results,
integrity flags. Sorted weakest-average first. Row → `/school/class/:classId`.

### Tab 3 — Exams

Every exam in the window with its real participation and outcome: date, type, mode, subject, classes,
assigned, attempted, results, average, pass rate. Filterable by status, class, subject and type.
Row → `/exams/:examId/results` (hybrid rows → `/evaluations/hybrid?examId=…`, results-only → `/exams/:examId/offline-marks`).

### Tab 4 — Integrity

Proctoring, aggregated server-side and scoped to the institution: sessions, awaiting review, reviewed,
cleared, flagged; event severity mix; the event types that fire most; and the exams with the highest
flag rate (row → that exam's results). Keeps the advisory notice.

## 3. Data layer — five new RPCs

All are `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`, all take
`_institution_id uuid DEFAULT NULL` (NULL resolves to the caller's own institution), all authorise through
one shared guard, all page with LIMIT/OFFSET, and all receive
`REVOKE EXECUTE … FROM PUBLIC` + `FROM anon` + `GRANT … TO authenticated, service_role`
(CLAUDE.md §26).

| Function | Returns |
|---|---|
| `school_analytics_guard(uuid)` | resolved institution id, or raises. super_admin may name any institution; school_admin / super_school_admin only their own. Fails closed when `auth.uid()` is NULL. |
| `school_analytics_overview(_institution_id, _range, _class_id)` | window, roster, performance, pipeline, distribution, subjects, trend |
| `school_analytics_classes(_institution_id, _range, _assessed_only, _limit, _offset)` | `{rows, total}` |
| `school_analytics_exams(_institution_id, _range, _filters, _limit, _offset)` | `{rows, total}` |
| `school_analytics_students(_institution_id, _range, _class_id, _band, _limit, _offset)` | `{rows, total}` |
| `school_analytics_integrity(_institution_id, _range, _platform)` | counts, severity, event types, exams |

### Shared definitions (the whole point of one RPC family)

- **Window.** `public.dash_range_window(_range, institution)` — the same helper the Command Center uses,
  so "last 3 months" means the same thing on both surfaces. Tokens `tm | 1m | 3m | 6m | ay`; anything
  else falls back to `3m`. Institution-local today throughout (CLAUDE.md §24).
- **Exam date.** `COALESCE(published_at::date, scheduled_date::date, created_at::date)` — identical to
  every `dash_*` RPC.
- **Exam universe for performance.** `status IN ('published','active','completed')` and exam date inside
  the window. Drafts and archived exams are counted only in the pipeline, never in an average.
- **Roster.** `institution_student_ids()` / `institution_student_count()`. Never `user_roles`. (Fixes D1.)
- **A result.** A `final_results` row reached through `student_exam_attempts` → `exams` of this
  institution, **excluding `is_absent`**. (Fixes D5.) The absent count is returned separately and shown
  as a footnote so the exclusion is visible rather than silent.
- **Pass rate.** `count(*) FILTER (WHERE is_pass) / NULLIF(count(*) FILTER (WHERE is_pass IS NOT NULL), 0)`.
- **Subject.** `exam_subjects → universal_subjects`, grouped on `initcap(lower(btrim(name)))` because
  `universal_subjects` carries per-grade duplicates (the same normalisation `dash_subject_heatmap` uses).
  The deep link carries the id with the most results, which matches `SubjectDetailPage`'s own
  resolve-by-name behaviour.
- **Class of a result.** `student_exam_attempts.class_id` (an exam can span classes; 12 do at Salci National).
- **Bands.** Under 35 · 35 to 49 · 50 to 69 · 70 to 89 · 90 and above, applied to each *student's mean*
  in the window, so the band drill-down returns exactly the students the bar counted.

### Known divergence, stated on purpose

`dash_kpi_summary.school_avg` does **not** exclude absent results. On Salci National both definitions
give 62.1% because the school has zero absent rows, but at Alliance the two will differ. The correct
definition is the one used here; aligning `dash_kpi_summary` is a follow-up, deliberately not bundled
because it changes numbers on a dashboard this branch does not otherwise touch or test.

Two further inherited quirks are corrected here and left alone there: `dash_recent_exams` counts
"assigned" as `class_assignments` rows rather than distinct students (double-counting a student enrolled
in two classes of the same exam) — the new exams RPC counts `DISTINCT ca.user_id`.

## 4. Frontend

```
src/hooks/useSchoolAnalytics.ts              new  – five hooks + types + range constants
src/components/analytics/school/
  SchoolAnalyticsView.tsx                    new  – filter bar + tabs orchestrator
  AnalyticsFilters.tsx                       new
  OverviewTab.tsx  ClassesTab.tsx  ExamsTab.tsx  IntegrityTab.tsx    new
  StudentBandSheet.tsx                       new  – band → students drill
  charts.tsx                                 new  – tooltip, axis and ramp helpers
src/pages/AnalyticsPage.tsx                  edit – mount the new view
src/components/analytics/SchoolAnalyticsDashboard.tsx     deleted
src/components/analytics/ProctoringAnalyticsDashboard.tsx deleted
src/hooks/useAnalytics.ts                    edit – drop the three superseded hooks
src/index.css                                edit – chart band + chrome tokens (light and dark)
```

- Chrome comes from the existing `WidgetCard` and `DashboardTable`, which already enforce
  loading → **error → empty** in that order (CLAUDE.md §6). They live under `components/command-center/`
  but are generic; reusing them keeps the two principal surfaces visually identical.
- Every `useQuery` sets `staleTime: 60_000`, `refetchOnWindowFocus: false`, keys prefixed
  `["school-analytics", institutionId, …]`, and throws on error so the card shows its error state.
- No `select("*")`, no client-side aggregation, no unbounded list: tables page through the RPC.

### Colour

One hue plus grey chrome. Every value is a CSS variable defined in both `:root` and `.dark`
(design-system rule 15), so nothing is theme-blind.

- Bars, lines and the trend use brand teal alone; the *sort order* and a reference line carry the story,
  not hue. This removes the red/amber/green value-ramp (D-defect above).
- The five score bands use a single-hue teal **ordinal** ramp, validated with the dataviz validator:
  light `#64c4c9 #30afb5 #22959b #16797e #0d5a5e` on `#ffffff`, dark `#2b6164 #35888d #3eb5bb #65cdd2 #95e1e4`
  on the dark card. Both pass monotone lightness, adjacent ΔL ≥ 0.06, light-end contrast and single-hue.
- Status colour (rose / amber / emerald tokens) is reserved for the pipeline gaps and integrity flags and
  always ships with an icon and a word, never colour alone.

## 5. Constraints honoured

- CLAUDE.md §5a zero-error gate; §6 error-before-empty and `toastError`; §23 server-side aggregation,
  bounded lists, explicit `staleTime`, SECURITY DEFINER helpers; §24 institution-local time;
  §26 `REVOKE … FROM anon` by name and verification against `pg_proc.proacl`.
- No em-dashes in user-facing strings.
- 375 px and dark mode verified before the work is called done.

## 6. Out of scope

Super-admin "System" tab (`useSuperAdminAnalytics`), the teacher/coordinator analytics dashboard, the
Command Center, and `SubjectDetailPage` / `ClassDetailPage` / `TeacherDetailPage`, which still read the
snapshot tables `class_aggregates` and `student_performance_snapshots`. The super-admin platform-wide
Proctoring tab **is** in scope only because deleting `useProctoringAnalytics` would otherwise leave it
without a data source; it moves onto the same server-side integrity RPC with `_platform => true`.

## 7. What verification changed

The migration was applied to production and every RPC called as a real school admin inside a
rolled-back transaction (`set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated`).
Running the aggregation against real rows, rather than reasoning about it, moved four things:

1. **A deactivated class still holds results.** Restricting the class table to `is_active` lost 12 of
   2,060 results, so the Classes tab would have undershot the Overview total: the same
   two-screens-two-numbers defect this rebuild exists to end. The classes RPC now scopes to active
   classes *plus* any class carrying a result in the window, and returns `is_active` so the row is
   badged. Such a class has no `class_assignments`, so its roster is 0 while students have marks;
   the row drops the denominator rather than printing "7 of 0 students assessed".
2. **`attempted` could exceed `assigned`** on 8 exams, because a student who changes class after
   sitting a paper leaves the roster of the exam's classes. "9 of 8 sat it" reads as a bug, so
   `assigned` became the DISTINCT union of the current roster and everyone who actually submitted.
3. **A delta computed off five results is noise wearing an arrow.** The academic year has 2,060
   results behind it; the period before it has 5. Deltas are suppressed below 20 prior results.
4. **Two "leaks" in the first authorisation probe were artifacts of the probe.** It selected the
   foreign institution and class id *after* switching role, so RLS returned NULL and a correctly
   blocked call looked like a pass. Captured as superuser first, every cross-institution,
   foreign-class, teacher, student and anonymous call is refused.

Screenshots at 375 px and 1280 px in both themes then found four more, all fixed: a y-axis label
clipped outside its card, a chart card stretched to a wall of empty space beside a longer table, row
subtitles cropped mid-word by `ListRow`'s single-line truncation, and an exam title squeezed to
"Voice Ch..." by an inline status badge. Measuring contrast also retired the raw Tailwind
`amber-600` and `rose-600`: they fail 4.5:1 on the light and dark card respectively, so the two
call-out states moved to `--signal-warn` and `--signal-alert`, defined in both `:root` and `.dark`.
