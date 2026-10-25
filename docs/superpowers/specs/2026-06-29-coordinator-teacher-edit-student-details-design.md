# Coordinator + Teacher "Edit Student Details" Parity

**Date:** 2026-06-29
**Status:** Design approved (scope + field decisions locked), ready for plan
**Surfaces:** `/coordinator/students` (`SchoolStudentsPage`) and `/teacher/students` (`TeacherStudentsPage`)
**Touches:** DB migration + edge function + 3 frontend files (2 pages + 1 shared sheet) + 1 shared component (ViewUserSheet) + 1 hook result type.

## Goal

Give **coordinators** (wing-scoped) and **teachers** (class-scoped) the same "Update Details" student-editing capability that school-admins have: the bulk-CSV **Update Details** dialog, the **Update Roll Number** picker, and the per-student **Edit** form in View Profile. Everything stays scoped to the role's own classes, enforced server-side.

## Decisions (locked)

- **Scope of surfaces:** bulk-CSV Update Details + Update Roll Number picker + per-student View-Profile Edit. (The per-student Edit already works for coordinators; this turns it on for teachers and exposes the bulk surface to both.)
- **Field scope:** **full parity** — coordinators and teachers can edit the same fields admins can (roll number, admission number, phone, name, DOB, guardian name/phone/email). No per-role field gating.
- **Coordinator scope source:** wing (`wing_assignments` × `wing_class_mappings`), via the existing `is_coordinator_for_class` / `can_manage_student_subjects` path — unchanged backend authority, newly exposed in the UI.
- **Teacher scope source:** `class_assignments` rows with `role = 'teacher'`, via the existing `is_teacher_for_class(user, class_id)` helper. Raw class membership (a subject-teacher of a class can edit that class's students), not the narrower optional-subject roster.

## Non-goals

- No change to `can_manage_student_subjects` itself (it backs 4 optional-enrollment RLS policies — widening it would silently grant teachers enrollment-write access). We add a **separate** wrapper helper instead.
- No "Promote Students" / "Bulk Promote (CSV)" for coordinators/teachers — those stay admin-only (separate feature, separate scoping review).
- No field-level role restriction logic (full parity chosen).
- No change to which student **rows** appear on either page (RLS/roster already governs that). This changes which **actions** are exposed.

## Architecture (4 layers)

### 1. DATABASE — one migration

New helper, isolating the teacher grant from the shared `can_manage_student_subjects`:

```sql
CREATE OR REPLACE FUNCTION public.can_edit_student_details(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)   -- admins + wing-coordinators (unchanged)
    OR (
      public.has_role(_actor, 'teacher')
      AND EXISTS (
        SELECT 1 FROM public.profiles stu
        WHERE stu.id = _student
          AND stu.institution_id = public.get_user_institution(_actor)
      )
      AND EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = _student
          AND ca.role = 'student'
          AND public.is_teacher_for_class(_actor, ca.class_id)
      )
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_edit_student_details(uuid, uuid) TO authenticated;
```

Then re-point the `update_student_details` gate:

```sql
-- was: IF NOT public.can_manage_student_subjects(auth.uid(), _student) THEN
IF NOT public.can_edit_student_details(auth.uid(), _student) THEN
  RAISE EXCEPTION 'You do not have permission to edit this student.' USING ERRCODE = '42501';
END IF;
```

The rest of `update_student_details` (normalization, uniqueness checks, the UPDATE, the personal-details upsert) is unchanged. `is_teacher_for_class` and `can_manage_student_subjects` already exist; no new index, no new FK.

**Apply path:** Management API SQL (migration ledger is stale — CLAUDE.md `reference_migration_ledger_stale`). Verify via `pg_proc` that both functions are updated. **No frontend types regen needed** — the frontend never calls `can_edit_student_details` directly; it calls the unchanged `update_student_details` signature.

### 2. EDGE FUNCTION — `bulk_update_student_profiles` (admin-operations)

Widen the gate from admin-only to admin + coordinator + teacher, with **server-side per-student class/wing scope** (the handler uses the service-role client, which bypasses RLS — scope must be code-enforced).

```ts
// gate: was  if (!isSuperAdmin && !isSchoolAdmin) throw "Only admins…"
if (!isSuperAdmin && !isSchoolAdmin && !isCoordinator && !isTeacher) {
  throw new Error("You don't have permission to update students.");
}
// institution-equality check stays for every non-super caller (unchanged).

// Resolve the caller's allowed scope ONCE for non-admin callers.
//   - admins (super/school/super_school): allowedStudentIds = null  → no scope filter (institution-wide)
//   - coordinator: class_ids via wing_assignments × wing_class_mappings
//   - teacher: class_ids via class_assignments(role='teacher')
//   - (a user holding both roles → union of class_ids)
// Then one batched query: class_assignments(role='student').in('class_id', allowedClassIds)
//   → allowedStudentIds: Set<string>.
// In the per-row loop, after matching the profile by email+institution, if
//   allowedStudentIds !== null && !allowedStudentIds.has(profile.id) → push to
//   results.outOfScope and `continue` (skip the update).
```

`isTeacher` is already computed in the handler (currently unused for this action). Result type gains an `outOfScope: string[]` bucket alongside `updated`/`notFound`/`errors`. Admins are unaffected (scope = null). **Deploy** after edit (`npx supabase functions deploy admin-operations`).

### 3. FRONTEND

**Shared — `UpdateRollNumberSheet.tsx`:** new optional prop `allowedClassIds?: string[] | null` (null/undefined = admin, show everything). Thread to:
- `ClassStep`: filter `useInstitutionClassGroups` rows to those whose `section_ids` intersect `allowedClassIds`; show the allowed-section count instead of total.
- `SectionStep`: filter `useClassGroupSections` rows to `allowedClassIds`.

This makes the picker show only the role's own classes instead of every class in the school. (Backend still rejects out-of-scope saves with 42501 — this just prevents surfacing un-editable classes.)

**Shared — `ViewUserSheet.tsx`:** add `isTeacher` to `canManageStudent`:
```ts
const canManageStudent = !!(
  roleInfo?.isSuperAdmin || roleInfo?.isSchoolAdmin || roleInfo?.isCoordinator || roleInfo?.isTeacher
);
```
This shows the per-student **Edit** button to teachers. On `TeacherStudentsPage` the visible roster is already class-scoped, so every visible student is editable; the RPC is the backstop for any out-of-scope attempt.

**Shared — `useBulkUpdateProfiles.ts`:** extend the result type with `outOfScope: string[]`.

**Coordinator — `SchoolStudentsPage.tsx`:**
- Header `secondaryActions`: move "Update Details" out of the `isSchoolAdmin || isSuperAdmin` cluster into a gate that also includes `isEffectiveCoordinator`. ("Promote Students" / "Bulk Promote (CSV)" stay admin-only.)
- Mount `BulkUpdateStudentsDialog` (currently inside the admin-only block) for coordinators too.
- Pass `allowedClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}` to `UpdateRollNumberSheet`.

**Teacher — `TeacherStudentsPage.tsx`:**
- Add "Update Details" to `secondaryActions` (today it's only "Assign Task to All").
- Import + mount `BulkUpdateStudentsDialog` (hidden trigger pattern, like SchoolStudentsPage) and `UpdateRollNumberSheet`, wired so the dialog's `onOpenRollNumberPicker` opens the sheet.
- Pass `allowedClassIds={assignedClassIds}` to `UpdateRollNumberSheet` and `institutionId` from the teacher's role info.

### 4. INTEGRATION

- Audit: `update_student_details` already writes the `student_details_updated` activity row (via `useUpdateStudentDetails` for the per-student path) and the RPC stamps `updated_by = auth.uid()`. The bulk edge function already writes a `system_audit_logs` row keyed to the caller. The roll-picker save path (`UpdateRollNumberSheet`) already fires `logActivityEvent` per student (added in the prior feature). No new audit wiring needed; the actor will now correctly be the coordinator/teacher.
- `toastError` for all new error toasts; the 42501 message ("You do not have permission to edit this student.") is already user-friendly and passes `isLikelyUserFriendly`.

## Bulk-CSV scope flow (the security-critical path)

```
coordinator/teacher uploads CSV (emails + roll/admission/phone)
  → invokeAdminOperation("bulk_update_student_profiles", { institutionId, students })
    → edge fn: gate allows coordinator/teacher
    → institution-equality check (caller's institution == institutionId)
    → resolve allowedClassIds (wing for coordinator / assigned for teacher)
    → batched: allowedStudentIds = students(role) in those classes
    → per row: match by email+institution; if not in allowedStudentIds → outOfScope (skip)
    → update only in-scope rows; return { updated, notFound, outOfScope, errors }
```

A coordinator/teacher therefore **cannot** edit a student outside their classes even by crafting a CSV — the server filters by their resolved scope, not by anything the client sends.

## Error / edge cases

- **Coordinator opens View Profile on an "Other Students" (out-of-wing) student and clicks Edit → Save:** the RPC returns 42501; `toastError` shows "You do not have permission to edit this student." No data leak. (Pre-existing behavior for coordinators; unchanged.)
- **Teacher with zero assigned classes:** `assignedClassIds` empty → roll picker shows "No classes", bulk CSV finds every row out-of-scope. No crash.
- **Roll picker `allowedClassIds` empty array vs undefined:** `undefined`/`null` = admin (show all); `[]` = scoped-but-nothing (show none). Keep that distinction explicit.
- **Dual teacher+coordinator user:** edge function unions both class sets; the page uses its existing `effectiveRole` to decide which `allowedClassIds` to pass to the picker (coordinator wing when viewing as coordinator, assigned classes when viewing as teacher).
- **Out-of-scope bulk rows:** surfaced in the dialog result as a distinct "skipped (not in your classes)" count, never silently dropped.

## Production-readiness (CLAUDE.md §5a/§23)

- `npm run typecheck` + `npx eslint <touched>` + `npx vite build` all exit 0.
- No `as any`; no `select("*")`; explicit columns in the new edge queries.
- New edge queries bounded (`.in('class_id', allowedClassIds)` — class sets are bounded; if a coordinator wing exceeds 1000 sections this would need pagination, but wings are small — acceptable, note it).
- `staleTime: 60_000` already on the picker hooks; no new unbounded `useQuery`.
- RPC change touches a SECURITY DEFINER function; the new helper references the existing SECURITY DEFINER helpers (no inline cross-table EXISTS recursion risk — `update_student_details` is not RLS).

## Testing (manual smoke — no test runner)

1. **DB:** after applying, `SELECT public.can_edit_student_details('<teacher_uid>','<their_student>')` → true; `…('<teacher_uid>','<other_class_student>')` → false; admin/coordinator paths unchanged.
2. **Coordinator** (`/coordinator/students`): kebab now shows "Update Details" → opens dialog → "Update Roll Number" → picker lists only wing classes → edit + save works for wing students; CSV update only touches wing students (out-of-wing rows reported skipped).
3. **Teacher** (`/teacher/students`): header now shows "Update Details" → dialog + roll picker scoped to assigned classes; View Profile → Edit button now present, edits save; a CSV row for a non-class student is reported skipped.
4. **Admin** (`/school/users?tab=students`): unchanged — still institution-wide, no regression.
5. **Negative:** teacher edits a student id outside their class via crafted RPC call → 42501.

## Rollout

- DB migration + edge deploy must ship **before/with** the frontend (frontend exposes actions that depend on both). Order: migration → edge deploy → frontend merge.
- No feature flag (additive, role-gated).
