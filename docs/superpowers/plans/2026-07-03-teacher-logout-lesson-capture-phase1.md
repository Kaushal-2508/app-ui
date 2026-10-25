# Teacher Logout Lesson Capture — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make teacher logout (and next-login) compel the teacher to mark each *scheduled* lesson as completed (with a pacing-derived %), writing into `tt_lesson_plans` so it feeds syllabus coverage — present-teacher case only.

**Architecture:** Derived state, no new session table. A SECURITY DEFINER RPC `teacher_pending_lesson_days` computes a teacher's unresolved scheduled lessons (today + past working days) from `tt_slots` + calendar + `staff_attendance_records` + `tt_lesson_plans`. A shared `LessonCompletionChecklist` renders one day's rows; the logout action opens today's checklist before `signOut()`, and `ProtectedRoute` blocks entry on past unresolved days. Completion writes `tt_lesson_plans.status='done'` + a new `completion_pct`; pacing (`100/N`) comes from a teacher-set `tt_chapter_pacing` row.

**Tech Stack:** React 18 + TS, TanStack Query v5, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), Tailwind + salci-design-system, React Router v6.

Spec: `docs/superpowers/specs/2026-07-03-teacher-logout-lesson-capture-design.md`.

## Global Constraints

- **No test runner.** Verify each task with `npm run typecheck` (exit 0) + `npx eslint <touched>` (0 errors) + `npx vite build` (exit 0) + the task's SQL/manual checks. (CLAUDE.md §5a)
- **Lint is strict:** no `any` (`@typescript-eslint/no-explicit-any`), no `prefer-const` violations. Never `as any` — inline type / `unknown`+narrow. For Supabase RPC jsonb, define a narrow TS type. (§5a)
- **Errors:** all `onError`/catch toasts through `toastError(err,{fallback,context})` (`src/lib/toast.ts`). Never `toast.error(err.message)`. (§19)
- **Auth:** never `supabase.auth.getUser()` without a JWT — use `useAuth().user`. (§23)
- **DB:** every new FK gets an index in the same migration; every FK to `profiles(id)` declares `ON DELETE`; apply prod SQL via `scripts/run-sql.ps1` (Management API) + verify via `information_schema`/`pg_policies` (the migration ledger is stale — do NOT `supabase db push`). Regen types from prod after schema change.
- **Timezone (§24):** any "today"/date logic in SQL uses `(now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date` with `i` from `institutions`. Never bare `CURRENT_DATE`.
- **RLS (§23):** reference SECURITY DEFINER helpers (`public.get_user_institution`, `public.tt_user_can_edit_class_slots`, `public.has_role`); no inline cross-table EXISTS in policies.
- **React Query:** explicit `staleTime` on every new `useQuery` (≥ 60_000 unless justified); no `select("*")` in new code.
- **Design system:** UI uses `PageShell`/`MobileSheet`/`Button`/`Card` + `text-ink-*`/`surface-card`/`brand-primary` tokens; works at 375px; dark-mode flips; forms that hold unsaved input set `data-dirty="true"` (§17).
- **Additive only:** do not change attendance auto-mark, substitution assignment, or the coverage math. `tt_lesson_plans` already has RLS policy `tt_lesson_plans_owner_teacher_write` (`owner_teacher_id = auth.uid()`).
- **Branch:** all work on `feat/teacher-logout-lesson-capture` (already created). Commit after each task; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Phase 1 excludes** the absent/substitute branch (Phase 2) and the >3-day escalation + pending-tasks list (Phase 3). The RPC still returns a `was_absent` flag per day for Phase 2 to consume, but Phase 1 UI does not branch on it.

---

## File Structure

