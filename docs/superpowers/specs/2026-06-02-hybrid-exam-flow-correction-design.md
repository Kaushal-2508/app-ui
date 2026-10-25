# Hybrid Exam Flow Correction — Design

**Date:** 2026-06-02
**Status:** Approved for planning
**Author:** Hybrid exam flow correction
**Module:** Hybrid exam mode (parallel data plane — see CLAUDE.md "project_hybrid_exam_mode" memory)

## 1. Problem

The hybrid exam flow that shipped 2026-05-16 has the right spine (read on screen → write on paper → photograph → upload → teacher marks) but is missing nearly every guardrail and several steps of the intended student/teacher journey. A source-verified audit found:

- **No camera gate.** The question paper renders immediately; `getUserMedia` / camera permission is never requested. `requireFaceCheck` is stored in settings but never read client-side.
- **Fullscreen is optional.** Only a manual "Fullscreen" button exists ([HybridExamAttemptPage.tsx](../../../src/pages/student/HybridExamAttemptPage.tsx) L224-233). Exits and tab-switches are *logged* (`useHybridIntegrityLogger`) but never warned about, blocked, or re-entered.
- **Upload window is the full 30-min grace window, client-side only.** [HybridWaitingForUpload.tsx](../../../src/components/hybrid/HybridWaitingForUpload.tsx) shows `grace_window_minutes` (default 30). The server (`upload-hybrid-page`) checks token TTL + attempt status but **never** computes `submitted_at + grace_window`.
- **No laptop "upload from storage" path.** Laptops only get a QR code; `upload-hybrid-page` is token/phone-only. Device type is never detected.
- **Phone upload is a single capture button** (`accept="image/*" capture="environment"`) with no explicit camera-vs-file choice.
- **Marking is plain number inputs at `step={0.25}`** ([HybridEvaluatePage.tsx](../../../src/pages/teacher/HybridEvaluatePage.tsx) L340-355, L509-519), not bottom "select-a-number" buttons, and **`publish-hybrid-marks` enforces no cap at all** — it can persist a total above the exam's max marks and derives `total_max_marks` from `hybrid_question_marks.max_marks` rather than `exam.total_marks`.
- **"Show result immediately" is offered for hybrid exams.** [ReviewPublishScreen.tsx](../../../src/components/exam-creation/screens/ReviewPublishScreen.tsx) (~L332-358) renders the `immediate` radio for every mode; the save hooks persist it unvalidated.

## 2. Desired flow (target)

1. Student opens the hybrid exam → the **first** thing shown is the **camera-permission** prompt.
2. On grant → the **question paper appears in fullscreen** that can't be exited / tab-switched until submit; scrollable if long. The student sits in front of the camera and writes answers on a **physical** answer sheet.
3. When finished, the student clicks **"OK, ready to submit."**
4. **Phone:** the camera opens, or two options (Open camera / Choose file). **Laptop:** a short window to photograph the sheet on another device, then upload the files from laptop storage.
5. The upload window is a **small, teacher-allocated** window (default **5 min**). Phone users capture + upload from the same phone; laptop users upload from storage (or pair a phone via QR).
6. If the exam **duration** elapses while the student is still writing → they're **auto-moved** into the upload window, which shows a **timer** counting down the remaining upload time.
7. When the upload window is over, the **teacher** sees the uploaded images and evaluates them.
8. The teacher marks by **selecting numbers shown at the bottom** of the screen, laid out per the question-paper pattern, in **0.5** increments.
9. A running **sum** is shown; the teacher **cannot** exceed the exam total (e.g. a 30-mark exam → max 30).
10. When **creating** a hybrid exam there is **no "show result immediately"** option.

## 3. Decisions (resolved with the user)

| # | Decision | Choice |
|---|---|---|
| 1 | Upload-window length | **Teacher-set, default 5 min**, enforced server-side. Slider clamped to 3–15 min (under the 15-min pairing-token TTL). |
| 2 | Camera role during writing | **Permission required to start + live self-view + periodic snapshots** stored on the hybrid plane. No face-api / face-match (no enrollment pipeline exists). |
| 3 | Fullscreen / tab-switch lock | Auto-enter fullscreen at start; on exit/tab-switch **warn + log only** — no forced re-entry, no auto-submit. |
| 4 | Phone vs laptop | **Auto-detect with manual override.** Phone → direct camera capture. Laptop → QR pairing **and** upload-from-storage. |
| 5 | Build approach | **Full build, delivered in 3 reviewable/shippable phases.** |
| 6 | Evaluation gating | **Per-student as each window closes** (no hard class-wide lock). `publish-hybrid-marks` only accepts `pending_evaluation`/`evaluated`. |
| 7 | Marks cap | Enforced **server-side** (`publish-hybrid-marks`) and mirrored client-side so invalid values are never offered. |

