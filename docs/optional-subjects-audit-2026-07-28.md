# Optional Subjects — Cross-Module Loophole Audit

**Date:** 2026-07-28 · **Status:** findings only, no fixes applied
**Scope:** how the optional-subjects system (built 2026-06-17, phases P0–P6 + bugfixes) coordinates with timetable, exam creation, results/marking, syllabus/lesson-planning, homework, study materials, attendance/substitutions, dashboards, and the enrollment lifecycle.
**Method:** direct read of the 7 optional-subject migrations + timetable band frontend, plus three parallel deep audits (exam lifecycle · timetable periphery · content surfaces & permissions) with file:line evidence.

---

## STATUS UPDATE - 2026-09-10 (read this before trusting a severity below)

Fixed and verified in prod (migrations `20260910160000`, `20260910170000`, `20260910180000`):
* **Optional-group periods are dead ends for teachers** - FIXED. `tt_lesson_plans` re-keyed per subject, so a basket period is now an ordinary period with an ordinary lesson plan. It had never held a single plan row across 170 periods / 17 classes / 25 teachers.
* **Check-out gate said "Nothing to log today"** to a teacher of an optional subject - FIXED (`teacher_pending_syllabus_days`, with its lockstep partner `dash_evaluate_syllabus_flags`).
* **Coverage omitted optional subjects from the denominator** - FIXED (`dash_syllabus_coverage_build`); a teacher whose whole load is optional no longer gets a blank panel (`dash_scoped_syllabus_coverage`).
* **Chapter projection skipped optional periods** - FIXED (`teacher_/class_projection_for_range`).
* **Absent optional teacher was never marked absent and no cover was raised** - FIXED (attendance pass + auto-sub).
* **Optional periods counted as zero teacher load**, so admins double-booked those teachers - FIXED (`useTeacherLoadV2`).
* **Student week swallowed the optional-choice RPC error** (any failure read as "not selected") and **StudentWeekPageV2 had no error state** (a failed query said "you aren't enrolled in a class") - FIXED.
* **Substitute mode silently did nothing** on a basket cell - FIXED (it explains itself).
* **Printed timetable showed only the basket name** - FIXED (lists each subject and its teacher).
* **Class-list "cells filled" was truncated at 1000 rows** for both live schools, so classes read as never set up - FIXED (`tt_class_fill_counts`, server-side).

Still open from the list below: `tt_substitutions` cannot express per-subject cover (needs schema); `record_syllabus_progress` authorises by class not subject (§25); the exam-side items (offline_section_marks eligibility, OCR/scan rosters, results showing unenrolled as "Not Attempted", exam creation optional-awareness, `exam_published` fan-out, hybrid exams with no guard); and study materials leaking to unenrolled students.

## 1. What exists today (architecture recap)

| Layer | Object | Notes |
|---|---|---|
| Classification | `subject_class_group_mappings.is_optional` → fanout to `subject_class_mappings.is_optional` | P0. Authored in 3 dialogs (AssignSubjectToClassDialog, AddSchoolSubjectDialog, EditSubjectDialog) |
| Enrollment | `student_optional_enrollments` (student, subject, `is_active`, UNIQUE(student,subject)) | P1. Source of truth. Written only via per-student toggle in StudentSubjectsTab (ViewUserSheet) |
| Student filtering | `student_blocked_subject_ids`, `exam_visible_to_student`, `student_eligible_exams.subject_visible`, homework feed + attempt-start trigger `trg_enforce_exam_subject_enrollment` | P3. Exams + homework only |
| Marking rosters | `homework_marking_roster` (filtered), `exam_marking_eligible_students` | P4 |
| Batches | `optional_batches` (subject, teacher_id, label, `academic_year`), roster `optional_batch_students` (⊆ enrollments by trigger), may span sections | P5. Admin UI: `/school/optional-batches` (OptionalBatchesPage) |
| Timetable band | `tt_slots.is_optional_band` (stored as `slot_type='free'`), `optional_band_slots` (band cell ↔ batch), RPCs `student_band_resolution`, `band_slot_batches` | P6. UI: toggle + batch checklist in SlotDrawerV2; student week substitutes per-student |
| Roster helper | `teacher_roster_student_ids` (enrolled-only for optional subjects + batch arm) | Bugfixes migration |

The **server-side data model is largely complete**. The loopholes are almost all in (a) what was never wired to the frontend, (b) every subsystem that keys on `tt_slots.teacher_id` / `class_assignments` and therefore can't see bands/batches, and (c) missing workflow surfaces.

