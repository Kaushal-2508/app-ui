import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PerformanceData {
  class_id: string;
  class_name: string;
  subject_id?: string;
  subject_name?: string;
  avg_score: number;
  total_students: number;
  students_below_50: number;
  trend: "improving" | "declining" | "stable";
}

interface SuggestedTask {
  title: string;
  description: string;
  task_type: string;
  priority: number;
  source_type: string;
  source_data: Record<string, unknown>;
  suggested_assignee?: string;
  wing_id?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse request
    const { institution_id, principal_id } = await req.json();

    if (!institution_id || !principal_id) {
      return new Response(
        JSON.stringify({ error: "Missing institution_id or principal_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Generating task suggestions for principal: ${principal_id}, institution: ${institution_id}`);

    const suggestions: SuggestedTask[] = [];

    // 1. Check for classes with low performance (below 50% average)
    const { data: classPerformance, error: perfError } = await supabase
      .from("class_aggregates")
      .select(`
        class_id,
        avg_score_percent,
        students_attempted,
        students_passed,
        total_students,
        subject_name,
        classes!inner(name, institution_id)
      `)
      .eq("classes.institution_id", institution_id)
      .lt("avg_score_percent", 50)
      .order("avg_score_percent", { ascending: true })
      .limit(5);

    if (!perfError && classPerformance && classPerformance.length > 0) {
      for (const perf of classPerformance) {
        const className = (perf as any).classes?.name || "Unknown Class";
        const failRate = perf.total_students > 0 
          ? Math.round(((perf.total_students - perf.students_passed) / perf.total_students) * 100)
          : 0;

        suggestions.push({
          title: `Review ${className} Performance`,
          description: `${className} has an average score of ${Math.round(perf.avg_score_percent)}% with ${failRate}% students below passing marks. Consider scheduling a review meeting with the class teacher.`,
          task_type: "academic_content",
          priority: perf.avg_score_percent < 40 ? 3 : 2,
          source_type: "performance",
          source_data: {
            class_id: perf.class_id,
            class_name: className,
            avg_score: perf.avg_score_percent,
            students_failed: perf.total_students - perf.students_passed,
            total_students: perf.total_students,
          },
        });
      }
    }

    // 2. Check for pending evaluations (exams with no finalized results)
    const { data: pendingExams, error: examError } = await supabase
      .from("exams")
      .select(`
        id,
        title,
        scheduled_date,
        created_by,
        profiles:created_by(id, full_name)
      `)
      .eq("institution_id", institution_id)
      .eq("status", "completed")
      .order("scheduled_date", { ascending: true })
      .limit(5);

    if (!examError && pendingExams) {
      for (const exam of pendingExams) {
        // Check if there are unfinalized attempts
        const { count: unfinalizedCount } = await supabase
          .from("student_exam_attempts")
          .select("id", { count: "exact", head: true })
          .eq("exam_id", exam.id)
          .eq("is_submitted", true)
          .eq("is_finalized", false);

        if (unfinalizedCount && unfinalizedCount > 0) {
          const teacherName = (exam as any).profiles?.full_name || "Unknown Teacher";
          const teacherId = (exam as any).profiles?.id;
          
          suggestions.push({
            title: `Follow Up on "${exam.title}" Evaluation`,
            description: `${unfinalizedCount} student attempts are pending evaluation for "${exam.title}". Follow up with ${teacherName} to complete grading.`,
            task_type: "exam_related",
            priority: 2,
            source_type: "evaluation",
            source_data: {
              exam_id: exam.id,
              exam_title: exam.title,
              pending_count: unfinalizedCount,
              teacher_name: teacherName,
            },
            suggested_assignee: teacherId,
          });
        }
      }
    }

    // 3. Check for concept mastery issues (topics with low mastery across class)
    const { data: lowMastery, error: masteryError } = await supabase
      .from("concept_mastery")
      .select(`
        topic_id,
        student_id,
        mastery_level,
        syllabus_topics!inner(name)
      `)
      .eq("institution_id", institution_id)
      .lt("mastery_level", 40)
      .limit(100);

    if (!masteryError && lowMastery && lowMastery.length > 0) {
      // Group by topic
      const topicCounts = new Map<string, { name: string; count: number }>();
      for (const m of lowMastery) {
        const topicId = m.topic_id;
        const topicName = (m as any).syllabus_topics?.name || "Unknown Topic";
        if (!topicCounts.has(topicId)) {
          topicCounts.set(topicId, { name: topicName, count: 0 });
        }
        topicCounts.get(topicId)!.count++;
      }

      // Create suggestions for topics with 5+ struggling students
      for (const [topicId, { name, count }] of topicCounts) {
        if (count >= 5) {
          suggestions.push({
            title: `Plan Remedial Session for "${name}"`,
            description: `${count} students have low mastery (below 40%) in "${name}". Consider organizing a remedial session or additional study materials.`,
            task_type: "student_support",
            priority: count >= 10 ? 3 : 2,
            source_type: "mastery",
            source_data: {
              topic_id: topicId,
              topic_name: name,
              students_struggling: count,
            },
          });
        }
      }
    }

    // 4. Check for teachers with no recent activity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: inactiveTeachers, error: inactiveError } = await supabase
      .from("user_roles")
      .select(`
        user_id,
        profiles:user_id(full_name, email)
      `)
      .eq("institution_id", institution_id)
      .eq("role", "teacher")
      .limit(20);

    if (!inactiveError && inactiveTeachers) {
      for (const teacher of inactiveTeachers) {
        // Check if teacher has created any exams recently
        const { count: recentExams } = await supabase
          .from("exams")
          .select("id", { count: "exact", head: true })
          .eq("created_by", teacher.user_id)
          .gte("created_at", thirtyDaysAgo.toISOString());

        if (recentExams === 0) {
          const teacherName = (teacher as any).profiles?.full_name || "Unknown Teacher";
          
          suggestions.push({
            title: `Check In with ${teacherName}`,
            description: `${teacherName} has not created any exams in the last 30 days. Consider a check-in to understand if they need support.`,
            task_type: "administrative",
            priority: 1,
            source_type: "activity",
            source_data: {
              teacher_id: teacher.user_id,
              teacher_name: teacherName,
              days_inactive: 30,
            },
            suggested_assignee: teacher.user_id,
          });
        }
      }
    }

    // Limit to top 10 suggestions, prioritized by priority
    suggestions.sort((a, b) => b.priority - a.priority);
    const topSuggestions = suggestions.slice(0, 10);

    // Clear old pending suggestions for this principal
    await supabase
      .from("ai_suggested_tasks")
      .delete()
      .eq("suggested_for", principal_id)
      .eq("status", "pending");

    // Insert new suggestions
    if (topSuggestions.length > 0) {
      const { error: insertError } = await supabase
        .from("ai_suggested_tasks")
        .insert(
          topSuggestions.map((s) => ({
            institution_id,
            suggested_for: principal_id,
            suggested_assignee: s.suggested_assignee || null,
            wing_id: s.wing_id || null,
            title: s.title,
            description: s.description,
            task_type: s.task_type,
            priority: s.priority,
            source_type: s.source_type,
            source_data: s.source_data,
            status: "pending",
          }))
        );

      if (insertError) {
        console.error("Error inserting suggestions:", insertError);
        throw insertError;
      }
    }

    console.log(`Generated ${topSuggestions.length} task suggestions`);

    return new Response(
      JSON.stringify({
        success: true,
        count: topSuggestions.length,
        suggestions: topSuggestions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating task suggestions:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
