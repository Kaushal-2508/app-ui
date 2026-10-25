# Coordinator + Teacher "Edit Student Details" Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give coordinators (wing-scoped) and teachers (class-scoped) the same Update Details / Update Roll Number / per-student Edit capability admins have, enforced server-side.

**Architecture:** A new SECURITY DEFINER helper `can_edit_student_details` admits teachers (class-scoped) on top of the existing admin+coordinator authority, and the `update_student_details` RPC gate points at it. The bulk-CSV edge function widens its gate to coordinator/teacher and enforces per-student class/wing scope in code (service-role bypasses RLS). The frontend exposes the surface on both the coordinator page (`SchoolStudentsPage`) and teacher page (`TeacherStudentsPage`), and the shared roll picker gains an `allowedClassIds` filter.

**Tech Stack:** Postgres (SECURITY DEFINER functions), Supabase Edge Function (Deno), React 18 + TS, TanStack Query v5, shadcn/ui + SALCI design system.

Design spec: `docs/superpowers/specs/2026-06-29-coordinator-teacher-edit-student-details-design.md`.

## Global Constraints

- **No test runner exists.** Verification per task = `npm run typecheck` (exit 0) + `npx eslint <touched paths>` (0 errors) + (frontend tasks) `npx vite build` (exit 0), plus the manual/SQL checks named in the task. (CLAUDE.md §5a)
- **Lint strict:** `@typescript-eslint/no-explicit-any` + `prefer-const` are hard errors. Never `as any`. (§5a) — note the edge function file already contains pre-existing `catch (err: any)`; match the file's existing style there only if eslint is not run on Deno files (it is not — `supabase/functions` is outside the eslint frontend config; still, do not add NEW `any` in TS frontend files).
- **Errors:** every frontend `onError`/catch toast goes through `toastError` from `src/lib/toast.ts`. (§19)
- **No `select("*")`** — explicit columns only. (§23)
- **Paginate unbounded lists** (`range()`) — PostgREST silently caps at 1000 rows, including inside edge functions. (§23)
- **No `supabase.auth.getUser()` without a JWT** in frontend. (§23)
- **Migrations applied out-of-band** — the ledger is stale. Apply prod SQL via `scripts/run-sql.ps1` (Management API) and verify via `pg_proc`/`information_schema`. Do NOT rely on `supabase db push`. (`reference_migration_ledger_stale`)
- **Edge deploy:** `npx supabase functions deploy admin-operations --project-ref gyymkgohcijeksmrzuyw` after editing the function.
- **Design tokens only** (`surface-card`, `frosted-shadow`, `rounded-card`, `text-ink-*`, brand tokens); `MobileSheet` for sheets; dark-mode + 375px safe. (design-system skill)
- **Branch:** all work on `feat/coordinator-teacher-edit-students` (already created off `main`). Commit after each task. No `Co-Authored-By` trailer (match repo commits).

---

## File Structure

- **NEW** `supabase/migrations/20260629120000_can_edit_student_details.sql` — `can_edit_student_details` helper + re-create `update_student_details` with the new gate.
- **MOD** `supabase/functions/admin-operations/index.ts` — widen `bulk_update_student_profiles` gate + server-side per-student scope + `outOfScope` bucket.
- **MOD** `src/hooks/useBulkUpdateProfiles.ts` — `BulkUpdateResult.results.outOfScope: string[]`.
- **MOD** `src/components/school/BulkUpdateStudentsDialog.tsx` — accumulate + display `outOfScope`.
- **MOD** `src/components/admin/ViewUserSheet.tsx` — `canManageStudent` includes `isTeacher`.
- **MOD** `src/components/school/UpdateRollNumberSheet.tsx` — `allowedClassIds` prop + ClassStep/SectionStep filtering.
- **MOD** `src/pages/school/SchoolStudentsPage.tsx` — expose Update Details to coordinators + pass `allowedClassIds`.
- **MOD** `src/pages/teacher/TeacherStudentsPage.tsx` — add Update Details surface + roll picker, class-scoped.

