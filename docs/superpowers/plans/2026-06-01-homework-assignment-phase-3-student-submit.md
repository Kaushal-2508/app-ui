# Homework & Assignment — Phase 3 (Student Submit Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Students see their assigned homework (Pending / Completed), open an assignment, read instructions + download the teacher attachment, upload up to 10 files (≤10 MB each, allowed types only, validated client + server), and submit **once** (no edits after) with a confirmation dialog and a late-submission warning/flag. Completed cards show submission date + marks/feedback/"waiting" status.

**Architecture:** Client validates files (`validateFileUpload`) → uploads each directly to the private `homework-files` bucket via `uploadResumable` (TUS) at a deterministic per-student path → calls the `submit-homework` edge function with the uploaded paths. The edge fn (verify_jwt + service-role) re-validates (count, path-prefix ownership, assignment published+visible+student-in-class via `homework_visible_to_student`, object existence), computes `is_late`, and atomically records the submission + file rows (the `UNIQUE(assignment,student)` constraint enforces one-shot → 409 on re-submit; compensating delete on partial failure). Private reads: a student's own files use a direct `createSignedUrl` (they're the storage owner); the teacher attachment uses a `homework-file-url` edge fn (service-role signed URL after an access check, reused by teachers in Phase 4). The list relies on the Phase-1 `homework_visible_to_student` RLS — no client class-join.

**Tech Stack:** Deno edge functions (`supabase/functions/*`), React 18 + TS, TanStack Query v5, Supabase Storage. Verify: `npx tsc --noEmit` / `npx eslint <paths>` / `npx vite build`; edge fns deploy via `npx supabase functions deploy <name> --project-ref gyymkgohcijeksmrzuyw`.

**Branch:** `homework/phase-3-submit` (off `homework/phase-2-create @ 1598d7d`, verified). **Spec:** `docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md` §6.3.

---

## Compliance guardrails (every task)
- §19 errors → `toastError(err, { fallback, context })`; success → `toast.success`. §23.1 client auth → `useAuth()` (never `supabase.auth.getUser()` in client code; edge fns DO use `userClient.auth.getUser()` server-side, which is correct).
- §23.2 explicit `staleTime`. §20a/§20b primitives + shadcn-only form controls; `MobileSheet` (not Dialog) for the confirm; works at 375px; dark-mode flips. No `<AppLayout>`.
- No `any` / no suppressions. Edge fns: never log/return the service-role key; validate all input.

---

## File structure
**Create (frontend):**
- `src/lib/fileValidation.ts` — `validateFileUpload(file, cfg)` + `HOMEWORK_FILE_ALLOWED_MIMES`, `HOMEWORK_FILE_ACCEPT`, `HOMEWORK_MAX_FILE_BYTES`, `HOMEWORK_MAX_FILES`, blocked-extension check.
- `src/components/homework/SubmissionFileViewer.tsx` — shared: inline image preview (signed URL) + download link for non-images.
- `src/hooks/useStudentHomework.ts` — `useStudentHomework()` (list), `useStudentHomeworkDetail(id)`, `useStudentHomeworkResult(id)`, `useHomeworkFileUrl()` (calls homework-file-url), `useSubmitHomework()` (upload + invoke submit-homework).
- `src/pages/student/StudentHomeworkPage.tsx` — Pending/Completed.
- `src/pages/student/StudentHomeworkDetailPage.tsx` — view + upload + submit / post-submit read-only + result.

**Create (edge):**
- `supabase/functions/submit-homework/index.ts`
- `supabase/functions/homework-file-url/index.ts`

**Modify:**
- `supabase/config.toml` — `[functions.submit-homework] verify_jwt = true` + `[functions.homework-file-url] verify_jwt = true`.
- `src/App.tsx` — lazy imports + `/student/homework` + `/student/homework/:id` routes.
- `src/components/layout/AppSidebar.tsx` — student "Homework & Assignment" nav entry (`ClipboardList` already imported).

**Out of scope:** teacher marking detail (Phase 4 — but `homework-file-url` is built here and reused there); analytics (Phase 7); notifications (Phase 6).

---

## Task 1: Shared file-validation helper + homework file constants

**Files:** Create `src/lib/fileValidation.ts`

- [ ] **Step 1: Write the helper** (allowlist MUST match the Phase-1 bucket `allowed_mime_types`)

