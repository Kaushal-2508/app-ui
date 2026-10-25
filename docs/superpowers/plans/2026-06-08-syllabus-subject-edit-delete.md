# Syllabus Subject Edit + Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Edit + Delete affordances for subjects on `/school/syllabus` (admins + coordinators only), where non-global subjects are permanently hard-deleted and global subjects are unassigned from the class, and every subject/chapter/material deletion is recorded to the acting user's activity feed.

**Architecture:** Frontend-first. New mutation hooks call Supabase directly (hard-delete `universal_subjects`, or delete `subject_class_group_mappings`/`subject_class_mappings`), and a reusable helper records deletes via the `log_audit_event` SECURITY DEFINER RPC — which surfaces automatically in `ViewUserSheet`'s federated Activity tab. One small idempotent RLS migration grants coordinators DELETE on their institution's subjects (completing the stated intent of migration `20260421120000`).

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, shadcn/ui, Supabase (PostgREST + Postgres RLS). Spec: `docs/superpowers/specs/2026-06-08-syllabus-subject-edit-delete-design.md`.

**Testing approach:** This repo has no unit-test runner. Per CLAUDE.md §5a the quality gates are `npx tsc --noEmit` (exit 0), `npx eslint <touched paths>` (no new errors), and `npx vite build` (exit 0). Each task verifies against these; Task 7 is the manual smoke. Do **not** introduce a test framework.

**Key constraints baked into this plan (do not violate):**
- Never reuse `useRemoveSubjectFromGrade` / `useDeleteSubject` / `useDeleteInstituteSubject` — they hard-delete the wrong rows and would nuke Global subjects platform-wide.
- `homework_assignments.subject_id` is `ON DELETE RESTRICT` → a hard delete throws Postgres `23503`; catch it.
- Subject↔class is mapped at the **class_group** level; deleting the `subject_class_group_mappings` row triggers removal of the per-section `subject_class_mappings` rows.
- `logActivityEvent` must **never throw** (a logging failure must not fail the delete).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260608120000_coordinator_delete_subjects.sql` | **new** — coordinator DELETE RLS policy on `universal_subjects` |
| `src/lib/activityLog.ts` | **new** — `logActivityEvent` helper (wraps `log_audit_event` RPC, best-effort) |
| `src/hooks/useManageSchoolSubject.ts` | **new** — `useDeleteSchoolSubject`, `useRemoveSubjectFromClass`, `useUpdateSchoolSubject` |
| `src/components/syllabus/EditSubjectDialog.tsx` | **new** — name + category edit dialog |
| `src/components/syllabus/SubjectCard.tsx` | **modify** — add `onEdit` pencil button |
| `src/components/syllabus/SyllabusTreeView.tsx` | **modify** — subject-row edit/delete buttons; thread names into delete callbacks |
| `src/pages/school/SchoolSyllabusPage.tsx` | **modify** — flags, handlers, confirm dialog, EditSubjectDialog mount, audit logging |

---

## Task 1: RLS migration — coordinator DELETE on `universal_subjects`

**Files:**
- Create: `supabase/migrations/20260608120000_coordinator_delete_subjects.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Grant coordinators DELETE on their own institution's subjects.
--
-- Migration 20260421120000 documented the intent to "extend UPDATE/DELETE to
-- coordinator" but only created the UPDATE policy. This completes it so that a
-- coordinator can permanently delete a school-owned subject from the syllabus
-- page (admins already can via 20260223113730). Institution-scoped, matching the
-- coordinator INSERT/UPDATE policies. Global subjects (institution_id IS NULL)
-- are never matched, so they remain undeletable by schools.
DROP POLICY IF EXISTS "Coordinators can delete institution subjects" ON public.universal_subjects;
CREATE POLICY "Coordinators can delete institution subjects"
  ON public.universal_subjects FOR DELETE
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );
```

- [ ] **Step 2: Sanity-check the SQL**

Confirm `public.get_user_institution(uuid)` and `public.has_role(uuid, text)` are the helper names used by the sibling policies (they are, per `20260421120000` and `20260223113730`). Confirm the file name sorts AFTER the latest existing migration in `supabase/migrations/` (it does — newest existing is `20260605120000`).

- [ ] **Step 3: Commit (do NOT apply to prod yet)**

```bash
git add supabase/migrations/20260608120000_coordinator_delete_subjects.sql
git commit -m "feat(db): grant coordinators DELETE on institution subjects (idempotent)"
```

> **Apply step (gated — requires the user's go-ahead):** This migration changes production RLS on project `gyymkgohcijeksmrzuyw`. Before applying, optionally verify it isn't already present:
> `select policyname from pg_policies where tablename='universal_subjects' and cmd='DELETE';`
> Then apply via the project's normal flow (`npx supabase db push`, or the Management API SQL endpoint). The `DROP ... IF EXISTS` makes re-runs safe. Coordinators' hard-delete path stays inert until this is applied; admins work regardless.

---

## Task 2: `logActivityEvent` helper

**Files:**
- Create: `src/lib/activityLog.ts`

- [ ] **Step 1: Write the helper**

```ts
import { supabase } from "@/integrations/supabase/client";

