# Syllabus — Subject Edit + Delete, with activity logging

- **Date:** 2026-06-08
- **Status:** Approved design (pending implementation plan)
- **Surface:** `/school/syllabus` (`SchoolSyllabusPage`) — Tree view + Panel view
- **Roles affected:** `school_admin`, `super_school_admin`, `super_admin`, `coordinator` (NOT `teacher`, NOT `student`)

## 1. Goal

The syllabus page lets users add subjects, chapters, and study materials, and delete
chapters/materials — but there is **no way to edit or delete a subject**. Add:

1. An **Edit** affordance on every school-owned subject (rename + category).
2. A **Delete** affordance on every subject.
3. An **audit trail**: every delete of a subject, chapter, or study material is recorded
   to the acting user's activity feed.

Restricted to **admins and coordinators**. Teachers never see subject edit/delete
(their existing chapter/material delete rights are unchanged).

## 2. Background & hard constraints (discovered)

- **Two kinds of subject row in `universal_subjects`:**
  - **Global** — `institution_id IS NULL`. Shared across every school on the platform
    (e.g. "English Core"). Cannot be renamed or hard-deleted without affecting other
    schools.
  - **Institute / school-owned** — `institution_id = <this school>`. Created via
    `AddSchoolSubjectDialog` / `useAddInstituteSubject`, mapped 1:1 to a `class_group`.
- **Subject ↔ class is mapped at the class-group level** (`subject_class_group_mappings`,
  "scgm") and fanned out by an `AFTER INSERT/UPDATE/DELETE` trigger
  (`fanout_subject_class_group_mapping`, migration `20260423120000`) to the legacy
  per-section `subject_class_mappings` ("scm"). The syllabus tree reads from **scm**.
  Per CLAUDE.md §22, the canonical write path is the **group** table; the trigger keeps
  scm in sync. Deleting an scgm row → trigger deletes the matching scm rows.
- **FK cascade when a `universal_subjects` row is hard-deleted** (verified against
  migrations):
  - **Deleted (CASCADE):** `syllabus_topics` (chapters), `subject_class_group_mappings`
    (→ trigger clears `subject_class_mappings`), `exam_subjects`, `chapter_topics`,
    `grade_subject_assignments`.
  - **Preserved (SET NULL):** `question_bank`, `study_materials`, `class_assignments`,
    `exam_templates`, `lesson_plans`, `timetable_slots`, `tt_slots`, `tt_lesson_plans`,
    `student_remarks`, `passport_subject_capabilities`.
  - **RESTRICT (blocks the delete):** `homework_assignments.subject_id` — if the subject
    is referenced by any homework, the delete fails with Postgres `23503`. Must be caught
    and translated.
- **RLS (current, verified):**
  - `universal_subjects` UPDATE: `school_admin`, `super_school_admin` (mig `20260223113730`)
    and `coordinator` (mig `20260421120000`), all institution-scoped. ✅ Edit needs no change.
  - `universal_subjects` DELETE: `super_admin` (any) + `school_admin`/`super_school_admin`
    (institution-scoped, mig `20260223113730`). **No coordinator DELETE policy is reliably
    present** → a coordinator hard-delete is **blocked**. ⚠️ Needs a migration (see §6).
  - `subject_class_group_mappings` DELETE: `super_admin`; `school_admin`/`super_school_admin`
    (institution); `coordinator` (wing-scoped via `is_coordinator_for_class`). ✅
  - `subject_class_mappings` DELETE: admins (institution) + `coordinator` (wing-scoped,
    mig `20260421120000`). ✅
- **Activity feed is federated.** `ViewUserSheet` (`src/components/admin/ViewUserSheet.tsx`)
  Activity tab merges ~9 source tables, including `system_audit_logs` filtered by
  `actor_id`. A `SECURITY DEFINER` RPC `log_audit_event(_action, _entity_type, _entity_id,
  _entity_name, _old_values, _new_values, _metadata)` stamps `actor_id = auth.uid()` and
  inserts into `system_audit_logs`, bypassing the super-admin-only INSERT RLS. It is
  callable by any authenticated user (no restrictive GRANT). `system_audit_logs` SELECT
  RLS lets school admins read rows where `metadata->>'institution_id'` matches their
  institution (or `actor_id = self`). **Therefore: log deletes via this RPC with
  `metadata = { institution_id }` and they appear in the user's Activity tab with no
  changes to the feed component.** This is the documented exception to "federate, don't
  log_audit_event" — a deleted row has nothing left to federate.
- **Landmine — do NOT reuse:** `useRemoveSubjectFromGrade` and `useDeleteSubject`
  (`useSyllabusHierarchy.ts`) and `useDeleteInstituteSubject` (`useInstituteSyllabus.ts`)
  all hard-`DELETE FROM universal_subjects` (or soft-delete the wrong legacy `subjects`
  table) keyed on the old grade model. Running them against a **Global** subject would
  delete it for **every school**. They are currently unused for subject deletion and must
  stay that way. New code uses the mutations defined in §5.

