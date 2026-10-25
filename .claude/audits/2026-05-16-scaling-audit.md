# SALCI Scaling Audit — 2026-05-16

Five parallel read-only agents audited the codebase against CLAUDE.md §23 (high-concurrency rules) after the 2026-05-16 incident. This document captures all findings as the canonical reference. Updates to this file go into a follow-up audit document, not here — this is a snapshot of state at 2026-05-16.

## Headline numbers

| Audit | Critical | High | Medium | Low |
|---|---|---|---|---|
| Database query patterns | 17 | 14 | 4 | 1 |
| React Query / hooks | 2 | 7 | 4 | 1 |
| Bundle size / lazy-load | 4 | 6 | 4 | 3 |
| RLS / migrations | 4 | 10 | 5 | 1 |
| Edge functions | 12 | 13 | 10 | 5 |
| **TOTAL** | **39** | **50** | **27** | **11** |

## Cross-cutting root causes (a small number of bugs cause many findings)

1. **`supabase.auth.getUser()` called from 168 sites across 95 files** — same anti-pattern that caused the incident. Monkey-patch in client.ts contains it but new code keeps adding to the pile.
2. **QueryClient created with default options** in `src/App.tsx:115` — single fix that affects every `useQuery` in the app.
3. **71 of 75 routes statically imported** in `src/App.tsx` — single mechanical refactor that should drop the bundle by 5–8×.
4. **5–6 edge functions accept paid AI/email work without any auth check** — actual security/cost-abuse holes, not just performance.
5. **Multiple `FOR ALL USING (true)` RLS policies** — cross-institution data leakage / write paths open to any authenticated user.
6. **N+1 patterns inside edge functions** (snapshot-student-passport, send-task-notifications, compute-aggregates, send-communication, send-welcome-email, process-ocr-upload, promote-students) — each is a per-region concurrency cliff at scale.
7. **Heavy libraries (xlsx, jsPDF, html2canvas, KaTeX, recharts, face-api.js) statically imported** in many sites — main bundle bloat.

## Audit 1 — Database query patterns

### Critical (17)

- `useDashboardData.ts:154,241,308,392,456,474` — 6 `auth.getUser()` calls in role-dashboard hooks
- `useTasks.ts` — 9 `auth.getUser()` calls
- `useTimetableV2.ts` — 8 `auth.getUser()` calls
- `useEvaluations.ts` (5), `useExamData.ts` (4), `useConversations.ts` (4), `useScanSheetsData.ts` (4), `useOfflineMarks.ts` (4), `useNotifications.ts` (3), `useExamClassHierarchy.ts` (3), `useInstituteSyllabus.ts` (3), `useRechecks.ts` (3), `useLearningActions.ts` (3), `useLeaveRequests.ts` (3)
- `SettingsPage.tsx:232,289,310,420,454` — 5 raw `auth.getUser()` calls in a single page
- `src/lib/timetableCompat.ts:138` — util-layer call defeats helper migration
- `useAnalytics.ts:17-24` — unbounded `student_exam_attempts` query, `select("*")` with joins
- `useAnalytics.ts:198-235` — unbounded chain through `attempt_question_telemetry → student_answers → exam_questions`
- `useAnalytics.ts:600-614` — unbounded `profiles select("*")`
- `useExamResults.ts:74-79, 243-279, 354-369` — pulls all attempts for a class with no `range()`
- `ViewUserSheet.tsx:134, 303` — all `student_exam_attempts` for a user, no limit
- `HybridEvaluationListPage.tsx:35-51` — every hybrid attempt unpaginated
- `useAttendance.ts:66-71` — `attendance_records select("*")` unbounded
- `useAttendanceReports.ts:199-206` — every attendance row over an arbitrary date range
- `ClassSectionSelector.tsx:122` — `.limit(2000)` defeats pagination
- `useAnalytics.ts:239-243, 449-456` — client-side `.filter(...).length` for status counts
- `useDashboardData.ts:23-27` — client-side `forEach` for `examsByStatus`
- `App.tsx:115` — `new QueryClient()` with default options (also cross-audit finding)

### High (14)

