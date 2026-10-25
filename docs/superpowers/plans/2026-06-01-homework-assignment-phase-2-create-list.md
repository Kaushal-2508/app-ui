# Homework & Assignment — Phase 2 (Create/Edit Flow + 3-Tab List + Nav) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the teacher/coordinator/admin-facing create+edit flow, the Scheduled/Submitted/Checked tabbed list (with a Drafts strip and filters), the Duplicate action, and the nav/route/dashboard wiring — so an authorized user can create, schedule, edit-while-scheduled, publish, browse, and duplicate homework. Student-facing surfaces are Phase 3.

**Architecture:** A single-screen `HomeworkCreationFlow` (no question/section machinery) backed by `useSaveHomework` / `useUpdateHomework` (mirroring the exam hooks' shape but compliant with §19 `toastError` and §23.1 auth-from-context). The list is an **RLS-scoped paginated query** — the `homework_assignments` SELECT policy (`can_manage_homework`) already returns only manageable rows, so no client-side role branching — filtered by tab (status + `due_at`). Submission counts come from one **batched SECURITY DEFINER RPC** (`homework_list_counts`) per page (§23 server-side aggregation, no N+1). Subject/class options reuse existing role-scoped hooks. Nav/routes/gating follow the exam pattern; the `homework` feature flag + `FEATURE_URL_MAP` entries shipped in Phase 1.

**Tech Stack:** React 18 + TS (Vite), TanStack Query v5, React Router v6, Supabase, shadcn/ui + the `src/components/shared/*` mobile design system (§20a/§20b). Verification: `npx tsc --noEmit` / `npx eslint <paths>` / `npx vite build` (§5a).

**Branch:** `homework/phase-2-create` (already created off `homework/phase-1-schema`). **Spec:** `docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md`.

---

## Compliance guardrails (apply in every task)

- **§19 errors:** every `onError`/catch toast → `toastError(err, { fallback, context })` from `@/lib/toast`. Never `toast.error(err.message)`. Success toasts use `toast.success` from `sonner`.
- **§23.1 auth:** do NOT call `supabase.auth.getUser()`. Get the user from `useAuth()` (`user.id`) and the institution from `useEffectiveInstitution()` (`institutionId`). (The exam hooks use `getUser()` — do not copy that.)
- **§23.2 queries:** every `useQuery` sets explicit `staleTime` (≥ 60_000 unless genuinely volatile). No `refetchInterval` here.
- **§23 lists:** paginate (`range`). No `select("*")` — explicit columns.
- **§20a/§20b UI:** `PageShell`/`PageHeader`/`MobileTabs`/`FilterRow`/`FilterSheet`/`ListRow`/`EmptyState`/`MobileSheet`; shadcn `Input/Select/Textarea/Switch` only; `text-ink-900/600`, `surface-card frosted-shadow`, `rounded-card`; no raw colors/shadows; works at 375px; dark-mode flips.
- **No `any`** (§5a) — real types, inline structural types, or `unknown` + narrow cast. For PostgREST joins returning `T | T[]`, use a small inline type + a `pickOne<T>()` helper.

---

## File structure

**Create (migration):**
- `supabase/migrations/20260601093000_homework_list_counts_rpc.sql` — batched submission/grading/total-student counts RPC.

**Create (types/hooks):**
- `src/types/homework.ts` — `HomeworkFormData`, `HomeworkStatus`, list-row + counts types.
- `src/hooks/useHomeworkSave.ts` — `useSaveHomework` (create/draft-upsert/publish).
- `src/hooks/useHomeworkUpdate.ts` — `useUpdateHomework` (edit while scheduled).
- `src/hooks/useHomeworkData.ts` — `useHomeworkList(tab, filters)`, `useHomeworkCounts(ids)`, `useHomeworkDrafts()`, `useHomeworkForEdit(id)`, `useDuplicateHomework()`, `useDeleteHomeworkDraft()`.
- `src/hooks/useHomeworkScope.ts` — role-scoped `{ classes, subjectsForClasses }` selector built on existing hooks.

**Create (components/pages):**
- `src/components/homework-creation/HomeworkCreationFlow.tsx` — single-screen create/edit form.
- `src/pages/CreateHomework.tsx`, `src/pages/EditHomework.tsx` — thin wrappers.
- `src/pages/HomeworkPage.tsx` — 3-tab list + drafts strip + filters.

**Modify:**
- `src/integrations/supabase/types.ts` — regenerated (Task 2).
- `src/App.tsx` — lazy imports + 3 routes.
- `src/components/layout/AppSidebar.tsx` — nav entries (teacher + coordinator + school-admin groups).
- `src/components/dashboards/*` — a `FeatureTile`/nav-group entry for "Create Homework & Assignment".

**Out of scope (later phases):** student nav entry + `/student/homework` (Phase 3 — don't add a nav link to a route that doesn't exist yet); the assignment detail/marking page (Phase 4); attachment upload UI beyond a single file field wired to the existing `storageUpload.ts` + `homework-files` bucket (the create form uploads the optional teacher attachment; submission upload is Phase 3).

---

## Task 1: Regenerate Supabase types for the homework tables

The Phase-1 tables are live in prod, so `gen types` will now include them.

**Files:** Modify `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerate types from the remote schema**

Run from repo root (the project's established command — see olympiad plans):
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```
Expected: file rewritten, now containing `homework_assignments`, `homework_assignment_classes`, `homework_submissions`, `homework_submission_files`, `homework_results`, `homework_mark_audit`, `homework_notifications_sent` under `Database.public.Tables`.

- [ ] **Step 2: Confirm the tables are present + build still compiles**

Run:
```bash
grep -c "homework_assignments:" src/integrations/supabase/types.ts   # expect >= 1
npx tsc --noEmit
```
Expected: grep ≥ 1; `tsc` exits 0 (regenerating types can surface pre-existing drift — if `tsc` was clean on the branch before and now errors ONLY in unrelated files due to upstream schema drift, STOP and report rather than editing unrelated files).

- [ ] **Step 3: Commit**
```bash
git add src/integrations/supabase/types.ts
git commit -F - <<'EOF'
chore(homework): regenerate supabase types (phase-1 homework tables)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Batched submission-counts RPC (migration)

**Files:** Create `supabase/migrations/20260601093000_homework_list_counts_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- Homework & Assignment — Phase 2: batched list counts RPC
-- Returns submission/grading/total-student counts for a set of
-- assignments the CALLER may manage. SECURITY DEFINER so the counts
-- aggregate server-side (§23) without exposing raw rows; access is
-- gated per-assignment by can_manage_homework so a caller only ever
-- gets counts for assignments they're allowed to see.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.homework_list_counts(_homework_ids uuid[])
RETURNS TABLE (
  homework_assignment_id uuid,
  submitted_count        integer,
  graded_count           integer,
  total_students         integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    h.id AS homework_assignment_id,
    (SELECT count(*)::int FROM public.homework_submissions s
       WHERE s.homework_assignment_id = h.id) AS submitted_count,
    (SELECT count(*)::int FROM public.homework_results r
       WHERE r.homework_assignment_id = h.id
         AND r.status IN ('graded','skipped')) AS graded_count,
    (SELECT count(DISTINCT ca.user_id)::int
       FROM public.homework_assignment_classes hac
       JOIN public.class_assignments ca ON ca.class_id = hac.class_id
       WHERE hac.homework_assignment_id = h.id
         AND ca.role = 'student') AS total_students
  FROM public.homework_assignments h
  WHERE h.id = ANY(_homework_ids)
    AND public.can_manage_homework(auth.uid(), h.id);
$$;

REVOKE ALL ON FUNCTION public.homework_list_counts(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_list_counts(uuid[]) TO authenticated;
```

- [ ] **Step 2: Confirm timestamp sorts last**
```powershell
Get-ChildItem "supabase\migrations\*.sql" | Sort-Object Name -Descending | Select-Object -First 1 Name
```
Expected: the Phase-1 `20260601090200_homework_feature_backfill.sql` (or another `20260601090*`) is newest; `20260601093000` sorts after it. If anything sorts later, bump the timestamp.

- [ ] **Step 3: Apply to prod via db push (authorized mechanism)**

> PROD apply on `gyymkgohcijeksmrzuyw`. The user authorized `supabase db push`. First dry-run to confirm scope is ONLY this RPC migration:
```bash
npx supabase db push --linked --dry-run
```
Expected "Would push": only `20260601093000_homework_list_counts_rpc.sql`. If anything else appears, STOP and report. Then:
```bash
npx supabase db push --linked --yes
```
Expected: "Finished supabase db push" with no error.

- [ ] **Step 4: Verify the function exists** (re-run gen types so the RPC is typed for the hooks):
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
grep -c "homework_list_counts" src/integrations/supabase/types.ts   # expect >= 1
npx tsc --noEmit
```
Expected: grep ≥ 1; `tsc` exits 0.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260601093000_homework_list_counts_rpc.sql src/integrations/supabase/types.ts
git commit -F - <<'EOF'
feat(homework): batched homework_list_counts RPC + regen types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Types + form-state contract

**Files:** Create `src/types/homework.ts`

- [ ] **Step 1: Write the shared types**

```ts
export type HomeworkStatus = "draft" | "published" | "checked";

/** Local form state for the create/edit flow. Dates are JS Date in the form,
 * serialized to ISO on save. */
export interface HomeworkFormData {
  /** Present once saved (draft upsert + edit). */
  homeworkId?: string;
  institutionId: string | null;
  title: string;
  description: string;
  subjectId: string | null;        // universal_subjects.id
  classIds: string[];              // classes.id (sections)
  carriesMarks: boolean;
  maxMarks: number | null;
  visibleFrom: Date;
  dueAt: Date;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
}

export interface SaveHomeworkResult {
  homeworkId: string;
  status: HomeworkStatus;
}

/** One row in the 3-tab list (assignment fields + joined names + counts). */
export interface HomeworkListRow {
  id: string;
  title: string;
  status: HomeworkStatus;
  carries_marks: boolean;
  max_marks: number | null;
  visible_from: string;
  due_at: string;
  checked_at: string | null;
  subject: { id: string; name: string } | null;
  classes: { id: string; name: string; section: string | null }[];
  counts?: { submitted: number; graded: number; total: number };
}

export const emptyHomeworkForm = (institutionId: string | null): HomeworkFormData => ({
  institutionId,
  title: "",
  description: "",
  subjectId: null,
  classIds: [],
  carriesMarks: true,
  maxMarks: null,
  // default visible now, due in 3 days (caller may override)
  visibleFrom: new Date(),
  dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  attachmentPath: null,
  attachmentName: null,
  attachmentMime: null,
});
```

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit
git add src/types/homework.ts
git commit -F - <<'EOF'
feat(homework): shared form/list types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Role-scoped class + subject selection hook

**Files:** Create `src/hooks/useHomeworkScope.ts`

Reuses the existing role-scoped hooks (no new queries): teachers get their assigned class+subject pairs; coordinators get wing classes; admins get all institution classes. Subjects are filtered to the selected class(es).

- [ ] **Step 1: Write the hook**

```ts
import { useMemo } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useClasses } from "@/hooks/useClasses";
import { useClassSubjects } from "@/hooks/useClassSubjects";

export interface ScopeClass { id: string; name: string; section: string | null }
export interface ScopeSubject { id: string; name: string }

/**
 * Returns the classes the current user may assign homework to (role-scoped)
 * and, given the chosen class ids, the subjects valid for them.
 * - teacher    -> own class_assignments (class+subject pairs)
 * - coordinator-> wing classes (subjects via useClassSubjects per class)
 * - admin      -> all institution classes (subjects via useClassSubjects)
 */
export function useHomeworkScope(selectedClassIds: string[]) {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const isTeacherScope = !!roleInfo?.isTeacher && !roleInfo?.isCoordinator && !roleInfo?.isSchoolAdmin && !roleInfo?.isSuperAdmin;

  const teacher = useTeacherAssignedSubjects();          // { grouped, flat, classIds, subjectIds }
  const coordinator = useCoordinatorClasses();           // { classes, classIds, isCoordinator }
  const adminClasses = useClasses();                     // institution classes (admins)

  // For coordinator/admin, subjects come from the selected classes' mappings.
  const firstClass = selectedClassIds[0] ?? null;
  const classSubjects = useClassSubjects(firstClass);    // subjects for a chosen class

  const classes: ScopeClass[] = useMemo(() => {
    if (isTeacherScope) {
      return teacher.data?.grouped.map((g) => ({ id: g.classId, name: g.className, section: g.section })) ?? [];
    }
    if (roleInfo?.isCoordinator && !roleInfo?.isSchoolAdmin && !roleInfo?.isSuperAdmin) {
      return (coordinator.classes ?? []).map((c) => ({ id: c.id, name: c.name, section: c.section ?? null }));
    }
    return (adminClasses.data ?? []).map((c) => ({ id: c.id, name: c.name, section: c.section ?? null }));
  }, [isTeacherScope, roleInfo, teacher.data, coordinator.classes, adminClasses.data]);

  const subjects: ScopeSubject[] = useMemo(() => {
    if (isTeacherScope) {
      // intersection of subjects taught across the selected classes
      const grouped = teacher.data?.grouped ?? [];
      const picked = grouped.filter((g) => selectedClassIds.includes(g.classId));
      const map = new Map<string, ScopeSubject>();
      picked.forEach((g) => g.subjects.forEach((s) => map.set(s.id, { id: s.id, name: s.name })));
      return [...map.values()];
    }
    return (classSubjects.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  }, [isTeacherScope, teacher.data, selectedClassIds, classSubjects.data]);

  return {
    classes,
    subjects,
    isLoading: roleLoading || teacher.isLoading || coordinator.isLoading || adminClasses.isLoading,
  };
}
```

> **Implementer note:** the exact return shapes of `useCoordinatorClasses`, `useClasses`, and `useClassSubjects` must be confirmed by reading those files; adjust property access (`.classes`/`.data`/field names) to match. If a hook's shape differs, adapt the mapping — do NOT introduce `any`; define a small inline type for the row. Keep `staleTime` defaults from those hooks (they already set sensible values).

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/hooks/useHomeworkScope.ts
git add src/hooks/useHomeworkScope.ts
git commit -F - <<'EOF'
feat(homework): role-scoped class/subject selection hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Save + update mutation hooks

**Files:** Create `src/hooks/useHomeworkSave.ts`, `src/hooks/useHomeworkUpdate.ts`

- [ ] **Step 1: `useHomeworkSave.ts` (create + draft-upsert + publish)**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { currentAcademicYearActive } from "@/lib/timetableCompat";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkFormData, SaveHomeworkResult } from "@/types/homework";

export function useSaveHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { institutionId } = useEffectiveInstitution();

  return useMutation({
    mutationFn: async ({ formData, publish = false }: { formData: HomeworkFormData; publish?: boolean }): Promise<SaveHomeworkResult> => {
      if (!user?.id) throw new Error("Not authenticated");
      const inst = formData.institutionId ?? institutionId;
      if (!inst) throw new Error("No institution context");

      let homeworkId = formData.homeworkId;

      // Draft upsert: if we already have a draft id, verify it's still a draft.
      if (homeworkId) {
        const { data: existing, error } = await supabase
          .from("homework_assignments").select("id, status").eq("id", homeworkId).single();
        if (error || !existing) { homeworkId = undefined; }
        else if (existing.status !== "draft") { throw new Error("This assignment is locked — create a new one."); }
      }

      const academicYear = await currentAcademicYearActive(inst);
      const row = {
        institution_id: inst,
        created_by: user.id,
        subject_id: formData.subjectId,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        carries_marks: formData.carriesMarks,
        max_marks: formData.carriesMarks ? formData.maxMarks : null,
        attachment_path: formData.attachmentPath,
        attachment_name: formData.attachmentName,
        attachment_mime: formData.attachmentMime,
        visible_from: formData.visibleFrom.toISOString(),
        due_at: formData.dueAt.toISOString(),
        academic_year: academicYear,
      };

      if (homeworkId) {
        const { error } = await supabase.from("homework_assignments").update(row).eq("id", homeworkId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("homework_assignments").insert({ ...row, status: "draft" }).select("id").single();
        if (error) throw error;
        homeworkId = data.id;
      }

      // Junction: delete-then-insert (idempotent for the draft-update path).
      await supabase.from("homework_assignment_classes").delete().eq("homework_assignment_id", homeworkId);
      const uniqueClassIds = [...new Set(formData.classIds)];
      if (uniqueClassIds.length > 0) {
        const links = uniqueClassIds.map((class_id) => ({ homework_assignment_id: homeworkId!, class_id }));
        const { error } = await supabase.from("homework_assignment_classes").insert(links);
        if (error) throw error;
      }

      if (publish) {
        const { error } = await supabase.from("homework_assignments").update({ status: "published" }).eq("id", homeworkId);
        if (error) throw error;
      }

      return { homeworkId: homeworkId!, status: publish ? "published" : "draft" };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success(result.status === "published" ? "Homework published" : "Draft saved");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't save the homework.", context: "saveHomework" }),
  });
}
```

- [ ] **Step 2: `useHomeworkUpdate.ts` (edit a scheduled/draft assignment)**

Same structure but always targets an existing `homeworkId`, accepts `{ homeworkId, formData, publish? }`, does the row UPDATE + junction delete/insert + optional publish. The DB edit-lock trigger rejects content edits once visible; surface that via `toastError` (the Postgres message is already user-friendly: "This assignment is locked for edits…", which `isLikelyUserFriendly` passes through). Invalidate `["homework"]`, `["homework", result.homeworkId]`, `["homework-drafts"]`.

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkFormData, SaveHomeworkResult } from "@/types/homework";

export function useUpdateHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ homeworkId, formData, publish = false }:
      { homeworkId: string; formData: HomeworkFormData; publish?: boolean }): Promise<SaveHomeworkResult> => {
      const { error: upErr } = await supabase.from("homework_assignments").update({
        subject_id: formData.subjectId,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        carries_marks: formData.carriesMarks,
        max_marks: formData.carriesMarks ? formData.maxMarks : null,
        attachment_path: formData.attachmentPath,
        attachment_name: formData.attachmentName,
        attachment_mime: formData.attachmentMime,
        visible_from: formData.visibleFrom.toISOString(),
        due_at: formData.dueAt.toISOString(),
      }).eq("id", homeworkId);
      if (upErr) throw upErr;

      await supabase.from("homework_assignment_classes").delete().eq("homework_assignment_id", homeworkId);
      const uniqueClassIds = [...new Set(formData.classIds)];
      if (uniqueClassIds.length > 0) {
        const { error } = await supabase.from("homework_assignment_classes")
          .insert(uniqueClassIds.map((class_id) => ({ homework_assignment_id: homeworkId, class_id })));
        if (error) throw error;
      }
      if (publish) {
        const { error } = await supabase.from("homework_assignments").update({ status: "published" }).eq("id", homeworkId);
        if (error) throw error;
      }
      return { homeworkId, status: publish ? "published" : "draft" };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["homework"] });
      qc.invalidateQueries({ queryKey: ["homework", r.homeworkId] });
      qc.invalidateQueries({ queryKey: ["homework-drafts"] });
      toast.success(r.status === "published" ? "Homework published" : "Changes saved");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't update the homework.", context: "updateHomework" }),
  });
}
```

- [ ] **Step 3: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/hooks/useHomeworkSave.ts src/hooks/useHomeworkUpdate.ts
git add src/hooks/useHomeworkSave.ts src/hooks/useHomeworkUpdate.ts
git commit -F - <<'EOF'
feat(homework): save + update mutation hooks (§19 toastError, §23.1 auth-from-context)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: List/draft/edit-loader/duplicate/delete data hooks

**Files:** Create `src/hooks/useHomeworkData.ts`

The list query relies on RLS (`can_manage_homework`) to scope rows — no client role branching. Tab → status/due filter. Counts via the batch RPC.

- [ ] **Step 1: Write the hooks**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";
import type { HomeworkListRow, HomeworkFormData } from "@/types/homework";

export type HomeworkTab = "scheduled" | "submitted" | "checked";

const SELECT = `
  id, title, status, carries_marks, max_marks, visible_from, due_at, checked_at,
  subject:subject_id ( id, name ),
  homework_assignment_classes ( class_id, classes ( id, name, section ) )
` as const;

interface RawRow {
  id: string; title: string; status: "draft"|"published"|"checked";
  carries_marks: boolean; max_marks: number | null;
  visible_from: string; due_at: string; checked_at: string | null;
  subject: { id: string; name: string } | { id: string; name: string }[] | null;
  homework_assignment_classes: { class_id: string; classes: { id: string; name: string; section: string | null } | { id: string; name: string; section: string | null }[] | null }[];
}
function pickOne<T>(v: T | T[] | null): T | null { return Array.isArray(v) ? (v[0] ?? null) : v; }

function mapRow(r: RawRow): HomeworkListRow {
  return {
    id: r.id, title: r.title, status: r.status, carries_marks: r.carries_marks,
    max_marks: r.max_marks, visible_from: r.visible_from, due_at: r.due_at, checked_at: r.checked_at,
    subject: pickOne(r.subject),
    classes: (r.homework_assignment_classes ?? [])
      .map((j) => pickOne(j.classes)).filter((c): c is { id: string; name: string; section: string | null } => !!c),
  };
}

/** Tab list. RLS scopes rows to manageable ones; we filter by status/due_at. */
export function useHomeworkList(tab: HomeworkTab, opts?: { page?: number; pageSize?: number }) {
  const page = opts?.page ?? 0;
  const size = opts?.pageSize ?? 50;
  return useQuery({
    queryKey: ["homework", "list", tab, page, size],
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkListRow[]> => {
      const nowIso = new Date().toISOString();
      let q = supabase.from("homework_assignments").select(SELECT).range(page * size, page * size + size - 1);
      if (tab === "checked") q = q.eq("status", "checked").order("checked_at", { ascending: false });
      else { q = q.eq("status", "published");
        q = tab === "scheduled" ? q.gt("due_at", nowIso).order("due_at", { ascending: true })
                                : q.lte("due_at", nowIso).order("due_at", { ascending: false }); }
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as RawRow[]).map(mapRow);
    },
  });
}

export function useHomeworkCounts(ids: string[]) {
  return useQuery({
    queryKey: ["homework", "counts", [...ids].sort()],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("homework_list_counts", { _homework_ids: ids });
      if (error) throw error;
      const m = new Map<string, { submitted: number; graded: number; total: number }>();
      (data ?? []).forEach((r) => m.set(r.homework_assignment_id, {
        submitted: r.submitted_count, graded: r.graded_count, total: r.total_students,
      }));
      return m;
    },
  });
}

export function useHomeworkDrafts() {
  return useQuery({
    queryKey: ["homework-drafts"],
    staleTime: 60_000,
    queryFn: async (): Promise<HomeworkListRow[]> => {
      const { data, error } = await supabase.from("homework_assignments").select(SELECT)
        .eq("status", "draft").order("updated_at", { ascending: false }).range(0, 49);
      if (error) throw error;
      return (data as unknown as RawRow[]).map(mapRow);
    },
  });
}

/** Edit-mode loader: returns a fully-shaped HomeworkFormData. */
export function useHomeworkForEdit(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "edit"],
    enabled: !!homeworkId,
    staleTime: 30_000,
    queryFn: async (): Promise<HomeworkFormData> => {
      const { data, error } = await supabase.from("homework_assignments")
        .select(`id, institution_id, title, description, subject_id, carries_marks, max_marks,
                 visible_from, due_at, attachment_path, attachment_name, attachment_mime,
                 homework_assignment_classes ( class_id )`)
        .eq("id", homeworkId!).single();
      if (error) throw error;
      return {
        homeworkId: data.id, institutionId: data.institution_id,
        title: data.title, description: data.description ?? "",
        subjectId: data.subject_id, classIds: (data.homework_assignment_classes ?? []).map((c) => c.class_id),
        carriesMarks: data.carries_marks, maxMarks: data.max_marks,
        visibleFrom: new Date(data.visible_from), dueAt: new Date(data.due_at),
        attachmentPath: data.attachment_path, attachmentName: data.attachment_name, attachmentMime: data.attachment_mime,
      };
    },
  });
}

