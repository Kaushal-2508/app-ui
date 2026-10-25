// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Minimal structural type for the supabase service-role client surface this function uses.
type AdminSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { roll_number: string; date_of_birth: string; profile_id: string | null; auth_user_id: string | null } | null }>;
      };
    };
    update: (patch: { auth_user_id: string }) => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
  };
  auth: {
    admin: {
      createUser: (input: { email: string; password: string; email_confirm: boolean }) => Promise<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

async function createOlympiadAuthUser(supabase: AdminSupabase, oly_student_id: string): Promise<string | null> {
  const { data: student } = await supabase
    .from("oly_students")
    .select("roll_number, date_of_birth, profile_id, auth_user_id")
    .eq("id", oly_student_id)
    .single();
  if (!student || student.auth_user_id || student.profile_id) {
    return student?.auth_user_id ?? null;
  }

  // Parse YYYY-MM-DD directly — NEVER use new Date() for date-only ISO strings.
  // new Date("YYYY-MM-DD") parses as UTC midnight; in timezones west of UTC
  // getDate() returns the previous day, producing a wrong password.
  const [year, month, day] = student.date_of_birth.split("-").map(Number);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const yy = String(year).slice(-2);
  const password = `${dd}${mm}${yy}`;
  const email = `${student.roll_number.toLowerCase()}@olympiad.salci.org`;

  const { data: newUser, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !newUser?.user) {
    // Duplicate email (re-enrollment of a removed student) or admin API failure —
    // log and return null; caller treats null as "no auth user, can't log in" but the
    // enrollment itself still goes through, so the row is recoverable via backfill.
    console.error("Failed to create Olympiad auth user", error?.message ?? "no user returned");
    return null;
  }

  await supabase.from("oly_students").update({ auth_user_id: newUser.user.id }).eq("id", oly_student_id);
  return newUser.user.id;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type FormData = {
  full_name: string;
  date_of_birth: string;
  class_label: string;
  section_label?: string | null;
  grade_level_id: string;
  admission_number?: string | null;
  profile_id?: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email?: string | null;
  fee_collected: boolean;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = authHeader.replace("Bearer ", "");
    const { data: userRes } = await supabase.auth.getUser(token);
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "Your session has expired. Please sign in again." }, 401);

    const { oly_school_id, form_data } = (await req.json()) as { oly_school_id: string; form_data: FormData };

    if (!form_data.fee_collected) {
      return json({ error: "Fee collected checkbox required" }, 400);
    }

    const { data: school } = await supabase
      .from("oly_schools")
      .select("id, campaign_id, school_short_code, is_existing_salci_school, status")
      .eq("id", oly_school_id)
      .single();
    if (!school) return json({ error: "School not found" }, 404);

    const { data: isOpen } = await supabase.rpc("oly_enrollment_is_open", { p_oly_school_id: school.id });
    if (!isOpen) {
      return json({ error: "Enrollment is closed for this school." }, 409);
    }

    // Authorize: teacher assigned OR school_admin OR super_admin
    const { data: isTeacher } = await supabase.rpc("oly_is_teacher_for_class", {
      p_uid: userId, p_oly_school_id: oly_school_id, p_grade_level_id: form_data.grade_level_id,
    });
    const { data: isAdmin } = await supabase.rpc("oly_is_school_admin_for", {
      p_uid: userId, p_oly_school_id: oly_school_id,
    });
    const { data: isSuper } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (!isTeacher && !isAdmin && !isSuper) {
      return json({ error: "You're not authorized to enroll students for this class." }, 403);
    }

    // Validate phone
    if (!/^[6-9]\d{9}$/.test(form_data.parent_phone)) {
      return json({ error: "Invalid Indian mobile number" }, 400);
    }
    if (form_data.subject_ids.length !== 3) {
      return json({ error: "Exactly 3 subjects required" }, 400);
    }

    // Duplicate guard. Existing schools: match by profile_id and/or admission_number
    // using typed equality (never put client text inside a PostgREST .or() filter).
    // A removed row does not count as a duplicate (mirrors the roster RPC's
    // already_enrolled), and a failed check is surfaced rather than silently skipped.
    if (school.is_existing_salci_school) {
      if (form_data.profile_id) {
        const { data: dup, error: dupErr } = await supabase
          .from("oly_students")
          .select("roll_number")
          .eq("oly_school_id", oly_school_id)
          .eq("campaign_id", school.campaign_id)
          .neq("status", "removed")
          .eq("profile_id", form_data.profile_id)
          .limit(1)
          .maybeSingle();
        if (dupErr) return json({ error: "Duplicate check failed" }, 500);
        if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
      }
      if (form_data.admission_number) {
        const { data: dup, error: dupErr } = await supabase
          .from("oly_students")
          .select("roll_number")
          .eq("oly_school_id", oly_school_id)
          .eq("campaign_id", school.campaign_id)
          .neq("status", "removed")
          .eq("admission_number", form_data.admission_number)
          .limit(1)
          .maybeSingle();
        if (dupErr) return json({ error: "Duplicate check failed" }, 500);
        if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
      }
    } else {
      const { data: dup } = await supabase
        .from("oly_students")
        .select("roll_number")
        .eq("oly_school_id", oly_school_id)
        .ilike("full_name", form_data.full_name)
        .eq("date_of_birth", form_data.date_of_birth)
        .eq("class_label", form_data.class_label)
        .gt("enrolled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (dup) return json({ blocked: true, message: `Already enrolled: ${dup.roll_number}` }, 409);
    }

    // Get campaign year + price for the receipt
    const { data: campaign } = await supabase
      .from("oly_campaigns")
      .select("campaign_year, default_price_rupees, gst_percent")
      .eq("id", school.campaign_id)
      .single();
    if (!campaign) return json({ error: "Campaign not found" }, 500);

    const { data: schoolPrice } = await supabase
      .from("oly_schools")
      .select("price_override_rupees")
      .eq("id", oly_school_id)
      .single();
    const priceRupees = schoolPrice?.price_override_rupees ?? campaign.default_price_rupees;
    const gstRupees = Math.round(priceRupees * campaign.gst_percent) / 100;
    const totalRupees = priceRupees + gstRupees;

    // Generate roll number
    const { data: rollData } = await supabase.rpc("oly_generate_roll_number", {
      p_school_short_code: school.school_short_code,
      p_class_label: form_data.class_label,
      p_campaign_year: campaign.campaign_year,
    });
    const rollNumber = rollData as string;
    if (!rollNumber) return json({ error: "Failed to generate roll number" }, 500);

    // Insert student
    const { data: student, error: insErr } = await supabase
      .from("oly_students")
      .insert({
        oly_school_id,
        campaign_id: school.campaign_id,
        full_name: form_data.full_name,
        date_of_birth: form_data.date_of_birth,
        class_label: form_data.class_label,
        section_label: form_data.section_label ?? null,
        grade_level_id: form_data.grade_level_id,
        admission_number: form_data.admission_number ?? null,
        profile_id: form_data.profile_id ?? null,
        roll_number: rollNumber,
        subject_ids: form_data.subject_ids,
        parent_name: form_data.parent_name,
        parent_phone: form_data.parent_phone,
        parent_email: form_data.parent_email ?? null,
        status: "active",
        enrollment_channel: "teacher_cash",
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr || !student) return json({ error: insErr?.message ?? "Insert failed" }, 500);

    // Write the student's DOB + guardian contact back to their SALCI record so it
    // surfaces in the student portal. Best-effort: never fail the enrollment on this.
    if (form_data.profile_id) {
      const { error: spdErr } = await supabase
        .from("student_personal_details")
        .upsert(
          {
            profile_id: form_data.profile_id,
            date_of_birth: form_data.date_of_birth,
            guardian_name: form_data.parent_name,
            guardian_phone: form_data.parent_phone,
            guardian_email: form_data.parent_email ?? null,
            updated_by: userId,
          },
          { onConflict: "profile_id" },
        );
      if (spdErr) console.error("student_personal_details upsert failed", spdErr.code, spdErr.message);
    }

    // Cash receipt — no oly_enrollment_pending row exists, so receipt-generate
    // needs to look at oly_students.enrollment_channel = 'teacher_cash' and skip the pending lookup.
    // For Phase 3a we insert a synthetic pending row so the existing receipt-generate works unchanged.
    await supabase.from("oly_enrollment_pending").insert({
      oly_school_id,
      campaign_id: school.campaign_id,
      full_name: form_data.full_name,
      date_of_birth: form_data.date_of_birth,
      class_label: form_data.class_label,
      section_label: form_data.section_label ?? null,
      grade_level_id: form_data.grade_level_id,
      admission_number: form_data.admission_number ?? null,
      subject_ids: form_data.subject_ids,
      parent_name: form_data.parent_name,
      parent_phone: form_data.parent_phone,
      parent_email: form_data.parent_email ?? null,
      status: "paid",
      gateway_order_id: `cash_${student.id}`,
      gateway_payment_id: null,  // null marks it as cash
      amount_rupees: priceRupees,
      gst_rupees: gstRupees,
      total_rupees: totalRupees,
      promoted_student_id: student.id,
    });

    // Create synthetic auth user for the Olympiad student portal (idempotent).
    // login_ready reflects whether the student can sign in with their Login ID
    // (roll number) + password (DDMMYY of DOB) right away.
    const authUserId = await createOlympiadAuthUser(supabase, student.id);

    // Provision a complete student identity so the account can actually sign in
    // and be routed to the Olympiad workspace:
    //   • profile.full_name + institution_id  — the institution lets the
    //     Olympiad-only lockdown detect them and route to /student/olympiad;
    //   • a 'student' role  — required by the /student/olympiad ProtectedRoute.
    // UPSERT the profile: the handle_new_user trigger already created a bare row
    // (institution_id NULL), so a plain INSERT would silently no-op.
    if (authUserId) {
      const { data: instRow } = await supabase
        .from("oly_schools")
        .select("institution_id")
        .eq("id", oly_school_id)
        .single();
      const studentInstitutionId = (instRow as { institution_id?: string } | null)?.institution_id ?? null;
      await supabase.from("profiles").upsert({
        id: authUserId,
        full_name: form_data.full_name,
        email: `${rollNumber.toLowerCase()}@olympiad.salci.org`,
        institution_id: studentInstitutionId,
      }, { onConflict: "id" });
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", authUserId)
        .eq("role", "student")
        .maybeSingle();
      if (!existingRole) {
        await supabase.from("user_roles").insert({
          user_id: authUserId,
          role: "student",
          institution_id: studentInstitutionId,
        });
      }
    }

    // Trigger receipt generation (fire-and-forget)
    supabase.functions.invoke("oly-receipt-generate", {
      body: { oly_student_id: student.id },
    }).catch(() => {});

    // Audit
    await supabase.from("oly_audit_log").insert({
      campaign_id: school.campaign_id,
      oly_school_id,
      oly_student_id: student.id,
      actor_id: userId,
      actor_role: isTeacher ? "teacher" : (isAdmin ? "school_admin" : "super_admin"),
      action: "student_enrolled_cash",
      after_json: { roll_number: rollNumber, full_name: form_data.full_name, class_label: form_data.class_label, amount_rupees: totalRupees },
    });

    return json({ oly_student_id: student.id, roll_number: rollNumber, login_ready: !!authUserId }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
