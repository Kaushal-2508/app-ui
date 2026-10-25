# SALCI Olympiad — Master Decomposition Design

**Status:** Draft v1
**Date:** 2026-05-26
**Source:** SALCI_Olympiad_Build_Prompt2.docx (Phased specification v1)
**Scope:** Cross-cutting decisions that every Olympiad sub-phase must honor

This document is the architectural backbone for the SALCI Olympiad build. It is intentionally short and decision-only. Each of the five phases gets its own design + plan; this doc locks the choices that span phases so we don't rediscover them mid-build.

---

## 1. Audience and lifecycle

SALCI Olympiad is a paid, school-facing competitive exam authored centrally by SALCI super admin. The product serves two audiences:

- **Existing SALCI schools.** Olympiad appears as a feature flag inside their existing workspace. Olympiad data lives alongside (but isolated from) their regular exam data. Olympiad results are written into the student's Passport + Reports tab for permanence.
- **New (non-SALCI) schools.** Olympiad runs as a standalone campaign on its own SALCI tenant, feature-gated to show only Olympiad-relevant UI. Day 30 after results publish, student accounts go dormant. Day 60, student PII is purged and `auth.users` rows are deleted. Admin and teacher accounts persist so the school can re-run the Olympiad in future years.

The five build phases run sequentially:

| Phase | Surface | Audience |
|---|---|---|
| 1 | Super admin Olympiad catalog (campaigns, subjects, topics, questions, study materials, schools roster shell) + Features card | Super admin |
| 2 | School onboarding + public parent payment URL + payment adapter + receipts + refunds | Super admin, parents |
| 3 | School admin + teacher portals: teacher mgmt, close enrollment, batching kanban, PIN custody, absentees pool | School admin, teachers |
| 4 | Exam delivery: student login, PIN entry, exam UI, batch binding, telemetry | Students, school admin |
| 5 | Publish pipeline, PDF reports + certificates, Passport/Reports integration, 30/60-day dormancy | Students, parents, admin, scheduled jobs |

---

## 2. Data plane — parallel `oly_*` tables

Olympiad attempts persist to a parallel data plane mirroring the `hybrid_*` precedent (memory: `project_hybrid_exam_mode`). New tables (all `oly_` prefixed):

| Table | Purpose | Phase introduced |
|---|---|---|
| `oly_campaigns` | One row per campaign year. Holds default price, GST %, exam duration, questions per subject, PIN expiry, certificate thresholds, GSTIN, status. | 1 |
| `oly_subjects` | Subject catalog (Math, Science, Hindi, …). Persists across years. | 1 |
| `oly_subject_classes` | Subject × class applicability (Class 3–10). Persists across years. | 1 |
| `oly_topics` | Topic catalog per (subject, class). Persists across years; drives report analytics. | 1 |
| `oly_questions` | MCQ bank per (subject, class). Question text + 4 options in KaTeX-bearing rich text. `image_url` column exists but unused in v1. | 1 |
| `oly_study_materials` | PDF concept notes metadata. Files in Supabase Storage. | 1 |
| `oly_schools` | Joining row linking an institution to a campaign with per-school settings (price override, status, primary contact, etc.). | 1 schema, 2 form |
| `oly_students` | Enrolled students. Separate from `profiles` for non-SALCI students; `profile_id` FK when SALCI student. | 2 |
| `oly_enrollment_pending` | Temporary rows while payment is in-flight; auto-purged after 1 hour. | 2 |
| `oly_batches` | Batch schedule entries (date, time, PIN, expiry). | 3 |
| `oly_batch_assignments` | Student-to-batch mapping (strict per-batch binding). | 3 |
| `oly_attempts` | Exam attempts. Mirrors `student_exam_attempts` shape but isolated. | 4 |
| `oly_answers` | Per-question responses + telemetry. Mirrors `student_answers`. | 4 |
| `oly_results` | Computed per-student results: subject scores, total, percentage, rank-in-class, rank-in-school, certificate tier. | 5 |
| `oly_results_archive` | Anonymized retention after Day 60 PII purge. Roll number, school code, class, subjects, scores, tier. | 5 |
| `oly_audit_log` | Every student edit, removal, refund action with actor + timestamp. | 3 |

**Rationale for the parallel plane:** clean dormancy purge for non-SALCI schools (drop rows where `institution_id = X`), no risk of Olympiad data leaking into a school's regular exam analytics, RLS stays per-table without discriminator columns. Cost: ~3 new tables of mirrored attempt-shape schema. Accepted.

**Question metrics** are computed live via a SECURITY DEFINER aggregate function over `oly_attempts` / `oly_answers` rather than materialized; if hot, promote to a materialized view in Phase 5.

---

## 3. RLS pattern

