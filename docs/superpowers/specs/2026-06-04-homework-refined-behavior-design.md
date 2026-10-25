# Homework & Assignment — Refined Behavior (2026-06-04)

Refinement of the shipped Homework module (Phases 1–7, see
`2026-06-01-homework-assignment-module-design.md`). The original module allowed late
submissions, hid pre-window assignments, and required manual "Mark as Checked". This spec
**reverses or extends** several behaviors per the user's refined requirements. Audit of the
pre-change state: every item below was `not_implemented` or `partial`.

## Requirements

### R0 — Nav label
Teacher (and, for consistency, coordinator / school-admin / student) sidebar entry + the
`HomeworkPage` header read exactly **"Homework and Assignment"** (spelled-out "and", drop
"Create"). Today: "Create Homework & Assignment" / "Homework & Assignment".

### R1 — Student locked pre-window preview
A student **sees** an assigned, published assignment in their list **before** its
`visible_from` (opening) instant, shown **locked**: title, subject, and **both the "Opens"
and "Due" dates prominently**. Description / attachment / upload are **hidden** until
`visible_from`. After it opens, the full detail + upload appear.

### R2 — Hard submission window
Students can submit **only** within `[visible_from, due_at]`. After `due_at` the window
**hard-closes** — no student submission (replaces the original "late allowed + `is_late`
flag"). Leniency is handled by the teacher entering marks manually (R6), not by late student
uploads.

### R3 — Auto-checked for unmarked
Assignments with `carries_marks = false` **auto-move** to `status = 'checked'` once
`due_at` passes — no teacher action.

### R4 — Marked publish gate
A marked assignment can be published **only when**:
(a) **every assigned student has submitted OR `due_at` has passed**, AND
(b) **every submission is marked** (graded/skipped — already enforced).
Teacher may begin marking as submissions arrive.

### R5 — Offline-marked assignments
At creation, a **marked** assignment offers **"Assignment submitted offline, ready to assign
marks"**. When enabled, the online student-submission flow is skipped. The teacher gets an
**"Upload marks"** action → the **full class roster, one marks box per student** →
**"Submit marks"** → if any box is blank, a **"You missed N students — submit anyway?"**
confirm. Publishing then makes marks visible to students (read-only; they still see the
assignment + their mark).

### R6 — Checked-tab marks for non-submitters / late
In the Checked tab, all marks remain editable (already works), **and** the teacher can
**enter marks for students who did not submit online** (late/offline acceptance) — not just
edit existing ones.

## Technical design

### Schema (one prod migration, additive)
- `homework_assignments.offline_marks BOOLEAN NOT NULL DEFAULT false` — R5 mode flag. Only
  meaningful when `carries_marks = true`.
- `homework_results.submission_id` → **drop NOT NULL** (make nullable); keep its UNIQUE
  (Postgres allows multiple NULLs). Add **`UNIQUE (homework_assignment_id, student_id)`** —
  the canonical identity for a result, so a result can exist without a submission (R5/R6).
- Indexes for any new FK usage already covered by the new unique.

### RLS / read path (R1)
The locked preview must hide description/attachment **server-side**, so a row-level "just
show it" loosening is insufficient (RLS is row, not column). Approach:
- New `SECURITY DEFINER` RPC **`homework_student_feed()`** returns every published/checked
  assignment for the student's classes, with `locked = (visible_from > now())`, and
  **description/attachment_* nulled when `locked`**. Replaces the direct table read in
  `useStudentHomework`. (Also a §23 win — one round trip, server-aggregated.)
- A detail RPC **`homework_student_detail(_id)`** returns the same shape for one assignment
  (+ the student's own submission/result), nulling locked fields.
- `homework_visible_to_student` (the existing submit-gate helper) is **unchanged** — it keeps
  the `visible_from <= now()` gate and is used only for the **submission INSERT** check, now
  extended with an upper bound (R2).

### Hard close (R2) — defense in depth
- `submit-homework` edge fn: after loading `due_at`, **reject with 410** when `now > due_at`
  ("The submission window has closed.").
- `homework_visible_to_student` (or the submission INSERT RLS `WITH CHECK`): add
  `now() <= h.due_at` so a direct API call can't write a late row.
- Student UI: `canSubmit` requires `visible_from <= now <= due_at`; past-due renders a
  "Closed" state (no upload). `is_late` becomes always-false (kept as a column; messaging
  removed).

### Auto-checked (R3) + publish gate (R4)
- New SQL function `homework_auto_check_pass()` (SECURITY DEFINER): `UPDATE
  homework_assignments SET status='checked', checked_at=now() WHERE carries_marks=false AND
  status='published' AND due_at < now()`. Called from the existing 15-min cron (add a SQL
  step) — `due_at` is `timestamptz` (absolute), so no §24 timezone handling.
- `homework_publish_marks` RPC: add condition (a) — count assigned students
  (`homework_assignment_classes → class_assignments role='student'`) with **no** submission;
  if that count > 0 **and** `due_at > now()`, raise "Students can still submit — publish
  after everyone submits or the due date passes." Keep condition (b). Client `publishDisabled`
  mirrors this (uses roster `notSubmitted` + `due_at`).

### Offline + non-submitter marks (R5, R6)
- Creation: `offline_marks` toggle in `HomeworkCreationFlow` Marks section (only when
  `carriesMarks`). Persisted by `useHomeworkSave`/`useHomeworkUpdate`.
- New RPC **`homework_upsert_roster_marks(_homework_id, _marks jsonb[])`** (SECURITY DEFINER,
  `can_manage_homework`-gated): upserts `homework_results` keyed on
  `(homework_assignment_id, student_id)` with `submission_id = NULL` for non-submitters.
  Powers both the offline "Submit marks" bulk action and Checked-tab single non-submitter
  entry.
- Marking page: when `offline_marks`, show the **full roster with marks boxes** + "Submit
  marks" + "You missed N" confirm (no file viewer). When online, the existing submitted-cards
  flow, plus the **"Not submitted"** rows gain an inline marks box (R6) that writes via the
  new RPC.
- `homework_marking_roster` already returns the full roster (one row/student) — reused.

## Phasing (ship each before the next; §5a gates every phase)
- **A**: R0 (UI only).
- **B**: R1 + R2 (student feed RPC, hard-close edge/RLS, locked UI).
- **C**: R3 + R4 (auto-check pass + cron, publish-gate RPC + client).
- **D**: R5 + R6 (schema migration, offline toggle, roster-marks RPC, marking UI).

## Out of scope
Status/date-range + academic-year archive filters (separate Phase-8 polish). Analytics
`on_time_rate` becomes trivially 100% under hard close — left as-is for now.
