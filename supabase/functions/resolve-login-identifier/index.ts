import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limiting (resets on function restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  
  if (entry.count >= MAX_ATTEMPTS) {
    return true;
  }
  
  entry.count++;
  return false;
}

function detectIdentifierType(identifier: string): "email" | "mobile" | "admission" {
  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    return "email";
  }
  
  // Mobile pattern: 10 digits (after stripping non-digits)
  const digitsOnly = identifier.replace(/\D/g, "");
  if (digitsOnly.length === 10 || (digitsOnly.length === 12 && digitsOnly.startsWith("91"))) {
    return "mobile";
  }
  
  // Default to admission number
  return "admission";
}

function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, "");
  
  // Remove country code if present (91 for India)
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.substring(2);
  }
  
  return digits;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { identifier } = await req.json();
    
    if (!identifier || typeof identifier !== "string") {
      return new Response(
        JSON.stringify({ error: "Identifier is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();
    
    // Check rate limiting
    if (isRateLimited(normalizedIdentifier)) {
      return new Response(
        JSON.stringify({ 
          error: "Too many attempts. Please try again in 15 minutes.",
          rateLimited: true 
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const identifierType = detectIdentifierType(identifier.trim());
    
    let query;
    
    if (identifierType === "email") {
      query = supabase
        .from("profiles")
        .select("id, email, is_active")
        .ilike("email", normalizedIdentifier)
        .single();
    } else if (identifierType === "mobile") {
      const normalizedPhone = normalizePhone(identifier);
      query = supabase
        .from("profiles")
        .select("id, email, is_active, phone")
        .or(`phone.eq.${normalizedPhone},phone.eq.+91${normalizedPhone},phone.eq.91${normalizedPhone}`)
        .limit(1)
        .single();
    } else {
      // Admission number - case insensitive
      query = supabase
        .from("profiles")
        .select("id, email, is_active, admission_number")
        .ilike("admission_number", normalizedIdentifier)
        .single();
    }

    const { data: profile, error } = await query;

    // Olympiad synthetic-student fallback: an Olympiad roll number has no SALCI
    // profile row keyed the usual way, so resolve it to the student's synthetic
    // auth email. This lets the MAIN login work for onboarded-school students,
    // not just the dedicated /olympiad/login page.
    if (error || !profile) {
      const rollUpper = identifier.trim().toUpperCase();
      const { data: oly } = await supabase
        .from("oly_students")
        .select("roll_number, auth_user_id")
        .eq("roll_number", rollUpper)
        .not("auth_user_id", "is", null)
        .in("status", ["active", "dormant"])
        .limit(1)
        .maybeSingle();
      if (oly?.auth_user_id) {
        return new Response(
          JSON.stringify({
            email: `${oly.roll_number.toLowerCase()}@olympiad.salci.org`,
            userType: "student",
            identifierType: "olympiad",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Generic error message to prevent account enumeration
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if account is active
    if (profile.is_active === false) {
      return new Response(
        JSON.stringify({ error: "Account is inactive. Please contact your administrator." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user role
    const { data: userRoles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id);
    
    const roles = userRoles?.map(r => r.role) || [];
    const rolePriority = ["super_admin", "school_admin", "coordinator", "teacher", "employee", "student"];
    const primaryRole = rolePriority.find(r => roles.includes(r)) || "student";

    return new Response(
      JSON.stringify({
        email: profile.email,
        userType: primaryRole,
        identifierType,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error in resolve-login-identifier:", error);
    return new Response(
      JSON.stringify({ error: "Invalid credentials" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
