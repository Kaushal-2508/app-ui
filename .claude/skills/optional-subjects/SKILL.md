---
name: optional-subjects
description: Optional (elective) subjects — the Optional Groups model, student_optional_enrollments as the single enrollment store, the dormancy gate that keeps narrowing inert until a section records choices, the retired main/optional classification, and the superseded batches/bands plane. Use when touching optional_groups, optional_group_subjects, student_optional_enrollments, optional_batches, band slots, subject_class_group_mappings.is_optional, set_student_optional_group_choices, get_student_optional_group_assignment, upsert_optional_group, student_band_resolution, or any exam/homework/roster filter that depends on whether a student takes a subject.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Optional Subjects

DB live and frontend merged 2026-07-29 / 2026-07-30. Design: [docs/superpowers/specs/2026-07-29-optional-groups-design.md](../../../docs/superpowers/specs/2026-07-29-optional-groups-design.md). Audit: [docs/optional-subjects-audit-2026-07-28.md](../../../docs/optional-subjects-audit-2026-07-28.md) (findings-only, much of it still OPEN). Migrations: the `20260617*` P0-P6 series, `20260709120000`, `20260729120000_optional_groups.sql`, `20260729150000`, `20260730120000_optional_classification_main_only.sql`, `20260825150000_optional_dormant_until_chosen.sql`, `20260826140000`.

## 1. The model: Optional Groups

An **optional group** is a named basket of subjects ("Optional 1", "Optional 2") attached to a `class_group`. All subjects of a group run in parallel in the same timetable period, and each student picks **at most one subject per group**.

* `optional_groups` — `(institution_id, class_group_id, name, position)`, UNIQUE on `(class_group_id, name)`.
* `optional_group_subjects` — the basket membership.
* **Student choices write into the EXISTING `student_optional_enrollments` table** (soft `is_active` toggle). This is the load-bearing decision: all the pre-existing exam and homework filtering keeps working with zero new filtering code.
* **Group subjects are auto-marked `is_optional=true` on `subject_class_group_mappings`**, and the existing fanout trigger mirrors that to `subject_class_mappings` per section (the dual-table invariant — see `class-groups` skill; never write `subject_class_mappings` directly).
* **Teachers get rights through normal `class_assignments`.** This model has no "batch teacher" hole (contrast §4).

**Optional Groups is the only enrollment workflow.** Do not add a second writer to `student_optional_enrollments`.

RPCs: `upsert_optional_group`, `set_optional_group_subject`, `delete_optional_group`, `get_student_optional_group_assignment`, `set_student_optional_group_choices`, `my_optional_slot_choices`, `my_teacher_optional_week`. Authority helpers: `can_manage_optional_groups`, `can_view_optional_group`, `can_manage_optional_group`, `can_view_student_optional_choices`.

**Teachers cannot change a student's optional subjects** — revoked 2026-08-26 (`20260826140000`). Only admins and coordinators may.

**Two UIs write choices, ONE RPC.** Per student: `StudentSubjectsTab` (ViewUserSheet → Subjects). Per section: `UpdateOptionalSubjectSheet` (Students page → Update Student Details → Update Optional Subjects, added 2026-09-07) — Classes › Section › one dropdown per group per student, admin + wing-scoped coordinator only, `BulkUpdateStudentsDialog.onOpenOptionalSubjectPicker` is deliberately NOT passed from `TeacherStudentsPage`. Both call `set_student_optional_group_choices`; the section sheet sends only the changed groups per student, one call per changed student. Its read side is `useSectionOptionalChoices` — a direct, chunked, bounded read of `student_optional_enrollments` (RLS `soe_select_manage`) resolved with the same "latest `updated_at` wins per group" rule as `get_student_optional_group_assignment`; a failed read blocks editing so a save can never wipe choices it never saw. The shared Class/Section/Breadcrumb steps for all three "Update …" sheets live in `SectionPickerSteps.tsx`.

