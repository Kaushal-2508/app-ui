// admission-docs-sweep: deletes certificate scans queued in
// public.admission_document_trash (migration 20261012120000) through the Storage
// API. Storage refuses SQL deletes of storage.objects (storage.protect_delete),
// so admission_remove_document_file and a replaced upload only queue the path;
// public.admission_docs_sweep_kick() posts here after the commit (pg_net, Bearer =
// the Vault webhook_secret, which equals WEBHOOK_SECRET), and the cron
// admission-docs-sweep-10min retries whatever is left.
//
// Secrets: WEBHOOK_SECRET. Deploy with --no-verify-jwt (config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "admission-documents";
const BATCH = 100;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

interface Pending {
  id: number;
  object_path: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || !sameSecret(req.headers.get("Authorization") ?? "", `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    // A hung Storage call must not hold the function open.
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });

  const { data, error } = await db.rpc("admission_docs_trash_pending", { _limit: BATCH });
  if (error) {
    console.error("admission_docs_trash_pending failed:", error.message);
    return json({ error: "claim failed" }, 500);
  }
  const rows = (data ?? []) as Pending[];
  if (rows.length === 0) return json({ removed: 0 });

  const ids = rows.map((r) => r.id);
  const { error: removeError } = await db.storage.from(BUCKET).remove(rows.map((r) => r.object_path));
  const { error: markError } = await db.rpc("admission_docs_trash_result", {
    _done: removeError ? [] : ids,
    _failed: removeError ? ids : [],
    _error: removeError?.message ?? null,
  });
  if (markError) console.error("admission_docs_trash_result failed:", markError.message);
  if (removeError) {
    console.error("storage remove failed:", removeError.message);
    return json({ error: "remove failed", queued: rows.length }, 502);
  }
  return json({ removed: rows.length });
});
