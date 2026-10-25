---

> **REPLACED 2026-09-16 — read this first.** `/school/command-center` now serves
> **`CommandCenterV5Page`**, built to `public/report_reference/salci-admin-dashboard-v5.html`
> (design: `docs/superpowers/specs/2026-09-16-admin-dashboard-v5-design.md`). The old
> `CommandCenterPage` and its layout (`dash/DashOverview`, `dash/DashSections`,
> `dash/DashGapCards`, `dash/DashAdoptionHero`, `dash/StudentBandSheet`,
> `dash/DashJumpNav`, `DashboardHeader`, `AutoCreatedBanner`) are DELETED. Do not
> recreate them from the sections below.
>
> What v5 changed that matters:
> * A new `dash5_*` family backs the page. `dash5_atom_rows` is the (class,
>   subject) atom and EVERY level above it is derived from it, so wings, classes
>   and subjects cannot disagree. It trusts its institution argument and is
>   revoked from `anon` AND `authenticated`; only `dash5_tree` and friends, which
>   gate on `dash_resolve_institution`, may reach it.
> * v5 averages EXCLUDE absent sitters and weight by attempts per class-subject
>   pair. `dash_wing_performance` does not, so the two disagree (Senior 55.1 vs
>   45.5 on Alliance). v5's definition is the one the whole page shares.
> * The "not handing work in" at-risk criterion is DORMANT until a class reaches
>   40% homework submission, the same shape as `optional_choices_recorded()`.
>   Ungated it flagged 1,542 of 1,545 Alliance students. Do not remove the gate.
> * `LEAST`/`GREATEST` ignore NULLs in Postgres. `LEAST(NULL, 180)` is 180, which
>   once made every non-submitter score 100%. COALESCE goes INSIDE them.
> * **The drawers are the only WRITE on the page** (2026-09-17,
>   `20260917140000_dash5_drawers.sql`). Five panels, five RPCs:
>   `dash5_assign_context`, `dash5_subject_roster`, `dash5_paper_detail`,
>   `dash5_never_signed_in`, `dash5_student_context`. Every assign control goes
>   through `useDash5CreateTask` → `create_task_group`; never write `tasks` or
>   `task_assignments` from the client (§11 fan-out).
> * `dash5_assign_context` falls back subject teacher → class teacher → wing
>   coordinator → school admin and returns `target.exact = false` when it had to.
>   Keep printing that difference: Alliance's Primary wing genuinely has no
>   coordinator, so the fallback is live.
> * **Prod SQL applied through `scripts/run-sql.ps1` must be plain ASCII.**
>   PowerShell 5.1 mangles non-ASCII in the request body, so a `·` inside a SQL
>   string literal lands in the database as `Â·`. Build such labels on the client.
>
> **Everything below still applies to `/school/snapshot`** (coordinator and
> teacher), which is unchanged and still uses the `dash_*` / `dash_scoped_*` /
> `dash_teacher_*` families and the widgets in `command-center/widgets/`.
name: command-center-dashboards
description: School-admin Command Center + coordinator/teacher scoped snapshot — dash_* and dash_scoped_* RPC families, 20-flag evaluator catalog, dashboard_flags lifecycle, DashboardScope context, hand-rolled tile gating. Use when touching /school/command-center, /school/snapshot, src/hooks/dashboard/, src/components/command-center/, dashboard_flags, any dash_* RPC, RoleBasedDashboard tiles, or exams.exam_type.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Command Center & Scoped Snapshot Dashboards

The principal-first Command Center (merged 2026-06-02) is a single-scroll read-mostly dashboard at `/school/command-center` built on SECURITY DEFINER `dash_*` RPCs. On 2026-06-06 a parallel `dash_scoped_*` family + a `DashboardScope` React context made the SAME components render a coordinator/teacher snapshot at `/school/snapshot` (scope resolved server-side from `auth.uid()`).

**The old gradient/tab Command Center UI is GONE** — commit c90a11a deleted `AlertsStrip`/`KpiRow`/`AcademicsPanel`/`QuickActions` and rewrote `CommandCenterPage.tsx`. `useCommandCenter` + `ReportModal` + `generateCBSEReports` survive ONLY behind the lazily-mounted `CbseReportsModal` kebab action. Don't recreate the deleted components from old docs.

## The cardinal rule: every dashboard hook needs BOTH variants

