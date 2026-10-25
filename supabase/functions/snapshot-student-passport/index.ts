// Capture each student's current academic record + per-subject capability into
// the passport_* history tables for a given academic_year. Run before year-end
// promotions so historical data survives class reassignments.
//
// 2026-05-25 fix: the previous student fetch did `user_roles.select("user_id")
// .eq("role","student")` with no institution filter, which silently capped at
// Supabase's default 1000 rows (we have 2160 student rows globally). It then
// inlined those 1000 UUIDs into a `profiles.in("id", [...])` filter that built
// a ~38 KB URL — rejected by the edge proxy as 500. The institution filter
// has to live on user_roles, not on profiles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Surface every meaningful field of a Supabase / PostgREST error. The previous
// `error instanceof Error ? error.message : "Unknown error"` swallowed every
// PostgrestError (those are plain objects, not Error subclasses).
function formatError(err: unknown, step: string): string {
  if (err instanceof Error) return `${step}: ${err.message}`;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [
      e.message ? String(e.message) : null,
      e.code ? `code=${e.code}` : null,
      e.details ? `details=${e.details}` : null,
      e.hint ? `hint=${e.hint}` : null,
    ].filter(Boolean);
    if (parts.length) return `${step}: ${parts.join(" | ")}`;
  }
  try {
    return `${step}: ${JSON.stringify(err)}`;
  } catch {
    return `${step}: unprintable error`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let step = "init";
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    step = "parse_body";
    const { institution_id, academic_year } = await req.json();
    if (!institution_id) {
      return new Response(JSON.stringify({ error: "institution_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const currentYear =
      academic_year ||
      `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;

    // ─── Students for THIS institution ───────────────────────────────
    // Filter on user_roles.institution_id directly (canonical). Avoids the
    // 1000-row global cap and the URL-length blow-up the previous code hit.
    step = "fetch_students";
    const { data: studentRoles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("user_id, profiles!user_roles_user_id_fkey(id, full_name)")
      .eq("role", "student")
      .eq("institution_id", institution_id);
    if (rolesErr) throw rolesErr;

    type RoleRow = { user_id: string; profiles: { id: string; full_name: string } | null };
    const seen = new Set<string>();
    const students: { id: string; full_name: string }[] = [];
    for (const r of (studentRoles ?? []) as RoleRow[]) {
      if (!r.profiles) continue;
      if (seen.has(r.profiles.id)) continue;
      seen.add(r.profiles.id);
      students.push({ id: r.profiles.id, full_name: r.profiles.full_name });
    }

    if (students.length === 0) {
      return new Response(
        JSON.stringify({ message: "No students found", processed: 0, total: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    const studentErrors: { student_id: string; error: string }[] = [];

    for (const student of students) {
      try {
        // Class assignment (most recent — student may have multiple historical rows)
        const { data: classAssignment, error: caErr } = await supabase
          .from("class_assignments")
          .select("class_id, classes(name, section, academic_year)")
          .eq("user_id", student.id)
          .eq("role", "student")
          .limit(1)
          .maybeSingle();
        if (caErr) throw caErr;

        const cls = (classAssignment?.classes as
          | { name?: string; section?: string | null; academic_year?: string }
          | null) ?? null;
        const className = cls?.name ?? "Unknown";
        const sectionName = cls?.section ?? null;
        const classId = classAssignment?.class_id ?? null;

        // Performance snapshots
        const { data: snapshots, error: snapErr } = await supabase
          .from("student_performance_snapshots")
          .select(
            "attempt_id, accuracy_percent, total_questions, questions_correct, snapshot_at",
          )
          .eq("student_id", student.id);
        if (snapErr) throw snapErr;

        type Snap = {
          attempt_id: string;
          accuracy_percent: number | null;
          total_questions: number | null;
          questions_correct: number | null;
          snapshot_at: string | null;
        };
        const snaps: Snap[] = (snapshots ?? []) as Snap[];

        const totalExams = snaps.length;
        const examsWithPass = snaps.filter((s) => (s.accuracy_percent ?? 0) >= 40).length;
        const avgPercentage =
          totalExams > 0
            ? snaps.reduce((sum, s) => sum + (s.accuracy_percent ?? 0), 0) / totalExams
            : 0;
        const highestPercentage =
          totalExams > 0
            ? Math.max(...snaps.map((s) => s.accuracy_percent ?? 0))
            : 0;

        // Badges earned approximation
        const { count: badgesCount, error: bpErr } = await supabase
          .from("badge_progress")
          .select("id", { count: "exact", head: true })
          .eq("user_id", student.id)
          .gte("current_value", 1);
        if (bpErr) throw bpErr;

        // Passport points
        const { data: passport, error: passportErr } = await supabase
          .from("student_passport")
          .select("total_points")
          .eq("student_id", student.id)
          .maybeSingle();
        if (passportErr) throw passportErr;

        // Upsert academic record
        const { error: arUpsertErr } = await supabase
          .from("passport_academic_records")
          .upsert(
            {
              student_id: student.id,
              institution_id,
              academic_year: currentYear,
              class_name: className,
              section_name: sectionName,
              class_id: classId,
              total_exams: totalExams,
              exams_passed: examsWithPass,
              average_percentage: Math.round(avgPercentage * 100) / 100,
              highest_percentage: Math.round(highestPercentage * 100) / 100,
              total_points_earned: passport?.total_points ?? 0,
              badges_earned: badgesCount ?? 0,
            },
            { onConflict: "student_id,academic_year" },
          );
        if (arUpsertErr) throw arUpsertErr;

        // Per-subject performance via student_exam_attempts → exams → exam_subjects
        const { data: attempts, error: attemptsErr } = await supabase
          .from("student_exam_attempts")
          .select(
            "id, exam_id, exams(exam_subjects(subject_id, universal_subjects(id, name)))",
          )
          .eq("student_id", student.id)
          .eq("is_submitted", true);
        if (attemptsErr) throw attemptsErr;

        type AttemptRow = {
          id: string;
          exam_id: string;
          exams: {
            exam_subjects?: {
              subject_id: string;
              universal_subjects?: { id: string; name: string } | null;
            }[];
          } | null;
        };

        const subjectMap: Record<
          string,
          { name: string; snapshots: Snap[]; subjectId: string }
        > = {};
        for (const attempt of (attempts ?? []) as AttemptRow[]) {
          const examSubjects = attempt.exams?.exam_subjects ?? [];
          const snapshot = snaps.find((s) => s.attempt_id === attempt.id);
          if (!snapshot) continue;
          for (const es of examSubjects) {
            const subId = es.subject_id;
            const subName = es.universal_subjects?.name ?? "Unknown";
            if (!subjectMap[subId]) {
              subjectMap[subId] = { name: subName, snapshots: [], subjectId: subId };
            }
            subjectMap[subId].snapshots.push(snapshot);
          }
        }

        // Concept mastery for strongest/weakest topics. syllabus_topics
        // exposes the topic name as `topic_name` (not `name` — that was the
        // original bug that 500'd the function for every student).
        const { data: conceptMastery, error: cmErr } = await supabase
          .from("concept_mastery")
          .select("subject_id, topic_id, mastery_level, syllabus_topics(topic_name)")
          .eq("student_id", student.id)
          .eq("institution_id", institution_id);
        if (cmErr) throw cmErr;

        type CmRow = {
          subject_id: string;
          topic_id: string;
          mastery_level: number | null;
          syllabus_topics: { topic_name: string } | null;
        };

        // Upsert subject capabilities
        for (const [subjectId, subData] of Object.entries(subjectMap)) {
          const totalQ = subData.snapshots.reduce(
            (s, snap) => s + (snap.total_questions ?? 0),
            0,
          );
          const correctQ = subData.snapshots.reduce(
            (s, snap) => s + (snap.questions_correct ?? 0),
            0,
          );
          const accuracy = totalQ > 0 ? (correctQ / totalQ) * 100 : 0;
          const mastery = Math.min(100, Math.round(accuracy));

          let capabilityTier = "developing";
          if (accuracy >= 85) capabilityTier = "expert";
          else if (accuracy >= 65) capabilityTier = "proficient";
          else if (accuracy >= 40) capabilityTier = "competent";

          const subjectTopics = ((conceptMastery ?? []) as CmRow[]).filter(
            (c) => c.subject_id === subjectId,
          );
          const sortedTopics = [...subjectTopics].sort(
            (a, b) => (b.mastery_level ?? 0) - (a.mastery_level ?? 0),
          );
          const strongestTopics = sortedTopics
            .slice(0, 3)
            .map((t) => t.syllabus_topics?.topic_name ?? "Unknown");
          const weakestTopics = sortedTopics
            .slice(-3)
            .reverse()
            .map((t) => t.syllabus_topics?.topic_name ?? "Unknown");

          // Append year_wise_data — read existing, dedupe by year, push current.
          const { data: existing, error: existErr } = await supabase
            .from("passport_subject_capabilities")
            .select("year_wise_data")
            .eq("student_id", student.id)
            .eq("subject_id", subjectId)
            .maybeSingle();
          if (existErr) throw existErr;

          type YearEntry = {
            year: string;
            exams: number;
            accuracy: number;
            mastery: number;
            class_name: string;
          };
          const existingYearData = ((existing?.year_wise_data as YearEntry[]) ?? []).filter(
            (y) => y.year !== currentYear,
          );
          existingYearData.push({
            year: currentYear,
            exams: subData.snapshots.length,
            accuracy: Math.round(accuracy * 10) / 10,
            mastery,
            class_name: className,
          });

          const lastExamDate =
            subData.snapshots.length > 0
              ? subData.snapshots
                  .map((s) => s.snapshot_at)
                  .filter((d): d is string => !!d)
                  .sort()
                  .pop() ?? null
              : null;

          const { error: scUpsertErr } = await supabase
            .from("passport_subject_capabilities")
            .upsert(
              {
                student_id: student.id,
                institution_id,
                subject_id: subjectId,
                subject_name: subData.name,
                total_exams: subData.snapshots.length,
                total_questions: totalQ,
                correct_answers: correctQ,
                accuracy_percent: Math.round(accuracy * 10) / 10,
                mastery_level: mastery,
                capability_tier: capabilityTier,
                strongest_topics: strongestTopics,
                weakest_topics: weakestTopics,
                year_wise_data: existingYearData,
                last_exam_date: lastExamDate,
              },
              { onConflict: "student_id,subject_id" },
            );
          if (scUpsertErr) throw scUpsertErr;
        }

        processed++;
      } catch (studentErr) {
        // Capture but continue. Reported in the response so callers know what
        // failed instead of silently dropping rows.
        const msg = formatError(studentErr, `student=${student.id}`);
        console.error(msg);
        studentErrors.push({ student_id: student.id, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        message: `Snapshot complete for ${currentYear}`,
        processed,
        total: students.length,
        failed: studentErrors.length,
        // Only return the first few error messages so the response stays small.
        errors: studentErrors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = formatError(error, step);
    console.error("Snapshot error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
