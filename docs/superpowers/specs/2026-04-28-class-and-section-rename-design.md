# Class & Section Rename — Design

**Date:** 2026-04-28
**Status:** Spec — pending implementation plan

## Summary

Allow `super_admin`, `super_school_admin`, `school_admin`, and `coordinator` to rename a class group (the parent — e.g. "Class 10") and any individual section label (e.g. "A" → "Morning Batch") from the school-side classes page. Renames must persist in the database and surface everywhere that class or section is shown — exam pages, syllabus, students list, teacher and student dashboards.

Teachers, students, and `employee` accounts MUST NOT see the rename affordance.

## Background

The seven SALCI roles are `super_admin`, `super_school_admin`, `school_admin`, `coordinator`, `teacher`, `student`, `employee`. Class identity lives in two tables (see CLAUDE.md §22):

- `class_groups` — parent container, one row per class (e.g. "Class 10"). Authoritative `name` column.
- `classes` — child sections under a group (10-A, 10-B, 10-C). Has both `name` (denormalized copy of the parent's name) and `section` (label like "A").

Rename support today:

- **Super admin only** can rename via [InstitutionClassesTab.tsx](../../../src/components/admin/institution/InstitutionClassesTab.tsx), surfaced inside the super-admin "View Institution" sheet.
- The hooks [useUpdateClassGroup](../../../src/hooks/useClassGroups.ts) and [useUpdateClass](../../../src/hooks/useClasses.ts) already exist and route errors through `toastError` per §19.
- [SchoolClassesPage.tsx](../../../src/pages/school/SchoolClassesPage.tsx) (the surface used by `super_school_admin`, `school_admin`, `coordinator`) has the comment `{/* Edit Class feature removed per requirements */}` and exposes no rename action at all.

Two latent gaps even on the super-admin surface:

1. **No cascade.** `useUpdateClassGroup` updates `class_groups.name` only; `classes.name` (denormalized) keeps the old value. Most read paths (`useClasses`, exam joins, dashboards, `formatClassName(cls.name, cls.section)`) consume `classes.name`, so a rename today only "sticks" inside the admin tab and looks stale everywhere else.
2. **Section labels** are constrained to dropdown A–F in the legacy [EditClassDialog.tsx](../../../src/components/school/EditClassDialog.tsx) (unused). The admin tab already accepts free text.

This spec closes both gaps and surfaces the rename actions on the school-side page.

## Goals

- Four roles (`super_admin`, `super_school_admin`, `school_admin`, `coordinator`) can rename either a class or a section from the school-side classes page.
- Section labels accept free-form text (no A–F dropdown).
- A class rename re-renders the new name on every section row in the same group, automatically, in one transaction.
- The rename is reflected everywhere a class or section is read: exams, syllabus, question bank, students, teacher and student dashboards. No additional work in those modules.
- Errors visible to the user are translated through `toastError`/`translateError` per CLAUDE.md §19 — never raw Postgres.

## Non-Goals

- No audit log of who renamed what (no existing infra; not required).
- No email or notification to teachers/students on rename.
- No bulk rename UI.
- No rename of `academic_year` from this flow.
- No refactor to drop the denormalized `classes.name` column. Too many call sites; out of scope.
- No new tables, no new columns.

## Roles & Permissions

Allowed to rename: `super_admin`, `super_school_admin`, `school_admin`, `coordinator`.
Not allowed: `teacher`, `student`, `employee`.

`coordinator` is wing-scoped via the existing `useCoordinatorClasses` filter — coordinators only see (and so only rename) classes assigned to their wing. No additional wing-level RLS work is in scope.

## UX

### Placement

The two new actions are added to the existing `DropdownMenu` on each class card in [SchoolClassesPage.tsx](../../../src/pages/school/SchoolClassesPage.tsx) (`...` button, currently shows "View Students", "Assign Teachers", "View Exams"). The new items render only when a derived `canRename` flag is true.

Two new dropdown items, in order:

1. **Rename section** — opens `RenameSectionDialog` for this card only.
2. **Rename class** — opens `RenameClassDialog` for the parent group.

### `RenameSectionDialog`

- shadcn `Dialog` with one text input pre-filled with `classData.section ?? ""`.
- Free-form input. Trim on save. Empty string saves as `null` (preserves "no section" semantics).
- Inline validation:
  - Empty/whitespace → "Name can't be blank."
  - Collides with another section in the same `class_group_id` (case-insensitive) → "A section called '{name}' already exists in {class}. Pick a different name." Save button disabled while error is shown.
- Submit calls `useUpdateClass` with the existing payload shape; only `section` changes.
- Errors → `toastError(e, { fallback: "Couldn't rename the section. Please try again.", context: "renameSection" })`.

### `RenameClassDialog`

- shadcn `AlertDialog` (destructive variant) — renaming touches all sibling sections, so the user must confirm.
- Body lists the affected sections: "This will rename Class 10 → New Name across 3 sections (A, B, C)."
- One text input pre-filled with `classData.name`.
- Inline validation:
  - Empty/whitespace → "Name can't be blank."
  - Collides with another `class_groups.name` in the same `(institution_id, academic_year)` (case-insensitive) → "Another class is already named '{name}' for {year}. Pick a different name." Save disabled.
- Submit calls `useUpdateClassGroup({ id: classData.class_group_id, name })`. The DB trigger handles the section-name cascade.
- Errors → `toastError(e, { fallback: "Couldn't rename the class. Please try again.", context: "renameClass" })`.

### Visibility flag

```ts
const canRename =
  effectiveRole === "super_admin" ||
  effectiveRole === "super_school_admin" ||
  effectiveRole === "school_admin" ||
  effectiveRole === "coordinator";
```

Defined inline at the top of `SchoolClassesPage`. The two new dropdown items render only when `canRename === true`.

## Database

Single new migration: `supabase/migrations/<timestamp>_class_group_rename_cascade.sql`.

### Cascade trigger

`AFTER UPDATE OF name ON class_groups` runs a SECURITY DEFINER function that mirrors the new name into every child `classes` row in the same transaction:

```sql
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

DROP TRIGGER IF EXISTS trg_sync_classes_name ON public.class_groups;
CREATE TRIGGER trg_sync_classes_name
AFTER UPDATE OF name ON public.class_groups
FOR EACH ROW
EXECUTE FUNCTION public.sync_classes_name_from_class_group();
```

`SECURITY DEFINER` is used because the trigger writes to `classes` on behalf of the user updating `class_groups`; the user's RLS may permit `class_groups` UPDATE but not `classes` UPDATE in some future tightening. Pinning `search_path` to `public` is required for SECURITY DEFINER.

### One-time backfill

Fixes existing drift from prior super-admin renames that didn't cascade:

```sql
UPDATE public.classes c
   SET name = g.name,
       updated_at = NOW()
  FROM public.class_groups g
 WHERE c.class_group_id = g.id
   AND c.name <> g.name;
```

### RLS

Read current UPDATE policies on `class_groups` and `classes`. If they already restrict to the four admin-tier roles within the same `institution_id`, leave alone. If they're wider, narrow to:

```sql
USING (
  institution_id = get_user_institution_id(auth.uid())
  AND (
    has_role(auth.uid(), 'super_admin') OR
    has_role(auth.uid(), 'super_school_admin') OR
    has_role(auth.uid(), 'school_admin') OR
    has_role(auth.uid(), 'coordinator')
  )
)
WITH CHECK (institution_id = get_user_institution_id(auth.uid()))
```

This preserves any existing tighter scoping; we never widen.

### Why a trigger, not a hook-side bulk update

A hook-side cascade leaks responsibility to every caller. The existing super-admin rename has been silently dropping `classes.name` since the class-groups parent shipped. A trigger is single-source-of-truth and survives any future caller (Supabase Studio, scripts, future edge functions, this new dialog).

## Frontend

### Files added

- `src/components/school/RenameSectionDialog.tsx`
- `src/components/school/RenameClassDialog.tsx`

### Files modified

- `src/pages/school/SchoolClassesPage.tsx` — adds `canRename` flag, two new dropdown items, mounts both dialogs.

### Files NOT modified

- `src/components/school/EditClassDialog.tsx` — legacy, untouched.
- `src/components/admin/institution/InstitutionClassesTab.tsx` — already supports rename; the new DB trigger automatically fixes its cascade gap with no UI change.
- `src/hooks/useClassGroups.ts`, `src/hooks/useClasses.ts` — reused as-is. `useUpdateClassGroup` already invalidates `class-groups`, `institution-classes`, and `classes` query keys.

### Read paths

No changes. Every existing read path (`formatClassName(cls.name, cls.section)`, exam joins, syllabus selectors, dashboard tiles, etc.) consumes `classes.name`, which the trigger now keeps in sync with `class_groups.name`. After invalidation, all UI re-renders with the new name.

## Error Messages

Per CLAUDE.md §19:

- **Inline (validation, before submit):**
  - "Name can't be blank."
  - "A section called '{name}' already exists in {class}. Pick a different name."
  - "Another class is already named '{name}' for {year}. Pick a different name."
- **Toast (network/DB failure, via `toastError`):**
  - Section rename fallback: "Couldn't rename the section. Please try again."
  - Class rename fallback: "Couldn't rename the class. Please try again."

`toastError` already maps Postgres codes (`23505` → "This already exists"; `42501`/RLS → "You don't have permission…") so users will not see raw Postgres unless we accidentally bypass it.

The `context` value (e.g. `"renameSection"`) is internal-only — it goes to console/observability, never to the user.

## Testing

### Manual UI

1. **Section rename happy path.** Rename 10-A's section to "Morning Batch", reload, then check Students, Exams, Syllabus, Teacher dashboard, Student dashboard — all show "Class 10 - Morning Batch".
2. **Class rename happy path.** Rename "Class 10" → "Senior 10" from the 10-A card. Confirm AlertDialog. All three cards (A/B/C) re-render. Verify in same downstream surfaces as test 1.
3. **DB cascade.** `SELECT name FROM classes WHERE class_group_id = '<id>'` returns the new name on every row.
4. **Backfill.** Before applying migration, manually create drift (`UPDATE class_groups SET name='X'` on a test row). After migration, drift is gone.
5. **Section duplicate validation.** Rename 10-B to "A" while 10-A exists → inline error, save disabled.
6. **Class duplicate validation.** Rename "Class 10" → "Class 9" while "Class 9" exists in the same academic year → inline error, save disabled.
7. **Blank input.** Submit empty/whitespace → inline "Name can't be blank."
8. **Permission gating.** As `teacher` → dropdown items absent. As `student` → page unreachable. As `employee` → dropdown items absent.
9. **Coordinator scope.** Coordinator only sees (and renames) classes inside their wing — same as today's filter.
10. **Error toast.** Force an RLS denial → toast reads "You don't have permission…", no Postgres leakage.

### Zero-error contract (CLAUDE.md §5a)

- `npx tsc --noEmit` — exit 0.
- `npx eslint <changed-paths>` — zero errors. No `any`, no `eslint-disable`.
- `npx vite build` — exit 0.

### DB

- `npx supabase db diff` shows only the new trigger, function, optional narrowed RLS, and the backfill `UPDATE`.

## Risks

- **Trigger performance.** `class_groups.name` updates are rare (one human action), and child sections per group are typically 1–10. Trigger cost is negligible.
- **Existing call sites still read denormalized `classes.name`.** This spec deliberately keeps the denormalization. Refactoring every consumer to JOIN through `class_groups` is out of scope and would balloon the diff far beyond the user's request.
- **`coordinator` rename access is institution-scoped, not wing-scoped at the DB level.** A coordinator who somehow gets a different class's id (e.g. crafted request) could rename it. UI gating + wing scoping in `useCoordinatorClasses` blocks this in practice; tightening at RLS level is a follow-up if needed.

## Out of Scope (Restated)

- Audit log of renames.
- Notifications to teachers/students.
- Bulk rename.
- `academic_year` rename.
- Dropping `classes.name`.
- Wing-level RLS for coordinators.
