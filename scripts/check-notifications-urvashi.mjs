// One-shot lookup of in-app + outbound-email notifications for a single user.
// Uses the service-role key (passed via SUPABASE_SERVICE_ROLE_KEY env var) so
// RLS doesn't block the read. Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-notifications-urvashi.mjs
import { createClient } from "@supabase/supabase-js";

const EMAIL = (process.argv[2] || "urvashibatra13@gmail.com").toLowerCase();
const URL = "https://gyymkgohcijeksmrzuyw.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: profile, error: profErr } = await sb
  .from("profiles")
  .select("id, full_name, email, institution_id, is_active, created_at")
  .ilike("email", EMAIL)
  .maybeSingle();
if (profErr) { console.error("profile:", profErr); process.exit(1); }

console.log("=== PROFILE ===");
console.log(profile ?? "(no profile row found for this email)");

if (profile?.id) {
  const { data: notifs, error: nErr } = await sb
    .from("notifications")
    .select("id, created_at, type, title, message, is_read, link, metadata")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (nErr) { console.error("notifications:", nErr); }
  else {
    console.log(`\n=== IN-APP NOTIFICATIONS (${notifs.length} of last 200) ===`);
    for (const n of notifs) {
      console.log(
        `[${n.created_at}] ${n.is_read ? "read " : "UNREAD"} ${n.type.padEnd(28)} ${JSON.stringify(n.title)}`,
      );
      if (n.message && n.message !== n.title) {
        console.log(`    msg: ${n.message}`);
      }
    }
  }
}

const { data: queue, error: qErr } = await sb
  .from("notification_queue")
  .select("id, created_at, scheduled_for, sent_at, status, notification_type, subject, priority, attempts, last_attempt_at, error_message")
  .ilike("recipient_email", EMAIL)
  .order("created_at", { ascending: false })
  .limit(200);
if (qErr) { console.error("queue:", qErr); }
else {
  console.log(`\n=== EMAIL QUEUE (${queue.length} of last 200) ===`);
  for (const q of queue) {
    console.log(
      `[${q.created_at}] ${q.status.padEnd(10)} ${q.notification_type.padEnd(28)} attempts=${q.attempts} sent_at=${q.sent_at ?? "-"}`,
    );
    console.log(`    subject: ${q.subject}`);
    if (q.error_message) console.log(`    error:   ${q.error_message}`);
  }
}

// Aggregate snapshot
const counts = await Promise.all([
  profile?.id
    ? sb.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", profile.id)
    : Promise.resolve({ count: 0 }),
  profile?.id
    ? sb.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", profile.id).eq("is_read", false)
    : Promise.resolve({ count: 0 }),
  sb.from("notification_queue").select("*", { count: "exact", head: true }).ilike("recipient_email", EMAIL),
  sb.from("notification_queue").select("*", { count: "exact", head: true }).ilike("recipient_email", EMAIL).eq("status", "sent"),
  sb.from("notification_queue").select("*", { count: "exact", head: true }).ilike("recipient_email", EMAIL).eq("status", "failed"),
  sb.from("notification_queue").select("*", { count: "exact", head: true }).ilike("recipient_email", EMAIL).eq("status", "pending"),
]);
console.log("\n=== SNAPSHOT ===");
console.log({
  in_app_total: counts[0].count,
  in_app_unread: counts[1].count,
  email_total: counts[2].count,
  email_sent: counts[3].count,
  email_failed: counts[4].count,
  email_pending: counts[5].count,
});