## 4. Invariants honored

- **Parallel data plane.** All new state lives on `hybrid_*` tables + the private `hybrid-answer-sheets` bucket. Nothing crosses into `final_results` / `student_*` / the public `proctoring-screenshots` bucket.
- **Phone is unauthenticated; the pairing token IS the auth.** The new authenticated upload path is a *separate* function for the student's own logged-in device — it never reuses the token plane.
- **iOS Safari fullscreen** (CLAUDE.md §20a): all fullscreen calls go through `src/lib/fullscreen.ts`; the lock degrades to camera + visibility logging where unsupported.
- **High-concurrency** (CLAUDE.md §23): snapshot interval ≥30 s; new queries set explicit `staleTime`; no `select("*")`; new FKs indexed in-migration; new RLS uses SECURITY DEFINER helpers; the cron close-job replaces per-attempt client polling for window expiry; the new edge function never calls `auth.getUser()` without a JWT arg.
- **UI system** (CLAUDE.md §20a/§20b): shadcn primitives, design tokens, `MobileSheet` over `Dialog`, `toastError` for all error toasts.
- **Edge-function deploys** (no global CLI): `npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw`.

## 5. Shared foundation (spans all phases)

### 5.1 Migration — proctoring snapshots
New table `hybrid_proctoring_snapshots`:
- Columns: `id uuid pk`, `attempt_id uuid → hybrid_exam_attempts(id) ON DELETE CASCADE`, `institution_id uuid → institutions(id)`, `storage_path text`, `captured_at timestamptz default now()`, `flagged boolean default false`.
- Indexes on `attempt_id` and `institution_id` (same migration as the FKs).
- RLS: student inserts/reads **own** rows (`student_id` resolved via the attempt); teacher-of-class / coordinator / school_admin / super_school_admin / super_admin of the institution read — via existing SECURITY DEFINER helpers (`is_teacher_for_class`, `is_institution_admin`, `is_super_admin`).
- Storage: a new RLS INSERT policy on `storage.objects` for the `hybrid-answer-sheets` bucket, path prefix `snapshots/`, scoped so the authenticated student can write their own attempt's snapshots. Reads stay via signed URLs (bucket is private).

### 5.2 Migration — window auto-close
`hybrid_close_expired_upload_windows()` (SECURITY DEFINER): for attempts in `awaiting_upload` / `upload_in_progress` where `now() > submitted_at + (grace_window_minutes || ' minutes')::interval`:
- ≥1 row in `hybrid_answer_sheet_pages` → `status = 'pending_evaluation'`.
- 0 pages → `status = 'cancelled_no_upload'`.
Scheduled via `pg_cron` every minute. Logs to `hybrid_exam_attempt_logs`. This is the §23-preferred alternative to client polling for expiry.

### 5.3 Edge function — `upload-hybrid-page` (edit + redeploy)
Add server-side window enforcement: the attempt select already joins `hybrid_exam_settings`; also fetch `submitted_at` + `grace_window_minutes`, and if `submitted_at + window < now` return `410 { error: "Upload window has closed" }`. (Currently it only checks token TTL at L103 and terminal status at L128-134.)

### 5.4 Edge function — `upload-hybrid-sheet` (NEW + deploy)
Authenticated sibling of `upload-hybrid-page` for the student's **own** logged-in device (phone-direct and laptop-from-storage).
- **Input:** `Authorization: Bearer <student JWT>`, body `{ attempt_id, page_number, file_base64, file_size_bytes, content_type? }`.
- **Auth/validation:** `auth.getUser()` **with** the JWT; assert `user.id === attempt.student_id`; status accepts uploads (`awaiting_upload` / `upload_in_progress`); window not expired (`submitted_at + grace_window_minutes`); `page_number ≤ max_pages`; `file_size ≤ 512 KB`.
- **Action:** service-role write to the same storage path (`hybrid-sheets/{institution}/{exam}/{attempt}/page_{n}.jpg`), upsert `hybrid_answer_sheet_pages` (unique `attempt_id,page_number`), flip `awaiting_upload → upload_in_progress` on first page, log `page_uploaded`. Mirrors `upload-hybrid-page` minus token logic, plus JWT + ownership. Never writes `final_results`.

