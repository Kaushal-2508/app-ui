# Class & Section Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `super_admin`, `super_school_admin`, `school_admin`, and `coordinator` rename a class group (e.g., "Class 10" → "Senior 10") and any individual section label (e.g., "A" → "Morning Batch") from the school-side classes page, with the new name reflected everywhere the class or section is shown.

**Architecture:** A SECURITY DEFINER `AFTER UPDATE OF name` trigger on `class_groups` mirrors renames into the denormalized `classes.name` column for every child section in the same transaction. Two new dialogs (`RenameSectionDialog`, `RenameClassDialog`) are added to the existing dropdown on each class card in `SchoolClassesPage`, gated by a `canRename` role flag. Existing hooks (`useUpdateClass`, `useUpdateClassGroup`) and their query-cache invalidations are reused as-is.

**Tech Stack:** PostgreSQL (trigger, plpgsql, RLS), React 18 + TypeScript, shadcn/ui (`Dialog`, `AlertDialog`, `Input`, `Label`, `Button`), TanStack Query v5, Supabase JS client, Sonner toasts via `toastError` per CLAUDE.md §19.

**Spec:** [docs/superpowers/specs/2026-04-28-class-and-section-rename-design.md](../specs/2026-04-28-class-and-section-rename-design.md).

---

## File Map

**Created:**
- `supabase/migrations/20260506100000_class_group_rename_cascade.sql` — trigger function, trigger, one-time backfill, optional RLS tightening.
- `src/components/school/RenameSectionDialog.tsx` — dialog for renaming a single section's label.
- `src/components/school/RenameClassDialog.tsx` — alert-dialog (destructive confirm) for renaming a parent class group.

**Modified:**
- `src/pages/school/SchoolClassesPage.tsx` — adds the `canRename` flag, two new dropdown items, and mounts both dialogs.

**Untouched (intentional):**
- `src/components/school/EditClassDialog.tsx` — legacy, unused; do not delete.
- `src/components/admin/institution/InstitutionClassesTab.tsx` — already has rename UI; the new DB trigger automatically fixes its cascade gap with no UI change.
- `src/hooks/useClasses.ts`, `src/hooks/useClassGroups.ts` — reused as-is.

---

## Task 1: Inspect current RLS on `class_groups` and `classes`

**Files:**
- Read-only — no edits in this task.

- [ ] **Step 1: Open Supabase SQL editor or psql against the linked DB and run:**

```sql
SELECT tablename, policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename IN ('class_groups', 'classes')
 ORDER BY tablename, policyname;
```

- [ ] **Step 2: For each `cmd = 'UPDATE'` row, decide:**

- If the policy already restricts to `super_admin`/`super_school_admin`/`school_admin`/`coordinator` of the same `institution_id`, mark "leave alone."
- If it's wider (e.g., any institution staff, or no role check), mark "narrow in migration."
- Record the policy name(s) you intend to replace. The migration in Task 2 only includes RLS DDL for policies you marked "narrow."

- [ ] **Step 3: Note the helper function names available:**

```sql
SELECT routine_name FROM information_schema.routines
 WHERE routine_name IN ('has_role', 'get_user_institution_id', 'is_teacher_for_class')
   AND routine_schema = 'public';
```

Record which helpers exist. The migration will use `has_role(auth.uid(), 'role')` and `get_user_institution_id(auth.uid())` (referenced in CLAUDE.md §22).

- [ ] **Step 4: Commit nothing — this task is pure investigation. Write the findings into a short scratch note and proceed to Task 2.**

---

## Task 2: Create the migration — cascade trigger + backfill (+ optional RLS narrow)

**Files:**
- Create: `supabase/migrations/20260506100000_class_group_rename_cascade.sql`

- [ ] **Step 1: Write the migration**

If Task 1 concluded "leave RLS alone," omit the final `DROP POLICY` / `CREATE POLICY` block. Otherwise replace `<existing_policy_name>` with the policy name(s) you recorded in Task 1, Step 2.

