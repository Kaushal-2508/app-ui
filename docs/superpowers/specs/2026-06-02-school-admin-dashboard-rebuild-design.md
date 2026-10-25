# School-Admin Dashboard Rebuild ("Command Center") — Design

- **Date:** 2026-06-02
- **Status:** Draft — awaiting user review
- **Owner:** Kavach (school portal)
- **Roles affected:** `school_admin`, `super_school_admin` only. No other role's dashboard changes.
- **Render target:** `CommandCenterPage` at `/school/command-center` (the screen in the screenshot). The `/dashboard` 4-card landing hub (`SchoolAdminCommandCenter`) is **not** touched; it keeps linking in.

---

## 1. Why we're rebuilding

The current Command Center is built like an analytics tool for a data scientist. We're rebuilding it for a school principal who has fifteen minutes before her next parent meeting and needs the answer fast. The audience spans tech-fluent principals at top-tier schools **and** principals at CBSE schools in smaller towns who have never used analytics software. The dashboard must work for both with **no mode toggle**.

**The rule above every other rule: the dashboard explains itself.** Every chart has a caption saying what to look for. Every important number has a sentence interpreting it. Language is plain — "students who need help," not "at-risk students." Clarity, not density, is the goal.

Five problems we are fixing in the current screen ([CommandCenterPage](../../../src/pages/school/CommandCenterPage.tsx) + [AlertsStrip](../../../src/components/command-center/AlertsStrip.tsx) / [KpiRow](../../../src/components/command-center/KpiRow.tsx) / [AcademicsPanel](../../../src/components/command-center/AcademicsPanel.tsx)):

1. It opens with vanity numbers (gradient cards: "School Average 0.0%", "Need Attention 1 (100%)").
2. It's tabbed when it shouldn't be.
3. The parent-meeting drill-down (class → subject → student) isn't supported.
4. Visuals are decorative (empty charts, gauges, positioning matrices).
5. The language is wrong for the audience.

---

## 2. The page, top to bottom

A single scroll. No top-level tabs.

1. **Sticky header** — school name + logo, "Last updated" trust signal, "Download Report" button, and (when active) the auto-create banner in the center.
2. **KPI strip** — four headline numbers, each with a one-sentence interpretation.
3. **Zone 1 — Flags feed** — conditions needing the principal's attention, grouped by category.
4. **Zone 2 — Overview widgets** — five charts, each with a mandatory caption + visible click hint.
5. **Zone 3 — Drill-down tables** — four raw lists with above-table descriptions.

---

## 3. Decisions taken (locked with the user 2026-06-02)

| # | Decision | Choice |
|---|---|---|
| D1 | Flag catalog | Claude designs the full 20-flag catalog (this doc, §8); thresholds are baked-in tunable constants — no user-facing config. |
| D2 | Delivery | Phased & reviewable — 4 phases (§13), each production-clean per CLAUDE.md §5a. |
| D3 | Render target | Rebuild `CommandCenterPage` at `/school/command-center` only. `/dashboard` hub untouched. |
| D4 | Data gaps | Add columns + server-side aggregate RPCs via migrations. |
| D5 | Exam type | Add `exams.exam_type`; add a small picker to the exam-creation flow ([useSaveExam](../../../src/hooks/useSaveExam.ts) write path); backfill existing → `unspecified`. |
| D6 | "This term" | = current academic year (from `cal_academic_years` if configured, else rolling 12 months). Caption reads "this academic year." |
| D7 | Heatmap rows | Group by **wings** when configured; otherwise CBSE grade-number bands (Pre-Primary if present, Primary 1–5, Middle 6–8, Secondary 9–10, Senior Sec 11–12). |
| D8 | Download Report | New "Dashboard snapshot" report only. The existing 4 CBSE reports ([ReportModal](../../../src/components/command-center/ReportModal.tsx)) stay reachable & unchanged via a "CBSE reports" item in the `PageHeader` kebab. |
| D9 | Teacher last-login | Read `auth.users.last_sign_in_at` via a `SECURITY DEFINER` admin RPC — no new column, no new write path. |
| D10 | Flag evaluator runner | Primary trigger = on-open "kick" RPC guarded by `sessionStorage` (the §24 attendance pattern). A ~15-min `pg_cron` job is an optional later add, not assumed. |

---

## 4. Scope

**In scope:** the four zones above, the sticky header, the flag engine (DB + UI), the new read RPCs + supporting migrations, the `exam_type` picker, the Dashboard-snapshot report, realtime + connection-health signal.