```ts
/** Allowed MIME types — MUST match the homework-files bucket allowlist
 * (migration 20260601090100). 17 entries. */
export const HOMEWORK_FILE_ALLOWED_MIMES: readonly string[] = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/rtf", "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

/** `accept` attribute for the file input. */
export const HOMEWORK_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.rtf,.odt,.ods,.odp";

export const HOMEWORK_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket
export const HOMEWORK_MAX_FILES = 10;

/** Extensions explicitly blocked even if a browser reports an empty/mismatched MIME. */
const BLOCKED_EXT = /\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a|aac|ogg|flac|zip|rar|7z|tar|gz|exe|msi|dmg|app|sh|bat)$/i;

export interface FileValidationConfig {
  allowedMimes: readonly string[];
  maxBytes: number;
}

/** Returns null if valid, else a human-friendly error message. */
export function validateFileUpload(file: File, cfg: FileValidationConfig): string | null {
  if (BLOCKED_EXT.test(file.name)) {
    return `"${file.name}" is a blocked type (video, audio, archive, or executable).`;
  }
  if (file.type && !cfg.allowedMimes.includes(file.type)) {
    return `"${file.name}" isn't an allowed type. Use images, PDF, Word, PowerPoint, Excel, or text files.`;
  }
  if (file.size > cfg.maxBytes) {
    return `"${file.name}" is larger than ${Math.round(cfg.maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}
```

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/lib/fileValidation.ts
git add src/lib/fileValidation.ts
git commit -F - <<'EOF'
feat(homework): shared file-validation helper + homework file constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: `submit-homework` edge function

**Files:** Create `supabase/functions/submit-homework/index.ts`; modify `supabase/config.toml`

- [ ] **Step 1: Write the function**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "homework-files";
const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  "image/jpeg","image/png","image/gif","image/webp","application/pdf",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain","application/rtf","text/rtf",
  "application/vnd.oasis.opendocument.text","application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
]);

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface SubmitFile { path: string; name: string; mime: string; size: number }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Missing Authorization header" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse(500, { error: "Supabase env vars missing" });

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult?.user) return jsonResponse(401, { error: "Unauthenticated" });
    const studentId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const homeworkId = body?.homework_assignment_id as string | undefined;
    const files = (body?.files as SubmitFile[] | undefined) ?? [];
    if (!homeworkId) return jsonResponse(400, { error: "homework_assignment_id is required" });
    if (!Array.isArray(files) || files.length === 0) return jsonResponse(400, { error: "Attach at least one file." });
    if (files.length > MAX_FILES) return jsonResponse(400, { error: `You can attach at most ${MAX_FILES} files.` });
    for (const f of files) {
      if (!f?.path || !f?.name || !f?.mime || typeof f.size !== "number") return jsonResponse(400, { error: "Malformed file entry." });
      if (f.size > MAX_FILE_BYTES) return jsonResponse(413, { error: `"${f.name}" exceeds 10 MB.` });
      if (!ALLOWED_MIMES.has(f.mime)) return jsonResponse(400, { error: `"${f.name}" is not an allowed type.` });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Assignment must exist, be published (open), and currently visible to THIS student.
    const { data: hw, error: hwErr } = await admin
      .from("homework_assignments")
      .select("id, institution_id, status, due_at, visible_from")
      .eq("id", homeworkId).maybeSingle();
    if (hwErr) return jsonResponse(500, { error: hwErr.message });
    if (!hw) return jsonResponse(404, { error: "Assignment not found." });
    if (hw.status !== "published") return jsonResponse(410, { error: "This assignment is closed for submissions." });

    const { data: visible, error: visErr } = await admin.rpc("homework_visible_to_student", { _user_id: studentId, _homework_id: homeworkId });
    if (visErr) return jsonResponse(500, { error: visErr.message });
    if (!visible) return jsonResponse(403, { error: "This assignment isn't available to you." });

    // Every file path must live under THIS student's submission folder for THIS assignment.
    const prefix = `${hw.institution_id}/submissions/${homeworkId}/${studentId}/`;
    for (const f of files) {
      if (!f.path.startsWith(prefix)) return jsonResponse(403, { error: "Invalid file path." });
    }
    // Confirm the objects actually exist in storage.
    const { data: listed, error: listErr } = await admin.storage.from(BUCKET).list(prefix.slice(0, -1));
    if (listErr) return jsonResponse(500, { error: `Storage check failed: ${listErr.message}` });
    const present = new Set((listed ?? []).map((o) => `${prefix}${o.name}`));
    for (const f of files) {
      if (!present.has(f.path)) return jsonResponse(400, { error: `Upload incomplete for "${f.name}". Please retry.` });
    }

    const isLate = new Date() > new Date(hw.due_at);

    // Insert the submission (UNIQUE(assignment,student) → one-shot).
    const { data: sub, error: subErr } = await admin
      .from("homework_submissions")
      .insert({ homework_assignment_id: homeworkId, student_id: studentId, is_late: isLate })
      .select("id").single();
    if (subErr) {
      if ((subErr as { code?: string }).code === "23505") return jsonResponse(409, { error: "You've already submitted this assignment." });
      return jsonResponse(500, { error: subErr.message });
    }

    const fileRows = files.map((f) => ({
      submission_id: sub.id, storage_path: f.path, file_name: f.name, file_mime: f.mime, file_size_bytes: f.size,
    }));
    const { error: filesErr } = await admin.from("homework_submission_files").insert(fileRows);
    if (filesErr) {
      // Compensating cleanup so we never leave a submission with no files.
      await admin.from("homework_submissions").delete().eq("id", sub.id);
      return jsonResponse(500, { error: filesErr.message });
    }

    return jsonResponse(200, { submission_id: sub.id, is_late: isLate, file_count: files.length });
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
```

- [ ] **Step 2: Register in `supabase/config.toml`** — add (alongside the other `[functions.*]` entries):
```toml
[functions.submit-homework]
verify_jwt = true
```

- [ ] **Step 3: Commit** (deploy happens in Task 9 after review)
```bash
git add supabase/functions/submit-homework/index.ts supabase/config.toml
git commit -F - <<'EOF'
feat(homework): submit-homework edge function (auth, validate, atomic record)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `homework-file-url` edge function (signed URLs for cross-user reads)

**Files:** Create `supabase/functions/homework-file-url/index.ts`; modify `supabase/config.toml`

Accepts EITHER `{ homework_assignment_id }` (teacher attachment) OR `{ submission_file_id }` (a submission file). Verifies the caller may read it, then returns a service-role signed URL (5-min TTL).

- [ ] **Step 1: Write the function**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const BUCKET = "homework-files";
const TTL = 300;
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Missing Authorization header" });
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return jsonResponse(500, { error: "Supabase env vars missing" });

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userResult, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResult?.user) return jsonResponse(401, { error: "Unauthenticated" });
    const uid = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceKey);

    let path: string | null = null;

    if (body?.homework_assignment_id) {
      const hwId = body.homework_assignment_id as string;
      const { data: hw } = await admin.from("homework_assignments").select("attachment_path").eq("id", hwId).maybeSingle();
      if (!hw?.attachment_path) return jsonResponse(404, { error: "No attachment." });
      const { data: canManage } = await admin.rpc("can_manage_homework", { _user_id: uid, _homework_id: hwId });
      const { data: visible } = await admin.rpc("homework_visible_to_student", { _user_id: uid, _homework_id: hwId });
      if (!canManage && !visible) return jsonResponse(403, { error: "Not allowed." });
      path = hw.attachment_path;
    } else if (body?.submission_file_id) {
      const fileId = body.submission_file_id as string;
      const { data: row } = await admin
        .from("homework_submission_files")
        .select("storage_path, submission:submission_id ( student_id, homework_assignment_id )")
        .eq("id", fileId).maybeSingle();
      const sub = Array.isArray(row?.submission) ? row?.submission[0] : row?.submission;
      if (!row || !sub) return jsonResponse(404, { error: "File not found." });
      const isOwner = sub.student_id === uid;
      const { data: canManage } = await admin.rpc("can_manage_homework", { _user_id: uid, _homework_id: sub.homework_assignment_id });
      if (!isOwner && !canManage) return jsonResponse(403, { error: "Not allowed." });
      path = row.storage_path;
    } else {
      return jsonResponse(400, { error: "Provide homework_assignment_id or submission_file_id." });
    }

    const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL);
    if (signErr || !signed?.signedUrl) return jsonResponse(500, { error: signErr?.message ?? "Could not sign URL." });
    return jsonResponse(200, { url: signed.signedUrl });
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
```

- [ ] **Step 2: Register in `supabase/config.toml`**
```toml
[functions.homework-file-url]
verify_jwt = true
```

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/homework-file-url/index.ts supabase/config.toml
git commit -F - <<'EOF'
feat(homework): homework-file-url edge function (access-checked signed URLs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Student data + submit hooks

**Files:** Create `src/hooks/useStudentHomework.ts`

- [ ] **Step 1: Write the hooks**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { uploadResumable } from "@/lib/storageUpload";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

const BUCKET = "homework-files";
const SELECT = `
  id, title, description, status, carries_marks, max_marks, due_at, visible_from,
  attachment_path, attachment_name, attachment_mime, checked_at,
  subject:subject_id ( id, name ),
  homework_assignment_classes ( classes ( id, name, section ) )
