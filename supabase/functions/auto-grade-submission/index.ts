import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Two option shapes exist in prod: the legacy letter map {a,b,c,d} and the
// mobile exam-creation flow's array [{id, text, isCorrect}] where student
// answers store the selected option id (e.g. "opt-1784119546970-16").
interface ArrayOption {
  id?: string | number;
  text?: string;
  isCorrect?: boolean;
}

interface QuestionData {
  id: string;
  question_type: string;
  question_text: string;
  correct_answer: string | null;
  marks: number;
  options: { a?: string; b?: string; c?: string; d?: string } | ArrayOption[] | null;
  tags: string[] | null;
}

interface AnswerData {
  id: string;
  question_id: string;
  answer_text: string | null;
  answer_options: { selected?: string } | null;
}

interface AIGradingResult {
  marks_awarded: number;
  max_marks: number;
  confidence: number;
  feedback: string;
  reasoning: string;
  matched_concepts: string[];
  missed_concepts: string[];
}

function cleanMCQAnswer(
  raw: string,
  options: { a?: string; b?: string; c?: string; d?: string } | null
): string {
  if (!raw) return "";
  const text = raw.trim().toLowerCase();
  const letterMatch = text.match(/^[\(\[\s]*([a-d])[\)\]\.\s]*$/);
  if (letterMatch) return letterMatch[1];
  if (text === "true" || text === "t") return "true";
  if (text === "false" || text === "f") return "false";
  if (options) {
    const opts = options as Record<string, string>;
    for (const [letter, optionText] of Object.entries(opts)) {
      if (typeof optionText !== "string" || !optionText) continue;
      const optLower = optionText.toLowerCase().trim();
      if (text === optLower || optLower.includes(text) || text.includes(optLower)) return letter;
    }
  }
  const prefixMatch = text.match(/^([a-d])[)\].\s:]+/);
  if (prefixMatch) return prefixMatch[1];
  return text;
}

// Resolve a raw student selection (option id, option text, bare letter, or
// true/false word) to an index in an array-shaped options list; -1 = unmatched.
function resolveArrayOptionIndex(options: ArrayOption[], raw: string): number {
  if (!raw) return -1;
  let idx = options.findIndex((o) => o && o.id != null && String(o.id) === raw);
  if (idx >= 0) return idx;
  const norm = raw.trim().toLowerCase();
  if (!norm) return -1;
  idx = options.findIndex(
    (o) => String(o?.text ?? "").trim().toLowerCase() === norm
  );
  if (idx >= 0) return idx;
  const letterMatch = norm.match(/^[\(\[\s]*([a-z])[\)\]\.\s]*$/);
  if (letterMatch) {
    const li = letterMatch[1].charCodeAt(0) - 97;
    if (li >= 0 && li < options.length) return li;
  }
  return -1;
}

// The correct option is the one flagged isCorrect. For rows without any flag,
// correct_answer matching an option id or exact text is still authoritative,
// but a bare-letter POSITION guess is not (on array-shaped rows the letter has
// no defined mapping) — callers must route letter-guess grades to review.
function findCorrectOptionIndex(
  options: ArrayOption[],
  correctAnswer: string | null
): { idx: number; viaLetterGuess: boolean } {
  const flagged = options.findIndex((o) => o?.isCorrect === true);
  if (flagged >= 0) return { idx: flagged, viaLetterGuess: false };
  const raw = (correctAnswer || "").trim();
  if (!raw) return { idx: -1, viaLetterGuess: false };
  let idx = options.findIndex((o) => o && o.id != null && String(o.id) === raw);
  if (idx < 0) {
    const norm = raw.toLowerCase();
    idx = options.findIndex(
      (o) => String(o?.text ?? "").trim().toLowerCase() === norm
    );
  }
  if (idx >= 0) return { idx, viaLetterGuess: false };
  const letterMatch = raw.toLowerCase().match(/^[\(\[\s]*([a-z])[\)\]\.\s]*$/);
  if (letterMatch) {
    const li = letterMatch[1].charCodeAt(0) - 97;
    if (li >= 0 && li < options.length) return { idx: li, viaLetterGuess: true };
  }
  return { idx: -1, viaLetterGuess: false };
}

