# Hybrid Exam Flow Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the hybrid exam flow so it runs camera-first → locked fullscreen paper with live camera + periodic snapshots → "ready to submit" → device-aware upload within a teacher-set (default 5-min) server-enforced window → bottom number-pad marking in 0.5 steps with a hard total cap, and removes the impossible "immediate results" option for hybrid exams.

**Architecture:** All work stays on the parallel `hybrid_*` data plane + the private `hybrid-answer-sheets` bucket — nothing touches `final_results` / `student_*` / `proctoring-screenshots`. Snapshots are written directly by the authenticated student (no edge function, existing bucket INSERT policy covers it). The student's own device uploads sheets via a NEW authenticated edge function (`upload-hybrid-sheet`); a separate paired phone keeps using the unauth token plane (`upload-hybrid-page`). Marks caps and the upload window are enforced server-side (edge functions + a `pg_cron` close job), with the UI mirroring them so invalid options are never offered.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query v5, shadcn/ui + Tailwind (HSL tokens), Supabase (Postgres + RLS + Edge Functions in Deno), CompressorJS for image compression, `pg_cron`.

**Verification contract (this repo has NO unit-test runner — see `package.json`):** every task ends with the CLAUDE.md §5a gate plus a targeted manual smoke. The three gate commands (run from the repo root):

```
npx tsc --noEmit
npx eslint <changed-paths>
npx vite build
```

All three MUST exit 0 on touched files. Pure logic is extracted into small functions (`src/lib/hybridMarks.ts`, `src/lib/deviceKind.ts`, `src/lib/hybridImage.ts`) so it is type-checked and trivially reviewable; if a runner is added later these are the units to test. Edge-function + migration changes are verified by deploy + manual flow (no local DB in CI). Do NOT add vitest/jest — it is not part of this repo's toolchain.

**Branch:** `hybrid/exam-flow-correction` (already created from `main`; the design spec is committed there).

**Edge-function deploy command (no global CLI):**
```
npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw
```

---

## Phase 0 — Foundation (migrations + edge functions)

These underpin all three UI phases. Apply migrations to prod with `npm run db:push` (or via the Supabase dashboard) and deploy the edge functions before the UI that depends on them.

### Task 0.1: Migration — `hybrid_proctoring_snapshots` table + RLS

**Files:**
- Create: `supabase/migrations/20260602120000_hybrid_proctoring_snapshots.sql`

- [ ] **Step 1: Write the migration**

Mirror the RLS helpers used by the existing hybrid tables (`is_super_admin`, `is_institution_admin`, `is_teacher_for_class`, `get_user_institution`, `has_role`). The existing `hybrid_sheets_authenticated_insert` / `hybrid_sheets_authenticated_read` storage policies already let an authenticated student write/read this bucket, so NO storage policy is added here.

```sql
-- =====================================================================
-- HYBRID EXAM MODE — Proctoring snapshots (flow correction, Phase 2)
-- =====================================================================
-- Periodic webcam snapshots captured while the student writes on paper.
-- Lives on the hybrid_* plane. Images go to the existing private bucket
-- hybrid-answer-sheets under the snapshots/ prefix (authenticated student
-- write is already permitted by hybrid_sheets_authenticated_insert).
-- =====================================================================

CREATE TABLE public.hybrid_proctoring_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.hybrid_exam_attempts(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT false,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hybrid_snapshots_attempt ON public.hybrid_proctoring_snapshots(attempt_id);
CREATE INDEX idx_hybrid_snapshots_institution ON public.hybrid_proctoring_snapshots(institution_id);

ALTER TABLE public.hybrid_proctoring_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins full access hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Institution admins full access hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR ALL TO authenticated
  USING (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));

CREATE POLICY "Students insert own hybrid_snapshots"
  ON public.hybrid_proctoring_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_proctoring_snapshots.attempt_id
        AND a.student_id = auth.uid()
    )
  );

CREATE POLICY "Teachers select hybrid_snapshots for assigned classes"
  ON public.hybrid_proctoring_snapshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hybrid_exam_attempts a
      WHERE a.id = hybrid_proctoring_snapshots.attempt_id
        AND public.is_teacher_for_class(auth.uid(), a.class_id)
    )
  );

CREATE POLICY "Coordinators select hybrid_snapshots own institution"
  ON public.hybrid_proctoring_snapshots FOR SELECT TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.has_role(auth.uid(), 'coordinator')
  );

COMMENT ON TABLE public.hybrid_proctoring_snapshots IS
  'Periodic webcam snapshots during the hybrid writing phase. Integrity evidence only; never crosses into the online proctoring plane.';
```

- [ ] **Step 2: Apply + verify**

Run: `npm run db:push`
Expected: migration applies cleanly. Then in the SQL editor confirm:
```sql
SELECT 1 FROM information_schema.tables WHERE table_name = 'hybrid_proctoring_snapshots';
```
returns one row.

- [ ] **Step 3: Regenerate Supabase types**

Run: `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts`
Expected: `hybrid_proctoring_snapshots` appears in the generated `Database` type. Then `npx tsc --noEmit` exits 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602120000_hybrid_proctoring_snapshots.sql src/integrations/supabase/types.ts
git commit -m "feat(hybrid): hybrid_proctoring_snapshots table + RLS"
```

---

### Task 0.2: Migration — upload-window auto-close + `pg_cron`

**Files:**
- Create: `supabase/migrations/20260602120100_hybrid_upload_window_autoclose.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================================
-- HYBRID EXAM MODE — Upload-window auto-close (flow correction, Phase 3)
-- =====================================================================
-- When the teacher-set upload window (hybrid_exam_settings.grace_window_minutes,
-- measured from hybrid_exam_attempts.submitted_at) lapses, move the attempt off
-- the upload states: -> pending_evaluation when at least one page exists,
-- else -> cancelled_no_upload. Runs every minute via pg_cron. Client-side
-- timers are now only a visual; this is the source of truth.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.hybrid_close_expired_upload_windows()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed INTEGER := 0;
  r RECORD;
  v_page_count INTEGER;
  v_next_status TEXT;
BEGIN
  FOR r IN
    SELECT a.id, a.institution_id, a.submitted_at, s.grace_window_minutes
    FROM public.hybrid_exam_attempts a
    JOIN public.hybrid_exam_settings s ON s.exam_id = a.exam_id
    WHERE a.status IN ('awaiting_upload', 'upload_in_progress')
      AND a.submitted_at IS NOT NULL
      AND now() > a.submitted_at + make_interval(mins => s.grace_window_minutes)
  LOOP
    SELECT count(*) INTO v_page_count
    FROM public.hybrid_answer_sheet_pages p
    WHERE p.attempt_id = r.id;

    v_next_status := CASE WHEN v_page_count > 0 THEN 'pending_evaluation' ELSE 'cancelled_no_upload' END;

    UPDATE public.hybrid_exam_attempts
    SET status = v_next_status,
        upload_completed_at = CASE WHEN v_next_status = 'pending_evaluation' THEN now() ELSE upload_completed_at END
    WHERE id = r.id;

    INSERT INTO public.hybrid_exam_attempt_logs (attempt_id, institution_id, event_type, event_payload)
    VALUES (
      r.id, r.institution_id, 'upload_window_closed',
      jsonb_build_object('page_count', v_page_count, 'next_status', v_next_status)
    );

    v_closed := v_closed + 1;
  END LOOP;

  RETURN v_closed;
END;
$$;

-- Schedule every minute. cron.schedule is idempotent on jobname in pg_cron 1.5+;
-- guard for older versions by unscheduling first if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hybrid-close-upload-windows') THEN
    PERFORM cron.unschedule('hybrid-close-upload-windows');
  END IF;
  PERFORM cron.schedule(
    'hybrid-close-upload-windows',
    '* * * * *',
    $job$ SELECT public.hybrid_close_expired_upload_windows(); $job$
  );
END;
$$;
```

- [ ] **Step 2: Apply + verify**

Run: `npm run db:push`
Then confirm the job exists:
```sql
SELECT jobname, schedule FROM cron.job WHERE jobname = 'hybrid-close-upload-windows';
```
Expected: one row, schedule `* * * * *`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260602120100_hybrid_upload_window_autoclose.sql
git commit -m "feat(hybrid): pg_cron auto-close of expired upload windows"
```

---

### Task 0.3: Edge — `upload-hybrid-page` server-side window enforcement

**Files:**
- Modify: `supabase/functions/upload-hybrid-page/index.ts`

- [ ] **Step 1: Pull `submitted_at` + `grace_window_minutes` into the attempt query**

Replace the attempt select (currently selecting `max_pages` only) so the grace window and submit time are available. Find:

```ts
    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select(
        `id, exam_id, student_id, institution_id, status,
         hybrid_exam_settings ( max_pages )`,
      )
      .eq("id", tokenRow.attempt_id)
      .single();
```

Replace with:

```ts
    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select(
        `id, exam_id, student_id, institution_id, status, submitted_at,
         hybrid_exam_settings ( max_pages, grace_window_minutes )`,
      )
      .eq("id", tokenRow.attempt_id)
      .single();
```

- [ ] **Step 2: Enforce the window after the terminal-status check**

Immediately AFTER this existing block:

```ts
    if (
      attempt.status === "evaluated" ||
      attempt.status === "cancelled_no_upload" ||
      attempt.status === "pending_evaluation"
    ) {
      return jsonResponse(409, { error: "Upload window is closed" });
    }

    const settingsRow = Array.isArray(attempt.hybrid_exam_settings)
      ? attempt.hybrid_exam_settings[0]
      : attempt.hybrid_exam_settings;
    const maxPages = settingsRow?.max_pages ?? 10;
```

insert:

