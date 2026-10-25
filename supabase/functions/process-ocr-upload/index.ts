import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExamQuestion {
  id: string;
  question_text: string;
  question_type: string;
  marks: number;
  question_order: number;
  correct_answer: string | null;
  options: { a?: string; b?: string; c?: string; d?: string } | null;
}

interface ExtractedAnswer {
  questionId: string;
  questionNumber: number;
  extractedText: string;
  confidence: number;
}

const ALLOWED_ROLES = new Set([
  "super_admin",
  "super_school_admin",
  "school_admin",
  "coordinator",
  "teacher",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth gate: previously this function was callable with only the
    // upload ID — anyone with the URL could re-trigger Gemini Vision
    // billing on any pending upload. Verify JWT + role before doing
    // anything expensive.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const jwt = authHeader.slice("Bearer ".length);
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: roleRows } = await anonClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .limit(10);
    const allowed = (roleRows ?? []).some((r) => ALLOWED_ROLES.has(r.role as string));
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { uploadId } = await req.json();

    if (!uploadId) {
      console.error("Missing uploadId in request");
      return new Response(
        JSON.stringify({ error: "Missing uploadId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing OCR upload: ${uploadId}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch the upload record (include uploaded_by for grader_id)
    const { data: upload, error: uploadError } = await supabase
      .from("ocr_uploads")
      .select(`
        id,
        exam_id,
        class_id,
        student_id,
        attempt_id,
        file_url,
        file_name,
        status,
        uploaded_by
      `)
      .eq("id", uploadId)
      .single();

    if (uploadError || !upload) {
      console.error("Upload not found:", uploadError);
      return new Response(
        JSON.stringify({ error: "Upload not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (upload.status === "completed") {
      console.log("Upload already processed, skipping");
      return new Response(
        JSON.stringify({ message: "Already processed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Mark as processing
    await supabase
      .from("ocr_uploads")
      .update({
        status: "processing",
        processing_started_at: new Date().toISOString(),
      })
      .eq("id", uploadId);

    console.log(`Marked upload ${uploadId} as processing`);

    // 3. Fetch all exam questions via sections
    const { data: sections, error: sectionsError } = await supabase
      .from("exam_sections")
      .select("id")
      .eq("exam_id", upload.exam_id)
      .order("section_order", { ascending: true });

    if (sectionsError) throw sectionsError;

    const sectionIds = sections?.map((s) => s.id) || [];
    
    const { data: questions, error: questionsError } = await supabase
      .from("exam_questions")
      .select("id, question_text, question_type, marks, question_order, correct_answer, options")
      .in("section_id", sectionIds)
      .order("question_order", { ascending: true });

    if (questionsError) throw questionsError;

    console.log(`Found ${questions?.length || 0} questions for exam`);

    // 4. Create placeholder student_answers for all questions (if they don't exist)
    for (const question of questions || []) {
      const { error: answerUpsertError } = await supabase
        .from("student_answers")
        .upsert(
          {
            attempt_id: upload.attempt_id,
            question_id: question.id,
            answer_source: "offline_ocr",
            ocr_needs_review: true,
          },
          {
            onConflict: "attempt_id,question_id",
            ignoreDuplicates: true,
          }
        );

      if (answerUpsertError) {
        console.warn(`Failed to upsert answer for question ${question.id}:`, answerUpsertError);
      }
    }

    console.log("Created placeholder student_answers");

    // 5. Download the image using Supabase Storage SDK
    console.log(`Downloading image from: ${upload.file_url}`);
    let imageBase64: string;
    
    try {
      let storagePath: string | null = null;
      
      const urlPatterns = [
        /\/answer-sheets\/(.+?)(?:\?|$)/,
        /\/object\/(?:public|sign)\/answer-sheets\/(.+?)(?:\?|$)/,
      ];
      
      for (const pattern of urlPatterns) {
        const match = upload.file_url.match(pattern);
        if (match) {
          storagePath = decodeURIComponent(match[1]);
          break;
        }
      }
      
      if (!storagePath) {
        console.error("Could not extract storage path from URL:", upload.file_url);
        throw new Error("Invalid storage URL format");
      }
      
      console.log(`Extracted storage path: ${storagePath}`);
      
      const { data: imageData, error: downloadError } = await supabase
        .storage
        .from("answer-sheets")
        .download(storagePath);
      
      if (downloadError) {
        throw new Error(`Storage download failed: ${downloadError.message}`);
      }
      
      if (!imageData) {
        throw new Error("No image data received from storage");
      }
      
      const imageBuffer = await imageData.arrayBuffer();
      const uint8Array = new Uint8Array(imageBuffer);
      
      let binaryString = "";
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      imageBase64 = btoa(binaryString);
      
      console.log(`Downloaded image, base64 length: ${imageBase64.length}`);
    } catch (downloadError) {
      console.error("Failed to download image:", downloadError);
      await supabase
        .from("ocr_uploads")
        .update({
          status: "failed",
          error_message: `Failed to download image: ${downloadError instanceof Error ? downloadError.message : "Unknown error"}`,
        })
        .eq("id", uploadId);
      throw downloadError;
    }

    // 6. Build prompt for Gemini Vision — enhanced with question types and MCQ options
    const questionsList = (questions || []) as ExamQuestion[];
    const questionContext = questionsList
      .map((q, i) => {
        let line = `Q${i + 1} [${q.question_type.toUpperCase()}]: ${q.question_text.substring(0, 200)}${q.question_text.length > 200 ? "..." : ""}`;
        // For MCQ, include options so AI can map full-text answers to option letters
        if ((q.question_type === "mcq" || q.question_type === "true_false") && q.options) {
          const opts = q.options as Record<string, string>;
          const optLines = Object.entries(opts)
            .filter(([, v]) => v)
            .map(([k, v]) => `  ${k}) ${v}`)
            .join("\n");
          if (optLines) {
            line += `\nOptions:\n${optLines}`;
          }
        }
        return line;
      })
      .join("\n\n");

    const hasMCQ = questionsList.some(q => q.question_type === "mcq" || q.question_type === "true_false");

    const systemPrompt = `You are an expert OCR system analyzing a scanned student answer sheet.
Your task is to extract the handwritten or typed answers for each question.

IMPORTANT INSTRUCTIONS:
1. Look for question numbers (Q1, Q2, 1., 2., etc.) OR answers listed in order in the image
2. Students may write answers in many formats:
   - Just the answer text (e.g., "Jupiter", "True")
   - Option letters with or without parentheses: a, (b), A, (D)
   - Circled numbers with answers: ①(b), ②(d)
   - Numbered answers: 1. (b), 2. Jupiter
   - Just a list of answers without question numbers
3. If the student wrote answers as a simple numbered list or plain list, map them to questions in order
4. Estimate your confidence (0.0-1.0) based on legibility
${hasMCQ ? `
MCQ-SPECIFIC RULES:
- For MCQ questions, you MUST return ONLY the option letter (a, b, c, or d) in lowercase
- If the student wrote the full text of an option (e.g., "Jupiter"), match it to the correct option letter from the provided options and return just the letter
- If the student wrote "(b)" or "B" or "b)", normalize it to just "b"
- If the student circled or underlined an option, identify which letter it corresponds to
` : ""}

Questions in this exam:
${questionContext}

Respond ONLY with valid JSON in this exact format:
{
  "answers": [
    {
      "question_number": 1,
      "extracted_text": "the answer text OR just the option letter for MCQ",
      "confidence": 0.85
    }
  ]
}

Include an entry for EACH question, even if the answer is empty. Match question numbers carefully.`;

    // 7. Call Lovable AI (Gemini Vision) for OCR
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      await supabase
        .from("ocr_uploads")
        .update({
          status: "failed",
          error_message: "AI service not configured",
        })
        .eq("id", uploadId);
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Calling Lovable AI for OCR extraction...");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: systemPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        await supabase
          .from("ocr_uploads")
          .update({
            status: "failed",
            error_message: "Rate limit exceeded. Please try again later.",
          })
          .eq("id", uploadId);
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (aiResponse.status === 402) {
        await supabase
          .from("ocr_uploads")
          .update({
            status: "failed",
            error_message: "AI credits exhausted. Please add credits.",
          })
          .eq("id", uploadId);
        return new Response(
          JSON.stringify({ error: "Credits exhausted" }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";
    
    console.log("AI response received, parsing...");

    // 8. Parse the AI response
    let extractedAnswers: ExtractedAnswer[] = [];
    
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.answers && Array.isArray(parsed.answers)) {
          extractedAnswers = parsed.answers.map((a: { question_number: number; extracted_text: string; confidence: number }) => ({
            questionNumber: a.question_number,
            extractedText: a.extracted_text || "",
            confidence: Math.min(1, Math.max(0, a.confidence || 0.5)),
          }));
        }
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      console.log("Raw AI content:", aiContent.substring(0, 500));
    }

    console.log(`Extracted ${extractedAnswers.length} answers from AI response`);

    // 9. Map extracted answers to questions and save
    for (let i = 0; i < questionsList.length; i++) {
      const question = questionsList[i];
      const questionNumber = i + 1;
      
      const extracted = extractedAnswers.find(
        (a) => a.questionNumber === questionNumber
      );

      let extractedText = extracted?.extractedText || "";
      const confidence = extracted?.confidence || 0.3;

      // Get the student_answer ID
      const { data: studentAnswer } = await supabase
        .from("student_answers")
        .select("id")
        .eq("attempt_id", upload.attempt_id)
        .eq("question_id", question.id)
        .single();

      if (!studentAnswer) {
        console.warn(`No student_answer found for question ${question.id}`);
        continue;
      }

      // Create ocr_extraction record
      const { error: extractionError } = await supabase
        .from("ocr_extractions")
        .insert({
          upload_id: uploadId,
          attempt_id: upload.attempt_id,
          question_id: question.id,
          raw_extracted_text: extractedText,
          cleaned_text: extractedText.trim(),
          confidence_score: confidence,
          status: extractedText ? "extracted" : "no_content",
        });

      if (extractionError) {
        console.warn(`Failed to create extraction for question ${question.id}:`, extractionError);
      }

      // For MCQ/true_false, normalize the extracted text to a clean option letter
      // and set answer_options.selected
      let answerOptions: { selected: string } | null = null;
      if (question.question_type === "mcq" || question.question_type === "true_false") {
        const cleanedLetter = normalizeMCQAnswer(extractedText, question.options);
        if (cleanedLetter) {
          answerOptions = { selected: cleanedLetter };
          extractedText = cleanedLetter; // Also set answer_text to the clean letter
          console.log(`MCQ Q${questionNumber}: extracted="${extracted?.extractedText}" → normalized="${cleanedLetter}"`);
        }
      }

      // Update student_answer with extracted text and options
      const updatePayload: Record<string, unknown> = {
        answer_text: extractedText.trim() || null,
        ocr_extracted_text: extracted?.extractedText || extractedText,
        ocr_confidence: confidence,
        ocr_needs_review: confidence < 0.7 || !extractedText,
        answered_at: extractedText ? new Date().toISOString() : null,
      };
      if (answerOptions) {
        updatePayload.answer_options = answerOptions;
      }

      const { error: updateError } = await supabase
        .from("student_answers")
        .update(updatePayload)
        .eq("id", studentAnswer.id);

      if (updateError) {
        console.warn(`Failed to update student_answer ${studentAnswer.id}:`, updateError);
      }
    }

    console.log("Updated all student_answers with OCR results");

    // 10. Mark upload as completed
    await supabase
      .from("ocr_uploads")
      .update({
        status: "completed",
        processing_completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", uploadId);

    console.log(`OCR processing completed for upload ${uploadId}`);

    // 11. Trigger auto-grading — pass uploaded_by as grader_id
    try {
      console.log("Triggering auto-grade-submission...");
      await supabase.functions.invoke("auto-grade-submission", {
        body: { attempt_id: upload.attempt_id, grader_id: upload.uploaded_by },
      });
      console.log("Auto-grading triggered successfully");
    } catch (autoGradeError) {
      console.warn("Failed to trigger auto-grading:", autoGradeError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        uploadId,
        extractedCount: extractedAnswers.length,
        questionsCount: questionsList.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("OCR processing error:", error);
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Normalize an MCQ answer extracted by OCR to a clean option letter.
 * Handles formats like: "(b)", "b)", "B", "b", "Jupiter" (matched to options), etc.
 */
function normalizeMCQAnswer(
  extractedText: string,
  options: { a?: string; b?: string; c?: string; d?: string } | null
): string | null {
  if (!extractedText || !extractedText.trim()) return null;

  const text = extractedText.trim().toLowerCase();

  // 1. Try to extract a single option letter from common formats
  // Matches: (b), b), b., [b], b, B etc.
  const letterMatch = text.match(/^[\(\[\s]*([a-d])[\)\]\.\s]*$/);
  if (letterMatch) {
    return letterMatch[1];
  }

  // 2. Also check for "true"/"false" for true_false questions
  if (text === "true" || text === "t") return "true";
  if (text === "false" || text === "f") return "false";

  // 3. If the text is a full answer (e.g., "Jupiter"), try to match it against option texts
  if (options) {
    const opts = options as Record<string, string>;
    for (const [letter, optionText] of Object.entries(opts)) {
      if (!optionText) continue;
      const optLower = optionText.toLowerCase().trim();
      // Exact match or close substring match
      if (text === optLower || optLower.includes(text) || text.includes(optLower)) {
        return letter;
      }
    }
  }

  // 4. Check if the text starts with a letter followed by other content: "b. something"
  const prefixMatch = text.match(/^([a-d])[)\].\s:]+/);
  if (prefixMatch) {
    return prefixMatch[1];
  }

  // Could not normalize — return the cleaned text as-is
  return text;
}