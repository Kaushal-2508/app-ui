/**
 * Shared AI provider abstraction for Supabase edge functions.
 *
 * Why this file exists: we pay for the OpenAI API and want to default to it,
 * but need a single switch point so a future migration to Gemini (or any
 * other provider) is a one-file change instead of a rewrite of every edge
 * function that calls an LLM.
 *
 * Usage from an edge function:
 *
 *   import { generateCompletion } from "../_shared/aiProvider.ts";
 *
 *   const { content } = await generateCompletion({
 *     systemPrompt,
 *     userPrompt,
 *     temperature: 0.7,
 *     maxTokens: 4000,
 *     responseFormat: "json",
 *   });
 *
 * Provider selection order:
 *   1. `AI_PROVIDER` env var ("openai" | "gemini") — explicit override.
 *   2. Default: "openai".
 *
 * Required env vars by provider:
 *   - openai: OPENAI_API_KEY, optional OPENAI_MODEL (default gpt-4o-mini),
 *     optional OPENAI_REASONING_EFFORT (default "medium", reasoning models only)
 *   - gemini: GEMINI_API_KEY, optional GEMINI_MODEL (default gemini-1.5-flash)
 */

export type AiProvider = "openai" | "gemini";

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  /** If "json", hints the provider to return strict JSON output. */
  responseFormat?: "text" | "json";
  /**
   * Per-call model override. Takes precedence over OPENAI_MODEL/GEMINI_MODEL.
   * Used for cost routing: reasoning model for computation-heavy subjects,
   * cheap non-reasoning model for everything else.
   */
  model?: string;
}

export interface CompletionResponse {
  content: string;
  provider: AiProvider;
  model: string;
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

function resolveProvider(): AiProvider {
  const raw = (Deno.env.get("AI_PROVIDER") || "openai").toLowerCase();
  if (raw === "openai" || raw === "gemini") return raw;
  console.warn(`[aiProvider] Unknown AI_PROVIDER="${raw}", falling back to openai`);
  return "openai";
}

async function callOpenAi(req: CompletionRequest): Promise<CompletionResponse> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new AiProviderError("OPENAI_API_KEY is not configured");
  }
  const model = req.model || Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";

  // GPT-5-family and o-series reasoning models reject `max_tokens` (they
  // require `max_completion_tokens`) and reject any non-default temperature.
  // Reasoning tokens also bill against the completion budget, so the cap
  // needs headroom beyond the caller's content budget or the visible output
  // gets truncated mid-JSON.
  const isReasoningModel = /^(gpt-5|o\d)/.test(model);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: req.systemPrompt },
      { role: "user", content: req.userPrompt },
    ],
  };
  if (isReasoningModel) {
    body.max_completion_tokens = (req.maxTokens ?? 4000) + 8000;
    body.reasoning_effort = Deno.env.get("OPENAI_REASONING_EFFORT") || "medium";
  } else {
    body.temperature = req.temperature ?? 0.7;
    body.max_tokens = req.maxTokens ?? 4000;
  }
  if (req.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Bound the LLM call: a hung upstream must not hold the edge connection
    // open until the runtime wall limit (§23.14). 60s (not the usual 10s)
    // because large question batches legitimately take 40-50s to generate.
    // Reasoning models get 240s: thinking happens before any output and a
    // medium-effort maths batch measures ~2 min (low effort was tried and
    // produced mathematically wrong answers — do not "optimize" this back).
    signal: AbortSignal.timeout(isReasoningModel ? 240_000 : 60_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[aiProvider/openai] error", res.status, errText);
    throw new AiProviderError(`OpenAI API error: ${res.status} - ${errText}`, res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiProviderError("OpenAI returned an empty completion");
  }
  return { content, provider: "openai", model };
}

async function callGemini(req: CompletionRequest): Promise<CompletionResponse> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    throw new AiProviderError("GEMINI_API_KEY is not configured");
  }
  // Honor per-call override only if it is actually a Gemini model — cost
  // routing passes OpenAI model names, which must not leak into this path.
  const model = (req.model?.startsWith("gemini") ? req.model : undefined) ||
    Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";

  // Gemini doesn't have a first-class system role — prepend it to the user turn.
  const combined = `${req.systemPrompt}\n\n${req.userPrompt}`;
  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0.7,
    maxOutputTokens: req.maxTokens ?? 4000,
  };
  if (req.responseFormat === "json") {
    generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: combined }] }],
        generationConfig,
      }),
      // Same 60s LLM bound as callOpenAi — see comment there.
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("[aiProvider/gemini] error", res.status, errText);
    throw new AiProviderError(`Gemini API error: ${res.status} - ${errText}`, res.status);
  }

  const data = await res.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new AiProviderError("Gemini returned an empty completion");
  }
  return { content, provider: "gemini", model };
}

export async function generateCompletion(req: CompletionRequest): Promise<CompletionResponse> {
  const provider = resolveProvider();
  switch (provider) {
    case "openai":
      return callOpenAi(req);
    case "gemini":
      return callGemini(req);
  }
}
