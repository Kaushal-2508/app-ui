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
    const userId = claimsData.claims.sub as string;

    // === SERVICE CLIENT ===
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { institution_id, academic_year, promotions, snapshot_before_promote } = await req.json();

    if (!institution_id || !promotions || !Array.isArray(promotions) || promotions.length === 0) {
      return new Response(
        JSON.stringify({ error: "institution_id and promotions[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === ROLE CHECK: must be admin for this institution ===
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["super_admin", "super_school_admin", "school_admin"])
      .limit(1)
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For school admins, verify institution match
    if (roleData.role !== "super_admin") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", userId)
        .single();

      if (profile?.institution_id !== institution_id) {
        return new Response(JSON.stringify({ error: "Forbidden: institution mismatch" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Validate all new_class_ids belong to the institution
    const classIds = [...new Set(promotions.map((p: any) => p.new_class_id))];
    const { data: validClasses, error: classErr } = await supabase
      .from("classes")
      .select("id")
      .eq("institution_id", institution_id)
      .in("id", classIds);

    if (classErr) throw classErr;

    const validClassIds = new Set(validClasses?.map((c: any) => c.id) || []);
    const invalidClasses = classIds.filter((id) => !validClassIds.has(id));
    if (invalidClasses.length > 0) {
      return new Response(
        JSON.stringify({ error: `Invalid class IDs for this institution: ${invalidClasses.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional: snapshot before promoting
    if (snapshot_before_promote) {
      try {
        const snapshotUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/snapshot-student-passport`;
        await fetch(snapshotUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ institution_id, academic_year }),
        });
      } catch (snapshotErr) {
        console.error("Snapshot failed (continuing with promotion):", snapshotErr);
      }
    }

    // Execute promotions
    const results: Array<{ student_id: string; success?: boolean; error?: string }> = [];

    for (const promo of promotions) {
      const { student_id, new_class_id } = promo;
      try {
        const { error: delErr } = await supabase
          .from("class_assignments")
          .delete()
          .eq("user_id", student_id)
          .eq("role", "student");

        if (delErr) throw delErr;

        const { error: insErr } = await supabase
          .from("class_assignments")
          .insert({
            user_id: student_id,
            class_id: new_class_id,
            role: "student",
          });

        if (insErr) throw insErr;

        results.push({ student_id, success: true });
      } catch (err: any) {
        results.push({ student_id, error: err.message });
      }
    }

    const promoted = results.filter((r) => r.success).length;
    const failed = results.filter((r) => r.error);

    return new Response(
      JSON.stringify({ promoted, failed, total: promotions.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Promote error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