```ts
    // Server-side upload-window enforcement: reject uploads after
    // submitted_at + grace_window_minutes. The pairing-token TTL alone is not
    // the window (a teacher may set a shorter window than the 15-min TTL).
    const graceWindowMinutes = settingsRow?.grace_window_minutes ?? 5;
    if (attempt.submitted_at) {
      const windowEndMs =
        new Date(attempt.submitted_at).getTime() + graceWindowMinutes * 60 * 1000;
      if (Date.now() > windowEndMs) {
        return jsonResponse(410, {
          error: "Upload window has closed — ask your teacher if you need more time.",
        });
      }
    }
```

- [ ] **Step 3: Deploy + smoke**

Run: `npx supabase@latest functions deploy upload-hybrid-page --project-ref gyymkgohcijeksmrzuyw`
Expected: deploy succeeds. Manual smoke: with a hybrid attempt whose `submitted_at` is older than its window, a phone upload returns 410.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/upload-hybrid-page/index.ts
git commit -m "feat(hybrid): enforce upload window server-side in upload-hybrid-page"
```

---

### Task 0.4: Edge — `upload-hybrid-sheet` (NEW, authenticated own-device upload)

**Files:**
- Create: `supabase/functions/upload-hybrid-sheet/index.ts`

- [ ] **Step 1: Write the function**

Authenticated sibling of `upload-hybrid-page`: auth = student JWT (resolved exactly like `generate-hybrid-pairing-token`), ownership check `user.id === attempt.student_id`, same window + max-pages + size enforcement, service-role storage write + page upsert + status flip.

```ts
// Upload a single answer-sheet page from the student's OWN logged-in device
// (the phone they wrote on, or a laptop uploading from local storage).
//
// Input (JSON body): {
//   attempt_id: string,
//   page_number: number,
//   file_base64: string,        // raw base64, no "data:" prefix
//   file_size_bytes: number,
//   content_type?: string,      // default "image/jpeg"
// }
//
// Auth: student JWT in Authorization. The caller MUST be the attempt's
// student (auth.uid() === attempt.student_id). This is the authenticated
// counterpart to upload-hybrid-page (which is token-only for a *separate*
// paired phone). Same hybrid_* plane — never touches final_results.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "hybrid-answer-sheets";
const FILE_SIZE_CAP = 512 * 1024; // 512 KB — matches bucket file_size_limit

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing Authorization header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    if (userError || !userResult?.user) {
      return jsonResponse(401, { error: "Unauthenticated" });
    }
    const userId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attempt_id as string | undefined;
    const pageNumber = Number(body?.page_number);
    const fileBase64 = body?.file_base64 as string | undefined;
    const fileSizeBytes = Number(body?.file_size_bytes);
    const contentType = (body?.content_type as string | undefined) ?? "image/jpeg";

    if (!attemptId) return jsonResponse(400, { error: "attempt_id is required" });
    if (!Number.isFinite(pageNumber) || pageNumber < 1) {
      return jsonResponse(400, { error: "page_number must be a positive integer" });
    }
    if (!fileBase64) return jsonResponse(400, { error: "file_base64 is required" });
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return jsonResponse(400, { error: "file_size_bytes must be > 0" });
    }
    if (fileSizeBytes > FILE_SIZE_CAP) {
      return jsonResponse(413, {
        error: "File too large after compression. Try a sharper photo with less background.",
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select(
        `id, exam_id, student_id, institution_id, status, submitted_at,
         hybrid_exam_settings ( max_pages, grace_window_minutes )`,
      )
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      return jsonResponse(404, { error: "Attempt not found" });
    }
    if (attempt.student_id !== userId) {
      return jsonResponse(403, { error: "Not your attempt" });
    }
    if (
      attempt.status === "evaluated" ||
      attempt.status === "cancelled_no_upload" ||
      attempt.status === "pending_evaluation"
    ) {
      return jsonResponse(409, { error: "Upload window is closed" });
    }

    const settingsRow = Array.isArray(attempt.hybrid_exam_settings)
      ? attempt.hybrid_exam_settings[0]
      : attempt.hybrid_exam_settings;
    const maxPages = settingsRow?.max_pages ?? 10;
    const graceWindowMinutes = settingsRow?.grace_window_minutes ?? 5;

    if (attempt.submitted_at) {
      const windowEndMs =
        new Date(attempt.submitted_at).getTime() + graceWindowMinutes * 60 * 1000;
      if (Date.now() > windowEndMs) {
        return jsonResponse(410, {
          error: "Upload window has closed — ask your teacher if you need more time.",
        });
      }
    }
    if (pageNumber > maxPages) {
      return jsonResponse(400, { error: `Page number exceeds max of ${maxPages}` });
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(fileBase64);
    } catch {
      return jsonResponse(400, { error: "file_base64 is not valid base64" });
    }
    if (bytes.length > FILE_SIZE_CAP) {
      return jsonResponse(413, {
        error: "File too large after compression. Try a sharper photo with less background.",
      });
    }

    const storagePath = `hybrid-sheets/${attempt.institution_id}/${attempt.exam_id}/${attempt.id}/page_${pageNumber}.jpg`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (uploadError) {
      return jsonResponse(500, { error: `Upload failed: ${uploadError.message}` });
    }

    const { data: pageRow, error: rowError } = await admin
      .from("hybrid_answer_sheet_pages")
      .upsert(
        {
          attempt_id: attempt.id,
          institution_id: attempt.institution_id,
          page_number: pageNumber,
          storage_path: storagePath,
          file_size_bytes: bytes.length,
          device_fingerprint: "own-device",
          rotation_degrees: 0,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "attempt_id,page_number" },
      )
      .select("id")
      .single();
    if (rowError) {
      return jsonResponse(500, { error: `Row insert failed: ${rowError.message}` });
    }

    let nextStatus = attempt.status;
    if (attempt.status === "awaiting_upload") {
      const { error: statusError } = await admin
        .from("hybrid_exam_attempts")
        .update({ status: "upload_in_progress" })
        .eq("id", attempt.id);
      if (!statusError) nextStatus = "upload_in_progress";
    }

    admin
      .from("hybrid_exam_attempt_logs")
      .insert({
        attempt_id: attempt.id,
        institution_id: attempt.institution_id,
        event_type: "page_uploaded",
        actor_id: attempt.student_id,
        event_payload: {
          page_number: pageNumber,
          file_size_bytes: bytes.length,
          source: "authenticated_device",
        },
      })
      .then(() => {})
      .catch(() => {});

    return jsonResponse(200, {
      page_id: pageRow.id,
      storage_path: storagePath,
      page_number: pageNumber,
      attempt_status: nextStatus,
    });
  } catch (err) {
    return jsonResponse(500, { error: (err as Error).message ?? "Unknown error" });
  }
});
```

- [ ] **Step 2: Deploy + smoke**

Run: `npx supabase@latest functions deploy upload-hybrid-sheet --project-ref gyymkgohcijeksmrzuyw`
Expected: deploy succeeds. (Smoke happens once Task 3.3/3.4 wire the client.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/upload-hybrid-sheet/index.ts
git commit -m "feat(hybrid): upload-hybrid-sheet authenticated own-device upload function"
```

---

### Task 0.5: Edge — `publish-hybrid-marks` status gate + per-question + total caps

**Files:**
- Modify: `supabase/functions/publish-hybrid-marks/index.ts`

- [ ] **Step 1: Drop `upload_in_progress` from publishable statuses**

Find:

```ts
    if (
      attempt.status !== "pending_evaluation" &&
      attempt.status !== "evaluated" &&
      attempt.status !== "upload_in_progress"
    ) {
      return jsonResponse(409, { error: `Cannot publish from status "${attempt.status}"` });
    }
```

Replace with:

```ts
    // Only publish once the upload window has closed (student finalized or the
    // cron moved the attempt to pending_evaluation). Re-publish of an already
    // evaluated attempt stays allowed for corrections.
    if (
      attempt.status !== "pending_evaluation" &&
      attempt.status !== "evaluated"
    ) {
      return jsonResponse(409, { error: `Cannot publish from status "${attempt.status}"` });
    }
```

- [ ] **Step 2: Load the exam total for the cap**

The attempt select currently lists `id, exam_id, student_id, class_id, institution_id, status`. Add a query for the exam total right after the existing attempt fetch block (after the `if (attemptError || !attempt)` guard):

```ts
    const { data: examRow, error: examError } = await admin
      .from("exams")
      .select("total_marks")
      .eq("id", attempt.exam_id)
      .single();
    if (examError || !examRow) {
      return jsonResponse(404, { error: "Exam not found" });
    }
    const examTotal =
      examRow.total_marks === null || examRow.total_marks === undefined
        ? null
        : Number(examRow.total_marks);
```

- [ ] **Step 3: Enforce caps in the aggregation loop**

Find:

```ts
    const missing: string[] = [];
    let totalAwarded = 0;
    let totalMax = 0;
    for (const qid of gradeableIds) {
      const m = marksByQuestion.get(qid);
      if (!m || m.marks_awarded === null || m.marks_awarded === undefined) {
        missing.push(qid);
      } else {
        totalAwarded += Number(m.marks_awarded);
        totalMax += Number(m.max_marks);
      }
    }
    if (missing.length > 0) {
      return jsonResponse(400, {
        error: `${missing.length} question${missing.length === 1 ? "" : "s"} are still un-marked.`,
        missing_question_ids: missing,
      });
    }
```

Replace with:

```ts
    const missing: string[] = [];
    const overMax: string[] = [];
    let totalAwarded = 0;
    let summedMax = 0;
    for (const qid of gradeableIds) {
      const m = marksByQuestion.get(qid);
      if (!m || m.marks_awarded === null || m.marks_awarded === undefined) {
        missing.push(qid);
      } else {
        const awarded = Number(m.marks_awarded);
        const max = Number(m.max_marks);
        if (awarded > max) overMax.push(qid);
        totalAwarded += awarded;
        summedMax += max;
      }
    }
    if (missing.length > 0) {
      return jsonResponse(400, {
        error: `${missing.length} question${missing.length === 1 ? "" : "s"} are still un-marked.`,
        missing_question_ids: missing,
      });
    }
    if (overMax.length > 0) {
      return jsonResponse(400, {
        error: `${overMax.length} question${overMax.length === 1 ? "" : "s"} exceed their maximum marks.`,
        over_max_question_ids: overMax,
      });
    }
    // total_max_marks is the exam's configured total (source of truth), falling
    // back to the summed per-question max if the exam has no total set.
    const totalMax = examTotal ?? summedMax;
    if (examTotal !== null && totalAwarded > examTotal) {
      return jsonResponse(400, {
        error: `Total awarded (${totalAwarded}) exceeds the exam total of ${examTotal}.`,
      });
    }
```

(The downstream `.update({ ... total_max_marks: totalMax })` is unchanged and now writes the exam total.)

- [ ] **Step 4: Deploy + smoke**

Run: `npx supabase@latest functions deploy publish-hybrid-marks --project-ref gyymkgohcijeksmrzuyw`
Expected: deploy succeeds. Manual smoke (after Phase 1 UI): publishing an attempt whose marks sum exceeds the exam total returns a 400; publishing from `upload_in_progress` returns 409.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/publish-hybrid-marks/index.ts
git commit -m "feat(hybrid): publish-hybrid-marks enforces per-question + total caps, requires window closed"
```

---

## Phase 1 — creation guardrail + marking selector + caps

No schema changes. Ships first.

### Task 1.1: Default upload window to 5 minutes

**Files:**
- Modify: `src/types/exam.ts:89-95`

- [ ] **Step 1: Change the default**

Find:

```ts
export const DEFAULT_HYBRID_SETTINGS: HybridExamSettings = {
  graceWindowMinutes: 30,
  maxPages: 10,
  requireFaceCheck: false,
  sheetNumberingInstruction:
    "Write the question number above each answer. Write the sheet number in the top-right corner of every page.",
};
```

Replace `graceWindowMinutes: 30,` with `graceWindowMinutes: 5,`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/exam.ts
git commit -m "feat(hybrid): default upload window to 5 minutes"
```

---

### Task 1.2: Relabel "grace window" → "Upload window" and clamp to 3–15 min

**Files:**
- Modify: `src/components/exam-creation/screens/ExamDetailsScreen.tsx:844-872` (the `HybridSettingsPanel` grace section)

- [ ] **Step 1: Update the clamp + slider + copy**

Find:

```tsx
function HybridSettingsPanel({ settings, onChange }: HybridSettingsPanelProps) {
  const graceClamped = Math.min(120, Math.max(5, settings.graceWindowMinutes));
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background/60 p-3 md:p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hybrid settings
      </div>

      {/* Grace window */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-sm">Upload grace window</Label>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {graceClamped} min
          </span>
        </div>
        <Slider
          className="mt-2"
          min={5}
          max={120}
          step={5}
          value={[graceClamped]}
          onValueChange={(v) => onChange({ graceWindowMinutes: v[0] })}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Window after the student clicks Submit during which they can finish uploading sheets.
          If the phone dies or wifi drops, they can re-pair within this window.
        </p>
      </div>
```

Replace with:

```tsx
function HybridSettingsPanel({ settings, onChange }: HybridSettingsPanelProps) {
  const graceClamped = Math.min(15, Math.max(3, settings.graceWindowMinutes));
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background/60 p-3 md:p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hybrid settings
      </div>

      {/* Upload window */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-sm">Upload window</Label>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {graceClamped} min
          </span>
        </div>
        <Slider
          className="mt-2"
          min={3}
          max={15}
          step={1}
          value={[graceClamped]}
          onValueChange={(v) => onChange({ graceWindowMinutes: v[0] })}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Time the student has to photograph and upload their answer sheets after they tap
          "I'm ready to submit" (or when the exam timer runs out). Default 5 minutes.
        </p>
      </div>
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/screens/ExamDetailsScreen.tsx`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/exam-creation/screens/ExamDetailsScreen.tsx
git commit -m "feat(hybrid): relabel upload window + clamp 3-15 min"
```

---

### Task 1.3: Save/update hooks — validate 3–15 + force non-immediate result visibility for hybrid

**Files:**
- Modify: `src/hooks/useSaveExam.ts:28-40` (validation) and `:133`,`:178` (result_visibility)
- Modify: `src/hooks/useUpdateExam.ts:73-93` (add coerced result_visibility)

- [ ] **Step 1: Update the hybrid validation range in `useSaveExam`**

Find:

```ts
    if (hs.graceWindowMinutes < 5 || hs.graceWindowMinutes > 120) {
      return "Hybrid grace window must be between 5 and 120 minutes";
    }
```

Replace with:

```ts
    if (hs.graceWindowMinutes < 3 || hs.graceWindowMinutes > 15) {
      return "Hybrid upload window must be between 3 and 15 minutes";
    }
```

- [ ] **Step 2: Add a result-visibility resolver in `useSaveExam` mutationFn**

Right after `if (!user.user) throw new Error("Not authenticated");` (around line 76), add:

```ts
      // Hybrid exams are marked by hand — "immediate" is impossible, so coerce
      // it to after_teacher_releases regardless of what the UI sent.
      const resolvedResultVisibility =
        formData.metadata.examMode === "hybrid" &&
        (formData.metadata.resultVisibility ?? "after_teacher_releases") === "immediate"
          ? "after_teacher_releases"
          : (formData.metadata.resultVisibility || "after_teacher_releases");
```

Then in BOTH the update payload (line ~133) and the insert payload (line ~178), replace:

```ts
            result_visibility: formData.metadata.resultVisibility || "after_teacher_releases",
```

with:

```ts
            result_visibility: resolvedResultVisibility,
```

(There are two occurrences — update at ~133 and insert at ~178. Change both.)

- [ ] **Step 3: Persist coerced result_visibility in `useUpdateExam`**

`useUpdateExam` currently does not write `result_visibility` at all. In the exam `.update({...})` block (lines 75-92), after the `instructions:` line, add:

```ts
          result_visibility:
            formData.metadata.examMode === "hybrid" &&
            (formData.metadata.resultVisibility ?? "after_teacher_releases") === "immediate"
              ? "after_teacher_releases"
              : (formData.metadata.resultVisibility || "after_teacher_releases"),
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/hooks/useSaveExam.ts src/hooks/useUpdateExam.ts`
Expected: both exit 0. (Note: `useSaveExam.ts` already contains a pre-existing `as any` at the insert payload — leave it; do not expand scope.)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSaveExam.ts src/hooks/useUpdateExam.ts
git commit -m "feat(hybrid): force non-immediate result visibility + 3-15 min window validation"
```

---

### Task 1.4: Review screen — hide "Immediately" for hybrid + self-correct stale selection

**Files:**
- Modify: `src/components/exam-creation/screens/ReviewPublishScreen.tsx:62-63` and `:332-358`

- [ ] **Step 1: Add an effect to correct a stale `immediate` selection when mode is hybrid**

After the existing `const resultVisibility ...` line (62-63), add:

```tsx
  const isHybridMode = formData.metadata.examMode === "hybrid";

  // Hybrid is marked by hand — never allow "immediate". If the teacher picked it
  // for another mode and then switched to hybrid, correct it on entry.
  useEffect(() => {
    if (isHybridMode && resultVisibility === "immediate") {
      updateMetadata({ resultVisibility: "after_teacher_releases" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHybridMode, resultVisibility]);
```

(`useEffect` is already imported at line 1.)

- [ ] **Step 2: Gate the "Immediately" radio + add the hybrid note**

Find the result-visibility `<RadioGroup>` block (lines 335-357) and replace the `immediate` `RadioOption` so it only renders for non-hybrid modes, and add an info line for hybrid. Replace:

```tsx
            <RadioGroup
              value={resultVisibility}
              onValueChange={(v) =>
                updateMetadata({ resultVisibility: v as ResultVisibility })
              }
              className="space-y-2"
            >
              <RadioOption
                value="immediate"
                title="Immediately after submission"
                description="Score appears as soon as the attempt is graded."
              />
              <RadioOption
                value="after_teacher_releases"
                title="After teacher releases"
                description="Results stay hidden until you explicitly publish them."
              />
              <RadioOption
                value="hidden"
                title="Hidden from students"
                description="Internal record only; students never see marks."
              />
            </RadioGroup>
```

with:

```tsx
            <RadioGroup
              value={resultVisibility}
              onValueChange={(v) =>
                updateMetadata({ resultVisibility: v as ResultVisibility })
              }
              className="space-y-2"
            >
              {!isHybridMode && (
                <RadioOption
                  value="immediate"
                  title="Immediately after submission"
                  description="Score appears as soon as the attempt is graded."
                />
              )}
              <RadioOption
                value="after_teacher_releases"
                title="After teacher releases"
                description="Results stay hidden until you explicitly publish them."
              />
              <RadioOption
                value="hidden"
                title="Hidden from students"
                description="Internal record only; students never see marks."
              />
            </RadioGroup>
            {isHybridMode && (
              <p className="text-[11px] text-muted-foreground">
                Hybrid exams are marked by hand, so results can't be shown instantly.
              </p>
            )}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/exam-creation/screens/ReviewPublishScreen.tsx`
Expected: both exit 0. Manual smoke: switch mode to Hybrid on Review → the "Immediately" radio disappears and the note shows.

- [ ] **Step 4: Commit**

```bash
git add src/components/exam-creation/screens/ReviewPublishScreen.tsx
git commit -m "feat(hybrid): hide immediate-results option for hybrid exams"
```

---

### Task 1.5: Bottom number-pad marking with 0.5 steps + hard total cap

**Files:**
- Create: `src/lib/hybridMarks.ts`
- Create: `src/components/hybrid/HybridMarkPad.tsx`
- Modify: `src/pages/teacher/HybridEvaluatePage.tsx`

