# Two-Timeline Syllabus — Phase 3 (Escalation + Coverage Union + Cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the deferred items: (1) chapters completed in the jar count in ALL coverage surfaces (fixes the "2 chapters, 1 period" gap — e.g. "Posters"); (2) teachers with >3 unresolved syllabus days surface as a dashboard flag to admins (spec §7); (3) drop the dead `tt_chapter_pacing` table + old `teacher_pending_lesson_days` RPC; (4) the overflow ("chapters beyond timetable") count gets its deferred UI chip.

**Architecture:** One migration: widen `dashboard_flags.category` CHECK (+'syllabus'), NEW standalone `dash_evaluate_syllabus_flags(p_institution_id)` (SY1 detect/upsert/resolve against the same flags table + identity index — deliberately NOT a rewrite of the 300-line `dash_evaluate_flags`; the on-open kick calls both), CREATE OR REPLACE `dash_syllabus_coverage_build` with the `done` CTE UNION'd with completed events, and the two cleanup DROPs. Frontend: `fetchCoveragePlans` shim concats synthesized done-rows from completed events (client reducer unchanged), `flagLifecycle` gains the syllabus category, `useEvaluateFlagsOnOpen` kicks the second RPC, and the lesson-plan dialog's Auto-timeline section shows the overflow count.

## Global Constraints (binding — same as Phases 1–2)
§5a checks per task; no `any`; `prefer-const`; `toastError`; staleTime on queries (no new queries added here); §24 timezone in all SQL date math; prod SQL via `run-sql.ps1` + verify via pg_proc/information_schema; flag identity = partial unique `(institution_id, flag_code, subject_key) WHERE resolved_at IS NULL`; SY1 severity `warning` (no auto-task — auto-tasks are critical-only by evaluator design, and spec §7 wants surfacing, not task spam). Branch: continue on `feat/two-timeline-syllabus`. The lesson-plan EXPORT's attendance-based "delivered %" is intentionally untouched (different metric).

---

## Task 1 (controller): Migration F — CHECK widen + SY1 evaluator + coverage union + drops

**File:** Create `supabase/migrations/20260706150000_syllabus_phase3.sql` with four parts:

**Part A — widen the category CHECK** (current: `IN ('attendance','exams','adoption')`, auto-named constraint):
```sql
ALTER TABLE public.dashboard_flags DROP CONSTRAINT IF EXISTS dashboard_flags_category_check;
ALTER TABLE public.dashboard_flags ADD CONSTRAINT dashboard_flags_category_check
  CHECK (category IN ('attendance','exams','adoption','syllabus'));
```
(Verify the constraint name on prod first: `SELECT conname FROM pg_constraint WHERE conrelid='public.dashboard_flags'::regclass AND contype='c';` — adapt if it differs.)

**Part B — `dash_evaluate_syllabus_flags(p_institution_id uuid DEFAULT NULL) RETURNS jsonb`** (SECURITY DEFINER, search_path public). Body:
- `v_inst := COALESCE(p_institution_id, public.dash_resolve_institution());` (RAISES for non-admin — the kick is admin-only, matching the main evaluator).
- Timezone-correct today; active AY code + bounds; `v_start := GREATEST(ay.starts_on, v_today - 60); v_end := v_today - 1;` early-return `{'detected':0,'resolved':0}` when unavailable.
- TEMP table `_sy(teacher_id uuid, n int)`: batch version of the pending-days logic — expand the institution's teacher slots (`tt_slots` × `tt_class_structure`(AY) × `tt_period_structures.working_days` × generate_series(v_start,v_end), minus `cal_events` holiday/exam_block, slots filtered `slot_type IN ('theory','practical') AND subject_id IS NOT NULL AND teacher_id IS NOT NULL AND EXISTS (active syllabus_topics for subject)` — same chapterless-skip as the pending RPC); a (teacher, class, subject, date) occurrence is unfilled iff no `syllabus_progress_events` row for (class,subject,date); `n = count(DISTINCT date)` of days with ≥1 unfilled group per teacher; keep `HAVING count(DISTINCT d) > 3` (spec §7: >3 days). Absent days count (consistent with the pending RPC).
- UPSERT into `dashboard_flags`: `('SY1','syllabus','warning','teacher', teacher_id::text, 'Syllabus logging is behind', '<name> has <n> recent school days with unlogged syllabus progress.', n, '/school/timetable', 'red', now(), now())` with the evaluator's exact `ON CONFLICT (institution_id,flag_code,subject_key) WHERE resolved_at IS NULL DO UPDATE SET last_evaluated_at=now(), metric_value=…, description=…`.
- RESOLVE: unresolved SY1 rows of the institution whose `subject_key NOT IN (SELECT teacher_id::text FROM _sy)` → `resolved_at = now()`.
- Return `jsonb_build_object('detected', …, 'resolved', …)`. REVOKE public / GRANT authenticated.