` as const;

function pickOne<T>(v: T | T[] | null): T | null { return Array.isArray(v) ? (v[0] ?? null) : v; }

export interface StudentHomeworkRow {
  id: string; title: string; description: string | null; status: "published" | "checked";
  carries_marks: boolean; max_marks: number | null; due_at: string; visible_from: string;
  attachment_path: string | null; attachment_name: string | null; attachment_mime: string | null;
  checked_at: string | null;
  subject: { id: string; name: string } | null;
  classes: { id: string; name: string; section: string | null }[];
  submission: { id: string; submitted_at: string; is_late: boolean } | null;
  result: { marks_awarded: number | null; feedback: string | null; status: string } | null;
}

/** Pending + Completed list, RLS-scoped to the student's classes by homework_visible_to_student. */
export function useStudentHomework() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["student-homework", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentHomeworkRow[]> => {
      const nowIso = new Date().toISOString();
      // RLS (homework_visible_to_student) returns only this student's visible assignments.
      const { data, error } = await supabase
        .from("homework_assignments").select(SELECT)
        .in("status", ["published", "checked"]).lte("visible_from", nowIso)
        .order("due_at", { ascending: true }).range(0, 199);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const ids = rows.map((r) => r.id as string);
      // The student's own submissions + results (RLS lets them read their own; results only when checked).
      const [{ data: subs }, { data: results }] = await Promise.all([
        supabase.from("homework_submissions").select("id, homework_assignment_id, submitted_at, is_late").in("homework_assignment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("student_id", user!.id),
        supabase.from("homework_results").select("homework_assignment_id, marks_awarded, feedback, status").in("homework_assignment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("student_id", user!.id),
      ]);
      const subByHw = new Map((subs ?? []).map((s) => [s.homework_assignment_id, s]));
      const resByHw = new Map((results ?? []).map((r) => [r.homework_assignment_id, r]));
      return rows.map((r) => {
        const subject = pickOne(r.subject as never) as { id: string; name: string } | null;
        const classes = ((r.homework_assignment_classes as Array<{ classes: unknown }> | null) ?? [])
          .map((j) => pickOne(j.classes as never) as { id: string; name: string; section: string | null } | null)
          .filter((c): c is { id: string; name: string; section: string | null } => !!c);
        const s = subByHw.get(r.id as string);
        const res = resByHw.get(r.id as string);
        return {
          id: r.id as string, title: r.title as string, description: (r.description as string) ?? null,
          status: r.status as "published" | "checked", carries_marks: r.carries_marks as boolean,
          max_marks: (r.max_marks as number) ?? null, due_at: r.due_at as string, visible_from: r.visible_from as string,
          attachment_path: (r.attachment_path as string) ?? null, attachment_name: (r.attachment_name as string) ?? null,
          attachment_mime: (r.attachment_mime as string) ?? null, checked_at: (r.checked_at as string) ?? null,
          subject, classes,
          submission: s ? { id: s.id, submitted_at: s.submitted_at, is_late: s.is_late } : null,
          result: res ? { marks_awarded: res.marks_awarded, feedback: res.feedback, status: res.status } : null,
        };
      });
    },
  });
}

/** A single assignment for the student detail page (reuses the list shape). */
export function useStudentHomeworkDetail(homeworkId: string | undefined) {
  const list = useStudentHomework();
  const row = list.data?.find((r) => r.id === homeworkId) ?? null;
  return { row, isLoading: list.isLoading, error: list.error };
}

/** Signed URL via the homework-file-url edge fn (teacher attachment or any submission file). */
export function useHomeworkFileUrl() {
  return useMutation({
    mutationFn: async (arg: { homework_assignment_id: string } | { submission_file_id: string }): Promise<string> => {
      const res = await invokeEdgeFunction<{ url: string }>("homework-file-url", arg);
      return res.url;
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't open the file.", context: "homeworkFileUrl" }),
  });
}

/** Upload files to the private bucket then record the submission via submit-homework. */
export function useSubmitHomework() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ homeworkId, institutionId, files }: { homeworkId: string; institutionId: string; files: File[] }) => {
      if (!user?.id) throw new Error("Not authenticated");
      if (files.length === 0) throw new Error("Attach at least one file.");
      if (files.length > 10) throw new Error("You can attach at most 10 files.");
      const uploaded: { path: string; name: string; mime: string; size: number }[] = [];
      for (const file of files) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${institutionId}/submissions/${homeworkId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
        await uploadResumable({ bucket: BUCKET, path, file, contentType: file.type || "application/octet-stream" });
        uploaded.push({ path, name: file.name, mime: file.type || "application/octet-stream", size: file.size });
      }
      return invokeEdgeFunction<{ submission_id: string; is_late: boolean; file_count: number }>(
        "submit-homework", { homework_assignment_id: homeworkId, files: uploaded });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["student-homework"] });
      toast.success(res.is_late ? "Submitted (marked late)" : "Submitted");
    },
    onError: (err: Error) => toastError(err, { fallback: "Couldn't submit your work.", context: "submitHomework" }),
  });
}
```