- **NEW** `supabase/migrations/20260703120000_lesson_completion_phase1.sql` — `tt_lesson_plans.completion_pct` + `tt_chapter_pacing` table + indexes + RLS.
- **NEW** `supabase/migrations/20260703120100_teacher_pending_lesson_days_rpc.sql` — the RPC.
- **MOD** `src/integrations/supabase/types.ts` — regen (new column + table + RPC).
- **NEW** `src/hooks/useLessonCompletion.ts` — `useTeacherPendingLessonDays`, `useSetChapterPacing`, `useMarkLessonCompletion`.
- **MOD** `src/hooks/useTimetableV2.ts` — coverage cache-invalidation fix in `useUpsertLessonPlan`.
- **NEW** `src/components/lesson-completion/LessonCompletionChecklist.tsx` — one-day checklist (rows + gating).
- **NEW** `src/components/lesson-completion/LessonCompletionRow.tsx` — one scheduled-slot row (mark completed/partial + pacing input).
- **NEW** `src/components/lesson-completion/LogoutLessonGate.tsx` — modal shown before logout for today.
- **MOD** `src/components/layout/AppLayout.tsx` — intercept logout → open `LogoutLessonGate`.
- **MOD** `src/components/layout/ProtectedRoute.tsx` — block teacher entry on past unresolved days.

---

## Task 1: Schema — `completion_pct` + `tt_chapter_pacing`

**Files:** Create `supabase/migrations/20260703120000_lesson_completion_phase1.sql`

**Interfaces:** Produces `tt_lesson_plans.completion_pct numeric(5,2)` and table `public.tt_chapter_pacing (class_id, subject_id, topic_id, planned_sessions)` with per-teacher-class RLS.

- [ ] **Step 1: Write the migration**

```sql
-- 20260703120000_lesson_completion_phase1.sql
-- Phase 1 of compulsory-logout lesson capture: per-session completion % on
-- tt_lesson_plans + a teacher-set per-(class,subject,chapter) pacing table.
-- Additive only.

ALTER TABLE public.tt_lesson_plans
  ADD COLUMN IF NOT EXISTS completion_pct NUMERIC(5,2)
    CHECK (completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100));

CREATE TABLE IF NOT EXISTS public.tt_chapter_pacing (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES public.institutions(id)      ON DELETE CASCADE,
  class_id         UUID NOT NULL REFERENCES public.classes(id)           ON DELETE CASCADE,
  subject_id       UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id         UUID NOT NULL REFERENCES public.syllabus_topics(id)   ON DELETE CASCADE,
  planned_sessions INTEGER NOT NULL CHECK (planned_sessions > 0),
  created_by       UUID REFERENCES public.profiles(id)                   ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_chapter_pacing_unique UNIQUE (class_id, subject_id, topic_id)
);

CREATE INDEX IF NOT EXISTS tt_chapter_pacing_inst_idx    ON public.tt_chapter_pacing (institution_id);
CREATE INDEX IF NOT EXISTS tt_chapter_pacing_subject_idx ON public.tt_chapter_pacing (subject_id);
CREATE INDEX IF NOT EXISTS tt_chapter_pacing_topic_idx   ON public.tt_chapter_pacing (topic_id);

ALTER TABLE public.tt_chapter_pacing ENABLE ROW LEVEL SECURITY;

-- Read: any member of the institution (coverage/reporting reads it).
DROP POLICY IF EXISTS "Members read chapter pacing" ON public.tt_chapter_pacing;
CREATE POLICY "Members read chapter pacing" ON public.tt_chapter_pacing
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Write: staff who can edit this class's slots (admins/coord via helper) OR a
-- teacher assigned to teach this class (they set pacing while marking).
DROP POLICY IF EXISTS "Staff write chapter pacing" ON public.tt_chapter_pacing;
CREATE POLICY "Staff write chapter pacing" ON public.tt_chapter_pacing
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
    )
  );
```

- [ ] **Step 2: Apply to prod**

Run: `powershell -ExecutionPolicy Bypass -File scripts/run-sql.ps1 -SqlFile "supabase/migrations/20260703120000_lesson_completion_phase1.sql" -OutFile "$env:TEMP/lcp1.json"` then `Get-Content "$env:TEMP/lcp1.json"`
Expected: HTTP 201, `[]`.

- [ ] **Step 3: Verify in prod**