---

## 2. SECURITY findings

### S-1. `student_band_resolution` + `band_slot_batches` are unauthenticated-by-argument SECURITY DEFINER RPCs — CRITICAL

> **Status 2026-09-09:** PUBLIC and anon EXECUTE closed on both RPCs and on the six `can_*` / `optional_batch_teacher_can_see` RLS helpers and three trigger functions of this plane (`scripts/revoke-anon-optional-helpers-20260909.sql`, applied and verified via `pg_proc.proacl`; `authenticated` kept so RLS still evaluates). The argument-trust hole itself is **still OPEN**: both bodies still trust `_student` / `_band_slot` and never call `auth.uid()`.
`supabase/migrations/20260617150000_optional_subjects_p6_band.sql:79-100` — takes `_student uuid` from the caller, **no `auth.uid()` check in the body**, `GRANT EXECUTE TO authenticated`. Any logged-in user (including any student) can enumerate any other student's optional-batch schedule (subject + teacher per period).
`:103-119` — `band_slot_batches` defines `can_view_band_slot` at `:47-57` and **never calls it**; any authenticated user can read any band's batches/teachers/roster counts. (`band_slot_batches` also has zero frontend callers — dead but exposed.)
→ Add both to the standing security-audit backlog (`docs/security-audit-2026-07-07.md`).

### S-2. Hybrid exams have NO enrollment guard — HIGH
The P3 trigger sits only on `student_exam_attempts`. `hybrid_exam_attempts` (`20260516150000_hybrid_exam_mode_phase_1.sql:39-71`) has no equivalent; `useStartHybridAttempt` (`src/hooks/useHybridAttempt.ts:116-162`) checks only mode + status. A blocked student reaching `/student/hybrid-exam/...` (stale link, UpcomingExamSheet) starts a real attempt. Client-side `subject_visible` list filtering is the only protection.

---

## 3. The disconnected core: batches & bands

### C-1. `optional_batches.teacher_id` grants ZERO teaching rights — CRITICAL (root cause)
`useUpsertOptionalBatch` (`src/hooks/useOptionalBatches.ts:103-146`) writes only `optional_batches`; nothing writes `class_assignments` or `subject_class_group_mappings`. Every permission surface reads `class_assignments`:
- **Exam creation**: `ExamDetailsScreen.tsx:88-113` via `useTeacherAssignedSubjects` (`class_assignments`) → batch teacher sees "No subjects assigned to you for this class" (and no class at all).
- **Homework creation**: `useHomeworkScope.ts:61,113-142` → "No classes available", flow blocked.
- **Study materials upload**: `AddSchoolStudyMaterialDialog.tsx:218-280` → no class/subject options.
- **Question bank scope**: `useQuestionScope.ts:111-125` → no "sections I teach".
- **Marking/evaluations**: nothing to mark (no owned exams/homework).
- **Timetable RLS**: `tt_slots_select_teacher_own` (`20260504100000:91-97`) = `teacher_id = auth.uid()`; band cells store `teacher_id NULL` (`SlotDrawerV2.tsx:172-178`) → batch teacher cannot even read the slot row.
Also: `/school/optional-batches` route excludes the `teacher` role (`App.tsx:556-562`); the `ob_select` RLS arm `teacher_id = auth.uid()` is dead code — **no teacher-facing batch UI exists at all**.

### C-2. Batch teachers are invisible to the whole teacher-side product — CRITICAL
- `useTeacherWeekV2` (`useTimetableV2.ts:607-663`) queries `tt_slots.eq("teacher_id", user.id)` only; no batch/band union.
- Worse: `useTeacherTimetableStatusV2` (`:691-743`) counts owned slots; zero → `TeacherMyWeekPageV2.tsx:279-281,559-563` shows the **false blocker** "Time table is yet to be approved by the coordinator… your periods will appear here". They never will.
- Side finding: `isSubstitute` hard-coded `false` at `useTimetableV2.ts:655`; the week query also never pulls covered slots.

