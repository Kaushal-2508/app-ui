import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    // === AUTH CHECK ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { student_id, class_id, fingerprint_hash, device_id } = await req.json();

    if (!student_id || !class_id || !fingerprint_hash) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: student_id, class_id, fingerprint_hash" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify enrollment
    const { data: enrollment, error: enrollError } = await supabase
      .from("biometric_enrollments")
      .select("*")
      .eq("student_id", student_id)
      .eq("is_active", true)
      .single();

    if (enrollError || !enrollment) {
      return new Response(
        JSON.stringify({ error: "Student not enrolled for biometric attendance" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get student's class assignment to find institution
    const { data: assignment, error: assignError } = await supabase
      .from("class_assignments")
      .select("class_id")
      .eq("user_id", student_id)
      .eq("class_id", class_id)
      .eq("role", "student")
      .single();

    if (assignError || !assignment) {
      return new Response(
        JSON.stringify({ error: "Student not assigned to this class" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date().toISOString().split("T")[0];

    // Mark attendance
    const { error: attendanceError } = await supabase
      .from("attendance_records")
      .upsert(
        {
          institution_id: enrollment.institution_id,
          class_id,
          student_id,
          date: today,
          status: "present",
          method: "biometric",
          remarks: `Biometric check-in via device: ${device_id || "unknown"}`,
        },
        { onConflict: "class_id,student_id,date" }
      );

    if (attendanceError) {
      return new Response(
        JSON.stringify({ error: "Failed to mark attendance" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "Attendance marked successfully", date: today }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
