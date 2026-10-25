# SALCI Olympiad Phase 5a — Publish + Results + Certificates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the publish flow: school admin closes the campaign, the system computes ranks, generates result PDFs + certificates for every student, emails parents, and surfaces published results on the student dashboard with per-question review.

**Architecture:** Schema adds `oly_results` (per-student aggregate) + `oly_publish_jobs` (async job state) + 4 SECURITY DEFINER RPCs. Publish flow: client calls `oly_publish_initiate` RPC (atomic status flip + job row creation), then invokes `oly-publish-school-results` edge function which runs the orchestration (compute ranks → generate PDFs in batches of 10 → send emails). Ranks computed server-side via window function (RANK() OVER percentage DESC, time ASC). PDFs generated per-student via parallel edge function invocations. Idempotent on retry — each step checks "already done?" before re-doing work.

**Tech Stack:** React 18 + TypeScript, Vite, TanStack Query v5, React Router v6, Supabase (PostgreSQL + RLS + Edge Functions + Storage + Resend), shadcn/ui + Tailwind, KaTeX via `MathText`, `pdf-lib`.

**Spec:** [docs/superpowers/specs/2026-05-27-olympiad-phase-5a-publish-and-results-design.md](../specs/2026-05-27-olympiad-phase-5a-publish-and-results-design.md)
**Phase 4b precedent:** [docs/superpowers/plans/2026-05-27-olympiad-phase-4b-exam-delivery.md](./2026-05-27-olympiad-phase-4b-exam-delivery.md)

**No test infrastructure** — verification via §5a (tsc + eslint + vite build).

**Concurrency target:** 200-500 students per school × dozens of schools publishing concurrently. The publish pipeline is async + idempotent + batched.

**Engineer assumptions:** Read CLAUDE.md §5a, §17, §19, §20a, §22, §23 before starting. Read Phase 4b plan for RPC patterns. Familiarity with `pdf-lib` from Phase 2 receipt-generate + Phase 3b credentials-PDF helps.

---

## §23 compliance summary

- All FKs indexed in same migration (Task 1)
- All RPCs SECURITY DEFINER with `auth.uid()` ownership checks
- `oly_publish_initiate` uses `FOR UPDATE` lock on school row to prevent concurrent triggers
- Rank computation is server-side via window function (single query, no client-side aggregation)
- Publish job is idempotent — re-running the orchestrator continues from last successful step
- All hot reads (`oly_get_published_result`) have explicit `staleTime: 60_000`
- Publish-status polling: 5s interval with §23.2 justification comment
- No `auth.getUser()` without JWT (uses `auth.uid()` in RPCs; `useAuth().user` in client)
- No `select("*")` outside admin paths

---

## File Structure

```
supabase/
  migrations/
    <ts>_oly_phase_5a_publish.sql                                     (NEW)
  functions/
    oly-publish-school-results/index.ts                               (NEW) — orchestrator
    oly-generate-result-pdf/index.ts                                  (NEW) — per-student multi-page report
    oly-generate-certificate-pdf/index.ts                             (NEW) — per-student single-page certificate
    oly-send-results-email/index.ts                                   (NEW) — per-student Resend email

src/
  hooks/olympiad/
    usePublishInitiate.ts                                             (NEW)
    useOlympiadPublishJob.ts                                          (NEW)
    useOlympiadPublishedResult.ts                                     (NEW)
    useOlympiadPublishedResultUrl.ts                                  (NEW)
    useOlympiadReviewQuestions.ts                                     (NEW)
  components/olympiad/
    school/
      PublishResultsDialog.tsx                                        (NEW)
      PublishJobStatus.tsx                                            (NEW)
    student/
      PublishedResultCard.tsx                                         (NEW)
      ReviewQuestionItem.tsx                                          (NEW)
  pages/
    school/olympiad/
      OlympiadSchoolPublishStatusPage.tsx                             (NEW)
      OlympiadSchoolDashboardPage.tsx                                 (EDIT) — Publish button active
    student/olympiad/
      OlympiadStudentDashboardPage.tsx                                (EDIT) — post-publish result card
      OlympiadStudentReviewPage.tsx                                   (NEW)
  App.tsx                                                             (EDIT) — register 2 new routes
```

---

## Section A — Foundation (migration)

### Task 1: Phase 5a schema migration

**Files:**
- Create: `supabase/migrations/<ts>_oly_phase_5a_publish.sql`

- [ ] **Step 1.1: Generate timestamp**