---

## Task 1: DB — `can_edit_student_details` helper + repoint `update_student_details`

**Files:**
- Create: `supabase/migrations/20260629120000_can_edit_student_details.sql`

**Interfaces:**
- Produces: `public.can_edit_student_details(_actor uuid, _student uuid) returns boolean` (SECURITY DEFINER); `update_student_details` now gates on it.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260629120000_can_edit_student_details.sql
-- Admit TEACHERS (class-scoped) to student-detail editing, on top of the
-- existing admin + wing-coordinator authority — WITHOUT widening the shared
-- can_manage_student_subjects helper (which also backs 4 optional-enrollment
-- RLS policies; widening it there would grant teachers enrollment writes).
--
-- Teacher scope source = class_assignments(role='teacher') via is_teacher_for_class.

CREATE OR REPLACE FUNCTION public.can_edit_student_details(_actor uuid, _student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.can_manage_student_subjects(_actor, _student)   -- admins + wing-coordinators
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

-- Re-point the update_student_details gate at the new helper. Body otherwise
-- identical to migration 20260620120000 (only line changed: the gate).
CREATE OR REPLACE FUNCTION public.update_student_details(
  _student            uuid,
  _full_name          text,
  _roll_number        text,
  _admission_number   text,
  _phone              text,
  _date_of_birth      date,
  _guardian_name      text,
  _guardian_phone     text,
  _guardian_email     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inst          uuid;
  v_conflict_name text;
BEGIN
  IF NOT public.can_edit_student_details(auth.uid(), _student) THEN
    RAISE EXCEPTION 'You do not have permission to edit this student.'
      USING ERRCODE = '42501';
  END IF;

  -- Normalise blanks to NULL so empty inputs clear the field.
  _full_name        := NULLIF(btrim(_full_name), '');
  _roll_number      := NULLIF(btrim(_roll_number), '');
  _admission_number := NULLIF(btrim(_admission_number), '');
  _phone            := NULLIF(btrim(_phone), '');
  _guardian_name    := NULLIF(btrim(_guardian_name), '');
  _guardian_phone   := NULLIF(btrim(_guardian_phone), '');
  _guardian_email   := NULLIF(btrim(_guardian_email), '');

  IF _full_name IS NULL THEN
    RAISE EXCEPTION 'Student name cannot be empty.' USING ERRCODE = '23514';
  END IF;

  SELECT institution_id INTO v_inst FROM public.profiles WHERE id = _student;

  -- Roll number: unique within the student's class(es).
  IF _roll_number IS NOT NULL THEN
    SELECT p.full_name INTO v_conflict_name
    FROM public.profiles p
    JOIN public.class_assignments ca ON ca.user_id = p.id AND ca.role = 'student'
    WHERE p.roll_number = _roll_number
      AND p.id <> _student
      AND ca.class_id IN (
        SELECT class_id FROM public.class_assignments
        WHERE user_id = _student AND role = 'student'
      )
    LIMIT 1;
    IF v_conflict_name IS NOT NULL THEN
      RAISE EXCEPTION 'Roll number % is already assigned to % in this class. Use a different roll number.',
        _roll_number, v_conflict_name USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Admission number: unique within the institution.
  IF _admission_number IS NOT NULL THEN
    SELECT p.full_name INTO v_conflict_name
    FROM public.profiles p
    WHERE p.admission_number = _admission_number
      AND p.id <> _student
      AND p.institution_id IS NOT DISTINCT FROM v_inst
    LIMIT 1;
    IF v_conflict_name IS NOT NULL THEN
      RAISE EXCEPTION 'Admission number % is already used by %. Use a different admission number.',
        _admission_number, v_conflict_name USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name        = _full_name,
      roll_number      = _roll_number,
      admission_number = _admission_number,
      phone            = _phone,
      updated_at       = now()
  WHERE id = _student;

  INSERT INTO public.student_personal_details
    (profile_id, date_of_birth, guardian_name, guardian_phone, guardian_email, updated_by, updated_at)
  VALUES
    (_student, _date_of_birth, _guardian_name, _guardian_phone, _guardian_email, auth.uid(), now())
  ON CONFLICT (profile_id) DO UPDATE SET
    date_of_birth  = EXCLUDED.date_of_birth,
    guardian_name  = EXCLUDED.guardian_name,
    guardian_phone = EXCLUDED.guardian_phone,
    guardian_email = EXCLUDED.guardian_email,
    updated_by     = EXCLUDED.updated_by,
    updated_at     = now();
END;
$$;
```

- [ ] **Step 2: Apply to prod via the Management API helper**

First read `scripts/run-sql.ps1` to confirm its parameter block (file vs inline SQL). Then run (adapt the flag name to the script):
```bash
pwsh scripts/run-sql.ps1 -File supabase/migrations/20260629120000_can_edit_student_details.sql
```
Expected: success, no error body. (If the helper takes inline SQL, pass the file contents.)

- [ ] **Step 3: Verify both functions exist with the new gate**

Run via the same helper:
```sql
SELECT proname FROM pg_proc WHERE proname = 'can_edit_student_details';
SELECT pg_get_functiondef(p.oid) LIKE '%can_edit_student_details(auth.uid()%' AS gate_repointed
FROM pg_proc p WHERE p.proname = 'update_student_details';
```
Expected: `can_edit_student_details` row present; `gate_repointed` = true.

- [ ] **Step 4: Functional spot-check (pick a real teacher + their student + an out-of-class student)**

```sql
-- Replace the UUIDs with a real teacher, a student in their class, and a student NOT in their class.
SELECT public.can_edit_student_details('<teacher_uid>'::uuid, '<their_class_student>'::uuid) AS should_be_true;
SELECT public.can_edit_student_details('<teacher_uid>'::uuid, '<other_class_student>'::uuid) AS should_be_false;
```
Expected: first true, second false. (If you cannot identify ids, query `class_assignments` for one teacher + a student sharing a class_id, and a student in a different class_id.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629120000_can_edit_student_details.sql
git commit -m "feat(students): can_edit_student_details helper admits class-scoped teachers"
```

---

## Task 2: Edge function — scope `bulk_update_student_profiles` to coordinator/teacher classes

**Files:**
- Modify: `supabase/functions/admin-operations/index.ts` (the `bulk_update_student_profiles` case, ~lines 1193-1296)

**Interfaces:**
- Consumes: existing `isSuperAdmin`, `isSchoolAdmin`, `isCoordinator`, `isTeacher`, `userInstitutionId`, `adminClient`, `user` from the surrounding handler.
- Produces: `result.results` now carries `outOfScope: string[]`.

- [ ] **Step 1: Read the handler region to confirm variable names**

Read `supabase/functions/admin-operations/index.ts` lines 198-220 (role/booleans/`userInstitutionId`/`adminClient`) and 1193-1296 (the case). Confirm `isTeacher` and `isCoordinator` are in scope (they are computed at ~211-213).

- [ ] **Step 2: Replace the authorization gate + add scope resolution**

Replace the existing gate block (lines ~1204-1218):
```ts
        // Authorization check - must be school admin or super admin
        if (!isSuperAdmin && !isSchoolAdmin) {
          throw new Error("Only admins can perform bulk updates");
        }
        
        // Non-super-admins can only update users in their institution
        if (!isSuperAdmin && userInstitutionId !== data.institutionId) {
          throw new Error("You can only update students in your own institution");
        }
        
        const results = {
          updated: 0,
          notFound: [] as string[],
          errors: [] as Array<{ email: string; message: string }>,
        };
```
with:
```ts
        // Authorization — admins (institution-wide), or coordinators/teachers
        // (scoped to their own classes, enforced per-student below).
        if (!isSuperAdmin && !isSchoolAdmin && !isCoordinator && !isTeacher) {
          throw new Error("You don't have permission to update students.");
        }

        // Non-super-admins can only operate within their own institution.
        if (!isSuperAdmin && userInstitutionId !== data.institutionId) {
          throw new Error("You can only update students in your own institution");
        }

        // For coordinators/teachers (NOT full admins), resolve the set of
        // student ids inside the classes they own. adminClient bypasses RLS,
        // so this scope MUST be code-enforced. null = admin → no class filter.
        let allowedStudentIds: Set<string> | null = null;
        if (!isSuperAdmin && !isSchoolAdmin) {
          const allowedClassIds = new Set<string>();

          if (isTeacher) {
            const { data: taught, error: taughtErr } = await adminClient
              .from("class_assignments")
              .select("class_id")
              .eq("user_id", user.id)
              .eq("role", "teacher");
            if (taughtErr) throw taughtErr;
            for (const r of taught ?? []) if (r.class_id) allowedClassIds.add(r.class_id);
          }

          if (isCoordinator) {
            const { data: wings, error: wingsErr } = await adminClient
              .from("wing_assignments")
              .select("wing_id")
              .eq("user_id", user.id);
            if (wingsErr) throw wingsErr;
            const wingIds = (wings ?? []).map((w) => w.wing_id).filter(Boolean);
            if (wingIds.length > 0) {
              const { data: maps, error: mapsErr } = await adminClient
                .from("wing_class_mappings")
                .select("class_id")
                .in("wing_id", wingIds);
              if (mapsErr) throw mapsErr;
              for (const r of maps ?? []) if (r.class_id) allowedClassIds.add(r.class_id);
            }
          }

          // Paginated — a large wing can exceed PostgREST's 1000-row cap (§23).
          allowedStudentIds = new Set<string>();
          const classIdList = [...allowedClassIds];
          if (classIdList.length > 0) {
            const PAGE = 1000;
            let from = 0;
            while (true) {
              const { data: rows, error: rowsErr } = await adminClient
                .from("class_assignments")
                .select("user_id")
                .eq("role", "student")
                .in("class_id", classIdList)
                .range(from, from + PAGE - 1);
              if (rowsErr) throw rowsErr;
              for (const r of rows ?? []) if (r.user_id) allowedStudentIds.add(r.user_id);
              if (!rows || rows.length < PAGE) break;
              from += PAGE;
            }
          }
        }

        const results = {
          updated: 0,
          notFound: [] as string[],
          outOfScope: [] as string[],
          errors: [] as Array<{ email: string; message: string }>,
        };
```

- [ ] **Step 3: Add the per-student scope check inside the loop**

In the loop, immediately after the matched-profile guard (after the `if (findError || !profile) { results.notFound.push(...); continue; }` block, ~line 1240), insert:
```ts
            // Coordinator/teacher: skip students outside the caller's classes.
            if (allowedStudentIds !== null && !allowedStudentIds.has(profile.id)) {
              results.outOfScope.push(student.email);
              continue;
            }
```

- [ ] **Step 4: Include outOfScope in the audit log + completion log**

Update the `console.log` completion line (~1276) and the audit `new_values` (~1285-1290):
```ts
        console.log(`Bulk update completed: ${results.updated} updated, ${results.notFound.length} not found, ${results.outOfScope.length} out of scope, ${results.errors.length} errors`);
```
and add `out_of_scope: results.outOfScope.length,` to the `new_values` object.

- [ ] **Step 5: Deploy the edge function**

```bash
npx supabase functions deploy admin-operations --project-ref gyymkgohcijeksmrzuyw
```
Expected: deploy success.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-operations/index.ts
git commit -m "feat(students): scope bulk profile updates to coordinator wing / teacher classes"
```

---

## Task 3: Shared roll picker — `allowedClassIds` filter

**Files:**
- Modify: `src/components/school/UpdateRollNumberSheet.tsx`

**Interfaces:**
- Consumes: `useInstitutionClassGroups` rows (have `section_ids: string[]`, `section_count: number`) and `useClassGroupSections` rows (have `id`).
- Produces: `UpdateRollNumberSheet` accepts a new optional prop `allowedClassIds?: string[] | null` (null/undefined = no filter). `ClassStep` and `SectionStep` accept `allowedClassIds` and filter.

- [ ] **Step 1: Add the prop to the component signature**

In `UpdateRollNumberSheetProps`, add:
```ts
  /** When set, restricts the picker to these section (class) ids — for
   *  coordinators (wing) and teachers (assigned classes). null/undefined = all. */
  allowedClassIds?: string[] | null;
```
Destructure `allowedClassIds` in the component and pass it to `<ClassStep allowedClassIds={allowedClassIds} ... />` and `<SectionStep allowedClassIds={allowedClassIds} ... />` (both render sites in the step switch).

- [ ] **Step 2: Filter in ClassStep**

Change `ClassStepProps` to add `allowedClassIds?: string[] | null;`. Inside `ClassStep`, after the `useInstitutionClassGroups` call and before the empty check, compute the visible list:
```ts
  const allowedSet = allowedClassIds ? new Set(allowedClassIds) : null;
  const visible = allowedSet
    ? (data ?? []).filter((cg) => cg.section_ids.some((id) => allowedSet.has(id)))
    : (data ?? []);
```
Then use `visible` instead of `data` for the empty check and the `.map`. For the section-count caption, show the allowed count when filtered:
```tsx
  // inside the map, replace the section_count line:
  {(() => {
    const count = allowedSet
      ? cg.section_ids.filter((id) => allowedSet.has(id)).length
      : (cg.section_count ?? 0);
    return (
      <p className="mt-2 text-sm text-ink-600">
        {count} section{count === 1 ? "" : "s"}
      </p>
    );
  })()}
```
The loading/error early-returns stay as-is (they reference `isLoading`/`isError`, not `data`).

- [ ] **Step 3: Filter in SectionStep**

Change `SectionStepProps` to add `allowedClassIds?: string[] | null;`. Inside `SectionStep`, after the `useClassGroupSections` call, compute:
```ts
  const allowedSet = allowedClassIds ? new Set(allowedClassIds) : null;
  const visible = allowedSet
    ? (data ?? []).filter((sec) => allowedSet.has(sec.id))
    : (data ?? []);
```
Replace the three `data`-based branches (empty / list) so they test `visible` and `.map(visible)`. (Keep `isLoading`/`isError` branches unchanged.)

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/components/school/UpdateRollNumberSheet.tsx
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/school/UpdateRollNumberSheet.tsx
git commit -m "feat(students): allowedClassIds filter on roll number picker for scoped roles"
```

---

## Task 4: Bulk result plumbing + per-student Edit for teachers

**Files:**
- Modify: `src/hooks/useBulkUpdateProfiles.ts`
- Modify: `src/components/school/BulkUpdateStudentsDialog.tsx`
- Modify: `src/components/admin/ViewUserSheet.tsx`

**Interfaces:**
- Consumes: Task 2's `results.outOfScope: string[]`.
- Produces: dialog shows a 4th "Skipped" tile; `ViewUserSheet`'s Edit button shows for teachers.

- [ ] **Step 1: Add `outOfScope` to the hook result type**

In `src/hooks/useBulkUpdateProfiles.ts`, extend `BulkUpdateResult`:
```ts
interface BulkUpdateResult {
  success: boolean;
  results: {
    updated: number;
    notFound: string[];
    outOfScope: string[];
    errors: Array<{ email: string; message: string }>;
  };
}
```

- [ ] **Step 2: Accumulate `outOfScope` in the dialog**

In `src/components/school/BulkUpdateStudentsDialog.tsx`:
- Change the `results` state type (line ~66) to:
  ```ts
  const [results, setResults] = useState<{ updated: number; notFound: number; outOfScope: number; errors: number } | null>(null);
  ```
- In `handleUpdate`'s batch loop (lines ~239-252), add a `totalOutOfScope` accumulator alongside the others:
  ```ts
  let totalOutOfScope = 0;
  ```
  (declare it next to `totalUpdated`/`totalNotFound`/`totalErrors`), and inside the loop:
  ```ts
        totalOutOfScope += result.results.outOfScope.length;
  ```
- Update the `setResults` call (line ~260):
  ```ts
      setResults({ updated: totalUpdated, notFound: totalNotFound, outOfScope: totalOutOfScope, errors: totalErrors });
  ```

- [ ] **Step 3: Display the Skipped tile**

In the `step === "complete"` block (lines ~463-476), change the grid from `grid-cols-3` to `grid-cols-2 sm:grid-cols-4` and add a 4th tile after the Errors tile:
```tsx
                <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">{results.outOfScope}</p>
                  <p className="text-sm text-muted-foreground">Skipped (not your class)</p>
                </div>
```
(The toast on line ~263-266 can stay; optionally append `${totalOutOfScope} skipped.` to its description.)

- [ ] **Step 4: Show the per-student Edit button to teachers**

In `src/components/admin/ViewUserSheet.tsx`, find `canManageStudent` (~line 43-45) and add `isTeacher`:
```ts
  const canManageStudent = !!(
    roleInfo?.isSuperAdmin || roleInfo?.isSchoolAdmin || roleInfo?.isCoordinator || roleInfo?.isTeacher
  );
```
(`roleInfo.isTeacher` already exists on `useUserRole`.) Server-side `update_student_details` is the backstop for out-of-scope attempts.

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npx eslint src/hooks/useBulkUpdateProfiles.ts src/components/school/BulkUpdateStudentsDialog.tsx src/components/admin/ViewUserSheet.tsx
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBulkUpdateProfiles.ts src/components/school/BulkUpdateStudentsDialog.tsx src/components/admin/ViewUserSheet.tsx
git commit -m "feat(students): surface bulk skipped-count + show per-student Edit to teachers"
```

---

## Task 5: Coordinator page — expose Update Details + scope the picker

**Files:**
- Modify: `src/pages/school/SchoolStudentsPage.tsx`

**Interfaces:**
- Consumes: `isEffectiveCoordinator`, `coordinatorClassIds` (already in the page); the `UpdateRollNumberSheet` `allowedClassIds` prop from Task 3.

- [ ] **Step 1: Read the gate + mount sites**

Read `src/pages/school/SchoolStudentsPage.tsx` lines 473-489 (the `secondaryActions` array), 813-838 (the hidden-trigger dialog mounts), and 952-957 (the `UpdateRollNumberSheet` mount). Confirm `isEffectiveCoordinator` (line ~107) and `coordinatorClassIds` (line ~111) are in scope.

- [ ] **Step 2: Add "Update Details" to the coordinator's kebab**

In the `secondaryActions` array, the "Update Details" item currently lives inside the `(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin ? [ ... ] : [])` cluster together with Promote / Bulk Promote. Pull **only** "Update Details" out into a gate that also includes coordinators. Replace the admin-only cluster (lines ~480-486) with:
```tsx
          ...((roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || isEffectiveCoordinator)
            ? [{ label: "Update Details", icon: <RefreshCw className="h-4 w-4" />, onClick: handleBulkUpdate }]
            : []),
          ...((roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin)
            ? [
                { label: "Promote Students", icon: <GraduationCap className="h-4 w-4" />, onClick: handlePromoteStudents },
                { label: "Bulk Promote (CSV)", icon: <FileSpreadsheet className="h-4 w-4" />, onClick: handleBulkPromote },
              ]
            : []),
```
(Keep the exact icon components / handler names already imported in the file — confirm `RefreshCw`, `GraduationCap`, `FileSpreadsheet`, `handleBulkUpdate`, `handlePromoteStudents`, `handleBulkPromote` match the current source.)

- [ ] **Step 3: Mount `BulkUpdateStudentsDialog` for coordinators too**

The dialog is mounted inside `{(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) && ( ... )}` (lines ~825-838). Widen that condition to include the coordinator:
```tsx
        {(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || isEffectiveCoordinator) && (
          <BulkUpdateStudentsDialog
            institutionId={roleInfo?.institutionId || ""}
            onOpenRollNumberPicker={() => setRollSheetOpen(true)}
            trigger={<button ref={bulkUpdateTriggerRef} type="button" tabIndex={-1} aria-hidden />}
          />
        )}
```
(Match the existing prop set exactly — only the wrapping condition changes.)

- [ ] **Step 4: Pass `allowedClassIds` to the roll picker**

Update the `UpdateRollNumberSheet` mount (lines ~952-957):
```tsx
        <UpdateRollNumberSheet
          open={rollSheetOpen}
          onOpenChange={setRollSheetOpen}
          institutionId={roleInfo?.institutionId ?? null}
          allowedClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
        />
```
(Admins → `undefined` = all classes; coordinators → their wing sections.)

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npx eslint src/pages/school/SchoolStudentsPage.tsx
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/school/SchoolStudentsPage.tsx
git commit -m "feat(students): expose Update Details + scoped roll picker to coordinators"
```

---

## Task 6: Teacher page — add the Update Details surface, class-scoped

**Files:**
- Modify: `src/pages/teacher/TeacherStudentsPage.tsx`

**Interfaces:**
- Consumes: `assignedClassIds` (already computed at line ~88), `roleInfo` (already from `useUserRole`), `BulkUpdateStudentsDialog`, `UpdateRollNumberSheet`, the `allowedClassIds` prop from Task 3.

- [ ] **Step 1: Add imports + refs + state**

At the top of `src/pages/teacher/TeacherStudentsPage.tsx`:
- Add to the lucide import: `RefreshCw`.
- Add imports:
  ```tsx
  import { useRef } from "react";
  import { BulkUpdateStudentsDialog } from "@/components/school/BulkUpdateStudentsDialog";
  import { UpdateRollNumberSheet } from "@/components/school/UpdateRollNumberSheet";
  ```
  (Merge `useRef` into the existing `import { useState } from "react";` → `import { useRef, useState } from "react";`.)
- Inside the component, add state + a trigger ref next to the other `useState`s (~line 48):
  ```tsx
  const [rollSheetOpen, setRollSheetOpen] = useState(false);
  const bulkUpdateTriggerRef = useRef<HTMLButtonElement>(null);
  ```
- Add a handler next to `handleAssignTaskAll` (~line 163):
  ```tsx
  const handleBulkUpdate = () => bulkUpdateTriggerRef.current?.click();
  ```

- [ ] **Step 2: Add "Update Details" to the header secondaryActions**

Update the `secondaryActions` array (lines ~186-192) to:
```tsx
        secondaryActions={[
          {
            label: "Assign Task to All",
            icon: <ListChecks className="h-4 w-4" />,
            onClick: handleAssignTaskAll,
          },
          {
            label: "Update Details",
            icon: <RefreshCw className="h-4 w-4" />,
            onClick: handleBulkUpdate,
          },
        ]}
```

- [ ] **Step 3: Mount the dialog + roll sheet**

Find where `ViewUserSheet` and `BulkAssignTaskDialog` are rendered (search for `<ViewUserSheet` and `<BulkAssignTaskDialog` near the end of the JSX). Next to them, add:
```tsx
      {/* Update Details (bulk CSV) — opens via the hidden trigger ref */}
      <BulkUpdateStudentsDialog
        institutionId={roleInfo?.institutionId || ""}
        onOpenRollNumberPicker={() => setRollSheetOpen(true)}
        trigger={<button ref={bulkUpdateTriggerRef} type="button" tabIndex={-1} aria-hidden />}
      />

      {/* Update Roll Number picker — scoped to the teacher's assigned classes */}
      <UpdateRollNumberSheet
        open={rollSheetOpen}
        onOpenChange={setRollSheetOpen}
        institutionId={roleInfo?.institutionId ?? null}
        allowedClassIds={assignedClassIds}
      />
```
(`roleInfo?.institutionId` — confirm `roleInfo` exposes `institutionId`; it does via `useUserRole`. `assignedClassIds` is the teacher's section ids.)

- [ ] **Step 4: Verify (typecheck + lint + build)**

```bash
npm run typecheck
npx eslint src/pages/teacher/TeacherStudentsPage.tsx
npx vite build
```
Expected: all exit 0. (`vite build` runs once here at the end since this is the last code task.)

- [ ] **Step 5: Browser smoke (full, all three roles)**

Run `npm run dev`.
1. **Teacher** (`/teacher/students`): header now shows "Update Details" → opens dialog → "Update Roll Number" → picker shows only the teacher's assigned class(es)/sections → edit a roll + save (success). View Profile → **Edit** button now present → change a field → save (success). Upload a CSV including one email from another teacher's class → result shows it under "Skipped (not your class)".
2. **Coordinator** (`/coordinator/students`): kebab now shows "Update Details"; roll picker shows only wing classes; CSV with an out-of-wing email → skipped. "Other Students" group: opening View Profile → Edit → Save on an out-of-wing student → clean "You do not have permission to edit this student." toast.
3. **Admin** (`/school/users?tab=students`): unchanged — picker shows all classes, CSV institution-wide, no Skipped rows for in-institution students.
4. Dark mode + 375px on the teacher page surface.

- [ ] **Step 6: Commit**

```bash
git add src/pages/teacher/TeacherStudentsPage.tsx
git commit -m "feat(students): teacher Update Details + class-scoped roll number picker"
```

- [ ] **Step 7: Push the branch**

```bash
git push -u origin feat/coordinator-teacher-edit-students
```

---

## Self-review checklist (run before claiming done)

- [ ] Spec "DB" — Task 1 adds `can_edit_student_details` + repoints the gate; teacher branch uses `is_teacher_for_class`; shared `can_manage_student_subjects` untouched.
- [ ] Spec "Edge function" — Task 2 widens gate to coordinator+teacher, resolves class/wing scope server-side (paginated), skips out-of-scope rows into `outOfScope`.
- [ ] Spec "UpdateRollNumberSheet allowedClassIds" — Task 3 filters ClassStep (`section_ids` intersect) + SectionStep (`id` in set); undefined = all.
- [ ] Spec "ViewUserSheet" — Task 4 adds `isTeacher` to `canManageStudent`.
- [ ] Spec "Coordinator page" — Task 5 unhides Update Details for `isEffectiveCoordinator`, mounts dialog, passes `coordinatorClassIds`.
- [ ] Spec "Teacher page" — Task 6 adds Update Details header + dialog + roll sheet, passes `assignedClassIds`.
- [ ] Spec "outOfScope bucket" — plumbed through hook (Task 4 step 1) + dialog display (Task 4 step 3).
- [ ] Spec "full parity fields" — no per-role field gating added anywhere.
- [ ] Spec "Promote stays admin-only" — Task 5 keeps Promote/Bulk Promote in the admin-only cluster.
- [ ] Spec "production-clean" — typecheck + eslint per task, vite build in Task 6.
- [ ] Spec "ship order" — DB (T1) + edge (T2) before frontend (T3-6); both applied/deployed to prod, not just committed.
- [ ] Type consistency — `allowedClassIds?: string[] | null` identical across UpdateRollNumberSheet/ClassStep/SectionStep; `outOfScope: string[]` in hook matches edge `results.outOfScope`.

If any item is unchecked at the end of execution, fix before merging.
