// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 25;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    // Fetch all students without auth_user_id and without profile_id (non-SALCI)
    const { data: students, error } = await supabase
      .from("oly_students")
      .select("id, roll_number, date_of_birth")
      .is("auth_user_id", null)
      .is("profile_id", null)
      .eq("status", "active");
    if (error) return json({ error: error.message }, 500);

    let created = 0;
    let failed = 0;
    const failures: Array<{ id: string; error: string }> = [];

    // Chunk into BATCH_SIZE concurrent inserts
    for (let i = 0; i < (students ?? []).length; i += BATCH_SIZE) {
      const chunk = (students ?? []).slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(chunk.map(async (s) => {
        // Parse YYYY-MM-DD directly — NEVER use new Date() for date-only ISO strings.
        // new Date("YYYY-MM-DD") parses as UTC midnight; in timezones west of UTC
        // getDate() returns the previous day, producing a wrong password.
        const [year, month, day] = (s.date_of_birth as string).split("-").map(Number);
        const dd = String(day).padStart(2, "0");
        const mm = String(month).padStart(2, "0");
        const yy = String(year).slice(-2);
        const password = `${dd}${mm}${yy}`;
        const email = `${s.roll_number.toLowerCase()}@olympiad.salci.org`;

        const { data: newUser, error: cErr } = await supabase.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (cErr) throw cErr;

        const { error: updErr } = await supabase.from("oly_students").update({ auth_user_id: newUser.user.id }).eq("id", s.id);
        if (updErr) throw updErr;
        return s.id;
      }));

      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") created++;
        else { failed++; failures.push({ id: chunk[j].id, error: (r.reason as Error)?.message ?? "unknown" }); }
      }
    }

    return json({ ok: true, processed: students?.length ?? 0, created, failed, failures }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
