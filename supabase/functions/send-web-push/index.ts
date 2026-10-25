import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authorization guard: require Bearer <WEBHOOK_SECRET>
    const authHeader = req.headers.get("Authorization");
    const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
    if (!webhookSecret || authHeader !== `Bearer ${webhookSecret}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();

    let user_id: string;
    let message_payload: { title: string; body: string; [key: string]: unknown };

    if (body.record) {
      // Database Webhook format: { type, table, record, schema, old_record }
      const record = body.record;
      user_id = record.user_id;
      message_payload = {
        title: record.title || "New Notification",
        body: record.message || "",
        data: { url: record.link || "/" },
      };
    } else {
      // Manual/Postman format: { user_id, message_payload }
      user_id = body.user_id;
      message_payload = body.message_payload;
    }

    if (!user_id || !message_payload) {
      return new Response(
        JSON.stringify({ error: "user_id and message_payload are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");

    if (!vapidPublic || !vapidPrivate || !vapidSubject) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subscriptions, error: dbError } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .eq("user_id", user_id);

    if (dbError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions", details: dbError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No subscriptions found for user" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify(message_payload)
        )
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const staleEndpoints: string[] = [];
    const failures = results
      .map((r, i) => {
        if (r.status === "rejected") {
          const reason = r.reason;
          const statusCode = reason?.statusCode || null;
          // 404/410 from the push service = subscription is dead (FCM invalidated it,
          // user cleared site data, browser profile reset, etc.). Collect for cleanup
          // so dead rows don't sit in the DB hammering the function forever. Once
          // removed, the client's drift-detection on next Settings load will re-create
          // a fresh subscription against the same user.
          if (statusCode === 404 || statusCode === 410) {
            staleEndpoints.push(subscriptions[i].endpoint);
          }
          return {
            endpoint: subscriptions[i].endpoint,
            error: reason?.body || reason?.message || String(reason),
            statusCode,
          };
        }
        return null;
      })
      .filter(Boolean);

    let cleaned = 0;
    if (staleEndpoints.length > 0) {
      const { error: cleanupError, count } = await supabase
        .from("push_subscriptions")
        .delete({ count: "exact" })
        .eq("user_id", user_id)
        .in("endpoint", staleEndpoints);
      if (!cleanupError && typeof count === "number") {
        cleaned = count;
      }
    }

    return new Response(
      JSON.stringify({
        sent,
        failed: failures.length,
        total: subscriptions.length,
        cleaned,
        failures,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