## 2. Narrowing is DORMANT until a section records choices (CRITICAL)

**An optional subject narrows nothing until at least one active choice exists for that `(subject, section)`.** Until then it behaves as compulsory: whole class, fully visible. The gate is `optional_choices_recorded(_subject, _class)` and **every** optional filter — roster, exam visibility, homework, study materials, week view — must be behind it.

The Alliance incident, 2026-08-25: AIS flagged subjects optional in May but never recorded a single senior-class choice, and all three narrowing helpers **failed closed on missing data**. 6 teachers saw zero students across up to 12 classes each, and 3,827 live student-subject blocks hid exams and homework for Class 10-12, with `trg_enforce_exam_subject_enrollment` refusing attempt starts. P3's stated intent was always "behavioural no-op until used" — it was just keyed on the individual student instead of the section.

**`student_optional_enrollments.class_id` is NULL on every real row** (the optional-groups writer never populates it). "Has this section recorded choices?" must join through `class_assignments`. **Never key on `soe.class_id`.**

The three-branch shape, duplicated in `teacher_controls_student` and `teacher_roster_student_ids` — keep them identical:

```sql
scm.is_optional IS NOT TRUE                                    -- compulsory / unmapped -> whole class
OR NOT public.optional_choices_recorded(subject_id, class_id)  -- optional but dormant  -> whole class
OR EXISTS (... student_optional_enrollments soe WHERE soe.is_active) -- optional + in use -> enrolled only
```

Student-side helpers with the same gate: `student_visible_subject_ids`, `student_blocked_subject_ids`. Teacher side: `teacher-authority-scope` skill.

## 3. The main/optional classification is RETIRED

Killed 2026-07-30. **Every optional choice a student picks counts as a MAIN subject.**

`student_optional_enrollments.classification` is pinned at the database: existing rows backfilled to `'main'` (9 of 12 prod rows were `'optional'`; snapshot in `salci_backups.soe_classification_20260730`), DEFAULT flipped to `'main'`, and the **CHECK narrowed to `('main')`** so nothing can silently reintroduce the distinction — a stale cached client calling the removed classification write now fails loudly.

**The column is deliberately KEPT, not dropped**: `get_student_subject_assignment` and `get_student_optional_group_assignment` both read it, so dropping it would mean rewriting two large RPCs for zero gain. It returns a constant `'main'` and no client reads it. All frontend hooks, types and badges were deleted. **Never add a writer.**

Rollback if ever needed: restore from the backup, widen the CHECK to `('main','optional')`, reset the DEFAULT.

## 4. Batches and bands are SUPERSEDED

The P5/P6 `optional_batches` + band-slot scheduling plane is superseded by Optional Groups. **Tables are left in place with no new writes.** Do not build on them; do not delete them either (the legacy optional-batch branch in `teacher_controls_student` still reads `optional_batches` / `optional_batch_students`).

Why they were abandoned, from the 2026-07-28 audit — these are the traps if anyone revives the plane:
* **`optional_batches.teacher_id` grants ZERO teaching rights** (root cause). A batch teacher is invisible to the entire teacher-side product, and an absent batch teacher reads as an uncovered class, silently.
* **AY rollover destroys the band setup silently**, with an enrollment-vs-batch academic-year asymmetry — a time bomb that fires at the 2027-28 rollover.
* Syllabus, lesson-plan and coverage systems structurally cannot capture band teaching. Bands are visually indistinguishable from free periods.
* **`student_band_resolution` and `band_slot_batches` are unauthenticated-by-argument SECURITY DEFINER RPCs** (audit S-1, CRITICAL). Any authenticated caller can pass someone else's student id. Still open — do not copy their shape, and see `prod-operations` for the grant contract.

## 5. Still-open audit findings (do not assume fixed)

From `docs/optional-subjects-audit-2026-07-28.md`. Read it before touching any of these paths:

* **Exams:** `offline_section_marks` (results-only) ignores eligibility and hard-fails non-atomically; OCR / offline-scan surfaces use raw class rosters and will `42501` mid-loop; results views show unenrolled students as "Not Attempted"; exam creation has zero optional awareness; `exam_published` notifications fan out to unenrolled students. Multi-subject exams defeat the filter **by design** (documented sharp edge).
* **Content:** study materials leak to unenrolled students; the student week view shows regular-slot optionals to the whole section.
* **Coverage:** `teacher_roster_student_ids` had been adopted by exactly one surface at audit time; the 2026-08-26 work widened that considerably, but verify per surface rather than assuming.
* **Hybrid exams have no enrollment guard at all.**

When you fix one of these, update the audit file's status rather than leaving a stale CRITICAL in the tree.

## 6. Scale contract

`20260729120000` was written to CLAUDE.md §23: FK indexes in-migration, RLS through SECURITY DEFINER helpers only, policies wrap `(select auth.uid())`, and multi-step writes are single RPCs. Hold any change here to the same bar (`high-concurrency-patterns` skill).

## 7. A basket period is an ORDINARY period for its teacher (2026-09-10)

"Optional" classifies **which students attend**. It says nothing about the teacher: a teacher who teaches English Core inside the "Optional 2" basket is simply teaching English Core, and gets the ordinary period card, the ordinary lesson plan, and the ordinary status. Never build teacher-facing UI that labels, restricts or disables a basket period.

**`tt_lesson_plans` is keyed `UNIQUE NULLS NOT DISTINCT (slot_id, date, subject_id)`** (migration `20260910160000`). A basket period is ONE `tt_slots` row shared by several subjects, so the old `(slot_id, date)` key meant the second teacher to save silently overwrote the first and took `owner_teacher_id`. For every ordinary slot the subject is fixed by the slot, so the key is unchanged in effect. Consequences you must respect:
* **Read a plan row subject-scoped.** `useLessonPlanForDate(slotId, date, subjectId)`; `(slot_id, date)` alone can match several rows and `maybeSingle()` throws.
* Upserts target `slot_id,date,subject_id`. `record_syllabus_progress` and `tt_record_period_note` were updated to the same key — `record_syllabus_progress`'s mirror is wrapped in `EXCEPTION WHEN OTHERS`, so a stale conflict target there fails **silently**, not loudly.
* Anything counting "my plans" must scope by `owner_teacher_id`, or a shared basket period credits a teacher with a colleague's rows.

### THE RULE: never ask `tt_slots` which teaching periods exist

Twelve functions defined a teaching period as `slot_type IN ('theory','practical') AND subject_id IS NOT NULL`, with the teacher as `tt_slots.teacher_id`. A basket period is `slot_type='free'` with **both** `subject_id` and `teacher_id` NULL, so it failed all three tests and was invisible to the check-out gate, the SY1 flag, coverage, projections, teacher load, the attendance pass and auto-subs. Only one of the twelve knew `optional_group_id` existed.

**Use `public.tt_effective_periods`** — one row per (period, subject, teacher) actually delivered; ordinary slots pass through, basket periods expand through `optional_group_subjects × class_assignments`. It is **not** a client surface (revoked from `anon` and `authenticated`); it is read by SECURITY DEFINER functions only. If a client needs it, add a DEFINER function rather than granting the view.

This is the general lesson, not an optional-subjects quirk: **when you add a nullable discriminator to a hot table, every reader that filters on the columns it replaces silently excludes the new shape.** Sweep those readers in the same change, or the feature ships into the schema and never reaches the product. A deferral recorded only in a spec, and expressed to the user as a silent no-op, is indistinguishable from a bug.

Still not solved: `tt_substitutions` cannot express "cover only the Political Science half of this period" (needs a subject/batch dimension - a feature, not a bug), and `record_syllabus_progress` still authorises by class rather than subject (a §25 tightening that changes who may write).
