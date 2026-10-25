import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ROLES = new Set([
  "super_admin",
  "super_school_admin",
  "school_admin",
  "coordinator",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth + role gate (previously anonymous; anyone with the URL could
    // burn Lovable AI credits).
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
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .limit(10);
    const allowed = (roleRows ?? []).some((r) => ALLOWED_ROLES.has(r.role as string));
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { metrics, classPerformance, teacherData, subjectRisks } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a school analytics AI assistant for a principal. Given school performance data, generate actionable insights. Return structured data via the provided tool.`;

    const userPrompt = `Analyze this school data:
School Average: ${metrics.schoolAverage}%, Total Students: ${metrics.totalStudents}, Classes: ${metrics.totalClasses}, Pass Rate: ${metrics.passRate}%

Class Performance: ${JSON.stringify(classPerformance)}
Teacher Data: ${JSON.stringify(teacherData)}
Subject Risks: ${JSON.stringify(subjectRisks)}

Generate:
1. Executive summary with health score (0-100), trend (improving/stable/declining), and 3-5 key findings
2. Intervention priorities (entities needing attention with severity 1-10 and impact 1-10)
3. 4-6 recommended actions with priority (urgent/high/medium), expected impact (0-100%), assignee, and timeline
4. Forecasts: predicted average, predicted at-risk count, and subjects likely to decline`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_insights",
              description: "Return structured school analytics insights",
              parameters: {
                type: "object",
                properties: {
                  executiveSummary: {
                    type: "object",
                    properties: {
                      healthScore: { type: "number" },
                      trend: { type: "string", enum: ["improving", "stable", "declining"] },
                      keyFindings: { type: "array", items: { type: "string" } },
                    },
                    required: ["healthScore", "trend", "keyFindings"],
                  },
                  interventions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        entity: { type: "string" },
                        type: { type: "string" },
                        severity: { type: "number" },
                        impact: { type: "number" },
                        description: { type: "string" },
                      },
                      required: ["entity", "type", "severity", "impact", "description"],
                    },
                  },
                  actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        assignTo: { type: "string" },
                        priority: { type: "string", enum: ["urgent", "high", "medium"] },
                        expectedImpact: { type: "number" },
                        timeline: { type: "string" },
                      },
                      required: ["title", "assignTo", "priority", "expectedImpact", "timeline"],
                    },
                  },
                  forecasts: {
                    type: "object",
                    properties: {
                      predictedAvg: { type: "number" },
                      predictedAtRisk: { type: "number" },
                      decliningSubjects: { type: "array", items: { type: "string" } },
                    },
                    required: ["predictedAvg", "predictedAtRisk", "decliningSubjects"],
                  },
                },
                required: ["executiveSummary", "interventions", "actions", "forecasts"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "provide_insights" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const insights = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(insights), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
