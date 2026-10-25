# SALCI Olympiad Super-Admin Module Restructure — Design

**Status:** Approved (design gate) — 2026-05-27
**Author:** Olympiad build continuation
**Depends on:** the shipped Olympiad module (Phases 1–5b on branch `olympiad/phase-1`)
**Scope owner surface:** `/admin/olympiad/*` (super-admin only)

This restructures the existing super-admin Olympiad surface. It is a reorganization + targeted additions on top of the already-shipped catalog/enrollment/exam/publish stack. No change to the student/teacher/school-admin Olympiad surfaces except where noted (managed-mode access reuses existing school pages; onboarding auto-gen affects the onboard edge function).

---

## 1. Goals

1. Move **Campaign** out of the tab strip into a top-right **"Campaign Settings"** button (sheet).
2. Reduce the main tab strip to two tabs: **Schools** (default) and **Exam Settings** (the old "Subjects" tab, renamed and inverted to class-first). The standalone Subjects tab is removed.
3. **Schools** becomes three sub-tabs: **Onboard school** (default), **Olympiad in progress**, **Olympiad done**, each with the behaviors in §4.
4. **Exam Settings** becomes class-first navigation over the existing grade-level-keyed catalog (§5).
5. New-school onboarding **auto-generates** the institute code + school short code and **auto-creates** the school-admin login usable at salci.org (§6).

## 2. Confirmed decisions (from brainstorming)

| Decision | Choice |
|---|---|
| "Class" model in Exam Settings | **Reuse grade levels** (no new entity/table). A class = a grade level (3–10). |
| "Olympiad done" boundary | **Done = exams finished** (exam-completed-or-later, not gated on publish). |
| School-admin dashboard access | **In-app managed mode** (`startManaging`), not magic-link. |
| Online gateway-detail depth | **Deferred** — stored IDs only now; live Razorpay fetch after QA/QC. |

## 3. Admin shell restructure

**File:** `src/pages/admin/olympiad/OlympiadAdminPage.tsx` (+ a new Campaign Settings sheet wrapper).

- The `TABS` array drops to two entries: `{ label: "Schools", to: "/admin/olympiad/schools" }`, `{ label: "Exam Settings", to: "/admin/olympiad/classes" }`. `resolveActive()` updated to match these two prefixes.
- The `/admin/olympiad` index route **redirects to `/admin/olympiad/schools`** (Schools is default).
- A **"Campaign Settings"** button is added to `PageHeader` (via `primaryAction` or the `extras` slot). It opens a new `CampaignSettingsSheet` (`MobileSheet`) whose body renders the **existing** `CampaignSettingsForm` + the historical-campaigns list currently in `OlympiadCampaignTab`.
- `OlympiadCampaignTab.tsx` is retired as a route target; its content moves into `CampaignSettingsSheet`. The `useOlympiadCampaigns` / `useUpsertOlympiadCampaign` hooks are unchanged.

**Routing changes in `App.tsx`:** the nested children under `/admin/olympiad` become `schools` (+ `schools/:olySchoolId`) and `classes` (+ `classes/:gradeLevelId` + `classes/:gradeLevelId/subjects/:subjectId`). The old `/subjects` + `/subjects/:subjectId` routes are replaced by the class-first routes (see §5). Feature-gating: `/admin/olympiad*` is super-admin-only via `ProtectedRoute`; not institution-feature-gated (platform-level surface).

## 4. Schools tab — three sub-tabs

Container: `OlympiadSchoolsTab.tsx` renders a nested `MobileTabs` strip (Onboard / In progress / Done) plus the campaign-year `Select` it already has (the year filter scopes all three sub-tabs).

### 4.1 Onboard school (default sub-tab)

- The onboarding **form rendered inline** in the tab panel. The form body currently inside `OnboardSchoolSheet.tsx` is lifted into a reusable `OnboardSchoolForm` component; the sheet wrapper is no longer used on this surface.
- On success: render the existing `PublicPaymentLink` plus a **new-admin credentials panel** showing the created school-admin email + password-reset link (from the onboard edge-function response — see §6).

