// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const PAGE_SIZE = 500;

async function fetchAllPages<T>(
  fetcher: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetcher(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // @ts-expect-error Deno.env
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // @ts-expect-error Deno.env
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Use service role for all operations — this function runs as an orchestrator
  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify caller
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return json({ error: "Missing auth" }, 401);

  const { data: userRes } = await supabase.auth.getUser(token);
  const userId = userRes.user?.id;
  if (!userId) return json({ error: "Forbidden" }, 403);

  let jobId: string | undefined;

  try {
    const body = (await req.json()) as { job_id: string; oly_school_id: string };
    const { job_id, oly_school_id } = body;

    if (!job_id || !oly_school_id) return json({ error: "Missing job_id or oly_school_id" }, 400);
    jobId = job_id;

    // Verify caller is school_admin or super_admin
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      supabase.rpc("oly_is_school_admin_for", { p_uid: userId, p_oly_school_id: oly_school_id }),
      supabase.rpc("is_super_admin", { user_id: userId }),
    ]);
    if (!isAdmin && !isSuper) return json({ error: "Forbidden" }, 403);

    // Helper to update job status
    const updateJob = async (patch: Record<string, unknown>) => {
      await supabase
        .from("oly_publish_jobs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", job_id);
    };

    // ── Re-entry guard: claim the job atomically ───────────────────────────────
    // The claim also returns the run's scope (class-wise / batch-wise publish);
    // null scope = whole-school final publish.
    const { data: claimed, error: claimErr } = await supabase
      .from("oly_publish_jobs")
      .update({ status: "computing_ranks", started_at: new Date().toISOString() })
      .eq("id", job_id)
      .eq("status", "queued")
      .select("id, scope_grade_level_ids, scope_batch_ids")
      .maybeSingle();
    if (claimErr) return json({ error: `Job claim failed: ${claimErr.message}` }, 500);
    if (!claimed) {
      // Another orchestrator instance already claimed this job, or job is in a non-queued state
      return json({ ok: true, already_running: true }, 200);
    }

    // ── STEP 1: Compute ranks (idempotent; scoped runs merge-re-rank the rest) ─
    const { error: rankErr } = await supabase.rpc("oly_publish_compute_ranks", {
      p_oly_school_id: oly_school_id,
      p_grade_level_ids: claimed.scope_grade_level_ids ?? null,
      p_batch_ids: claimed.scope_batch_ids ?? null,
    });
    if (rankErr) throw new Error(`Rank computation failed: ${rankErr.message}`);

    // ── STEP 2: Generate PDFs (batch of 10 in parallel) ────────────────────────
    await updateJob({ status: "generating_pdfs" });

    // @ts-expect-error Deno.env
    const internalSecret = Deno.env.get("OLY_INTERNAL_SECRET");
    if (!internalSecret) {
      throw new Error("OLY_INTERNAL_SECRET not configured — orchestrator cannot invoke child functions");
    }
    const childHeaders = { "x-internal-secret": internalSecret };

    // Paginate result fetch — PostgREST silently caps at 1000 rows (§23.1).
    const allResults = await fetchAllPages<{
      id: string;
      result_pdf_path: string | null;
      certificate_pdf_path: string | null;
      certificate_tier: string;
    }>((from, to) =>
      supabase
        .from("oly_results")
        .select("id, result_pdf_path, certificate_pdf_path, certificate_tier")
        .eq("oly_school_id", oly_school_id)
        .range(from, to),
    );

    // Reset counters so re-runs start clean (Fix 3: avoid counter overshoot)
    await updateJob({ total_students: allResults.length, processed_students: 0 });

    let totalProcessed = 0;
    let totalFailures = 0;
    const failureMessages: string[] = [];

    for (let i = 0; i < allResults.length; i += BATCH_SIZE) {
      const chunk = allResults.slice(i, i + BATCH_SIZE);

      // For each result: invoke PDF generators only if not already generated
      const tasks = chunk.flatMap((r: {
        id: string;
        result_pdf_path: string | null;
        certificate_pdf_path: string | null;
        certificate_tier: string;
      }) => {
        const t: Promise<unknown>[] = [];

        if (!r.result_pdf_path) {
          t.push(
            supabase.functions.invoke("oly-generate-result-pdf", {
              body: { oly_result_id: r.id },
              headers: childHeaders,
            })
          );
        }

        // Skip certificate generation for absent students
        if (!r.certificate_pdf_path && r.certificate_tier !== "absent") {
          t.push(
            supabase.functions.invoke("oly-generate-certificate-pdf", {
              body: { oly_result_id: r.id },
              headers: childHeaders,
            })
          );
        }

        return t;
      });

      const settled = await Promise.allSettled(tasks);

      // Count successes/failures at the task level (Fix 3 + Fix 5)
      let chunkSuccessTasks = 0;
      for (const r of settled) {
        if (r.status === "fulfilled") {
          chunkSuccessTasks++;
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          failureMessages.push(msg);
        }
      }
      // Each student has up to 2 tasks (result PDF + cert PDF); use ceiling to map tasks → students
      const tasksPerChunk = tasks.length;
      const chunkStudents = chunk.length;
      // Approximate successful students: scale by success ratio over the chunk
      const chunkSuccessStudents = tasksPerChunk > 0
        ? Math.round(chunkStudents * (chunkSuccessTasks / tasksPerChunk))
        : chunkStudents;
      const chunkFailStudents = chunkStudents - chunkSuccessStudents;

      totalProcessed += chunkSuccessStudents;
      totalFailures += chunkFailStudents;

      await updateJob({ processed_students: totalProcessed, failed_students: totalFailures });
    }

    // ── STEP 3: Send emails (batch of 10 in parallel) ─────────────────────────
    await updateJob({ status: "sending_emails" });

    const toEmail = await fetchAllPages<{ id: string }>((from, to) =>
      supabase
        .from("oly_results")
        .select("id")
        .eq("oly_school_id", oly_school_id)
        .is("emailed_at", null)
        .range(from, to),
    );

    for (let i = 0; i < toEmail.length; i += BATCH_SIZE) {
      const chunk = toEmail.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        chunk.map((r: { id: string }) =>
          supabase.functions.invoke("oly-send-results-email", {
            body: { oly_result_id: r.id },
            headers: childHeaders,
          })
        )
      );
    }

    // ── STEP 4: Create Passport entries for SALCI students ────────────────────
    // Keep status='sending_emails' through this step (no new enum value per §5a).
    // Each invocation is idempotent on (student_id, oly_result_id).
    type SalciResultRow = { id: string; oly_students: unknown };
    const salciResults = await fetchAllPages<SalciResultRow>((from, to) =>
      supabase
        .from("oly_results")
        .select("id, oly_students!oly_student_id ( profile_id )")
        .eq("oly_school_id", oly_school_id)
        .range(from, to),
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[oly-publish-school-results] passport fetch failed", msg);
      return [] as SalciResultRow[];
    });

    const passportTasks: Promise<unknown>[] = [];
    for (const r of salciResults) {
      const studentRaw = r.oly_students;
      const student = Array.isArray(studentRaw) ? studentRaw[0] : studentRaw;
      const profileId = (student as { profile_id?: string | null } | null)?.profile_id;
      if (!profileId) continue;
      passportTasks.push(
        supabase.functions
          .invoke("oly-create-passport-entry", {
            body: { oly_result_id: r.id },
            headers: childHeaders,
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              `[oly-publish-school-results] passport entry failed for ${r.id}`,
              msg,
            );
          }),
      );
    }
    await Promise.allSettled(passportTasks);

    // ── DONE ──────────────────────────────────────────────────────────────────
    const doneUpdate: Record<string, unknown> = {
      status: "completed",
      completed_at: new Date().toISOString(),
    };
    if (totalFailures > 0) {
      doneUpdate.failed_students = totalFailures;
      doneUpdate.failure_details = JSON.stringify(failureMessages.slice(0, 50));
    }
    await updateJob(doneUpdate);

    return json({ ok: true, job_id }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (jobId) {
      const supabaseRetry = createClient(supabaseUrl, serviceKey);
      await supabaseRetry
        .from("oly_publish_jobs")
        .update({ status: "failed", error: msg, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    }
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