### C-3. Absent batch teacher = uncovered class, silently — CRITICAL (operational)
- Auto-absence scan: `tt_run_attendance_pass_for_institution` builds `staff_today` from `tt_slots … teacher_id IS NOT NULL` (`20260525120000:110-116`) → batch-only teacher never auto-marked absent.
- Auto-subs: `tt_create_pending_subs_for_absent_staff` joins `absent_staff.staff_id = s.teacher_id` (`20260509100000:310-321`) → band cells can't generate a pending sub.
- Manual fallback impossible: substitute mode bails on `!existingSlot.teacher_id` (`ClassWorkspaceV2.tsx:226-228`) — tapping a band cell is a silent no-op. And the model can't express per-batch cover anyway: `tt_substitutions UNIQUE(slot_id,date)`, single `substitute_teacher_id`, no `batch_id` (`20260424100000:197-205`).

### C-4. AY rollover destroys the band setup silently; enrollment vs batch AY asymmetry — CRITICAL (time-bomb, fires at 2027-28 rollover)
- `copy-timetable-template/index.ts:137-138,156-168` selects/inserts **without `is_optional_band`** (falls to DEFAULT false) and never touches `optional_band_slots`/`optional_batches`. Next year: plain "Free" cells, success response, no warning. Rebuilding = re-toggle every cell + recreate every batch + re-schedule every link, by hand.
- Asymmetry: `optional_batches.academic_year NOT NULL` and filtered on (`useOptionalBatches.ts:63`) — but `student_optional_enrollments.academic_year` is **never written** (upsert payload `useStudentOptionalSubjects.ts:98-106` omits it; every row NULL). `promote-students/index.ts:126-151` never touches enrollments. So at every rollover: batches vanish, enrollments silently carry forward un-reconfirmed.

