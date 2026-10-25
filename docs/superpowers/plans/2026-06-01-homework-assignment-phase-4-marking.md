# Homework & Assignment — Phase 4 (Teacher Marking Workspace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A manager (teacher/coordinator/admin) opens a published or checked assignment and sees the **Submitted** list (each student's files + a marks input *or* feedback textarea + a Skip option, late submitters flagged) and a **Not-Submitted** list (name + roll number). A running counter ("12 of 45 submitted · 8 marked · 4 pending"). A **Publish Marks** / **Mark as Checked** button (label depends on `carries_marks`) **disabled until every submitter is processed** (graded or skipped); publishing flips the assignment to `checked` (students see results instantly) and moves it to the Checked tab. On the Checked tab the same page allows **inline edits** of any mark/feedback (saved immediately, audit-logged via the Phase-1 trigger).

**Architecture:** Two SECURITY DEFINER RPCs (server-side, `can_manage_homework`-gated): `homework_marking_roster(_homework_id)` returns the full per-student roster (submitted + not-submitted, with submission + result fields) in one §23-compliant call; `homework_publish_marks(_homework_id)` verifies **every** submission has a `graded`/`skipped` result, then atomically sets `status='checked', evaluated_by=auth.uid(), checked_at=now()` (raises with a clear message otherwise). Per-student marks/feedback/skip is a direct RLS-gated `homework_results` upsert (manager policy from Phase 1; the `homework_results` AFTER-trigger logs who/old/new automatically). Submission files are read via the Phase-3 `homework-file-url` edge fn (the `can_manage` branch) feeding the shared `SubmissionFileViewer`. The marking page lives at `/homework/:id` (managers); `HomeworkPage` rows route published/checked assignments there.

**Tech Stack:** Supabase plpgsql RPCs, React 18 + TS, TanStack Query. Verify: `tsc`/`eslint`/`vite build`; RPC migration applied via `supabase db push`.

**Branch:** `homework/phase-4-marking` (off `homework/phase-3-submit @ 1990735`, verified). **Spec:** §6.4.

---

## Compliance guardrails
§19 `toastError`; §23.1 client auth from `useAuth` (RPCs use `auth.uid()` server-side — correct); §23.2 explicit `staleTime`; §20a/§20b primitives + shadcn-only inputs; no `<AppLayout>`; no `any`/suppressions.

---

## File structure
**Create (migration):** `supabase/migrations/20260601094000_homework_marking_rpcs.sql` — roster + publish RPCs.
**Create (hooks):** `src/hooks/useHomeworkMarking.ts` — `useHomeworkMarkingAssignment(id)`, `useHomeworkMarkingRoster(id)`, `useHomeworkSubmissionFiles(submissionIds)`, `useUpsertHomeworkResult()`, `usePublishHomeworkMarks()`.
**Create (page):** `src/pages/HomeworkMarkingPage.tsx`.
**Modify:** `src/integrations/supabase/types.ts` (regen for the 2 RPCs); `src/App.tsx` (lazy + `/homework/:id` route); `src/pages/HomeworkPage.tsx` (route published/checked rows to the marking page).
**Reuse (Phase 3, unchanged):** `homework-file-url` edge fn, `SubmissionFileViewer`, `useHomeworkFileUrl`.

**Out of scope:** notifications (Phase 6), analytics (Phase 7).

---

## Task 1: Marking RPCs (migration)

