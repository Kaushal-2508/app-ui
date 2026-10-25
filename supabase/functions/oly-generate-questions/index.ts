// @ts-expect-error Deno runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-expect-error Deno runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { generateCompletion, AiProviderError } from "../_shared/aiProvider.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Repair unescaped LaTeX backslashes in raw JSON before JSON.parse. Models emit
// "\frac{1}{x}" inside JSON strings, where \f/\t/\b become control chars and
// destroy the LaTeX. Walk the JSON; inside string literals, double any
// backslash that starts a LaTeX command. (Identical logic to generate-questions.)
function repairLatexEscapes(json: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === "\\" && i + 1 < json.length) {
      const next = json[i + 1];
      if (next === "\\" || next === '"' || next === "/") {
        out += ch + next;
        i += 2;
        continue;
      }
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) {
        out += json.slice(i, i + 6);
        i += 6;
        continue;
      }
      if (["b", "f", "n", "r", "t"].includes(next)) {
        const after = json[i + 2];
        if (after && /[a-zA-Z]/.test(after)) {
          out += "\\\\" + next;
          i += 2;
          continue;
        }
        out += ch + next;
        i += 2;
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        out += "\\\\" + next;
        i += 2;
        continue;
      }
      out += ch + next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

type GenQuestion = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "A" | "B" | "C" | "D";
};

const LETTERS = ["A", "B", "C", "D"] as const;

function sanitizeQuestion(raw: unknown): GenQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const text = typeof q.question_text === "string" ? q.question_text.trim() : "";
  const a = typeof q.option_a === "string" ? q.option_a.trim() : "";
  const b = typeof q.option_b === "string" ? q.option_b.trim() : "";
  const c = typeof q.option_c === "string" ? q.option_c.trim() : "";
  const d = typeof q.option_d === "string" ? q.option_d.trim() : "";
  let correct = typeof q.correct_answer === "string" ? q.correct_answer.trim().toUpperCase() : "";
  // Tolerate "a"/"b"/"option a"/"1".. and map to letter.
  if (correct.startsWith("OPTION")) correct = correct.replace(/OPTION\s*/i, "").trim();
  if (["1", "2", "3", "4"].includes(correct)) correct = LETTERS[Number(correct) - 1];
  if (!text || !a || !b || !c || !d) return null;
  if (!LETTERS.includes(correct as "A")) return null;
  return {
    question_text: text,
    option_a: a,
    option_b: b,
    option_c: c,
    option_d: d,
    correct_answer: correct as "A" | "B" | "C" | "D",
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    // @ts-expect-error Deno.env
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-expect-error Deno.env
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Question bank is super-admin-only — verify the caller.
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes } = await supabase.auth.getUser(token);
    const userId = userRes.user?.id;
    if (!userId) return json({ error: "Forbidden" }, 403);
    const { data: isSuper, error: roleErr } = await supabase.rpc("is_super_admin", { user_id: userId });
    if (roleErr) return json({ error: roleErr.message }, 400);
    if (!isSuper) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as {
      subject_id?: string;
      grade_level_id?: string;
      topic_id?: string | null;
      count?: number;
      focus?: string;
    };
    const subjectId = body.subject_id;
    const gradeLevelId = body.grade_level_id;
    const topicId = body.topic_id || null;
    const count = Math.max(1, Math.min(15, Math.floor(Number(body.count) || 5)));
    const focus = (body.focus || "").trim().slice(0, 500);
    if (!subjectId || !gradeLevelId) {
      return json({ error: "subject_id and grade_level_id are required" }, 400);
    }

    // Resolve names for the prompt.
    const { data: subjectRow } = await supabase
      .from("oly_subjects")
      .select("name")
      .eq("id", subjectId)
      .maybeSingle();
    const subjectName = (subjectRow as { name?: string } | null)?.name ?? "General Knowledge";

    const { data: gradeRow } = await supabase
      .from("grade_levels")
      .select("grade_name, grade_number")
      .eq("id", gradeLevelId)
      .maybeSingle();
    const gradeName = (gradeRow as { grade_name?: string } | null)?.grade_name ?? "General";

    let topicName: string | null = null;
    if (topicId) {
      const { data: topicRow } = await supabase
        .from("oly_topics")
        .select("name")
        .eq("id", topicId)
        .maybeSingle();
      topicName = (topicRow as { name?: string } | null)?.name ?? null;
    }

    const isLanguage = /english|hindi|sanskrit|language/i.test(subjectName);
    const mathHint = isLanguage
      ? "This is a language subject — questions test grammar, vocabulary, comprehension or literature; mathematical notation is usually not needed."
      : "When a question involves any mathematical/scientific expression, you MUST typeset it in KaTeX: inline $...$ and display $$...$$ (e.g. $\\frac{a}{b}$, $x^{2}$, $\\sqrt{x}$, $\\text{H}_2\\text{O}$, $90^\\circ$). Plain-text math is a hard fail.";

    const systemPrompt = `You are an expert question-paper setter for the SALCI Olympiad — a competitive school olympiad. You write rigorous, single-correct-answer multiple-choice questions (MCQs) calibrated to the grade level, at the difficulty of a strong olympiad / competitive exam (clearly harder than a routine class test, but fair for the grade). Every MCQ has exactly four options with exactly one correct answer; the three distractors are plausible and built from common student misconceptions, never random.

${mathHint}

Return ONLY valid JSON in EXACTLY this shape (no markdown, no commentary):
{
  "questions": [
    {
      "question_text": "the question",
      "option_a": "first option",
      "option_b": "second option",
      "option_c": "third option",
      "option_d": "fourth option",
      "correct_answer": "A"
    }
  ]
}
Rules:
- correct_answer is exactly one of "A","B","C","D" — the letter of the correct option.
- Vary which letter is correct across the set (do not make them all "A").
- Generate EXACTLY the requested number of questions. No duplicates. No commentary outside the JSON.`;

    const userPrompt = `Generate EXACTLY ${count} olympiad MCQ${count === 1 ? "" : "s"}.

Subject: ${subjectName}
Grade: ${gradeName}
${topicName ? `Topic to focus on: ${topicName}` : "Cover a representative spread of topics for this subject and grade."}
${focus ? `Extra instructions from the setter: ${focus}` : ""}

Respond with the JSON object described above containing exactly ${count} questions.`;

    let content: string;
    try {
      const completion = await generateCompletion({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
        maxTokens: Math.min(8000, 700 + count * 420),
        responseFormat: "json",
      });
      content = completion.content;
    } catch (err) {
      if (err instanceof AiProviderError && err.status === 429) {
        return json({ error: "AI rate limit hit. Please try again in a moment." }, 429);
      }
      if (err instanceof AiProviderError) {
        return json({ error: err.message }, 502);
      }
      throw err;
    }

    let parsed: unknown;
    try {
      const match =
        content.match(/```json\n?([\s\S]*?)\n?```/) ||
        content.match(/```\n?([\s\S]*?)\n?```/) ||
        [null, content];
      const jsonStr = (match[1] || content).trim();
      parsed = JSON.parse(repairLatexEscapes(jsonStr));
    } catch (_e) {
      return json({ error: "The AI returned an unreadable response. Please try again." }, 502);
    }

    const rawList: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { questions?: unknown[] })?.questions)
        ? (parsed as { questions: unknown[] }).questions
        : [];

    const questions = rawList
      .map(sanitizeQuestion)
      .filter((q): q is GenQuestion => q !== null)
      .slice(0, count);

    if (questions.length === 0) {
      return json({ error: "The AI did not return any usable questions. Please try again." }, 502);
    }

    return json({ questions }, 200);
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