```powershell
Get-Date -AsUTC -Format yyyyMMddHHmmss
```

- [ ] **Step 1.2: Create migration file**

Read the spec file (`docs/superpowers/specs/2026-05-27-olympiad-phase-5a-publish-and-results-design.md`) sections 2.1-2.4 for the full SQL. Transcribe verbatim. Key sections:

1. `create sequence oly_certificate_seq start 1;`
2. `oly_results` table with all columns + 6 indexes + RLS (super_admin, school_admin SELECT, teacher SELECT, student SELECT)
3. `oly_publish_jobs` table with `unique(oly_school_id)` constraint + 3 indexes + updated_at trigger + RLS
4. RPC `oly_publish_initiate(oly_school_id)` — atomic status flip + job creation + audit log
5. RPC `oly_publish_compute_ranks(oly_school_id)` — window function ranks + tier assignment + insert oly_results rows (including absent rows)
6. RPC `oly_get_published_result(student_id default null)` — self-lookup or by-id with scope check
7. RPC `oly_get_published_signed_url_path(result_id, kind)` — returns storage path after scope check
8. Audit log enum extension to include `results_published`, `result_pdf_generated`, `certificate_pdf_generated`, `results_email_sent`

### Step 1.3: Apply + regenerate types + verify

```bash
npx supabase db push
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npx tsc --noEmit
```

### Step 1.4: Commit

```bash
git add supabase/migrations/<ts>_oly_phase_5a_publish.sql src/integrations/supabase/types.ts
git commit -m "feat(olympiad): phase 5a schema - results, publish jobs, 4 RPCs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Critical correctness checks (T1)

- **`oly_publish_compute_ranks`** uses `RANK() OVER (PARTITION BY grade_level_id ORDER BY percentage DESC NULLS LAST, time_seconds ASC)` for class rank and `RANK() OVER (ORDER BY percentage DESC NULLS LAST, time_seconds ASC)` for school rank. Ties handled by RANK() (skips next).
- **Absent students** also get an `oly_results` row with tier='absent' and certificate_id (yes — for record-keeping; cert is never generated).
- **`on conflict (oly_student_id) do nothing`** on both inserts (attempted + absent) makes the RPC idempotent — re-running returns 0 inserted on already-published schools.
- **Audit log action enum** must include the new actions before any insert uses them. Plan SQL drops + recreates the check constraint with the full updated list.

---

## Section B — Edge functions

### Task 2: 4 edge functions (bundled dispatch recommended)

Files:
- `supabase/functions/oly-publish-school-results/index.ts`
- `supabase/functions/oly-generate-result-pdf/index.ts`
- `supabase/functions/oly-generate-certificate-pdf/index.ts`
- `supabase/functions/oly-send-results-email/index.ts`

#### 2.1 `oly-publish-school-results` (orchestrator)

Input: `{ job_id, oly_school_id }`. Verifies caller. Runs 3-step pipeline with idempotency:

```ts
// Step 1: compute ranks (idempotent — RPC uses ON CONFLICT DO NOTHING)
await supabase.rpc("oly_publish_compute_ranks", { p_oly_school_id });
await updateJob({ status: 'generating_pdfs' });

// Step 2: generate PDFs in batches of 10 in parallel
const { data: results } = await supabase.from("oly_results")
  .select("id, result_pdf_path, certificate_pdf_path, oly_student_id")
  .eq("oly_school_id", p_oly_school_id);

const BATCH_SIZE = 10;
for (let i = 0; i < results.length; i += BATCH_SIZE) {
  const chunk = results.slice(i, i + BATCH_SIZE);
  await Promise.allSettled(chunk.flatMap((r) => [
    r.result_pdf_path
      ? Promise.resolve()
      : supabase.functions.invoke("oly-generate-result-pdf", { body: { oly_result_id: r.id } }),
    r.certificate_pdf_path
      ? Promise.resolve()
      : supabase.functions.invoke("oly-generate-certificate-pdf", { body: { oly_result_id: r.id } }),
  ]));
  await supabase.from("oly_publish_jobs").update({ processed_students: i + chunk.length }).eq("id", job_id);
}

await updateJob({ status: 'sending_emails' });

// Step 3: emails in chunks
const { data: emailable } = await supabase.from("oly_results")
  .select("id, oly_student_id, emailed_at")
  .eq("oly_school_id", p_oly_school_id)
  .is("emailed_at", null);
