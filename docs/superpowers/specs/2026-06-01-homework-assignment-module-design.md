# Homework & Assignment Module — Design Spec

**Date:** 2026-06-01
**Status:** Draft — awaiting user review
**Author:** Claude (with Tushar)

---

## 1. Summary

A new first-class module, **Homework & Assignment**, separate from exams. Teachers,
coordinators, school admins, and super school admins create assignments; students submit
work and later see marks or written feedback. Assignments flow through three stages —
**Scheduled → Submitted → Checked**. Web-push + in-app notifications fire on three
time-based events. Assignment marks feed analytics dashboards as a **separate** rollup
(they never appear on report cards and never affect exam metrics).

This module reuses SALCI's existing patterns (exam create-flow conventions, task-evidence
file upload, the pg_cron + `send-web-push` pipeline, the federated activity-feed audit
pattern, `cal_academic_years` tagging, feature gating) rather than inventing new ones.

---

## 2. Locked decisions

These were confirmed with the user on 2026-06-01:

| # | Decision | Choice | Consequence |
|---|---|---|---|
| 1 | Coordinator scope | **Wing-scoped** | Homework RLS + analytics use `is_coordinator_for_class()` (wing helper), diverging from the institution-wide model the rest of the app moved to on 2026-05-02. Depends on `wing_class_mappings` being populated. Consistent with how coordinator *exam* analytics already scope. |
| 2 | Marking surface & reuse | **Light viewer + single mark/feedback** | Reuse task-evidence upload (`storageUpload.ts`) + one small shared `SubmissionFileViewer` (inline image preview + download links). One mark **or** one feedback per submission. No annotation canvas; hybrid `HybridPaperViewer` is **not** pulled in. |
| 3 | Notification delivery | **Web push + in-app row** | The new scan-cron writes a `notifications` row **and** calls `send-web-push` for each event. |

### Defaults applied (not separately asked — standard conventions)

- **Feature flag** `homework`, `isDefault: true` (core academic feature, like `exams`). A
  backfill migration enables it for all existing institutions.
- **Analytics aggregation** is **server-side via RPC** (CLAUDE.md §23.1 is mandatory),
  even though the existing exam analytics are client-side (they predate the rule).
- **SLHI**: a repo-wide search found **no SLHI formula exists** in the codebase. The
  brief's "don't touch SLHI / keep it exam-only" is automatically satisfied — assignment
  marks are an independent rollup and touch nothing exam-related.

---

## 3. Data model

All FK columns get an index in the same migration (§23). Every table gets RLS in the same
migration (§6). `ON DELETE` is explicit on every `profiles(id)` FK (§21): ownership columns
(`student_id`) → CASCADE; authorship columns (`created_by`, `evaluated_by`, `changed_by`)
→ SET NULL.

### `homework_assignments`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `institution_id` | uuid NOT NULL → institutions | indexed |
| `created_by` | uuid → profiles(id) **SET NULL** | author |
| `subject_id` | uuid NOT NULL → subjects | single subject (brief: "must pick one"); indexed |
| `title` | text NOT NULL | |
| `description` | text | instructions |
| `carries_marks` | boolean NOT NULL default true | |
| `max_marks` | numeric NULL | required (CHECK) when `carries_marks` |
| `attachment_path` | text NULL | one optional teacher attachment |
| `attachment_name` | text NULL | |
| `attachment_mime` | text NULL | |
| `visible_from` | timestamptz NOT NULL default now() | |
| `due_at` | timestamptz NOT NULL | CHECK `due_at > visible_from` |
| `status` | text NOT NULL default `'draft'` | `draft \| published \| checked` |
| `academic_year` | text NOT NULL | auto-tagged via `currentAcademicYearActive()` |
| `evaluated_by` | uuid → profiles(id) **SET NULL** | who published marks / marked checked |
| `checked_at` | timestamptz NULL | |
| `created_at`, `updated_at` | timestamptz | `updated_at` trigger |

**Status & tab derivation** (Scheduled/Submitted are *derived*, not stored):
- `draft` → Drafts strip, fully editable
- `published` AND `due_at > now()` → **Scheduled** tab
- `published` AND `due_at <= now()` → **Submitted** tab
- `checked` → **Checked** tab