export function useDuplicateHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sourceId: string): Promise<string> => {
      // Load source, create a new DRAFT copy + class links. Returns new id.
      const src = await supabase.from("homework_assignments")
        .select(`institution_id, subject_id, title, description, carries_marks, max_marks,
                 visible_from, due_at, academic_year, homework_assignment_classes ( class_id )`)
        .eq("id", sourceId).single();
      if (src.error) throw src.error;
      const s = src.data;
      const { data: created, error } = await supabase.from("homework_assignments").insert({
        institution_id: s.institution_id, subject_id: s.subject_id,
        title: `${s.title} (copy)`, description: s.description,
        carries_marks: s.carries_marks, max_marks: s.max_marks,
        visible_from: s.visible_from, due_at: s.due_at, academic_year: s.academic_year,
        status: "draft",
        // created_by is set by RLS WITH CHECK to auth.uid(); set explicitly:
        created_by: (await supabase.auth.getSession()).data.session?.user.id,
      }).select("id").single();
      if (error) throw error;
      const links = (s.homework_assignment_classes ?? []).map((c) => ({ homework_assignment_id: created.id, class_id: c.class_id }));
      if (links.length) { const { error: lErr } = await supabase.from("homework_assignment_classes").insert(links); if (lErr) throw lErr; }
      return created.id;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["homework"] }); qc.invalidateQueries({ queryKey: ["homework-drafts"] }); },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't duplicate the homework.", context: "duplicateHomework" }),
  });
}