### 4.2 Olympiad in progress

- Lists schools whose **derived stage** (§4.4) is `enrollment` / `exam_scheduled` / `exam_in_progress`.
- A `FilterChip` toggles **New schools** (`oly_schools.is_existing_salci_school = false`) vs **Onboarded / existing** (`= true`). Default: all.
- Rows are `SchoolListRow` (existing), clickable → `/admin/olympiad/schools/:olySchoolId` (in-progress detail mode).
- Data via `oly_schools_by_stage(campaign_id, 'in_progress', school_type)` (paginated, §7).

### 4.3 Olympiad done

- Lists schools whose derived stage is `exam_completed` or later (incl. `results_published`, `archived`).
- Rows clickable → same detail route (done detail mode).
- Data via `oly_schools_by_stage(campaign_id, 'done', school_type)`.

### 4.4 Derived stage (no new status column)

`oly_schools.status` has: `enrollment_open, enrollment_closed, batches_scheduled, exam_in_progress, results_published, archived`. There is no stored "exam completed" state. **Stage is derived** in the `oly_school_overview` RPC (§7) — chosen over adding a status column because a new column would require re-wiring the status-transition logic across the shipped Phases 2–5.

Derivation:

| Derived stage | Condition |
|---|---|
| `enrollment` | `status IN ('enrollment_open','enrollment_closed')` |
| `exam_scheduled` | `status = 'batches_scheduled'` |
| `exam_in_progress` | `status = 'exam_in_progress'` AND NOT all-exams-finished |
| `exam_completed` | (`status = 'exam_in_progress'` AND all-exams-finished) OR `status IN ('results_published','archived')` |

**all-exams-finished** = there is ≥1 non-absentee batch and every non-absentee `oly_batches` row for the school has `status = 'completed'`, AND there are no `oly_attempts` with `status = 'in_progress'` for the school's students. (Batch-completion is the authoritative signal; the attempt check guards against an in-flight attempt.) Edge case: a school with **zero batches** can never be `exam_completed` via this rule — it stays `exam_in_progress` (or earlier per `status`), so it correctly remains in the in-progress tab until batches exist and complete.

Tab bucketing: `in_progress` = stages `enrollment | exam_scheduled | exam_in_progress`; `done` = `exam_completed`.

### 4.5 School detail page

`OlympiadSchoolDetailPage.tsx` renders one of two modes based on derived stage (from `oly_school_overview`).

**Common header:** institution name, short code, city/state, derived-stage badge, campaign year, and an **"Access school admin dashboard"** button (§8). Existing Archive / Refund actions retained where their guards already allow.

**In-progress mode:**
- Stage badge.
- **Total students** (active enrolled count).
- **Attempted count** (only when stage = `exam_in_progress`): count of students with a terminal `oly_attempts` row.
- **Amount collected**, split **Cash** vs **Online**, each a clickable card → opens a `MobileSheet` listing the students who paid via that medium (paginated, via `oly_school_payment_list`). Online rows show the **stored** gateway fields: Razorpay order id, payment id, amount, GST, paid-at. (Live gateway fetch deferred — §9.)

**Done mode:**
- **Revenue** cash/online split (same component as in-progress amount-collected, relabeled "Revenue").
- **Result aggregates** from `oly_school_result_summary`: counts per tier (gold / silver / bronze / participation / absent), average %, top scorers. If results are **published**, sourced from `oly_results`; if exam-completed-but-not-yet-published, the RPC returns provisional aggregates computed from `oly_attempts` plus a `published: false` flag, and the detail shows a "Results not yet published" note with the existing Publish affordance (`oly_publish_initiate`).
- "Access school admin dashboard" button.

## 5. Exam Settings — class-first catalog (navigation inversion)