### 5.5 Edge function — `publish-hybrid-marks` (edit + redeploy)
- Reject `upload_in_progress` (L96-101) — only `pending_evaluation` / `evaluated` may publish, so the teacher can't publish before the window closes.
- Per-question cap: reject if any `marks_awarded > max_marks`.
- Total cap: load `exams.total_marks` for the attempt's exam; reject if `totalAwarded > exam.total_marks`.
- Set `total_max_marks = exam.total_marks` (source of truth) instead of summing `hybrid_question_marks.max_marks` (L189-191).

### 5.6 Upload-window setting label/default
Keep the DB column `grace_window_minutes` (no migration churn). In `HybridSettingsPanel` ([ExamDetailsScreen.tsx](../../../src/components/exam-creation/screens/ExamDetailsScreen.tsx) ~L844-925) relabel it **"Upload window"**, set `DEFAULT_HYBRID_SETTINGS` default to **5**, and clamp the slider to **3–15 min**.

## 6. Phase 1 — creation guardrail + marking selector + caps

No schema changes. Highest-value, lowest-risk; ships first.

### 6.1 Remove "immediate results" for hybrid
- [ReviewPublishScreen.tsx](../../../src/components/exam-creation/screens/ReviewPublishScreen.tsx) (~L332-358): when `examMode === "hybrid"`, hide the `immediate` radio; show only **After teacher releases** (default-selected) + **Hidden**, with an info note: *"Hybrid exams are marked by hand, so results can't be shown instantly."*
- [useSaveExam.ts](../../../src/hooks/useSaveExam.ts) + [useUpdateExam.ts](../../../src/hooks/useUpdateExam.ts): coerce `result_visibility` `immediate → after_teacher_releases` when mode is hybrid — server-of-truth, never trust the UI alone. (Enum unchanged: `immediate | after_teacher_releases | hidden`; no migration.)

### 6.2 Bottom number-pad marking
[HybridEvaluatePage.tsx](../../../src/pages/teacher/HybridEvaluatePage.tsx): replace the per-question `<Input type="number" step={0.25}>` (L340-355, L509-519) with a **sticky bottom mark-selector bar**.
- Selecting a question makes it active; the bar shows discrete buttons `0, 0.5, 1, …, max` in **0.5** steps for *that* question's max (the paper's pattern). Tap → assign → auto-advance to the next unmarked question.
- Large maxes (e.g. a 15-mark essay → 31 buttons): the grid scrolls horizontally / collapses to whole numbers + a "+½" toggle so it stays usable.
- Running total **"Awarded X / {exam.total_marks}"** always visible; buttons that would push the running total over the exam total are disabled (mirrors the server cap).
- Center keeps `HybridPaperViewer`; left rail keeps the question list as navigation + per-question status (no inline input).

### 6.3 Caps
Enforced in `publish-hybrid-marks` (§5.5) and mirrored in 6.2 so invalid options are never shown.

## 7. Phase 2 — camera-first entry, locked paper, live camera + snapshots

On [HybridExamAttemptPage.tsx](../../../src/pages/student/HybridExamAttemptPage.tsx) (target steps 1-3).

### 7.1 Camera gate first
New `HybridCameraGate` overlay mounts **before** the question paper while `status === "in_progress"` and camera isn't yet granted. Calls `getUserMedia({ video: true })`:
- Denied / no camera → blocking screen ("Camera access is required for this exam") + Retry. The paper is unreachable without a grant.
- Granted → request fullscreen via `src/lib/fullscreen.ts`, then reveal the paper and start the monitor.

### 7.2 Locked, scrollable paper
Auto-enter fullscreen on grant (no-op + graceful degrade on iPhone). Paper scrolls (already works). Per the "warn + log" choice: exiting fullscreen or switching tabs shows a **non-blocking warning overlay** and logs via the existing `useHybridIntegrityLogger` — **no re-entry, no auto-submit**.

### 7.3 Live self-view + periodic snapshots
New `HybridCameraMonitor` (pinned corner, modelled on [StudentCameraPreview.tsx](../../../src/components/proctoring/StudentCameraPreview.tsx) but lightweight — no face-api): holds the stream, shows the student, every **~60 s** captures a frame → compresses (CompressorJS, ~480p) → uploads to `hybrid-answer-sheets/snapshots/...` + inserts a `hybrid_proctoring_snapshots` row via the authenticated client. Interval ≥30 s (§23). Stream + interval cleaned up on submit/unmount.

