// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Minimal structural shape for the service-role client used by uniqueCode().
// Avoids `any` (ESLint flags it as an error) while keeping the helper generic.
type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
};

function generateInstituteCode(name: string): string {
  const stop = new Set(["the", "of", "and", "school", "academy", "public", "international"]);
  const words = name.toLowerCase().split(/\s+/).filter((w) => w && !stop.has(w));
  const initials = (words.length ? words.slice(0, 4).map((w) => w[0]) : name.slice(0, 3).split(""))
    .join("").toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return (initials + suffix).slice(0, 12);
}

function generateShortCode(name: string): string {
  const alnum = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const head = (alnum.slice(0, 3) || "SCH").padEnd(3, "X");
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "0");
  return (head + rand).slice(0, 6);
}

// Login password derived from the school's short code + numerics (e.g. "OPS0MF4821").
// Distinct per school since short codes are unique; handed to the school admin to sign in.
function passwordFromCode(code: string): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  return `${code}${digits}`;
}

// Retry an insert-bound code until it is unique (bounded attempts).
async function uniqueCode(
  client: SupabaseLike, table: string, column: string, gen: () => string, attempts = 12,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const code = gen();
    const { data } = await client.from(table).select(column).eq(column, code).maybeSingle();
    if (!data) return code;
  }
  throw new Error(`Could not generate a unique ${column} after ${attempts} attempts`);
}