**Files:** Create `supabase/migrations/20260601094000_homework_marking_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- Homework & Assignment — Phase 4: marking roster + publish RPCs
-- Both SECURITY DEFINER + can_manage_homework-gated (§23 server-side).
-- =====================================================================

-- Full per-student roster for the marking page (submitted + not-submitted),
-- with each student's submission + result fields. One row per student.
CREATE OR REPLACE FUNCTION public.homework_marking_roster(_homework_id uuid)
RETURNS TABLE (
  student_id     uuid,
  full_name      text,
  roll_number    text,
  class_id       uuid,
  class_name     text,
  class_section  text,
  submission_id  uuid,
  submitted_at   timestamptz,
  is_late        boolean,
  result_status  text,
  marks_awarded  numeric,
  feedback       text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_homework(auth.uid(), _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ca.user_id)
    ca.user_id                         AS student_id,
    p.full_name,
    p.roll_number,
    c.id                               AS class_id,
    c.name                             AS class_name,
    c.section                          AS class_section,
    s.id                               AS submission_id,
    s.submitted_at,
    COALESCE(s.is_late, false)         AS is_late,
    r.status                           AS result_status,
    r.marks_awarded,
    r.feedback
  FROM public.homework_assignment_classes hac
  JOIN public.class_assignments ca ON ca.class_id = hac.class_id AND ca.role = 'student'
  JOIN public.profiles p ON p.id = ca.user_id
  JOIN public.classes  c ON c.id = hac.class_id
  LEFT JOIN public.homework_submissions s
    ON s.homework_assignment_id = _homework_id AND s.student_id = ca.user_id
  LEFT JOIN public.homework_results r ON r.submission_id = s.id
  WHERE hac.homework_assignment_id = _homework_id
  ORDER BY ca.user_id, s.submitted_at NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.homework_marking_roster(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_marking_roster(uuid) TO authenticated;

-- Publish gate: only flip to 'checked' when EVERY submission has a
-- graded/skipped result. Sets evaluated_by + checked_at.
CREATE OR REPLACE FUNCTION public.homework_publish_marks(_homework_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_status       text;
  v_unprocessed  integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF NOT public.can_manage_homework(v_uid, _homework_id) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT status INTO v_status FROM public.homework_assignments WHERE id = _homework_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF v_status = 'draft' THEN RAISE EXCEPTION 'Publish the assignment before marking.'; END IF;

  SELECT count(*) INTO v_unprocessed
  FROM public.homework_submissions s
  LEFT JOIN public.homework_results r ON r.submission_id = s.id
  WHERE s.homework_assignment_id = _homework_id
    AND (r.id IS NULL OR r.status NOT IN ('graded','skipped'));

  IF v_unprocessed > 0 THEN
    RAISE EXCEPTION '% submission(s) not yet marked.', v_unprocessed;
  END IF;

  UPDATE public.homework_assignments
    SET status = 'checked', evaluated_by = v_uid, checked_at = now()
    WHERE id = _homework_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.homework_publish_marks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.homework_publish_marks(uuid) TO authenticated;
```