**Out of scope (do not touch):** other roles' dashboards; the sidebar; the task module internals (we only *create* tasks the existing way); the linked pages (class detail, student passport, exam results, teacher detail) — we link, never modify; fees; compliance scoring; communication flags; any settings UI for thresholds; a UI toggle for the adoption kill switch (backend only). The 4 CBSE reports keep working but their generators are not modified.

---

## 5. Architecture

### 5.1 Read path — compute-on-read RPCs

Every panel is one `useQuery` → one `SECURITY DEFINER` Postgres RPC that aggregates **server-side** and returns a small pre-rolled payload. This satisfies CLAUDE.md §23 (no client-side `.length` over the 1000-row PostgREST cap; no `select("*")`; pagination end-to-end). The frontend stays dumb; panels load and fail independently (progressive reveal).

Where the existing materialized tables (`class_aggregates`, `school_aggregates`, `student_performance_snapshots`, maintained by the [compute-aggregates](../../../supabase/functions/compute-aggregates/index.ts) edge function) already hold the value, the RPC reads them; otherwise it computes live from `final_results` / `attendance_records`. RPCs accept the institution implicitly via `get_user_institution(auth.uid())` and reject callers who aren't an admin of that institution.

### 5.2 Flag engine — persisted table + evaluator

Lifecycle (Red→Amber→Blue→Gone) and flag↔task linkage **require** persistence; you cannot track "turned Amber when a task was created" with stateless recompute. So:

