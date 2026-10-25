// Phase 5b — Daily dormancy orchestrator.
// Cron-invoked (no CORS, deploy with --no-verify-jwt).
// Steps:
//   A. oly_cleanup_stuck_attempts — auto-submit attempts overdue by 1h+
//   B. oly_dormancy_day30        — mark non-SALCI dormant + SALCI archived (sidebar gating)
//   C. oly_dormancy_day60        — purge PII; returns auth_user_ids + storage paths to delete
//   D. auth.admin.deleteUser per uid (catch + log failures, never throw)
//   E. storage.from(olympiad-receipts).remove(chunks of 1000)
// Returns JSON summary with per-step counters.

// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORAGE_CHUNK_SIZE = 1000;

serve(async (req: Request) => {
  try {
    // @ts-expect-error Deno.env
    const cronSecret = Deno.env.get("OLY_CRON_SECRET");
    if (!cronSecret) {
      // Misconfigured deploy — refuse to run rather than expose the dormancy pass to the world.
      return new Response("OLY_CRON_SECRET not configured", { status: 500 });
    }
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const summary: Record<string, unknown> = {};

    // ── Step 0: advance scheduled enrollment closures ─────────────────────────
    const { data: advanced, error: advErr } = await supabase.rpc("oly_advance_scheduled_closures");
    if (advErr) console.error("[oly-dormancy-pass] scheduled_closures error", advErr);
    summary.scheduled_closures = advanced ?? null;
    if (advErr) summary.scheduled_closures_error = advErr.message;

    // ── Step A: cleanup stuck attempts ───────────────────────────────────────
    const { data: stuckData, error: stuckErr } = await supabase.rpc("oly_cleanup_stuck_attempts");
    if (stuckErr) console.error("[oly-dormancy-pass] stuck_attempts error", stuckErr);
    summary.stuck_attempts = stuckData ?? null;
    if (stuckErr) summary.stuck_attempts_error = stuckErr.message;

    // ── Step B: Day 30 dormancy ──────────────────────────────────────────────
    const { data: day30, error: day30Err } = await supabase.rpc("oly_dormancy_day30");
    if (day30Err) console.error("[oly-dormancy-pass] day30 error", day30Err);
    summary.day30 = day30 ?? null;
    if (day30Err) summary.day30_error = day30Err.message;

    // ── Step C: Day 60 purge (returns lists to delete out-of-band) ──────────
    const { data: day60Raw, error: day60Err } = await supabase.rpc("oly_dormancy_day60");
    if (day60Err) console.error("[oly-dormancy-pass] day60 error", day60Err);

    const day60 = (day60Raw as {
      ok?: boolean;
      purged?: number;
      auth_user_ids_to_delete?: string[];
      storage_paths_to_delete?: string[];
    } | null) ?? null;

    summary.day60_purged = day60?.purged ?? 0;
    if (day60Err) summary.day60_error = day60Err.message;

    // ── Step D: delete auth users (catch + log per-uid, never throw) ────────
    const authIds = day60?.auth_user_ids_to_delete ?? [];
    let authDeleted = 0;
    const authFailures: Array<{ id: string; error: string }> = [];
    for (const uid of authIds) {
      try {
        const { error } = await supabase.auth.admin.deleteUser(uid);
        if (error) {
          authFailures.push({ id: uid, error: error.message });
          console.error("[oly-dormancy-pass] auth deleteUser failed", uid, error.message);
        } else {
          authDeleted++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        authFailures.push({ id: uid, error: msg });
        console.error("[oly-dormancy-pass] auth deleteUser threw", uid, msg);
      }
    }
    summary.auth_deleted = authDeleted;
    summary.auth_failures = authFailures.length;
    if (authFailures.length > 0) {
      summary.auth_failure_sample = authFailures.slice(0, 10);
    }

    // ── Step E: bulk storage delete in chunks of 1000 ───────────────────────
    const paths = day60?.storage_paths_to_delete ?? [];
    let storageDeleted = 0;
    const storageFailures: Array<{ chunk_start: number; error: string }> = [];
    for (let i = 0; i < paths.length; i += STORAGE_CHUNK_SIZE) {
      const chunk = paths.slice(i, i + STORAGE_CHUNK_SIZE);
      try {
        const { error } = await supabase.storage.from("olympiad-receipts").remove(chunk);
        if (error) {
          storageFailures.push({ chunk_start: i, error: error.message });
          console.error("[oly-dormancy-pass] storage remove failed", i, error.message);
        } else {
          storageDeleted += chunk.length;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        storageFailures.push({ chunk_start: i, error: msg });
        console.error("[oly-dormancy-pass] storage remove threw", i, msg);
      }
    }
    summary.storage_deleted = storageDeleted;
    summary.storage_failures = storageFailures.length;
    if (storageFailures.length > 0) {
      summary.storage_failure_sample = storageFailures.slice(0, 10);
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oly-dormancy-pass] fatal", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