- [ ] **Step 1: Write the pure mark helpers**

Create `src/lib/hybridMarks.ts`:

```ts
/**
 * Pure helpers for the hybrid evaluation mark-pad.
 * No React, no Supabase — trivially reviewable and (if a runner lands) testable.
 */

/**
 * Discrete mark options for a question, in 0.5 steps from 0 up to and
 * including its max. A non-half-step max (rare) still ends exactly at max.
 * e.g. buildMarkSteps(2) -> [0, 0.5, 1, 1.5, 2]; buildMarkSteps(1.5) -> [0, 0.5, 1, 1.5].
 */
export function buildMarkSteps(maxMarks: number): number[] {
  if (!Number.isFinite(maxMarks) || maxMarks <= 0) return [0];
  const steps: number[] = [];
  for (let v = 0; v <= maxMarks + 1e-9; v += 0.5) {
    steps.push(Math.round(v * 2) / 2);
  }
  const last = steps[steps.length - 1];
  if (Math.abs(last - maxMarks) > 1e-9 && last < maxMarks) {
    steps.push(Math.round(maxMarks * 2) / 2);
  }
  return steps;
}

/**
 * Largest mark the teacher may give the active question without (a) exceeding
 * that question's max or (b) pushing the running total past the exam total.
 * `awardedOthers` = sum already awarded to OTHER questions (excludes active).
 */
export function maxSelectableForActive(
  questionMax: number,
  examTotal: number | null,
  awardedOthers: number,
): number {
  const byTotal = examTotal === null ? Infinity : Math.max(0, examTotal - awardedOthers);
  return Math.min(questionMax, byTotal);
}
```

- [ ] **Step 2: Verify the helper compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Write the mark-pad component**

Create `src/components/hybrid/HybridMarkPad.tsx`:

```tsx
import { buildMarkSteps, maxSelectableForActive } from "@/lib/hybridMarks";
import { cn } from "@/lib/utils";

interface HybridMarkPadProps {
  questionNumber: string;
  questionMax: number;
  /** Current mark on the active question, or null if unmarked. */
  value: number | null;
  /** Exam total (cap). null = no cap configured. */
  examTotal: number | null;
  /** Marks already awarded to OTHER questions (excludes the active one). */
  awardedOthers: number;
  /** Running total awarded across all questions, for the footer display. */
  totalAwarded: number;
  disabled?: boolean;
  onSelect: (marks: number) => void;
}

/**
 * Sticky bottom bar: discrete 0.5-step mark buttons laid out per the question's
 * own marks pattern. Buttons that would push the running total past the exam
 * total are disabled, mirroring the server-side cap in publish-hybrid-marks.
 */
export function HybridMarkPad({
  questionNumber,
  questionMax,
  value,
  examTotal,
  awardedOthers,
  totalAwarded,
  disabled = false,
  onSelect,
}: HybridMarkPadProps) {
  const steps = buildMarkSteps(questionMax);
  const cap = maxSelectableForActive(questionMax, examTotal, awardedOthers);

  return (
    <div className="border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground">
            {questionNumber} · marks ({questionMax} max)
          </span>
          <span className="tabular-nums text-muted-foreground">
            Total awarded:{" "}
            <strong className="text-foreground">
              {totalAwarded}
              {examTotal !== null ? ` / ${examTotal}` : ""}
            </strong>
          </span>
        </div>
        <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {steps.map((s) => {
            const isSelected = value !== null && Math.abs(value - s) < 1e-9;
            const isBlocked = s > cap + 1e-9;
            return (
              <button
                key={s}
                type="button"
                disabled={disabled || (isBlocked && !isSelected)}
                onClick={() => onSelect(s)}
                className={cn(
                  "min-w-[44px] shrink-0 rounded-md border px-3 py-2 text-sm font-semibold tabular-nums transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the mark-pad into `HybridEvaluatePage`, replace the number inputs, add the total cap**

In `src/pages/teacher/HybridEvaluatePage.tsx`:

(a) Add the import near the other component imports (after the `HybridPaperViewer` import, line 42):

```tsx
import { HybridMarkPad } from "@/components/hybrid/HybridMarkPad";
```

(b) Add an exam-total constant + helpers inside the component, right after the `totals` memo (after line 219):

```tsx
  const examTotal = data.exam?.total_marks ?? totals.max;

  const activeMarkValue = useMemo(() => {
    if (!activeQuestionId) return null;
    const raw = drafts[activeQuestionId]?.marks ?? "";
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) return null;
    return Number(raw);
  }, [activeQuestionId, drafts]);

  const awardedOthers = useMemo(() => {
    const active = activeMarkValue ?? 0;
    return Math.max(0, totals.awarded - active);
  }, [totals.awarded, activeMarkValue]);

  const activeMeta = useMemo(
    () => flatQuestions.find((q) => q.id === activeQuestionId) ?? null,
    [flatQuestions, activeQuestionId],
  );
```

(c) Relax the per-question silent reject in `scheduleSave` so the cap is the only gate (the mark-pad already prevents over-cap selection, but the debounce should still persist exactly what the pad set). Find (lines 141-143):

```ts
        const marksAwarded = draft.marks.trim() === "" ? null : Number(draft.marks);
        if (marksAwarded !== null && !Number.isFinite(marksAwarded)) return;
        if (marksAwarded !== null && (marksAwarded < 0 || marksAwarded > meta.marks)) return;
```

Leave this exactly as-is — it is the correct backstop (never persist a value above the question max). The mark-pad never offers such a value.

(d) Remove the inline `<Input type="number">` from the LEFT rail active block. Find (lines 337-362):

```tsx
                    {!isPassage && isActive && (
                      <div className="px-3 pb-3">
                        <div className="flex items-center gap-2 text-xs">
                          <Input
                            type="number"
                            min={0}
                            max={q.marks}
                            step={0.25}
                            value={marksVal}
                            onChange={(e) =>
                              updateDraft(q.id, { marks: e.target.value })
                            }
                            disabled={isLocked}
                            className={`h-8 w-16 ${overMax ? "border-destructive" : ""}`}
                          />
                          <span className="text-[11px] text-muted-foreground">
                            / {q.marks}
                          </span>
                        </div>
                        {overMax && (
                          <p className="mt-1 text-[10px] text-destructive">
                            Out of range
                          </p>
                        )}
                      </div>
                    )}
```

Replace with a compact read-only display (the pad now does the entry):

```tsx
                    {!isPassage && isActive && (
                      <div className="px-3 pb-3 text-xs text-muted-foreground">
                        {hasMark ? (
                          <span className="font-medium text-foreground tabular-nums">
                            {marksVal} / {q.marks}
                          </span>
                        ) : (
                          <span>Select marks below</span>
                        )}
                      </div>
                    )}
```

(e) Remove the RIGHT-rail "Marks awarded" number input. Find (lines 505-520):

```tsx
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Marks awarded
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={q.marks}
                            step={0.25}
                            value={draft.marks}
                            onChange={(e) =>
                              updateDraft(q.id, { marks: e.target.value })
                            }
                            disabled={isLocked}
                          />
                        </div>
```

Replace with:

```tsx
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          Marks: enter from the selector at the bottom of the screen.
                          {draft.marks.trim() !== "" && (
                            <span className="ml-1 font-medium text-foreground tabular-nums">
                              {draft.marks} / {q.marks}
                            </span>
                          )}
                        </div>
```

(f) Render the sticky mark-pad at the bottom of the desktop layout. Find the closing of the 3-column grid + the desktop wrapper (lines 542-543):

```tsx
        </div>
      </div>
```

Replace with:

```tsx
        </div>
        {activeMeta && activeMeta.marks > 0 && (
          <HybridMarkPad
            questionNumber={activeMeta.questionNumber}
            questionMax={activeMeta.marks}
            value={activeMarkValue}
            examTotal={examTotal}
            awardedOthers={awardedOthers}
            totalAwarded={totals.awarded}
            disabled={isLocked}
            onSelect={(marks) =>
              activeQuestionId && updateDraft(activeQuestionId, { marks: String(marks) })
            }
          />
        )}
      </div>
```

(g) The left-rail footer already shows `{totals.awarded} / {totals.max}`. Change `{totals.max}` to the exam total so the cap is explicit. Find (lines 369-372):

```tsx
                <span className="font-semibold tabular-nums">
                  {totals.awarded} / {totals.max}
                </span>
```

Replace with:

```tsx
                <span className="font-semibold tabular-nums">
                  {totals.awarded} / {examTotal}
                </span>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/lib/hybridMarks.ts src/components/hybrid/HybridMarkPad.tsx src/pages/teacher/HybridEvaluatePage.tsx`
Expected: all exit 0. If `Input` becomes an unused import in `HybridEvaluatePage.tsx`, remove it from the import list to satisfy eslint.

Manual smoke (desktop ≥1024px): open `/evaluations/hybrid/:attemptId` with uploaded pages → select a question → bottom bar shows 0, 0.5 … up to its max; tapping assigns and auto-keeps; total reads `X / {examTotal}`; once the running total nears the exam total, the remaining high buttons disable.

- [ ] **Step 6: Phase-1 build gate + commit**

Run: `npx vite build`
Expected: exit 0.

```bash
git add src/lib/hybridMarks.ts src/components/hybrid/HybridMarkPad.tsx src/pages/teacher/HybridEvaluatePage.tsx
git commit -m "feat(hybrid): bottom number-pad marking (0.5 steps) with hard total cap"
```

---

## Phase 2 — camera-first entry, locked paper, live camera + snapshots

### Task 2.1: Snapshot hooks (`useHybridSnapshots`)

**Files:**
- Create: `src/hooks/useHybridSnapshots.ts`

- [ ] **Step 1: Write the hooks**

```ts
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hybrid proctoring snapshots (flow correction, Phase 2).
 *
 * Written DIRECTLY by the authenticated student — no edge function. The
 * existing `hybrid_sheets_authenticated_insert` storage policy permits the
 * write; the `hybrid_proctoring_snapshots` RLS permits the row. Teacher reads
 * go through signed URLs.
 */