```sql
-- Class group rename cascade
-- Mirrors class_groups.name into every child classes.name in the same transaction
-- so denormalized read paths (useClasses, exam joins, dashboards, formatClassName)
-- stay in sync after a rename.

BEGIN;

-- 1. Trigger function
CREATE OR REPLACE FUNCTION public.sync_classes_name_from_class_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.classes
       SET name = NEW.name,
           updated_at = NOW()
     WHERE class_group_id = NEW.id
       AND name <> NEW.name;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Trigger
DROP TRIGGER IF EXISTS trg_sync_classes_name ON public.class_groups;
CREATE TRIGGER trg_sync_classes_name
AFTER UPDATE OF name ON public.class_groups
FOR EACH ROW
EXECUTE FUNCTION public.sync_classes_name_from_class_group();

-- 3. One-time backfill: heal drift from prior renames that didn't cascade.
UPDATE public.classes c
   SET name = g.name,
       updated_at = NOW()
  FROM public.class_groups g
 WHERE c.class_group_id = g.id
   AND c.name <> g.name;

-- 4. (Optional) Narrow UPDATE RLS to the four admin-tier roles.
-- ONLY include this block if Task 1 found a wider existing policy.
-- Replace <existing_policy_name> with the name from pg_policies.
--
-- DROP POLICY IF EXISTS <existing_policy_name> ON public.class_groups;
-- CREATE POLICY <existing_policy_name> ON public.class_groups
--   FOR UPDATE
--   TO authenticated
--   USING (
--     institution_id = get_user_institution_id(auth.uid())
--     AND (
--       has_role(auth.uid(), 'super_admin') OR
--       has_role(auth.uid(), 'super_school_admin') OR
--       has_role(auth.uid(), 'school_admin') OR
--       has_role(auth.uid(), 'coordinator')
--     )
--   )
--   WITH CHECK (institution_id = get_user_institution_id(auth.uid()));
--
-- (Repeat for public.classes if its UPDATE policy was also wider.)

COMMIT;
```

- [ ] **Step 2: Apply the migration locally**

Run from the repo root:

```bash
npx supabase db push --linked
```

Expected: one new migration applied, no errors.

If the project uses local-only Supabase, instead run:

```bash
npx supabase migration up
```

- [ ] **Step 3: Verify the trigger exists and the backfill ran**

```sql
-- Trigger present
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_sync_classes_name';
-- Expected: 1 row.

-- No drift remains
SELECT COUNT(*)
  FROM public.classes c
  JOIN public.class_groups g ON g.id = c.class_group_id
 WHERE c.name <> g.name;
-- Expected: 0.
```

- [ ] **Step 4: Test the trigger end-to-end**

Pick a sandbox `class_groups` row and rename it. Replace `<group_id>` with a real UUID:

```sql
-- Capture before
SELECT id, name FROM public.classes WHERE class_group_id = '<group_id>';

-- Rename
UPDATE public.class_groups SET name = 'Test Rename ' || NOW()::text WHERE id = '<group_id>';

-- Verify cascade
SELECT id, name FROM public.classes WHERE class_group_id = '<group_id>';
-- Expected: every row's name matches the new class_groups.name.

-- Restore (use the original name you saw in the first SELECT)
UPDATE public.class_groups SET name = '<original_name>' WHERE id = '<group_id>';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260506100000_class_group_rename_cascade.sql
git commit -m "feat(db): cascade class_groups.name rename to classes.name

AFTER UPDATE trigger keeps the denormalized classes.name column in sync
with class_groups.name in the same transaction. Includes a one-time
backfill to heal any drift from prior super-admin renames."
```

---

## Task 3: Create `RenameSectionDialog`

**Files:**
- Create: `src/components/school/RenameSectionDialog.tsx`

- [ ] **Step 1: Create the file with the full component**

```tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateClass, type ClassData } from "@/hooks/useClasses";
import { useClassGroupSections } from "@/hooks/useClassGroups";

interface RenameSectionDialogProps {
  classData: ClassData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RenameSectionDialog({
  classData,
  open,
  onOpenChange,
}: RenameSectionDialogProps) {
  const [value, setValue] = useState("");
  const updateClass = useUpdateClass();

  // Sibling sections in the same class group, used for collision check.
  const { data: siblings } = useClassGroupSections(classData?.class_group_id ?? null);

  useEffect(() => {
    if (open && classData) {
      setValue(classData.section ?? "");
    }
  }, [open, classData]);

  const trimmed = value.trim();

  const validationError = useMemo(() => {
    if (!classData) return null;
    if (!trimmed) return "Name can't be blank.";
    const lower = trimmed.toLowerCase();
    const collides = (siblings ?? []).some(
      (s) =>
        s.id !== classData.id &&
        (s.section ?? "").trim().toLowerCase() === lower,
    );
    if (collides) {
      return `A section called "${trimmed}" already exists in ${classData.name}. Pick a different name.`;
    }
    return null;
  }, [classData, siblings, trimmed]);

  const handleSubmit = async () => {
    if (!classData || validationError) return;
    await updateClass.mutateAsync({
      id: classData.id,
      name: classData.name,
      section: trimmed,
      academic_year: classData.academic_year,
      is_active: classData.is_active ?? true,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename section</DialogTitle>
          <DialogDescription>
            {classData
              ? `Renaming section in ${classData.name}. The new name shows everywhere this section appears.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="section-name">Section name</Label>
          <Input
            id="section-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="A, Morning Batch, Aurora…"
            autoFocus
          />
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!!validationError || updateClass.isPending}
          >
            {updateClass.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check the new file**

```bash
npx tsc --noEmit
```

Expected: exit code 0. If errors, fix in this file only — do not touch sibling files.

- [ ] **Step 3: Lint the new file**

```bash
npx eslint src/components/school/RenameSectionDialog.tsx
```

Expected: zero errors. No `any`, no `eslint-disable`. If the `useClassGroupSections` return type doesn't match the field access, define a small inline type at the top of the file rather than casting.

- [ ] **Step 4: Commit**

```bash
git add src/components/school/RenameSectionDialog.tsx
git commit -m "feat(school): add RenameSectionDialog

Dialog for renaming a single section's label. Free-text input,
sibling-collision check, errors routed through useUpdateClass +
toastError."
```

---

## Task 4: Create `RenameClassDialog`

**Files:**
- Create: `src/components/school/RenameClassDialog.tsx`

- [ ] **Step 1: Create the file with the full component**

```tsx
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useInstitutionClassGroups,
  useClassGroupSections,
  useUpdateClassGroup,
} from "@/hooks/useClassGroups";
import { type ClassData } from "@/hooks/useClasses";

interface RenameClassDialogProps {
  classData: ClassData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RenameClassDialog({
  classData,
  open,
  onOpenChange,
}: RenameClassDialogProps) {
  const [value, setValue] = useState("");
  const updateGroup = useUpdateClassGroup();

  const { data: allGroups } = useInstitutionClassGroups(
    classData?.institution_id ?? null,
  );
  const { data: siblings } = useClassGroupSections(
    classData?.class_group_id ?? null,
  );

  useEffect(() => {
    if (open && classData) {
      setValue(classData.name);
    }
  }, [open, classData]);

  const trimmed = value.trim();

  const validationError = useMemo(() => {
    if (!classData) return null;
    if (!trimmed) return "Name can't be blank.";
    if (trimmed === classData.name) return null; // unchanged is fine
    const lower = trimmed.toLowerCase();
    const collides = (allGroups ?? []).some(
      (g) =>
        g.id !== classData.class_group_id &&
        g.academic_year === classData.academic_year &&
        g.name.trim().toLowerCase() === lower,
    );
    if (collides) {
      return `Another class is already named "${trimmed}" for ${classData.academic_year}. Pick a different name.`;
    }
    return null;
  }, [classData, allGroups, trimmed]);

  const sectionLabels = useMemo(() => {
    return (siblings ?? [])
      .map((s) => s.section?.trim())
      .filter((s): s is string => !!s);
  }, [siblings]);

  const handleConfirm = async () => {
    if (!classData?.class_group_id || validationError) return;
    if (trimmed === classData.name) {
      onOpenChange(false);
      return;
    }
    await updateGroup.mutateAsync({
      id: classData.class_group_id,
      name: trimmed,
    });
    onOpenChange(false);
  };

  const sectionCount = sectionLabels.length;
  const sectionList = sectionLabels.join(", ");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rename class</AlertDialogTitle>
          <AlertDialogDescription>
            {classData ? (
              <>
                This will rename <strong>{classData.name}</strong> across{" "}
                {sectionCount === 0
                  ? "all its sections"
                  : `${sectionCount} section${sectionCount === 1 ? "" : "s"} (${sectionList})`}
                . The new name shows everywhere — students, teachers, exams,
                syllabus, dashboards.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="class-name">Class name</Label>
          <Input
            id="class-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Class 10, Senior Secondary 10…"
            autoFocus
          />
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!!validationError || updateGroup.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {updateGroup.isPending ? "Renaming…" : "Rename class"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Lint**

```bash
npx eslint src/components/school/RenameClassDialog.tsx
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/school/RenameClassDialog.tsx
git commit -m "feat(school): add RenameClassDialog

AlertDialog with destructive confirm for renaming the parent
class_group. Lists affected sections in the body, blocks duplicate
names within the same academic year, delegates the section-name
cascade to the DB trigger."
```

---

## Task 5: Wire dropdown items into `SchoolClassesPage`

**Files:**
- Modify: `src/pages/school/SchoolClassesPage.tsx`

- [ ] **Step 1: Add the new imports**

At the top of the file, alongside the existing imports:

```tsx
import RenameSectionDialog from "@/components/school/RenameSectionDialog";
import RenameClassDialog from "@/components/school/RenameClassDialog";
```

- [ ] **Step 2: Add two state hooks alongside `assigningTeachers`**

Inside the `SchoolClassesPage` function, near the existing `useState` calls (around line 36):

```tsx
const [renamingSection, setRenamingSection] = useState<ClassData | null>(null);
const [renamingClass, setRenamingClass] = useState<ClassData | null>(null);
```

- [ ] **Step 3: Add the `canRename` derived flag**

After `isEffectiveAdmin` (around line 47):

```tsx
const canRename =
  effectiveRole === "super_admin" ||
  effectiveRole === "super_school_admin" ||
  effectiveRole === "school_admin" ||
  effectiveRole === "coordinator";
```

- [ ] **Step 4: Add the two new dropdown items**

Replace the existing `DropdownMenuContent` block (currently lines ~152–164):

```tsx
<DropdownMenuContent align="end">
  <DropdownMenuItem onClick={() => navigate(`${isEffectiveCoordinator ? '/coordinator/students' : '/school/students'}?class=${cls.id}`)}>
    View Students
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => setAssigningTeachers(cls)}>
    Assign Teachers
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => navigate(`/exams?class=${cls.id}`)}>
    View Exams
  </DropdownMenuItem>
  {canRename && cls.class_group_id && (
    <>
      <DropdownMenuItem onClick={() => setRenamingSection(cls)}>
        Rename section
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => setRenamingClass(cls)}>
        Rename class
      </DropdownMenuItem>
    </>
  )}
