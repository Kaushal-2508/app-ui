import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LearningActionPayload {
  attempt_id: string;
  exam_id: string;
  student_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
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
    const callerUserId = claimsData.claims.sub as string;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // === ROLE CHECK: teacher/coordinator/admin ===
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUserId)
      .in("role", ["super_admin", "super_school_admin", "school_admin", "teacher", "coordinator"])
      .limit(1)
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: insufficient role" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { attempt_id, exam_id, student_id }: LearningActionPayload = await req.json();
    
    console.log("Generating learning actions for:", { attempt_id, exam_id, student_id });
    
    if (!attempt_id || !exam_id || !student_id) {
      throw new Error("Missing required parameters: attempt_id, exam_id, student_id");
    }

    // Get student profile for institution_id
    const { data: studentProfile, error: profileError } = await supabase
      .from("profiles")
      .select("institution_id")
      .eq("id", student_id)
      .single();
    
    if (profileError || !studentProfile?.institution_id) {
      throw new Error("Could not find student institution");
    }

    const institutionId = studentProfile.institution_id;

    // Get attempt with class info
    const { data: attempt, error: attemptError } = await supabase
      .from("student_exam_attempts")
      .select("class_id")
      .eq("id", attempt_id)
      .single();
    
    if (attemptError) {
      throw new Error("Could not find attempt: " + attemptError.message);
    }

    // Get exam subjects and topics
    const { data: examTopics } = await supabase
      .from("exam_topics")
      .select(`topic_id, syllabus_topics!inner(id, topic_name, subject_id)`)
      .eq("exam_id", exam_id);

    const { data: examSubjects } = await supabase
      .from("exam_subjects")
      .select("subject_id")
      .eq("exam_id", exam_id);

    // Get all answers for this attempt
    const { data: answers, error: answersError } = await supabase
      .from("student_answers")
      .select(`id, question_id, exam_questions!inner(id, question_type, marks, section_id, tags)`)
      .eq("attempt_id", attempt_id);

    if (answersError) {
      throw new Error("Could not fetch student answers");
    }

    const answerIds = answers?.map(a => a.id) || [];
    const { data: overrides } = await supabase
      .from("teacher_overrides")
      .select("answer_id, final_marks, max_marks")
      .in("answer_id", answerIds.length > 0 ? answerIds : ['no-answers']);

    let totalMarks = 0;
    let obtainedMarks = 0;

    for (const answer of answers || []) {
      const override = overrides?.find(o => o.answer_id === answer.id);
      if (override) {
        totalMarks += override.max_marks;
        obtainedMarks += override.final_marks;
      }
    }

    const overallPercentage = totalMarks > 0 ? (obtainedMarks / totalMarks) * 100 : 0;
    console.log(`Performance: ${obtainedMarks}/${totalMarks} = ${overallPercentage.toFixed(1)}%`);

    const learningActions: Array<{
      student_id: string;
      institution_id: string;
      class_id: string | null;
      action_type: string;
      title: string;
      description: string;
      topic_id: string | null;
      subject_id: string | null;
      priority: number;
      source: string;
      source_exam_id: string;
      status: string;
      metadata: Record<string, unknown>;
    }> = [];

    if (overallPercentage < 40) {
      learningActions.push({
        student_id, institution_id: institutionId, class_id: attempt?.class_id || null,
        action_type: "revision", title: "Critical Review Required",
        description: `Your score was ${overallPercentage.toFixed(1)}%. A comprehensive review is strongly recommended.`,
        topic_id: examTopics?.[0]?.topic_id || null, subject_id: examSubjects?.[0]?.subject_id || null,
        priority: 1, source: "auto", source_exam_id: exam_id, status: "pending",
        metadata: { score_percentage: overallPercentage, total_marks: totalMarks, obtained_marks: obtainedMarks, generated_at: new Date().toISOString() },
      });
      learningActions.push({
        student_id, institution_id: institutionId, class_id: attempt?.class_id || null,
        action_type: "retest", title: "Schedule Retest",
        description: `After completing your revision, please schedule a retest.`,
        topic_id: examTopics?.[0]?.topic_id || null, subject_id: examSubjects?.[0]?.subject_id || null,
        priority: 2, source: "auto", source_exam_id: exam_id, status: "pending",
        metadata: { score_percentage: overallPercentage, prerequisite_action: "revision", generated_at: new Date().toISOString() },
      });
    } else if (overallPercentage < 60) {
      learningActions.push({
        student_id, institution_id: institutionId, class_id: attempt?.class_id || null,
        action_type: "practice", title: "Additional Practice Recommended",
        description: `Your score was ${overallPercentage.toFixed(1)}%. Practice more to strengthen understanding.`,
        topic_id: examTopics?.[0]?.topic_id || null, subject_id: examSubjects?.[0]?.subject_id || null,
        priority: 2, source: "auto", source_exam_id: exam_id, status: "pending",
        metadata: { score_percentage: overallPercentage, total_marks: totalMarks, obtained_marks: obtainedMarks, generated_at: new Date().toISOString() },
      });
    } else if (overallPercentage < 80) {
      learningActions.push({
        student_id, institution_id: institutionId, class_id: attempt?.class_id || null,
        action_type: "study_material", title: "Enhance Your Knowledge",
        description: `Your score was ${overallPercentage.toFixed(1)}%. Review suggested material for excellence.`,
        topic_id: examTopics?.[0]?.topic_id || null, subject_id: examSubjects?.[0]?.subject_id || null,
        priority: 3, source: "auto", source_exam_id: exam_id, status: "pending",
        metadata: { score_percentage: overallPercentage, total_marks: totalMarks, obtained_marks: obtainedMarks, generated_at: new Date().toISOString() },
      });
    }

    if (learningActions.length > 0) {
      const { data: insertedActions, error: insertError } = await supabase
        .from("learning_actions")
        .insert(learningActions)
        .select();

      if (insertError) throw new Error("Failed to create learning actions: " + insertError.message);

      console.log(`Created ${insertedActions?.length || 0} learning actions`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Generated ${insertedActions?.length || 0} learning actions`,
          actions: insertedActions,
          performance: { percentage: overallPercentage, obtained: obtainedMarks, total: totalMarks },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "No learning actions needed - excellent performance!",
        performance: { percentage: overallPercentage, obtained: obtainedMarks, total: totalMarks },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in generate-learning-actions:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
