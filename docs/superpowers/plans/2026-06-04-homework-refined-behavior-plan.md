# Homework Refined Behavior — Implementation Plan (2026-06-04)

Spec: `docs/superpowers/specs/2026-06-04-homework-refined-behavior-design.md`.
Branch strategy: build on `main` (module already lives there), ship per phase, §5a gates
(tsc 0 / eslint 0 on touched / vite build 0) each phase. Prod project `gyymkgohcijeksmrzuyw`.

## Phase A — Rename (UI only)
1. [AppSidebar.tsx](../../src/components/layout/AppSidebar.tsx): teacher L537, coordinator
   L462 → "Homework and Assignment"; school-admin L380, student L610 "Homework &" → "and".
2. [HomeworkPage.tsx](../../src/pages/HomeworkPage.tsx) L231 PageHeader title → "Homework and
   Assignment". (Student page header too if present.)
3. Gates → commit → push.

## Phase B — Student window + hard close
1. **Migration** `..._homework_student_feed_and_hard_close.sql`:
   - `homework_student_feed()` + `homework_student_detail(_id)` SECURITY DEFINER RPCs (null
     description/attachment_* when `visible_from > now()`; include `locked` flag + own
     submission/result).
   - Extend submit gate with upper bound: `homework_visible_to_student` keeps lower bound;
     add `now() <= due_at` to the **submission INSERT** `WITH CHECK` (new helper
     `homework_open_for_submission(user, hw)` to avoid breaking the read helper).
2. **Edge** `submit-homework/index.ts`: 410 when `now > due_at`; stop setting `is_late=true`
   (always false).
3. **Frontend**:
   - `useStudentHomework.ts`: read via `homework_student_feed` RPC; detail via
     `homework_student_detail`. Surface `locked`, `visible_from`, `due_at`.
   - `StudentHomeworkPage.tsx`: show "Opens …" for locked rows; lock affordance.
   - `StudentHomeworkDetailPage.tsx`: locked state (dates only, no description/attachment/
     upload); `canSubmit = !locked && !overdue && !submission && published`; past-due
     "Closed" state; remove "late" messaging.
4. Apply migration to prod, deploy edge fn, gates → commit → push.

## Phase C — Publish gate + auto-checked
1. **Migration** `..._homework_autocheck_and_publish_gate.sql`:
   - `homework_auto_check_pass()` SECURITY DEFINER (unmarked + published + past due →
     checked). Add a SQL call to the existing `homework-notify-pass-15min` cron (or a second
     cron job) — verify with `cron.job`.
   - `CREATE OR REPLACE homework_publish_marks`: keep condition (b); add (a) — non-submitter
     count vs `due_at`.
2. **Frontend** `HomeworkMarkingPage.tsx`: `publishDisabled` also true when
   `notSubmitted.length > 0 && due_at > now`; footer hint explains why.
3. Apply migration to prod, gates → commit → push.

## Phase D — Offline + non-submitter marks
1. **Migration** `..._homework_offline_marks.sql`:
   - `homework_assignments.offline_marks boolean NOT NULL DEFAULT false`.
   - `homework_results.submission_id` DROP NOT NULL; add `UNIQUE(homework_assignment_id,
     student_id)`.
   - `homework_upsert_roster_marks(_homework_id uuid, _marks jsonb)` SECURITY DEFINER,
     `can_manage_homework`-gated, upsert on `(homework_assignment_id, student_id)`.
   - Regenerate `types.ts`.
2. **Frontend**:
   - `types/homework.ts` + `HomeworkCreationFlow.tsx`: `offlineMarks` toggle (carriesMarks
     only). `useHomeworkSave`/`useHomeworkUpdate` persist it.
   - `useHomeworkMarking.ts`: `useUpsertRosterMarks` (bulk) + allow single non-submitter
     entry (submission_id null path).
   - `HomeworkMarkingPage.tsx`: offline branch = full roster marks boxes + "Submit marks" +
     "You missed N" confirm (MobileSheet); online branch = add inline marks box to
     "Not submitted" rows.
   - Student side: offline assignments render read-only (no upload), show mark when checked.
3. Apply migration to prod, regen types, gates → commit → push.

## Verification per phase
After each: `npx tsc --noEmit` (0), `npx eslint <touched>` (0), `npx vite build` (0). For
DB/edge phases, reproduce the behavior against prod via the Management API (per
[[reference-supabase-management-api-access]]) before claiming done — runtime QA is what the
static gates miss (cf. the 42804 + render-loop hotfixes).
