---
name: olympiad-module
description: SALCI Olympiad subsystem — oly_* tables, 27 oly-* edge functions, enrollment/payment (money in RUPEES), batches, PIN custody, student attempts, results publish pipeline, onboarded (non-SALCI) school lockdown. Use when touching anything matching oly_*/oly-*, src/pages/{admin,school,student,teacher}/olympiad/, src/hooks/olympiad/, src/components/olympiad/, Razorpay payment flows, or olympiad-only institution gating.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Olympiad Module

A full parallel subsystem (campaign → enrollment → payment → batching → PIN-gated attempts → publish) built May–June 2026. It does NOT reuse the school exam tables — everything lives in `oly_*`.

## Surface map

* **DB:** 23 `oly_*` tables across phase migrations `2026052*_oly_phase_*.sql`: catalog (`oly_campaigns`, `oly_subjects`, `oly_subject_classes`, `oly_topics`, `oly_questions`, `oly_study_materials`, `oly_schools`), enrollment (`oly_students`, `oly_enrollment_pending`, `oly_receipts`, `oly_refunds`), operations (`oly_teacher_class_assignments`, `oly_audit_log`, `oly_batches`, `oly_batch_assignments`, `oly_reminder_log`, `oly_pin_attempt_log`), attempts (`oly_attempts`, `oly_questions_snapshot`, `oly_answers`, `oly_attempt_events`), publish (`oly_results`, `oly_publish_jobs`) + `passport_olympiad_entries`.
* **Edge functions:** 27 `oly-*` under `supabase/functions/` (onboard-school, create-teacher, cash-enroll, payment-create-order, payment-webhook, close-enrollment, dormancy-pass, lock-batch-schedule, publish-school-results + its 4 children, receipt-generate, refund-issue, student-edit, student-remove, impersonate-school-admin, question-csv-import, etc.).
* **Frontend:** 30 pages under `src/pages/{admin,public,school,student,teacher}/olympiad/` (school side wrapped by `OlympiadSchoolShell`), 68 hooks in `src/hooks/olympiad/`, components in `src/components/olympiad/{admin,exam,public,school,student,teacher}`.

## Money is RUPEES, not paise (migration 20260609130000_oly_money_paise_to_rupees.sql)

All `*_paise` columns were renamed to `*_rupees` (numeric, value ÷100) on 2026-06-09. Razorpay's ×100 paise conversion happens ONLY at the gateway boundary: `oly-payment-create-order`, `oly-refund-issue`, and the razorpayAdapter. `formatOlympiadFee` in the money lib takes rupees. **Never reintroduce paise in DB columns, RPCs, or UI math** — a stray ×100/÷100 silently corrupts fees.

## Results publish pipeline needs OLY_INTERNAL_SECRET

`oly-publish-school-results` is an orchestrator that calls child functions (`oly-generate-result-pdf`, `oly-send-results-email`, `oly-generate-certificate-pdf`, `oly-create-passport-entry`) authenticated by the `OLY_INTERNAL_SECRET` project secret (set on prod 2026-06-08). All 5 functions read it. If a new child fn is added it must check the same secret, and **after setting/rotating the secret, redeploy orchestrator + all children** or publish 500s. Publish progress is tracked in `oly_publish_jobs` (poll via `useOlympiadPublishJob`).

**Scoped publish + auto-merge (20260612110000).** `oly_publish_initiate` / `oly_publish_compute_ranks` take optional `p_grade_level_ids` / `p_batch_ids`. A scoped run publishes only those classes/batches and does NOT flip `oly_schools.status` (remaining batches keep running); only the whole-school publish is final. Every run merges: absent rows whose student has since sat are upgraded to real scores (PDF paths + `emailed_at` reset), and ranks are recomputed school-wide — rank-moved rows get `result_pdf_path` nulled so the orchestrator regenerates them (emails NOT resent). On scoped runs, in-scope students with a FUTURE pending batch are not marked absent. `oly_publish_jobs` stays exactly ONE row per school — the run's scope lives in `scope_grade_level_ids`/`scope_batch_ids` on that row (orchestrator reads them from the claim); a stale-aware guard (active status + updated_at < 10 min) rejects overlapping runs. Don't add a second job row per scope, and don't reintroduce all-students absent-marking on scoped paths.

## Onboarded (non-SALCI) school flow

`oly_schools.is_existing_salci_school` distinguishes existing SALCI schools (true) from externally onboarded ones (false).