for (let i = 0; i < emailable.length; i += BATCH_SIZE) {
  const chunk = emailable.slice(i, i + BATCH_SIZE);
  await Promise.allSettled(chunk.map((r) =>
    supabase.functions.invoke("oly-send-results-email", { body: { oly_result_id: r.id } })
  ));
}

await updateJob({ status: 'completed', completed_at: now });
```

Wrap the whole pipeline in try/catch — on failure set `status: 'failed'`, `error: message`.

#### 2.2 `oly-generate-result-pdf`

Input: `{ oly_result_id }`. Loads result + student + school + attempt + snapshots + answers. Generates multi-page A4 PDF via pdf-lib:

- **Page 1**: SALCI branding header, student identity block, big score, tier badge, ranks, total time
- **Page 2**: Subject-wise summary (for each of 3 subjects): name, score, percentage, time, topic table
- **Pages 3-N**: Per-question breakdown — question text (plain-text fallback for KaTeX in 5a; mark as a follow-up in 5b for image rendering), 4 options, student answer (red/green), correct answer (always green), marks
- **Footer page**: Behavioral insights (pacing notes computed from telemetry; phase-5a uses simple averages)

Stores at `olympiad-receipts/results/{result_id}.pdf`. Updates `oly_results.result_pdf_path` + `result_pdf_generated_at`. Inserts audit log row `result_pdf_generated`.

Skip if `result_pdf_path IS NOT NULL` (idempotent).

#### 2.3 `oly-generate-certificate-pdf`

Input: `{ oly_result_id }`. Single-page landscape A4 PDF:
- SALCI logo + branded border (use brand-primary teal: `#249ca2`)
- "Certificate of Achievement" (Gold/Silver/Bronze) or "Certificate of Participation"
- Centered student name + class + school
- Combined score
- Rank in school (only on Gold/Silver/Bronze)
- "Authorized by Team SALCI" placeholder signature
- Date of publish
- Certificate ID at bottom

Skip generation for `certificate_tier = 'absent'` — no certificate for absentees.

Skip if `certificate_pdf_path IS NOT NULL`. Inserts audit log `certificate_pdf_generated`.

#### 2.4 `oly-send-results-email`

Input: `{ oly_result_id }`. Loads result + student. If `parent_email IS NULL`, skip + log.

Generates signed URLs (7-day TTL) for both PDFs. Sends Resend email with both URLs as clickable links in the HTML body:

```
Subject: SALCI Olympiad {YEAR} Results — {Student Name}

<p>Dear Parent,</p>
<p>Results for the SALCI Olympiad {YEAR} have been published.</p>
<p>
<strong>Student:</strong> {Name}<br>
<strong>Roll Number:</strong> {SO26-...}<br>
<strong>Combined Score:</strong> {X / Y} ({P}%)<br>
<strong>Certificate:</strong> {Gold / Silver / Bronze / Participation}<br>
<strong>Rank in School:</strong> {rank} of {total}
</p>
<p><a href="{result_pdf_url}">Download detailed report</a></p>
<p><a href="{certificate_pdf_url}">Download certificate</a></p>
<p>Login to view your full report and review your answers: <a href="{login_url}">SALCI Olympiad</a></p>
<p>Use the same credentials as before (Roll Number + Date of Birth).</p>
<p>Best regards,<br>Team SALCI</p>
```

Idempotent: skip if `emailed_at IS NOT NULL`. Inserts audit log `results_email_sent`.

#### Deploy all 4

```bash
npx supabase@latest functions deploy oly-publish-school-results --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-generate-result-pdf --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-generate-certificate-pdf --project-ref gyymkgohcijeksmrzuyw
npx supabase@latest functions deploy oly-send-results-email --project-ref gyymkgohcijeksmrzuyw
```

#### Commit

```bash
git add supabase/functions/oly-publish-school-results/ supabase/functions/oly-generate-result-pdf/ supabase/functions/oly-generate-certificate-pdf/ supabase/functions/oly-send-results-email/
git commit -m "feat(olympiad): phase 5a edge functions - publish orchestrator, result + certificate PDFs, results email"
```

---

## Section C — Hooks + Admin UI

### Task 3: 5 hooks + Publish dialog + Publish status page

**Files:**
- 5 hooks under `src/hooks/olympiad/`
- 2 components: `PublishResultsDialog.tsx`, `PublishJobStatus.tsx`
- 1 page: `OlympiadSchoolPublishStatusPage.tsx`
- App.tsx route registration

#### Hooks (full code)