Write a verify SQL file and run it via `run-sql.ps1`:
```sql
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tt_lesson_plans' AND column_name='completion_pct';
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tt_chapter_pacing' ORDER BY ordinal_position;
SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='tt_chapter_pacing';
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='tt_chapter_pacing';
```
Expected: `completion_pct` present; `tt_chapter_pacing` has its 9 columns; 2 policies (SELECT + ALL); PK + 3 FK indexes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260703120000_lesson_completion_phase1.sql
git commit -m "feat(lms): completion_pct + tt_chapter_pacing (lesson-completion phase 1)"
```

---

## Task 2: RPC `teacher_pending_lesson_days`

**Files:** Create `supabase/migrations/20260703120100_teacher_pending_lesson_days_rpc.sql`

**Interfaces:**
- Produces `public.teacher_pending_lesson_days(p_include_today boolean DEFAULT false) RETURNS jsonb`. Caller = the teacher (`auth.uid()`). Returns:
  `{ "unresolved_day_count": int, "days": [ { "date":"YYYY-MM-DD", "is_today":bool, "was_absent":bool, "slots":[ { "slot_id":uuid, "class_id":uuid, "class_name":text, "subject_id":uuid, "subject_name":text, "topic_id":uuid|null, "planned_sessions":int|null, "expected_pct":number|null } ] } ] }`

- [ ] **Step 1: Write the RPC migration**

```sql
-- 20260703120100_teacher_pending_lesson_days_rpc.sql
-- Returns the calling teacher's unresolved scheduled teaching lessons for past
-- working days (and optionally today). Derived from tt_slots (recurring by
-- weekday) x calendar working-days x tt_lesson_plans (resolved = done/skipped).
-- SECURITY DEFINER; reads auth.uid(); capped to the active academic year.

