# Already-Created Offline Exam (Results Upload) — Design

**Date:** 2026-06-03
**Status:** Approved design (brainstorming complete) → ready for implementation plan
**Branch:** `feat/already-created-offline-exam`

## Problem

Teachers regularly conduct paper exams offline and only need to **record the results**. Today the only way to get marks into SALCI is to build a full exam in the creation flow (sections + questions), publish it, then enter marks. That is heavy ceremony for an exam that has already happened on paper.

We want a lightweight path: pick the class/subject/chapters, optionally attach a photo/PDF of the paper, set the total marks, and type each student's score. No question authoring.

## Goals

- Under **Offline** exam mode at `/exams/create`, add a sub-toggle: **Create Exam** (the existing flow) vs **Already Created** (new).
- "Already Created" skips the sections builder and the entire Questions step.
- An **optional** multi-file paper upload (images and/or PDF) replaces the "Paper sections" panel.
- Marks entry is **inline in the creation flow**: after the upload step, a small prompt collects the **total marks** (plus date conducted, pass %, result visibility), then the existing offline **student-list marks table** opens.
- The published exam appears in the normal **All Exams** list with a distinguishing badge, styled like an offline exam.
- Students see their marks in the **existing offline results format**, and can view the uploaded paper.

## Non-goals

- No changes to Online or Hybrid modes.
- No question authoring, AI generation, question bank, proctoring, or timing for this path.
- **Section-wise marks are deferred** — v1 records a single total per student (Option A from brainstorming). The data model leaves room to add buckets later.
- Deep re-editing of a published results-only exam's metadata is out of scope for v1; marks remain editable via the existing offline marks sheet.

## Users / roles

Same authorization as normal exam creation: `teacher`, `coordinator`, `school_admin`, `super_school_admin`, `super_admin`. Students never create exams. No new RLS roles introduced.

## UX flow

```
Offline → Already Created
  → Basics (shared left column: name, type, class, subject, chapters — already filled at start)
  → Upload paper (OPTIONAL, multi-file image/PDF) — replaces the "Paper sections" builder
  → "Continue to results"
     → Result-setup sheet: Total marks (required) · Date conducted (default today) · Pass % (optional) · Who sees results
     → on confirm: exam is SAVED + PUBLISHED (with one synthetic "Total" section)
  → Inline student-list marks table (existing OfflineMarksEntryScreen): one mark per student, "Absent" toggle
  → Save → navigate to /exams
```

The **Questions** step and the old **Review/Publish** screen are not shown for this path.

## Architecture — the key idea (maximal reuse)

A results-only exam is persisted as a normal **offline** exam with **one synthetic section titled "Total"** carrying the entered total marks and **zero questions**. Everything downstream — `student_exam_attempts`, `offline_section_marks`, `final_results`, the All-Exams card, and the student `ResultDetailsSheet` — already handles offline exams and works **unchanged**. The new flag only drives the creation UI fork and a list badge.

### Why publishing works with zero questions

- DB trigger `validate_exam_status_transition` (mislabelled in CLAUDE.md §10 as `prevent_invalid_exam_publish`) only blocks publish when `is_blueprint_ready = false`. With zero questions there are no subjective questions, so `is_blueprint_ready` is set `true` and the transition passes.
- The **only** other blocker is the **frontend** guard `validateExamRequirements` in [useSaveExam.ts](../../../src/hooks/useSaveExam.ts) (requires ≥1 section and ≥1 question on publish). This must be **relaxed for the results-only path**.

## Data model (one migration)

`exams` (both columns are plain, nullable-safe additions; new columns inherit existing `exams` RLS — no new policies):

- `is_results_only BOOLEAN NOT NULL DEFAULT false` — explicit marker for an already-conducted, results-uploaded offline exam. Cannot be inferred (the file is optional), so it is stored explicitly. Drives the All-Exams badge and edit routing.
- `source_paper_files JSONB` (nullable) — array of `{ path, name, mime, size }` describing uploaded paper files. `NULL`/`[]` when none.

No new tables. Reuses, unchanged:
- `exam_sections` — one synthetic row, `title='Total'`, `total_marks = <entered total>`, no questions.
- `student_exam_attempts`, `offline_section_marks` (unique `(attempt_id, section_id)`), `final_results`.

