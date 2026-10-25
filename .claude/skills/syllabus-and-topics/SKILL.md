---
name: syllabus-and-topics
description: Syllabus + chapter/topic hierarchy invariants — `selectedGrade` in SchoolSyllabusPage is actually a class_id not a grade_level_id, and grade_level_id must be resolved via name regex before any `useAddTopic` call from school-side dialogs. Use when touching syllabus pages, AddSchoolTopicDialog, AddTopicToSubjectDialog, `syllabus_topics`, `chapter_topics`, or `topic_class_mappings`.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Syllabus — `classes` vs `grade_levels` FK resolution invariant

[SchoolSyllabusPage.tsx](../../src/pages/school/SchoolSyllabusPage.tsx) names its primary list `selectedGrade` / `GradeLevel`, but `useInstitutionClassesWithCounts` populates it from the **`classes`** table. So `selectedGrade.id` is a `class_id`, NOT a `grade_levels.id`. `syllabus_topics.grade_level_id` FKs to `grade_levels(id)` — passing the class_id raises `syllabus_topics_grade_level_id_fkey`.

## Resolution pattern (mandatory before any `useAddTopic` call from school-side dialogs)

1. Fetch the class name by id.
2. Extract the grade number via `/\d+/` regex.
3. `SELECT id FROM grade_levels WHERE grade_number = ?`.

Reference implementations:
* [AddSchoolTopicDialog.tsx:146-168](../../src/components/syllabus/AddSchoolTopicDialog.tsx)
* [AddTopicToSubjectDialog.tsx](../../src/components/syllabus/AddTopicToSubjectDialog.tsx) `handleTopicSubmit`

## Do NOT move the resolution into `useAddTopic`

The hook is also consumed by admin dialogs (`AddSubjectDialog`, `AddGradeDialog`) that already pass real `grade_level_id` values. Resolving inside the hook would double-resolve and break those flows. Keep resolution at the dialog layer, scoped to school-side entry points.

## `grade_levels` is global

`grade_levels` has no `institution_id` column (migration 20260104144332_…). Don't pass `institution_id` when looking up grade levels — the filter returns empty and the mapping silently degrades to NULL (valid for LKG/UKG/Nursery, bug for numbered grades).

## Renaming `selectedGrade` → `selectedClass`

Desirable cleanup but deferred — it cascades through multiple components. If you touch the page, resist the urge to rename without coordinating the full call graph.

## Chapter-topic hierarchy cross-reference

For chapter/topic/question-bank semantics (`syllabus_topics` = chapters, `chapter_topics` = fine-grained topics within chapters, dual-column `topic_id` + `chapter_topic_id` on `question_bank`, parent/child case-study rows), see the `salci-module-notes` skill §6.

For class-group-level semantics (`chapter_topics` now carries `class_group_id`, `topic_class_mappings` rewritten to join through `classes.class_group_id`, legacy `class_id` fallback branches removed in Phase 4), see the `class-groups` skill (full text of former CLAUDE.md §22).

## Subject Edit / Delete (merged 2026-06-08, commit 6cb0912)

Admins + coordinators (NEVER teachers — `canManageSubjects = isAdmin || effectiveRole === "coordinator"` in SchoolSyllabusPage) can rename, recategorize, hard-delete, or unassign subjects from the syllabus page (panel + tree views).

* **Routing by `institution_id` (CRITICAL):** `handleDeleteSubject` computes `kind = institutionId == null ? "remove" : "hard"`. Global subjects (`institution_id IS NULL`, shared across every school) are NEVER hard-deleted or renamed — they get `useRemoveSubjectFromClass` (deletes the `subject_class_group_mappings` row; the trigger fans the delete out to legacy `subject_class_mappings`; residual legacy rows are cleaned across all sections of the group). Institute subjects get `useDeleteSchoolSubject` (permanent DELETE on `universal_subjects`). Edit buttons render only when `institution_id != null`; the AlertDialog copy differs by kind ("Delete Subject?" vs "Remove Subject from Class?").
* **Hooks:** `src/hooks/useManageSchoolSubject.ts` — `useDeleteSchoolSubject`, `useRemoveSubjectFromClass`, `useUpdateSchoolSubject` (rename + category; the `code` column is intentionally left unchanged; duplicate-name preflight scans active subjects mapped to the same class_group). Dialog: `src/components/syllabus/EditSubjectDialog.tsx` (re-seeds local state on open — the instance is reused).
* **Delete-then-verify:** a PostgREST DELETE silently blocked by RLS looks identical to a permitted one (empty data, no error — RETURNING is gated by the SELECT policy chain). Both `useDeleteSchoolSubject` and `useDeleteTopic` re-SELECT the row by id after DELETE and treat "row gone" as the only success signal; if the row survives they throw role-appropriate messages. Never trust a bare DELETE response under RLS.
* **`homework.subject_id` is ON DELETE RESTRICT** — hard-deleting a subject used in homework raises 23503; `useDeleteSchoolSubject` pre-translates it ("This subject is used in homework assignments…"). Don't relax the FK. Other subject FKs: `chapter_topics` + `subject_class_group_mappings` CASCADE; question_bank/study_materials/exam_templates SET NULL (rows survive untagged — the dialog copy promises this).
* **Audit logging — `logActivityEvent` (`src/lib/activityLog.ts`):** best-effort wrapper over the SECURITY DEFINER `log_audit_event` RPC (stamps `actor_id = auth.uid()`). Two contracts: (1) it must NEVER throw — a logging failure must not fail the delete; (2) `metadata` MUST include `institution_id` (as a string) because the school-admin SELECT policy on `system_audit_logs` matches `metadata->>'institution_id'`. This is the delete-exception to the federated activity feed rule — deleted rows can't be federated, so destructive actions write an audit row explicitly. Actions used: `subject_deleted`, `subject_removed_from_class`, `subject_updated`, `chapter_deleted`, `chapter_hidden`, `material_deleted`. Don't migrate non-destructive actions to log_audit_event.
* **Cache busting:** `bustSubjectCaches` calls `invalidateSyllabusCache(queryClient)` (the versioned `-v3` keys from `src/lib/queryKeys.ts`) PLUS `["class-group-subjects"]`, `["class-subjects"]`, `["subject-class-mappings"]` — the last three feed exam creation and teacher assignment. Any new subject-mutating hook must reuse it.
* **Migration `20260608120000_coordinator_delete_subjects.sql`:** grants coordinators DELETE on institution subjects (idempotent; completes the UPDATE-only policy from 20260421120000). Globals never match (institution-scoped USING clause).