## 3. Permission & behavior matrix

| Subject type | Actor | Edit (name + category) | Delete behavior |
|---|---|---|---|
| **Institute** (school-owned) | `school_admin` / `super_school_admin` / `super_admin` | ✅ | 🔴 **Permanent hard-delete** (warning) |
| **Institute** | `coordinator` | ✅ | 🔴 **Permanent hard-delete** (warning) |
| **Global** | admin **or** coordinator | ❌ (hidden) | 🟠 **Remove from class** (unassign, reversible) |
| any | `teacher` / `student` | ❌ | ❌ (no buttons) |

The delete **kind** is resolved by subject type only:
`resolveDeleteKind(subject) = subject.institution_id == null ? "remove" : "hard"`.
Button **visibility** gate: `canManageSubjects = isAdmin || isCoordinator` (effective role).
Edit button is additionally hidden when `subject.institution_id == null` (Global).

## 4. Operations

### A. Permanent hard-delete (institute subject)
`DELETE FROM universal_subjects WHERE id = :subjectId`, then **delete-then-verify**
(re-select by id; "row gone" = success — same pattern as `useDeleteTopic`). DB cascades +
the scgm trigger handle chapters and mappings.
- On `23503` (homework RESTRICT): translate to a friendly message — *"This subject is used
  in homework assignments. Remove those first, then delete the subject."* — via `toastError`.
- If the row survives the delete (RLS denied): *"You don't have permission to delete this
  subject."*

### B. Remove from class (global subject)
The `universal_subjects` row is **never** touched.
1. Resolve `class_group_id` from the section's `class_id`
   (`resolveClassGroupIdFromClassId` in `@/lib/subjectCode`).
2. `DELETE FROM subject_class_group_mappings WHERE class_group_id = :g AND subject_id = :s`
   (trigger clears the matching scm rows).
3. Cleanup residual legacy section mappings (covers globals mapped only at section level):
   delete `subject_class_mappings WHERE subject_id = :s AND class_id IN (sections of :g)`.
- Coordinators are wing-scoped automatically by RLS (only their sections clear; other
  sections of the group are untouched — correct for wing scope).
- The subject disappears from the class's syllabus and can be re-added later via
  "Manage Subjects" / "Add Subject".

### C. Edit (institute subject)
`EditSubjectDialog` — mirrors `AddSchoolSubjectDialog`, pre-filled, controlled
`open`/`onOpenChange`. Updates **`name` + `category`** only:
`UPDATE universal_subjects SET name = :name, category = :category WHERE id = :id`.
- The auto-generated `code` is **left unchanged** on rename (avoids the per-class-group
  unique-code constraint and stale exam-paper codes).
- Duplicate-name preflight within the same class group (mirror the check in
  `useAddInstituteSubject`) before writing, surfaced via `toastError`.
- UPDATE RLS already covers admins + coordinators — no policy change.

## 5. Frontend changes

### New: `src/lib/activityLog.ts`
```ts
logActivityEvent({ action, entityType, entityId, entityName, oldValues?, metadata? })
```
Calls `supabase.rpc("log_audit_event", { _action, _entity_type, _entity_id, _entity_name,
_old_values, _metadata })`. Best-effort: wrapped in try/catch, a logging failure is
`console.warn`-ed and **never** rethrown (must not fail the delete it follows). Always
include `metadata.institution_id` so school admins can read it in `ViewUserSheet`.

### New: `src/hooks/useManageSchoolSubject.ts`
- `useDeleteSchoolSubject()` — hard-delete (§4.A) + delete-then-verify + `23503` handling +
  `logActivityEvent("subject_deleted", "Subject", id, name, …)`.
- `useRemoveSubjectFromClass()` — unassign (§4.B) +
  `logActivityEvent("subject_removed_from_class", "Subject", id, name, …)`.
- `useUpdateSchoolSubject()` — edit (§4.C) + optional
  `logActivityEvent("subject_updated", "Subject", id, name, …)`.
All invalidate via `invalidateSyllabusCache(queryClient)` + the `class-group-subjects` /
`class-subjects` keys (mirror `useAddInstituteSubject` onSuccess).

### New: `src/components/syllabus/EditSubjectDialog.tsx`
Structure cloned from `AddSchoolSubjectDialog` (shadcn `Dialog`). **Deviation note:**
CLAUDE.md §20b rule 11 prefers `MobileSheet` for new dialogs; we deliberately mirror the
existing `AddSchoolSubjectDialog` (a `Dialog`) so edit looks identical to add. Called out
explicitly per the §20b "call out deviations" rule.