CREATE OR REPLACE FUNCTION public.teacher_pending_lesson_days(p_include_today boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_tz    text;
  v_today date;
  v_ay    text;
  v_start date;
  v_end   date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Active academic year window (fall back to a wide window if none active).
  SELECT ay.code, ay.starts_on, ay.ends_on INTO v_ay, v_start, v_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true
  LIMIT 1;
  IF v_ay IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  v_end := LEAST(v_end, CASE WHEN p_include_today THEN v_today ELSE v_today - 1 END);
  IF v_start > v_end THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  WITH days AS (
    SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') AS g(d)
  ),
  -- the teacher's recurring teaching slots this AY
  slots AS (
    SELECT s.id AS slot_id, s.class_id, s.subject_id, s.period_slot_id, s.day,
           c.name AS class_name_raw, c.section AS class_section,
           us.name AS subject_name,
           cs.structure_id
    FROM public.tt_slots s
    JOIN public.classes c            ON c.id = s.class_id
    LEFT JOIN public.universal_subjects us ON us.id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
  ),
  -- expand each slot to its working-day occurrences that aren't holidays/exam-blocks
  occ AS (
    SELECT sl.slot_id, sl.class_id, sl.class_name_raw, sl.class_section,
           sl.subject_id, sl.subject_name, dd.d
    FROM slots sl
    JOIN public.tt_period_structures ps ON ps.id = sl.structure_id
    JOIN days dd ON public.tt_dow_to_text(dd.d) = sl.day
                AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block')
        AND dd.d BETWEEN ce.starts_on AND ce.ends_on
    )
  ),
  -- unresolved occurrences: no done/skipped lesson-plan row for (slot, date)
  unresolved AS (
    SELECT o.*,
           lp.topic_id,
           EXISTS (SELECT 1 FROM public.staff_attendance_records sar
                   WHERE sar.staff_id = v_uid AND sar.date = o.d
                     AND sar.status IN ('absent','on_leave')) AS was_absent
    FROM occ o
    LEFT JOIN public.tt_lesson_plans lp ON lp.slot_id = o.slot_id AND lp.date = o.d
    WHERE lp.id IS NULL OR lp.status NOT IN ('done','skipped')
  ),
  enriched AS (
    SELECT u.*,
           cp.planned_sessions,
           CASE WHEN cp.planned_sessions IS NOT NULL AND cp.planned_sessions > 0
                THEN round(100.0 / cp.planned_sessions, 2) END AS expected_pct
    FROM unresolved u
    LEFT JOIN public.tt_chapter_pacing cp
      ON cp.class_id = u.class_id AND cp.subject_id = u.subject_id AND cp.topic_id = u.topic_id
  ),
  by_day AS (
    SELECT e.d, bool_or(e.was_absent) AS was_absent,
      jsonb_agg(jsonb_build_object(
        'slot_id', e.slot_id, 'class_id', e.class_id,
        'class_name', trim(e.class_name_raw || COALESCE(' ' || e.class_section, '')),
        'subject_id', e.subject_id, 'subject_name', e.subject_name,
        'topic_id', e.topic_id, 'planned_sessions', e.planned_sessions, 'expected_pct', e.expected_pct
      ) ORDER BY e.slot_id) AS slots
    FROM enriched e
    GROUP BY e.d
  )
  SELECT jsonb_build_object(
    'unresolved_day_count', (SELECT count(*) FROM by_day),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(bd.d,'YYYY-MM-DD'),
        'is_today', (bd.d = v_today),
        'was_absent', bd.was_absent,
        'slots', bd.slots) ORDER BY bd.d) FROM by_day), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_pending_lesson_days(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_pending_lesson_days(boolean) TO authenticated;
```

**Implementer note:** verify these real column names before applying (adjust if the DB differs, do NOT guess-and-ship): `classes.name`/`classes.section`, `tt_class_structure.class_id`/`.academic_year`/`.structure_id`, `tt_period_structures.working_days`, `cal_events.academic_year`/`.kind`/`.starts_on`/`.ends_on`, `cal_academic_years.code`/`.starts_on`/`.ends_on`/`.is_active`, and that `public.tt_dow_to_text(date)` exists. If `classes` has no `section`, drop that concat.

- [ ] **Step 2: Apply + verify**

Apply via `run-sql.ps1`. Then smoke-test with a teacher's uid:
```sql
SELECT proname FROM pg_proc WHERE proname = 'teacher_pending_lesson_days';
-- structural smoke (runs as definer; returns valid jsonb shape even with 0 rows):
SELECT jsonb_typeof(public.teacher_pending_lesson_days(false));  -- expect 'object'
```
Expected: function exists; returns a jsonb object. (Full data smoke happens in Task 8 via the app as a teacher.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703120100_teacher_pending_lesson_days_rpc.sql
git commit -m "feat(lms): teacher_pending_lesson_days RPC (unresolved scheduled lessons)"
```

---

## Task 3: Supabase types regen

**Files:** Modify `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regen to a temp file and validate additive-only**

Run: `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > "$env:TEMP/types_new.ts"` then compare line counts + diff; confirm ONLY additions around `tt_chapter_pacing`, `completion_pct`, and the `teacher_pending_lesson_days` function. If the diff shows removals, discard and hand-add the `tt_chapter_pacing` Row/Insert/Update + `completion_pct` field instead (never `as any`).

- [ ] **Step 2: Overwrite as UTF-8 (avoid the PowerShell `>` UTF-16 trap)**

After validating, write it back as UTF-8:
```powershell
$raw = Get-Content -Raw "$env:TEMP/types_new.ts"; [System.IO.File]::WriteAllText((Resolve-Path "src/integrations/supabase/types.ts").Path, $raw, (New-Object System.Text.UTF8Encoding($false)))
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck` (exit 0).
```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): tt_chapter_pacing + completion_pct + pending-days RPC"
```

---

## Task 4: Hooks — pending days, set pacing, mark completion, coverage-cache fix

**Files:** Create `src/hooks/useLessonCompletion.ts`; Modify `src/hooks/useTimetableV2.ts`

**Interfaces:**
- Consumes: `supabase`, `useAuth().user`, `toastError`, `invalidateSyllabusCache` (if present) or explicit key invalidation.
- Produces:
  - `useTeacherPendingLessonDays(opts:{ includeToday:boolean })` → `{ data: PendingDays | undefined, ... }`.
  - `useSetChapterPacing()` → mutate `{ classId, subjectId, topicId, plannedSessions }`.
  - `useMarkLessonCompletion()` → mutate `{ slotId, classId, subjectId, topicId, date, completed:boolean, completionPct:number }`.
  - Types `PendingDays`, `PendingDay`, `PendingSlot`.

- [ ] **Step 1: Write `src/hooks/useLessonCompletion.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";