**Required fix (also benefits normal offline exams):** [useSaveExam.ts](../../../src/hooks/useSaveExam.ts) currently inserts `exam_sections` **without** `total_marks`, yet [useOfflineMarksEntry.ts](../../../src/hooks/useOfflineMarksEntry.ts) reads `exam_sections.total_marks` to compute each student's `total_max_marks`. `exam_sections.total_marks` is a plain writable `NUMERIC(10,2)` column (no trigger). The save path must persist `total_marks` on each section. For results-only the value is the entered total; for the normal flow it is the sum of that section's question marks.

### Storage

- Repurpose the existing, currently-unused **`exam-sheets`** bucket and make it **public** (`update storage.buckets set public = true where id = 'exam-sheets'`). Allowed mime types already include `image/jpeg,image/png,image/webp,application/pdf`; 52 MB limit.
- Upload path: `${institution_id}/${randomUuid}_${filename}` (no `exam_id` needed — files are uploaded during the optional upload step, before the exam row exists). Read via `getPublicUrl`.
- **Trade-off (flagged):** public means anyone with the (unguessable UUID) URL can read the paper. This matches how `question-images` and `answer-sheets` already work in this repo. If stricter privacy is later required, keep the bucket private and add a small edge function that returns short-lived signed URLs after an auth check (staff of the institution, or a student with an attempt on the exam). Documented as a follow-up, not built in v1.

## Frontend changes

### Types — [src/types/exam.ts](../../../src/types/exam.ts)
- Add `SourcePaperFile = { path: string; name: string; mime: string; size: number }`.
- Add to `ExamMetadata` (or context): `isResultsOnly?: boolean`, `sourcePaperFiles?: SourcePaperFile[]`, `totalMarksOverride?: number | null` (the entered total for results-only; overrides the question-derived total).

### Details screen — [ExamDetailsScreen.tsx](../../../src/components/exam-creation/screens/ExamDetailsScreen.tsx)
- When `examMode === 'offline'`, render an **`ExamModeSubToggle`** directly beneath the mode buttons (the location the user circled): **Create Exam** / **Already Created**. Hidden for online/hybrid. Persisting choice in form state (`metadata.isResultsOnly`).
- When `isResultsOnly`: hide the Paper-sections builder; render **`UploadPaperPanel`** in the right column.
- `canContinue` for results-only requires only basics (`title`, `classIds`, `subjectIds`, `chapterIds`) — **not** sections. File optional.
- Continue button label → "Continue to results" for this path.
- Keep all existing class/subject/chapter behaviour (shared left column) intact.

### New: `UploadPaperPanel` (`src/components/exam-creation/components/`)
- Optional, multi-file dropzone (image/PDF), 44px tap targets, shadcn primitives.
- Uploads each file to `exam-sheets`, pushes `{ path, name, mime, size }` into `metadata.sourcePaperFiles`; thumbnail/row list with remove. Empty state allowed (skip is fine).
- Uses `toastError` on failures (CLAUDE.md §19).

### New: `ResultSetupSheet` (`src/components/exam-creation/screens/`)
- `MobileSheet` (CLAUDE.md §20a) opened from the Details "Continue to results" CTA.
- Fields: **Total marks** (required, > 0), Date conducted (default today), Pass % (optional → `pass_marks = total × pct/100`), Result visibility (immediate / after teacher releases / hidden).
- Primary action "Continue to marks" → triggers save+publish, then advances to inline marks entry.

### Orchestrator — [ExamCreationFlow.tsx](../../../src/components/exam-creation/ExamCreationFlow.tsx)
- New screen state `"resultsMarks"`.
- For the results-only path: Details `onContinue` opens `ResultSetupSheet` instead of going to Questions.
- On result-setup confirm: set `formData.sections = [{ title:'Total', total_marks: <total>, questions: [] , ... }]` and `metadata.totalMarksOverride = <total>`, then `saveExam.mutate({ formData, publish: true })`. On success, set `examId` and render **`OfflineMarksEntryScreen`** (existing) inline for that exam.
- Marks "Save & finish" → `navigate('/exams')`.
- Edit mode: if a loaded exam has `is_results_only`, route directly to the inline marks entry (skip details/questions). Metadata edit beyond marks is v1-light.

### Save path — [useSaveExam.ts](../../../src/hooks/useSaveExam.ts) (minimal branches, guarded by `isResultsOnly`)
1. `validateExamRequirements`: when `metadata.isResultsOnly`, skip the "≥1 section / ≥1 question" publish checks (still require institution, class, title; and `totalMarksOverride > 0`).
2. Section insert: add `total_marks` to the `exam_sections` insert — `section.totalMarks ?? <sum of question marks>` (fixes the latent gap for all offline exams).
3. `exams.total_marks`: use `metadata.totalMarksOverride` when `isResultsOnly`, else the question-derived total.
4. Write `is_results_only` and `source_paper_files` on insert/update.
5. `is_blueprint_ready = true` when there are no subjective questions (already the case).