- `useExamResults.ts:253-264` — N+1 `for (const attempt of attempts)` doing individual UPDATEs
- `useAIQuotaDashboard.ts:236-249` — N+1 select + update/insert in loop
- `useAnalytics.ts:42-46, 614, 218-220` — `select("*")` on `final_results`, `student_exam_attempts`, `attempt_question_telemetry`
- `SchoolCoordinatorsPage.tsx:100-101` — `profiles select("*")` in school-admin path
- `useClassDetailAnalytics.ts:32`, `useComprehensivePrincipalAnalytics.ts:130,168`, `useTeacherDetailAnalytics.ts:42`, `useSubjectDetailAnalytics.ts:50`, `useComprehensiveTeacherAnalytics.ts:164-172` — `select("*")` in role-scoped analytics
- `useEvaluations.ts:145-147` — `select("*")` on `ai_evaluations`, `teacher_overrides`, `evaluation_blueprints`
- `useDashboardData.ts:398, 461, 492` — three more `select("*")` in dashboard hooks
- `useClassGroups.ts:77,150,213,253`, `useClasses.ts:30`, `useClassGroupSubjects.ts:132`, `useCoordinatorClasses.ts:209,229` — repeated `select("*")` on hot list endpoints
- `ComprehensiveStudentDashboard.tsx:111` — 30s `refetchInterval` no justification
- `ExamWindowStatus.tsx:38, 54, 261` — three 30s polls on the same page
- `ProctoringAlertsBadge.tsx:19` — 30s poll on every page rendering the badge
- `useAnalytics.ts:443-446` — `.in("id", studentIds)` with no chunk guard

## Audit 2 — React Query / hooks

### Critical (2)

- `App.tsx:115` — QueryClient default config missing (cross-cutting; see above)
- `useHybridAttempt.ts:384` — 5s poll on `hybrid_answer_sheet_pages` not on sanctioned exceptions list

### High (7)

- `useExamResults.ts:227`, `ExamWindowStatus.tsx:38, 54, 261` — four 30s polls on `student_exam_attempts`, no justification
- `ProctoringAlertsBadge.tsx:19` — 30s poll without justification
- `ComprehensiveStudentDashboard.tsx:111` — 30s poll wrapping per-participant count loop
- `useNotifications.ts:24, 44` — 60s poll alongside Realtime invalidation (redundant)
- `useAutoGrading.ts:86` — 10s `setInterval` on `student_exam_attempts`
- `useOnboardingJourney.ts:109` — `refetchOnWindowFocus: true` on milestone join
- ~228 files use `useQuery`; only ~26 reference `staleTime` — rest rely on default-0

### Verified clean

- Singleton Supabase client confirmed (only one `createClient`)
- All Realtime `.subscribe()` sites have `removeChannel` cleanup — no leaked sockets
- All `setInterval` sites have matching `clearInterval` cleanup
- Sanctioned 5s polls confirmed: `LiveProctoringPage.tsx:156`, `useOfflineScan.ts:421`

## Audit 3 — Bundle size

### Stats

- **71 of 75 routes** in `src/App.tsx` are statically imported (only `SettingsPage`, `PRDPage`, `CommandCenterPage`, `OnboardingDashboardPage` are lazy)
- **Top 5 heaviest libs at module-top-level:** `xlsx` (~400 KB gzip, 12 import sites), `recharts` (~95 KB, 19 sites), `html2pdf.js` jsPDF+html2canvas (~250 KB, 5 static), `katex` (~120 KB + 22 KB CSS, 3 static), `face-api.js` (~250 KB + TF.js, 1 site reaching proctoring/exam)
- `framer-motion` (~50 KB) on `Login`, `ForgotPassword`, `ResetPassword` for trivial fade-ins

### Critical (4)

- `App.tsx:15-113` — 71 static `pages/*` imports → convert all to `React.lazy()`
- `xlsx` static in `AttendanceAnalytics.tsx:14`, `FeeAnalyticsDashboard.tsx:6`, `PayrollRunPanel.tsx:12`, `SchoolTeachersPage.tsx:68` — analytics chunks shouldn't pay XLSX cost
- `xlsx` static in 8 Bulk* dialog files — should be `await import("xlsx")` inside handler
- `html2pdf.js` static in `ComprehensiveTeacherDashboard.tsx:46`, `ComprehensivePrincipalDashboard.tsx:57`, `ComprehensiveStudentDashboard.tsx:61`, `OnboardingDashboardPage.tsx:2`, `ResultDetailsSheet.tsx:46`