The existing catalog is **global** (no `campaign_id` on `oly_subjects`/`oly_topics`/`oly_questions`/`oly_study_materials`) and keyed by `grade_level_id`. `oly_subject_classes(subject_id, grade_level_id)` is the subject↔grade junction. **No schema change.** This is a navigation inversion from subject-first to class-first, reusing all existing tables and the topic/question/material sub-tab components.

### 5.1 Class list (`/admin/olympiad/classes`)

- Lists **classes = grade levels that have catalog content**: distinct `grade_level_id` present in `oly_subject_classes` (joined to `grade_levels` for name + ordering).
- **"Add class"** action: a dialog listing grade levels (3–10) **not yet configured** (no subjects mapped). Selecting one navigates to that grade's (empty) class profile, where adding the first subject materializes the class. (No `oly_classes` table — a class "exists" once a subject is mapped to its grade. The catalog is global across campaign years.)
- New hook `useOlympiadClasses()` returns `[{ grade_level_id, grade_name, grade_number, subject_count }]`, ordered by `grade_number`.
- New component `ClassListRow.tsx`.

### 5.2 Class profile (`/admin/olympiad/classes/:gradeLevelId`)

- Header: grade name. Lists the **subjects mapped to this grade** (`oly_subjects` joined via `oly_subject_classes` where `grade_level_id = :gradeLevelId`), each as a `SubjectListRow` showing per-grade counts (topics / questions / materials for this grade).
- **"Add subject"**: create a new `oly_subject` (or reuse an existing global subject by name) and link it to this grade via `oly_subject_classes`. Reuses `useUpsertOlympiadSubject` (which already manages grade-level associations) — scoped here to add the one grade.
- Clicking a subject → subject-in-class view (`/admin/olympiad/classes/:gradeLevelId/subjects/:subjectId`).

### 5.3 Subject-in-class view (`/admin/olympiad/classes/:gradeLevelId/subjects/:subjectId`)

- Reuses the existing **Topics / Questions / Study Material** sub-tab components (`OlympiadTopicsSubTab`, `OlympiadQuestionsSubTab`, `OlympiadStudyMaterialSubTab`) but **filtered to the single grade** `:gradeLevelId` (instead of the current accordion over every applicable grade).
- Add-topic / add-question / upload-study-material flows reuse the existing hooks (`useUpsertOlympiadTopic`, the question add flow, `useUploadStudyMaterial`), all of which already take `(subject_id, grade_level_id)`.

The old `OlympiadSubjectsTab.tsx` and `OlympiadSubjectDetailPage.tsx` are replaced by the class-first pages. Their per-grade rendering logic is reused (extracted/shared, not duplicated).

## 6. Onboarding auto-generation

**File:** `supabase/functions/oly-onboard-school/index.ts` (+ `OnboardSchoolForm` UI).

For **new** schools (not existing SALCI institutions):

1. **Institute code** — auto-generated server-side (mirror the institution-wizard pattern: derive initials from the school name + a random suffix; retry on uniqueness collision against `institutions.code`). The manual institute-code field is **removed** from the form.
2. **School short code** — auto-generated server-side (deterministic `^[A-Z0-9]{6}$`; retry on collision against `oly_schools.school_short_code`). The client "Suggest" button is removed; the field is no longer user-entered.
3. **School-admin login** — already created today (auth user + `profiles` row + `school_admin` `user_roles` row + password-reset email). This is retained; the edge function **returns** the created admin email + the generated reset link so the onboard-success UI can surface it. The login works at salci.org immediately.

For **existing** SALCI schools: no new institution/admin is created. Onboarding enables the `olympiad` feature on the institution (`institution_features`), which gives all of that institution's existing school admins the Olympiad sidebar entry — satisfying "all admins get Olympiad control access".

## 7. New server-side aggregation (CLAUDE.md §23)

