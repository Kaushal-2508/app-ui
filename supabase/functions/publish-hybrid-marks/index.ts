// Publish hybrid exam marks for a single attempt.
//
// Input  (JSON body): { attempt_id: string }
// Auth: caller must be a teacher assigned to the attempt's class (via
//   class_assignments) OR a coordinator / school admin / super admin of
//   the institution.
//
// Validation:
//   - Attempt status must be 'pending_evaluation' or 'evaluated' (re-publish
//     is allowed; useful for corrections).
//   - Every non-passage question in the exam must have a row in
//     hybrid_question_marks with marks_awarded NOT NULL.
//
// Action:
//   - Aggregate total_marks_awarded + total_max_marks from
//     hybrid_question_marks.
//   - Update hybrid_exam_attempts: status='evaluated', evaluated_at=now,
//     evaluated_by=caller, total_marks_awarded, total_max_marks.
//   - Insert a notification for the student.
//   - Log 'marks_published'.
//
// Note: deliberately does NOT touch final_results — hybrid results live on
// the hybrid_* data plane and Phase 5 reads them directly.
//
// Output: { attempt_id, total_marks_awarded, total_max_marks, status }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ExamSectionRow {
  exam_questions: Array<{
    id: string;
    parent_question_id: string | null;
    marks: number | null;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "Missing Authorization header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return jsonResponse(500, { error: "Supabase env vars missing" });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResult, error: userError } = await userClient.auth.getUser();
    if (userError || !userResult?.user) {
      return jsonResponse(401, { error: "Unauthenticated" });
    }
    const userId = userResult.user.id;

    const body = await req.json().catch(() => ({}));
    const attemptId = body?.attempt_id as string | undefined;
    if (!attemptId) {
      return jsonResponse(400, { error: "attempt_id is required" });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: attempt, error: attemptError } = await admin
      .from("hybrid_exam_attempts")
      .select(
        "id, exam_id, student_id, class_id, institution_id, status",
      )
      .eq("id", attemptId)
      .single();
    if (attemptError || !attempt) {
      return jsonResponse(404, { error: "Attempt not found" });
    }

    // Only publish once the upload window has closed (student finalized or the
    // cron moved the attempt to pending_evaluation). Re-publish of an already
    // evaluated attempt stays allowed for corrections.
    if (
      attempt.status !== "pending_evaluation" &&
      attempt.status !== "evaluated"
    ) {
      return jsonResponse(409, { error: `Cannot publish from status "${attempt.status}"` });
    }

    const { data: examRow, error: examError } = await admin
      .from("exams")
      .select("total_marks")
      .eq("id", attempt.exam_id)
      .single();
    if (examError || !examRow) {
      return jsonResponse(404, { error: "Exam not found" });
    }
    const examTotal =
      examRow.total_marks === null || examRow.total_marks === undefined
        ? null
        : Number(examRow.total_marks);

    // ── Authorization ────────────────────────────────────────────────
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    const roles = (roleRows ?? []).map((r) => r.role);
    const isSuperAdmin = roles.includes("super_admin");
    const isInstitutionAdmin =
      !isSuperAdmin &&
      (roles.includes("school_admin") ||
        roles.includes("super_school_admin") ||
        roles.includes("coordinator"));

    let allowed = isSuperAdmin;

    if (!allowed && isInstitutionAdmin) {
      // Must belong to the attempt's institution.
      const { data: profile } = await admin
        .from("profiles")
        .select("institution_id")
        .eq("id", userId)
        .single();
      allowed = profile?.institution_id === attempt.institution_id;
    }

    if (!allowed && roles.includes("teacher")) {
      const { data: assignments } = await admin
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", userId)
        .eq("class_id", attempt.class_id);
      allowed = (assignments?.length ?? 0) > 0;
    }

    if (!allowed) {
      return jsonResponse(403, { error: "You don't have permission to publish this attempt" });
    }

    // ── Validate: every gradeable question has marks ─────────────────
    const { data: sectionRows, error: sectionsError } = await admin
      .from("exam_sections")
      .select(`exam_questions ( id, parent_question_id, marks )`)
      .eq("exam_id", attempt.exam_id);
    if (sectionsError) {
      return jsonResponse(500, { error: sectionsError.message });
    }

    const allQuestions = (sectionRows ?? []).flatMap(
      (s) => (s as ExamSectionRow).exam_questions ?? [],
    );
    // Treat parents-with-subs as passages (not directly graded). Find which
    // parents have subs, then exclude those parents.
    const parentIdsWithSubs = new Set(
      allQuestions
        .map((q) => q.parent_question_id)
        .filter((id): id is string => !!id),
    );
    // Exclude parents-with-subs (passages) AND standalone 0-mark questions —
    // the client treats marks<=0 as non-gradeable, so the server must match or
    // publish dead-ends on a question the teacher cannot mark.
    const gradeableIds = allQuestions
      .filter((q) => !parentIdsWithSubs.has(q.id) && Number(q.marks) > 0)
      .map((q) => q.id);

    if (gradeableIds.length === 0) {
      return jsonResponse(409, { error: "Exam has no gradeable questions" });
    }

    const { data: markRows, error: marksError } = await admin
      .from("hybrid_question_marks")
      .select("question_id, marks_awarded, max_marks")
      .eq("attempt_id", attempt.id);
    if (marksError) {
      return jsonResponse(500, { error: marksError.message });
    }

    const marksByQuestion = new Map(
      (markRows ?? []).map((m) => [m.question_id, m]),
    );
    const missing: string[] = [];
    const overMax: string[] = [];
    let totalAwarded = 0;
    let summedMax = 0;
    for (const qid of gradeableIds) {
      const m = marksByQuestion.get(qid);
      if (!m || m.marks_awarded === null || m.marks_awarded === undefined) {
        missing.push(qid);
      } else {
        const awarded = Number(m.marks_awarded);
        const max = Number(m.max_marks);
        if (awarded > max) overMax.push(qid);
        totalAwarded += awarded;
        summedMax += max;
      }
    }
    if (missing.length > 0) {
      return jsonResponse(400, {
        error: `${missing.length} question${missing.length === 1 ? "" : "s"} are still un-marked.`,
        missing_question_ids: missing,
      });
    }
    if (overMax.length > 0) {
      return jsonResponse(400, {
        error: `${overMax.length} question${overMax.length === 1 ? "" : "s"} exceed their maximum marks.`,
        over_max_question_ids: overMax,
      });
    }
    // total_max_marks is the exam's configured total (source of truth), falling
    // back to the summed per-question max if the exam has no total set.
    const totalMax = examTotal ?? summedMax;
    if (examTotal !== null && totalAwarded > examTotal) {
      return jsonResponse(400, {
        error: `Total awarded (${totalAwarded}) exceeds the exam total of ${examTotal}.`,
      });
    }

    // ── Update attempt ───────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const { error: updateError } = await admin
      .from("hybrid_exam_attempts")
      .update({
        status: "evaluated",
        evaluated_at: nowIso,
        evaluated_by: userId,
        total_marks_awarded: totalAwarded,
        total_max_marks: totalMax,
      })
      .eq("id", attempt.id);
    if (updateError) {
      return jsonResponse(500, { error: updateError.message });
    }

    // ── Audit log ────────────────────────────────────────────────────
    admin
      .from("hybrid_exam_attempt_logs")
      .insert({
        attempt_id: attempt.id,
        institution_id: attempt.institution_id,
        event_type: "marks_published",
        actor_id: userId,
        event_payload: {
          total_marks_awarded: totalAwarded,
          total_max_marks: totalMax,
        },
      })
      .then(() => {})
      .catch(() => {});

    // ── Notify student (fire-and-forget) ─────────────────────────────
    admin
      .from("notifications")
      .insert({
        user_id: attempt.student_id,
        type: "exam_evaluated",
        title: "Your hybrid exam has been marked",
        message: `Your teacher has finished marking. ${totalAwarded.toFixed(2)} / ${totalMax.toFixed(2)} awarded.`,
        link: `/student/hybrid-result/${attempt.id}`,
        metadata: {
          attempt_id: attempt.id,
          exam_id: attempt.exam_id,
        },
      })
      .then(() => {})
      .catch(() => {});

    return jsonResponse(200, {
      attempt_id: attempt.id,
      total_marks_awarded: totalAwarded,
      total_max_marks: totalMax,
      status: "evaluated",
    });
  } catch (err) {
    return jsonResponse(500, { error: (err as Error).message ?? "Unknown error" });
  }
});