export interface PendingSlot {
  slot_id: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string | null;
  topic_id: string | null;
  planned_sessions: number | null;
  expected_pct: number | null;
}
export interface PendingDay {
  date: string;
  is_today: boolean;
  was_absent: boolean;
  slots: PendingSlot[];
}
export interface PendingDays {
  unresolved_day_count: number;
  days: PendingDay[];
}

/** The calling teacher's unresolved scheduled lessons (past, and optionally today). */
export function useTeacherPendingLessonDays(opts: { includeToday: boolean; enabled?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-pending-lesson-days", user?.id, opts.includeToday],
    enabled: (opts.enabled ?? true) && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PendingDays> => {
      const { data, error } = await supabase.rpc("teacher_pending_lesson_days", {
        p_include_today: opts.includeToday,
      });
      if (error) throw error;
      return (data as unknown as PendingDays) ?? { unresolved_day_count: 0, days: [] };
    },
  });
}

/** Teacher sets 'this chapter spans N sessions' once per (class, subject, chapter). */
export function useSetChapterPacing() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { classId: string; subjectId: string; topicId: string; plannedSessions: number; institutionId: string }) => {
      const { error } = await supabase.from("tt_chapter_pacing").upsert(
        {
          institution_id: input.institutionId,
          class_id: input.classId,
          subject_id: input.subjectId,
          topic_id: input.topicId,
          planned_sessions: input.plannedSessions,
          created_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "class_id,subject_id,topic_id" },
      );
      if (error) throw error;
    },
    onError: (e: unknown) => toastError(e, { fallback: "Couldn't save chapter pacing.", context: "setChapterPacing" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teacher-pending-lesson-days"] }),
  });
}

/** Write one session's completion into tt_lesson_plans (the coverage sink). */
export function useMarkLessonCompletion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      slotId: string; classId: string; subjectId: string; topicId: string | null;
      date: string; completed: boolean; completionPct: number;
    }) => {
      const { error } = await supabase.from("tt_lesson_plans").upsert(
        {
          slot_id: input.slotId,
          class_id: input.classId,
          subject_id: input.subjectId,
          owner_teacher_id: user?.id ?? null,
          date: input.date,
          session_type: "teaching",
          status: input.completed ? "done" : "planned",
          topic_id: input.topicId,
          completion_pct: input.completionPct,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slot_id,date" },
      );
      if (error) throw error;
    },
    onError: (e: unknown) => toastError(e, { fallback: "Couldn't save lesson status.", context: "markLessonCompletion" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-lesson-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] }); // covers ["dash",scope,"syllabusCoverage"]
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan"] });
    },
  });
}
```

**Implementer note:** confirm `tt_lesson_plans` upsert columns exist (`updated_by` may not — drop it if typecheck complains). `status` "planned"/"done" and `session_type` "teaching" are valid enum values (CHECK). Do NOT set `status='done'` unless `completed`.

- [ ] **Step 2: Fix the coverage-cache miss in `useUpsertLessonPlan`**

In `src/hooks/useTimetableV2.ts`, find `useUpsertLessonPlan`'s `onSuccess` (invalidates only `["timetable-v2","lesson-plan",…]` + `["timetable-v2","teacher-plans-week"]`). Add:
```ts
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck && npx eslint src/hooks/useLessonCompletion.ts src/hooks/useTimetableV2.ts`
```bash
git add src/hooks/useLessonCompletion.ts src/hooks/useTimetableV2.ts
git commit -m "feat(lms): lesson-completion hooks + coverage cache invalidation"
```

---

## Task 5: `LessonCompletionRow` + `LessonCompletionChecklist`

**Files:** Create `src/components/lesson-completion/LessonCompletionRow.tsx`, `src/components/lesson-completion/LessonCompletionChecklist.tsx`

**Interfaces:**
- Consumes: `PendingDay`/`PendingSlot` (Task 4), `useMarkLessonCompletion`, `useSetChapterPacing`, `useAuth`.
- Produces: `<LessonCompletionChecklist day onAllResolved />` and `<LessonCompletionRow slot date institutionId onResolved />`.

- [ ] **Step 1: `LessonCompletionRow.tsx`** — one scheduled slot. Local status `unset|completed|not`; if the chapter has no pacing yet, a small "How many sessions is this chapter? [N]" input (calls `useSetChapterPacing`, defaults 1) so `expected_pct` becomes known; Completed → `useMarkLessonCompletion({ completed:true, completionPct: expected_pct ?? 100 })`; Not/Partial → completed:false + a 0–expected % slider/input. Uses shadcn `Button`/`Input`/`Card`, `text-ink-*` tokens, `data-dirty="true"` on the container. On a successful mark, call `onResolved(slot.slot_id)`.

```tsx
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PendingSlot } from "@/hooks/useLessonCompletion";
import { useMarkLessonCompletion, useSetChapterPacing } from "@/hooks/useLessonCompletion";