- [ ] **Step 2: Confirm timestamp sorts last** (`20260601094000` > `…093000`) via the PowerShell sort check; bump if needed.
- [ ] **Step 3: Dry-run + apply to prod**
```bash
npx supabase db push --linked --dry-run   # "Would push" = ONLY 20260601094000_homework_marking_rpcs.sql
npx supabase db push --linked --yes
```
- [ ] **Step 4: Regen types + verify**
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
grep -c "homework_marking_roster" src/integrations/supabase/types.ts   # >= 1
grep -c "homework_publish_marks" src/integrations/supabase/types.ts    # >= 1
npx tsc --noEmit   # 0
```
- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260601094000_homework_marking_rpcs.sql src/integrations/supabase/types.ts
git commit -F - <<'EOF'
feat(homework): marking roster + publish-gate RPCs (applied to prod) + regen types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Marking hooks

**Files:** Create `src/hooks/useHomeworkMarking.ts`

- [ ] **Step 1: Write the hooks**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export interface MarkingRosterRow {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_id: string;
  class_name: string;
  class_section: string | null;
  submission_id: string | null;
  submitted_at: string | null;
  is_late: boolean;
  result_status: "pending" | "graded" | "skipped" | null;
  marks_awarded: number | null;
  feedback: string | null;
}

export interface MarkingAssignment {
  id: string; title: string; status: "draft" | "published" | "checked";
  carries_marks: boolean; max_marks: number | null; due_at: string; checked_at: string | null;
  subject: { id: string; name: string } | null;
  classes: { id: string; name: string; section: string | null }[];
}

function pickOne<T>(v: T | T[] | null): T | null { return Array.isArray(v) ? (v[0] ?? null) : v; }

/** The assignment header (managers SELECT via RLS can_manage). */
export function useHomeworkMarkingAssignment(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "marking-assignment"],
    enabled: !!homeworkId,
    staleTime: 60_000,
    queryFn: async (): Promise<MarkingAssignment | null> => {
      const { data, error } = await supabase
        .from("homework_assignments")
        .select(`id, title, status, carries_marks, max_marks, due_at, checked_at,
                 subject:subject_id ( id, name ),
                 homework_assignment_classes ( classes ( id, name, section ) )`)
        .eq("id", homeworkId!).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as unknown as Record<string, unknown>;
      return {
        id: r.id as string, title: r.title as string, status: r.status as MarkingAssignment["status"],
        carries_marks: r.carries_marks as boolean, max_marks: (r.max_marks as number) ?? null,
        due_at: r.due_at as string, checked_at: (r.checked_at as string) ?? null,
        subject: pickOne(r.subject as never),
        classes: (((r.homework_assignment_classes as Array<{ classes: unknown }>) ?? [])
          .map((j) => pickOne(j.classes as never))
          .filter(Boolean)) as { id: string; name: string; section: string | null }[],
      };
    },
  });
}

/** Full roster (submitted + not-submitted) via the SECURITY DEFINER RPC. */
export function useHomeworkMarkingRoster(homeworkId: string | undefined) {
  return useQuery({
    queryKey: ["homework", homeworkId, "roster"],
    enabled: !!homeworkId,
    staleTime: 30_000,
    queryFn: async (): Promise<MarkingRosterRow[]> => {
      const { data, error } = await supabase.rpc("homework_marking_roster", { _homework_id: homeworkId! });
      if (error) throw error;
      return (data ?? []) as MarkingRosterRow[];
    },
  });
}

/** Submission files for the page's submitters (managers SELECT via RLS). */
export function useHomeworkSubmissionFiles(submissionIds: string[]) {
  return useQuery({
    queryKey: ["homework", "submission-files", [...submissionIds].sort()],
    enabled: submissionIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_submission_files")
        .select("id, submission_id, file_name, file_mime, storage_path")
        .in("submission_id", submissionIds);
      if (error) throw error;
      const map = new Map<string, { id: string; name: string; mime: string; storagePath: string }[]>();
      (data ?? []).forEach((f) => {
        const arr = map.get(f.submission_id) ?? [];
        arr.push({ id: f.id, name: f.file_name, mime: f.file_mime, storagePath: f.storage_path });
        map.set(f.submission_id, arr);
      });
      return map;
    },
  });
}

/** Upsert one result (mark / feedback / skip). Audit trigger logs who/old/new. */
export function useUpsertHomeworkResult() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (arg: {
      homeworkId: string; submissionId: string; studentId: string;
      marksAwarded?: number | null; feedback?: string | null; status: "graded" | "skipped";
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase.from("homework_results").upsert({
        submission_id: arg.submissionId,
        homework_assignment_id: arg.homeworkId,
        student_id: arg.studentId,
        marks_awarded: arg.status === "skipped" ? null : (arg.marksAwarded ?? null),
        feedback: arg.feedback ?? null,
        status: arg.status,
        evaluated_by: user.id,
        evaluated_at: new Date().toISOString(),
      }, { onConflict: "submission_id" });
      if (error) throw error;
    },
    onSuccess: (_d, arg) => {
      qc.invalidateQueries({ queryKey: ["homework", arg.homeworkId, "roster"] });
      qc.invalidateQueries({ queryKey: ["homework"] }); // refresh list counts
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't save the mark.", context: "upsertHomeworkResult" }),
  });
}

/** Publish marks / mark-as-checked (gated server-side). */
export function usePublishHomeworkMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (homeworkId: string) => {
      const { error } = await supabase.rpc("homework_publish_marks", { _homework_id: homeworkId });
      if (error) throw error;
    },
    onSuccess: (_d, homeworkId) => {
      qc.invalidateQueries({ queryKey: ["homework", homeworkId] });
      qc.invalidateQueries({ queryKey: ["homework"] });
      toast.success("Published — students can now see their results");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't publish. Make sure every submission is marked.", context: "publishHomeworkMarks" }),
  });
}
```