export interface UploadSnapshotArgs {
  attemptId: string;
  examId: string;
  institutionId: string;
  blob: Blob;
}

/** Deterministic-ish unique suffix without Date.now()/Math.random in shared libs. */
function snapshotKey(): string {
  // Allowed here (client runtime, not a workflow script): timestamp + counter.
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function useUploadHybridSnapshot() {
  return useMutation<void, Error, UploadSnapshotArgs>({
    mutationFn: async ({ attemptId, examId, institutionId, blob }) => {
      const path = `snapshots/${institutionId}/${examId}/${attemptId}/${snapshotKey()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("hybrid-answer-sheets")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from("hybrid_proctoring_snapshots")
        .insert({
          attempt_id: attemptId,
          institution_id: institutionId,
          storage_path: path,
        });
      if (rowError) throw rowError;
    },
    // Snapshots are best-effort integrity evidence — never toast/raise to the
    // student mid-exam. Failures are swallowed by the caller.
  });
}

export interface HybridSnapshotSigned {
  id: string;
  captured_at: string;
  flagged: boolean;
  signed_url: string;
}

/** Teacher-side read: snapshots for an attempt with signed URLs. */
export function useHybridSnapshots(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["hybrid-snapshots", attemptId],
    enabled: !!attemptId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridSnapshotSigned[]> => {
      const { data, error } = await supabase
        .from("hybrid_proctoring_snapshots")
        .select("id, storage_path, captured_at, flagged")
        .eq("attempt_id", attemptId!)
        .order("captured_at", { ascending: true })
        .range(0, 199); // bounded read (§23 pagination)
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const { data: signed, error: signedError } = await supabase.storage
        .from("hybrid-answer-sheets")
        .createSignedUrls(rows.map((r) => r.storage_path), 60 * 30);
      if (signedError) throw signedError;
      return rows.map((r, i) => ({
        id: r.id,
        captured_at: r.captured_at,
        flagged: r.flagged,
        signed_url: signed?.[i]?.signedUrl ?? "",
      }));
    },
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/hooks/useHybridSnapshots.ts`
Expected: both exit 0. (If the generated types from Task 0.1 aren't present, `hybrid_proctoring_snapshots` will error — re-run Task 0.1 Step 3 first.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHybridSnapshots.ts
git commit -m "feat(hybrid): snapshot upload + teacher-read hooks"
```

---

### Task 2.2: Camera gate component

**Files:**
- Create: `src/components/hybrid/HybridCameraGate.tsx`

- [ ] **Step 1: Write the gate**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HybridCameraGateProps {
  /** Called once with the live stream when the student grants the camera. */
  onGranted: (stream: MediaStream) => void;
}

/**
 * Blocking gate shown BEFORE the question paper. The student cannot reach the
 * paper without granting camera access. Auto-requests on mount; offers a retry
 * if the browser denied or has no camera.
 */
export function HybridCameraGate({ onGranted }: HybridCameraGateProps) {
  const [status, setStatus] = useState<"requesting" | "denied" | "error">("requesting");
  const requestedRef = useRef(false);

  const request = useCallback(async () => {
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      onGranted(stream);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
    }
  }, [onGranted]);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void request();
  }, [request]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {status === "requesting" ? (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Camera className="h-7 w-7" />
            </div>
            <h1 className="mb-1 text-lg font-semibold text-foreground">
              Allow camera to start
            </h1>
            <p className="mb-4 text-sm text-muted-foreground">
              This exam is proctored. Please allow camera access in the browser prompt — the
              question paper opens as soon as you do.
            </p>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          </>
        ) : (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <CameraOff className="h-7 w-7" />
            </div>
            <h1 className="mb-1 text-lg font-semibold text-foreground">
              Camera access required
            </h1>
            <p className="mb-4 text-sm text-muted-foreground">
              {status === "denied"
                ? "You blocked the camera. Enable it for this site in your browser settings, then tap Retry."
                : "We couldn't access a camera on this device. Check that one is connected, then tap Retry."}
            </p>
            <Button onClick={() => void request()} className="w-full">
              <Camera className="mr-2 h-4 w-4" />
              Retry camera
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/hybrid/HybridCameraGate.tsx`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/hybrid/HybridCameraGate.tsx
git commit -m "feat(hybrid): camera-permission gate before the question paper"
```

---

### Task 2.3: Live self-view + periodic snapshot monitor

**Files:**
- Create: `src/components/hybrid/HybridCameraMonitor.tsx`

- [ ] **Step 1: Write the monitor**

```tsx
import { useEffect, useRef } from "react";
import { Camera } from "lucide-react";
import Compressor from "compressorjs";
import { useUploadHybridSnapshot } from "@/hooks/useHybridSnapshots";

interface HybridCameraMonitorProps {
  stream: MediaStream;
  attemptId: string;
  examId: string;
  institutionId: string;
  /** Snapshot cadence; default 60s. Must stay >= 30s per CLAUDE.md §23. */
  intervalMs?: number;
}

const SNAPSHOT_MAX_DIM = 480;

function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!video.videoWidth || !video.videoHeight) {
      resolve(null);
      return;
    }
    const scale = Math.min(1, SNAPSHOT_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        new Compressor(blob, {
          quality: 0.5,
          mimeType: "image/jpeg",
          success: (result) => resolve(result as Blob),
          error: () => resolve(blob),
        });
      },
      "image/jpeg",
      0.6,
    );
  });
}

/**
 * Small pinned self-view + periodic snapshot uploader for the hybrid writing
 * phase. Snapshots are best-effort: a failed upload is swallowed so it never
 * disrupts the student.
 */
export function HybridCameraMonitor({
  stream,
  attemptId,
  examId,
  institutionId,
  intervalMs = 60_000,
}: HybridCameraMonitorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const upload = useUploadHybridSnapshot();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (!video) return;
      const blob = await captureFrame(video);
      if (cancelled || !blob) return;
      upload.mutate({ attemptId, examId, institutionId, blob });
    };
    const id = setInterval(() => void tick(), intervalMs);
    // First snapshot shortly after mount so there is at least one early frame.
    const warmup = setTimeout(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(warmup);
    };
  }, [attemptId, examId, institutionId, intervalMs, upload]);

  return (
    <div className="fixed bottom-4 right-4 z-40 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground">
        <Camera className="h-3 w-3 text-primary" />
        Proctoring
        <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" />
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="aspect-video w-full bg-black object-cover"
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/hybrid/HybridCameraMonitor.tsx`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/hybrid/HybridCameraMonitor.tsx
git commit -m "feat(hybrid): live self-view + periodic snapshot monitor"
```

---

### Task 2.4: Integrity logger — surface violations for a warning overlay

**Files:**
- Modify: `src/components/hybrid/useHybridIntegrityLogger.ts`

- [ ] **Step 1: Add an optional `onViolation` callback**

Change the args interface (lines 9-14):

```ts
interface UseHybridIntegrityLoggerArgs {
  enabled: boolean;
  attemptId: string | undefined;
  institutionId: string | undefined;
  studentId: string | undefined;
}
```

to:

```ts
interface UseHybridIntegrityLoggerArgs {
  enabled: boolean;
  attemptId: string | undefined;
  institutionId: string | undefined;
  studentId: string | undefined;
  /** Fired (in addition to logging) when the student leaves fullscreen or hides the tab. */
  onViolation?: (type: "tab_switch" | "fullscreen_exit") => void;
}
```

- [ ] **Step 2: Destructure + call it; keep it out of the effect deps via a ref**

Replace the function signature + body opening (lines 24-48) — specifically destructure `onViolation`, store it in a ref, and call it from the two relevant handlers. Find:

```ts
export function useHybridIntegrityLogger({
  enabled,
  attemptId,
  institutionId,
  studentId,
}: UseHybridIntegrityLoggerArgs) {
  useEffect(() => {
    if (!enabled || !attemptId || !institutionId) return;

    const log = (eventType: string, payload?: Record<string, unknown>) => {
      logHybridEvent({
        attemptId,
        institutionId,
        eventType,
        actorId: studentId,
        payload,
      }).catch(() => {});
    };

    const onVisibility = () => {
      log("visibility_change", {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
    };

    const offFullscreen = isFullscreenSupported()
      ? onFullscreenChange(() => {
          if (!getFullscreenElement()) {
            log("fullscreen_exited");
          }
        })
      : () => {};
```

Replace with:

```ts
export function useHybridIntegrityLogger({
  enabled,
  attemptId,
  institutionId,
  studentId,
  onViolation,
}: UseHybridIntegrityLoggerArgs) {
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  useEffect(() => {
    if (!enabled || !attemptId || !institutionId) return;

    const log = (eventType: string, payload?: Record<string, unknown>) => {
      logHybridEvent({
        attemptId,
        institutionId,
        eventType,
        actorId: studentId,
        payload,
      }).catch(() => {});
    };

    const onVisibility = () => {
      log("visibility_change", {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
      if (document.hidden) onViolationRef.current?.("tab_switch");
    };

    const offFullscreen = isFullscreenSupported()
      ? onFullscreenChange(() => {
          if (!getFullscreenElement()) {
            log("fullscreen_exited");
            onViolationRef.current?.("fullscreen_exit");
          }
        })
      : () => {};
```

- [ ] **Step 3: Add the `useRef` import**

Line 1 is `import { useEffect } from "react";` — change to:

```ts
import { useEffect, useRef } from "react";
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/hybrid/useHybridIntegrityLogger.ts`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/hybrid/useHybridIntegrityLogger.ts
git commit -m "feat(hybrid): integrity logger surfaces violations for a warning overlay"
```

---

### Task 2.5: Wire camera-gate → fullscreen → paper + monitor + warning into the attempt page

**Files:**
- Modify: `src/pages/student/HybridExamAttemptPage.tsx`

- [ ] **Step 1: Add imports**

After the existing component imports (line 25, the `useHybridIntegrityLogger` import), add:

```tsx
import { HybridCameraGate } from "@/components/hybrid/HybridCameraGate";
import { HybridCameraMonitor } from "@/components/hybrid/HybridCameraMonitor";
```

- [ ] **Step 2: Add camera-stream + warning state and a stop helper**

After the `inProgress` declaration (line 68: `const inProgress = attempt?.status === "in_progress";`), add:

```tsx
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [violationWarning, setViolationWarning] = useState<string | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopCamera = useCallback(() => {
    setCameraStream((prev) => {
      prev?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const showWarning = useCallback((type: "tab_switch" | "fullscreen_exit") => {
    setViolationWarning(
      type === "tab_switch"
        ? "Stay on this screen until you submit. This was recorded."
        : "Please stay in fullscreen until you submit. This was recorded.",
    );
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    warningTimerRef.current = setTimeout(() => setViolationWarning(null), 6000);
  }, []);
```

`useCallback` and `useState` and `useRef` are already imported (line 1). Stop the camera when leaving in-progress and on unmount — add this effect after the timer effect (after line 116):

```tsx
  // Tear the writing-phase camera down once we leave in-progress (submit / time-up)
  // and on unmount. The upload phase uses a separate (back) camera.
  useEffect(() => {
    if (!inProgress) stopCamera();
  }, [inProgress, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);
```

- [ ] **Step 3: Auto-enter fullscreen once the camera is granted**

Add after the effect from Step 2:

```tsx
  // Auto-enter fullscreen as soon as the camera is granted and we're writing.
  useEffect(() => {
    if (inProgress && cameraStream && isFullscreenSupported() && !getFullscreenElement()) {
      requestFullscreen(containerRef.current).catch(() => {});
    }
  }, [inProgress, cameraStream]);
```

- [ ] **Step 4: Pass `onViolation` to the integrity logger**

Find (lines 77-82):

```tsx
  useHybridIntegrityLogger({
    enabled: inProgress,
    attemptId: attempt?.id,
    institutionId: attempt?.institution_id,
    studentId: attempt?.student_id,
  });
```

Replace with:

```tsx
  useHybridIntegrityLogger({
    enabled: inProgress,
    attemptId: attempt?.id,
    institutionId: attempt?.institution_id,
    studentId: attempt?.student_id,
    onViolation: showWarning,
  });
```

- [ ] **Step 5: Gate the in-progress render on the camera**

The in-progress branch begins at line 196 (`// In-progress — the laptop side.` then `return (`). Immediately BEFORE that `return (`, insert the gate:

```tsx
  // In-progress — camera permission is the FIRST thing. No paper until granted.
  if (inProgress && !cameraStream) {
    return <HybridCameraGate onGranted={(stream) => setCameraStream(stream)} />;
  }
```

- [ ] **Step 6: Render the monitor + warning overlay inside the in-progress view, and relabel the submit button**

Inside the in-progress `return`, just after the opening `<div ref={containerRef} className="min-h-screen bg-background">` (line 197), add the warning overlay:

```tsx
      {violationWarning && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2">
          <div className="flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 shadow-md">
            <AlertTriangle className="h-4 w-4" />
            {violationWarning}
          </div>
        </div>
      )}
```

Before the final closing `</div>` of that in-progress return (the one right before the `<AlertDialog>` at line 282), add the monitor:

```tsx
      {cameraStream && attempt && (
        <HybridCameraMonitor
          stream={cameraStream}
          attemptId={attempt.id}
          examId={attempt.exam_id}
          institutionId={attempt.institution_id}
        />
      )}
```

Relabel the submit button (line 275-277). Find:

```tsx
              <Upload className="mr-2 h-4 w-4" />
              Submit &amp; upload sheets
```

Replace with:

```tsx
              <Upload className="mr-2 h-4 w-4" />
              OK, I'm ready to submit
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/pages/student/HybridExamAttemptPage.tsx`
Expected: both exit 0.

Manual smoke (desktop Chrome): open a hybrid attempt → camera prompt is the first thing; deny → blocked with Retry; grant → page enters fullscreen and the paper + corner self-view appear; exit fullscreen / switch tab → amber warning toast appears and a `fullscreen_exited` / `visibility_change` row is logged, but the attempt is NOT auto-submitted. On iPhone Safari: no fullscreen (no crash), camera + self-view still work.

- [ ] **Step 8: Commit**

```bash
git add src/pages/student/HybridExamAttemptPage.tsx
git commit -m "feat(hybrid): camera-first entry, auto-fullscreen, live monitor, warn-and-log"
```

---

### Task 2.6: Teacher snapshot strip on the evaluation page

**Files:**
- Modify: `src/pages/teacher/HybridEvaluatePage.tsx`

- [ ] **Step 1: Import the read hook**

After the `HybridMarkPad` import (added in Task 1.5), add:

```tsx
import { useHybridSnapshots } from "@/hooks/useHybridSnapshots";
```

- [ ] **Step 2: Fetch snapshots**

After `const data = useHybridEvaluationData(attemptId);` (line 72), add:

```tsx
  const snapshots = useHybridSnapshots(attemptId);
```

- [ ] **Step 3: Render the strip in the center column, above the paper viewer**

In the center `<main>` (line 393), wrap the existing content so the strip sits at the top. Find:

```tsx
          {/* Center — paper viewer */}
          <main className="flex min-h-0 flex-col bg-background">
            {data.pages.length === 0 ? (
```

Replace with:

```tsx
          {/* Center — paper viewer */}
          <main className="flex min-h-0 flex-col bg-background">
            {(snapshots.data?.length ?? 0) > 0 && (
              <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2 scrollbar-hide">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Proctoring
                </span>
                {snapshots.data!.map((s) => (
                  <img
                    key={s.id}
                    src={s.signed_url}
                    alt={`Snapshot ${new Date(s.captured_at).toLocaleTimeString()}`}
                    title={new Date(s.captured_at).toLocaleTimeString()}
                    className="h-12 w-16 shrink-0 rounded border border-border object-cover"
                  />
                ))}
              </div>
            )}
            {data.pages.length === 0 ? (
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/pages/teacher/HybridEvaluatePage.tsx`
Expected: both exit 0.

- [ ] **Step 5: Phase-2 build gate + commit**

Run: `npx vite build`
Expected: exit 0.

```bash
git add src/pages/teacher/HybridEvaluatePage.tsx
git commit -m "feat(hybrid): teacher snapshot strip on the evaluation page"
```

---

## Phase 3 — device-aware upload + 5-minute server-enforced window

### Task 3.1: Shared image-compression util (DRY) + refactor the phone hook

**Files:**
- Create: `src/lib/hybridImage.ts`
- Modify: `src/hooks/useHybridUpload.ts`

- [ ] **Step 1: Write the shared util**

Extract the exact compress + base64 logic currently inline in `useHybridUpload.ts`:

```ts
import Compressor from "compressorjs";

export const HYBRID_TARGET_MAX_BYTES = 500 * 1024; // 500 KB target
export const HYBRID_HARD_CEILING_BYTES = 512 * 1024; // matches storage bucket cap

export async function compressSheetImage(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    new Compressor(file as File, {
      quality: 0.8,
      maxWidth: 1600,
      maxHeight: 1600,
      mimeType: "image/jpeg",
      convertSize: 50 * 1024,
      success: (result) => resolve(result as Blob),
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** Compress a sheet image and return base64 + byte size, enforcing the ceiling. */
export async function compressSheetToBase64(
  file: File | Blob,
): Promise<{ base64: string; sizeBytes: number }> {
  const compressed = await compressSheetImage(file);
  if (compressed.size > HYBRID_HARD_CEILING_BYTES) {
    throw new Error(
      `Image is still ${(compressed.size / 1024).toFixed(0)} KB after compression ` +
        `(max ${HYBRID_TARGET_MAX_BYTES / 1024} KB). Try a sharper photo with less background, in better light.`,
    );
  }
  const base64 = await blobToBase64(compressed);
  return { base64, sizeBytes: compressed.size };
}
```

- [ ] **Step 2: Refactor `useHybridUpload.ts` to use the shared util**

Remove the local `Compressor` import (line 3), the `TARGET_MAX_BYTES`/`HARD_CEILING_BYTES` consts (lines 92-93), `compressImage` (95-107), and `blobToBase64` (109-124). Replace the import block top (lines 1-4):

```ts
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Compressor from "compressorjs";
import { supabase } from "@/integrations/supabase/client";
```

with:

```ts
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressSheetToBase64 } from "@/lib/hybridImage";
```

Then replace the `mutationFn` body of `useUploadHybridPage` (lines 143-176) — the compress/encode/invoke sequence — with:

```ts
    mutationFn: async ({ token, pageNumber, file }) => {
      const { base64, sizeBytes } = await compressSheetToBase64(file);

      const { data, error } = await supabase.functions.invoke(
        "upload-hybrid-page",
        {
          body: {
            token,
            device_fingerprint: deviceFingerprint,
            page_number: pageNumber,
            file_base64: base64,
            file_size_bytes: sizeBytes,
            content_type: "image/jpeg",
          },
        },
      );
      if (error) throw await unwrapFunctionError(error);
      return data as UploadHybridPageResult;
    },
```

(Delete the now-unused `TARGET_MAX_BYTES`/`HARD_CEILING_BYTES`/`compressImage`/`blobToBase64` definitions. `unwrapFunctionError`, `getDeviceFingerprint`, and the types stay.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/lib/hybridImage.ts src/hooks/useHybridUpload.ts`
Expected: both exit 0 with no unused-symbol errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hybridImage.ts src/hooks/useHybridUpload.ts
git commit -m "refactor(hybrid): extract shared sheet-image compression util"
```

---

### Task 3.2: Device detection helper

**Files:**
- Create: `src/lib/deviceKind.ts`

- [ ] **Step 1: Write the helper**

```ts
export type DeviceKind = "phone" | "computer";

/**
 * Best-effort phone-vs-computer detection. Used to choose the hybrid upload UX
 * (phone → direct camera capture; computer → QR + upload-from-storage). The UI
 * always offers a manual override, so a wrong guess is recoverable.
 */
export function detectDeviceKind(): DeviceKind {
  if (typeof navigator === "undefined" || typeof window === "undefined") return "computer";
  const ua = navigator.userAgent || "";
  const isMobileUa = /Android|iPhone|iPod|Windows Phone|Mobile/i.test(ua);
  const isTabletUa = /iPad|Tablet/i.test(ua);
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 768;
  // Treat phones AND tablets as "phone" (touch capture device); everything else
  // is "computer". A coarse pointer on a narrow viewport is the tiebreaker.
  if (isMobileUa || isTabletUa) return "phone";
  return coarse && narrow ? "phone" : "computer";
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/lib/deviceKind.ts`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/deviceKind.ts
git commit -m "feat(hybrid): phone-vs-computer device detection helper"
```

---

### Task 3.3: Authenticated own-device upload hook

**Files:**
- Create: `src/hooks/useUploadHybridSheetAuthed.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressSheetToBase64 } from "@/lib/hybridImage";

/**
 * Authenticated own-device sheet upload (flow correction, Phase 3).
 *
 * For the student's OWN logged-in device — the phone they wrote on, or a laptop
 * uploading files from local storage. Calls the `upload-hybrid-sheet` edge
 * function (JWT auth). The separate paired-phone path keeps using
 * useUploadHybridPage (token plane).
 */

async function unwrapFunctionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error : new Error("Unknown error");
}

export interface UploadHybridSheetArgs {
  attemptId: string;
  pageNumber: number;
  file: File | Blob;
}

export interface UploadHybridSheetResult {
  page_id: string;
  storage_path: string;
  page_number: number;
  attempt_status: string;
}

export function useUploadHybridSheetAuthed() {
  return useMutation<UploadHybridSheetResult, Error, UploadHybridSheetArgs>({
    mutationFn: async ({ attemptId, pageNumber, file }) => {
      const { base64, sizeBytes } = await compressSheetToBase64(file);
      const { data, error } = await supabase.functions.invoke("upload-hybrid-sheet", {
        body: {
          attempt_id: attemptId,
          page_number: pageNumber,
          file_base64: base64,
          file_size_bytes: sizeBytes,
          content_type: "image/jpeg",
        },
      });
      if (error) throw await unwrapFunctionError(error);
      return data as UploadHybridSheetResult;
    },
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/hooks/useUploadHybridSheetAuthed.ts`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUploadHybridSheetAuthed.ts
git commit -m "feat(hybrid): authenticated own-device sheet upload hook"
```

---

### Task 3.4: Device-aware upload window (rewrite `HybridWaitingForUpload`)

**Files:**
- Modify: `src/components/hybrid/HybridWaitingForUpload.tsx` (full replacement)
- Modify: `src/pages/student/HybridExamAttemptPage.tsx` (pass `maxPages`)

- [ ] **Step 1: Pass `maxPages` from the attempt page**

In `src/pages/student/HybridExamAttemptPage.tsx`, find the awaiting-upload render (lines 186-192):

```tsx
    return (
      <HybridWaitingForUpload
        attempt={attempt}
        graceWindowMinutes={graceWindowMinutes}
        onDone={() => attemptQuery.refetch()}
      />
    );
```

Replace with:

```tsx
    return (
      <HybridWaitingForUpload
        attempt={attempt}
        graceWindowMinutes={graceWindowMinutes}
        maxPages={exam?.settings?.max_pages ?? 10}
        onDone={() => attemptQuery.refetch()}
      />
    );
```

- [ ] **Step 2: Replace `HybridWaitingForUpload.tsx` entirely**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileImage, Upload, Clock, Camera, ImagePlus, Smartphone, Monitor } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { HybridPairingCard } from "./HybridPairingCard";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
import { detectDeviceKind, type DeviceKind } from "@/lib/deviceKind";
import { useUploadHybridSheetAuthed } from "@/hooks/useUploadHybridSheetAuthed";
import {
  useHybridPairingToken,
  useHybridUploadedPages,
  useFinalizeHybridUpload,
  type HybridAttempt,
  type HybridUploadedPage,
} from "@/hooks/useHybridAttempt";

interface HybridWaitingForUploadProps {
  attempt: HybridAttempt;
  graceWindowMinutes: number;
  maxPages: number;
  onDone: () => void;
}

function useGraceCountdown(startedAt: string, windowMinutes: number) {
  const expiresAt = useMemo(
    () => new Date(new Date(startedAt).getTime() + windowMinutes * 60 * 1000).getTime(),
    [startedAt, windowMinutes],
  );
  const [remaining, setRemaining] = useState<number>(0);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

function PageThumbnail({ page }: { page: HybridUploadedPage }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from("hybrid-answer-sheets")
      .createSignedUrl(page.storage_path, 60 * 10)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [page.storage_path]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="aspect-[3/4] w-full bg-muted">
        {url ? (
          <img
            src={url}
            alt={`Page ${page.page_number}`}
            className="h-full w-full object-cover"
            style={{ transform: `rotate(${page.rotation_degrees}deg)` }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <FileImage className="h-6 w-6 opacity-50" />
          </div>
        )}
      </div>
      <div className="px-2 py-1 text-center text-xs font-medium text-foreground">
        Page {page.page_number}
      </div>
    </div>
  );
}

export function HybridWaitingForUpload({
  attempt,
  graceWindowMinutes,
  maxPages,
  onDone,
}: HybridWaitingForUploadProps) {
  const submittedAt = attempt.submitted_at ?? new Date().toISOString();
  const remaining = useGraceCountdown(submittedAt, graceWindowMinutes);

  const [deviceKind, setDeviceKind] = useState<DeviceKind>(() => detectDeviceKind());
  const [showCamera, setShowCamera] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pairing = useHybridPairingToken(attempt.id, { enabled: deviceKind === "computer" });
  const pagesQuery = useHybridUploadedPages(attempt.id, { enabled: true, pollMs: 5000 });
  const finalize = useFinalizeHybridUpload(attempt.id);
  const uploadAuthed = useUploadHybridSheetAuthed();

  const pages = pagesQuery.data ?? [];
  const expired = remaining <= 0;
  const atCap = pages.length >= maxPages;

  const nextPageNumber = useMemo(() => {
    const used = new Set(pages.map((p) => p.page_number));
    for (let i = 1; i <= maxPages; i++) {
      if (!used.has(i)) return i;
    }
    return maxPages + 1;
  }, [pages, maxPages]);

  // Auto-finalize when the window closes with pages present; the cron is the
  // server-side backstop, this just makes the student's screen advance promptly.
  const autoFinalizedRef = useRef(false);
  useEffect(() => {
    if (expired && pages.length > 0 && !autoFinalizedRef.current && !finalize.isPending) {
      autoFinalizedRef.current = true;
      finalize.mutateAsync().then(onDone).catch(() => {});
    }
  }, [expired, pages.length, finalize, onDone]);

  const uploadFile = async (file: File) => {
    if (atCap || expired) return;
    setUploadError(null);
    try {
      await uploadAuthed.mutateAsync({
        attemptId: attempt.id,
        pageNumber: nextPageNumber,
        file,
      });
      pagesQuery.refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleCameraCapture = (file: File) => {
    setShowCamera(false);
    void uploadFile(file);
  };

  const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      if (atCap || expired) break;
      // eslint-disable-next-line no-await-in-loop -- sequential to respect page numbering + cap
      await uploadFile(f);
    }
  };

  const handleDone = async () => {
    try {
      await finalize.mutateAsync();
      onDone();
    } catch {
      /* toastError handled inside the hook */
    }
  };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <header className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Upload className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-foreground md:text-2xl">
          Submitted — now upload your sheets
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Photograph every answer sheet and upload them before the timer runs out.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          {expired ? (
            <span className="text-amber-700">Upload window has closed</span>
          ) : (
            <span>
              Time left to upload:{" "}
              <strong>
                {minutes}:{seconds.toString().padStart(2, "0")}
              </strong>
            </span>
          )}
        </div>
      </header>

      {/* Device toggle */}
      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={deviceKind === "phone" ? "default" : "outline"}
          onClick={() => setDeviceKind("phone")}
        >
          <Smartphone className="mr-1.5 h-4 w-4" />
          I'm on a phone
        </Button>
        <Button
          type="button"
          size="sm"
          variant={deviceKind === "computer" ? "default" : "outline"}
          onClick={() => setDeviceKind("computer")}
        >
          <Monitor className="mr-1.5 h-4 w-4" />
          I'm on a computer
        </Button>
      </div>

      {!expired && deviceKind === "phone" && (
        <section className="space-y-3">
          {showCamera ? (
            <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                size="lg"
                className="h-16"
                disabled={atCap}
                onClick={() => setShowCamera(true)}
              >
                <Camera className="mr-2 h-5 w-5" />
                Open camera
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-16"
                disabled={atCap}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-5 w-5" />
                Choose photo
              </Button>
            </div>
          )}
        </section>
      )}

      {!expired && deviceKind === "computer" && (
        <section className="space-y-3">
          <HybridPairingCard
            token={pairing.data}
            isLoading={pairing.isLoading}
            isFetching={pairing.isFetching}
            onRegenerate={pairing.regenerate}
          />
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="mb-3 text-xs text-muted-foreground">
              Already took photos on another device and copied them here? Upload them straight
              from this computer.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={atCap}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              Upload from this computer
            </Button>
          </div>
        </section>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFilesChosen}
      />

      {uploadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {uploadError}
        </div>
      )}
      {atCap && !expired && (
        <p className="text-center text-[11px] text-muted-foreground">
          You've reached the {maxPages}-page cap.
        </p>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Pages uploaded ({pages.length})
          </h2>
        </div>
        {pages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No pages yet — capture or upload your sheets and they'll appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pages.map((p) => (
              <PageThumbnail key={p.id} page={p} />
            ))}
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-card/95 p-4 backdrop-blur md:-mx-8">
        <Button
          className="w-full"
          size="lg"
          disabled={pages.length === 0 || finalize.isPending || expired}
          onClick={handleDone}
        >
          <CheckCircle2 className="mr-2 h-5 w-5" />
          {finalize.isPending ? "Finalizing…" : "Done uploading"}
        </Button>
        {pages.length === 0 && !expired && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Upload at least one page before you can finish.
          </p>
        )}
        {expired && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            The window has closed. Your uploaded pages have been sent to your teacher.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/components/hybrid/HybridWaitingForUpload.tsx src/pages/student/HybridExamAttemptPage.tsx`
Expected: both exit 0.

Manual smoke: on a phone-width viewport → "Open camera" / "Choose photo" both upload and appear in the grid; on a desktop viewport → QR card + "Upload from this computer" file picker both land pages; let the timer hit 0 with pages present → auto-advances (finalized); a late phone upload via the QR path returns 410 from the server.

- [ ] **Step 4: Commit**

```bash
git add src/components/hybrid/HybridWaitingForUpload.tsx src/pages/student/HybridExamAttemptPage.tsx
git commit -m "feat(hybrid): device-aware upload window (phone capture + laptop QR/file), 5-min timer, auto-finalize"
```

---

### Task 3.5: Explicit "Open camera / Choose file" split on the paired-phone page

**Files:**
- Modify: `src/pages/student/HybridUploadPage.tsx`

- [ ] **Step 1: Import `CameraCapture` and add a camera-sheet state**

After the `useHybridUpload` imports (lines 23-26), add:

```tsx
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
```

Inside the component, after `const [finished, setFinished] = useState(false);` (line 79), add:

```tsx
  const [showCamera, setShowCamera] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
```

- [ ] **Step 2: Add a gallery file handler + camera capture handler**

After `handleFileChosen` (ends line 121), add:

```tsx
  const handleCameraCapture = (file: File) => {
    setShowCamera(false);
    if (atCap) return;
    const pageNumber = nextPageNumber;
    setPending((prev) => [
      ...prev,
      { pageNumber, file, previewUrl: URL.createObjectURL(file) },
    ]);
  };
```

(`handleFileChosen` already covers the gallery input; we'll just point a second input with no `capture` attribute at it.)

- [ ] **Step 3: Replace the single capture button with two explicit options + a camera sheet**

Find (lines 250-272):

```tsx
        {/* Capture button */}
        <Button
          onClick={handleCaptureClick}
          size="lg"
          className="h-16 w-full text-base"
          disabled={atCap}
        >
          <Camera className="mr-2 h-5 w-5" />
          {atCap ? `Reached ${maxPages}-page cap` : `Capture page ${nextPageNumber}`}
        </Button>
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChosen}
        />

        <p className="text-center text-xs text-muted-foreground">
          Use your phone camera. Take a clear photo of each sheet — full sheet in frame, no
          glare. We'll compress automatically.
        </p>
```

Replace with:

```tsx
        {/* Capture options */}
        {showCamera ? (
          <CameraCapture onCapture={handleCameraCapture} onClose={() => setShowCamera(false)} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => !atCap && setShowCamera(true)}
              size="lg"
              className="h-16 text-base"
              disabled={atCap}
            >
              <Camera className="mr-2 h-5 w-5" />
              Open camera
            </Button>
            <Button
              onClick={() => !atCap && galleryInputRef.current?.click()}
              size="lg"
              variant="outline"
              className="h-16 text-base"
              disabled={atCap}
            >
              <Upload className="mr-2 h-5 w-5" />
              Choose file
            </Button>
          </div>
        )}
        {/* Native camera input (kept for the OS quick-capture path) */}
        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChosen}
        />
        {/* Gallery / file input (no capture attr → picks an existing image) */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChosen}
        />

        <p className="text-center text-xs text-muted-foreground">
          {atCap
            ? `Reached the ${maxPages}-page cap.`
            : "Open the camera for a fresh photo, or choose an existing image. Full sheet in frame, no glare — we'll compress automatically."}
        </p>
```

(`handleCaptureClick` is now unused — leave it only if referenced elsewhere; otherwise remove it and the `Camera`/`Upload` icons remain imported and used.)

- [ ] **Step 4: Remove the now-unused `handleCaptureClick` if eslint flags it**

If `npx eslint` reports `handleCaptureClick` as unused, delete its definition (lines 102-105).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` then `npx eslint src/pages/student/HybridUploadPage.tsx`
Expected: both exit 0.

Manual smoke (phone, via QR link): "Open camera" launches the in-page capture UI (take → confirm → page queued); "Choose file" opens the gallery; both queue + upload as before.

- [ ] **Step 6: Phase-3 build gate + commit**

Run: `npx vite build`
Expected: exit 0.

```bash
git add src/pages/student/HybridUploadPage.tsx
git commit -m "feat(hybrid): explicit camera/file split on the paired-phone upload page"
```

---

## Final verification (whole feature)

- [ ] **Step 1: Full gate**

Run, from repo root:
```
npx tsc --noEmit
npx eslint src/lib/hybridMarks.ts src/lib/deviceKind.ts src/lib/hybridImage.ts src/components/hybrid/HybridMarkPad.tsx src/components/hybrid/HybridCameraGate.tsx src/components/hybrid/HybridCameraMonitor.tsx src/components/hybrid/HybridWaitingForUpload.tsx src/components/hybrid/useHybridIntegrityLogger.ts src/hooks/useHybridSnapshots.ts src/hooks/useUploadHybridSheetAuthed.ts src/hooks/useHybridUpload.ts src/hooks/useSaveExam.ts src/hooks/useUpdateExam.ts src/pages/student/HybridExamAttemptPage.tsx src/pages/student/HybridUploadPage.tsx src/pages/teacher/HybridEvaluatePage.tsx src/components/exam-creation/screens/ExamDetailsScreen.tsx src/components/exam-creation/screens/ReviewPublishScreen.tsx src/types/exam.ts
npx vite build
```
Expected: all three exit 0.

- [ ] **Step 2: Confirm all edge functions are deployed**

```
npx supabase@latest functions deploy upload-hybrid-page --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy upload-hybrid-sheet --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy publish-hybrid-marks --project-ref gyymkgohcijeksmrzuyw
```

- [ ] **Step 3: End-to-end manual smoke (per spec §10)**

1. **Creation:** Build a hybrid exam → "Immediately" not offered, note shown; upload-window slider is 3–15, default 5. Save → DB `result_visibility = after_teacher_releases`, `hybrid_exam_settings.grace_window_minutes = 5`.
2. **Attempt (desktop Chrome + iPhone Safari):** open → camera prompt first; deny → blocked; grant → fullscreen (desktop) / graceful no-op (iPhone) + corner self-view; ~every 60 s a row lands in `hybrid_proctoring_snapshots`; exit fullscreen / switch tab → amber warning + log row, no auto-submit; tap "OK, I'm ready to submit".
3. **Upload:** phone → "Open camera"/"Choose photo" upload via authed fn; computer → QR (token) and "Upload from this computer" (authed) both land; let exam duration elapse mid-writing → auto-moved to upload window with the 5-min timer; let the window expire → server rejects late uploads (410), cron moves the attempt to `pending_evaluation`/`cancelled_no_upload`.
4. **Evaluation (≥1024px):** snapshot strip shows; select a question → bottom 0.5-step pad; total reads `X / {examTotal}`; high buttons disable near the cap; publish blocked until `pending_evaluation`; publishing an over-total payload is rejected server-side.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin hybrid/exam-flow-correction
gh pr create --title "Hybrid exam flow correction" --body "Implements docs/superpowers/specs/2026-06-02-hybrid-exam-flow-correction-design.md — camera-first entry, locked fullscreen paper with live camera + snapshots, 5-min server-enforced upload window, device-aware upload (phone capture + laptop QR/file), bottom number-pad marking with 0.5 steps + hard total cap, and removal of the immediate-results option for hybrid."
```

---

## Self-review notes (author)

- **Spec coverage:** §5.1→T0.1, §5.2→T0.2, §5.3→T0.3, §5.4→T0.4, §5.5→T0.5, §5.6→T1.2/T1.3, §6.1→T1.3/T1.4, §6.2/6.3→T0.5/T1.5, §7.1→T2.2/T2.5, §7.2→T2.4/T2.5, §7.3→T2.1/T2.3/T2.5, §7.4→T2.5, §7.5→T2.6, §8.1→T3.4, §8.2→T3.2, §8.3/8.4→T3.3/T3.4, §8.5→T0.2/T0.3/T0.4/T3.4, §8.6→T3.5. All spec sections map to a task.
- **Type consistency:** `compressSheetToBase64` returns `{ base64, sizeBytes }` and is consumed identically in T3.1 and T3.3; `DeviceKind` defined in T3.2 imported in T3.4; `buildMarkSteps`/`maxSelectableForActive` defined in T1.5 Step 1 and consumed in T1.5 Step 3; `HybridWaitingForUpload` gains `maxPages` prop in T3.4 and the caller is updated in the same task.
- **DB column name:** the upload-window value stays in the existing `grace_window_minutes` column (and `HybridExamSettings.graceWindowMinutes`) — only labels/defaults/ranges change, so no rename migration is needed.