/** JSON-serialisable flat record (assignable to the RPC's `Json` params). */
type JsonRecord = Record<string, string | number | boolean | null>;

export interface LogActivityEventParams {
  /** Past-tense verb, snake_case, e.g. "subject_deleted". */
  action: string;
  /** Human label for the entity kind, e.g. "Subject" / "Chapter" / "Material". */
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  oldValues?: JsonRecord | null;
  /** ALWAYS include `institution_id` so school admins can read the row in ViewUserSheet. */
  metadata?: JsonRecord | null;
}

/**
 * Best-effort write to `system_audit_logs` via the SECURITY DEFINER
 * `log_audit_event` RPC, which stamps `actor_id = auth.uid()`. ViewUserSheet's
 * Activity tab federates `system_audit_logs` by `actor_id`, so the event shows
 * up there automatically — no feed changes needed.
 *
 * NEVER throws: a logging failure must not fail the operation it follows.
 */
export async function logActivityEvent(params: LogActivityEventParams): Promise<void> {
  try {
    await supabase.rpc("log_audit_event", {
      _action: params.action,
      _entity_type: params.entityType,
      _entity_id: params.entityId ?? undefined,
      _entity_name: params.entityName ?? undefined,
      _old_values: params.oldValues ?? undefined,
      _metadata: params.metadata ?? {},
    });
  } catch (err) {
    console.warn("[activityLog] failed to record event:", params.action, err);
  }
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: exit 0 (the `log_audit_event` RPC is in the generated types — `src/integrations/supabase/types.ts`). If `_old_values`/`_metadata` complain about `Json`, the `JsonRecord` shape is still assignable; do not add `as any`.

Run: `npx eslint src/lib/activityLog.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/activityLog.ts
git commit -m "feat: add logActivityEvent helper (records deletes to system_audit_logs)"
```

---

## Task 3: Subject management hooks

**Files:**
- Create: `src/hooks/useManageSchoolSubject.ts`

- [ ] **Step 1: Write the three mutations**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { logActivityEvent } from "@/lib/activityLog";
import { resolveClassGroupIdFromClassId } from "@/lib/subjectCode";

function bustSubjectCaches(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateSyllabusCache(queryClient);
  queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
}

interface DeleteSubjectInput {
  subjectId: string;
  subjectName: string;
  institutionId: string;
  className?: string;
}

/**
 * Permanent hard-delete of a school-owned (institute) subject. DB cascades
 * remove chapters/mappings; question-bank + materials survive with subject_id
 * SET NULL. Blocked by homework (ON DELETE RESTRICT → 23503).
 * NEVER call this for a Global subject (institution_id IS NULL).
 */
export function useDeleteSchoolSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteSubjectInput) => {
      const { error: deleteError } = await supabase
        .from("universal_subjects")
        .delete()
        .eq("id", input.subjectId);
      if (deleteError) {
        if (deleteError.code === "23503") {
          throw new Error(
            "This subject is used in homework assignments. Remove those first, then delete the subject."
          );
        }
        throw deleteError;
      }

      // Delete-then-verify: PostgREST RETURNING is gated by SELECT RLS, so an
      // empty delete response isn't authoritative. Re-select; "row gone" = success.
      const { data: stillThere } = await supabase
        .from("universal_subjects")
        .select("id")
        .eq("id", input.subjectId)
        .maybeSingle();
      if (stillThere) {
        throw new Error(
          "You don't have permission to delete this subject. Ask a school admin if you think this is wrong."
        );
      }

      await logActivityEvent({
        action: "subject_deleted",
        entityType: "Subject",
        entityId: input.subjectId,
        entityName: input.subjectName,
        oldValues: { class: input.className ?? null },
        metadata: { institution_id: input.institutionId },
      });
    },
    onSuccess: () => {
      bustSubjectCaches(queryClient);
      toast.success("Subject deleted");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete the subject.", context: "deleteSchoolSubject" }),
  });
}

