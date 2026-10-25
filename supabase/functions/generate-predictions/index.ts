import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { classPredictions, studentPredictions, teacherTrends, subjectForecasts, scoreBuckets } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are an educational analytics AI. Analyze school performance data and provide predictions with actionable insights. Be concise and specific. Focus on identifying patterns, at-risk areas, and concrete interventions.`;

    const userPrompt = `Analyze this school performance data and provide enhanced predictions:

CLASS PREDICTIONS (current vs predicted averages):
${JSON.stringify(classPredictions?.slice(0, 10), null, 1)}

AT-RISK STUDENTS (declining trajectory):
${JSON.stringify(studentPredictions?.slice(0, 10), null, 1)}

TEACHER TRENDS:
${JSON.stringify(teacherTrends?.slice(0, 10), null, 1)}

SUBJECT FORECASTS:
${JSON.stringify(subjectForecasts?.slice(0, 10), null, 1)}

SCORE DISTRIBUTION: ${JSON.stringify(scoreBuckets)}

Provide enhanced predictions using the return_predictions tool.`;

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
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_predictions",
              description: "Return structured prediction results with reasoning",
              parameters: {
                type: "object",
                properties: {
                  classes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        classId: { type: "string" },
                        predictedAvg: { type: "number" },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                        reasoning: { type: "string" },
                      },
                      required: ["classId", "predictedAvg", "confidence", "reasoning"],
                    },
                  },
                  atRiskStudents: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        studentId: { type: "string" },
                        predictedScore: { type: "number" },
                        riskFactors: { type: "array", items: { type: "string" } },
                        suggestion: { type: "string" },
                      },
                      required: ["studentId", "predictedScore", "riskFactors", "suggestion"],
                    },
                  },
                  teacherInsights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        teacherId: { type: "string" },
                        trend: { type: "string" },
                        recommendation: { type: "string" },
                      },
                      required: ["teacherId", "trend", "recommendation"],
                    },
                  },
                  subjectAlerts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        subjectId: { type: "string" },
                        riskLevel: { type: "string", enum: ["stable", "watch", "decline"] },
                        reasoning: { type: "string" },
                        intervention: { type: "string" },
                      },
                      required: ["subjectId", "riskLevel", "reasoning", "intervention"],
                    },
                  },
                  overallOutlook: { type: "string" },
                  confidenceScore: { type: "number" },
                },
                required: ["classes", "atRiskStudents", "teacherInsights", "subjectAlerts", "overallOutlook", "confidenceScore"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_predictions" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call returned from AI");

    const predictions = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(predictions), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-predictions error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