### Modify: `src/components/syllabus/SyllabusTreeView.tsx`
Add `onEditSubject?(subjectId, subjectName, institutionId, gradeId, gradeName)` and
`onDeleteSubject?(subjectId, subjectName, institutionId, gradeId, gradeName)` props. Render
hover-revealed Edit (pencil) + Delete (trash) buttons in the subject header row (beside the
existing "＋"), matching the existing chapter-row affordance styling. Edit button hidden when
`subject.institution_id == null`. (`SyllabusTreeSubject` already carries `institution_id`.)

### Modify: `src/components/syllabus/SubjectCard.tsx`
Add `onEdit?()` prop + pencil button (the `onDelete` trash button already exists, currently
unwired). Edit hidden for Global (`isGlobal`).

### Modify: `src/pages/school/SchoolSyllabusPage.tsx`
- New flags: `canManageSubjects = isAdmin || isCoordinator` (effective role). `isAdmin` =
  `school_admin | super_school_admin | super_admin`.
- Wire `onEditSubject` / `onDeleteSubject` (tree) and `onEdit` / `onDelete` (panel
  `SubjectCard`, currently passed nothing).
- `handleDeleteSubject(subject, gradeId, gradeName)` → resolves kind → opens a confirm
  dialog (extend the existing `deleteConfirm` union with a `"subject"` case carrying
  `kind: "hard" | "remove"`, name, ids). Confirm copy differs:
  - **hard:** "Permanently delete **{name}**? This deletes the subject and all its chapters
    for **{class}**. Study materials and question-bank questions are kept but lose the
    subject tag. This can't be undone."
  - **remove:** "Remove **{name}** from **{class}**? It's a shared subject, so it stays
    available to other schools and can be added back later."
- `handleEditSubject(subject, …)` → opens `EditSubjectDialog`.
- **Audit logging on existing deletes:** add `logActivityEvent(…)` to the success paths of
  the page's inline `useDeleteTopic` (`"chapter_deleted"`), inline `useDeleteMaterial`
  (`"material_deleted"`), and the global-chapter `hideGlobalTopic` path
  (`"chapter_hidden"`), so chapter + material deletes are audited too (req. #3).

## 6. Database change (one migration)

`supabase/migrations/<ts>_coordinator_delete_subjects.sql` — idempotent:
```sql
DROP POLICY IF EXISTS "Coordinators can delete institution subjects" ON public.universal_subjects;
CREATE POLICY "Coordinators can delete institution subjects"
  ON public.universal_subjects FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );
```
Mirrors the coordinator UPDATE policy from `20260421120000` and completes that migration's
stated intent. Institution-scoped (consistent with the coordinator INSERT/UPDATE policies).
No other RLS change is required (edit, remove-from-class, and `log_audit_event` are already
permitted). **Before adding:** verify the policy doesn't already exist on the live DB
(`pg_policies`); the `DROP … IF EXISTS` makes re-running safe regardless.

## 7. Out of scope / non-goals

- No change to teacher/coordinator **chapter** or **material** delete permissions (only
  audit logging is added to those paths).
- Tree-view **bulk** chapter delete (`onBulkDeleteTopics`) is not wired by the page today;
  not touched.
- No edit of Global subjects (would require an institution-level override — deferred, YAGNI).
- No edit of subject **code** (stays auto-generated).
- Fees and the legacy `subjects` table are untouched.

## 8. Verification (must pass before "done")

- `npx tsc --noEmit` → exit 0; `npx eslint <touched paths>` → no new errors;
  `npx vite build` → exit 0 (CLAUDE.md §5a).
- Manual, at 375px width and dark mode (CLAUDE.md §20b #25–27):
  - Admin: edit + hard-delete an institute subject; remove a global subject; confirm both
    vanish from tree **and** panel; confirm an institute subject used in homework shows the
    friendly `23503` message instead of a raw error.
  - Coordinator: same on a wing class; confirm wing-scope holds and hard-delete now works.
  - Teacher: no subject edit/delete buttons anywhere.
  - Open the acting user in `ViewUserSheet` → Activity tab shows `subject_deleted` /
    `subject_removed_from_class` / `chapter_deleted` / `material_deleted` events.
```
```

## 9. Files

| File | Change |
|---|---|
| `src/lib/activityLog.ts` | **new** — `logActivityEvent` helper |
| `src/hooks/useManageSchoolSubject.ts` | **new** — delete / remove / update mutations |
| `src/components/syllabus/EditSubjectDialog.tsx` | **new** — edit dialog |
| `supabase/migrations/<ts>_coordinator_delete_subjects.sql` | **new** — coordinator DELETE policy |
| `src/components/syllabus/SyllabusTreeView.tsx` | edit/delete subject affordances |
| `src/components/syllabus/SubjectCard.tsx` | `onEdit` button |
| `src/pages/school/SchoolSyllabusPage.tsx` | wiring, confirm dialog, audit logging |