type Payload = {
  campaign_id: string;
  is_existing_salci_school: boolean;
  institution_id?: string;       // required if is_existing_salci_school
  school_name?: string;          // required if !is_existing_salci_school
  city?: string;
  state?: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  participating_grade_level_ids: string[];
  price_override_rupees?: number | null;
  internal_notes?: string | null;
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

    // Verify super_admin
    const userRes = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes.data.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as Payload;

    let institutionId: string;
    let instituteCode = "";
    let displayName = "";
    let adminEmail = "";
    let resetLink = "";
    let tempPasswordOut = "";
    let shortCode = "";

    if (body.is_existing_salci_school) {
      if (!body.institution_id) return json({ error: "institution_id required for existing SALCI schools" }, 400);
      institutionId = body.institution_id;

      // Fetch the linked institution's code + name for return value / short code.
      const { data: instRow } = await supabase
        .from("institutions")
        .select("code, name")
        .eq("id", institutionId)
        .single();
      instituteCode = instRow?.code ?? "";
      displayName = instRow?.name ?? "";

      // Enable olympiad feature flag if not already enabled
      const { error: ffErr } = await supabase
        .from("institution_features")
        .upsert({ institution_id: institutionId, feature_id: "olympiad", is_enabled: true }, { onConflict: "institution_id,feature_id" });
      if (ffErr) return json({ error: `Feature flag toggle failed: ${ffErr.message}` }, 500);
    } else {
      if (!body.school_name) {
        return json({ error: "school_name required for new schools" }, 400);
      }
      displayName = body.school_name;

      // Auto-generate a unique institute code.
      instituteCode = await uniqueCode(supabase, "institutions", "code", () => generateInstituteCode(body.school_name!));

      // Create institution
      const { data: newInst, error: instErr } = await supabase
        .from("institutions")
        .insert({
          name: body.school_name,
          code: instituteCode,
          contact_email: body.primary_contact_email,
          contact_phone: body.primary_contact_phone,
          is_active: true,
        })
        .select("id")
        .single();
      if (instErr || !newInst) return json({ error: `Institution create failed: ${instErr?.message}` }, 500);
      institutionId = newInst.id;

      // Enable ONLY the olympiad feature
      const { error: ffErr } = await supabase.from("institution_features").insert({
        institution_id: institutionId,
        feature_id: "olympiad",
        is_enabled: true,
      });
      if (ffErr) return json({ error: `Feature flag toggle failed: ${ffErr.message}` }, 500);

      // Short code first — the admin password is derived from it.
      shortCode = await uniqueCode(supabase, "oly_schools", "school_short_code", () => generateShortCode(displayName));

      // Auto-create school admin; password = short code + numerics, surfaced to the super-admin.
      const tempPassword = passwordFromCode(shortCode);
      tempPasswordOut = tempPassword;
      const { data: newUser, error: userErr } = await supabase.auth.admin.createUser({
        email: body.primary_contact_email,
        password: tempPassword,
        email_confirm: true,
      });
      if (userErr || !newUser?.user) return json({ error: `Admin user create failed: ${userErr?.message}` }, 500);

      // Profile + role. UPSERT (not INSERT): the handle_new_user trigger
      // auto-creates a profiles row (institution_id NULL) the moment the auth
      // user is created, so a bare INSERT silently conflicts and leaves
      // institution_id NULL — which breaks every get_user_institution-gated
      // read for this admin (their own institution name, teacher rosters, etc).
      const { error: profErr } = await supabase.from("profiles").upsert({
        id: newUser.user.id,
        full_name: body.primary_contact_name,
        email: body.primary_contact_email,
        phone: body.primary_contact_phone,
        institution_id: institutionId,
      }, { onConflict: "id" });
      if (profErr) return json({ error: `Admin profile failed: ${profErr.message}` }, 500);
      const { error: roleErr } = await supabase.from("user_roles").insert({
        user_id: newUser.user.id,
        role: "school_admin",
        institution_id: institutionId,
      });
      if (roleErr) return json({ error: `Admin role failed: ${roleErr.message}` }, 500);

      // Generate password-set link
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: body.primary_contact_email,
      });
      adminEmail = body.primary_contact_email;
      resetLink = linkData?.properties?.action_link ?? "";

      // Send welcome email (reuse existing pattern if available, else inline)
      // @ts-expect-error Deno.env
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && linkData?.properties?.action_link) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "SALCI Olympiad <noreply@salci.org>",
            to: body.primary_contact_email,
            subject: `Welcome to SALCI Olympiad — set your password for ${body.school_name}`,
            html: `<p>Hello ${body.primary_contact_name},</p>
<p>Your school <strong>${body.school_name}</strong> has been onboarded for the SALCI Olympiad. Click the link below to set your password and log in:</p>
<p><a href="${linkData.properties.action_link}">Set your password</a></p>
<p>Best regards,<br/>Team SALCI</p>`,
          }),
        }).catch(() => {});
      }
    }

    // Existing-school branch didn't generate a short code yet; new-school branch already did.
    if (!shortCode) {
      shortCode = await uniqueCode(supabase, "oly_schools", "school_short_code", () => generateShortCode(displayName));
    }

    // Insert oly_schools row
    const { data: olySchool, error: olySchoolErr } = await supabase
      .from("oly_schools")
      .insert({
        campaign_id: body.campaign_id,
        institution_id: institutionId,
        school_short_code: shortCode,
        city: body.city ?? null,
        state: body.state ?? null,
        primary_contact_name: body.primary_contact_name,
        primary_contact_email: body.primary_contact_email,
        primary_contact_phone: body.primary_contact_phone,
        participating_grade_level_ids: body.participating_grade_level_ids,
        price_override_rupees: body.price_override_rupees ?? null,
        is_existing_salci_school: body.is_existing_salci_school,
        internal_notes: body.internal_notes ?? null,
        created_by: userId,
      })
      .select("id, school_short_code")
      .single();
    if (olySchoolErr || !olySchool) return json({ error: `oly_schools insert failed: ${olySchoolErr?.message}` }, 500);

    return json({
      oly_school_id: olySchool.id,
      institution_id: institutionId,
      school_short_code: olySchool.school_short_code,
      institute_code: instituteCode,
      admin_email: adminEmail,
      temp_password: tempPasswordOut,
      reset_link: resetLink,
    }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
