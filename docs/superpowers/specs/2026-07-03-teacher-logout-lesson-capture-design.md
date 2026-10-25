# Compulsory-Logout Lesson Completion Capture — Design

- **Date:** 2026-07-03
- **Status:** Approved in brainstorming — pending spec review
- **Scope:** LMS = timetable (`tt_*`) + lesson plans (`tt_lesson_plans`) + attendance (`staff_attendance_records`) + syllabus coverage.
- **Principle:** Additive only. No restructure of auth, attendance, timetable, or coverage outside the new completion path.

## 1. Summary

Make teacher logout capture daily lesson completion and feed it into the existing syllabus-coverage / lesson-delivery pipeline. On logout, the teacher is shown a checklist **generated from their timetable** (the periods/classes/subjects they were scheduled to teach that day) and marks each lesson **completed or not**, with a completion **%** derived from chapter pacing. The session only ends once every scheduled lesson has a status. Unclosed prior days and prior absent days are caught and resolved at next login before the teacher can proceed.

## 2. Investigation findings that shaped this design (verified in code)

- **The sink already exists.** `tt_lesson_plans` (one row per `(slot_id, date)`, `UNIQUE(slot_id, date)`) is what syllabus coverage reads: a chapter is "covered" iff ≥1 row has `status='done' AND session_type='teaching'` (`src/lib/syllabusCoverage.ts`, `timetableCompat.fetchCoveragePlans`, `dash` coverage RPC `20260623150000`). **We write here — no parallel table.**
- **No UI writes `done` today.** `LessonPlanDialogV2` retired its status picker; `useUpsertLessonPlan` preserves prior status. So live coverage is fed only by legacy backfill — **this feature is the first real source of "lesson taught" data** (a latent gap it fixes).
- **Coverage is binary; there is no `%` or pacing.** No `completion_pct` column, no "chapter spans N sessions" model, lesson rows are not forward-seeded. The pacing % must be **built (minimally, for this feature only)** — decided in brainstorming.
- **Sessions are stateless Supabase JWTs.** No server session/heartbeat table; login writes nothing. `signOut()` already uses **global scope** (revokes all the teacher's devices on the next token refresh). So there is **no need for a session table** and **no multi-device dual-state** — state lives in the DB (`tt_lesson_plans`).
- **A blocking app-entry gate pattern exists:** the Olympiad-only lockdown interstitial in `ProtectedRoute.tsx` (fetch a condition → render an alternative/redirect until it clears). We reuse this pattern.
- **Absence + "a sub is covering" are recorded; "sub completed the lesson" is not.** `staff_attendance_records (staff_id, date, status∈present/late/absent/on_leave/holiday, auto_marked_absent)`; `tt_substitutions (slot_id, date, original_teacher_id, substitute_teacher_id, status∈pending/assigned/…)` where only `pending`/`assigned` are written (`completed` never). No "sub taught it" field — net-new.
- **Cache miss:** `useUpsertLessonPlan.onSuccess` does not invalidate `["syllabus-coverage",…]` or `["dash",scope,"syllabusCoverage",…]` — coverage widgets lag. We fix this.

## 3. Core architecture — derived state (no new session table)

The "session" is the **completion state of a teacher's scheduled lessons**, which already lives in `tt_lesson_plans`. Everything derives from existing tables:

**New RPC `teacher_pending_lesson_days(p_scope)`** (SECURITY DEFINER, `p_scope ∈ 'past'|'today'|'all'`, scoped to `auth.uid()` teacher):
For each candidate calendar date, expand the teacher's recurring teaching slots and emit unresolved ones.
- **Candidate dates:** working days of the current academic year up to (and incl.) today, per the class's `tt_period_structures.working_days TEXT[]` minus `cal_events (kind IN 'holiday','exam_block')`. Uses `(now() AT TIME ZONE institutions.timezone)::date` for "today" (§24 timezone rule).
- **Scheduled slots for the teacher on date D:** `tt_slots WHERE teacher_id = auth.uid() AND academic_year = <AY> AND slot_type IN ('theory','practical') AND day = tt_dow_to_text(D)`. (Substituted-away slots where the teacher was absent are surfaced under the absent branch.)
- **Resolved?** a slot on D is resolved iff a `tt_lesson_plans` row exists for `(slot_id, D)` with `status IN ('done','skipped')`.
- **Per-day tag:** `was_absent` = `staff_attendance_records(staff_id=auth.uid(), date=D, status IN ('absent','on_leave'))`; `sub_assigned` = a `tt_substitutions(status='assigned')` row for the slot+date.
- Returns a nested JSON: `[{ date, is_today, was_absent, slots:[{ slot_id, class_id, class_name, subject_id, subject_name, topic_id, planned_sessions, expected_pct, resolved, sub_assigned, substitute_id }] }]`, plus a top-level `unresolved_day_count`.

Today → logout checklist. Past unresolved → login gate. Absent past days → the substitute-resolution branch. **Zero scheduled slots on a day ⇒ that day never appears** (holiday / exam-duty / no-class days produce nothing to fill).

## 4. New data (minimal, additive)

- **`tt_lesson_plans.completion_pct NUMERIC(5,2)`** (nullable) — the completed % for that session.
- **`tt_lesson_plans.covered_by TEXT`** CHECK `('teacher','substitute')` nullable; **`substitute_confirmed BOOLEAN`** nullable — for the absent/sub branch.
- **`tt_chapter_pacing (id, institution_id, class_id, subject_id, topic_id, planned_sessions INT CHECK >0, created_by, created_at, updated_at)`** — `UNIQUE (class_id, subject_id, topic_id)`. FK indexes per §23; `institution_id`/`topic_id`/etc. `ON DELETE CASCADE`. RLS: teachers of the class read/write their own class's rows (via `tt_user_can_edit_class_slots` or `class_assignments role='teacher'`), admins/coordinators read.
- **Pacing rule:** expected share per session = `round(100.0 / planned_sessions, 2)`. Set by the **teacher, once per (class, subject, chapter)** — the first time they mark a session for that chapter, they enter "this chapter spans N classes" (sensible default, e.g. 1). Later sessions of the same chapter auto-derive their share.
- **No new session/attendance/substitution tables.** Substitute completion also flips the paired `tt_substitutions.status` to `'completed'` (the value already allowed by its CHECK but never written) for consistency in the export report.

## 5. The three flows (one shared checklist component)

A single `<LessonCompletionChecklist dayBundle>` renders one **day** (today or a past day): one row per scheduled slot showing class · subject · planned chapter (from `tt_lesson_plans.topic_id` if set, else a chapter picker) · the pacing-derived **expected %**. Each row's control: **Completed** (writes `status='done'`, `completion_pct = expected share`, `done_at` via existing trigger) or **Not / Partial** (`completion_pct` < share; status stays `planned`, or `skipped` for a session that legitimately didn't run). **Marks save per-row on toggle** → interruption reappears pre-filled (state read from `tt_lesson_plans`). Below the lessons, a **non-blocking pending-tasks list** (existing task system) — checkable, never gates the flow.