### C-5. Syllabus/lesson-plan/coverage systems structurally cannot capture band teaching — HIGH
- `tt_lesson_plans UNIQUE(slot_id,date)` (`20260424100000:242`): N batches contend for ONE plan row; `useUpsertLessonPlan` upserts on that key (`useTimetableV2.ts:1198`) — batch B overwrites batch A. No path in anyway (batch teacher can't see the slot; `LessonPlanDialogV2.tsx:118-129` needs `slot.subject_id`, NULL for bands).
- Two-timeline syllabus: `record_syllabus_progress` authz (`20260704141000:239-247`) = slot-edit helper OR `class_assignments` OR `tt_slots.teacher_id` — **`optional_batches.teacher_id` not in the list** → batch teacher gets "not allowed". The coverage dual-write (`:271-280`) needs a matching theory/practical slot with the subject — never exists for bands. `syllabus_progress_events` is keyed by `class_id` — a cross-section batch has no single class_id; the data model can't represent it.
- Check-out gate: `teacher_pending_syllabus_days` (`:42-48,66-69`) filters `teacher_id = uid AND slot_type IN ('theory','practical') AND subject_id IS NOT NULL` → batch-only teacher sees "Nothing to log today".
- Coverage dashboards: `dash_syllabus_coverage` combos require `s.subject_id IS NOT NULL` (`20260623150000:62-77`) → optional subjects taught only in bands are **absent** (not 0% — absent). `dash_scoped_syllabus_coverage:219-223` scopes teachers via `tt_slots.teacher_id` → batch teacher gets an empty panel. Lesson-plan export same (`20260623130000:134,201`).
- Student projection overlay: `class_projection_for_range` (`20260706120000:276-295`) same filters → chapter overlay blank on band cells.

### C-6. Cross-section coordination is entirely manual and unvalidated — HIGH (the user-reported gap)
Acknowledged in-migration ("cross-section alignment is manual", `20260617150000:21`). Concretely:
- To run "all Grade 12 sections do optionals Tuesday P3": toggle the band in each section workspace separately, save, reopen, tick the same batches into each cell (`SlotDrawerV2.tsx:350-380`, two-step "Save the band first, then re-open").
- **Nothing validates alignment with rosters**: a 12-B student in a French batch scheduled only into 12-A's band cell has a silent conflict — their own section may have Maths at that period; the batch meets without them. No warning at batch-roster time, band-schedule time, or anywhere.
- The drawer's batch checklist lists **every batch in the institution** for the AY — no filter by class group/grade, archived batches included (`useOptionalBatches.ts:55-101` has no status filter; `SlotDrawerV2.tsx:137-140`). A Grade-9 batch can be scheduled into a Grade-12 band.
- No per-period teacher conflict detection exists at all: no `(teacher_id, day, period_slot_id)` constraint (`20260424100000:177`), no availability check in the teacher picker (`SlotDrawerV2.tsx:312-346` — the skill-doc "Busy/Free badge" no longer exists in code), and `useTeacherLoadV2` excludes band load entirely (`useTimetableV2.ts:2217-2223`, `teacher_id IS NOT NULL`) and is per-day, not per-period. Batch teachers can be double-booked with zero signal.

### C-7. Bands are visually indistinguishable from free periods — MEDIUM
- Admin grid: `TimetableGridV2.tsx:227-234,267` renders a band cell as "Free" (student view happens to override subject_name; admin view doesn't). A coordinator can't tell a deliberate band from an unfilled cell; `filledCount` counts it either way.
- Print: `TimetablePrintViewV2.tsx:228-250` prints "Free" — the sheet handed to staff/parents shows free periods where optionals run.
- Student fallback label: a student whose batch simply wasn't scheduled into the cell sees "Optional · not enrolled" (`useTimetableV2.ts:884`) — wrong message for a scheduling omission; also shown to genuinely-unenrolled students with no guidance.
- Multi-batch membership: two batches of the same subject scheduled into one cell → `Map` last-row-wins (`useTimetableV2.ts:877-880`); nothing prevents a student being on two batches of one subject.

---

## 4. Exam lifecycle

### E-1. `offline_section_marks` pipeline (results-only exams) ignores eligibility AND hard-fails non-atomically — HIGH
`useOfflineMarksEntry.ts:98-117` builds the grid from raw `class_assignments` (no `exam_marking_eligible_students` call — the P4 fix covered only the sibling `useOfflineMarks.ts:113-124`). Save path: `OfflineMarksEntryScreen.tsx:147-155` submits ALL rows; `useOfflineMarksEntry.ts:222-243` loops attempt-inserts per student with no transaction (docblock claims "one atomic batch") — first blocked student trips the P3 trigger (42501), earlier students already committed to `offline_section_marks` + `final_results`, teacher sees generic "Couldn't save marks." over a half-written grid. Reachable from ExamsPage (`:859-869`), ExamCreationFlow (`:531`), OfflineMarksEntryPage.

### E-2. OCR / offline-scan surfaces use raw class rosters and will 42501 mid-loop — HIGH
`useScanSheetsData.ts:82-86,137-144` (expected-count denominator + roster), `OfflineScanFlow.tsx:60-71`, `useOfflineScan.ts:173-182` + attempt creation `:252-268`, `useOfflineExamUpload.ts:75-82` + `:144-153`. Same class of bug as E-1, four more call sites.

### E-3. Exam results view shows unenrolled students as "Not Attempted" — HIGH
`useExamResults.ts:66-70` roster from raw `class_assignments`; no-attempt → `status="not_attempted"` (`:146`); inflates `totalStudents` / `notAttempted` KPIs (`:512-533`; `ExamResultsView.tsx:194,212,319-326`). Teachers chase students who were never eligible. Mitigations that DO hold: validation publishes only `is_submitted=true` attempts; `canValidate` unaffected; `get_exam_window_status` attempt-anchored.

### E-4. Exam creation has zero optional awareness — MEDIUM
Targeting is class-section only (`useSaveExam.ts:229-248`: `exam_classes` + `exam_subjects`); no batch targeting concept; `optional_batches` referenced nowhere under exam-creation. The subject dropdown doesn't mark optional subjects: `useClassSubjects` returns `is_optional` (`useClassSubjects.ts:104-110`) but `ExamDetailsScreen.tsx:96-117,521-525` drops it; the teacher path (`useTeacherAssignedSubjects.ts:47-52`) can't even carry it. A creator can't tell "French" reaches 6 of 40 students.

### E-5. `exam_published` notifications fan out to unenrolled students — MEDIUM
`useUpdateExam.ts:349-373` notifies every `class_assignments` row; blocked students get a deep link to an exam that's invisible to them (and the notification leaks its title).

### E-6. The 42501 trigger message survives only by accident — LOW
`useExamAttempt.ts:236-239` uses raw `toast.error(error.message)` (non-standard), which happens to show the helpful trigger text. Project-standard `toastError` would map 42501 → generic "You don't have permission to do this." (`errorMessages.ts:28,133-135`); the trigger message isn't in the Priority-1 regex block (`:98-131`). Any migration of that call site to `toastError` silently degrades the UX.

### E-7. Multi-subject exams defeat the filter by design — LOW (documented behavior, sharp edge)
`exam_visible_to_student` returns true if ANY linked subject is unblocked (`20260617120000:52-58`). A combined paper (compulsory + optional) is visible/startable/markable for every class member. Also `student_subject_class_comparison` fans one percentage out to every linked subject (`20260622120000:44-45`), amplified for combined papers.

### E-8. Analytics/aggregates are correct only incidentally — INFO
`useExamAnalytics`, `useReportAnalytics`, `compute-aggregates`, CBSE/My-Results paths are all attempt-anchored, so blocked students never pollute denominators — but only because of the P3 trigger. The moment E-1/E-2 create attempts for blocked students, those flow straight into analytics.

---

## 5. Content & roster surfaces

### R-1. Study materials leak to unenrolled students — HIGH
`useIsolatedStudyMaterials.ts:116-139` never reads `is_optional` / `student_blocked_subject_ids`; `:191-217` actively widens to same-named sibling subjects. RLS is institution-scoped only (`20260112124908:254-256`). `useStudentVisibleSubjects` — the hook whose docstring promises exactly this filtering — has **zero consumers** (`useStudentOptionalSubjects.ts:60-73`). The Main/Optional badge on StudentStudyMaterialsPage is label-only and absent for unenrolled optionals (`:70,142-153,306-313`) — they render like compulsory subjects.

### R-2. Student week view shows regular-slot optionals to the whole section — HIGH
If a school schedules an optional as a normal theory period (the non-band pattern), every section student sees it as their own period: `useStudentWeekV2` (`useTimetableV2.ts:824-865`) does no subject filtering; the P3 migration has zero `tt_slots` references; RLS `tt_slots_select_published_for_class` (`20260424100000:602-611`) has no enrollment predicate.

### R-3. `teacher_roster_student_ids` adopted by exactly one surface — MEDIUM
Only `TeacherStudentsPage.tsx:120-127`. Attendance (`useClassAttendance.ts:113-128`) and evaluations still show whole-class rosters to optional-subject teachers. Even the adopter can't reach the cross-section batch arm: `classIds` derive from the teacher's own `class_assignments` (`:96,:103,:157`) → pure batch teacher passes `[]`, cross-section roster unreachable.

### R-4. Class-comparison cohort is section-bound, not enrollment/batch-bound — MEDIUM
`student_resolve_classes()` (`20260622120000:18-24`) = caller's own sections. Averages aren't diluted by non-takers (attempt-anchored, accidental), but a cross-section batch student is ranked against only their own section's subset — small n, misleading percentile.

---

## 6. Lifecycle & admin operations

### L-1. Enrollment lifecycle is un-versioned and un-scoped — HIGH
- `academic_year` never written (always NULL) — `useStudentOptionalSubjects.ts:98-106`.
- Section move (`AssignStudentClassDialog.tsx:95-117`) and promotion (`promote-students/index.ts:126-151`) never touch `student_optional_enrollments`: silent auto-enroll (new section offers the same optional → instantly enrolled, no confirmation/audit), silent drop (subject not offered → disappears from view, row lingers with stale `class_id`), stale batch rosters (moved student vanishes from roster views but stays on the batch).
- `class_id` on the enrollment row is written but never used, and in practice always NULL (StudentSubjectsTab never passes it).

### L-2. No admin visibility into enrollment state — HIGH (workflow)
- No per-class enrollment matrix ("Class 9-A: who takes French/Sanskrit/German") anywhere; `get_student_subject_assignment` is per-student (ViewUserSheet only); `optional_subject_enrolled_students` is reachable only inside a batch roster sheet.
- **Unassigned students are unfindable**: both RPCs are enrollment-positive; no query returns "students of section X with 0 active optional enrollments where optionals are offered".
- Zero optional-awareness in the 20-flag dashboard catalog (`20260602110300` + scoped follow-ups): no flag for un-enrolled students, teacher-less batches, batch-less optional subjects, or unaligned band cells.
- Enrollment is one-student-at-a-time (profile → Subjects tab toggle); no bulk-enroll surface. 60 students = 60 sheet-open-toggle cycles.

### L-3. Discoverability — MEDIUM
- `/school/optional-batches` has a route (`App.tsx:556-562`) but **no sidebar/NavigationHub entry** — URL-only.
- OptionalBatchesPage has zero timetable awareness (can't see where a batch is scheduled, or that it isn't).
- Band UI is a two-step save-then-reopen flow (`SlotDrawerV2.tsx:355`).
- `currentAcademicYear()` (sync heuristic) is used by both OptionalBatchesPage and the drawer's batch list — not the institution's active `cal_academic_years` row; mismatch breaks the batch list silently for schools whose AY differs from the Apr–Mar heuristic.

### L-4. Homework can't target batches; audience silently narrows — MEDIUM
`useHomeworkSave.ts:67-83` writes whole classes + subjects only. Server-side pruning (correct, P3/P4) means a teacher targeting "9-A + French" reaches 6 of 40 with no UI signal. The picker doesn't mark optional subjects (`useHomeworkScope.ts:90-142` drops `is_optional`).

---

## 7. Dead code & stale docs (cleanup list)

- `useStudentVisibleSubjects` (`useStudentOptionalSubjects.ts:60-73`) — zero consumers.
- `band_slot_batches` RPC — zero frontend callers (drawer uses raw-table `useBandScheduledBatchIds`); also unauthenticated (S-1).
- `ob_select` teacher arm (`teacher_id = auth.uid()`) — dead grant, no teacher UI.
- `timetable-module` skill doc claims a "Busy/Free" badge in SlotDrawerV2 — no longer exists in code (grep `busy|available` in timetable-v2 → nothing relevant).
- `useTeacherWeekV2.isSubstitute` hard-coded `false` (`useTimetableV2.ts:655`).

---

## 8. Ranked top loopholes (worst first)

1. **C-1/C-2** Batch teachers have no rights and no visibility anywhere — the batch feature is admin-only bookkeeping; the teacher named on it can't see, teach, plan, examine, or mark their own batch. (Root cause for half the list.)
2. **C-3** An absent batch teacher produces no absence record, no auto-sub, and manual substitution is impossible on band cells — a class sits uncovered with zero signal.
3. **S-1** `student_band_resolution` / `band_slot_batches` let any authenticated user enumerate any student's optional schedule and any batch roster.
4. **C-4** AY rollover silently destroys bands/batch links while AY-less enrollments silently carry forward — guaranteed data loss at the 2027-28 transition.
5. **S-2** Hybrid exams bypass the enrollment guard entirely.
6. **E-1/E-2** Results-only marks entry + all OCR/scan surfaces show unenrolled students and can hard-fail mid-write, leaving partial `final_results`.
7. **C-5** Optional-subject teaching via bands is uncapturable: lesson plans, syllabus progress, coverage dashboards, check-out gate, projections — all blind; optional subjects show as *absent* (not 0%) in coverage.
8. **R-1** Study materials leak to unenrolled students (the one P3 surface never wired).
9. **C-6** Cross-section band alignment is manual and unvalidated — batch rosters and section band cells can silently disagree; no per-period teacher conflict detection exists at all.
10. **E-3** Exam results list unenrolled students as "Not Attempted" and inflate KPIs.
11. **L-1/L-2** Enrollment lifecycle (AY, promotion, section moves) is unmanaged; admins have no enrollment matrix, no unassigned-student view, no bulk enroll, no dashboard flag.
12. **R-2 + C-7 + L-3** Visibility/discoverability: regular-slot optionals shown to whole section; bands render as "Free" in grid and print; batches page unlinked; creators can't see `is_optional`.

---

## 9. Suggested fix phases (for planning, not executed)

- **Phase A — safety (small, ship first):** auth-guard the two P6 RPCs (S-1); add the enrollment trigger to `hybrid_exam_attempts` (S-2); filter `useOfflineMarksEntry` + scan surfaces via `exam_marking_eligible_students` and make the save loop skip-ineligible instead of throwing (E-1/E-2); filter `useExamResultsStudents` (E-3); register the 42501 trigger message in `errorMessages.ts` (E-6).
- **Phase B — make batches real:** decide the rights model (write `class_assignments` on batch create, or teach permission surfaces to read `optional_batches.teacher_id`); teacher week/RLS band visibility; per-batch lesson-plan/syllabus capture (needs schema: plan rows keyed by batch, `syllabus_progress_events` batch dimension or per-section fanout); attendance/subs awareness; batch teacher in load/conflicts.
- **Phase C — the workflow the user asked for:** group-level band designer ("apply band to all sections of Grade 12 at Tue-P3" in one action), roster↔schedule alignment validation, band rendering in grid/print, sidebar entry, batch list scoping (class group + active), bulk enrollment + per-class enrollment matrix + unassigned-student view/flag, `is_optional` badges in every creator dropdown.
- **Phase D — lifecycle:** AY-stamp enrollments, promotion/section-move handling (re-confirm or archive), rollover copy of bands/batches (or an explicit "rebuild optionals" step in NewYearSetupDialog).