**Edit-lock rule** (derived, no column): editable iff `status='draft'` **OR**
(`status='published'` AND `visible_from > now()`). Publishing with visible-from = now locks
immediately. Enforced in RLS UPDATE policy + UI.

### `homework_assignment_classes` (multi-class junction)
`id`, `homework_assignment_id` → homework_assignments **CASCADE** (idx), `class_id` →
classes **CASCADE** (idx), `UNIQUE(homework_assignment_id, class_id)`. Classes are
section-level (`classes` rows under a `class_group`, per §22).

### `homework_submissions`
`id`, `homework_assignment_id` → … **CASCADE** (idx), `student_id` → profiles(id)
**CASCADE** (idx), `submitted_at` timestamptz default now(), `is_late` boolean (computed at
submit: `submitted_at > due_at`), `created_at`, `updated_at`.
`UNIQUE(homework_assignment_id, student_id)` — one-shot, one submission per student.

### `homework_submission_files`
`id`, `submission_id` → homework_submissions **CASCADE** (idx), `storage_path`,
`file_name`, `file_mime`, `file_size_bytes` bigint, `created_at`. App + edge enforce ≤10
files; a DB trigger caps files-per-submission at 10 as a backstop.

### `homework_results` (teacher-owned mark/feedback — kept separate from submissions for clean RLS)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `submission_id` | uuid NOT NULL → homework_submissions **CASCADE** | `UNIQUE` (one result/submission) |
| `homework_assignment_id` | uuid NOT NULL → … | denormalized for scope/index |
| `student_id` | uuid NOT NULL | denormalized, indexed |
| `marks_awarded` | numeric NULL | when carries_marks |
| `feedback` | text NULL | when no-marks (or optional alongside marks) |
| `status` | text NOT NULL | `pending \| graded \| skipped` |
| `evaluated_by` | uuid → profiles(id) **SET NULL** | who marked it |
| `evaluated_at` | timestamptz NULL | |
| `created_at`, `updated_at` | timestamptz | |

`skipped` = the brief's "Skip / Not graded". **Publish gate**: an assignment can move to
`checked` only when every `homework_submissions` row has a `homework_results` row with
`status IN ('graded','skipped')`.

### `homework_mark_audit` (federated into the activity feed; trigger-written only)
`id`, `homework_result_id` → … **CASCADE** (idx), `homework_assignment_id` (idx),
`student_id`, `changed_by` → profiles(id) **SET NULL**, `action`
(`graded \| mark_edited \| feedback_edited \| skipped`), `old_marks`/`new_marks` numeric,
`old_feedback`/`new_feedback` text, `old_status`/`new_status` text, `created_at`. Populated
by an `AFTER INSERT OR UPDATE` trigger on `homework_results`. Mirrors the
`exam_publication_logs` pattern; surfaced in `ViewUserSheet`'s `Promise.allSettled` activity
merge (no `log_audit_event` write — per the §20a federated-feed memory).

### `homework_notifications_sent` (cron idempotency)
`id`, `homework_assignment_id` → … **CASCADE** (idx), `recipient_id` (student or teacher),
`notification_type` (`visible \| due_reminder_24h \| closed_teacher`), `sent_at`,
`UNIQUE(homework_assignment_id, recipient_id, notification_type)`.

---

## 4. RLS & SECURITY DEFINER helpers

To avoid the recursion trap (§23.1 / migration `20260426120000`), all cross-table checks go
through SECURITY DEFINER helpers — no inline cross-table `EXISTS` between mutually-referencing
tables.

- `homework_visible_to_student(_user, _hw)` → student is in an assigned class **and**
  `visible_from <= now()`.
- `can_manage_homework(_user, _hw)` → creator-teacher (via `class_assignments` role=teacher
  for an assigned class + matching subject) **OR** coordinator wing (`is_coordinator_for_class`
  on any assigned class) **OR** institution admin (`has_role` + `get_user_institution`).
- `can_view_homework_results(_user, _submission)` → student owns the submission **OR**
  `can_manage_homework` on the parent assignment.

