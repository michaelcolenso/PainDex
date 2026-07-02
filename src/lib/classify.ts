import type { Env } from "../types";

// Update if Cloudflare ships a newer/cheaper instruct model; verify
// availability at developers.cloudflare.com/workers-ai/models/ before
// swapping, since Workers AI model slugs change over time.
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

const SYSTEM_PROMPT = `You classify Reddit posts for commercial pain signals. Respond with ONLY a JSON object, no markdown, no preamble.

Fields:
- is_question: boolean. Is the author asking for information or help?
- commercial_intent: integer 0-10. 0 = pure hobby/consumption. 10 = actively operating or launching a business. Signals: pricing, customers, licensing, suppliers, scaling, going pro.
- pain_category: one of "sourcing", "pricing", "regulation", "timing", "quality", "tooling", "discovery", "scaling", "other".
- extracted_query: the underlying question rephrased as a 3-8 word search engine query in lowercase, or null if is_question is false. Example: post "Does anyone know if I need a cottage food license to sell sourdough at farmers markets in WA?" → "cottage food license washington farmers market".`;

export interface ClassificationResult {
  is_question: boolean;
  commercial_intent: number;
  pain_category: string;
  extracted_query: string | null;
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function coerce(value: unknown): ClassificationResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.is_question === "boolean" &&
    typeof v.commercial_intent === "number" &&
    typeof v.pain_category === "string" &&
    (v.extracted_query === null || typeof v.extracted_query === "string")
  ) {
    return {
      is_question: v.is_question,
      commercial_intent: Math.max(0, Math.min(10, Math.round(v.commercial_intent))),
      pain_category: v.pain_category,
      extracted_query: v.extracted_query,
    };
  }
  return null;
}

function parseModelOutput(raw: unknown): ClassificationResult | null {
  if (typeof raw === "string") {
    try {
      return coerce(JSON.parse(stripCodeFences(raw)));
    } catch {
      return null;
    }
  }
  return coerce(raw);
}

async function callModel(env: Env, subreddit: string, title: string, excerpt: string): Promise<unknown> {
  const result = await env.AI.run(
    MODEL as Parameters<Ai["run"]>[0],
    {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `SUBREDDIT: ${subreddit}\nTITLE: ${title}\nBODY: ${excerpt}` },
      ],
    } as Parameters<Ai["run"]>[1],
  );
  const response = (result as { response?: unknown })?.response;
  return response !== undefined ? response : result;
}

export async function classifyPost(
  env: Env,
  subreddit: string,
  title: string,
  excerpt: string,
): Promise<ClassificationResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callModel(env, subreddit, title, excerpt);
      const parsed = parseModelOutput(raw);
      if (parsed) return parsed;
    } catch {
      // swallow and retry once; final failure is handled by the caller
    }
  }
  return null;
}