### High (6)

- `katex` + CSS static in `math-text.tsx:2-3`, `math-preview.tsx:2-3`, `renderMathInHtml.ts:1`
- `recharts` static across 19 components
- `face-api.js` static in `useFaceDetection.ts:2`
- `framer-motion` static in `Login.tsx:3`, `ForgotPassword.tsx:3`, `ResetPassword.tsx:3`
- `<Routes>` not wrapped in a single Suspense fallback (needed once C1 applied)
- 5 static + 9 dynamic `html2pdf.js` sites — inconsistent (the 5 statics defeat the others)

### Medium

- `RoleBasedDashboard.tsx:2-6` — statically imports every role's dashboard
- `chart.tsx:2` — `import * as RechartsPrimitive` defeats tree-shaking, one consumer
- `react-joyride` static in `GuidedTourProvider.tsx:2`
- `SyllabusPage` 681-LOC admin-only page in main chunk

## Audit 4 — RLS / migrations

### Stats

- 188 migration files audited
- SECURITY DEFINER helpers found and approved: `has_role`, `has_role_at_institution`, `get_user_institution`, `get_user_institution_secure`, `is_super_admin`, `has_super_admin_access`, `is_institution_admin`, `is_assigned_to_class`, `is_teacher_for_class`, `is_coordinator_for_class`, `is_teacher_for_exam_class_subject`, `can_create_tasks`, `can_manage_subjects`, `is_exam_creator`, `is_exam_modifiable`, `is_assigned_to_exam_class`, `get_exam_institution`, `get_attempt_*`, `can_evaluate_attempt`, `is_attempt_finalized`, `get_answer_attempt_id`, `is_exam_attemptable`, `is_student_assigned_to_exam`, `get_class_institution`, `question_has_section_scope`, `user_is_in_question_scope`, `get_question_institution_id`, `tt_slot_has_substitute_for`, `tt_slot_institution`, `tt_user_can_edit_slot`, `is_task_supervisor`, `get_task_*`, `task_has_evidence`, `is_conversation_participant`, `get_student_class_group_ids`

### Critical (4) — SECURITY HOLES

1. **`school_custom_topics` wide-open writes** — `20260105095241:55-77` — Insert/Update policies don't scope to caller's institution; a teacher in institution A can mutate institution B's topics
2. **`badge_progress`, `user_activity_log`, `student_passport` `FOR ALL USING (true)`** — `20260112051733:106,110,117` — any authenticated user can write any row in any institution
3. **`task_links` FK columns unindexed** — `20260104113057:151-165` — `class_id`, `subject_id`, `student_group_id`, `exam_id` all FK to large tables with no indexes
4. **`institution_features.institution_id` unindexed** — `20260226104611` — `useInstitutionFeatures` fires on virtually every authenticated route; seq-scan per request

### High (10)

- `school_custom_topics` + `exam_topics` SELECT use `IN (SELECT … FROM profiles)` instead of `get_user_institution()`
- `onboarding_snapshots` SELECT same inline pattern
- `user_badges` / `student_passport` staff policies inline `EXISTS (SELECT 1 FROM user_roles)` instead of `has_role()`
- `hybrid_exam_attempts.evaluated_by`, `hybrid_question_marks.{marked_by,question_id}`, `hybrid_sheet_annotations.created_by`, `hybrid_exam_attempt_logs.actor_id` — unindexed FKs to profiles (delete-cascade scan)
- `task_evidence.{task_id, uploaded_by}`, `task_audit_logs.actor_id` — unindexed
- `tt_lesson_plans.{class_id, chapter_topic_id, updated_by, created_by, institution_id}` — unindexed
- `tt_slots.{created_by, institution_id}` — unindexed
- `hybrid_pairing_tokens.institution_id` — unindexed
- `notify_new_message` trigger on `conversation_messages` — uncached subselect on hot table
- `handle_new_user` trigger — synchronous profile insert on `auth.users` insert with no error handling

### Medium