export function LessonCompletionRow({ slot, date, institutionId, onResolved }: {
  slot: PendingSlot; date: string; institutionId: string; onResolved: (slotId: string) => void;
}) {
  const mark = useMarkLessonCompletion();
  const setPacing = useSetChapterPacing();
  const [resolved, setResolved] = useState(false);
  const [sessions, setSessions] = useState<string>(slot.planned_sessions?.toString() ?? "");
  const expected = slot.expected_pct ?? (slot.planned_sessions ? 100 / slot.planned_sessions : null);
  const needsPacing = slot.topic_id != null && slot.planned_sessions == null;

  const ensurePacing = async (): Promise<number | null> => {
    if (!needsPacing || !slot.topic_id) return expected;
    const n = Math.max(1, parseInt(sessions || "1", 10));
    await setPacing.mutateAsync({ classId: slot.class_id, subjectId: slot.subject_id, topicId: slot.topic_id, plannedSessions: n, institutionId });
    return 100 / n;
  };

  const complete = async () => {
    const pct = (await ensurePacing()) ?? 100;
    await mark.mutateAsync({ slotId: slot.slot_id, classId: slot.class_id, subjectId: slot.subject_id, topicId: slot.topic_id, date, completed: true, completionPct: pct });
    setResolved(true); onResolved(slot.slot_id);
  };
  const notDone = async () => {
    await mark.mutateAsync({ slotId: slot.slot_id, classId: slot.class_id, subjectId: slot.subject_id, topicId: slot.topic_id, date, completed: false, completionPct: 0 });
    setResolved(true); onResolved(slot.slot_id);
  };

  return (
    <Card data-dirty="true" className={cn("surface-card frosted-shadow rounded-card p-3 flex items-center gap-3", resolved && "opacity-60")}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{slot.class_name} · {slot.subject_name ?? "Subject"}</p>
        {expected != null && <p className="text-xs text-ink-500">This session ≈ {Math.round(expected)}% of the chapter</p>}
        {needsPacing && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-ink-500">Chapter spans</span>
            <Input value={sessions} onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="h-8 w-14" placeholder="N" />
            <span className="text-xs text-ink-500">sessions</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={complete} disabled={mark.isPending || resolved} className="bg-brand-primary text-white hover:bg-brand-primary/90">
          <Check className="h-4 w-4 mr-1" /> Completed
        </Button>
        <Button size="sm" variant="outline" onClick={notDone} disabled={mark.isPending || resolved}>
          <X className="h-4 w-4 mr-1" /> Not done
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: `LessonCompletionChecklist.tsx`** — renders one `PendingDay`: a header (date, "N lessons to confirm"), the rows, and calls `onAllResolved()` once every slot has been resolved (track a resolved `Set`). Empty `slots` → immediately `onAllResolved()`.

```tsx
import { useEffect, useState } from "react";
import type { PendingDay } from "@/hooks/useLessonCompletion";
import { LessonCompletionRow } from "./LessonCompletionRow";

export function LessonCompletionChecklist({ day, institutionId, onAllResolved }: {
  day: PendingDay; institutionId: string; onAllResolved: () => void;
}) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (day.slots.length === 0 || resolved.size >= day.slots.length) onAllResolved();
  }, [day.slots.length, resolved.size, onAllResolved]);

  return (
    <div className="space-y-3">
      <div>
        <p className="eyebrow">Lesson completion</p>
        <h3 className="text-base font-semibold text-ink-900">{day.date}</h3>
        <p className="text-xs text-ink-500">{day.slots.length} lesson{day.slots.length === 1 ? "" : "s"} to confirm</p>
      </div>
      {day.slots.map((s) => (
        <LessonCompletionRow key={s.slot_id} slot={s} date={day.date} institutionId={institutionId}
          onResolved={(id) => setResolved((prev) => new Set(prev).add(id))} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck && npx eslint src/components/lesson-completion/LessonCompletionRow.tsx src/components/lesson-completion/LessonCompletionChecklist.tsx`
```bash
git add src/components/lesson-completion/
git commit -m "feat(lms): lesson-completion checklist + row components"
```

---

## Task 6: Logout interceptor (`LogoutLessonGate` + AppLayout)

**Files:** Create `src/components/lesson-completion/LogoutLessonGate.tsx`; Modify `src/components/layout/AppLayout.tsx`

**Interfaces:** Consumes `useTeacherPendingLessonDays({ includeToday:true })`, `LessonCompletionChecklist`, `useAuth`, `useUserRole`. Produces `<LogoutLessonGate open onOpenChange onComplete />` (a `MobileSheet`/`Dialog` that must be completed before the real `signOut()` runs).

- [ ] **Step 1: `LogoutLessonGate.tsx`** — a `MobileSheet` (from `@/components/shared/sheets`) that fetches today's pending day (`includeToday:true`, filter to `is_today`), renders `LessonCompletionChecklist` for it, and calls `onComplete()` when the checklist resolves (or immediately if there are no lessons today). Only teachers see lessons; non-teachers → `onComplete()` immediately. Non-dismissible except via completion (no close button that bypasses).

- [ ] **Step 2: Wire into `AppLayout.tsx`** — find the logout handler (~line 157: `try { await signOut(); } finally { window.location.replace("/login"); }`). Replace the direct call with a gated flow: on logout click, if the user is a teacher, open `<LogoutLessonGate>`; its `onComplete` then runs the existing `signOut()` + redirect. Non-teachers keep the current direct path. Keep the CLAUDE.md §Misc invariant (purge tokens + `window.location.replace`) — do not simplify `signOut`.

**Implementer note:** read the current AppLayout logout wiring first; add a `logoutGateOpen` state + render `<LogoutLessonGate>` conditionally; the actual `signOut()`+redirect moves into the gate's `onComplete`. Determine "is teacher" from `useUserRole()` (`roleInfo?.isTeacher`) as the page already does elsewhere.

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck && npx eslint src/components/lesson-completion/LogoutLessonGate.tsx src/components/layout/AppLayout.tsx && npx vite build`
```bash
git add src/components/lesson-completion/LogoutLessonGate.tsx src/components/layout/AppLayout.tsx
git commit -m "feat(lms): compulsory lesson checklist on teacher logout"
```

---

## Task 7: Login gate (ProtectedRoute)

**Files:** Modify `src/components/layout/ProtectedRoute.tsx`

**Interfaces:** Consumes `useTeacherPendingLessonDays({ includeToday:false })`, `LessonCompletionChecklist`, `useUserRole`.

- [ ] **Step 1: Add a teacher interstitial** modelled on the existing Olympiad-only lockdown block (§found in the auth probe: the `useEffect` redirect-gate + the loading-skeleton return). For teachers only: call `useTeacherPendingLessonDays({ includeToday:false, enabled: isTeacher })`; while `unresolved_day_count > 0`, render a full-screen blocking view that walks the teacher through each past day's `LessonCompletionChecklist` (one day at a time; advance when a day resolves; when all resolved / count hits 0, fall through to `{children}`). Do NOT block admins/coordinators/students. Keep the existing loading + role-resolution guards intact (return the skeleton until role + pending query resolve, so the app never flashes then blocks).

**Implementer note:** read `ProtectedRoute.tsx` first (the Olympiad block ~lines 78-93 and the loading return ~95-112). Add the teacher-pending gate AFTER role resolves and BEFORE rendering `<AppLayout>{children}</AppLayout>`. The blocking view is its own component (reuse `LessonCompletionChecklist`), rendered in place of children — not a route redirect (so refresh keeps them gated).

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npx eslint src/components/layout/ProtectedRoute.tsx && npx vite build`
```bash
git add src/components/layout/ProtectedRoute.tsx
git commit -m "feat(lms): block teacher login on unresolved past lesson days"
```

---

## Task 8: Full verification + manual smoke + push

- [ ] **Step 1: Production gate**

Run: `npm run typecheck && npx eslint src/hooks/useLessonCompletion.ts src/components/lesson-completion/*.tsx src/components/layout/AppLayout.tsx src/components/layout/ProtectedRoute.tsx && npx vite build`
Expected: all green.

- [ ] **Step 2: Manual smoke (dev server, logged in as a TEACHER with a timetable)**
  - Logout → today's scheduled lessons appear; a chapter with no pacing prompts "spans N sessions"; Completed writes the row; logout only proceeds after all are marked; a teacher with no scheduled slots today logs out with an empty checklist that closes immediately.
  - Leave one of today's lessons unmarked, close the tab, log back in → the login gate shows that day (now past) and blocks until resolved.
  - Confirm an admin/coordinator/student logs in and out with NO checklist.
  - Confirm the marked chapter's syllabus-coverage reflects the new `done` (Syllabus → coverage / dashboard).

- [ ] **Step 3: Push**

```bash
git push -u origin feat/teacher-logout-lesson-capture
```

---

## Self-Review

**Spec coverage (Phase 1 rows of spec §10):** completion_pct + tt_chapter_pacing → Task 1; RPC → Task 2; types → Task 3; hooks + pacing-set + coverage-cache fix → Task 4; checklist component → Task 5; logout interceptor → Task 6; login gate → Task 7; verify → Task 8. Absent/substitute (Phase 2) and escalation/pending-tasks (Phase 3) are intentionally excluded. Covered.

**Placeholder scan:** the two "Implementer note … verify real column names / read the file first" callouts are deliberate verification instructions for SQL/large-file integration, not skipped logic — the SQL and wiring are given in full. No TBD/TODO.

**Type consistency:** `PendingSlot`/`PendingDay`/`PendingDays` (Task 4) are consumed unchanged in Tasks 5–7; `useMarkLessonCompletion({ slotId, classId, subjectId, topicId, date, completed, completionPct })` and `useSetChapterPacing({ classId, subjectId, topicId, plannedSessions, institutionId })` signatures match their call sites in `LessonCompletionRow`; RPC name `teacher_pending_lesson_days(p_include_today)` matches the hook's `supabase.rpc` call; coverage invalidation keys (`["syllabus-coverage"]`, `["dash"]`) match in Task 4 both places.

**Risk carried from spec §12:** the RPC uses `tt_period_structures.working_days` (not the Mon–Fri default), counts only slots that actually existed on that weekday, and caps the sweep to the active academic-year window — all implemented in Task 2's SQL.
