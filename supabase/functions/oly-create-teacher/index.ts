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
    // @ts-expect-error Deno.env
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as {
      oly_school_id: string;
      full_name: string;
      email: string;
      phone: string;
      grade_level_ids: string[];
    };

    // Verify school exists + is non-SALCI + caller is school_admin
    const { data: school, error: schoolErr } = await supabase
      .from("oly_schools")
      .select("id, institution_id, campaign_id, is_existing_salci_school")
      .eq("id", body.oly_school_id)
      .single();
    if (schoolErr || !school) return json({ error: "School not found" }, 404);
    if (school.is_existing_salci_school) {
      return json({ error: "Use oly-assign-existing-teachers for existing SALCI schools" }, 400);
    }

    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: body.oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Preflight uniqueness checks with human messages. profiles.phone has a
    // platform-wide unique index (idx_profiles_phone_unique), so a colliding
    // phone would otherwise surface as a raw duplicate-key 500 AFTER the auth
    // user was created (leaving an orphan that blocks every retry with
    // "email already registered" — the bulk-upload incident of 2026-07-03).
    const { data: emailTaken } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", body.email)
      .limit(1)
      .maybeSingle();
    if (emailTaken) {
      return json({ error: `A user with email ${body.email} already exists.` }, 400);
    }
    if (body.phone) {
      const { data: phoneTaken } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone", body.phone)
        .limit(1)
        .maybeSingle();
      if (phoneTaken) {
        return json({ error: `Phone ${body.phone} is already used by another account.` }, 400);
      }
    }

    // Create auth user with a human-friendly temporary password the admin can
    // hand to the teacher directly (returned in the response below).
    const tempPassword = genTempPassword();
    const { data: newUser, error: userErr } = await supabase.auth.admin.createUser({
      email: body.email,
      password: tempPassword,
      email_confirm: true,
    });
    if (userErr || !newUser?.user) {
      const raw = userErr?.message ?? "";
      const msg = /already.*(registered|exists)/i.test(raw)
        ? `A user with email ${body.email} already exists.`
        : `Auth create failed: ${raw}`;
      return json({ error: msg }, /already/i.test(raw) ? 400 : 500);
    }

    const teacherId = newUser.user.id;

    // Any failure past this point must delete the just-created auth user,
    // otherwise the email is burned (createUser rejects it on every retry)
    // while the account has no role/assignment — a half-created orphan.
    const rollback = async () => {
      await supabase.auth.admin.deleteUser(teacherId).catch(() => {});
    };

    // Profile + role. UPSERT (not INSERT): the handle_new_user trigger already
    // auto-creates a profiles row (institution_id NULL) the instant the auth
    // user is created, so a bare INSERT silently conflicts and leaves
    // institution_id NULL — which hides the teacher from the admin entirely
    // (the profiles SELECT policy requires institution_id = the admin's
    // institution, and skips NULL).
    const { error: profErr } = await supabase.from("profiles").upsert({
      id: teacherId,
      full_name: body.full_name,
      email: body.email,
      phone: body.phone,
      institution_id: school.institution_id,
    }, { onConflict: "id" });
    if (profErr) {
      await rollback();
      const msg = profErr.code === "23505"
        ? `Phone ${body.phone} is already used by another account.`
        : `Profile failed: ${profErr.message}`;
      return json({ error: msg }, profErr.code === "23505" ? 400 : 500);
    }

    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: teacherId,
      role: "teacher",
      institution_id: school.institution_id,
    });
    if (roleErr) {
      await rollback();
      return json({ error: `Role assignment failed: ${roleErr.message}` }, 500);
    }

    // Class assignments
    const assignmentRows = body.grade_level_ids.map((gid) => ({
      campaign_id: school.campaign_id,
      oly_school_id: body.oly_school_id,
      teacher_profile_id: teacherId,
      grade_level_id: gid,
      assigned_by: userId,
    }));
    if (assignmentRows.length > 0) {
      const { error: assignErr } = await supabase
        .from("oly_teacher_class_assignments")
        .insert(assignmentRows);
      if (assignErr) {
        await rollback();
        return json({ error: `Assignment failed: ${assignErr.message}` }, 500);
      }
    }

    // Send password-set email
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: body.email,
    });
    if (resendKey && linkData?.properties?.action_link) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SALCI Olympiad <noreply@salci.org>",
          to: body.email,
          subject: "Welcome to SALCI Olympiad — set your password",
          html: `<p>Hello ${body.full_name},</p><p>You've been added as an Olympiad teacher. Click below to set your password:</p><p><a href="${linkData.properties.action_link}">Set your password</a></p>`,
        }),
      }).catch(() => {});
    }

    // Audit
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id: body.oly_school_id,
      actor_id: userId,
      actor_role: isSuper ? "super_admin" : "school_admin",
      action: "teacher_created",
      after_json: { teacher_profile_id: teacherId, full_name: body.full_name, email: body.email, grade_level_ids: body.grade_level_ids },
    });

    return json({ teacher_profile_id: teacherId, email: body.email, temp_password: tempPassword }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Human-friendly temporary password (unambiguous alphabet — no 0/O/1/l/I),
// 10 chars. The admin hands this to the teacher; the teacher can change it
// after first login.
function genTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