**`usePublishInitiate.ts`** — atomic RPC + edge function trigger:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export function usePublishInitiate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ oly_school_id }: { oly_school_id: string }) => {
      const { data, error } = await supabase.rpc("oly_publish_initiate", { p_oly_school_id });
      if (error) throw error;
      const result = data as { ok: true; job_id: string; total_students: number };
      // Fire-and-forget the orchestrator
      invokeEdgeFunction<{ ok: true }>("oly-publish-school-results", {
        job_id: result.job_id, oly_school_id,
      }).catch(() => { /* server keeps running; client polls for status */ });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad"] });
      toast.success("Publish initiated. Results will be available shortly.");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't initiate publish.", context: "usePublishInitiate" }),
  });
}
```

**`useOlympiadPublishJob.ts`** — polling hook:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublishJobStatus = "queued" | "computing_ranks" | "generating_pdfs" | "sending_emails" | "completed" | "failed";

export type PublishJob = {
  id: string;
  oly_school_id: string;
  status: PublishJobStatus;
  total_students: number;
  processed_students: number;
  failed_students: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export function useOlympiadPublishJob(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "publish-job", olySchoolId],
    queryFn: async (): Promise<PublishJob | null> => {
      if (!olySchoolId) return null;
      const { data, error } = await supabase
        .from("oly_publish_jobs")
        .select("id, oly_school_id, status, total_students, processed_students, failed_students, error, started_at, completed_at")
        .eq("oly_school_id", olySchoolId)
        .maybeSingle();
      if (error) throw error;
      return data as PublishJob | null;
    },
    enabled: !!olySchoolId,
    // §23.2: 5s poll is justified — admin watches the pipeline progress
    // through ~5 minutes. Polling stops once status hits completed/failed.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 5_000;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}
```

**`useOlympiadPublishedResult.ts`**:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PublishedResult = {
  ok: true;
  result_id: string;
  full_name: string;
  roll_number: string;
  class_label: string;
  section_label: string | null;
  total_marks_obtained: number;
  total_max_marks: number;
  percentage: number;
  subject_scores: Array<{ subject_id: string; subject_name: string; correct: number; total: number; marks_obtained: number; marks_max: number }>;
  total_time_seconds: number | null;
  class_rank: number | null;
  class_total: number | null;
  school_rank: number | null;
  school_total: number | null;
  certificate_tier: "gold" | "silver" | "bronze" | "participation" | "absent";
  certificate_id: string;
  result_pdf_path: string | null;
  certificate_pdf_path: string | null;
  published_at: string;
} | { ok: false; reason: string };