interface RemoveSubjectInput {
  subjectId: string;
  subjectName: string;
  classId: string; // the section the user is viewing
  institutionId: string;
  className?: string;
}

/**
 * Unassign a subject from a class without touching universal_subjects. Used for
 * Global subjects (and any case where we must not delete the shared row).
 * Deletes the class_group mapping (trigger fans the delete out to scm) and
 * cleans any residual legacy section mappings.
 */
export function useRemoveSubjectFromClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RemoveSubjectInput) => {
      const classGroupId = await resolveClassGroupIdFromClassId(input.classId);

      // 1. Canonical group-level unassign (trigger fans out to subject_class_mappings).
      if (classGroupId) {
        const { error: scgmError } = await supabase
          .from("subject_class_group_mappings" as never)
          .delete()
          .eq("class_group_id", classGroupId)
          .eq("subject_id", input.subjectId);
        if (scgmError) throw scgmError;
      }

      // 2. Clean residual legacy per-section mappings (globals mapped only at scm).
      let sectionIds = [input.classId];
      if (classGroupId) {
        const { data: sections } = await supabase
          .from("classes")
          .select("id")
          .eq("class_group_id", classGroupId);
        if (sections && sections.length > 0) {
          sectionIds = sections.map((s) => s.id);
        }
      }
      const { error: scmError } = await supabase
        .from("subject_class_mappings")
        .delete()
        .eq("subject_id", input.subjectId)
        .in("class_id", sectionIds);
      if (scmError) throw scmError;

      await logActivityEvent({
        action: "subject_removed_from_class",
        entityType: "Subject",
        entityId: input.subjectId,
        entityName: input.subjectName,
        oldValues: { class: input.className ?? null },
        metadata: { institution_id: input.institutionId },
      });
    },
    onSuccess: () => {
      bustSubjectCaches(queryClient);
      toast.success("Subject removed from class");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't remove the subject.", context: "removeSubjectFromClass" }),
  });
}

interface UpdateSubjectInput {
  subjectId: string;
  name: string;
  category: string | null;
  institutionId: string;
  classId: string; // for duplicate-name scoping within the class_group
}

/** Rename + recategorise a school-owned subject. Code is left unchanged. */
export function useUpdateSchoolSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSubjectInput) => {
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Subject name is required.");
      const nameLower = trimmed.toLowerCase();

      const classGroupId = await resolveClassGroupIdFromClassId(input.classId);
      if (classGroupId) {
        const { data: existing, error: existingError } = await supabase
          .from("subject_class_group_mappings" as never)
          .select("subject_id, universal_subjects!inner(name, is_active)")
          .eq("class_group_id", classGroupId);
        if (existingError) throw existingError;
        for (const row of (existing ?? []) as Array<{
          subject_id: string;
          universal_subjects: { name: string; is_active: boolean } | null;
        }>) {
          if (row.subject_id === input.subjectId) continue;
          const us = row.universal_subjects;
          if (!us || !us.is_active) continue;
          if (us.name.trim().toLowerCase() === nameLower) {
            throw new Error("A subject with this name already exists in this class. Use a different name.");
          }
        }
      }

      const { error } = await supabase
        .from("universal_subjects")
        .update({ name: trimmed, category: input.category })
        .eq("id", input.subjectId);
      if (error) throw error;

      await logActivityEvent({
        action: "subject_updated",
        entityType: "Subject",
        entityId: input.subjectId,
        entityName: trimmed,
        metadata: { institution_id: input.institutionId },
      });
    },
    onSuccess: () => {
      bustSubjectCaches(queryClient);
      toast.success("Subject updated");
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update the subject.", context: "updateSchoolSubject" }),
  });
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: exit 0. The `"subject_class_group_mappings" as never` pattern matches `useAddInstituteSubject` (`src/hooks/useInstituteSyllabus.ts`) — keep it; that table is absent from generated types.