- A **`dashboard_flags`** table (institution-scoped, RLS via existing `SECURITY DEFINER` helpers).
- A **`dash_evaluate_flags(p_institution_id)`** evaluator that recomputes all 20 flag conditions and **upserts/resolves** rows idempotently, keyed on a stable identity `(institution_id, flag_code, subject_key)`. Condition true → row exists; condition false → row resolved (and later purged). Re-firing never duplicates.
- The evaluator runs **(a)** on an on-open kick RPC (guarded by `sessionStorage` key `salci:dash-flags:{institutionId}:{YYYY-MM-DD-HH}` and a server-side "evaluated within last N minutes" guard so it can't be hammered) and **(b)** optionally a 15-min `pg_cron` pass later.
- For **Critical** flags the evaluator itself creates the task (server-side, so it works even when no one has the dashboard open) and sets the flag to Amber.

### 5.3 Realtime + trust signal

A new `useDashboardRealtime` hook extends the canonical one-channel pattern in [useNotificationRealtime](../../../src/hooks/useNotificationRealtime.ts) (CLAUDE.md §23.4): one channel for the dashboard, subscribed to `dashboard_flags` changes, invalidating the relevant React Query keys. Critically, it **surfaces the channel `.subscribe((status) => …)` state** (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`) — which no hook does today — so the header's "Updated just now" ↔ "Updated 5 minutes ago — checking…" signal is real. Trend charts debounce visual redraws to once a minute.

### 5.4 Loading & errors

Progressive reveal: header instant → KPI strip (smallest query) first → flags → widgets + tables stream in via parallel queries (no waterfall), Skeletons during load. Any single panel's query failure shows only that panel's "Couldn't load — retry," the rest keeps working. Every error routes through `toastError` / `translateError` (CLAUDE.md §19) — never raw Postgres.

---

## 6. Data layer & migrations

### 6.1 New columns / tables

- **`exams.exam_type`** `text NOT NULL DEFAULT 'unspecified'` with a CHECK in (`'term'`,`'unit'`,`'weekly'`,`'unspecified'`). Backfill existing → `'unspecified'`. Index not required (low cardinality). Picker added to the exam-creation flow.
- **`institutions.dashboard_adoption_flags_enabled`** `boolean NOT NULL DEFAULT true` — the adoption-flags kill switch (backend only, director-controlled).
- **`dashboard_flags`** table:
  | column | type | note |
  |---|---|---|
  | `id` | uuid pk | |
  | `institution_id` | uuid NOT NULL | FK institutions, indexed |
  | `flag_code` | text NOT NULL | A1…AD6 (internal) |
  | `category` | text NOT NULL | `attendance` \| `exams` \| `adoption` |
  | `severity` | text NOT NULL | `critical` \| `warning` \| `info` |
  | `status` | text NOT NULL | `red` \| `amber` \| `blue` (resolved = `resolved_at` set then purged) |
  | `subject_type` | text NOT NULL | `class` \| `student` \| `exam` \| `subject` \| `teacher` \| `school` |
  | `subject_key` | text NOT NULL | the id (or `'school'`) the flag is about |
  | `title` | text NOT NULL | plain-language, generated from template |
  | `description` | text NOT NULL | ≤2 lines, plain-language |
  | `metric_value` | numeric NULL | e.g. the 64% attendance |
  | `context` | jsonb NOT NULL DEFAULT `'{}'` | extra display data |
  | `link_url` | text NULL | where the flag's "View" goes |
  | `assignee_id` | uuid NULL | resolved deterministically |
  | `task_id` | uuid NULL | FK tasks, `ON DELETE SET NULL` (CLAUDE.md §21) |
  | `auto_created` | boolean NOT NULL DEFAULT false | |
  | `first_detected_at` | timestamptz NOT NULL | |
  | `last_evaluated_at` | timestamptz NOT NULL | |
  | `resolved_at` | timestamptz NULL | |
  | `created_at` / `updated_at` | timestamptz | |

  Indexes: `(institution_id, resolved_at)`, `(institution_id, subject_type, subject_key)`. **Unique partial index** `(institution_id, flag_code, subject_key) WHERE resolved_at IS NULL` to enforce one open flag per identity. RLS: admins of the institution can SELECT/UPDATE; writes happen through `SECURITY DEFINER` RPCs.

### 6.2 RPC inventory (all `SECURITY DEFINER`, admin-gated, institution-scoped)

**KPI strip**
- `dash_kpi_summary()` → `{ attendance_today:{present,total,pct,marked:bool}, school_avg:{pct,prev_pct,exams_count}, students_need_help:{count,prev_count}, decisions_waiting:{count} }`.

**Widgets**
- `dash_attendance_trend(p_days int)` → `{ points:[{date,present,total,pct}], all_time_avg }`.
- `dash_subject_performance(p_class_id uuid)` → `{ has_data, subjects:[{subject_id,subject_name,class_avg,school_avg}] }` (ascending by class_avg).
- `dash_student_distribution()` → `{ doing_well, catching_up, needs_help, total, evaluated }`.
- `dash_exam_trend(p_limit int default 8)` → `[{exam_id,title,exam_type,avg_pct,participation,exam_date}]` chronological.
- `dash_subject_heatmap()` → `{ grouping:'wings'|'grade', rows:[{band_key,band_label,cells:[{subject_id,subject_name,avg_pct,band:'red'|'amber'|'green'}]}] }`.

**Tables** (all paginated via cursor `range`, return `{rows, total, next_cursor}`)
- `dash_classes_table(p_filters jsonb, p_limit, p_cursor)` → class_id, name, students, attendance_30d, recent_avg, active_flags.
- `dash_students_attention(p_weights jsonb, p_filters jsonb, p_limit, p_cursor)` → scores **in SQL using the passed weights** (so weights live in a TS constants file and tuning needs no migration); returns student, roll, class, score, band, reason (plain text), attendance, recent_pct, trend, active_flags.
- `dash_teachers_table(p_filters jsonb, p_limit, p_cursor)` → reads `auth.users.last_sign_in_at` (D9); returns name, role, wing, classes_taught, attendance_30d, last_login, exams_30d, active_flags.
- `dash_recent_exams(p_filters jsonb, p_limit, p_cursor)` → exam, class, subject, exam_type, status, timing, participation, avg, active_flags (default last 30 days, newest first).

**Flags & tasks**
- `dash_get_flags()` → all unresolved `dashboard_flags` for the institution (client groups by category, sorts severity then newest).
- `dash_evaluate_flags()` → idempotent recompute/upsert/resolve; auto-creates tasks for Critical; respects the kill switch; rate-guarded. Returns a summary.
- `dash_create_task_from_flag(p_flag_id, p_assignee_id uuid default null)` → creates a task the existing way (`tasks` + `task_assignments`, mirrors [useCreateTask](../../../src/hooks/useTasks.ts)), links it, sets flag Amber.
- `dash_reassign_flag_task(p_flag_id, p_assignee_id)` and `dash_cancel_flag_task(p_flag_id)` (cancel → flag back to Red, unlink task).
- `resolve_flag_assignee(p_flag_code, p_subject_type, p_subject_key, p_institution_id)` helper (§8.4).

All RPCs reuse the existing `SECURITY DEFINER` helpers (`is_institution_admin`, `is_teacher_for_class`, `get_user_institution`, etc.) per CLAUDE.md §23. Every new FK gets an index in the same migration. After migrations, regenerate `src/integrations/supabase/types.ts`.

---

## 7. Sticky header

- **Left:** school name + logo.
- **Center:** the auto-create banner when active, else hidden.
- **Right:** "Last updated" trust signal + "Download Report".

### 7.1 "Last updated" = connection trust signal
- Healthy: "Updated just now" / "Updated 1 minute ago" in normal ink, refreshing each minute.
- Dropped (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`): muted gray "Updated 5 minutes ago — checking…" + a small refresh icon button (manual retry).
- Restored: back to normal ink.

### 7.2 Download Report
Keep the name. Primary button opens the new **Dashboard-snapshot** config dialog: time range (last 30 days / last term / last academic year / custom), wings (all by default), sections (flag summary / overview widgets / drill-down tables). On confirm → a multi-page document. Generation uses the existing **client-side** print/`html2pdf` path ([exportTextPdf](../../../src/lib/exportTextPdf.ts) / lazy `html2pdf.js`) — CLAUDE.md §23.5 discourages synchronous edge-function PDF, and the spec allows a clean print stylesheet fallback. The 4 CBSE reports stay reachable via a "CBSE reports" `PageHeader` kebab item that opens the unchanged `ReportModal`.

---

## 8. Zone 1 — Flags

### 8.1 Presentation
Plain-language titles and descriptions only (codes never shown). Description = two lines max: line 1 the condition ("Class 8B's attendance was 64% over the last 5 days."), line 2 why it matters ("This is well below the school's usual 88%."). No jargon ("standard deviations," "rolling baseline," "cohort," "engagement"). Grouped by category; within a category sort by severity then newest. Severity → color: Critical red, Warning amber, Info blue.

### 8.2 Lifecycle (Red → Amber → Blue → Gone)
- **Red:** condition true, nobody has acted.
- **Amber:** a task exists (principal created one, or the system auto-created it for a Critical flag).
- **Blue:** the task is closed (`completed`/`rejected`) but the condition is still true.
- **Gone:** the **condition itself** resolves (closing a task never makes a flag vanish). Resolved rows are purged after a 7-day retention window.

### 8.3 Critical auto-create + banner
Critical flags (**A1, A5, E2, E4, AD1**) auto-create a task on first detection (in the evaluator) and surface in a thin amber banner at the top: "3 tasks were created automatically this morning — Review." Review expands a panel listing each auto-task with flag context, the pre-filled assignee, and two buttons: "Give this to someone else" (reassign) and "Cancel this task" (reverts the flag to Red).

### 8.4 Deterministic assignee resolution (`resolve_flag_assignee`)
Resolution chain, first hit wins, always ending at the principal:
- `class` / `student` subject → the class's class-teacher (`class_assignments`, teacher role) → the class's wing coordinator (`wing_class_mappings` → `wing_assignments`) → principal (`school_admin`).
- `exam` / `subject` subject → the exam's `created_by` / the subject's teacher → wing coordinator → principal.
- `school` / adoption subject → principal.

### 8.5 Cold-start & kill switch
Every flag suppresses until its minimum data exists (per-flag in §8.6). Adoption flags (`AD*`) are gated by `institutions.dashboard_adoption_flags_enabled` **and** an onboarding grace window (institution age). Per-student flags (A4) are capped (top 25 most-severe per institution) so the feed never floods.

### 8.6 The 20-flag catalog

Codes internal; "Principal sees" is the title template. **Thresholds are exported constants (TS + mirrored as RPC params/SQL), tunable without schema change.** Defaults below.

**Attendance**
| Code | Principal sees | Condition (default threshold) | Severity | Cold-start | Assignee |
|---|---|---|---|---|---|
| A1 | "Class 8B's attendance is very low" | class 5-school-day avg < **70%** AND ≥ **12pp** below school 30-day baseline | Critical (auto-task) | class has ≥14 days data & ≥10 students | class teacher |
| A2 | "Class 7A's attendance is slipping" | 5-day avg 70–80%, or ≥ **10pp** below baseline (not A1) | Warning | same as A1 | class teacher |
| A3 | "School attendance dropped this week" | this-week avg ≥ **8pp** below prior-week | Warning | school ≥14 days data | principal |
| A4 | "Rohan has missed a lot of school" | missed ≥ **6** of last **20** working days | Warning | ≥10 working days exist; capped top 25 | class teacher |
| A5 | "Class 9C has no teacher today" | staff absent today & no substitute covering a period | Critical (auto-task) | timetable configured | wing coordinator |
| A6 | "Attendance not marked for Class 6B" | no `attendance_records` for ≥ **2** of last 3 working days | Warning | class has prior marking history | class teacher |
| A7 | "A teacher is often late" | ≥ **4** late check-ins in last **10** working days | Info | ≥10 working days exist | wing coordinator |

**Exams**
| Code | Principal sees | Condition (default) | Severity | Cold-start | Assignee |
|---|---|---|---|---|---|
| E1 | "15 exams are still in draft" | ≥ **5** exams in `draft` older than **7** days | Warning | — | exam creator / coordinator |
| E2 | "Results are overdue for the Term-1 test" | exam `completed` & not published > **5** days (or large pending-evaluation backlog) | Critical (auto-task) | exam completed | teacher / coordinator |
| E3 | "Few students took the Science test" | published/active exam past `availability_end` with attempt rate < **60%** | Warning | window ended | class teacher |
| E4 | "Class 9A scored very low in Maths" | class avg on a ≤30-day published exam < **40%** OR pass-rate < **50%** | Critical (auto-task) | exam published & graded | subject teacher / coordinator |
| E5 | "Maths is weak across the school" | subject school avg this academic year < **50%** across ≥ **2** exams | Warning | ≥2 graded exams in subject | coordinator |
| E6 | "Recheck requests are piling up" | ≥ **3** `recheck_requests` open > **7** days | Warning | — | teacher / coordinator |
| E7 | "Class 8C hasn't had a test in a while" | no published exam for the class in last **30** days | Info | school has ≥1 published exam ever | class teacher |

**Adoption** (kill-switch gated; extra onboarding grace)
| Code | Principal sees | Condition (default) | Severity | Cold-start | Assignee |
|---|---|---|---|---|---|
| AD1 | "3 classes have no teacher assigned" | classes with 0 teacher in `class_assignments` | Critical (auto-task) | institution age > 14 days | principal |
| AD2 | "Some classes have no students yet" | classes with < **1** enrolled student | Warning | institution age > 14 days | principal |
| AD3 | "4 teachers haven't logged in this week" | staff `last_sign_in_at` > **7** days (or never) | Warning | institution age > 14 days; staff age > 7 days | wing coordinator / principal |
| AD4 | "Homework is on but unused" | a feature enabled but **0** usage in **30** days | Info | feature enabled > 14 days | principal |
| AD5 | "Timetable / syllabus isn't set up for some classes" | active classes with no `tt_slots` or no syllabus topics | Info | institution age > 21 days | coordinator |
| AD6 | "Few people are using SALCI yet" | 7-day active-user rate < **30%** of active profiles | Info | institution age > 30 days | principal |

Flag → `task_type` mapping: A1–A6 → `student_support`; A7, AD1–AD6 → `administrative`; E1–E4, E6, E7 → `exam_related`; E5 → `academic_content`. Task priority from severity (Critical→high, Warning→medium, Info→low).

---

## 9. Zone 2 — Overview widgets

Five widgets in a grid (single column on mobile). Each = title + chart + **mandatory one-line caption** + **visible click hint** (not hover — touch has no hover). Recharts with the explicit-inline-height wrapper (`style={{width:'100%',height:N}}`) per CLAUDE.md §20a. Color is for meaning, never rainbow.

Layout — Row 1: Subjects-by-performance (left) · Student distribution (right). Row 2: Attendance trend (left) · Exam performance trend (right). Row 3: Class × Subject heatmap (full width).

### 9.1 Subjects by performance (scoped by class) — the parent-meeting widget
Horizontal bars, one per subject in the picked class, **ascending** (weakest on top). Each bar = class average; a thin reference marker = the **school** average for that subject. Class picker in the header (defaults to first class alphabetically, doesn't persist). Data: `dash_subject_performance(classId)`.
- **Caption:** "Bars at the top show the subjects this class is weakest in. The thin line on each bar shows the school's average — if a bar is much shorter than the line, this class is behind other classes in that subject."
- **Click hint:** "Tap any subject bar to see how each student is doing in that subject."
- **Click → ** class+subject ranked-students view (existing analytics drilldown; exact route confirmed in Phase 2 — we link, don't modify).
- **Cold-start:** picked class has no published exam → empty state "No exam data yet for this class. → Create an exam."

### 9.2 Student distribution
Donut, three segments — Doing well (>70%), Catching up (50–70%), Needs help (<50%) — count per segment, total in the center. School-wide (no class picker). Data: `dash_student_distribution()`.
- **Caption:** "The red segment shows children who need extra help. Tap any segment to see those students."
- **Click hint:** "Tap a segment to see the list of students in that group."
- **Click → ** scrolls to / filters the "Students needing attention" table to that band.
- **Cold-start:** < 10 students evaluated → hide chart, show "This will show where your students stand once we have exam data from at least ten students."

### 9.3 Attendance trend
Single line of school-wide daily attendance %; window toggle 30 (default)/60/90 days; dotted reference at all-time average. Data: `dash_attendance_trend(days)`. Debounced redraw.
- **Caption:** "Each point is one day's attendance. If the line is going down, attendance is dropping. The dotted line is your school's usual average."
- **Click hint:** "Tap the chart to see more detailed attendance reports."
- **Click → ** attendance analytics page.
- **Cold-start:** < 14 days data → hide, show "This will appear once you have 14 days of attendance recorded. → Mark attendance."

### 9.4 Exam performance trend
Vertical bars, last 5–8 published exams chronologically, colored by `exam_type` (distinction only — no red/amber/green). Tap a bar → exam name, date, participation, average. Data: `dash_exam_trend(8)`. Debounced.
- **Caption:** "Each bar is one test. If bars are getting taller over time, marks are improving across the school."
- **Click hint:** "Tap any bar to see that exam's full results."
- **Click → ** that exam's results page.
- **Cold-start:** < 2 published exams → hide + placeholder.

### 9.5 Class × Subject heatmap
Grid: rows = grade groups (wings if configured, else CBSE grade-number bands — D7), columns = subjects, ~5×12 ≈ 60 cells. Cell = avg %, large readable number, colored Red <50 / Amber 50–70 / Green >70 (color supporting, number primary). Data: `dash_subject_heatmap()`.
- **Caption:** "Red boxes show where a group of classes is weak in a subject. Green boxes show where they're doing well."
- **Click hint:** "Tap any box to see the classes in that group, in that subject."
- **Click → ** filtered view of that grade group in that subject.
- **Cold-start:** show only bands with ≥1 published exam; no data anywhere → hide + placeholder.

---

## 10. Zone 3 — Drill-down tables

Four tables, each top-10 with a "Show all" expander, compact but readable rows, an above-table one-line description, filters above, row-click to the relevant page. Raw lists — no inline viz.

### 10.1 Classes
Every class, **worst recent exam average first**. Columns: class name, # students, attendance % (30d), recent exam average, # active flags. Description: "All your classes, with the ones needing most attention at the top." Filters: wing, grade level, "only classes with flags." Row → class detail. Data: `dash_classes_table`.

### 10.2 Students needing attention
Weighted severity at query time. Columns: student (name, roll, class), colored dot + plain reason ("Maths below 50%, missed 8 days this month"), attendance %, recent exam % with up/down arrow, # active flags. **The principal never sees the score number** — only the dot (red/amber/yellow) + reason. Default sort: dot (red→amber→yellow) then recent exam ascending. Description: "Students who may need extra help, based on attendance, recent marks, and any drop in performance." Filters: class, wing, severity ("All who need attention" / "Only red" / "Red and amber"). Row → student passport. Data: `dash_students_attention(weights,…)`.

**Severity weights** (exported `SEVERITY_WEIGHTS` in `lib/dashboardConstants.ts`, passed to the RPC):
- attendance > 15pp below class average → **+30**
- recent exam in the bottom quartile of the class → **+30**
- top-half last term → bottom-half now → **+25**
- ≥ 3 active flags tied to the student → **+15**
- appear threshold: total ≥ **20**
- bands: red ≥ **55**, amber **35–54**, yellow **20–34**
- cold-start exclusion: < 10 working days attendance OR < 2 exams.

These are **starter values, not validated against pilot data** — kept as constants so we tune them once real pilot data is in (per the spec's explicit warning).

### 10.3 Teachers
Every staff member. Columns: name + role, wing + # classes, attendance % (30d), last login ("today" / "2 days ago" — amber after 3 days, red after 7), # exams created (30d), # active flags. Default sort: attendance issues / no recent login / unfilled assignments on top. Newly added staff (< 7 days) excluded from "inactive" sorting but still listed. Description: "All teachers and staff, with anyone needing attention at the top." Filters: role multi-select (teacher/coordinator/employee), wing, status. Row → teacher detail. Data: `dash_teachers_table` (reads `auth.users.last_sign_in_at` via SECURITY DEFINER).

### 10.4 Recent exams
20 most recent. Columns: exam name + class + subject, type, when ("Started 2 days ago" / "Ends in 3 days" / "Completed last week"), status ("Scheduled" / "In progress" / "Waiting for grading" / "Results published"), participation ("82 of 95 students attempted"), average (or "Not graded yet"), # active flags. Default sort: most recent first. Description: "Recent exams across the school. Tap any row to see results." Filters: class, subject, status, date range (default last 30 days). Row → exam results. Data: `dash_recent_exams`.

---

## 11. KPI strip

Four numbers, big calm typography, **no gradients, no stacked colored cards**. Small label above, big number, muted interpretation sentence below. Data: `dash_kpi_summary()`.

| KPI | Number | Interpretation sentence | Cold-start |
|---|---|---|---|
| Today's attendance | % present today | "84% — same as last week" / "…3% lower than last week" / "Not marked yet today." | not marked → "Mark attendance to see this" |
| School average this term | avg across published exams in the current academic year | "67% — slightly better than last year" / "…about the same as last year" | no exam data → "Publish an exam to see this" |
| Students who need help | count from the §10.2 severity model | "14 students — 3 more than last week." | < 10 evaluated → dash + nudge |
| Decisions waiting for you | count of active flags | "5 things — tap to scroll down to the list." (click scrolls to flags feed) | 0 → "Nothing waiting right now." |

Numbers are the heroes; the sentence is mandatory (no naked numbers). Large font for older laptop screens. Mobile: 2×2 grid.

> **"This term" wording.** Principals say "term," so the label stays "School average this term," but in v1 the data scope is the current academic year (D6) and the comparison (`prev_pct`) is the prior academic year — hence the interpretation sentence says "than last year." When a real term model lands (a v2 conversation), the scope and wording converge.

---

## 12. Cross-cutting rules

- **Visual design (CLAUDE.md §20a/§20b):** `PageShell` + `PageHeader`; `text-ink-900/600`, `.eyebrow`; cards = `surface-card frosted-shadow rounded-card`; `StatTile`/`StatTileGrid` for the KPI strip; `ListRow` where a table won't fit at 375px; `EmptyState` for every empty/cold-start; `MobileSheet` (not Dialog) for the report config; `FilterRow`/`FilterSheet` for table filters; tones from the `Tone` union; every color via a token (light + dark). No gradient KPI cards, no gauges, no positioning matrices, no decorative charts, no top-level tabs.
- **Plain words everywhere.** "marks," "students," "classes," "teachers," "doing well," "needs help." Banned: metrics, cohort, performance band, engagement, cross-class, positioning matrix, pass-rate gauge.
- **Mobile:** everything stacks; KPI strip 2×2; widgets single column; tap-only; captions + hints stay visible; no horizontal scroll at 375px.
- **English only** in v1.
- **No personalization** — every visit is fresh state; filters/picks/expansions don't persist (except the §5.2 evaluator `sessionStorage` guard, which is not user-facing state).
- **Concurrency (CLAUDE.md §23):** explicit `staleTime` per `useQuery` (the app default is 60s — fine for most; KPI/flags can be shorter); subscriptions clean up; no `refetchInterval` ≤ 30s without a justification comment; aggregate in RPCs; pagination end-to-end; new FKs indexed.

---

## 13. Phase plan (each phase production-clean: `tsc --noEmit`, `eslint` touched files, `vite build` all exit 0)

**Phase 1 — Data foundation (DB-only + the exam_type picker).**
Migrations: `exams.exam_type` (+ backfill + picker in `useSaveExam` flow), `institutions.dashboard_adoption_flags_enabled`, the `dashboard_flags` table **scaffold** (+ RLS + indexes + unique partial index) so the read RPCs/tables can reference it (counts default to 0 until Phase 3 populates it), a `dash_resolve_institution` admin guard + `dash_current_academic_year` helper, all read RPCs (§6.2) **including `dash_get_flags` (returns [] until Phase 3)** and the teacher-login SECURITY DEFINER read. Regenerate types. **Validate every read RPC against real pilot data.** No dashboard UI yet. *(The flag evaluator + `resolve_flag_assignee` + the three flag/task RPCs move to the Phase 3 plan, since Phase 2's read-only dashboard shows a flags-feed placeholder and doesn't need them.)*

**Phase 2 — Read-only dashboard shell.**
Rebuild `CommandCenterPage`: sticky header (with a static "last updated" + Download placeholder), KPI strip, all 5 widgets (captions, click hints, click-through, cold-start), all 4 tables (descriptions, filters, sort, show-all, cold-start). Wire to read RPCs with progressive reveal, per-panel error, empty states, mobile. Flags feed shows a neutral placeholder. Cut over: remove old `AlertsStrip`/`KpiRow`/`AcademicsPanel`/`QuickActions`/`useCommandCenter`; keep `ReportModal` behind the kebab.

**Phase 3 — Flag engine + lifecycle + tasks (DB evaluator + UI).**
DB: `resolve_flag_assignee`, `dash_evaluate_flags` (the 20-flag detection + idempotent upsert/resolve + Critical auto-task), and the three flag/task RPCs (`dash_create_task_from_flag`, `dash_reassign_flag_task`, `dash_cancel_flag_task`). **Validate the evaluator against real pilot data before wiring UI** — the flag engine is the riskiest layer. UI: flags feed wired to `dashboard_flags` (category groups, severity sort), the on-open kick, auto-create banner + reassign/cancel, lifecycle colors, kill-switch respect. "Decisions waiting" KPI and the per-row "active flags" counts in all tables now reflect real flags.

**Phase 4 — Realtime + report + polish.**
`useDashboardRealtime` (channel + connection-health trust signal + manual retry), debounced trend redraws, the Dashboard-snapshot report (client-side print/`html2pdf`, time-range/wings/sections). Final mobile, dark-mode, and a11y pass.

---

## 14. Component / module structure (frontend)

```
src/pages/school/CommandCenterPage.tsx          (rewritten composition)
src/components/command-center/
  DashboardHeader.tsx        last-updated signal + Download + banner slot + CBSE kebab
  AutoCreatedBanner.tsx      critical auto-task review panel
  KpiStrip.tsx / KpiTile.tsx
  FlagsFeed.tsx / FlagCard.tsx / FlagTaskActions.tsx
  WidgetCard.tsx             title + chart slot + caption + click hint + cold-start/error
  widgets/{SubjectsByPerformance,StudentDistribution,AttendanceTrend,ExamPerformanceTrend,ClassSubjectHeatmap}.tsx
  DashboardTable.tsx         description + filters + top-10 + show-all + per-table states
  tables/{Classes,StudentsAttention,Teachers,RecentExams}Table.tsx
  DashboardSnapshotReport.tsx
src/hooks/
  useDashboardKpis, useAttendanceTrend, useSubjectPerformance, useStudentDistribution,
  useExamTrend, useSubjectHeatmap, useClassesTable, useStudentsAttention, useTeachersTable,
  useRecentExams, useDashboardFlags, useDashboardRealtime, useFlagTaskActions, useEvaluateFlagsOnOpen
src/lib/dashboardConstants.ts   SEVERITY_WEIGHTS + flag thresholds (TS mirror) + band cutoffs
```
Each component has one clear purpose, takes typed props, and is testable without its siblings. The shared `WidgetCard` / `DashboardTable` wrappers guarantee every widget has a caption + click hint and every table has a description + states (so the "no chart without a caption" rule is structural, not per-author discipline).

---

## 15. Acceptance criteria (verify against real data, not a clean dev DB)

- Loads for a `school_admin` user with no errors; other roles' dashboards unchanged; build + lint clean.
- KPI strip shows real numbers with interpretation sentences (or correct cold-start dashes).
- Flags feed renders with plain-language titles, grouped, severity-sorted; the flag→task flow works end-to-end; Critical auto-create banner appears when a Critical flag fires; cancel reverts to Red; closing a task → Blue while condition persists; flag disappears only when condition resolves.
- All 5 widgets render with captions + click hints visible by default (incl. mobile); all 4 tables render with above-table descriptions.
- **Parent-meeting scenario works:** pick Class 8B in the Subjects widget → Maths is the top bar with the school reference line above it → click the Maths bar → ranked students → click a student → land on their passport. ≤ two clicks.
- "Last updated" updates as realtime fires; simulating a dropped connection turns it gray and shows the retry button; restoring returns it to normal.
- Mobile at 375px: no horizontal scroll, captions + hints visible, KPI 2×2.
- No empty charts, no vanity KPIs, no jargon labels, no naked numbers, no gradient KPI cards, no gauges, no top-level tabs.

---

## 16. Open items / risks

- **Flag detection correctness is the top risk.** A flag that fires wrongly destroys trust faster than a missing flag. Phase 1 validates each detection query against pilot data before UI.
- **Severity weights are unvalidated starters** — constants, tuned post-pilot.
- **Subject-bar / heatmap click targets** rely on existing drilldown routes; exact routes are confirmed (not built) in Phase 2 — we link, never modify.
- **`pg_cron`** availability is unconfirmed; v1 relies on the on-open kick, cron is an optional later add.
- **Exam-type backfill** leaves historical exams as `unspecified`; the trend widget colors them neutrally until re-typed.