* **profiles upsert invariant (fixed + backfilled 2026-06-08):** the `handle_new_user` trigger pre-creates a `profiles` row on `auth.admin.createUser`. `oly-onboard-school` / `oly-create-teacher` originally did a bare INSERT into profiles that silently conflicted, leaving `institution_id` NULL → admin saw "(school)" and an empty teacher roster. They now **upsert on id**. NEVER bare-INSERT profiles after `createUser` — upsert with `onConflict: "id"`.
* Teacher creation returns a `temp_password` surfaced once in `AddTeacherSheet`; `oly-reset-teacher-password` regenerates.
* **Olympiad-only lockdown:** `useIsOlympiadOnlyInstitution` (`src/hooks/olympiad/useIsOlympiadOnlyInstitution.ts`) locks onboarded schools to a single Olympiad tab — enforced in `AppSidebar.tsx`, `RoleBasedDashboard.tsx`, and `ProtectedRoute.tsx`. It must NEVER affect super admins or existing SALCI schools. Frontend-only gating; `oly_students`' timestamp column is `enrolled_at` (not created_at).
* Super-admin page `/admin/non-salci-schools` lists onboarded schools' students + teachers.

## Enrollment closure (scheduled, IST end-of-day)

`oly_schools.enrollment_closes_at` (20260602125000) + `oly_enrollment_is_open()` RPC gate every enrollment write. `CloseEnrollmentDialog` supports schedule / close-now / cancel; `useCloseEnrollment` takes a mode param; `oly-close-enrollment` implements the three modes; `oly-dormancy-pass` (cron) auto-advances scheduled closures. The public payment/enrollment context also respects the deadline (20260602125001). Dialog re-syncs its date only on open, not on refetch — don't "fix" that. Semantics are IST end-of-day.

## Cash-enroll roster flow (existing SALCI schools)

Teacher/admin enrolls existing students from the SALCI roster instead of free-typing:
* RPC `oly_list_salci_roster_for_grade` (20260606120100) — case-insensitive admission-number matching; `::text` casts on varchar columns (42804 fix, commit ce0e6f7).
* `oly_lookup_salci_student` reads DOB from `student_personal_details` (20260606120200), not profiles.
* `useOlympiadSalciRoster` + `useOlympiadCashEnroll`; the input carries `profile_id`, and `oly-cash-enroll` writes DOB/guardian back to `student_personal_details` (best-effort upsert on profile_id — a write failure must never fail the enrollment). `already_enrolled` guard + duplicate-guard queries are typed, not `any`.
* The teacher class page passes `isExistingSalciSchool` so the sheet picks roster vs free-form mode.

## Batch Builder v2 (manual two-panel)

The Batches tab is a manual builder, not auto-generation — `oly-generate-batch-schedule` is **dormant** (don't wire it back). Components: `BatchBuilderCard` (date/time + class chunks + capacity), `AddClassMenu` (rule-aware disabling), `RemainingPanel` (live per-class remaining + lock gate); seating uses pure whole-class-fill logic; roster paginated via `useOlympiadBatchingRoster`. Capacity comes from `oly_schools.pc_count` (20260609120000, `useUpdateOlympiadPcCount`). **Mixed batches use NULL `grade_level_id`** on locked batches (20260609 migration `oly_phase` series allows it) — don't add a NOT NULL back.

## RLS / SQL gotchas (all already fixed once)

* **`oly_batches` ↔ `oly_batch_assignments` recursion (42P17):** fixed in 20260606150000 with SECURITY DEFINER helpers — same trap as question_bank. Never inline cross-table EXISTS between these two.
* **`oly_schools` teacher SELECT policy:** a bare `id` in the subquery resolved to the wrong table (20260606130000). Qualify columns in policy subqueries.
* **`oly_question_bank_view`:** uses `to_jsonb(...)` — `row_to_jsonb` does NOT exist in Postgres (20260609150000).
* Roster/RPC functions returning `RETURNS TABLE(... text ...)` must `::text`-cast varchar profile columns or they 42804 at runtime.

## Student attempt flow

PIN-gated (`oly_pin_attempt_log`, PIN custody page is admin-only — coordinators are blocked from the PIN tab route). Questions are snapshotted per attempt into `oly_questions_snapshot`; answers in `oly_answers`; proctoring-ish events in `oly_attempt_events` (`useOlympiadRecordEvent`). Student auth is phase-4a custom (optional-DOB login since 20260608140000; `oly-backfill-student-auth` for legacy rows). On the last question the UI shows **Submit** in place of the disabled Save & Next (d36fe83). Report tab KPIs come from the school report RPC (20260609140000, `useOlympiadSchoolReport`).

## School-side shell

`OlympiadSchoolShell` is a tabbed wrapper; the 4+ school olympiad pages render inside it WITHOUT their own `PageShell` (stripped in 351ead1); the sidebar shows ONE olympiad entry. New school-side olympiad pages must nest under the shell (route + tab), not as standalone sidebar items. Suspense lives in the shell.