</DropdownMenuContent>
```

- [ ] **Step 5: Mount the two new dialogs near the existing `AssignTeachersDialog`**

At the bottom of the returned JSX, after the existing `AssignTeachersDialog` (around line 209):

```tsx
<RenameSectionDialog
  classData={renamingSection}
  open={!!renamingSection}
  onOpenChange={(open) => !open && setRenamingSection(null)}
/>
<RenameClassDialog
  classData={renamingClass}
  open={!!renamingClass}
  onOpenChange={(open) => !open && setRenamingClass(null)}
/>
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 7: Lint**

```bash
npx eslint src/pages/school/SchoolClassesPage.tsx
```

Expected: zero errors. The empty `{/* Edit Class feature removed per requirements */}` comment can be removed as drive-by cleanup since the feature is now wired in.

- [ ] **Step 8: Production build**

```bash
npx vite build
```

Expected: exit code 0. Bundle-size warnings are acceptable; non-zero exit is a block.

- [ ] **Step 9: Commit**

```bash
git add src/pages/school/SchoolClassesPage.tsx
git commit -m "feat(school): expose rename actions on class cards

Adds 'Rename section' and 'Rename class' to the per-card dropdown,
gated to super_admin / super_school_admin / school_admin /
coordinator. Sections without a class_group_id (legacy) hide the
items defensively."
```

---

## Task 6: Manual UI verification

**Files:**
- No edits in this task — verification only.

Run the app (`npm run dev` or your usual local command) and walk through each scenario in this order. Note that the app must be served from a context where you can sign in with multiple test accounts.

- [ ] **Step 1: Section rename happy path**

Sign in as `super_school_admin` or `school_admin`. Open `/school/classes`. Pick a card (e.g. Class 10 - A). Dropdown → "Rename section" → type "Morning Batch" → Save.

Expected:
- Dialog closes, success toast "Class updated" or similar.
- Card label updates to `Class 10 - Morning Batch`.
- Reload the page — name still updated.
- Open `/school/students?class=<id>` and confirm the section reads "Morning Batch" in any class label.
- Open the Exams page filtered by this class and confirm the same.

