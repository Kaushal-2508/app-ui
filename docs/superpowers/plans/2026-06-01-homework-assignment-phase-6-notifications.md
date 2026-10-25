# Homework & Assignment — Phase 6 (Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Three time-based notification events, delivered as **web push + in-app `notifications` rows**:
1. **visible** — when an assignment's `visible_from` is reached → every student in its classes: *"New assignment: {title} ({subject}). Due {date}."*
2. **due_reminder_24h** — 24h before `due_at`, only for students who **haven't submitted** → *"Reminder: {title} is due tomorrow."*
3. **closed_teacher** — when `due_at` passes → the assignment **creator**: *"Assignment '{title}' has closed. {N} submissions ready to mark."*

No per-submission notifications, no digests — exactly these three (per brief §7).

**Architecture:** A new `homework-notify-pass` edge function (invoked by pg_cron every 15 min) scans `homework_assignments` for the three events (all `timestamptz`, plain `now()` comparisons — **no TZ conversion**, unlike attendance's bare TIME columns), resolves recipients (students via `class_assignments role='student'`; creator via `created_by`), and for each recipient **not already notified** (idempotency via `homework_notifications_sent` UNIQUE) writes an in-app `notifications` row **and** fires `send-web-push`. Idempotency makes the pass safe to re-run; lookback bounds keep each scan small (and prevent a notification storm for old assignments on first deploy). The cron authenticates with the public anon JWT (the proven `send-task-notifications` pattern — no new secret coordination); the function reads `WEBHOOK_SECRET` (already in prod) only to authorize the edge→edge `send-web-push` call.

**Tech Stack:** Deno edge function + pg_cron migration. No frontend changes (the existing `useNotifications` bell + service-worker push handle delivery). Deploy: `npx supabase functions deploy homework-notify-pass --project-ref gyymkgohcijeksmrzuyw`; cron migration via `db push`.

**Branch:** `homework/phase-6-notify` (off `homework/phase-4-marking @ fba225f`, verified). **Spec:** §7.

---

## File structure
**Create:** `supabase/functions/homework-notify-pass/index.ts`; `supabase/migrations/20260601095000_homework_notify_cron.sql`.
**Modify:** `supabase/config.toml` (`[functions.homework-notify-pass] verify_jwt = true`).
**Reuse (unchanged):** `send-web-push`, `homework_notifications_sent` (Phase 1), `notifications` table, `push_subscriptions`.

---

## Task 1: `homework-notify-pass` edge function

**Files:** Create `supabase/functions/homework-notify-pass/index.ts`; modify `supabase/config.toml`.

- [ ] **Step 1: Write the function**

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type NotifType = "visible" | "due_reminder_24h" | "closed_teacher";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
    if (!supabaseUrl || !serviceKey) return jsonResponse(500, { error: "Supabase env vars missing" });
    const admin = createClient(supabaseUrl, serviceKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let inApp = 0;
    let pushed = 0;

    // Record idempotency rows for the genuinely-new recipients, write in-app
    // notifications, and fire web-push. Returns the count newly notified.
    async function fanout(
      homeworkId: string,
      recipientIds: string[],
      type: NotifType,
      notif: { type: string; title: string; message: string; link: string },
    ): Promise<void> {
      const unique = [...new Set(recipientIds)];
      if (unique.length === 0) return;
      // Which of these were already notified for this (assignment, type)?
      const { data: existing, error: exErr } = await admin
        .from("homework_notifications_sent")
        .select("recipient_id")
        .eq("homework_assignment_id", homeworkId)
        .eq("notification_type", type)
        .in("recipient_id", unique);
      if (exErr) { console.error("sent lookup", exErr.message); return; }
      const already = new Set((existing ?? []).map((r) => r.recipient_id as string));
      const fresh = unique.filter((id) => !already.has(id));
      if (fresh.length === 0) return;

      // Claim them (UNIQUE guards against a concurrent pass; ignore conflicts).
      const { data: claimed, error: claimErr } = await admin
        .from("homework_notifications_sent")
        .upsert(
          fresh.map((rid) => ({ homework_assignment_id: homeworkId, recipient_id: rid, notification_type: type })),
          { onConflict: "homework_assignment_id,recipient_id,notification_type", ignoreDuplicates: true },
        )
        .select("recipient_id");
      if (claimErr) { console.error("sent claim", claimErr.message); return; }
      const toNotify = (claimed ?? []).map((r) => r.recipient_id as string);
      if (toNotify.length === 0) return;

      const { error: notifErr } = await admin.from("notifications").insert(
        toNotify.map((rid) => ({
          user_id: rid, type: notif.type, title: notif.title, message: notif.message,
          link: notif.link, metadata: { homework_assignment_id: homeworkId },
        })),
      );
      if (!notifErr) inApp += toNotify.length;

      if (webhookSecret) {
        for (const rid of toNotify) {
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/send-web-push`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookSecret}` },
              body: JSON.stringify({ user_id: rid, message_payload: { title: notif.title, body: notif.message, data: { url: notif.link } } }),
            });
            if (res.ok) pushed += 1;
          } catch (_e) { /* best-effort push; in-app row already written */ }
        }
      }
    }

    // Resolve the student user_ids for an assignment's classes.
    async function studentsFor(homeworkId: string): Promise<string[]> {
      const { data: cls } = await admin.from("homework_assignment_classes").select("class_id").eq("homework_assignment_id", homeworkId);
      const classIds = (cls ?? []).map((c) => c.class_id as string);
      if (classIds.length === 0) return [];
      const { data: studs } = await admin.from("class_assignments").select("user_id").in("class_id", classIds).eq("role", "student");
      return [...new Set((studs ?? []).map((s) => s.user_id as string))];
    }

    const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

    // ── Event 1: visible (published + visible_from reached, recent window) ──
    {
      const lookback = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await admin
        .from("homework_assignments")
        .select("id, title, due_at, visible_from, subject:subject_id ( name )")
        .eq("status", "published")
        .lte("visible_from", nowIso)
        .gte("visible_from", lookback);
      for (const r of rows ?? []) {
        const subj = Array.isArray(r.subject) ? r.subject[0]?.name : (r.subject as { name?: string } | null)?.name;
        const students = await studentsFor(r.id as string);
        await fanout(r.id as string, students, "visible", {
          type: "homework_visible",
          title: "New assignment",
          message: `New assignment: ${r.title}${subj ? ` (${subj})` : ""}. Due ${fmtDate(r.due_at as string)}.`,
          link: "/student/homework",
        });
      }
    }

    // ── Event 2: due_reminder_24h (within 24h, unsubmitted students) ──
    {
      const in24 = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await admin
        .from("homework_assignments")
        .select("id, title, due_at")
        .eq("status", "published")
        .gt("due_at", nowIso)
        .lte("due_at", in24);
      for (const r of rows ?? []) {
        const students = await studentsFor(r.id as string);
        if (students.length === 0) continue;
        const { data: subs } = await admin.from("homework_submissions").select("student_id").eq("homework_assignment_id", r.id);
        const submitted = new Set((subs ?? []).map((s) => s.student_id as string));
        const unsubmitted = students.filter((id) => !submitted.has(id));
        await fanout(r.id as string, unsubmitted, "due_reminder_24h", {
          type: "homework_due_24h",
          title: "Homework due tomorrow",
          message: `Reminder: ${r.title} is due tomorrow.`,
          link: "/student/homework",
        });
      }
    }

    // ── Event 3: closed_teacher (due passed, recent window → notify creator) ──
    {
      const lookback = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await admin
        .from("homework_assignments")
        .select("id, title, created_by")
        .eq("status", "published")
        .lte("due_at", nowIso)
        .gte("due_at", lookback);
      for (const r of rows ?? []) {
        if (!r.created_by) continue;
        const { count } = await admin
          .from("homework_submissions")
          .select("id", { count: "exact", head: true })
          .eq("homework_assignment_id", r.id);
        await fanout(r.id as string, [r.created_by as string], "closed_teacher", {
          type: "homework_closed",
          title: "Assignment closed",
          message: `Assignment "${r.title}" has closed. ${count ?? 0} submission(s) ready to mark.`,
          link: `/homework/${r.id}`,
        });
      }
    }

    return jsonResponse(200, { ok: true, in_app: inApp, pushed });
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Unexpected error" });
  }
});
```

- [ ] **Step 2: `supabase/config.toml`** — add:
```toml
[functions.homework-notify-pass]
verify_jwt = true
```
(The cron sends the public anon JWT, which satisfies `verify_jwt = true` at the gateway; the function does its work with the service-role key and is idempotent, so this gateway-level gate is sufficient — matching `send-task-notifications`.)

- [ ] **Step 3: Commit** (deploy in Task 3).
```bash
git add supabase/functions/homework-notify-pass/index.ts supabase/config.toml
git commit -F - <<'EOF'
feat(homework): homework-notify-pass edge fn (3 events, in-app + web-push, idempotent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: pg_cron schedule (migration)

**Files:** Create `supabase/migrations/20260601095000_homework_notify_cron.sql`

- [ ] **Step 1: Write the migration** (verbatim cron idiom from `send-task-notifications`; the anon JWT below is the project's public anon key — same token already in `20260223114546`):

```sql
-- =====================================================================
-- Homework & Assignment — Phase 6: schedule homework-notify-pass every 15 min.
-- Uses the public anon JWT (same pattern as send-task-notifications). The
-- function is idempotent (homework_notifications_sent UNIQUE), so re-runs are
-- safe; verify_jwt=true gates at the gateway via the anon JWT.
-- =====================================================================
do $$
begin
  perform cron.unschedule('homework-notify-pass-15min');
exception when others then null;
end;
$$;

select cron.schedule(
  'homework-notify-pass-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/homework-notify-pass',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5eW1rZ29oY2lqZWtzbXJ6dXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MjAxMTMsImV4cCI6MjA4MzA5NjExM30.-pC2a4z1oCiUy6Cxy0X4NnGg8gzfco4rnbmmf88e9AI"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
```

> **Implementer:** copy the anon-JWT Authorization header **verbatim** from `supabase/migrations/20260223114546_3ef10ddd-f160-45d1-ac6d-7dcf3f240d71.sql` (the `send-task-notifications` schedule) rather than trusting the token above — it must match the project's current anon key exactly. If that migration's token differs, use that file's token.

- [ ] **Step 2: Confirm timestamp sorts last** (`20260601095000` > `…094000`).
- [ ] **Step 3: Commit** (apply in Task 3).
```bash
git add supabase/migrations/20260601095000_homework_notify_cron.sql
git commit -F - <<'EOF'
feat(homework): pg_cron schedule for homework-notify-pass (every 15 min)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Deploy + apply + verify

- [ ] **Step 1: Deploy the edge function**
```bash
npx supabase functions deploy homework-notify-pass --project-ref gyymkgohcijeksmrzuyw
```
- [ ] **Step 2: Apply the cron migration (dry-run first)**
```bash
npx supabase db push --linked --dry-run   # "Would push" = ONLY 20260601095000_homework_notify_cron.sql
npx supabase db push --linked --yes
```
- [ ] **Step 3: Verify the cron is scheduled**
Run in the SQL editor (or via the Management API query endpoint):
```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'homework-notify-pass-15min';
-- Expect one active row, schedule '*/15 * * * *'.
```
- [ ] **Step 4: Smoke (optional, dev)** — manually invoke the function once (POST with the anon JWT) and confirm it returns `{ ok: true, in_app, pushed }` with no error; check a test student receives an in-app notification for a freshly-visible assignment.

---

## Self-review
**Spec §7 coverage:** event 1 visible → students of assigned classes; event 2 24h-before-due → unsubmitted students only; event 3 due-passed → creator with submission count. Web-push **and** in-app row for each (decision #3). Exactly these three, no per-submission/digest.
**Idempotency:** `homework_notifications_sent` UNIQUE + the lookup-then-claim fanout → each recipient notified once per (assignment, type); lookback windows bound the scan and prevent a first-deploy storm on old assignments.
**Timing:** `visible_from`/`due_at` are timestamptz → plain `now()` comparisons (no TZ conversion). Up to 15-min latency (acceptable for homework).
**Security/config:** cron uses the public anon JWT (no new secret); `verify_jwt=true` gates at the gateway; function uses service-role internally + `WEBHOOK_SECRET` (already in prod) for the `send-web-push` call; push is best-effort (in-app row is the source of truth). No `any` in the TS (typed via inline narrowing).
**Out of scope:** analytics (Phase 7), polish (Phase 8).