All SECURITY DEFINER, `SET search_path = public`, super-admin-gated (`is_super_admin(auth.uid())`), explicit column lists, paginated where list-returning. No client-side `.length` over capped reads.

1. **`oly_school_overview(p_oly_school_id)`** → single row: `{ derived_stage, total_students, attempted_count, cash_count, cash_paise, online_count, online_paise, results_published }`. Powers both detail modes' headers + amount/revenue cards in one round-trip.
2. **`oly_school_payment_list(p_oly_school_id, p_channel, p_limit, p_cursor)`** → paginated students for the cash/online drilldown. Online rows include stored gateway fields (`gateway_order_id`, `gateway_payment_id`, `total_paise`, `gst_paise`, `paid_at`).
3. **`oly_school_result_summary(p_oly_school_id)`** → `{ published, gold_count, silver_count, bronze_count, participation_count, absent_count, avg_percentage, top_scorers[] }`. Reads `oly_results` when published; provisional from `oly_attempts` otherwise (with `published=false`).
4. **`oly_schools_by_stage(p_campaign_id, p_bucket, p_school_type, p_limit, p_cursor)`** → paginated school rows with derived stage for the in-progress / done tab lists, avoiding N+1 overview calls. `p_bucket IN ('in_progress','done')`; `p_school_type IN ('new','existing','all')`.

New hooks wrap each (explicit `staleTime`, cursor pagination where applicable).

## 8. School-admin dashboard access (managed mode)

Reuse `InstitutionContext.startManaging(institutionId)` (already used by `InstitutionsPage`). From a school detail page, an **"Access school admin dashboard"** button calls `startManaging(oly_school.institution_id)` then navigates to `/school` (or `/school/teachers`, matching `InstitutionsPage`'s `handleAccessAsAdmin`). Super-admin stays in their own session; the app routes school pages through the managed institution via `useEffectiveInstitution`. No new tab, no incognito caveat. The Phase 5b magic-link impersonation remains available but is not the primary path here.

For onboarded schools with multiple admins, managed mode does not require choosing an admin (it operates as the institution, not as a specific user) — satisfying "just log in into any one" without an admin picker.

## 9. Explicitly deferred

- **Live Razorpay gateway-detail fetch** (payment method, card/bank, fees, capture status) → after QA/QC. The online payment drilldown ships with **stored IDs only**; the `oly_school_payment_list` shape leaves room to add live fields later (a future `oly-razorpay-payment-detail` edge function), with no UI restructure required.

## 10. Out of scope

- No change to student/teacher exam flows, enrollment flow, batching, or publish pipeline beyond the new read-only aggregation RPCs and the onboarding auto-gen.
- No new `oly_classes` entity; no per-campaign catalog scoping.
- No multi-class-per-grade modeling.

## 11. Implementation phasing (for the plan)

1. **Shell + Exam Settings inversion** — two-tab shell, Campaign Settings sheet, class list / class profile / subject-in-class pages, `useOlympiadClasses`, route changes.
2. **Schools scaffold + onboarding auto-gen** — 3 sub-tab container, inline `OnboardSchoolForm`, new/existing filter, edge-function auto-gen (institute code + short code) + admin-credentials return surfaced in success UI.
3. **Aggregation RPCs + detail dashboards** — the 4 RPCs + hooks, in-progress detail (stage, counts, payment drilldown), done detail (revenue, result aggregates, publish affordance).
4. **Managed-mode access + final review** — access button wiring, whole-restructure review, §5a green (tsc + eslint + vite build).

## 12. Production-readiness contract

Every phase: `npx tsc --noEmit` exit 0, `npx eslint <touched>` no new errors, `npx vite build` exit 0. All new RPCs SECURITY DEFINER + super-admin-gated + paginated. All new `useQuery` hooks set explicit `staleTime`. All FKs (none new expected) indexed. All onError → `toastError`. Mobile-first per §20a/§20b (PageShell / MobileTabs / surface-card / StatTile / EmptyState / MobileSheet).
