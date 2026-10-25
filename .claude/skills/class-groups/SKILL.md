---
name: class-groups
description: Class Groups container model — class_groups above section rows in classes, trigger-backed subject fanout, question-bank class_group_id + section scope semantics, RLS recursion trap. Use when touching classes, class_groups, subject_class_group_mappings, subject_class_mappings, question_bank scope, chapter_topics/topic_class_mappings, grade_levels resolution, or any teacher/class/subject assignment write path.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Class Groups — Container Above Sections

Section rows in `classes` sit under a parent `class_groups` row ("Class 10" contains 10A/10B/10C). The refactor is additive and fully shipped (Phases 1–4).

| Concept | Level | Table |
|---|---|---|
| Parent container | Class-group | `class_groups` + `classes.class_group_id NOT NULL` |
| Subject catalog | Class-group (shared) | `subject_class_group_mappings` + trigger fanout to `subject_class_mappings` |
| Chapters & topics | Class-group (shared) | `syllabus_topics` + `chapter_topics.class_group_id`, `topic_class_mappings.class_group_id` |
| Question bank | Class-group + per-section scope | `question_bank.class_group_id` + `question_bank_section_scope` |
| Teachers / attendance / timetable / lessons / study materials / exams | Section | `class_assignments`, `attendance_*`, `tt_slots`, `tt_lesson_plans`, `study_materials`, `exam_classes` |
| Fees | Deferred | `fee_structures`, `fee_plans` — don't migrate without a follow-up plan |

## Trigger-backed fanout

Writing to `subject_class_group_mappings` is the canonical entry point. AFTER INSERT/UPDATE/DELETE trigger (SECURITY DEFINER) materializes one row per child section into legacy `subject_class_mappings`, preserving the dual-table invariant consumed by `useTeacherAssignedSubjects`, `useClassSubjects`, and RLS JOINs. **Never write directly to `subject_class_mappings` from admin surfaces** — use the group table and let the trigger fan out. Both `src/components/school/AddSubjectPopover.tsx` and `src/components/school/AssignTeacherClassSubjectDialog.tsx` use this shared write path.

## `grade_levels` is global

No `institution_id` column. `useCreateClassGroup` resolves `grade_level_id` from class name via `/\d+/` regex → `SELECT id FROM grade_levels WHERE grade_number = ?`. Don't pass `institution_id` to the lookup — silently returns NULL for numbered grades.

## Question bank scope semantics

Each question carries `class_group_id` + optional `question_bank_section_scope(question_id, class_id)` rows:
* Zero scope rows → **class-wide**: every teacher of the class_group sees it, plus students assigned to the class_group.
* ≥1 scope row → **section-scoped**: only teachers whose `class_assignments.class_id` matches.
* `class_group_id IS NULL` (legacy) → institution-wide fallback.
* Admins/coordinators see full pool; students see class-wide only.

### Scope write path

Direct `question_bank` inserts in `src/components/exam/questions/ManualQuestionForm.tsx` and `src/components/exam/questions/AIGenerateQuestions.tsx`:
1. Include `class_group_id: scope.classGroupId` on every insert.
2. Call `applyQuestionScope(questionIds, scopeClassIds)` from `src/hooks/useQuestionScope.ts`.
3. Empty `scopeClassIds` → no scope rows → class-wide.

The admin Question Bank page (`src/pages/admin/QuestionBankPage.tsx`) is a third entry point: `src/components/admin/AddQuestionToBankDialog.tsx` takes `availableClassGroups={{ id, name, gradeLevelId }[]}` sourced from `useInstitutionClassGroups`. The dropdown surfaces one row per class_group (so "Class 12 Commerce" and "Class 12 Science" don't collapse), writes `class_group_id` via `useAddQuestionToBank`, and resolves `grade_level_id` from the selected group's own `grade_level_id`. Admin inserts here are always class-wide — no scope rows, no picker. **Don't pass class names or class section ids as `gradeId`** — those aren't `grade_levels.id` UUIDs and the insert raises `invalid input syntax for type uuid`.

### Scope-picker UI

`src/components/exam/questions/QuestionScopePicker.tsx` — three radios: **This section only / Multiple sections I teach / Class repository (shared)**. Last choice persists in `localStorage` key `salci:question-scope-mode:{userId}`. Single-section groups collapse to an info alert.

## RLS recursion trap (migration 20260426120000_fix_question_bank_rls_recursion.sql)

The `question_bank` SELECT policy and the `question_bank_section_scope` SELECT/ALL policies reference each other. Inline `EXISTS (SELECT 1 FROM <other table>…)` subqueries in either policy reopen a cycle the planner detects on `INSERT … RETURNING *` (which every `supabase.from("question_bank").insert(...).select()` emits), aborting with `42P17 infinite recursion detected in policy for relation "question_bank"`. The policies MUST keep calling the three SECURITY DEFINER helpers (`question_has_section_scope`, `user_is_in_question_scope`, `get_question_institution_id`) — don't inline the EXISTS back. If you add a new cross-table RLS check between these two tables, wrap it in another SECURITY DEFINER helper first.

## Read-path pattern (preferred → fallback)

`src/hooks/useClassSubjects.ts`, `src/hooks/useChapterTopics.ts`, `src/hooks/useChaptersForExam.ts` resolve `classes.class_group_id`, query the group-level table, fall back to legacy only when empty. Don't reverse.

## Phase 4 cleanup shipped

`chapter_topics.class_id` and `topic_class_mappings.class_id` DROPPED. Six RLS policies on those tables rewritten to join through `classes.class_group_id` — pattern: `EXISTS (SELECT 1 FROM classes c WHERE c.class_group_id = tcm.class_group_id AND is_teacher_for_class(auth.uid(), c.id))`. Legacy `class_id` fallback branches removed from `useChapterTopics`, `useChaptersForExam`, `src/lib/syllabusCoverage.ts`, `upsertTopicInline` in `AIGenerateQuestions.tsx`. Don't reintroduce — the column is gone. `useUpsertChapterTopic` still accepts `classId` and resolves `class_group_id` internally; any new chapter_topics writer should do the same.

## Out of scope

Fees untouched. Section-level edge functions (`compute-aggregates`, `generate-learning-actions`, `generate-predictions`, `mark-biometric-attendance`, `process-ocr-upload`, `promote-students`, `snapshot-student-passport`, `admin-operations`, `send-task-notifications`, `copy-timetable-template`) continue to key off `class_id` — correct and unmodified.