Policy sketch per table:
- **homework_assignments**: SELECT — managers (above) or visible-to-student; INSERT/UPDATE —
  managers, with UPDATE additionally blocked once locked (`status<>'draft' AND visible_from<=now()`)
  except for the `status→checked` transition + `evaluated_by`/`checked_at`; DELETE — drafts only by managers.
- **homework_assignment_classes**: tied to manageability of the parent.
- **homework_submissions / _files**: student INSERT once (own + assigned + visible); **no**
  student UPDATE/DELETE (one-shot); managers SELECT.
- **homework_results**: managers INSERT/UPDATE; students SELECT own **only after** the
  assignment is `checked`.
- **homework_mark_audit**: trigger-only writes; SELECT for managers (+ admins institution, super all).
- **homework_notifications_sent**: service-role writes (cron); no user access needed.

---

## 5. Storage

One **private** bucket `homework-files`, `file_size_limit = 10485760` (10 MB),
`allowed_mime_types` set to the documented allowlist (jpeg, png, gif, webp, pdf, doc, docx,
ppt, pptx, xls, xlsx, txt, rtf, odt, ods, odp). Path conventions:
- teacher attachment: `{institution_id}/attachments/{assignment_id}/{filename}`
- student submission: `{institution_id}/submissions/{assignment_id}/{student_id}/{filename}`

**Validation layers** (client *and* server, per brief):
1. Client — shared `validateFileUpload(file, { allowedMimes, maxBytes })` helper (extracted
   from the duplicated logic in `useUploadInstitutionLogo` / `SubmitEvidenceForm`); also
   enforces the ≤10-file count and blocks video/audio/zip/rar/exe with clear messages.
2. Storage — `allowed_mime_types` + `file_size_limit` fail-fast at the boundary.
3. Edge — `submit-homework` function (service role, short synchronous op) re-validates: files
   exist, count ≤10, MIME ∈ allowlist, assignment visible + student in class, computes
   `is_late`, then atomically inserts the submission + file rows (also the single point that
   enforces one-shot via the UNIQUE constraint). Mirrors `upload-hybrid-page`'s server-side
   validation philosophy.

Teacher attachment upload reuses `storageUpload.ts` directly (no edge function needed; the
bucket allowlist + size limit are sufficient, and managers' RLS covers it).

> Minor narrowing flagged: the brief says teacher attachments allow "any document except
> video/audio." The bucket allowlist is the explicit document set above (which is exactly
> "documents, not A/V"), applied to teacher and student alike — server-enforceable, whereas
> "everything except A/V" isn't expressible as a Storage allowlist. Call out if you want a
> broader teacher set.

---

## 6. Surfaces & flows

### 6.1 Create / edit (teacher · coordinator · school admin · super school admin)
Routes `/homework`, `/homework/create`, `/homework/edit/:id` — thin wrapper pages →
`HomeworkCreateFlow` (a **single-screen** form, not the 4-screen `ExamCreationFlow`; homework
has no question bank / sections / blueprints). Fields per brief: title, subject (required,
from assigned subjects), classes (multi, from assigned classes), description, optional
attachment, carries-marks toggle (+ max marks), visible-from (default now), due-at (required,
> visible-from). Buttons: **Save as Draft** / **Publish**. `useSaveHomework` /
`useUpdateHomework` mirror the `useSaveExam`/`useUpdateExam` mutation shape.
**Duplicate** action (on any assignment, any tab) opens the create form pre-filled in draft
state. Edit blocked once locked (§6.1 lock rule).

### 6.2 Three-tab list
`MobileTabs` strip (Scheduled / Submitted / Checked) + a Drafts strip (like `DraftsTab`).
Columns: Title, Subject, Class(es), Due date, Submission count (`23 / 45`), Status.
Filters (same set in all three tabs, ≥3 filters → `FilterSheet`): class, subject,
status (marked/unmarked — Submitted tab), date range. Past-AY filter for archived years.

