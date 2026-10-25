import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting task notification check...");

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split("T")[0];
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    // 1. Find tasks with approaching deadlines (due tomorrow)
    const { data: approachingTasks, error: approachingError } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        due_date,
        status,
        task_assignments!inner (
          assignee_id,
          assigner_id,
          supervisor_id
        )
      `)
      .eq("status", "in_progress")
      .gte("due_date", todayStr)
      .lte("due_date", tomorrowStr);

    if (approachingError) {
      console.error("Error fetching approaching tasks:", approachingError);
    } else {
      console.log(`Found ${approachingTasks?.length || 0} tasks with approaching deadlines`);

      for (const task of approachingTasks || []) {
        const assignment = task.task_assignments[0];
        if (!assignment) continue;

        // Send reminder to assignee
        await supabase.from("notifications").insert([{
          user_id: assignment.assignee_id,
          type: "task_reminder",
          title: "Task Due Tomorrow",
          message: `Your task "${task.title}" is due tomorrow. Please complete it on time.`,
          link: "/tasks",
          metadata: { task_id: task.id },
        }]);

        console.log(`Sent reminder for task: ${task.id}`);
      }
    }

    // 2. Find overdue tasks
    const { data: overdueTasks, error: overdueError } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        due_date,
        status,
        task_assignments!inner (
          assignee_id,
          assigner_id,
          supervisor_id
        )
      `)
      .in("status", ["open", "in_progress"])
      .lt("due_date", todayStr);

    if (overdueError) {
      console.error("Error fetching overdue tasks:", overdueError);
    } else {
      console.log(`Found ${overdueTasks?.length || 0} overdue tasks`);

      for (const task of overdueTasks || []) {
        const assignment = task.task_assignments[0];
        if (!assignment) continue;

        // Notify assignee
        await supabase.from("notifications").insert([{
          user_id: assignment.assignee_id,
          type: "task_overdue",
          title: "Task Overdue",
          message: `Your task "${task.title}" is overdue. Please complete it as soon as possible.`,
          link: "/tasks",
          metadata: { task_id: task.id },
        }]);

        // Notify assigner (escalation)
        await supabase.from("notifications").insert([{
          user_id: assignment.assigner_id,
          type: "task_escalation",
          title: "Task Overdue - Escalation",
          message: `Task "${task.title}" assigned by you is overdue.`,
          link: "/tasks",
          metadata: { task_id: task.id },
        }]);

        // Notify supervisor if exists
        if (assignment.supervisor_id) {
          await supabase.from("notifications").insert([{
            user_id: assignment.supervisor_id,
            type: "task_escalation",
            title: "Task Overdue - Supervisor Alert",
            message: `Task "${task.title}" you are supervising is overdue.`,
            link: "/tasks",
            metadata: { task_id: task.id },
          }]);
        }

        console.log(`Sent overdue notifications for task: ${task.id}`);
      }
    }

    // 3. Find tasks submitted for approval (notify assigner)
    const { data: pendingApprovalTasks, error: pendingError } = await supabase
      .from("tasks")
      .select(`
        id,
        title,
        updated_at,
        task_assignments!inner (
          assigner_id
        )
      `)
      .eq("status", "done_pending_approval")
      .gte("updated_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString()); // Last hour

    if (pendingError) {
      console.error("Error fetching pending approval tasks:", pendingError);
    } else {
      console.log(`Found ${pendingApprovalTasks?.length || 0} recently submitted tasks`);

      for (const task of pendingApprovalTasks || []) {
        const assignment = task.task_assignments[0];
        if (!assignment) continue;

        // Check if notification already sent
        const { data: existingNotif } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", assignment.assigner_id)
          .eq("type", "task_submitted")
          .contains("metadata", { task_id: task.id })
          .single();

        if (!existingNotif) {
          await supabase.from("notifications").insert([{
            user_id: assignment.assigner_id,
            type: "task_submitted",
            title: "Task Submitted for Approval",
            message: `Task "${task.title}" has been submitted and awaits your approval.`,
            link: "/tasks",
            metadata: { task_id: task.id },
          }]);

          console.log(`Sent submission notification for task: ${task.id}`);
        }
      }
    }

    console.log("Task notification check completed");

    // 4. Find exams starting within the next hour (exam reminders)
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const { data: upcomingExams, error: examError } = await supabase
      .from("exams")
      .select(`
        id,
        title,
        start_time,
        exam_classes (
          class_id
        )
      `)
      .eq("status", "published")
      .gte("start_time", now.toISOString())
      .lte("start_time", oneHourFromNow.toISOString());

    if (examError) {
      console.error("Error fetching upcoming exams:", examError);
    } else {
      console.log(`Found ${upcomingExams?.length || 0} exams starting within 1 hour`);

      for (const exam of upcomingExams || []) {
        const classIds = exam.exam_classes?.map((ec: any) => ec.class_id) || [];
        if (classIds.length === 0) continue;

        // Get students assigned to these classes
        const { data: students } = await supabase
          .from("class_assignments")
          .select("user_id")
          .in("class_id", classIds)
          .eq("role", "student");

        if (!students || students.length === 0) continue;

        const uniqueStudentIds = [...new Set(students.map((s: any) => s.user_id))];

        for (const studentId of uniqueStudentIds) {
          // Check if reminder already sent
          const { data: existingNotif } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", studentId)
            .eq("type", "exam_reminder")
            .contains("metadata", { exam_id: exam.id })
            .single();

          if (!existingNotif) {
            await supabase.from("notifications").insert([{
              user_id: studentId,
              type: "exam_reminder",
              title: "Exam Starting Soon",
              message: `Your exam "${exam.title}" starts within the next hour. Get ready!`,
              link: "/exams",
              metadata: { exam_id: exam.id },
            }]);
          }
        }

        console.log(`Sent exam reminders for exam: ${exam.id}`);
      }
    }

    console.log("All notification checks completed successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Notifications sent successfully",
        stats: {
          approaching: approachingTasks?.length || 0,
          overdue: overdueTasks?.length || 0,
          pendingApproval: pendingApprovalTasks?.length || 0,
          examReminders: upcomingExams?.length || 0,
        }
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in send-task-notifications:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