- **Logout (mandatory):** the logout action (in `AppLayout`) intercepts before `signOut()` — opens the checklist for **today**. Logout proceeds (and `signOut()` fires) only once every scheduled lesson for today has a status. Zero-scheduled day → empty checklist → closes immediately. If the browser is force-closed instead, today becomes a past unresolved day → caught at next login.
- **Login gate (unclosed prior days):** `ProtectedRoute` interstitial (Olympiad-lockdown pattern) — on entry, call `teacher_pending_lesson_days('past')`; if non-empty, render the checklist for those days (blocking) before `AppLayout`.
- **Absent-day / substitute resolution:** for `was_absent` days, each row asks **sub covered? → completed? → %** — writes `tt_lesson_plans` completion with `covered_by='substitute'`, `substitute_confirmed`, and flips `tt_substitutions.status='completed'`. Same pacing/% logic.

## 6. Coverage integration

Completion writes `status='done' AND session_type='teaching'` → flows into `syllabusCoverage.ts`, `timetableCompat.fetchCoveragePlans`, and the `dash` coverage RPC unchanged (binary "covered" per chapter). The **delivered-% enrichment** (`min(100, Σ completion_pct)` per chapter) is exposed as an additive field for reporting; the existing binary metric is untouched. **Fix:** `useUpsertLessonPlan.onSuccess` (and the new write path) also invalidate `["syllabus-coverage"]` and `["dash", scope, "syllabusCoverage"]`.

## 7. Escalation (Phase 3)

`teacher_pending_lesson_days` returns `unresolved_day_count`. If **> 3**, raise a `dashboard_flags` row (existing 20-flag evaluator / `resolve_flag_assignee` → coordinator → admin) so unresolved days surface instead of stacking silently. No new notification channel.

## 8. Multi-device & persistence

No dual-state: both devices read the same `tt_lesson_plans` rows. Per-row save = automatic persistence + cross-device consistency. `signOut()` global scope already drops the other device. Nothing extra built.

## 9. Roles, RLS, permissions

- Only **teachers** get the checklist/gate (role-gated in `ProtectedRoute` + the logout interceptor). Admins/coordinators unaffected.
- `tt_lesson_plans` already has `tt_lesson_plans_owner_teacher_write` (`owner_teacher_id = auth.uid()`) — the teacher writes their own rows. New columns inherit existing RLS.
- New RPC + `tt_chapter_pacing` RLS gated to the teacher's own classes; the RPC is SECURITY DEFINER reading `auth.uid()`.

## 10. Phasing

- **Phase 1 (core):** migration (`completion_pct` + `tt_chapter_pacing`), `teacher_pending_lesson_days` RPC (present-teacher path), the checklist component, the **logout interceptor** + **login gate**, the pacing-once-per-chapter input, coverage-cache fix. Present-teacher case only.
- **Phase 2:** absent-day / substitute resolution (`covered_by`, `substitute_confirmed`, `tt_substitutions.status='completed'`, the absent branch of the RPC + checklist).
- **Phase 3:** `> 3 unresolved days` → `dashboard_flags` escalation; the non-blocking pending-tasks list.

## 11. Non-goals

- No offline handling (accepted v1 gap).
- No general forward lesson-planning / central pacing system — pacing is teacher-set, per chapter, on demand.
- No selective per-device session revocation (global-scope logout is sufficient).
- No changes to attendance auto-mark, substitution assignment, or the coverage math outside the additive `%` field.

## 12. Risks / open items

- **Working-day source:** the RPC must use `tt_period_structures.working_days` (per class/wing) rather than the simpler Mon–Fri default in `get-working-days`, so Saturday-teaching schools aren't mis-counted.
- **"Resolved" definition:** a slot with no `tt_lesson_plans` row AND no scheduled expectation must not be forced to "not completed" — only slots that actually existed on that date count.
- **Backfill horizon:** cap "past unresolved days" to the current academic year (avoid unbounded historical sweeps); §23 pagination on the RPC's date expansion.
