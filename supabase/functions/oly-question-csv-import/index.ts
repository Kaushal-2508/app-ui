// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  rows: Array<{
    subject_id: string;
    grade_level_id: string;
    topic_id: string | null;
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_answer: "A" | "B" | "C" | "D";
  }>;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing auth" }, 401);
    }

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify caller is super_admin via token
    const token = authHeader.replace("Bearer ", "");
    const userResult = await supabase.auth.getUser(token);
    const userId = userResult.data.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);

    const { data: roleCheck, error: roleErr } = await supabase.rpc(
      "is_super_admin",
      { user_id: userId },
    );
    if (roleErr) return json({ error: roleErr.message }, 400);
    if (!roleCheck) return json({ error: "Forbidden" }, 403);

    const { rows } = (await req.json()) as Payload;
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "No rows provided" }, 400);
    }
    if (rows.length > 500) {
      return json({ error: "Maximum 500 rows per import" }, 400);
    }

    const insertRows = rows.map((r) => ({
      subject_id: r.subject_id,
      grade_level_id: r.grade_level_id,
      topic_id: r.topic_id,
      question_text: r.question_text,
      option_a: r.option_a,
      option_b: r.option_b,
      option_c: r.option_c,
      option_d: r.option_d,
      correct_answer: r.correct_answer,
      status: "active" as const,
    }));

    const { data, error } = await supabase
      .from("oly_questions")
      .insert(insertRows)
      .select("id");

    if (error) return json({ error: error.message }, 400);

    return json({ inserted_count: (data as Array<{ id: string }>)?.length ?? 0 }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