`src/hooks/dashboard/useDashboardData.ts` — one hook per panel; each reads `useDashboardScope()` and branches to `dash_<name>` vs `dash_scoped_<name>`. A new panel/hook calling only the admin RPC breaks for coordinators/teachers: `dash_resolve_institution` RAISES for those roles, so the panel errors on /school/snapshot. Pattern: branch on scope; scoped RPCs take NO institution/wing params (server resolves via `dash_resolve_scoped_classes()`: admin → all classes, coordinator → wing via `wing_assignments`→`wing_class_mappings`, teacher → `class_assignments role='teacher'`); put `scope` in the query key — `["dash", scope, ...]` — so the two scopes never share cache entries. DB side mirrors `supabase/migrations/20260602140000_dashboard_scoped_rpcs.sql`.

`DashboardScope.tsx` context **defaults to `"institution"`** — `CommandCenterPage` renders with NO provider (by design, don't "fix"); only `ScopedSnapshotPage` wraps in `<DashboardScopeProvider scope="scoped">`. `SchoolSnapshotPage.tsx` branches: admins (incl. admin+coordinator dual-role) → legacy `ComprehensivePrincipalDashboard`; coordinator/teacher → `ScopedSnapshotPage`. Role precedence (admin > coordinator > teacher) is mirrored client + server — change both or neither.

## DB layout (migrations 20260602100000…140000)

* `exams.exam_type` — NOT NULL DEFAULT 'unspecified', CHECK in ('term','unit','weekly','unspecified'); written by `useSaveExam`/`useUpdateExam` as `metadata.examType ?? "unspecified"`. Any other string violates the CHECK.
* `institutions.dashboard_adoption_flags_enabled` — backend-only kill switch for AD* flags.
* `dashboard_flags` — identity is the **partial unique index** `(institution_id, flag_code, subject_key) WHERE resolved_at IS NULL` (the evaluator's ON CONFLICT target; resolved rows fall out so conditions can re-open as new rows). RLS: admin roles only; NO INSERT policy (SECURITY DEFINER writes only); coordinators/teachers read via `dash_scoped_get_flags` — never direct table queries.
* Helpers: `dash_resolve_institution` (RAISES for non-admin), `dash_current_academic_year`, `dash_score_students(inst, p_weights)` — the "students who need help" scorer.
* RPC families: `dash_kpi_summary`, `dash_attendance_trend`, `dash_subject_performance`, `dash_student_distribution`, `dash_exam_trend`, `dash_subject_heatmap`, `dash_classes_table` / `dash_students_attention` / `dash_teachers_table` / `dash_recent_exams` (all `{rows,total}` jsonb, LIMIT/OFFSET), `dash_get_flags`, task lifecycle `dash_create_task_from_flag` / `dash_reassign_flag_task` / `dash_cancel_flag_task` — each with a `dash_scoped_*` mirror that re-verifies scope server-side.
* **Every "today" goes through `(now() AT TIME ZONE COALESCE(institutions.timezone,'Asia/Kolkata'))::date`** — a bare CURRENT_DATE in a new dashboard RPC reintroduces the §24 UTC bug class. "Working days" = distinct dates with attendance rows (deliberate proxy).
* Heatmap grouping: admin groups by wings when active wing mappings exist, else CBSE grade bands; scoped ALWAYS grade bands. Subject columns dedupe by `initcap(lower(btrim(name)))` (universal_subjects has per-grade duplicates).

## 20-flag catalog (`20260602110300_flag_evaluator_full_catalog.sql`)

Exams E1–E7, Attendance A1–A7 (A4 capped to 25 most-absent students), Adoption AD1–AD6 (gated on kill switch + institution age >14d; AD6 >30d). Evaluator: temp `_detected` → UPSERT on the partial identity (worst metric wins) → resolve vanished flags **only for codes in `v_codes` this run** (gated adoption codes excluded so they don't mass-resolve) → auto-create tasks for critical+red+taskless (due +2d) → amber→blue when task done but condition persists. Returns `{detected, resolved, auto_tasks}`. **Adding a flag code = detection block + v_codes, or stale instances never auto-resolve.**

Lifecycle: red (new) → amber (task exists) → blue (task closed, condition persists). `dash_cancel_flag_task` DELETEs the task and reverts to red. `dash_create_task_from_flag` is idempotent and forces `assigner_id = NULL` when caller == assignee (task_assignments `no_self_assignment` CHECK). Assignee resolution chain: class teacher → wing coordinator → subject teacher → first school_admin (`resolve_flag_assignee`).

**There is NO cron for `dash_evaluate_flags`** (verified — comments claiming a "15-min cron fallback" are aspirational). The ONLY trigger is `useEvaluateFlagsOnOpen` (`src/hooks/dashboard/useFlagActions.ts`): no-ops when scope === "scoped" (coordinators aren't authorized); sessionStorage hour-bucket key `salci:dash-flags:{institutionId}:{YYYY-MM-DD-HH}` claimed BEFORE the await, removed on failure. If you add a cron, keep the on-open kick.

## Sync contracts

* `SEVERITY_WEIGHTS` (`src/lib/dashboardConstants.ts`) is passed as `p_weights` to the students-attention RPCs, but the KPI count calls `dash_score_students(_scoped)` with NULL weights = SQL coalesce defaults. Tuning the TS constants without updating defaults in BOTH `20260602100300` and `20260602140000` makes the KPI and the table silently disagree.
* `src/hooks/dashboard/types.ts` mirrors the RPC jsonb shapes exactly — "do not widen".
* `FlagsFeed.tsx`: `FLAGS_PER_GROUP = 4` before per-group "Load more" (A4 alone can emit 25 flags); category order `['attendance','exams','adoption']` from `flagLifecycle.ts`; per-group expand state.

## Performance / §23 invariants

* **Never mount `useCommandCenter` on dashboard load** — it's a huge fan-out, deliberately confined to `CbseReportsModal` (`{cbseOpen && <CbseReportsModal/>}`). The primary "Download Report" is the scope-aware print-based `DashboardSnapshotReport`.
* One realtime channel `dashboard:{institutionId}` on `dashboard_flags` (admin page only — ScopedSnapshotPage intentionally has NO realtime). No per-widget subscriptions.
* All hooks `staleTime: 60_000`; hooks never pass `p_institution_id` (RPCs resolve from auth.uid()).
* `/school/command-center` and `/school/snapshot` are role-gated, NOT feature-gated (absent from FEATURE_URL_MAP).

## Hand-rolled tile gating (dashboard-wide invariant)

`RoleBasedDashboard.tsx` dispatches school_admin → `SchoolAdminCommandCenter`, coordinator → `CoordinatorDashboard`, student → `ComprehensiveStudentDashboard`. These render feature tiles OUTSIDE `NavigationHub` (which auto-gates via FEATURE_URL_MAP), so **every feature tile must be hand-wrapped in `isFeatureEnabled(...)`** (CoordinatorDashboard lines ~116–163, ComprehensiveStudentDashboard ~268/305, SchoolAdminCommandCenter `filterNavGroups`). `TeacherDashboard.tsx` and `SchoolAdminDashboard.tsx` in `src/components/dashboards/` are DEAD CODE (zero imports) — never use as reference; the live teacher dashboard is `ComprehensiveTeacherDashboard`.

## Known latent issues (verified in code 2026-06-10)

1. `useDashboardRealtime.ts` still invalidates pre-scoping keys `["dash","flags"]` / `["dash","kpi"]` which no longer prefix-match `["dash","institution","flags"]` — realtime invalidation is a silent no-op (header still looks live via lastUpdatedAt). Fix = update to the scoped key shape.
2. KPI `students_need_help.prev_count` is hardwired NULL — no snapshot mechanism exists; don't promise week-over-week deltas.
3. Super-admin "managing institution" mode: hooks never pass `p_institution_id`, so a super admin managing school X may get dash data for a different institution than the name/realtime header. Unverified whether intentional.

## The student roster has ONE definition: `institution_student_ids()`

Added 2026-09-05 after the Command Center showed two different student totals on the same screen: "Students 253" on the roster tile next to "0 of 252 logged in" in the adoption panel.

* **Never hand-roll a student count.** `public.institution_student_ids(_institution uuid)` is the definition: assigned to one of the institution's classes, `role = 'student'`, active profile, holds the student role. Every total must come from it. Repointed onto it: `dash_admin_roster_counts`, `dash_admin_digest`, `dash_student_portal_adoption`, `badge_rarity`. Migration `20260905190000`.
* **It is keyed on `class_assignments`, NOT `profiles.institution_id`** - deliberately. A student with no class receives no attendance, homework or exams, so they must not inflate a denominator. This also matches what the platform already did: of 487 public functions, 35 counted students through `class_assignments` and only 6 through `profiles`.
* **The two definitions disagreed in BOTH directions**, which is why neither number was simply "wrong": Salci National 253/252, Iscool 17/12, Product Testing 27/26 (accounts with no class) versus Alliance 1542/1545 and Vanshika 42/44 (students in a class whose profile had `institution_id` NULL, so account-based queries lost them - two of them had live exam results).
* **Adding stricter gates cost nothing.** Before adopting the strict form it was measured against class-assigned-only, +profile-active, +student-role and +class-active: all four produce identical counts in every institution, so the strictest was taken for free. Re-measure the same way before relaxing or tightening it.
* **The frontend counts through the same function.** `institution_student_count(uuid)` is the scalar wrapper (it counts `institution_student_ids`, so it cannot drift from it) and `SchoolStudentsPage`'s "Total Students" tile calls it. That tile previously counted `profiles` and so read 253 next to the Command Center's 252. Never count students from `profiles` + `user_roles` in a component.
* **A management LIST may legitimately be wider than the count.** `SchoolStudentsPage` left-joins `class_assignments` on purpose so a student with no class still appears, rendered "Not assigned" - hiding them would make them unfixable. So the list can show one more row than the tile; that is deliberate, and the row is visibly marked. Do not "fix" it by filtering them out.
* **`student_roster_anomalies()`** is the standing drift report (read-only, run via `scripts/run-sql.ps1`). Kinds `no_institution_on_profile`, `institution_mismatch` and `student_in_two_schools` must stay EMPTY - they are the states that make totals disagree. `account_without_a_class` is informational: 195 of its 214 rows are Olympiad-only demo schools where students correctly have no class, and the canonical roster excludes them by design.

## "Teachers by activity" measures real teaching, not staff check-in

Rebuilt 2026-09-05, migration `20260905220000_teachers_by_real_activity.sql`.

* **Four metrics, all 30-day and all index-backed:** `lessons_30d` (`tt_lesson_plans` status='done'), `attendance_days_30d` (DISTINCT dates in `attendance_records.marked_by` — six classes in one day is one day of the habit), `homework_30d` (`homework_assignments.created_by`), `exams_30d` (`exams.created_by`). `activity_score` is their sum and drives the ordering.
* **`attendance_30d` is GONE from the payload, do not bring it back.** It was the teacher's own staff check-in rate, not whether they mark registers — everyone read "0% attendance" as "never marks the register". At Salci National every teacher showed 0% because they each had ~21 auto-marked-absent rows and zero check-ins: the metric was reporting an unused feature as a staff failing. Staff check-in has its own surface.
* **A teacher with no records got NO chip, which looked better than 0%.** Now a genuinely inactive teacher gets one explicit chip, "Nothing logged in 30 days", and every other chip renders only when its count is non-zero, so a row is never a wall of zeroes.
* **Ordering is least-active-first**, with brand-new profiles (`is_new`) held back so someone who joined this week is not top of an inactivity list. This is what makes the panel useful: at Alliance it surfaces Gurwinder Singh, 13 classes and zero activity in 30 days.
* **The `dash_scoped_teachers_table` twin MUST keep the same shape** — the coordinator snapshot shares the `TeachersTableRow` type, so a missing field renders undefined chips. Lessons and registers are additionally narrowed to the coordinator's classes; homework and exams are authored by the teacher and so are already teacher-scoped. Verified both return the same keys.
* **The badge NAMES the reason, and never says "OK" for someone who did nothing.** It reads `flag_title` (the most severe open flag, with `flag_detail` on hover), else "Active" when `activity_score > 0`, else "No activity". The old "1 FLAGGED"/"OK" pair was unreadable: it never said what for, and two teachers with identical chips showed opposite badges.
* **Why the old "OK" was actively wrong.** The ONLY live teacher flag is **SY1 "Syllabus logging is behind"**, from `dash_evaluate_syllabus_flags`, which fires at **more than 3 school days** with unlogged syllabus. Its school days come from `tt_slots`, but only for slots whose subject has at least one **active chapter** — the deliberate trap-freedom clause, since you cannot demand progress on a subject with no syllabus loaded. At Salci National: Anita Sharma 36/36 slots with chapters → flagged; Bikash Das 28 slots, **0 with chapters** → exempt → showed a green "OK" next to "nothing logged". "OK" meant *we cannot measure this person*, which is a syllabus-setup gap, not a teacher doing fine. If a new teacher flag code is added, re-check this branch.
* **"Load more staff" carries no count.** Only `limit` rows are fetched (24), so the old "(19 left)" quoted the remainder of the fetch as if it were the remainder of the school (61). The true total is on the "See all N staff" link.
* Consumers to update together: `DashSections.tsx` (chips + caption), `hooks/dashboard/types.ts` (`TeachersTableRow`), and `DashboardSnapshotReport.tsx` (the PDF drill-down table AND its `emptyRow()` colspan).