**Part C — coverage union**: `CREATE OR REPLACE FUNCTION public.dash_syllabus_coverage_build` — copy the ENTIRE current body verbatim from `supabase/migrations/20260623150000_dashboard_syllabus_coverage_rpcs.sql` (:31-158) changing ONLY the `done` CTE (:96-104) to:
```sql
  done AS (
    SELECT lp.class_id, lp.subject_id, COALESCE(lp.topic_id, ct.chapter_id) AS chapter_id
    FROM tt_lesson_plans lp
    LEFT JOIN chapter_topics ct ON ct.id = lp.chapter_topic_id
    WHERE lp.class_id = ANY(p_class_ids)
      AND lp.status = 'done' AND lp.session_type = 'teaching'
      AND COALESCE(lp.topic_id, ct.chapter_id) IS NOT NULL
    UNION
    -- Two-timeline jar (Phase 3): chapters completed at check-out/check-in also
    -- count — closes the "more chapters than free periods that day" gap.
    SELECT e.class_id, e.subject_id, e.topic_id
    FROM syllabus_progress_events e
    WHERE e.class_id = ANY(p_class_ids) AND e.action = 'completed'
  ),
```
(`covered` already `count(DISTINCT d.chapter_id)` and joins `chapter_set`, so out-of-syllabus events are excluded and duplicates collapse. `combos` stays `tt_slots`-driven — jar entries always originate from scheduled groups.)

**Part D — cleanup drops** (zero `src/` references outside generated types, confirmed):
```sql
DROP FUNCTION IF EXISTS public.teacher_pending_lesson_days(boolean);
DROP TABLE IF EXISTS public.tt_chapter_pacing;
```

**Verify on prod:** constraint definition contains 'syllabus'; `dash_evaluate_syllabus_flags` exists + runs (service role → dash_resolve_institution raises → expect a caught error OR call with an explicit institution id and expect `{detected:N,resolved:M}` — use Salci National's id and REPORT the counts); `dash_syllabus_coverage_build` definition contains `syllabus_progress_events`; old fn + table gone. Functional check: run the amended build core for Salci National's Class 12 Commerce A and confirm English Core covered-count now includes BOTH completed chapters (Summary writing + Posters → covered ≥ 2). Commit.

---

## Task 2 (controller): types regen

Same procedure; **EXPECTED REMOVALS THIS TIME**: `tt_chapter_pacing` table types + `teacher_pending_lesson_days` function type (the drops). Additions: `dash_evaluate_syllabus_flags`. Confirm removals are EXACTLY those (any other removal = stop); typecheck must stay clean (no src references exist). Commit.

---

## Task 3 (subagent): client coverage shim + flag category + second kick

**Files:** Modify `src/lib/timetableCompat.ts`, `src/components/command-center/flagLifecycle.ts`, `src/hooks/dashboard/useFlagActions.ts`.

1. `fetchCoveragePlans` (:197-211): after the existing lesson-plan fetch, add a second query — `syllabus_progress_events` select `topic_id, class_id, subject_id` with `.eq class_id/.eq subject_id/.in topic_id(chapterIds)/.eq action 'completed'` — and return `[...planRows, ...eventRows.map(r => ({ topic_id: r.topic_id, status: "done", session_type: "teaching", class_id: r.class_id, subject_id: r.subject_id }))]` typed as `CompatCoveragePlanRow[]`. The reducer (`isCovered = done > 0`) then counts jar completions with ZERO changes. Both queries bounded by `chapterIds`.
2. `flagLifecycle.ts`: `CATEGORY_LABELS` + `syllabus: "Syllabus"`; `CATEGORY_ORDER` → `["attendance","exams","adoption","syllabus"]`.
3. `useFlagActions.ts` `useEvaluateFlagsOnOpen`: inside the same guarded try, after the existing `dash_evaluate_flags` call, add `await supabase.rpc("dash_evaluate_syllabus_flags", {});` (same swallow-on-error semantics, same sessionStorage guard — no new key).

Verify: typecheck + eslint on the three files. Commit `feat(lms): jar completions in client coverage + SY1 flag category + kick`.

---

## Task 4 (subagent): overflow chip

**Files:** Modify `src/components/timetable-v2/LessonPlanDialogV2.tsx`, `src/pages/teacher/TeacherMyWeekPageV2.tsx`.

1. Dialog: new optional prop `overflowCount?: number`. In the Auto-timeline (future) branch, under the projected-chapter line, render when `overflowCount != null && overflowCount > 0`:
```tsx
              {overflowCount != null && overflowCount > 0 && (
                <p className="text-xs text-amber-600">
                  {overflowCount} chapter{overflowCount === 1 ? "" : "s"} won't fit in the remaining periods at the current pace.
                </p>
              )}
```
2. Page: alongside the existing `projectionByDate` IIFE prop, add
```tsx
          overflowCount={
            projection.data?.overflow.find(
              (o) => o.class_id === planTarget.slot.class_id && o.subject_id === planTarget.slot.subject_id,
            )?.unscheduled ?? 0
          }
```
Verify: typecheck + eslint + `npx vite build`. Commit `feat(lms): overflow (beyond-timetable) count in auto-timeline section`.

---

## Task 5: full §5a verify + final Phase-3 review + push (merge after user confirms)