- [ ] **Step 2: Class rename happy path**

From the same account, pick any card whose class_group has multiple sections (e.g., Class 10 with A, B, C). Dropdown → "Rename class" → AlertDialog opens listing all affected sections → type "Senior 10" → confirm.

Expected:
- All cards in that group re-render as `Senior 10 - A`, `Senior 10 - B`, `Senior 10 - C`.
- Open Syllabus, Question Bank, Exams, Teacher dashboard, Student dashboard — every surface shows "Senior 10".

- [ ] **Step 3: DB cascade verification**

In SQL editor, after Step 2:

```sql
SELECT name FROM public.classes WHERE class_group_id = '<group_id>';
```

Expected: every row reads "Senior 10".

- [ ] **Step 4: Section duplicate validation**

Card "Senior 10 - B" → "Rename section" → type "A" (which "Senior 10 - A" already uses) → save button disabled, inline error: `A section called "A" already exists in Senior 10. Pick a different name.`

- [ ] **Step 5: Class duplicate validation**

Pick "Senior 10" card → "Rename class" → type the name of another class in the same academic year (e.g., "Class 9") → save button disabled, inline error: `Another class is already named "Class 9" for <year>. Pick a different name.`

- [ ] **Step 6: Blank input**

Either dialog → clear the input → submit blocked, inline error: `Name can't be blank.`

- [ ] **Step 7: Permission gating — teacher**

Sign out, sign in as a `teacher` who has access to the same classes. Open `/school/classes` (route is shared). Open the dropdown on any card.

Expected: dropdown shows only the original three items. No "Rename section" or "Rename class".

- [ ] **Step 8: Permission gating — student**

Sign out, sign in as a `student`. The page itself should not be reachable (existing behavior — verify routing still blocks them).

- [ ] **Step 9: Permission gating — employee**

Sign in as an `employee`. Open the page.

Expected: same as teacher — no rename items.

- [ ] **Step 10: Coordinator scope**

Sign in as a `coordinator` whose `useCoordinatorClasses` returns a subset.

Expected: only their wing's cards show. On those cards, both rename items are visible. (Coordinators that have no assigned classes see the existing access banner; they can't rename anything because no card renders.)

- [ ] **Step 11: Error toast (RLS denial path)**

To force an RLS denial without code changes, temporarily revoke UPDATE on `classes` for a test role via SQL, sign in as that role, attempt a rename. Expected: a toast reading something like "You don't have permission…" — never raw Postgres text. Restore RLS afterward.

- [ ] **Step 12: Commit any drive-by fixes from manual testing**

If any of the above surfaced a bug specific to this rename flow, fix it and commit:

```bash
git add <file>
git commit -m "fix(school): <what was wrong>"
```

If everything passed, no commit in this task.

---

## Self-Review Pass

Quick check before handoff:

- **Spec coverage.**
  - DB trigger + backfill: Task 2.
  - RLS narrowing decision: Task 1 → Task 2.
  - Free-form section input: Task 3.
  - Free-form class-name input + AlertDialog confirm: Task 4.
  - canRename gating + dropdown items + dialog mounts: Task 5.
  - Inline duplicate / blank validation: Tasks 3, 4.
  - `toastError` routing: inherited from existing hooks (`useUpdateClass`, `useUpdateClassGroup`) — no extra task needed.
  - Manual UI verification of every scenario in the spec's testing section: Task 6.
  - Zero-error contract (§5a): `tsc --noEmit`, `eslint`, `vite build` are run in Tasks 3, 4, 5.

- **No placeholders.** All SQL, all TSX, all bash commands are concrete. The one branch ("optional RLS narrow") is explicitly conditioned on Task 1's findings, with the SQL block fully written and just commented out.

- **Type / name consistency.** `ClassData` (from `useClasses`), `useUpdateClass` payload shape, `useUpdateClassGroup` payload shape, `useInstitutionClassGroups` and `useClassGroupSections` field names all verified against the existing hooks. The two new dialogs use `classData.class_group_id` (nullable) consistently and guard on it.

- **Migration filename.** `20260506100000` is one day after the latest existing migration (`20260505100000_task_evidence_storage_bucket.sql`).

---

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-04-28-class-and-section-rename.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