- `task_links.exam_id` is a "soft FK" (TEXT comment) with no actual FK constraint
- `system_audit_logs.actor_id` defaults to `NO ACTION` — violates §21 cascade contract
- Cosmetic: many migrations `DROP POLICY IF EXISTS` + `CREATE POLICY` with same name
- `wing_class_mappings` policies inline `EXISTS (SELECT 1 FROM wings)` — fragile to future RLS additions on `wings`
- `check_blueprint_completeness` trigger does full anti-join on every blueprint write

## Audit 5 — Edge functions

### Critical (12)

- **C1.** `generate-questions` synchronous LLM call (known)
- **C2.** `process-ocr-upload:276` — 10–30s synchronous Gemini Vision + 3N per-question DB calls
- **C3.** `snapshot-student-passport:32-44` — unbounded student loop, 6+ sequential queries per student
- **C4.** `send-task-notifications:28-43,69-83,131-143` — unbounded `tasks` queries, no `range()` (silently drops at 1000 rows)
- **C5.** `generate-principal-tasks:113-121,193-211` — unbounded pendingExams + N+1 per-exam counts
- **C6.** `compute-aggregates:39,54-72,123-133` — unbounded exam list + per-snapshot UPDATE in series (1200 sequential writes for 30×40 exam)
- **C7.** `promote-students:126-151` — serial delete+insert per student (1000 round-trips for 500 students)
- **C8.** `tt-notify-absence-pending:78-98` — N+1 `tt_lesson_plans` lookups
- **C9.** `process-ocr-upload:114-133,365-437` — two per-question loops with serial upserts
- **C10.** `send-communication:184-212` — serial provider fan-out, 60–120s per 1000 recipients
- **C11.** `send-welcome-email:167-202` — serial Resend loop on bulk-onboard
- **C12.** `snapshot-student-passport:36-44` — `.in(id, (await fetch...).data)` builds array from unbounded `user_roles` fetch

### High (13) — INCLUDES SECURITY ISSUES

- **H1–H4.** No rate limiting on `generate-questions`, `mascot-chat`, `generate-principal-ai-insights`, `process-ocr-upload` — paid-API abuse vector
- **H5.** `mascot-chat:14` — no auth check, trusts client-supplied `userRole` → privilege escalation to other system prompts
- **H6.** `generate-principal-ai-insights:11` — no auth check, anonymous can burn Lovable AI credits
- **H7.** `admin-operations:390,394` — password length logged to console
- **H8.** `send-fee-reminder:139-144` — swallows error as generic 500, real Postgres error lost
- **H9.** `mark-biometric-attendance:113-117` — swallows errors generically
- **H10.** `promote-students:118-120` — snapshot failure logged-and-ignored before destructive promotion
- **H11.** `admin-operations:182`, `publish-hybrid-marks:71`, `generate-hybrid-pairing-token:78` — `getUser()` without explicit JWT inside edge functions (same anti-pattern as frontend)
- **H12.** `send-task-notifications:55-65,95-124,162-170,226-234` — per-task `notifications.insert` (up to 1500 sequential for 500 overdue tasks)
- **H13.** `tt-notify-substitute:36` — write-amplifying function with no rate limit on mass substitutions

### Medium (10)

- `mascot-chat:14` — no input validation, `messages.slice(-6)` throws on non-array
- `send-communication:29-50,88-145` — no provider key validation, raw error pass-through
- `import-syllabus:10-99` — 90-line hardcoded dataset bloats every deploy + cold start
- Inconsistent error response shapes across functions
- `supabase-js` version drift across functions (2.39.3, 2.89.0, "@2" floating)
- `import-syllabus:101` — no auth check (super_admin only function open)
- `compute-aggregates:23` — no auth check
- `process-ocr-upload:130-132,402-404,435-437` — per-question failure logged but `success: true` returned
- `import-syllabus-csv:286-300` — per-row fallback after batch failure (explosive retry)
- `mascot-chat:16-19` — env validation inside request handler not at module top

### Low (5)

- Multiple `any`-typed handler params (violates project §5a)
- `invite-admin` duplicates email-template HTML with `send-welcome-email`
- `generate-principal-tasks` joined-row `as any` casts
- `tt-notify-absence-pending:46` — no `WEBHOOK_SECRET` guard
- `get-working-days:103-105` — no auth check, info leak on AY calendar by UUID guessing

---

## Master prioritization