Run: `npx eslint src/hooks/useManageSchoolSubject.ts`
Expected: no errors (no `any`; the `as never` table cast and the `as Array<…>` join cast mirror existing approved patterns).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useManageSchoolSubject.ts
git commit -m "feat: subject delete/remove/update mutations with audit logging"
```

---

## Task 4: EditSubjectDialog

**Files:**
- Create: `src/components/syllabus/EditSubjectDialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Loader2 } from "lucide-react";
import { useUpdateSchoolSubject } from "@/hooks/useManageSchoolSubject";

const CATEGORY_OPTIONS = [
  { value: "core", label: "Core" },
  { value: "elective", label: "Elective" },
  { value: "language", label: "Language" },
  { value: "vocational", label: "Vocational" },
];
const NO_CATEGORY = "__none__";

interface EditSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: { id: string; name: string; category: string | null; institutionId: string };
  classId: string;
  className?: string;
}

export function EditSubjectDialog({
  open,
  onOpenChange,
  subject,
  classId,
  className,
}: EditSubjectDialogProps) {
  const [name, setName] = useState(subject.name);
  const [category, setCategory] = useState<string>(subject.category?.toLowerCase() || NO_CATEGORY);
  const updateSubject = useUpdateSchoolSubject();

  // Re-seed when the target subject changes (the dialog instance is reused).
  useEffect(() => {
    if (open) {
      setName(subject.name);
      setCategory(subject.category?.toLowerCase() || NO_CATEGORY);
    }
  }, [open, subject.id, subject.name, subject.category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateSubject.mutate(
      {
        subjectId: subject.id,
        name: name.trim(),
        category: category === NO_CATEGORY ? null : category,
        institutionId: subject.institutionId,
        classId,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Edit Subject
          </DialogTitle>
          <DialogDescription>
            Rename this subject or change its category{className ? ` for ${className}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editSubjectName">Subject Name *</Label>
            <Input
              id="editSubjectName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Environmental Science"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editSubjectCategory">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="editSubjectCategory">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || updateSubject.isPending}>
              {updateSubject.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint src/components/syllabus/EditSubjectDialog.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/syllabus/EditSubjectDialog.tsx
git commit -m "feat: EditSubjectDialog (rename + category)"
```

---

## Task 5: SubjectCard `onEdit` + SyllabusTreeView affordances

**Files:**
- Modify: `src/components/syllabus/SubjectCard.tsx`
- Modify: `src/components/syllabus/SyllabusTreeView.tsx`

### 5a — SubjectCard

- [ ] **Step 1: Add the `Pencil` import**

In `src/components/syllabus/SubjectCard.tsx`, add `Pencil` to the `lucide-react` import (the block ending with `Trash2,`):

```tsx
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
```

- [ ] **Step 2: Add `onEdit` to the props interface**

In `SubjectCardProps`, add below `onDelete?: () => void;`:

```tsx
  onEdit?: () => void;
```

- [ ] **Step 3: Destructure `onEdit`**

In the `export function SubjectCard({ … })` parameter list, add `onEdit,` next to `onDelete,`.

- [ ] **Step 4: Render the pencil button**

In the action row (`<div className="flex items-center gap-1">` near the end), insert **before** the existing `{onDelete && (` block:

```tsx
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
```

### 5b — SyllabusTreeView

- [ ] **Step 5: Add `Pencil` to the `lucide-react` import**

In `src/components/syllabus/SyllabusTreeView.tsx`, add `Pencil,` to the icon import block (it already imports `Trash2`).

- [ ] **Step 6: Extend the props interface**

In `SyllabusTreeViewProps`, add these props and widen the two delete callbacks to carry a name:

```tsx
  onEditSubject?: (args: {
    subjectId: string;
    subjectName: string;
    category: string | null;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
  onDeleteSubject?: (args: {
    subjectId: string;
    subjectName: string;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => void;
```

Change `onDeleteTopic?: (topicId: string, institutionId: string | null) => void;`
to `onDeleteTopic?: (topicId: string, institutionId: string | null, topicName?: string) => void;`

Change `onDeleteMaterial?: (materialId: string) => void;`
to `onDeleteMaterial?: (materialId: string, materialTitle?: string) => void;`

- [ ] **Step 7: Thread the new props through `SyllabusTreeView` → `GradeNode`**

In the `export function SyllabusTreeView({ … })` destructure, add `onEditSubject,` and `onDeleteSubject,`. In the `<GradeNode … />` JSX (inside `filteredData.map`), add:

```tsx
                  onEditSubject={onEditSubject}
                  onDeleteSubject={onDeleteSubject}
```

In the `function GradeNode({ … })` destructure, add `onEditSubject,` and `onDeleteSubject,`. In `GradeNode`'s props type object, add the same two prop type lines from Step 6, plus update the `onDeleteTopic` / `onDeleteMaterial` type lines to match Step 6's widened signatures.

- [ ] **Step 8: Render Edit + Delete buttons on the subject header**

In the subject header action area (the `<div className="flex items-center gap-1">` that currently holds the Select-All checkbox, the `onAddTopic` button, and the chevron), insert **after** the `onAddTopic` button block and **before** the chevron:

```tsx
                          {onEditSubject && !isSelectionMode && subject.institution_id != null && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                              title="Edit subject"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditSubject({
                                  subjectId: subject.id,
                                  subjectName: subject.name,
                                  category: subject.category ?? null,
                                  institutionId: subject.institution_id ?? null,
                                  classId: grade.id,
                                  className: grade.grade_name,
                                });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {onDeleteSubject && !isSelectionMode && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              title={subject.institution_id == null ? "Remove subject from class" : "Delete subject"}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSubject({
                                  subjectId: subject.id,
                                  subjectName: subject.name,
                                  institutionId: subject.institution_id ?? null,
                                  classId: grade.id,
                                  className: grade.grade_name,
                                });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
```

- [ ] **Step 9: Pass the names into the existing topic + material delete calls**

In the topic header, change the existing delete `onClick` call
`onDeleteTopic(topic.id, topic.institution_id)`
to `onDeleteTopic(topic.id, topic.institution_id, topic.topic_name)`.

In the material row, change the existing delete `onClick` call
`onDeleteMaterial(material.id)`
to `onDeleteMaterial(material.id, material.title)`.

- [ ] **Step 10: Verify types + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint src/components/syllabus/SubjectCard.tsx src/components/syllabus/SyllabusTreeView.tsx`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/components/syllabus/SubjectCard.tsx src/components/syllabus/SyllabusTreeView.tsx
git commit -m "feat: subject edit/delete buttons in panel + tree views"
```

---

## Task 6: Wire SchoolSyllabusPage

**Files:**
- Modify: `src/pages/school/SchoolSyllabusPage.tsx`

- [ ] **Step 1: Add imports**

Near the other component imports add:

```tsx
import { EditSubjectDialog } from "@/components/syllabus/EditSubjectDialog";
```

Near the other hook imports add:

```tsx
import { useDeleteSchoolSubject, useRemoveSubjectFromClass } from "@/hooks/useManageSchoolSubject";
import { logActivityEvent } from "@/lib/activityLog";
```

- [ ] **Step 2: Add the `subject` case to the `deleteConfirm` state union**

Replace the existing `deleteConfirm` `useState` union with:

```tsx
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "topic"; id: string; institutionId: string | null; name?: string | null }
    | { type: "material"; id: string; name?: string | null }
    | {
        type: "subject";
        kind: "hard" | "remove";
        id: string;
        name: string;
        institutionId: string | null;
        classId: string;
        className: string;
      }
    | null
  >(null);
```

- [ ] **Step 3: Add the edit-dialog context state**

Directly below the `deleteConfirm` state, add:

```tsx
  const [editSubjectCtx, setEditSubjectCtx] = useState<{
    id: string;
    name: string;
    category: string | null;
    institutionId: string;
    classId: string;
    className: string;
  } | null>(null);
```

- [ ] **Step 4: Add the new mutations**

Next to `const deleteTopic = useDeleteTopic();` add:

```tsx
  const deleteSubject = useDeleteSchoolSubject();
  const removeSubject = useRemoveSubjectFromClass();
```

- [ ] **Step 5: Add the permission flags**

Next to the existing `canManageSubjectsGlobally` flag add:

```tsx
  const isAdmin =
    effectiveRole === "school_admin" ||
    effectiveRole === "super_admin" ||
    effectiveRole === "super_school_admin";
  // Subject edit/delete is for admins + coordinators only (never teachers).
  const canManageSubjects = isAdmin || effectiveRole === "coordinator";
```

- [ ] **Step 6: Widen the chapter/material delete handlers to carry a name**

Replace `handleDeleteTopic` and `handleDeleteMaterial` with:

```tsx
  const handleDeleteTopic = (
    topicId: string,
    institutionId: string | null = null,
    name?: string,
  ) => {
    if (canDeleteTopics) {
      setDeleteConfirm({ type: "topic", id: topicId, institutionId, name });
    }
  };

  const handleDeleteMaterial = (materialId: string, name?: string) => {
    if (canDeleteMaterials) {
      setDeleteConfirm({ type: "material", id: materialId, name });
    }
  };
```

- [ ] **Step 7: Add the subject edit + delete handlers**

Directly below `handleDeleteMaterial`, add:

```tsx
  const handleEditSubject = (args: {
    subjectId: string;
    subjectName: string;
    category: string | null;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => {
    if (!canManageSubjects || args.institutionId == null) return; // globals not editable
    setEditSubjectCtx({
      id: args.subjectId,
      name: args.subjectName,
      category: args.category,
      institutionId: args.institutionId,
      classId: args.classId,
      className: args.className,
    });
  };

  const handleDeleteSubject = (args: {
    subjectId: string;
    subjectName: string;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => {
    if (!canManageSubjects) return;
    const kind: "hard" | "remove" = args.institutionId == null ? "remove" : "hard";
    setDeleteConfirm({
      type: "subject",
      kind,
      id: args.subjectId,
      name: args.subjectName,
      institutionId: args.institutionId,
      classId: args.classId,
      className: args.className,
    });
  };
```

- [ ] **Step 8: Replace `handleConfirmDelete` (adds subject routing + audit logging)**

```tsx
  const handleConfirmDelete = () => {
    if (!deleteConfirm) return;
    if (!institutionId) return;
    const auditMeta = { institution_id: institutionId };

    if (deleteConfirm.type === "topic") {
      const name = deleteConfirm.name ?? null;
      if (deleteConfirm.institutionId === null) {
        hideGlobalTopic.mutate(deleteConfirm.id, {
          onSuccess: () =>
            logActivityEvent({
              action: "chapter_hidden",
              entityType: "Chapter",
              entityId: deleteConfirm.id,
              entityName: name,
              metadata: auditMeta,
            }),
        });
      } else {
        deleteTopic.mutate(deleteConfirm.id, {
          onSuccess: () =>
            logActivityEvent({
              action: "chapter_deleted",
              entityType: "Chapter",
              entityId: deleteConfirm.id,
              entityName: name,
              metadata: auditMeta,
            }),
        });
      }
    } else if (deleteConfirm.type === "material") {
      const name = deleteConfirm.name ?? null;
      deleteMaterial.mutate(deleteConfirm.id, {
        onSuccess: () =>
          logActivityEvent({
            action: "material_deleted",
            entityType: "Material",
            entityId: deleteConfirm.id,
            entityName: name,
            metadata: auditMeta,
          }),
      });
    } else if (deleteConfirm.type === "subject") {
      if (deleteConfirm.kind === "hard") {
        deleteSubject.mutate({
          subjectId: deleteConfirm.id,
          subjectName: deleteConfirm.name,
          institutionId,
          className: deleteConfirm.className,
        });
      } else {
        removeSubject.mutate({
          subjectId: deleteConfirm.id,
          subjectName: deleteConfirm.name,
          classId: deleteConfirm.classId,
          institutionId,
          className: deleteConfirm.className,
        });
      }
    }
    setDeleteConfirm(null);
  };
```

- [ ] **Step 9: Wire the tree view**

In the `<SyllabusTreeView … />` JSX, add (alongside `onDeleteTopic`/`onDeleteMaterial`):

```tsx
            onEditSubject={canManageSubjects ? handleEditSubject : undefined}
            onDeleteSubject={canManageSubjects ? handleDeleteSubject : undefined}
```

- [ ] **Step 10: Wire the panel `SubjectCard`**

In the panel `filteredSubjects.map((subject) => ( <SubjectCard … /> ))`, add these two props to `<SubjectCard>`:

```tsx
                    onEdit={
                      canManageSubjects && subject.institution_id != null
                        ? () =>
                            handleEditSubject({
                              subjectId: subject.id,
                              subjectName: subject.name,
                              category: subject.category ?? null,
                              institutionId: subject.institution_id ?? null,
                              classId: selectedGrade!.id,
                              className: selectedGrade!.grade_name,
                            })
                        : undefined
                    }
                    onDelete={
                      canManageSubjects
                        ? () =>
                            handleDeleteSubject({
                              subjectId: subject.id,
                              subjectName: subject.name,
                              institutionId: subject.institution_id ?? null,
                              classId: selectedGrade!.id,
                              className: selectedGrade!.grade_name,
                            })
                        : undefined
                    }
```

- [ ] **Step 11: Pass the chapter name through the panel TopicAccordion delete**

In the panel `<TopicAccordion … />`, change the `onDelete` prop from
`onDelete={canDeleteTopics ? () => handleDeleteTopic(topic.id, topic.institution_id) : undefined}`
to:

```tsx
                  onDelete={
                    canDeleteTopics
                      ? () => handleDeleteTopic(topic.id, topic.institution_id, topic.topic_name)
                      : undefined
                  }
```

- [ ] **Step 12: Mount the EditSubjectDialog**

In the dialogs section (near `AddSchoolSubjectDialog`), add:

```tsx
      {editSubjectCtx && (
        <EditSubjectDialog
          open={!!editSubjectCtx}
          onOpenChange={(open) => {
            if (!open) setEditSubjectCtx(null);
          }}
          subject={{
            id: editSubjectCtx.id,
            name: editSubjectCtx.name,
            category: editSubjectCtx.category,
            institutionId: editSubjectCtx.institutionId,
          }}
          classId={editSubjectCtx.classId}
          className={editSubjectCtx.className}
        />
      )}
```

- [ ] **Step 13: Extend the delete confirmation dialog copy**

Replace the `<AlertDialogTitle>` and `<AlertDialogDescription>` bodies and the action button so they handle the subject case:

```tsx
            <AlertDialogTitle>
              {deleteConfirm?.type === "subject"
                ? deleteConfirm.kind === "hard"
                  ? "Delete Subject?"
                  : "Remove Subject from Class?"
                : `Delete ${deleteConfirm?.type === "topic" ? "Chapter" : "Material"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.type === "subject"
                ? deleteConfirm.kind === "hard"
                  ? `This permanently deletes "${deleteConfirm.name}" and all its chapters for ${deleteConfirm.className}. Study materials and question-bank questions are kept but lose the subject tag. This can't be undone.`
                  : `This removes "${deleteConfirm.name}" from ${deleteConfirm.className}. It's a shared subject, so it stays available to other schools and can be added back later.`
                : `This action cannot be undone. This will permanently delete the ${deleteConfirm?.type}.`}
            </AlertDialogDescription>
```

And the action button label:

```tsx
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteConfirm?.type === "subject" && deleteConfirm.kind === "remove" ? "Remove" : "Delete"}
            </AlertDialogAction>
```

- [ ] **Step 14: Verify types, lint, and build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint src/pages/school/SchoolSyllabusPage.tsx`
Expected: no errors.

Run: `npx vite build`
Expected: exit 0 (bundle-size warnings are OK; only non-zero exit blocks).

- [ ] **Step 15: Commit**

```bash
git add src/pages/school/SchoolSyllabusPage.tsx
git commit -m "feat: wire subject edit/delete + delete activity logging into syllabus page"
```

---

## Task 7: Final verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run all three gates one more time**

Run: `npx tsc --noEmit` → exit 0
Run: `npx eslint src/lib/activityLog.ts src/hooks/useManageSchoolSubject.ts src/components/syllabus/EditSubjectDialog.tsx src/components/syllabus/SubjectCard.tsx src/components/syllabus/SyllabusTreeView.tsx src/pages/school/SchoolSyllabusPage.tsx` → no errors
Run: `npx vite build` → exit 0

- [ ] **Step 2: Manual smoke (dev server `npm run dev`, viewport 375px, then toggle dark mode)**

As **school admin** on `/school/syllabus` (both Tree and Panel views):
- Hover a school-owned subject → Edit (pencil) + Delete (trash) appear. Edit → rename + change category → row updates.
- Delete a school-owned subject → "Delete Subject?" warning → confirm → subject + its chapters vanish from Tree **and** Panel.
- A school-owned subject used in homework → delete shows "used in homework assignments…" (not a raw Postgres error).
- Hover the Global "English Core" → **only** Delete shows (no Edit), titled "Remove subject from class" → confirm "Remove Subject from Class?" → it disappears from this class.

As **coordinator** (wing class) — only after Task 1's migration is applied to prod:
- Same edit + hard-delete on a school-owned subject works; wing scope holds.

As **teacher**:
- No Edit/Delete buttons on any subject (chapter/material delete still present).

Activity feed:
- Open the acting user in `ViewUserSheet` (admin Users surface) → **Activity** tab lists `subject deleted` / `subject removed from class` / `chapter deleted` / `material deleted` events with timestamps.

- [ ] **Step 3: If anything fails, fix and re-run Step 1; commit fixes.**

---

## Self-review (completed against the spec)

- **Spec coverage:** Edit (§4.C → Tasks 3,4,6) ✓; hard-delete non-global (§4.A → Tasks 3,6) ✓; remove-from-class global (§4.B → Tasks 3,6) ✓; coordinator parity via migration (§6 → Task 1) ✓; admin+coordinator-only gate, teachers excluded (§3 → Task 6 `canManageSubjects`) ✓; activity logging for subject/chapter/material deletes (§4,§5 → Tasks 2,6) ✓; `23503` homework handling (§4.A → Task 3) ✓; both Tree + Panel surfaces (§5 → Tasks 5,6) ✓; verification gates (§8 → Tasks 6,7) ✓.
- **Placeholder scan:** none — every step ships real code/SQL/commands.
- **Type consistency:** `logActivityEvent` param shape (Task 2) matches all call sites (Tasks 3,6); hook input interfaces (`DeleteSubjectInput`/`RemoveSubjectInput`/`UpdateSubjectInput`, Task 3) match the page's `.mutate({…})` calls (Task 6); `onEditSubject`/`onDeleteSubject` arg objects identical across SyllabusTreeView (Task 5) and the page handlers (Task 6); widened `onDeleteTopic`/`onDeleteMaterial` signatures consistent across Tasks 5 and 6.
- **Known limitation (intentional):** panel-view **material** deletes log `entityName: null` (the page's `handleDeleteMaterial` only receives a title from the Tree view; threading it through `TopicAccordion` is out of scope). The action + id + institution are still logged.
