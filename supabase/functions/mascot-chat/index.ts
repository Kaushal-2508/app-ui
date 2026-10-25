import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLE_PRIORITY = [
  "super_admin",
  "super_school_admin",
  "school_admin",
  "coordinator",
  "teacher",
  "employee",
  "student",
] as const;

type Role = (typeof ROLE_PRIORITY)[number];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // -----------------------------------------------------------------
    // Auth check: previously this function trusted the client-supplied
    // `userRole` from the request body to choose the system prompt — any
    // anonymous caller could pose as super_admin and exfiltrate role-
    // specific hints. Now we verify the JWT and read the role from DB.
    // verify_jwt = false stays in config.toml so the function can return
    // a clean 401 instead of the gateway returning HTML.
    // -----------------------------------------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const jwt = authHeader.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: userData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    // Read authoritative role(s) from user_roles. If the user has multiple
    // roles (rare but possible), use the highest-privilege one to pick
    // the prompt. Don't trust anything the client sent in the body for
    // role selection.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .limit(10);
    const userRoles = (roleRows ?? []).map((r) => r.role as string);
    const userRole: Role =
      (ROLE_PRIORITY.find((r) => userRoles.includes(r)) as Role | undefined) ?? "student";

    // -----------------------------------------------------------------
    // Body parsing (after auth so we never spend CPU on unauthenticated
    // requests).
    // -----------------------------------------------------------------
    const body = (await req.json()) as {
      messages?: Array<{ role: string; content: string }>;
      mascotName?: string;
      mascotGender?: string;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const mascotName = typeof body.mascotName === "string" && body.mascotName.length > 0
      ? body.mascotName
      : "Salci";
    const mascotGender = body.mascotGender === "spark" ? "spark" : "calm";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Personality based on gender
    const personality = mascotGender === "spark"
      ? "You are energetic, enthusiastic, and use emojis frequently. You're analytical and love breaking down problems. Your tone is upbeat and motivating with phrases like 'Let's go!', 'You've got this!', 'Here's the scoop!'"
      : "You are calm, patient, and reassuring. You use a gentle, supportive tone. You're encouraging without being overwhelming. Your phrases include 'Take your time', 'No worries', 'I'm here to help'.";

    // Role-specific knowledge
    const roleKnowledge: Record<Role, string> = {
      student: `
- Dashboard: View performance metrics, upcoming exams, recent results
- Exams: See assigned exams, attempt them during exam windows
- Results: View published results with detailed breakdowns
- Reports: Access performance analytics and AI-generated study tips
- Study Materials: Browse materials by subject and topic
- Rechecks: Request re-evaluation of answers if needed`,
      teacher: `
- Dashboard: See pending evaluations, class performance
- Create Exam: Use the wizard to create exams with AI question generation
- Evaluations: Review and grade student answers with AI assistance
- Scan Sheets: Upload and process offline exam answer sheets
- Tasks: Manage assigned tasks and submit evidence
- Reports: Access class and student analytics`,
      school_admin: `
- Dashboard: School-wide overview and AI recommendations
- Classes: Manage classes, sections, assign teachers and students
- Teachers/Students: Manage staff and student records
- Subjects: Configure school subjects and topic mappings
- Analytics: Deep dive into school performance metrics
- Tasks: Create and assign tasks to staff`,
      super_school_admin: `
- Same as school_admin, plus cross-school operations within your group
- Manage admins, configure features per school, oversee multiple campuses`,
      coordinator: `
- Dashboard: Wing-level performance and tasks
- Analytics: Compare classes, identify trends
- Tasks: Manage and track task completion
- Reports: Generate wing performance reports`,
      employee: `
- Dashboard: Your assigned tasks and HR info
- Tasks: View and complete assignments`,
      super_admin: `
- Institutions: Create and manage schools
- Users: Manage all users across institutions
- Syllabus: Manage universal grade/subject/topic structure
- Question Bank: Curate global question repository
- AI Quota: Monitor and configure AI usage limits
- Payments: Track subscriptions and billing`,
    };

    const systemPrompt = `You are ${mascotName}, a friendly AI assistant for the SALCI examination portal.

${personality}

You help users navigate and use the portal effectively. Your role is to:
1. Answer questions about how to use SALCI features
2. Guide users to the right pages/features
3. Explain concepts in simple terms
4. Be encouraging and supportive

User's role: ${userRole}
Available features for this role:
${roleKnowledge[userRole]}

Important guidelines:
- Keep responses concise (2-3 sentences max unless explaining a process)
- Use the portal terminology correctly
- If you don't know something, say so honestly
- For navigation, describe where to click in the sidebar
- Never make up features that don't exist`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-6), // Keep last 6 messages for context
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI service temporarily unavailable");
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message?.content || "I'm not sure how to help with that. Try asking differently!";

    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Mascot chat error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