async function evaluateSubjectiveWithAI(
  questionText: string,
  questionType: string,
  studentAnswer: string,
  correctAnswer: string | null,
  maxMarks: number,
  keywords: string[],
  apiKey: string
): Promise<AIGradingResult> {
  const systemPrompt = `You are an expert exam evaluator. You grade student answers fairly and precisely.

RULES:
- Award marks based on conceptual accuracy, completeness, and relevance
- Be generous for correct concepts even if wording differs
- Deduct for factual errors, not for grammar or style
- For short_answer: focus on key facts and precision
- For long_answer: also consider structure, depth, and examples
- For case_study/comprehension: evaluate understanding and application
- Always provide constructive feedback
- Return ONLY the JSON object, no extra text`;

  const keywordsInfo = keywords.length > 0 ? `\nExpected keywords/concepts: ${keywords.join(", ")}` : "";
  const modelAnswerInfo = correctAnswer ? `\nModel/Reference answer: ${correctAnswer}` : "";

  const userPrompt = `Evaluate this ${questionType.replace("_", " ")} answer.

Question (${maxMarks} marks): ${questionText}
${modelAnswerInfo}
${keywordsInfo}

Student's Answer: ${studentAnswer}

Return a JSON object with these exact fields:
{
  "marks_awarded": <number between 0 and ${maxMarks}>,
  "max_marks": ${maxMarks},
  "confidence": <number between 0 and 1>,
  "feedback": "<constructive feedback for the student>",
  "reasoning": "<internal reasoning for the marks awarded>",
  "matched_concepts": [<list of key concepts the student covered>],
  "missed_concepts": [<list of key concepts the student missed>]
}`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
    }),
    // This runs once per subjective answer inside the grading loop — a hung
    // gateway call must fail fast, not stall the whole attempt's grading
    // until the edge runtime wall limit (§23.14).
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`AI gateway error [${response.status}]:`, errorText);
    if (response.status === 429) throw new Error("AI rate limit exceeded. Please try again in a moment.");
    if (response.status === 402) throw new Error("AI credits exhausted. Please add credits in workspace settings.");
    throw new Error(`AI evaluation failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonStr) as AIGradingResult;
    parsed.marks_awarded = Math.max(0, Math.min(maxMarks, Math.round(parsed.marks_awarded * 100) / 100));
    parsed.max_marks = maxMarks;
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
    return parsed;
  } catch (parseErr) {
    console.error("Failed to parse AI response:", content);
    throw new Error("AI returned invalid response format");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { attempt_id } = await req.json();

    if (!attempt_id) {
      throw new Error("attempt_id is required");
    }

    // === ROLE CHECK (cheap pre-filter): caller must hold some staff role ===
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

    // Attribution is the AUTHENTICATED caller — never a client-supplied grader_id
    // (that would let evaluated_by be forged to an arbitrary UUID). The frontend
    // only ever passes its own user id anyway.
    const effectiveGraderId = callerUserId;

    console.log("Auto-grading attempt:", attempt_id, "caller:", callerUserId);

    // Get attempt details
    const { data: attempt, error: attemptError } = await supabase
      .from("student_exam_attempts")
      .select("id, exam_id, is_submitted, evaluation_status")
      .eq("id", attempt_id)
      .single();

    if (attemptError || !attempt) throw new Error("Attempt not found");
    if (!attempt.is_submitted) throw new Error("Cannot grade unsubmitted attempt");

    // === TENANT AUTHORIZATION: caller must own / administer / teach THIS exam ===
    // The role check above only proves the caller is staff *somewhere*; without
    // this, any staff account could grade another institution's attempt by id
    // (cross-tenant IDOR, security-audit H4). Runs on the service-role client,
    // so the caller id is passed explicitly (no auth.uid() here).
    const { data: canGrade, error: authzError } = await supabase.rpc("user_can_grade_exam", {
      _user_id: callerUserId,
      _exam_id: attempt.exam_id,
    });
    if (authzError) {
      console.error("Authorization check failed:", authzError);
      throw new Error("Authorization check failed");
    }
    if (!canGrade) {
      return new Response(
        JSON.stringify({ error: "Forbidden: not authorized for this exam" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get exam sections and questions
    const { data: sections, error: sectionsError } = await supabase
      .from("exam_sections")
      .select("id")
      .eq("exam_id", attempt.exam_id);

    if (sectionsError || !sections) throw new Error("Failed to fetch exam sections");

    const sectionIds = sections.map((s) => s.id);

    const { data: questions, error: questionsError } = await supabase
      .from("exam_questions")
      .select("id, question_type, question_text, correct_answer, marks, options, tags")
      .in("section_id", sectionIds);

    if (questionsError || !questions) throw new Error("Failed to fetch questions");

    const { data: answers, error: answersError } = await supabase
      .from("student_answers")
      .select("id, question_id, answer_text, answer_options")
      .eq("attempt_id", attempt_id);

    if (answersError) throw new Error("Failed to fetch answers");

    const questionMap = new Map<string, QuestionData>(
      questions.map((q) => [q.id, q as QuestionData])
    );

    let gradedCount = 0;
    let requiresReviewCount = 0;
    let aiGradedCount = 0;
    const canUseAI = !!lovableApiKey;

    for (const answer of (answers || []) as AnswerData[]) {
      const question = questionMap.get(answer.question_id);
      if (!question) continue;

      let suggestedMarks = 0;
      let confidence = 1.0;
      let requiresReview = false;
      let reasoning = "";
      let feedbackSuggestion = "";
      let matchedKeywords: string[] = [];
      let modelUsed = "auto_grader_v2";
      const questionType = question.question_type;

      try {
        if (questionType === "mcq" || questionType === "true_false") {
          const rawStudentAnswer = String(
            answer.answer_options?.selected ?? answer.answer_text ?? ""
          ).trim();

          if (Array.isArray(question.options)) {
            // Mobile exam-creation flow shape: [{id, text, isCorrect}] with the
            // student's selected option id in answer_options.selected.
            const opts = question.options;
            const selectedIdx = resolveArrayOptionIndex(opts, rawStudentAnswer);
            const { idx: correctIdx, viaLetterGuess } = findCorrectOptionIndex(
              opts,
              question.correct_answer
            );
            const correctText = correctIdx >= 0
              ? String(opts[correctIdx]?.text ?? "").trim() || (question.correct_answer || "")
              : (question.correct_answer || "");

            if (correctIdx < 0) {
              suggestedMarks = 0;
              confidence = 0;
              requiresReview = true;
              reasoning = "No correct option is marked on this question";
              feedbackSuggestion = "This question needs teacher review.";
            } else if (selectedIdx < 0) {
              suggestedMarks = 0;
              confidence = 0.5;
              requiresReview = true;
              reasoning = `Could not match the student's selection "${rawStudentAnswer}" to any option`;
              feedbackSuggestion = "This answer needs teacher review.";
            } else if (selectedIdx === correctIdx) {
              suggestedMarks = question.marks;
              confidence = 1.0;
              reasoning = "Correct answer selected";
              feedbackSuggestion = "✓ Correct!";
            } else {
              const selectedText = String(opts[selectedIdx]?.text ?? rawStudentAnswer).trim();
              suggestedMarks = 0;
              confidence = 1.0;
              reasoning = `Incorrect. Expected: ${correctText}, Got: ${selectedText}`;
              feedbackSuggestion = `✗ Incorrect. The correct answer was: ${correctText}`;
            }

            // The letter-position guess has no defined mapping on array-shaped
            // rows (isCorrect is the only ground truth) — never grade on it at
            // full confidence.
            if (viaLetterGuess && correctIdx >= 0 && selectedIdx >= 0) {
              requiresReview = true;
              confidence = Math.min(confidence, 0.6);
              reasoning += ". No option is flagged correct; matched correct_answer letter to option order (position guess)";
            }
          } else {
            // Legacy shape: options = {a, b, c, d} with a letter correct_answer.
            const correctAnswer = (question.correct_answer || "").toLowerCase().trim();
            const cleanedStudentAnswer = cleanMCQAnswer(rawStudentAnswer, question.options);

            if (cleanedStudentAnswer === correctAnswer) {
              suggestedMarks = question.marks;
              confidence = 1.0;
              reasoning = "Correct answer selected";
              feedbackSuggestion = "✓ Correct!";
            } else {
              suggestedMarks = 0;
              confidence = 1.0;
              reasoning = `Incorrect. Expected: ${correctAnswer}, Got: ${cleanedStudentAnswer}`;
              feedbackSuggestion = `✗ Incorrect. The correct answer was: ${correctAnswer}`;
            }
          }
        } else if (questionType === "fill_blank") {
          const studentAnswer = (answer.answer_text || "").toLowerCase().trim();
          const correctAnswer = (question.correct_answer || "").toLowerCase().trim();
          const acceptableAnswers = correctAnswer.split(",").map((a) => a.trim());

          if (acceptableAnswers.includes(studentAnswer)) {
            suggestedMarks = question.marks;
            confidence = 0.95;
            reasoning = "Correct answer provided";
            feedbackSuggestion = "✓ Correct!";
          } else {
            const partialMatch = acceptableAnswers.some(
              (a) => studentAnswer.includes(a) || a.includes(studentAnswer)
            );
            if (partialMatch && studentAnswer.length > 0) {
              suggestedMarks = Math.floor(question.marks * 0.5);
              confidence = 0.7;
              requiresReview = true;
              reasoning = "Partial match detected - needs review";
              feedbackSuggestion = "Partially correct. Please review the expected answer.";
            } else {
              suggestedMarks = 0;
              confidence = 0.9;
              requiresReview = true;
              reasoning = `Answer does not match expected: ${correctAnswer}`;
              feedbackSuggestion = `✗ The expected answer was: ${correctAnswer}`;
            }
          }
        } else if (
          (questionType === "short_answer" || questionType === "long_answer" ||
            questionType === "case_study" || questionType === "comprehension") && canUseAI
        ) {
          const studentAnswer = answer.answer_text || "";
          if (!studentAnswer.trim()) {
            suggestedMarks = 0;
            confidence = 1.0;
            reasoning = "No answer provided";
            feedbackSuggestion = "No answer was provided for this question.";
          } else {
            try {
              const aiResult = await evaluateSubjectiveWithAI(
                question.question_text, questionType, studentAnswer,
                question.correct_answer, question.marks, question.tags || [], lovableApiKey!
              );
              suggestedMarks = aiResult.marks_awarded;
              confidence = aiResult.confidence;
              requiresReview = aiResult.confidence < 0.7;
              reasoning = aiResult.reasoning;
              feedbackSuggestion = aiResult.feedback;
              matchedKeywords = aiResult.matched_concepts || [];
              modelUsed = "gemini-2.5-flash";
              aiGradedCount++;
            } catch (aiError) {
              console.error("AI grading failed, falling back to keywords:", aiError);
              const keywords = (question.correct_answer || "").toLowerCase().split(/[\s,;.]+/).filter((k) => k.length > 3);
              const answerLower = studentAnswer.toLowerCase();
              matchedKeywords = keywords.filter((k) => answerLower.includes(k));
              const matchRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;
              suggestedMarks = Math.round(question.marks * matchRatio * 0.7);
              confidence = 0.3 + matchRatio * 0.3;
              requiresReview = true;
              reasoning = `[Fallback] Keyword match: ${matchedKeywords.length}/${keywords.length} keywords found. AI unavailable.`;
              feedbackSuggestion = `${matchedKeywords.length}/${keywords.length} key concepts identified. Requires teacher review.`;
              modelUsed = "keyword_fallback";
            }
          }
        } else if (
          questionType === "short_answer" || questionType === "long_answer" ||
          questionType === "case_study" || questionType === "comprehension"
        ) {
          const studentAnswer = (answer.answer_text || "").toLowerCase();
          const correctAnswer = question.correct_answer || "";
          const keywords = correctAnswer.toLowerCase().split(/[\s,;.]+/).filter((k) => k.length > 3);
          matchedKeywords = keywords.filter((k) => studentAnswer.includes(k));
          const matchRatio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;
          suggestedMarks = Math.round(question.marks * matchRatio * 0.7);
          confidence = 0.3 + matchRatio * 0.3;
          requiresReview = true;
          reasoning = `Keyword match: ${matchedKeywords.length}/${keywords.length} keywords found. Requires teacher review.`;
          feedbackSuggestion = `${matchedKeywords.length}/${keywords.length} key concepts identified.`;
          modelUsed = "keyword_matching";
        } else {
          suggestedMarks = 0;
          confidence = 0;
          requiresReview = true;
          reasoning = "Unknown question type - requires manual evaluation";
          feedbackSuggestion = "This question type requires manual evaluation.";
        }
      } catch (gradingErr) {
        // One malformed answer/question must never fail the whole attempt
        // (a non-string option value used to 400 the entire request).
        console.error(`Grading failed for answer ${answer.id} (question ${question.id}):`, gradingErr);
        suggestedMarks = 0;
        confidence = 0;
        requiresReview = true;
        reasoning = `Auto-grading error: ${gradingErr instanceof Error ? gradingErr.message : String(gradingErr)}`;
        feedbackSuggestion = "This answer could not be auto-graded and needs teacher review.";
        matchedKeywords = [];
        modelUsed = "auto_grader_error";
      }

      const { error: aiEvalError } = await supabase
        .from("ai_evaluations")
        .upsert(
          {
            answer_id: answer.id,
            suggested_marks: suggestedMarks,
            max_marks: question.marks,
            confidence_score: confidence,
            requires_teacher_review: requiresReview,
            model_used: modelUsed,
            evaluation_reasoning: reasoning,
            feedback_suggestion: feedbackSuggestion,
            matched_keywords: matchedKeywords.length > 0 ? matchedKeywords : null,
          },
          { onConflict: "answer_id" }
        );

      if (aiEvalError) {
        console.error("Failed to upsert AI evaluation:", aiEvalError);
        continue;
      }

      if (effectiveGraderId) {
        const { error: overrideError } = await supabase
          .from("teacher_overrides")
          .upsert(
            {
              answer_id: answer.id,
              evaluated_by: effectiveGraderId,
              final_marks: suggestedMarks,
              max_marks: question.marks,
              accepted_ai_suggestion: true,
              teacher_feedback: feedbackSuggestion,
              internal_notes: `Auto-graded: ${reasoning}`,
              is_auto_graded: true,
            },
            { onConflict: "answer_id" }
          );

        if (overrideError) {
          console.error("Failed to upsert teacher override:", overrideError);
        }
      } else {
        console.warn(`Skipping teacher_override for answer ${answer.id} — no grader_id`);
      }

      gradedCount++;
      if (requiresReview) requiresReviewCount++;
    }

    const newStatus = "ai_evaluated";
    await supabase
      .from("student_exam_attempts")
      .update({ evaluation_status: newStatus })
      .eq("id", attempt_id);

    console.log(`Auto-grading complete. Graded: ${gradedCount}, AI-graded: ${aiGradedCount}, Needs review: ${requiresReviewCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        graded_count: gradedCount,
        ai_graded_count: aiGradedCount,
        requires_review_count: requiresReviewCount,
        evaluation_status: newStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auto-grade error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