> The RPC raises a friendly message (e.g. "3 submission(s) not yet marked.") that `toastError` passes through. No `any`; use the inline `pickOne` + `Record<string, unknown>` bridge for the assignment join.

- [ ] **Step 2: Verify + commit** (`tsc`/`eslint` clean) → `feat(homework): marking hooks (roster, files, result upsert, publish)`.

---

## Task 3: `HomeworkMarkingPage`

**Files:** Create `src/pages/HomeworkMarkingPage.tsx`

- [ ] **Step 1: Build it** (reference `OfflineMarksEntry` for per-row commit + gated footer; `StudentHomeworkDetailPage` for `SubmissionFileViewer` wiring)

- Route param `:id`. `const asn = useHomeworkMarkingAssignment(id); const roster = useHomeworkMarkingRoster(id);`. Loading → skeleton; `!asn.data` → `EmptyState` "Not available".
- `<PageShell>` + `<PageHeader title={asn.title} subtitle={\`${subject} · ${classes} · due ${date} · ${status}\`} />`.
- Derive: `submitted = roster.filter(r => r.submission_id)`, `notSubmitted = roster.filter(r => !r.submission_id)`. `processed = submitted.filter(r => r.result_status === 'graded' || r.result_status === 'skipped')`.
- **Counter** (StatTile row or a summary line): "`{submitted.length} of {roster.length} submitted · {processed.length} marked · {submitted.length - processed.length} pending`".
- Files: `const fileMap = useHomeworkSubmissionFiles(submitted.map(r => r.submission_id!).filter(Boolean))`. `const fileUrl = useHomeworkFileUrl();` and a stable `getUrl = useCallback((f) => fileUrl.mutateAsync({ submission_file_id: f.id }), [fileUrl])`.
- **Submitted section** — one card per submitter (`ListRow`-style / Card): name + roll_number + "Submitted {date}" + "Submitted late" badge if `is_late`; `<SubmissionFileViewer files={fileMap.get(submission_id) ?? []} getUrl={getUrl} />`; then:
  - **carries_marks**: a marks `Input type="number"` (min 0, max `asn.max_marks`, step 0.5), seeded from `marks_awarded`, commit on blur/Enter → `useUpsertHomeworkResult().mutate({ ..., status: "graded", marksAwarded })`. Invalid (>max or <0) shows inline error + blocks save.
  - **!carries_marks**: a feedback `Textarea`, seeded from `feedback`, commit on blur → upsert `{ status: "graded", feedback }`.
  - **Skip** button → upsert `{ status: "skipped" }` (clears marks/feedback). A skipped row shows a "Skipped" pill.
  - Per-row status pill: Pending / Saved / Skipped (mirror `OfflineMarksEntry`'s `RowStatus`).
  - Manage local draft state seeded from the roster (like `HybridEvaluatePage`'s `drafts`), commit-on-blur (not debounced-per-keystroke — explicit blur/Enter is simpler + matches OfflineMarksEntry).
- **Not-Submitted section** — a simple list of name + roll_number (no actions). Header "Not submitted ({n})".
- **Footer** (sticky, `data-sticky-bottom`): the counter + a button:
  - When `asn.status === 'published'`: button labeled **"Publish Marks"** (carries_marks) / **"Mark as Checked"** (no-marks). `disabled` when `processed.length < submitted.length` (show the message "`{submitted.length - processed.length} of {submitted.length} submissions not yet marked`"). On click → `usePublishHomeworkMarks().mutate(id)`. Use the dual-confirm idiom (click → "Confirm?", click again → fire) OR a `MobileSheet` confirm.
  - When `asn.status === 'checked'`: no publish button — show "Checked on {checked_at}" + a note that edits save immediately. Inputs remain editable (inline-edit → upsert → audit). This satisfies "stays editable forever."
- **Checked-tab inline edit**: identical row inputs; each blur commit upserts (the Phase-1 trigger logs the change). No re-publish.

- [ ] **Step 2: Verify + commit** (`tsc`/`eslint`/`vite build` clean) → `feat(homework): teacher marking page (submitted/not-submitted, per-student mark/feedback/skip, publish gate, checked inline-edit)`.

---

## Task 4: Route + HomeworkPage wiring

**Files:** Modify `src/App.tsx`, `src/pages/HomeworkPage.tsx`

- [ ] **Step 1: `src/App.tsx`** — lazy import + route AFTER `/homework/edit/:id` (static `/create` + `/edit` rank above dynamic `/:id`, so no conflict):
```tsx
const HomeworkMarkingPage = lazy(() => import("./pages/HomeworkMarkingPage"));
```
```tsx
<Route path="/homework/:id" element={
  <ProtectedRoute allowedRoles={["teacher", "coordinator", "school_admin", "super_school_admin", "super_admin"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <HomeworkMarkingPage />
    </Suspense>
  </ProtectedRoute>
} />
```

- [ ] **Step 2: `src/pages/HomeworkPage.tsx`** — route published/checked rows to the marking page.
  - Update `handleRowClick`: `if (isEditable(row)) navigate(\`/homework/edit/${row.id}\`); else if (row.status === "published" || row.status === "checked") navigate(\`/homework/${row.id}\`);` and set the row `onClick` to fire for those statuses too (not just editable).
  - Add a DropdownMenu item (after Edit, before Duplicate) shown when `!editable && (row.status === "published" || row.status === "checked")`: `<DropdownMenuItem onClick={() => navigate(\`/homework/${row.id}\`)}>Open to mark</DropdownMenuItem>`.

- [ ] **Step 3: Verify + commit** (`tsc`/`eslint`/`vite build` clean) → `feat(homework): route + list wiring for the marking page`.

---

## Task 5: Phase verification

- [ ] `npx tsc --noEmit` 0 · `npx eslint` on all new/changed files 0 · `npx vite build` 0 (marking page chunk emits).
- [ ] **Manual smoke (user step):** as a teacher, open a Submitted assignment → see submitters with files + Not-Submitted list + counter; enter marks for some, Skip one, leave one → Publish disabled with "1 of N not yet marked"; finish all → Publish enabled → publish → moves to Checked tab; student sees marks. On the Checked tab, edit a mark → saves immediately (audit logged). Coordinator/admin can do the same for in-scope assignments. 375px + dark mode.

---

## Self-review
**Spec §6.4 coverage:** header → Task 3; Submitted list (files + mark/feedback + skip + late badge) → Task 3 + roster RPC; Not-Submitted (name + roll) → roster RPC; counter → Task 3; publish gate (all processed) → `homework_publish_marks` RPC (server-enforced) + client disable; move to Checked + students see instantly → RPC sets `checked` + RLS reveals results; Checked inline-edit + audit → Task 3 inputs + Phase-1 trigger; `evaluated_by` → RPC. Coordinator/admin scope → `can_manage_homework` in both RPCs + RLS.
**Security:** both RPCs `can_manage_homework`-gated + REVOKE public/GRANT authenticated; publish is server-gated (client disable is UX only). Result upsert is RLS-gated (manager policy).
**Placeholder scan:** RPCs + hooks full code; the marking page is a detailed spec with named references — acceptable under subagent execution + review.
**Type consistency:** `MarkingRosterRow`/`MarkingAssignment` + RPC names `homework_marking_roster`/`homework_publish_marks` match between migration, regen'd types, hooks, page.