export function useOlympiadPublishedResult() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "published-result", user?.id],
    queryFn: async (): Promise<PublishedResult> => {
      if (!user?.id) return { ok: false, reason: "not_authenticated" };
      const { data, error } = await supabase.rpc("oly_get_published_result");
      if (error) throw error;
      return data as PublishedResult;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
```

**`useOlympiadPublishedResultUrl.ts`** — signed URL mutation:

```ts
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

const BUCKET = "olympiad-receipts";

export function useOlympiadPublishedResultUrl() {
  return useMutation({
    mutationFn: async ({ resultId, kind }: { resultId: string; kind: "result" | "certificate" }): Promise<string> => {
      const { data: pathData, error: pathErr } = await supabase.rpc("oly_get_published_signed_url_path", {
        p_result_id: resultId, p_kind: kind,
      });
      if (pathErr) throw pathErr;
      if (!pathData) throw new Error("PDF not generated yet");
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pathData as string, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't open PDF.", context: "useOlympiadPublishedResultUrl" }),
  });
}
```

**`useOlympiadReviewQuestions.ts`** — wraps existing `oly_get_attempt_questions` RPC + injects correct_answer:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReviewQuestion = {
  snapshot_id: string;
  subject_id: string;
  position: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  marks: number;
  selected_answer: "A" | "B" | "C" | "D" | null;
  correct_answer: "A" | "B" | "C" | "D";
};

export function useOlympiadReviewQuestions(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "review-questions", attemptId],
    queryFn: async (): Promise<ReviewQuestion[]> => {
      if (!attemptId) return [];
      // Direct SELECT on oly_questions_snapshot (RLS lets student SELECT own via attempt ownership)
      const { data, error } = await supabase
        .from("oly_questions_snapshot")
        .select("id, subject_id, position_in_subject, question_text, option_a, option_b, option_c, option_d, correct_answer, marks")
        .eq("oly_attempt_id", attemptId)
        .order("subject_id")
        .order("position_in_subject");
      if (error) throw error;

      const snapshotIds = (data ?? []).map((q) => q.id);
      if (snapshotIds.length === 0) return [];

      const { data: answers } = await supabase
        .from("oly_answers")
        .select("oly_question_snapshot_id, selected_answer")
        .in("oly_question_snapshot_id", snapshotIds);

      const answerMap = new Map<string, string | null>();
      for (const a of answers ?? []) answerMap.set(a.oly_question_snapshot_id, a.selected_answer);

      return (data ?? []).map((q) => ({
        snapshot_id: q.id,
        subject_id: q.subject_id,
        position: q.position_in_subject,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        marks: q.marks,
        selected_answer: (answerMap.get(q.id) ?? null) as "A" | "B" | "C" | "D" | null,
        correct_answer: q.correct_answer as "A" | "B" | "C" | "D",
      }));
    },
    enabled: !!attemptId,
    staleTime: 5 * 60_000,  // immutable post-publish — aggressive caching
  });
}
```

#### Admin components

**`PublishResultsDialog.tsx`**:

```tsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { usePublishInitiate } from "@/hooks/olympiad/usePublishInitiate";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
  onSuccess?: () => void;
};

export function PublishResultsDialog({ open, onOpenChange, olySchoolId, schoolName, onSuccess }: Props) {
  const initiate = usePublishInitiate();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === "PUBLISH";

  const onConfirm = async () => {
    try {
      await initiate.mutateAsync({ oly_school_id: olySchoolId });
      setTyped("");
      onOpenChange(false);
      onSuccess?.();
    } catch { /* toastError */ }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish results & close exam?</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to publish results for <strong>{schoolName}</strong>. This action is permanent and cannot be reversed.
            <br /><br />
            After publishing: no further attempts can be made by any student; results and certificates will be sent to all parents; you will not be able to conduct additional batches.
            <br /><br />
            Have you confirmed with all teachers that every batch is complete?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Type PUBLISH to confirm</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm || initiate.isPending} onClick={onConfirm}>
            {initiate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Yes, Publish & Close Exam
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**`PublishJobStatus.tsx`**:

```tsx
import { CheckCircle2, Clock, Loader2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { PublishJob } from "@/hooks/olympiad/useOlympiadPublishJob";

const STATUS_LABEL: Record<PublishJob["status"], string> = {
  queued: "Queued — starting soon",
  computing_ranks: "Computing ranks…",
  generating_pdfs: "Generating PDFs…",
  sending_emails: "Sending parent emails…",
  completed: "All done",
  failed: "Failed",
};

export function PublishJobStatus({ job }: { job: PublishJob }) {
  const pct = job.total_students > 0
    ? Math.round((job.processed_students / job.total_students) * 100)
    : 0;
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <div className="surface-card frosted-shadow rounded-card p-6 space-y-4">
      <header className="flex items-center gap-3">
        {isDone && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
        {isFailed && <AlertCircle className="h-6 w-6 text-red-500" />}
        {!isDone && !isFailed && <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />}
        <div>
          <p className="eyebrow">Publish status</p>
          <h2 className="text-lg font-bold text-ink-900">{STATUS_LABEL[job.status]}</h2>
        </div>
      </header>

      {!isDone && !isFailed && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-600">
            <span>{job.processed_students} / {job.total_students} students</span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
      )}

      {isDone && (
        <p className="text-sm text-ink-700">
          All {job.total_students} students processed. Parents have been notified by email.
        </p>
      )}

      {isFailed && job.error && (
        <p className="text-sm text-red-700">Error: {job.error}</p>
      )}

      {job.failed_students > 0 && !isFailed && (
        <p className="text-xs text-amber-700">
          {job.failed_students} student{job.failed_students === 1 ? "" : "s"} had errors during processing. Retry available.
        </p>
      )}
    </div>
  );
}
```

#### Publish status page

`src/pages/school/olympiad/OlympiadSchoolPublishStatusPage.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadPublishJob } from "@/hooks/olympiad/useOlympiadPublishJob";
import { PublishJobStatus } from "@/components/olympiad/school/PublishJobStatus";

export default function OlympiadSchoolPublishStatusPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: job, isLoading: jobLoading } = useOlympiadPublishJob(school?.id);

  if (schoolLoading || jobLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No active campaign.</p></PageShell>;
  }
  if (!job) {
    return (
      <PageShell>
        <NavLink to="/school/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </NavLink>
        <PageHeader title="Publish status" />
        <p className="py-6 text-sm text-ink-600">No publish job has been started for this school yet.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <NavLink to="/school/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Publish status" subtitle={school.institution_name} />
      <div className="py-4">
        <PublishJobStatus job={job} />
        {job.status === "completed" && (
          <div className="mt-4 flex justify-center">
            <NavLink to="/school/olympiad">
              <Button>Back to dashboard</Button>
            </NavLink>
          </div>
        )}
      </div>
    </PageShell>
  );
}
```

#### Dashboard edit (enable Publish button)

In `OlympiadSchoolDashboardPage.tsx`, when `school.status === "batches_scheduled"`:
- Replace the existing disabled "Publish Results" button with a live button
- Click → opens `PublishResultsDialog`
- On success → navigate to `/school/olympiad/publish-status`

#### Route + Verify + Commit

In App.tsx:
```tsx
const OlympiadSchoolPublishStatusPage = lazy(() => import("@/pages/school/olympiad/OlympiadSchoolPublishStatusPage"));

