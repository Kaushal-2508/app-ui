---
name: hybrid-and-offline-exams
description: Alternate exam-delivery modes — (A) Hybrid exam mode (hybrid_* tables, phone companion paired by token, 5 hybrid edge functions) and (B) Already-Created offline exam / results-only upload (exams.is_results_only, source_paper_files, exam-sheets bucket, two distinct offline-marks pipelines). Use when touching hybrid_*, *-hybrid-* edge functions, ExamModeSubToggle, ResultSetupSheet, UploadPaperPanel, offline_student_marks, offline_section_marks, or exam camera/fullscreen gates.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Hybrid Exam Mode & Results-Only Exams

Two alternate exam-delivery modes that coexist with the standard online flow. They have DIFFERENT data planes — never mix them.

## A. Hybrid exam mode (separate data plane)

Students answer on paper while proctored on a laptop; a phone companion photographs and uploads answer sheets; teachers evaluate the scanned pages.

### Data plane isolation (CRITICAL)

`hybrid_*` tables run PARALLEL to the online plane: `hybrid_exam_settings`, `hybrid_exam_attempts`, `hybrid_answer_sheet_pages`, `hybrid_pairing_tokens`, `hybrid_question_marks`, `hybrid_sheet_annotations`, `hybrid_exam_attempt_logs`, `hybrid_proctoring_snapshots` (migrations `20260516150000_hybrid_exam_mode_phase_1.sql`, `20260602115900` upload-window min 3, `20260602120000` proctoring snapshots, `20260602120100` upload-window autoclose). **Never write hybrid attempts/marks into `student_exam_attempts` / `student_answers` / `final_results`, and never read those tables from hybrid surfaces** — publishing hybrid marks is the ONLY bridge and goes through the `publish-hybrid-marks` edge function.

### Phone companion auth = the pairing token

Edge functions: `generate-hybrid-pairing-token`, `validate-hybrid-pairing-token`, `upload-hybrid-page`, `upload-hybrid-sheet`, `publish-hybrid-marks`. **The phone is UNAUTHENTICATED — the pairing token IS the auth.** Token validation gates every phone-side call; do not add `supabase.auth` requirements to the phone path (no session exists there), and do not weaken token checks ("it's just an upload").

### Attempt-page invariants (fixed 2026-06-02 — don't regress)

* **No auto-fullscreen** on the hybrid attempt page (97d0311) — the laptop is a proctoring display, not the answer surface.
* **Countdown starts `null`, not 0** (de499e8) — initializing at 0 auto-submitted on load before the camera/writing phase ran. Guard any timer logic on `countdown !== null`.
* **Camera gate** must show the specific block reason — permission-blocked / camera-in-use / no-camera — and request with relaxed `facingMode` (1181343); it must never hang on the "requesting" spinner (fcbd502 — every `getUserMedia` path needs a terminal state).
* **Phone answer-sheet upload reliability** (e78c3cb) and teacher-eval fixes (c6a193e): marks-save render-loop, upload preview, pairing error surfacing, and **0-mark publish must be allowed** (zero is a legitimate mark — don't falsy-check marks).
* Standard exam-flow rules still apply: all fullscreen calls via `src/lib/fullscreen.ts` (iOS Safari), proctoring snapshots are §23-sanctioned polling.

## B. Already-Created offline exam (results upload)

For exams conducted on paper before SALCI existed in the loop — no questions, marks entered directly. Merged 2026-06-04 (596c47f).

### Schema (migration `20260603120000_already_created_offline_exam.sql`)

* `exams.is_results_only BOOLEAN NOT NULL DEFAULT false` — marker flag.
* `exams.source_paper_files JSONB` — `[{path,name,mime,size}]` in the **exam-sheets bucket, flipped PUBLIC** by this migration (institution-scoped RLS added in `20260603130000_exam_sheets_institution_scope.sql`); papers viewable by staff and enrolled students via public URL.

### Flow components (`src/components/exam-creation/`)

`ExamModeSubToggle` (Create Exam / Already Created) on the Details screen → `ResultSetupSheet` (total marks + date + pass% + result visibility) → optional `UploadPaperPanel` (multi-file paper upload via the exam-paper storage helper) → save with **relaxed publish** (no blueprint/question requirements), total-marks override, and per-section `total_marks` → inline marks entry → students get a question-paper viewer on their results (f5c6d58). The All-Exams list shows a "Results upload" badge and selects `is_results_only`. Coordinator exam selects must keep `duration_minutes` in the column list (8be8221 regression).

### TWO offline-marks pipelines — keep them apart (CRITICAL)

* **`offline_student_marks`** — per-student totals, hook `src/hooks/useOfflineMarks.ts` (results-only flow).
* **`offline_section_marks`** — per-section marks, hook `src/hooks/useOfflineMarksEntry.ts` (standard offline exams from the mobile creation flow).

They MUST keep **distinct React Query keys** and never cross-invalidate or share components. Mixing them was the original design risk called out when the feature shipped; a shared key or merged hook corrupts whichever flow refetches first.