> **Implementer notes:** confirm `useAuth` exposes `{ user }` with `user.id` (it does — used across the codebase). The `as unknown as` bridges on the joined rows are acceptable (PostgREST nested join typing); prefer a small inline `RawRow` type as in Phase 2's `useHomeworkData.ts` if it reads cleaner — **no `any`**. `institutionId` for the upload path: read it from the detail row? The row doesn't include institution_id; get it from `useEffectiveInstitution()` (the student's own institution) in the page and pass it in. (The edge fn re-derives the real institution from the assignment and enforces the path prefix, so a wrong institutionId just fails the prefix check — safe.)

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/hooks/useStudentHomework.ts
git add src/hooks/useStudentHomework.ts
git commit -F - <<'EOF'
feat(homework): student homework data + submit hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: `SubmissionFileViewer` shared component

**Files:** Create `src/components/homework/SubmissionFileViewer.tsx`

- [ ] **Step 1: Build it** — a list of files; for image MIME types, render an inline thumbnail (lazy signed URL); for others, a download row (icon + name + "Download"). It does NOT fetch signed URLs itself for arbitrary files — accept a `getUrl(file) => Promise<string>` resolver so the same component works for the student's own files (direct `createSignedUrl`) and teacher-viewed files (edge fn) in Phase 4.

Props:
```ts
export interface SubmissionFileMeta { id: string; name: string; mime: string; storagePath: string; }
export interface SubmissionFileViewerProps {
  files: SubmissionFileMeta[];
  /** Resolve a (short-lived) URL for a file. */
  getUrl: (file: SubmissionFileMeta) => Promise<string>;
  className?: string;
}
```
Behavior: render each file as a `ListRow`-style card; image MIMEs (`mime.startsWith("image/")`) get a small thumbnail that lazy-loads its URL via `getUrl` in a `useEffect` (with cancellation cleanup like `HybridWaitingForUpload`'s `PageThumbnail`); non-images show a file icon + name + a "Download" button that calls `getUrl` on click and opens the URL in a new tab. Use §20a tokens (`surface-card`, `text-ink-*`), shadcn `Button`. No `any`.

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/components/homework/SubmissionFileViewer.tsx && npx vite build
git add src/components/homework/SubmissionFileViewer.tsx
git commit -F - <<'EOF'
feat(homework): shared SubmissionFileViewer (image preview + download)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: `StudentHomeworkPage` (Pending / Completed)

**Files:** Create `src/pages/student/StudentHomeworkPage.tsx`

- [ ] **Step 1: Build it** (mirror `src/pages/student/StudentExamsPage.tsx`)

- `<PageShell>` + `<PageHeader icon={<ClipboardList/>} title="Homework & Assignment" subtitle="Your assigned work" />`.
- `const { data: rows = [], isLoading } = useStudentHomework();`
- Split: **Pending** = `!r.submission` (not yet submitted; show all visible unsubmitted, regardless of due — late still submittable), sorted by `due_at` asc, with a countdown ("Due in 2d" / "Overdue — late if submitted"). **Completed** = `r.submission != null`, sorted by `submitted_at` desc.
- `StatTileGrid`: Pending count, Completed count, Due-soon count (due within 48h, unsubmitted).
- Tabs via `MobileTabs` (Pending / Completed) OR two stacked sections — match StudentExamsPage's approach (it uses filtered sections). Use `MobileTabs` for consistency with the teacher page.
- Each card → `ListRow` (or a Card): title + subject + teacher? (subject·class) subtitle; Pending shows countdown + "Open" → `/student/homework/:id`; Completed shows submitted date + a status pill:
  - carries_marks && status==='checked' && result → `{marks_awarded}/{max_marks}`.
  - !carries_marks && status==='checked' && result → "Feedback received".
  - else → "Waiting for teacher to mark".
  - if `submission.is_late` → a "Submitted late" badge.
- `EmptyState` per tab; loading skeletons.

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/pages/student/StudentHomeworkPage.tsx && npx vite build
git add src/pages/student/StudentHomeworkPage.tsx
git commit -F - <<'EOF'
feat(homework): student Pending/Completed homework page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: `StudentHomeworkDetailPage` (view + upload + submit / result)

**Files:** Create `src/pages/student/StudentHomeworkDetailPage.tsx`

- [ ] **Step 1: Build it**

- Route param `:id`. `const { row, isLoading } = useStudentHomeworkDetail(id)`. If not found/!visible → `EmptyState` ("Not available").
- `<PageShell>` + `<PageHeader title={row.title} subtitle={subject·class} />`.
- Header block: description/instructions (render plainly), due date + countdown, marks info (carries_marks → "Carries {max_marks} marks"; else "Review only — feedback").
- **Teacher attachment** (if `row.attachment_path`): a "Download attachment" button → `useHomeworkFileUrl().mutateAsync({ homework_assignment_id: row.id })` → open URL in new tab.
- **If NOT submitted** (`!row.submission`) AND `row.status === 'published'`:
  - Upload area: a file input (`accept={HOMEWORK_FILE_ACCEPT}`, multiple). On select, run `validateFileUpload` per file against `{ allowedMimes: HOMEWORK_FILE_ALLOWED_MIMES, maxBytes: HOMEWORK_MAX_FILE_BYTES }`; reject invalid with an inline message; enforce ≤10 total. Show the chosen files as removable chips.
  - A **late warning** banner when `new Date() > new Date(row.due_at)`: "This submission will be marked as late."
  - **Submit** button → opens a `MobileSheet` confirm ("Once you submit, you cannot make changes. Are you sure?") with primaryAction "Submit" → `useSubmitHomework().mutate({ homeworkId: row.id, institutionId, files })` (institutionId from `useEffectiveInstitution()`); show progress while pending. On success the list invalidates and the page now shows the submitted state.
- **If submitted** (`row.submission`):
  - Read-only: "Submitted on {date}" (+ "late" badge if `is_late`). Render the student's own files via `SubmissionFileViewer` with a `getUrl` that does a **direct** `supabase.storage.from("homework-files").createSignedUrl(file.storagePath, 300)` (the student owns these objects). Fetch the file list via `supabase.from("homework_submission_files").select("id, file_name, file_mime, storage_path").eq("submission_id", row.submission.id)`.
  - **Result**: if `row.status === 'checked'` and `row.result`: show marks (`{marks_awarded}/{max_marks}`) + feedback text (carries_marks), or just feedback ("Feedback received") for review-only. Else "Waiting for teacher to mark."
  - NO edit/re-upload affordance (one-shot).
- Set `data-dirty="true"` on the upload form while files are staged (SW contract).

- [ ] **Step 2: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/pages/student/StudentHomeworkDetailPage.tsx && npx vite build
git add src/pages/student/StudentHomeworkDetailPage.tsx
git commit -F - <<'EOF'
feat(homework): student homework detail — view, one-shot upload+submit, result

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: Routes + student sidebar entry

**Files:** Modify `src/App.tsx`, `src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Routes (`src/App.tsx`)** — lazy imports + routes after the `/student/study-materials` route (~line 350):
```tsx
const StudentHomeworkPage = lazy(() => import("./pages/student/StudentHomeworkPage"));
const StudentHomeworkDetailPage = lazy(() => import("./pages/student/StudentHomeworkDetailPage"));
```
```tsx
<Route path="/student/homework" element={
  <ProtectedRoute allowedRoles={["student"]}><StudentHomeworkPage /></ProtectedRoute>
} />
<Route path="/student/homework/:id" element={
  <ProtectedRoute allowedRoles={["student"]}><StudentHomeworkDetailPage /></ProtectedRoute>
} />
```
(Wrap each in `<Suspense fallback={<p>Loading...</p>}>` to match the file's lazy-route idiom. `/student/homework` is already in `FEATURE_URL_MAP` → `homework`.)

- [ ] **Step 2: Sidebar (`src/components/layout/AppSidebar.tsx`)** — in the student `"Exams"` group (after "Recheck Requests"), add:
```tsx
{ title: "Homework & Assignment", url: "/student/homework", icon: ClipboardList },
```
(`ClipboardList` is already imported.) Consider a new `"Assignments"` group if cleaner — but adding to the existing Exams group is fine and minimal.

- [ ] **Step 3: Verify + commit**
```bash
npx tsc --noEmit && npx eslint src/App.tsx src/components/layout/AppSidebar.tsx && npx vite build
git add src/App.tsx src/components/layout/AppSidebar.tsx
git commit -F - <<'EOF'
feat(homework): student routes + sidebar entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Deploy edge functions + phase verification

- [ ] **Step 1: Deploy both edge functions to prod** (authorized mechanism)
```bash
npx supabase functions deploy submit-homework --project-ref gyymkgohcijeksmrzuyw
npx supabase functions deploy homework-file-url --project-ref gyymkgohcijeksmrzuyw
```
Expected: both deploy successfully. (config.toml `verify_jwt = true` is applied on deploy.)

- [ ] **Step 2: Full verification (§5a)**
```bash
npx tsc --noEmit          # 0
npx eslint src/lib/fileValidation.ts src/hooks/useStudentHomework.ts src/components/homework/SubmissionFileViewer.tsx src/pages/student/StudentHomeworkPage.tsx src/pages/student/StudentHomeworkDetailPage.tsx src/App.tsx src/components/layout/AppSidebar.tsx   # 0
npx vite build            # 0
```

- [ ] **Step 3: Manual smoke (user/device step)** — log in as a student in an assigned class: `/student/homework` lists the published assignment in Pending with a countdown; open it; download the teacher attachment; pick 3 PDFs; confirm dialog; submit → moves to Completed, no edit affordance; re-submitting is impossible (UNIQUE → 409 surfaced). Submit after due → "marked late" warning + late badge. At 375px + dark mode: clean.

---

## Self-review (before handoff)
**Spec §6.3 coverage:** Pending/Completed list → Task 6; view+instructions+attachment download → Task 7 (+ homework-file-url Task 3); upload ≤10 files/≤10 MB/allowed-types client+server → Tasks 1/2/7; confirm dialog → Task 7 (MobileSheet); one-shot (no edits) → UNIQUE + edge 409 + no edit UI; late accepted + warning + flag → edge `is_late` + Task 7 banner + Task 6 badge; marks/feedback/waiting on Completed → Tasks 6/7. Own-submission-only → RLS + edge access checks.
**Deferred (not gaps):** teacher marking (Phase 4, reuses homework-file-url + SubmissionFileViewer), notifications (6), analytics (7).
**Placeholder scan:** edge fns + hooks + helper have full code; the 2 pages + viewer are detailed specs with exact imports/props/data-flow + named reference (`StudentExamsPage`, `HybridWaitingForUpload` thumbnail) — acceptable under subagent execution + review.
**Type consistency:** `StudentHomeworkRow`, `SubmissionFileMeta`, the edge `{ submission_id, is_late, file_count }` + `{ url }` contracts match between hooks and callers. RPC names `homework_visible_to_student` / `can_manage_homework` exist (Phase 1).
**Security:** edge fns verify JWT, derive student from token (not client), enforce path-prefix ownership + published+visible, never expose service key; one-shot via UNIQUE; compensating delete on partial failure.