### 7.4 "OK, ready to submit"
Relabel the submit button to **"OK, I'm ready to submit"**; keep the confirm dialog. On confirm (or timer → 0): `submit` → `awaiting_upload`, exit fullscreen, stop the monitor.

### 7.5 Teacher review
[HybridEvaluatePage.tsx](../../../src/pages/teacher/HybridEvaluatePage.tsx) gains a snapshot strip (signed URLs) beside the answer sheet as integrity evidence.

## 8. Phase 3 — device-aware upload + 5-minute server-enforced window

Targets steps 4-7. Mostly [HybridWaitingForUpload.tsx](../../../src/components/hybrid/HybridWaitingForUpload.tsx) + [HybridUploadPage.tsx](../../../src/pages/student/HybridUploadPage.tsx).

### 8.1 Auto-advance on time-up (kept)
Duration elapse → auto-submit → upload window (already works, L108-116 of the attempt page). The window now shows the teacher-set timer (default 5 min), relabelled from "grace".

### 8.2 Device detection
New `useDeviceKind()` (UA + `pointer: coarse` + viewport) → `'phone' | 'computer'`, with a manual toggle if it guesses wrong.

### 8.3 Phone branch
Two explicit options — **"Open camera"** (reusable [CameraCapture.tsx](../../../src/components/offline-scan/CameraCapture.tsx), back camera) and **"Choose photo"** (file input). Both upload page-by-page (≤ `max_pages`) via the authenticated `upload-hybrid-sheet` (§5.4) — same phone, no QR.

### 8.4 Computer branch
Both offered: the existing **QR pairing card** (photograph on a separate phone/tablet → token-plane upload via `upload-hybrid-page`) **and** **"Upload from this computer"** (multi-file picker → authenticated `upload-hybrid-sheet`).

### 8.5 Window close
Timer → 0: with ≥1 page → auto-finalize to `pending_evaluation`; with 0 pages → `cancelled_no_upload`. Enforced server-side in both upload functions (§5.3, §5.4) + swept by the `pg_cron` close job (§5.2) — not just a client visual.

### 8.6 Separate paired-phone page
[HybridUploadPage.tsx](../../../src/pages/student/HybridUploadPage.tsx): replace the single capture button with the explicit **"Open camera" / "Choose file"** split (still unauth token plane).

## 9. Edge-function redeploys

After implementation, deploy (no global CLI):
- `upload-hybrid-page` (window enforcement)
- `publish-hybrid-marks` (status + caps)
- `upload-hybrid-sheet` (new authed function)

`generate-hybrid-pairing-token` / `validate-hybrid-pairing-token` are unchanged (15-min TTL is fine given the 3–15 min window clamp).

## 10. Testing

- **Phase 1:** create a hybrid exam → `immediate` not offered; save/update coerces a smuggled `immediate` to `after_teacher_releases`. Mark an attempt: bottom pad shows 0.5 steps to each question's max; running total can't exceed `exam.total_marks`; publish rejects an over-cap payload server-side; `total_max_marks === exam.total_marks`.
- **Phase 2:** open an attempt on desktop Chrome + iPhone Safari → camera prompt first; deny → blocked with retry; grant → fullscreen (desktop) / graceful no-op (iPhone) + live self-view; snapshots appear in `hybrid_proctoring_snapshots` ~every 60 s; fullscreen exit / tab switch → warning overlay + log row, no auto-submit; teacher sees the snapshot strip.
- **Phase 3:** phone → "Open camera"/"Choose photo" both upload via authed fn; laptop → QR upload (token) and file upload (authed) both land; duration elapse → upload window with 5-min timer; window expiry → server rejects late uploads (410) and cron moves the attempt to `pending_evaluation`/`cancelled_no_upload`; publish blocked until `pending_evaluation`.
- **Production-readiness gate (CLAUDE.md §5a):** `npx tsc --noEmit`, `npx eslint <touched>`, `npx vite build` all exit 0 per phase.

## 11. Out of scope / explicitly not doing

- Face-match / biometric verification (no enrollment pipeline; snapshots are visual evidence only).
- Hard class-wide "open evaluation for everyone at once" lock — evaluation opens per student as each window closes.
- Any change to `final_results` or cross-plane leaderboard bridging.
- Fees, online-exam proctoring, and other unrelated modules.
