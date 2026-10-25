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
