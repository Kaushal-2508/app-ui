import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { attemptId } = await req.json();
    if (!attemptId) {
      return new Response(JSON.stringify({ error: "attemptId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch attempt data with results
    const { data: attempt, error: attemptError } = await supabase
      .from("student_exam_attempts")
      .select(`
        id,
        student_id,
        exam_id,
        time_spent_seconds,
        student:profiles!student_id(full_name),
        exam:exams!exam_id(title)
      `)
      .eq("id", attemptId)
      .single();

    if (attemptError || !attempt) {
      throw new Error("Attempt not found");
    }

    // Extract nested data safely
    const studentData = Array.isArray(attempt.student) ? attempt.student[0] : attempt.student;
    const examData = Array.isArray(attempt.exam) ? attempt.exam[0] : attempt.exam;

    // Get final result
    const { data: result } = await supabase
      .from("final_results")
      .select("*")
      .eq("attempt_id", attemptId)
      .single();

    if (!result) {
      throw new Error("Result not published yet");
    }

    // Get section scores (handle both array and object formats)
    const rawSectionScores = result.section_scores;
    const sectionScores: Array<{
      section_name: string;
      marks_obtained: number;
      max_marks: number;
    }> = Array.isArray(rawSectionScores) ? rawSectionScores : [];

    // Determine strengths and focus areas
    const strengths = sectionScores
      .filter((s) => s.max_marks > 0 && (s.marks_obtained / s.max_marks) * 100 >= 70)
      .map((s) => s.section_name);

    const focusAreas = sectionScores
      .filter((s) => s.max_marks > 0 && (s.marks_obtained / s.max_marks) * 100 < 60)
      .map((s) => s.section_name);

    // Generate AI insights using Lovable AI
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    let studyTips = [];
    let actionPlan = { keepUp: [], improve: [] };
    let motivationalMessage = "";

    if (LOVABLE_API_KEY) {
      const prompt = `You are a supportive educational AI assistant. Based on this student's exam performance, provide personalized study tips.

Student: ${studentData?.full_name || "Student"}
Exam: ${examData?.title || "Exam"}
Score: ${result.percentage?.toFixed(1)}%
Passed: ${result.is_pass ? "Yes" : "No"}
Strong subjects: ${strengths.join(", ") || "None identified"}
Weak subjects: ${focusAreas.join(", ") || "None - all good!"}

Provide a JSON response with:
1. studyTips: Array of 3-4 tips, each with "tip" (actionable advice), "reason" (why this helps), "priority" ("high"/"medium"/"low")
2. actionPlan: { keepUp: [things doing well], improve: [specific actions] }
3. motivationalMessage: A short encouraging message for the student

Be encouraging and constructive. Focus on growth mindset.`;

      try {
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "You are a helpful educational AI. Always respond with valid JSON." },
              { role: "user", content: prompt },
            ],
            temperature: 0.7,
          }),
          // Student-facing results path — bound the AI call so a hung gateway
          // degrades to the no-tips fallback instead of stalling (§23.14).
          signal: AbortSignal.timeout(30_000),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || "";
          
          // Parse JSON from response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            studyTips = parsed.studyTips || [];
            actionPlan = parsed.actionPlan || { keepUp: [], improve: [] };
            motivationalMessage = parsed.motivationalMessage || "";
          }
        }
      } catch (aiError) {
        console.error("AI generation error:", aiError);
      }
    }

    // Fallback messages if AI didn't work
    if (!motivationalMessage) {
      if (result.percentage >= 90) {
        motivationalMessage = "Outstanding work! You're a shining star! Keep reaching for the sky! 🌟";
      } else if (result.percentage >= 70) {
        motivationalMessage = "Great job! Your hard work is paying off. Keep pushing forward! 💪";
      } else if (result.percentage >= 50) {
        motivationalMessage = "Good effort! Every step forward is progress. You're on the right track! 🚀";
      } else {
        motivationalMessage = "Don't give up! With practice and dedication, you'll get there. We believe in you! 📚";
      }
    }

    // Determine performance level
    let performanceLevel = "good";
    if (result.percentage >= 90) performanceLevel = "excellent";
    else if (result.percentage >= 75) performanceLevel = "very_good";
    else if (result.percentage >= 60) performanceLevel = "good";
    else if (result.percentage >= 40) performanceLevel = "needs_improvement";
    else performanceLevel = "critical";

    // Save insights to database
    const { error: insertError } = await supabase.from("exam_insights").upsert({
      attempt_id: attemptId,
      student_id: attempt.student_id,
      exam_id: attempt.exam_id,
      overall_performance: `${result.percentage?.toFixed(1)}%`,
      performance_level: performanceLevel,
      strengths: strengths,
      focus_areas: focusAreas,
      study_tips: studyTips,
      action_plan: actionPlan,
      subject_breakdown: sectionScores,
      motivational_message: motivationalMessage,
      generated_at: new Date().toISOString(),
    }, { onConflict: "attempt_id" });

    if (insertError) {
      console.error("Insert error:", insertError);
      throw insertError;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error generating insights:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
