# Optional Groups ("Optional 1 / Optional 2") — Design

**Date:** 2026-07-29 · **Requested by:** Tushar (voice + screenshots)
**Context:** follows the optional-subjects loophole audit (docs/optional-subjects-audit-2026-07-28.md). User asked to build the group workflow FIRST, before the audit fixes.

## 1. Concept

An **Optional Group** is a named basket of subjects (e.g. "Optional 1") attached to a **class group**. All subjects in a group run **in parallel in the same timetable period**; each student picks **at most one subject per group**. This is the classic CBSE elective-block model and supersedes the half-wired P5/P6 "batches + band" system for scheduling.

## 2. Core design decision (load-bearing)

**Student choices write into the existing `student_optional_enrollments` table** (soft `is_active` toggle, upsert on `(student_id, subject_id)`), and group subjects are auto-marked `is_optional = true` on `subject_class_group_mappings` (existing fanout trigger mirrors to sections). Consequences — all for free, zero new filtering code:

- P3 exam visibility (`student_eligible_exams.subject_visible`, attempt-start trigger), P3 homework feed filter, P4 marking rosters, `teacher_roster_student_ids` — all keep working unchanged.
- Teachers of optional subjects get rights the NORMAL way (`class_assignments` per class+subject via the existing teacher-assignment flow) — the audit's "batch teacher has zero rights" hole does not apply to this model.
- The Main/Optional classification pill (display-only) keeps working on the same rows.

## 3. Data model (migration `20260729120000_optional_groups.sql`)

```
optional_groups            id, institution_id FK, class_group_id FK, name, position,
                           created_by, timestamps, UNIQUE(class_group_id, name)
optional_group_subjects    id, group_id FK CASCADE, subject_id FK (universal_subjects),
                           UNIQUE(group_id, subject_id)
tt_slots                   + optional_group_id uuid NULL FK optional_groups ON DELETE SET NULL
```

All FKs indexed in-migration. Invariants enforced in RPCs:
- a subject added to a group MUST be mapped to that class_group (`subject_class_group_mappings` row exists);
- a subject may be in at most ONE group per class_group (else the student would be asked twice);
- adding a subject to a group sets `is_optional = true` on the group mapping (fanout trigger propagates). Removing does NOT flip it back (subject stays a standalone optional; admin can flip via EditSubjectDialog).

"Optional 1" is a NAME, lazily instantiated per class group: the manager UI lists distinct names; a (name, class_group) row is created on first subject assignment.

## 4. RPCs (all SECURITY DEFINER, search_path=public, auth-checked internally)

| RPC | Caller | Purpose |
|---|---|---|
| `upsert_optional_group(_class_group_id, _name)` | admin UI | lazy-create/return group row; gate `can_manage_optional_groups` |
| `set_optional_group_subject(_group_id, _subject_id, _member)` | admin UI | add/remove subject with the §3 invariants + is_optional auto-mark |
| `delete_optional_group(_group_id)` | admin UI | drop group (memberships cascade; tt_slots SET NULL → cell degrades to Free) |
| `get_student_optional_group_assignment(_student)` | Subjects tab | groups for the student's class group(s) + subjects + current choice + classification; gate `can_view_student_subjects` |
| `set_student_optional_group_choices(_student, _choices jsonb)` | Subjects tab | ONE transaction: per `{group_id, subject_id|null}` deactivate other group subjects, upsert chosen active; gate `can_manage_student_subjects` |
| `my_optional_slot_choices(_class_id, _academic_year)` | student week | auth.uid()-derived (NO caller-supplied student id): per group-slot the caller's chosen subject + its class teacher |
| `my_teacher_optional_week(_academic_year)` | teacher week | group slots where auth.uid() teaches a group subject in that class (via class_assignments), pre-joined period/class/subject |

New helper `can_manage_optional_groups(_actor, _institution)` = super_admin OR same-institution (school_admin | super_school_admin | coordinator | `is_syllabus_manager`). RLS: `optional_groups`/`optional_group_subjects` SELECT for institution members (subject offerings aren't sensitive; students need the join in week views), writes through the helper; all policies use `(select auth.uid())`.

**Drive-by security fix (from audit S-1):** `student_band_resolution` and `band_slot_batches` are recreated with auth guards (self-or-manager / institution check). Their only live consumer passes the caller's own id, so behavior is unchanged for legitimate use.

## 5. Surfaces

### 5a. Syllabus page — "Optional Groups" manager
4th item in the existing Add New menu (gated like Add Subject). `MobileSheet`, two levels:
1. List of distinct group names + "New optional" (name input, default "Optional N+1").
2. Inside a name: class-group Select → checklist of that class group's subjects. Checked = in this group; subjects in ANOTHER group of the same class group render disabled with a note. Toggling calls `set_optional_group_subject` (lazy `upsert_optional_group` first). Delete-name button per class group row.

### 5b. Student profile → Subjects tab (redesign)
- Compulsory card unchanged.
- **Optional choices card**: one row per group of the student's class group — group name + subject `Select` (with "None"). Local draft state + **Save** button → single `set_student_optional_group_choices` call → invalidate subject/exam/homework/week caches ("screen refreshes"). Classification Main/Optional pill stays next to a saved chosen subject.
- **Other optional subjects** (ungrouped): existing toggle list, minus grouped subjects.

### 5c. Timetable slot drawer
- Slot type Select gains one entry PER group of this class's class group (labelled with the group name), listed after Theory/Practical/Sports/Other. Selecting one hides subject/teacher pickers and shows a read-only list of the group's subjects with their assigned teachers (from `class_assignments`; amber warning per subject with no teacher).
- Save writes `slot_type='free'` + `optional_group_id` (same CHECK-satisfying convention the band used), `subject_id/teacher_id = NULL`.
- The old "Optional band" toggle + batch checklist are REMOVED (superseded). A legacy `is_optional_band` cell shows a notice to re-save as a group slot.

### 5d. Rendering
- Admin grid + print: group slots render the **group name** with a distinct orange tint (no more "Free" cells).
- Student week: group slot resolves to the student's chosen subject + teacher via `my_optional_slot_choices`; fallback label "«Group» · not selected". Legacy band resolution branch kept.
- Teacher week: `useTeacherWeekV2` merges `my_teacher_optional_week` rows (flagged `isOptionalGroup`, no lesson-plan affordance for now — one `tt_lesson_plans` row per slot cannot host N parallel subjects). `useTeacherTimetableStatusV2` counts group slots so optional-only teachers aren't stuck on the false "awaiting coordinator" screen.
- AY rollover: `copy-timetable-template` carries `optional_group_id` (groups are class_group-scoped, not AY-scoped, so links stay valid across years).

## 6. Out of scope (documented follow-ups)
Lesson plans / syllabus-progress / coverage for group slots (needs per-subject plan rows); substitutions for group slots; auto-absence for optional-only teachers; bulk enrollment; ~~per-class enrollment matrix~~ (shipped 2026-09-07 as the per-section "Update Optional Subjects" sheet, `UpdateOptionalSubjectSheet.tsx`, on the same RPC); the remaining audit Phase A fixes (hybrid guard, offline-marks filters, results filter). The legacy `optional_batches`/`optional_band_slots` tables stay in place (unused by new writes) — dropping them is a later cleanup.

## 7. Error handling & concurrency
All mutations via single RPCs (multi-step writes are one transaction); `toastError` on every onError; explicit staleTime on every new useQuery; no `select("*")`; batched teacher-name lookups (no N+1); FK indexes in-migration; RLS via SECURITY DEFINER helpers with `(select auth.uid())`.