<Route path="/school/olympiad/publish-status" element={
  <ProtectedRoute allowedRoles={["school_admin","super_school_admin"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadSchoolPublishStatusPage />
    </Suspense>
  </ProtectedRoute>
} />
```

```bash
npx tsc --noEmit
npx eslint src/hooks/olympiad/ src/components/olympiad/school/ src/pages/school/olympiad/ src/App.tsx
npx vite build

git add src/hooks/olympiad/ src/components/olympiad/school/ src/pages/school/olympiad/ src/App.tsx
git commit -m "feat(olympiad): publish dialog + status polling + admin publish flow"
```

---

## Section D — Student post-publish UI

### Task 4: Result card + review page

**Files:**
- Create: `src/components/olympiad/student/PublishedResultCard.tsx`
- Create: `src/components/olympiad/student/ReviewQuestionItem.tsx`
- Create: `src/pages/student/olympiad/OlympiadStudentReviewPage.tsx`
- Modify: `src/pages/student/olympiad/OlympiadStudentDashboardPage.tsx`
- Modify: `src/App.tsx` (review route)

#### `PublishedResultCard.tsx`

```tsx
import { Trophy, Award, Medal, Star, Download, ArrowRight, Loader2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useOlympiadPublishedResultUrl } from "@/hooks/olympiad/useOlympiadPublishedResultUrl";
import type { PublishedResult } from "@/hooks/olympiad/useOlympiadPublishedResult";

type ResultData = Extract<PublishedResult, { ok: true }>;

const TIER_STYLE: Record<string, { label: string; icon: typeof Trophy; cls: string }> = {
  gold:          { label: "Gold",          icon: Trophy,  cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  silver:        { label: "Silver",        icon: Award,   cls: "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300" },
  bronze:        { label: "Bronze",        icon: Medal,   cls: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-300" },
  participation: { label: "Participation", icon: Star,    cls: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300" },
  absent:        { label: "Absent",        icon: Star,    cls: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300" },
};

export function PublishedResultCard({ result }: { result: ResultData }) {
  const getUrl = useOlympiadPublishedResultUrl();
  const [busy, setBusy] = useState<"result" | "certificate" | null>(null);
  const tier = TIER_STYLE[result.certificate_tier] ?? TIER_STYLE.participation;
  const Icon = tier.icon;

  const downloadPdf = async (kind: "result" | "certificate") => {
    setBusy(kind);
    try {
      const url = await getUrl.mutateAsync({ resultId: result.result_id, kind });
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(null);
    }
  };

  const isAbsent = result.certificate_tier === "absent";

  return (
    <div className="surface-card frosted-shadow rounded-card p-6 space-y-5">
      <header className="text-center space-y-2">
        <Icon className="h-12 w-12 mx-auto text-brand-primary" />
        <p className="eyebrow">Your result</p>
        <Badge className={`text-xs font-semibold ${tier.cls}`} variant="secondary">{tier.label}</Badge>
      </header>

      {!isAbsent ? (
        <>
          <div className="text-center">
            <p className="text-4xl font-bold text-ink-900">{Number(result.total_marks_obtained).toFixed(0)} / {Number(result.total_max_marks).toFixed(0)}</p>
            <p className="text-2xl font-semibold text-ink-700">{Number(result.percentage).toFixed(2)}%</p>
          </div>
          {result.school_rank && (
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-surface-card p-3 rounded-md">
                <p className="eyebrow">Class rank</p>
                <p className="text-lg font-bold text-ink-900 mt-1">{result.class_rank} <span className="text-sm font-normal text-ink-500">of {result.class_total}</span></p>
              </div>
              <div className="bg-surface-card p-3 rounded-md">
                <p className="eyebrow">School rank</p>
                <p className="text-lg font-bold text-ink-900 mt-1">{result.school_rank} <span className="text-sm font-normal text-ink-500">of {result.school_total}</span></p>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" className="flex-1" disabled={busy !== null || !result.result_pdf_path} onClick={() => downloadPdf("result")}>
              {busy === "result" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Download report
            </Button>
            <Button variant="outline" className="flex-1" disabled={busy !== null || !result.certificate_pdf_path} onClick={() => downloadPdf("certificate")}>
              {busy === "certificate" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Download certificate
            </Button>
          </div>

          <NavLink to="/student/olympiad/review">
            <Button variant="ghost" className="w-full">
              Review your answers
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </NavLink>
        </>
      ) : (
        <p className="text-sm text-ink-700 text-center">You did not attempt the exam. Contact your school if this is an error.</p>
      )}
    </div>
  );
}
```

#### `ReviewQuestionItem.tsx`

```tsx
import { Check, X } from "lucide-react";
import { MathText } from "@/components/ui/math-text";
import type { ReviewQuestion } from "@/hooks/olympiad/useOlympiadReviewQuestions";

const OPTIONS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

export function ReviewQuestionItem({ question }: { question: ReviewQuestion }) {
  const wasAttempted = question.selected_answer !== null;
  const wasCorrect = wasAttempted && question.selected_answer === question.correct_answer;
  const marksAwarded = wasCorrect ? question.marks : 0;

  return (
    <article className="surface-card frosted-shadow rounded-card p-5 space-y-3">
      <header className="flex items-center justify-between">
        <p className="eyebrow">Question {question.position}</p>
        <p className="text-xs font-mono text-ink-600">{marksAwarded} / {question.marks}</p>
      </header>

      <div><MathText text={question.question_text} /></div>

      <ul className="space-y-2">
        {OPTIONS.map((letter) => {
          const optionKey = `option_${letter.toLowerCase()}` as keyof ReviewQuestion;
          const isSelected = question.selected_answer === letter;
          const isCorrect = question.correct_answer === letter;
          const isWrongSelection = isSelected && !isCorrect;
          return (
            <li
              key={letter}
              className={`flex items-start gap-3 px-3 py-2 rounded-md border ${
                isCorrect
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10"
                  : isWrongSelection
                  ? "border-red-300 bg-red-50 dark:bg-red-500/10"
                  : "border-surface-stroke"
              }`}
            >
              <span className={`mt-0.5 ${isCorrect ? "text-emerald-600" : isWrongSelection ? "text-red-600" : "text-ink-500"}`}>
                {isCorrect ? <Check className="h-4 w-4" /> : isWrongSelection ? <X className="h-4 w-4" /> : <span className="w-4 inline-block" />}
              </span>
              <span className="font-medium mr-1">{letter}.</span>
              <span className="flex-1"><MathText text={question[optionKey] as string} /></span>
            </li>
          );
        })}
      </ul>

      {!wasAttempted && (
        <p className="text-xs text-amber-700">You did not attempt this question.</p>
      )}
    </article>
  );
}
```

#### `OlympiadStudentReviewPage.tsx`

```tsx
import { useState, useMemo } from "react";
import { NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadReviewQuestions } from "@/hooks/olympiad/useOlympiadReviewQuestions";
import { ReviewQuestionItem } from "@/components/olympiad/student/ReviewQuestionItem";

export default function OlympiadStudentReviewPage() {
  const { data: dashboardCtx } = useOlympiadStudentDashboard();
  const attemptId = dashboardCtx?.ok ? dashboardCtx.attempt?.id : undefined;
  const { data: questions, isLoading } = useOlympiadReviewQuestions(attemptId);
  const subjects = dashboardCtx?.ok ? dashboardCtx.subjects : [];
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(null);

  const filteredQuestions = useMemo(() => {
    if (!activeSubjectId) return questions ?? [];
    return (questions ?? []).filter((q) => q.subject_id === activeSubjectId);
  }, [questions, activeSubjectId]);

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!dashboardCtx?.ok || !attemptId) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No attempt to review.</p></PageShell>;
  }

  return (
    <PageShell>
      <NavLink to="/student/olympiad" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Review your answers" subtitle={`${filteredQuestions.length} questions`} />

      <nav className="flex gap-2 overflow-x-auto scrollbar-hide py-2" role="tablist">
        <button
          onClick={() => setActiveSubjectId(null)}
          className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium ${
            activeSubjectId === null ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700"
          }`}
        >
          All
        </button>
        {subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSubjectId(s.id)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium ${
              activeSubjectId === s.id ? "bg-brand-primary text-white" : "bg-surface-card text-ink-700"
            }`}
          >
            {s.name}
          </button>
        ))}
      </nav>

      <div className="space-y-4 py-4">
        {filteredQuestions.map((q) => <ReviewQuestionItem key={q.snapshot_id} question={q} />)}
      </div>
    </PageShell>
  );
}
```

#### Dashboard edit

In `OlympiadStudentDashboardPage.tsx`, ADD a new branch BEFORE the "exam submitted" branch:

```tsx
// At the top, alongside existing hooks:
const { data: publishedResult } = useOlympiadPublishedResult();

// In the JSX, change the post-submit branch to:
{publishedResult?.ok ? (
  <PublishedResultCard result={publishedResult} />
) : ctx.attempt && ctx.attempt.status !== "in_progress" ? (
  // existing "Awaiting results" card
) : (
  // existing batch + countdown + Start exam block
)}
```

#### Route + Verify + Commit

```tsx
// App.tsx:
const OlympiadStudentReviewPage = lazy(() => import("@/pages/student/olympiad/OlympiadStudentReviewPage"));

<Route path="/student/olympiad/review" element={
  <ProtectedRoute allowedRoles={["student"]}>
    <Suspense fallback={<p>Loading...</p>}>
      <OlympiadStudentReviewPage />
    </Suspense>
  </ProtectedRoute>
} />
```

```bash
npx tsc --noEmit
npx eslint src/components/olympiad/student/ src/pages/student/olympiad/ src/App.tsx
npx vite build
git add src/components/olympiad/student/PublishedResultCard.tsx src/components/olympiad/student/ReviewQuestionItem.tsx src/pages/student/olympiad/OlympiadStudentReviewPage.tsx src/pages/student/olympiad/OlympiadStudentDashboardPage.tsx src/App.tsx
git commit -m "feat(olympiad): student post-publish dashboard + review page"
```

---

## Section E — Verification

### Task 5: §5a sweep + concurrency checklist + final review

```bash
npx tsc --noEmit
npx eslint "src/{hooks,components,pages}/olympiad/**" "src/App.tsx" "src/components/layout/AppSidebar.tsx"
npx vite build
```
All exit 0.

**Concurrency self-check**:
- [ ] All new hooks have explicit `staleTime`
- [ ] `useOlympiadPublishJob` `refetchInterval: 5_000` has §23.2 justification comment
- [ ] All new FKs indexed (T1 migration)
- [ ] All new RPCs SECURITY DEFINER with auth.uid() check
- [ ] Publish RPC uses `FOR UPDATE` lock on school row
- [ ] Compute-ranks RPC uses `ON CONFLICT DO NOTHING` for idempotency
- [ ] All 4 edge functions check "already done?" before re-doing work
- [ ] No `select("*")` introduced
- [ ] No `auth.getUser()` calls

**Manual smoke** (controller/user):

1. As school admin with `status='batches_scheduled'`: dashboard → "Publish Results & Close Exam" button is now active
2. Click → dialog with confirmation copy → type PUBLISH → confirm
3. Toast "Publish initiated" → redirect to publish-status page
4. Status page shows progress: queued → computing_ranks → generating_pdfs → sending_emails → completed
5. As student: dashboard now shows result card with tier + score + ranks + download buttons
6. Click "Download report" → PDF opens in new tab
7. Click "Download certificate" → certificate PDF opens
8. Click "Review your answers" → review page with all questions + correct/incorrect marking
9. Dark mode + 375px viewport: confirm all flows render

Commit smoke fixes.

---

## Self-Review

- **Spec coverage**: every §1-§8 requirement maps to a task
- **Placeholders**: none
- **Type consistency**: `PublishJob`, `PublishedResult`, `ReviewQuestion` declared once in hook files and consumed by name
- **Production patterns**: async pipeline, idempotent re-runs, server-side ranks, batched PDF generation, signed-URL email links (no attachment bloat)

### Open notes for Phase 5b

- KaTeX→image rendering in result PDF (currently plain-text fallback)
- Per-question behavioral insights with smarter pacing analytics
- Failed-student retry UI in publish-status page
- Result detail page for school admin
