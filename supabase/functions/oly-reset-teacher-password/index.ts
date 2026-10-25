// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as {
      oly_school_id: string;
      teacher_profile_id: string;
    };

    // School must exist + be non-SALCI (these teacher accounts are
    // Olympiad-only; never reset a real SALCI teacher's portal password).
    const { data: school, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, is_existing_salci_school")
      .eq("id", body.oly_school_id)
      .single();
    if (schoolErr || !school) return json({ error: "School not found" }, 404);
    if (school.is_existing_salci_school) {
      return json({ error: "Password reset is only available for onboarded (non-SALCI) school teachers" }, 400);
    }

    // Caller must be the school admin for this school (or super admin).
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: body.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // The teacher must actually belong to this school.
    const { data: assignment } = await supabase
      .from("oly_teacher_class_assignments")
      .select("teacher_profile_id")
      .eq("oly_school_id", body.oly_school_id)
      .eq("teacher_profile_id", body.teacher_profile_id)
      .limit(1)
      .maybeSingle();
    if (!assignment) return json({ error: "Teacher not found for this school" }, 404);

    const { data: prof } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", body.teacher_profile_id)
      .single();
    const email = prof?.email ?? "";

    // Generate + set a new human-friendly password.
    const tempPassword = genTempPassword();
    const { error: updErr } = await supabase.auth.admin.updateUserById(body.teacher_profile_id, {
      password: tempPassword,
    });
    if (updErr) return json({ error: `Password reset failed: ${updErr.message}` }, 500);

    return json({ email, temp_password: tempPassword }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Human-friendly temporary password (unambiguous alphabet — no 0/O/1/l/I), 10 chars.
function genTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