### Tier 1 — Security + zero-risk single-line wins (do first, ~2 hours)

These are either security holes that must close, or one-line changes that drop tons of load.

1. **Add JWT + role check to `mascot-chat`** (currently anonymous, accepts user-controlled role)
2. **Add JWT + super_admin check to `generate-principal-ai-insights`** (currently anonymous AI burn)
3. **Add JWT check to `process-ocr-upload`** (currently anonymous Gemini burn)
4. **Add JWT check to `import-syllabus`, `compute-aggregates`, `get-working-days`**
5. **Add `WEBHOOK_SECRET` guard to `tt-notify-absence-pending`** (currently unauth)
6. **Remove password-length `console.log` from `admin-operations:390,394`**
7. **Fix `school_custom_topics` RLS** (cross-institution write hole)
8. **Fix `badge_progress`, `user_activity_log`, `student_passport` `FOR ALL USING (true)`** (cross-institution write/read)
9. **Set QueryClient defaults in `App.tsx:115`** — `staleTime: 60_000, refetchOnWindowFocus: false, retry: 1`. Single 1-line change, massive effect.
10. **Add indexes**: `institution_features.institution_id`, `task_links.*`, `hybrid_*` profile FKs, `task_evidence.*`, `tt_lesson_plans.*`, `tt_slots.{institution_id,created_by}`, `hybrid_pairing_tokens.institution_id`

### Tier 2 — Mechanical wins (this week, ~1–2 days)

11. **Lazy-load 71 routes in `App.tsx`** — single file refactor, biggest bundle win
12. **Move `xlsx`, `html2pdf.js`, `katex`, `face-api.js` to dynamic imports** at usage sites
13. **Replace `framer-motion` on public auth pages with CSS animations**
14. **Bulk-replace `select("*")` in dashboard/analytics hooks with explicit column lists**
15. **Drop `useNotifications` 60s poll** (Realtime already invalidates)
16. **Add justification comments or raise to 60s** on every 30s `refetchInterval`
17. **Disable `refetchOnWindowFocus: true` in `useOnboardingJourney`**

### Tier 3 — Refactors (next sprint, ~1 week)

18. **Migrate 168 `supabase.auth.getUser()` to `getCurrentUser()`** — file by file
19. **Add cursor pagination to all unbounded list queries** (`useExamResults`, `useAnalytics`, `useAttendance`, `useAttendanceReports`, `HybridEvaluationListPage`)
20. **Bulk-replace edge function `for` loops with `upsert` arrays** (promote-students, send-task-notifications, compute-aggregates)
21. **Add per-user rate limiting to AI edge functions** (token-bucket like `resolve-login-identifier`)
22. **Standardize edge function error response shape** to `{ ok: false, code, message }`
23. **Pin all edge functions to `supabase-js@2.89.x`**

### Tier 4 — Architectural (months, ongoing)

24. **Move long-running edge functions to enqueue + poll pattern**:
    - `generate-questions`, `process-ocr-upload`, `snapshot-student-passport`, `send-communication`, `send-welcome-email`
25. **Replace client-side aggregations with server-side RPCs / materialized views**:
    - Dashboard `examsByStatus` counts, principal performance metrics, attendance reports
26. **Add Sentry + release tagging**
27. **Add `rollup-plugin-visualizer` to CI** + bundle-delta gate
28. **Set up k6 load tests** for hot endpoints
29. **Upgrade Supabase compute** to Medium ($60/mo) before approaching 1K concurrent users, Large before 10K

---

## What the auditor agents verified clean

- Singleton Supabase client confirmed (single `createClient` call)
- All Realtime `.subscribe()` sites have `removeChannel` cleanup
- All `setInterval` sites have matching `clearInterval` cleanup
- Sanctioned 5s polls (`LiveProctoringPage`, `useOfflineScan`) confirmed
- No new RLS recursion candidates found (question_bank + tt_slots fixes are the only ones needed)
- All public tables have `ENABLE ROW LEVEL SECURITY` (one caveat: `task_links`/`task_evidence` ENABLE confirmed in later migrations)

## Cost / token expense of this audit

Total agent token usage: ~537K tokens across 5 parallel agents over ~256 seconds. Roughly $5–10 in API cost depending on cache rate. Worth saving this document so we don't have to repeat.