### 6.3 Student submit
Student sidebar entry **Homework & Assignment** + routes `/student/homework`,
`/student/homework/:id`. Page = **Pending** (visible, not submitted, soonest-due first, with
countdown) + **Completed** (submitted; shows marks / "Feedback received" / "Waiting for
teacher to mark"). Open → read description + instructions + download teacher attachment →
upload area (≤10 files, ≤10 MB each, allowlist; reject unsupported client-side) → **confirm
dialog** ("Once you submit, you cannot make changes…") → `submit-homework`. **One-shot** — no
re-upload/edit/delete after submit. Late submit allowed with a "marked as late" warning;
`is_late` flag set.

### 6.4 Teacher marking (Submitted / Checked detail)
Assignment header (title, subject, class(es), due, status). **Submitted** section: one
`ListRow` per submitter → `SubmissionFileViewer` (inline image preview + download links) +
mark input (carries-marks) **or** feedback textarea (no-marks) + **Skip**. Late submitters
badged. **Not Submitted** section: names + roll numbers (report-to-parent deferred — no parent
IDs). Running counter ("12 of 45 submitted. 8 marked, 4 pending"). **Publish Marks** /
**Mark as Checked** disabled until every submitter is `graded`/`skipped` ("3 of 15 submissions
not yet marked"). On publish → `status='checked'`, `evaluated_by`/`checked_at` set, students
see results instantly. **Checked tab**: inline-edit any student's mark/feedback (direct, no
re-open) → `homework_mark_audit` trigger records who/when/old/new; student sees the corrected
value immediately. Stays editable forever.

### 6.5 Student results view
Own marks/feedback once `checked`; "Waiting for teacher to mark" before. **Own submission
only** — no peer visibility, no class average, no submitted-count. Marks live only here, never
on report cards.

---

## 7. Notifications (cron + web push + in-app)

`homework_run_notification_pass()` PL/pgSQL fn, scheduled via `cron.schedule` every 15 min
(matches attendance cadence), per-institution timezone-aware (`(now() AT TIME ZONE i.timezone)`,
per §24). For each event it writes a `notifications` row, calls `send-web-push` via
`net.http_post`, and records `homework_notifications_sent` (idempotency):

1. **visible** → when `status='published'` AND `visible_from <= now_inst` AND not yet sent →
   each student in assigned classes: *"New assignment: {title} ({subject}). Due {date}."*
2. **due_reminder_24h** → when `due_at - 24h <= now_inst < due_at` AND student has **no**
   submission AND not yet sent → *"Reminder: {title} is due tomorrow."*
3. **closed_teacher** → when `due_at <= now_inst` AND not yet sent → creator (`created_by`):
   *"Assignment '{title}' has closed. {N} submissions ready to mark."*

No per-submission notifications, no digests — exactly these three (per brief). This is the
first automated `send-web-push` trigger in the codebase; we add the cron + plumbing, leaving
`send-web-push` itself unchanged.

---

## 8. Analytics rollup

Server-side RPC `get_homework_analytics(_scope)` (per §23.1) returning a pre-aggregated
`AssignmentMetrics` object (avg marks, total assignments, submission rate, on-time rate,
per-class breakdown), scoped per role: teacher = own classes; **coordinator = wing**
(via `wing_class_mappings`, matching decision #1 and existing exam-analytics scope);
school/super-school admin = institution. Wired into `TeacherAnalyticsDashboard`,
`SchoolAnalyticsDashboard`, the coordinator view, and `SuperAdminAnalyticsDashboard` as a
**separate** metric block alongside exam metrics. Exam/SLHI logic untouched.

---

## 9. Academic year & audit

- **AY tagging**: `homework_assignments.academic_year` set at insert from
  `currentAcademicYearActive(institutionId)` (`timetableCompat.ts`). Past-year filter via
  `DISTINCT academic_year`; archived years read-only.
- **Audit**: `homework_mark_audit` (dedicated table + trigger), federated into
  `ViewUserSheet`'s activity merge — **not** `log_audit_event` (per §20a memory). Captures
  who/when/old/new for every Checked-tab edit.

---

## 10. Feature gating & nav

- New `homework` feature in `AVAILABLE_FEATURES` (`featuresData.ts`), `isDefault: true`.
- `FEATURE_URL_MAP`: `/homework` → `homework`, `/homework/create` → `homework`,
  `/student/homework` → `homework` (all role-specific URLs mapped, per the leak warning).
- **Backfill migration** inserts `homework` (enabled) for all existing institutions
  (`ON CONFLICT DO NOTHING`).
- Nav: a **Create Homework & Assignment** entry directly below **Create Exam** for teacher +
  coordinator + school-admin/super-school-admin in `AppSidebar`; student **Homework &
  Assignment** entry; matching dashboard tiles. Gating kept in sync across sidebar +
  dashboard tiles + `ProtectedRoute` (ui-invariants).
- Routes in `App.tsx` with `allowedRoles` per surface.

---

## 11. Reuse map

| Need | Reuse | Status |
|---|---|---|
| File upload | `src/lib/storageUpload.ts` (TUS) | already shared |
| Upload UX reference | `SubmitEvidenceForm` (task-evidence) | pattern to follow |
| File type/size validation | **new** `validateFileUpload()` helper | extract from logo/evidence dup |
| Submission display | **new** small shared `SubmissionFileViewer` | new, light (no annotation) |
| Notifications | `send-web-push`, `push_subscriptions`, `notifications`, pg_cron | already shared; add scan-cron |
| Audit | `exam_publication_logs` shape + `ViewUserSheet` merge | pattern to follow |
| AY | `currentAcademicYearActive()`, `useCalAcademicYear` | already shared |
| Create-flow conventions | `useSaveExam`/`useUpdateExam`, `ExamsPage` filters, `DraftsTab` | pattern to follow |
| Design system | §20a/20b primitives (`PageShell`, `MobileTabs`, `ListRow`, `MobileSheet`, `StatTile`, `EmptyState`) | mandatory |

**Not reused:** hybrid phone-pairing upload (wrong model) and `HybridPaperViewer` annotation
canvas (heavier than the brief needs) — per decision #2.

---

## 12. Phase breakdown (one branch each)

1. **`homework/phase-1-schema`** — all tables + RLS + helpers + indexes; storage bucket; audit
   trigger; idempotency table; `homework` feature flag + FEATURE_URL_MAP + backfill; AY tagging.
2. **`homework/phase-2-create`** — create/edit flow + lock rule + duplicate; 3-tab list +
   filters; nav + gating in sync.
3. **`homework/phase-3-submit`** — student Pending/Completed + open/upload/confirm/one-shot +
   late flag + `submit-homework` edge fn + `validateFileUpload` + `SubmissionFileViewer`.
4. **`homework/phase-4-marking`** — detail page, Submitted/Not-Submitted lists, counter,
   publish gate, Checked inline-edit + audit, `evaluated_by`.
5. **`homework/phase-5-results`** — student own-only results view.
6. **`homework/phase-6-notify`** — scan-cron + idempotency + web push + in-app rows (3 events).
7. **`homework/phase-7-analytics`** — `get_homework_analytics` RPC + dashboard wiring (separate metric).
8. **`homework/phase-8-polish`** — 375px, dark-mode, `tsc`/`eslint`/`vite build` clean,
   real-device walk of all 12 scenarios.

Each phase ends with the §5a zero-error contract verified.

---

## 13. Out of scope / deferred

- Report-to-parent for non-submitters (no parent IDs yet).
- Annotation-style marking (decision #2).
- Marks on report cards (explicitly excluded).
- Camera/integrity, phone pairing, timer, fullscreen lock, per-question marking (brief).
- New-institution feature seeding gap: new institutions only get `olympiad` today; `homework`
  (like every non-olympiad feature) is enabled per-institution via `EditInstitutionDialog`.
  Not homework's job to fix; flagged.

---

## 14. Open risks

- **Wing data dependency** (decision #1): wing-scoped coordinators see only classes in
  `wing_class_mappings`; gaps there hide homework from them.
- **Cron load**: adds a 5th pg_cron job at 15-min cadence; idempotency + TZ gating prevent
  duplicate sends (per §24 + the attendance-cron lesson).
- **Base branch**: homework feature branches need a confirmed base (main vs current
  `olympiad/phase-1`) — to confirm before Phase 1.