Reuses all existing class/subject/chapter (`exam_classes`/`exam_subjects`/`exam_topics`) link logic.

### Marks entry — reused unchanged
[OfflineMarksEntryScreen.tsx](../../../src/components/exam-creation/screens/OfflineMarksEntryScreen.tsx) + [useOfflineMarksEntry.ts](../../../src/hooks/useOfflineMarksEntry.ts) + `useSaveOfflineMarks`. The single "Total" section renders as one mark column. Roster = students of the selected class(es) via `exam_classes → class_assignments` (existing). Empty roster is allowed (marks can be added later from All Exams).

### All-Exams list — [ExamsPage.tsx](../../../src/pages/ExamsPage.tsx) + queries in [useDashboardData.ts](../../../src/hooks/useDashboardData.ts)
- Add `is_results_only` (and `source_paper_files` if needed) to the `useTeacherExams` / `useSchoolExams` / `useCoordinatorExams` `select` lists.
- Render a small **"Results upload"** chip when `is_results_only`, keeping the existing offline amber accent. Clicking still opens the existing `OfflineMarksEntry` sheet to view/edit marks.

### Student results — [ResultDetailsSheet.tsx](../../../src/components/student/ResultDetailsSheet.tsx)
- Already renders the offline format (score · % · pass/fail · section breakdown from `final_results.section_scores`). The "Total" section appears as one row. No change needed for the score display.
- **New:** when the exam has `source_paper_files`, add a **"Question paper"** card with view/download links (`getPublicUrl`). Fetch `exams.source_paper_files` in the result query.

## Validation & edge cases

- Total marks required and `> 0` before the student list opens.
- Pass % optional; `pass_marks` derived as `round(total × pct/100)`.
- File optional, multiple, image/PDF only, ≤ 52 MB (bucket limit); failures surfaced via `toastError`.
- Zero students in the class → empty marks list; publish still allowed.
- `is_blueprint_ready = true` so the publish trigger passes with no questions.
- Results-only exams are offline → no proctoring/timing fields are collected or required.

## High-concurrency notes (CLAUDE.md §23)

- New `useQuery`/reads use explicit `staleTime`; All-Exams queries already paginate/scope by role — only adding two columns.
- New FK? None. New columns only; index not required (not filtered at scale beyond existing `exams` scans).
- No new realtime subscriptions. No `select("*")`.

## Production-readiness (CLAUDE.md §5a)

`npx tsc --noEmit`, `npx eslint <touched>`, and `npx vite build` must all exit 0 on the touched files. No `any`; new joined-row shapes typed inline.

## Affected files (summary)

- `supabase/migrations/2026XXXXXXXXXX_already_created_offline_exam.sql` (new) — two `exams` columns + make `exam-sheets` bucket public.
- `src/types/exam.ts` — new types/fields.
- `src/components/exam-creation/screens/ExamDetailsScreen.tsx` — sub-toggle + conditional right column.
- `src/components/exam-creation/components/UploadPaperPanel.tsx` (new).
- `src/components/exam-creation/screens/ResultSetupSheet.tsx` (new).
- `src/components/exam-creation/ExamCreationFlow.tsx` — routing for the results-only path + inline marks.
- `src/hooks/useSaveExam.ts` — guarded branches + persist `exam_sections.total_marks`.
- `src/pages/ExamsPage.tsx` + `src/hooks/useDashboardData.ts` — badge + query columns.
- `src/components/student/ResultDetailsSheet.tsx` — paper viewer card.

## Open items to confirm at spec review

1. **Paper storage privacy** — design assumes public `exam-sheets`. Switch to private + signed-URL edge function if stricter privacy is required.
2. **Badge wording** — "Results upload" vs "Conducted" vs "Marks only".
3. **Synthetic section title** — "Total" vs the exam name vs "Marks".

## Testing

- Manual: create an Already-Created exam with and without a paper file; enter marks (incl. an Absent student); verify it appears in All Exams with the badge; open it again to edit marks; log in as a student to confirm the offline-format result and the visible paper.
- Verify a normal offline exam's section max still computes correctly after the `total_marks` persistence change (regression check).
- Zero-error contract checks (§5a).