export function useDeleteHomeworkDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("homework_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["homework-drafts"] }); toast.success("Draft deleted"); },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't delete the draft.", context: "deleteHomeworkDraft" }),
  });
}
```

> **Implementer notes:** (1) `getSession()` for the duplicate `created_by` is the §23.1-compliant local read (no network) — acceptable; alternatively thread the user id from `useAuth` by converting `useDuplicateHomework` to read it (preferred — refactor to take `user.id` from `useAuth()` inside the hook). (2) If `supabase.rpc("homework_list_counts", …)` isn't typed after Task 2's regen, STOP — the regen didn't capture the function; do not cast to `any`. (3) Keep the PostgREST `subject:subject_id(...)` alias — the FK resolves to `universal_subjects`.

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/hooks/useHomeworkData.ts
git add src/hooks/useHomeworkData.ts
git commit -F - <<'EOF'
feat(homework): list/drafts/edit-loader/duplicate/delete data hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: HomeworkCreationFlow (single-screen form) + wrapper pages

**Files:** Create `src/components/homework-creation/HomeworkCreationFlow.tsx`, `src/pages/CreateHomework.tsx`, `src/pages/EditHomework.tsx`

- [ ] **Step 1: Wrapper pages** (mirror CreateExam/EditExam)

`src/pages/CreateHomework.tsx`:
```tsx
import { HomeworkCreationFlow } from "@/components/homework-creation/HomeworkCreationFlow";
export default function CreateHomework() { return <HomeworkCreationFlow mode="create" />; }
```
`src/pages/EditHomework.tsx`:
```tsx
import { useParams } from "react-router-dom";
import { HomeworkCreationFlow } from "@/components/homework-creation/HomeworkCreationFlow";
export default function EditHomework() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return <HomeworkCreationFlow mode="edit" homeworkId={id} />;
}
```

- [ ] **Step 2: HomeworkCreationFlow — component spec (build per §20a/§20b)**

Props: `{ mode: "create" | "edit"; homeworkId?: string }`. Structure:
- Wrap in `<PageShell>`; `<PageHeader title={mode === "edit" ? "Edit homework" : "Create homework & assignment"} subtitle=... />`.
- Local state `const [form, setForm] = useState<HomeworkFormData>(emptyHomeworkForm(institutionId))`. `institutionId` from `useEffectiveInstitution()`; seed into `form.institutionId` in a `useEffect` when it resolves (like the exam flow).
- Edit mode: `const loaded = useHomeworkForEdit(homeworkId)`; in a `useEffect`, when `mode==="edit" && loaded.data && !hydrated`, `setForm(loaded.data); setHydrated(true)`.
- **Edit-lock guard:** in edit mode, if the loaded assignment is locked (`status !== "draft" && new Date(visible_from) <= now`), render a read-only `EmptyState` ("This assignment is locked" — visible to students; edits disabled) instead of the form. (Compute from a `status`+`visible_from` fetch; reuse `useHomeworkForEdit` extended to include `status`, or a tiny extra select.)
- Fields (all shadcn; `Label` + control; no raw HTML):
  - **Title** — `Input`.
  - **Subject** — `Select` (single) populated from `useHomeworkScope(form.classIds).subjects`. Required.
  - **Class(es)** — multi-select via a `Popover` + checkbox list (mirror `ExamDetailsScreen`'s multi-select), options from `useHomeworkScope(form.classIds).classes`, label via `formatClassName(name, section)` from `@/lib/utils`. Required (≥1).
  - **Description / instructions** — `Textarea`.
  - **Carries marks** — `Switch` + `Label`; when on, show **Max marks** `Input type="number"` (required > 0).
  - **Visible from** — date+time: `Popover` + shadcn `Calendar` for the date + a shadcn `Input type="time"` for the time (the iOS fix is global in `src/index.css`). Default now.
  - **Due at** — same date+time control. Required, must be after visible-from (validate client-side; the DB CHECK also enforces).
  - **Attachment (optional)** — a single file input that uploads via `storageUpload.ts` to the `homework-files` bucket at path `${institutionId}/attachments/${crypto.randomUUID()}/${file.name}` and sets `attachmentPath/Name/Mime` in form. Reject video/audio (reuse the allowlist — see Phase 3's `validateFileUpload`; for Phase 2 inline a minimal allowlist check). Upload is optional; a missing attachment is fine.
- Footer (sticky, `[data-sticky-bottom]`): **Save as Draft** (`publish:false`) and **Publish** buttons. Disable while pending. Validation before publish: title non-empty, subjectId set, ≥1 class, dueAt > visibleFrom, and if carriesMarks then maxMarks > 0 — otherwise show an inline message and block.
- Wiring: `const save = useSaveHomework(); const update = useUpdateHomework();`
  - create mode → `save.mutate({ formData: form, publish })`; on draft success set `form.homeworkId = result.homeworkId` (so re-saves upsert); on publish success `navigate("/homework")`.
  - edit mode → `update.mutate({ homeworkId, formData: form, publish })`; on publish success `navigate("/homework")`.
- Set `data-dirty="true"` on the form wrapper when the user has edited (SW dirty-form contract, §17).

> Reference the verbatim primitive prop interfaces in the plan header / recon (PageHeader, MobileSheet not needed here — this is a full page, not a sheet). Use `Popover`+`Calendar` from `@/components/ui/*`. Mirror the multi-select + date-picker idioms already used in `src/components/exam-creation/screens/ExamDetailsScreen.tsx` (read it).

- [ ] **Step 3: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/components/homework-creation/HomeworkCreationFlow.tsx src/pages/CreateHomework.tsx src/pages/EditHomework.tsx
npx vite build
git add src/components/homework-creation/ src/pages/CreateHomework.tsx src/pages/EditHomework.tsx
git commit -F - <<'EOF'
feat(homework): single-screen create/edit flow + wrapper pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: HomeworkPage — 3-tab list + drafts strip + filters

**Files:** Create `src/pages/HomeworkPage.tsx`

- [ ] **Step 1: Component spec (mirror `ExamsPage`)**

- `<PageShell fab={<MobileFab label="Create" icon={<Plus/>} onClick={() => navigate("/homework/create")} />}>`.
- `<PageHeader title="Homework & Assignment" subtitle="Create, schedule, and grade homework" primaryAction={{ label: "Create", icon: <Plus/>, onClick: () => navigate("/homework/create") }} />`.
- Drafts strip (reuse ExamsPage lines 337–361 pattern): show count of `useHomeworkDrafts()`; expand to a list of draft `ListRow`s with Continue (`/homework/edit/:id`) / Duplicate (`useDuplicateHomework`) / Delete (`useDeleteHomeworkDraft`, with an `AlertDialog` confirm).
- `<MobileTabs value={tab} onValueChange={setTab} options={[{value:"scheduled",label:"Scheduled",count},{value:"submitted",label:"Submitted",count},{value:"checked",label:"Checked",count}]} />`. Persist `tab` in `useSearchParams` (`?tab=`).
- Filters via `<FilterRow>` (class + subject) and, since status(marked/unmarked for Submitted) + date-range push to ≥3, a `<FilterSheet>` for the rest. Compute `activeFilterCount`.
- Body: `const { data: rows = [], isLoading } = useHomeworkList(tab)`. Then `const ids = rows.map(r=>r.id); const { data: counts } = useHomeworkCounts(ids)`. Merge counts into rows for display ("submitted/total"; for Submitted tab also "graded/submitted").
- Apply client-side class/subject/date filters to `rows` (the heavy scoping is already done by RLS + the tab query; these are light in-memory refinements on the current page).
- Each row → `<ListRow>` (leading icon disc, title + `HomeworkStatusBadge`, subtitle = `subject · classes`, trailing = count text like `23/45` + a `DropdownMenu` with Open (Phase 4 — for now route to a placeholder or disable)/Edit (only if draft or scheduled-future)/Duplicate). For Phase 2, the row click + "Open" can navigate to `/homework/edit/:id` for editable ones; the marking detail page is Phase 4, so "Open to mark" is added then.
- `isLoading` → skeletons; empty → `<EmptyState icon={<ClipboardList/>} title=... description=... tone="teal" action={{label:"Create homework", onClick: ...}} />` (per-tab copy).
- `statusAccent`/`HomeworkStatusBadge`: a local helper mapping `scheduled→sky, submitted→amber, checked→emerald, draft→slate` (mirror ExamsPage `statusAccent`/`ExamStatusBadge`). Use Tone-token classes, not raw colors where a tile is involved; the small status badge may use the existing badge color-map idiom (acceptable, matches ExamStatusBadge).

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit
npx eslint src/pages/HomeworkPage.tsx
npx vite build
git add src/pages/HomeworkPage.tsx
git commit -F - <<'EOF'
feat(homework): 3-tab list (scheduled/submitted/checked) + drafts strip + filters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Routes + sidebar nav + dashboard tiles

**Files:** Modify `src/App.tsx`, `src/components/layout/AppSidebar.tsx`, dashboard components

- [ ] **Step 1: Routes in `src/App.tsx`**

Add lazy imports next to the other page imports:
```tsx
const HomeworkPage = lazy(() => import("./pages/HomeworkPage"));
const CreateHomework = lazy(() => import("./pages/CreateHomework"));
const EditHomework = lazy(() => import("./pages/EditHomework"));
```
Add routes immediately after the `/exams/edit/:id` route (around line 246), mirroring exactly:
```tsx
<Route path="/homework" element={
  <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
    <HomeworkPage />
  </ProtectedRoute>
} />
<Route path="/homework/create" element={
  <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
    <CreateHomework />
  </ProtectedRoute>
} />
<Route path="/homework/edit/:id" element={
  <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
    <EditHomework />
  </ProtectedRoute>
} />
```
(`/homework` + `/homework/create` are already in `FEATURE_URL_MAP` → `homework`, so `ProtectedRoute` auto-gates them.)

- [ ] **Step 2: Sidebar entries in `src/components/layout/AppSidebar.tsx`**

Read the file. In the TEACHER group (the "Exams" group, right after the existing `{ title: "Create Exam", url: "/exams/create", icon: Plus }`) add:
```tsx
{ title: "Create Homework & Assignment", url: "/homework", icon: ClipboardList },
```
Do the same in the COORDINATOR group (right after its "Create Exam" entry) and add an equivalent entry to the SCHOOL-ADMIN group's academic section. Ensure `ClipboardList` is imported from `lucide-react` (add to the existing import if absent). Do NOT add a student entry (Phase 3).

- [ ] **Step 3: Dashboard tile**

In the teacher dashboard nav groups (`src/components/dashboards/RoleBasedDashboard.tsx`) and `CoordinatorDashboard.tsx` (+ school-admin command center if it lists create-actions), add a `FeatureTile`/nav entry:
```tsx
<FeatureTile to="/homework" icon={<ClipboardList className="h-5 w-5" />} title="Homework & Assignment" description="Create and grade homework" tone="teal" />
```
Wrap in `{isFeatureEnabled("homework") && ( … )}` only if the surrounding tiles use that guard; otherwise rely on the route/sidebar gate (match the file's existing convention for tiles whose URL is in `FEATURE_URL_MAP`).

- [ ] **Step 4: Verify gating sync + build (§5a)**
```bash
npx tsc --noEmit
npx eslint src/App.tsx src/components/layout/AppSidebar.tsx src/components/dashboards/RoleBasedDashboard.tsx src/components/dashboards/CoordinatorDashboard.tsx
npx vite build
```
Expected: all exit 0. Manually confirm the ui-invariants sync: `/homework` appears in sidebar (teacher/coordinator/admin) AND a dashboard tile AND is gated by `FEATURE_URL_MAP` (already mapped) — disabling the `homework` feature must hide all three.

- [ ] **Step 5: Commit**
```bash
git add src/App.tsx src/components/layout/AppSidebar.tsx src/components/dashboards/
git commit -F - <<'EOF'
feat(homework): routes + sidebar + dashboard tiles (gating in sync)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 10: Phase verification

- [ ] **Step 1: Full clean build (§5a)**
```bash
npx tsc --noEmit          # exit 0
npx eslint src/pages/HomeworkPage.tsx src/pages/CreateHomework.tsx src/pages/EditHomework.tsx src/components/homework-creation/HomeworkCreationFlow.tsx src/hooks/useHomeworkSave.ts src/hooks/useHomeworkUpdate.ts src/hooks/useHomeworkData.ts src/hooks/useHomeworkScope.ts src/types/homework.ts   # 0 errors
npx vite build            # exit 0
```

- [ ] **Step 2: Manual smoke (dev server)** — `npm run dev`, log in as a teacher:
  - `/homework` loads; 3 tabs render; empty states show; FAB + Create button route to `/homework/create`.
  - Create form: subject + class options are scoped to the teacher's assignments; date/time pickers work; "Save as Draft" creates a draft (appears in Drafts strip); re-saving the same draft does NOT create a duplicate.
  - Publish with visible-from = now → assignment appears in **Scheduled**; editing it is blocked (locked) — the edit page shows the locked state.
  - Publish with a FUTURE visible-from → still editable until that time.
  - Duplicate a draft → opens a new `(copy)` draft.
  - At 375px: no horizontal scroll, tabs scroll-snap, cards float; toggle dark mode → backdrop/cards/text flip.

- [ ] **Step 3: Push? (ask) / finalize**

Branch stays local unless the user says otherwise (Phase 1 choice). Report completion with the commit list and the smoke results.

---

## Self-review (run before handoff)

**Spec coverage (spec §6.1/§6.2/§12 → task):** create/edit flow → Task 7; draft-upsert + publish → Task 5; edit-lock → Task 7 guard + DB trigger; duplicate → Task 6/8; 3-tab list + drafts + filters → Task 8; submission counts → Task 2+6; subject/class scoping → Task 4; nav + routes + gating → Task 9; types → Task 1.
**Deferred (not gaps):** student surfaces (Phase 3), marking detail/"Open to mark" (Phase 4), notifications (Phase 6), analytics (Phase 7).
**Placeholder scan:** none — hooks/migration/routes/types have full code; the two large pages (Tasks 7/8) are detailed specs with exact imports, prop APIs, data wiring, and a named reference implementation (`ExamsPage`/`ExamDetailsScreen`) the implementer reads — acceptable for big JSX under subagent execution + two-stage review.
**Type consistency:** `HomeworkFormData`/`SaveHomeworkResult`/`HomeworkListRow`/`HomeworkTab` defined in Task 3 and used identically in Tasks 5/6/7/8. Query keys: `["homework", ...]` family invalidated by the mutations. RPC name `homework_list_counts` matches Task 2.
**Compliance:** §19 toastError, §23.1 auth-from-context (no `getUser()`), §23.2 explicit staleTime, §23 pagination + explicit columns, §20a/§20b primitives, no `any`.