Every `oly_` table is institution-scoped via SECURITY DEFINER helpers — no inline cross-table EXISTS subqueries, per CLAUDE.md §22 (question_bank recursion trap) and §23.1.

New helpers introduced in Phase 1:

- `oly_is_super_admin(uid uuid) returns boolean` (wrapper if a more permissive form is needed; defaults to existing `is_super_admin`)
- `oly_is_school_admin_for(uid uuid, oly_school_id uuid) returns boolean`
- `oly_is_teacher_for_class(uid uuid, oly_school_id uuid, class_id uuid) returns boolean`
- `oly_student_can_read(uid uuid, oly_student_id uuid) returns boolean`

RLS by role:

- **Super admin** — full read/write everywhere
- **School admin** — read own school's aggregates, write `oly_batches` / `oly_batch_assignments` for own school
- **Teacher** — read students in assigned classes for own school, write `oly_students` (cash enrollment) for assigned classes
- **Student** — read only own `oly_student` row + own `oly_attempts` + own `oly_answers` + own `oly_results`
- **Parent payment URL** — public, unauthenticated; reads `oly_schools` + `oly_subjects` for `school_code` lookup via a public RPC, never direct table access

If two `oly_` tables need to RLS-check each other (e.g. `oly_questions` × `oly_question_scope` if scope is ever added), wrap the check in a new SECURITY DEFINER helper before referencing it in policy.

---

## 4. Feature flag and routing

- **Feature flag id:** `olympiad`. Added to [featuresData.ts](../../../src/components/admin/institution-wizard/featuresData.ts) in Phase 1, category `advanced`, `isDefault: false`. Auto-renders in the Edit Institution > Features grid (Phase 1, screenshot reference).
- **Sidebar gating:** `FEATURE_URL_MAP` gets `"/school/olympiad": "olympiad"` (school admin), `"/teacher/olympiad": "olympiad"` (teacher), `"/student/olympiad": "olympiad"` (student). Super admin's `/admin/olympiad` is gated on `is_super_admin`, NOT the institution flag (super admin sees it regardless).
- **Super admin nav:** single sidebar entry "Olympiad" → `/admin/olympiad` with internal `MobileTabs`: Campaign / Subjects / Schools. Drill-into-subject opens a sub-route with internal sections Topics / Questions / Study Material.
- **School-side nav (existing SALCI schools):** single sidebar entry "Olympiad" per role, feature-gated. Visible only when `olympiad` is on for that institution.
- **New (non-SALCI) school sidebar:** institution is created with `olympiad` as the only enabled feature; the sidebar collapses naturally because all other entries are gated by their own flags. No bespoke layout needed.

---

## 5. Public parent payment URL

`salci.org/olympiad/{school_code}` is a public, unauthenticated route. It lives in the same SPA as the rest of SALCI but mounts outside `ProtectedRoute`, with no `AppLayout` / sidebar chrome. The route is added in Phase 2.

- **Domain:** the existing `salci.org` frontend (NOT `salci.sale`, per memory `project_dual_frontend_org_and_sale`).
- **Auth boundary:** the page reads no privileged data. It calls a public RPC `oly_get_public_school_payment_context(school_code)` returning `{ school_name, classes_offered, subjects_offered_per_class, base_price, gst_percent, total_price }`. The RPC is `SECURITY DEFINER` and exposes nothing else.
- **Layout:** dedicated `OlympiadPublicLayout` with SALCI logo, page-wide background. SEO meta + OG image tags for shared QR / WhatsApp previews.
- **Service Worker:** the public payment page sets `data-dirty="true"` on its form once the parent starts typing, per CLAUDE.md §17.

---

## 6. Payment adapter

Gateway-agnostic interface. Razorpay is the v1 likely choice but must not be hardcoded.

```ts
interface PaymentGatewayAdapter {
  initiateTransaction(input: { amountPaise: number; orderRef: string; payer: PayerContact }): Promise<{ transactionId: string; redirectUrl?: string; clientPayload?: unknown }>;
  verifyCallback(payload: unknown): Promise<{ ok: boolean; transactionId: string; failureReason?: string }>;
  processRefund(input: { transactionId: string; amountPaise: number; reason: string }): Promise<{ refundId: string; status: "queued" | "completed" | "failed" }>;
}
```

Two implementations land in Phase 2:

- `StubPaymentAdapter` — for local dev and CI. Always succeeds after a 500 ms delay; refunds always succeed.
- `RazorpayAdapter` — real impl backed by Razorpay's Orders + Webhooks. Secrets in Supabase Edge Function env, never frontend.

Selection driven by env: `VITE_OLY_PAYMENT_ADAPTER = "stub" | "razorpay"`. Razorpay credentials live in edge function secrets.

---

## 7. Exam engine reuse

Phase 4 reuses but does not extend SALCI's existing exam engine:

- **Imported helpers** (no fork): server-side timer logic from the existing exam edge functions, fullscreen lockdown via [src/lib/fullscreen.ts](../../../src/lib/fullscreen.ts) (CLAUDE.md §20a iOS Safari fallback), visibility-change detection, three-strike proctoring counter, session-resume on browser/PC change, telemetry capture (per-question time, attempt order, flag/unflag).
- **Diverged behavior:** writes go to `oly_attempts` / `oly_answers` keyed by `oly_student_id` (not `profiles.id`). Submissions trigger Phase-5 publish pipeline rather than the existing `final_results` write path.
- **KaTeX rendering:** student-facing question text uses `MathText` per CLAUDE.md §8. Super-admin authoring (Phase 1) uses `MathPreview`.

---

## 8. Dormancy lifecycle (non-SALCI schools only)

Daily scheduled job (Supabase scheduled edge function `oly-dormancy-pass`) introduced in Phase 5. Two-phase per student:

- **Day 30 after publish:** mark `oly_student.status = 'dormant'`, disable login, signed URLs for report/certificate PDFs stop being issued, study-material storage RLS blocks reads.
- **Day 60 after publish:** purge PII from `oly_students` (name, parent contact, DOB), copy anonymized result into `oly_results_archive`, delete the student's `auth.users` row (cascade chain per CLAUDE.md §21), delete report + certificate + study-material storage entries.

Admin and teacher `auth.users` rows are untouched. The institution row survives in case the school re-runs the campaign next year.

For **SALCI students**, the dormancy lifecycle is different and lives in the SALCI app, not the Olympiad surface:

- **Day 30:** the dedicated "Olympiad" sidebar tab disappears from the student portal. Olympiad-specific study material and per-question review are gone.
- **Permanent retention:** Passport entry (subjects, scores, rank, tier, year) + Reports tab document (the result PDF, downloadable alongside other exam reports). The student's main SALCI account is otherwise untouched.

---

## 9. Money display

A central helper `formatOlympiadFee(basePaise: number, gstPercent: number): { base: string; gst: string; total: string }` renders all three components. Every Olympiad UI surface displays `₹X + 18% GST = ₹Y` — never raw rupee literals, never just the total. Required by the docx for transparency and GST audit hygiene.

---

## 10. Error handling and code-quality contract

- Every onError / catch-toast routes through `toastError(err, { fallback, context })` from [src/lib/toast.ts](../../../src/lib/toast.ts), per CLAUDE.md §6/§19. Raw Postgres strings must not leak.
- Every edge function call goes through `invokeAdminOperation` or equivalent wrapper per CLAUDE.md §21 (the `error.context` Response unwrap).
- §5a zero-error contract applies: `npx tsc --noEmit`, `npx eslint <changed-paths>`, `npx vite build` must all exit 0 on every touched file.
- §23 high-concurrency rules apply to every new hook: explicit `staleTime`, no `select("*")` outside admin code, pagination on every list query, no `supabase.auth.getUser()` without a JWT argument, every new FK indexed in the same migration.

---

## 11. Copy and UX rules (per docx)

- No em-dashes in user-facing copy. Use commas, periods, or parentheses.
- Use "we" not "I".
- No references to Fees or HR modules in any Olympiad-facing UI (non-SALCI schools shouldn't see those concepts).
- All money displayed as `₹X + 18% GST = ₹Y` breakdown (see §9).
- Forms with unsaved input set `data-dirty="true"` so the Service Worker doesn't auto-reload them (CLAUDE.md §17).

---

## 12. Things explicitly excluded from v1 — flag and stop if asked

Per docx, these are intentional non-goals. If a phase plan includes any of them, stop and surface the conflict before writing code:

- Image-based questions (text + KaTeX only)
- Mock exams / practice question interfaces
- Video lessons
- National rankings or cross-school benchmarking
- Re-publish capability
- Question audit / flagged question review at publish
- Bulk enrollment from existing SALCI student roster
- SMS or WhatsApp notifications (email only)
- Recheck or score dispute mechanism
- Multi-language support (English only)
- Subject-wise certificates or subject-wise ranks
- Live invigilation dashboard for teachers
- Negative marking
- Difficulty buckets in question pool
- Mid-campaign batch reassignment of students between main batches
- Refund for students who didn't attempt despite enrolling

---

## 13. Acceptance criteria for this master decomposition

- Every cross-cutting decision in §2–§11 is locked. Phase specs reference this doc and do not re-litigate these.
- Each of the five phases has a tracked spec path under `docs/superpowers/specs/` once written.
- Phase 1 spec exists at `docs/superpowers/specs/2026-05-26-olympiad-phase-1-super-admin-catalog-design.md`.
- A future phase that wants to override a master decision must amend this doc first, with the rationale captured in the amendment commit.
