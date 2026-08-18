import type { Env } from "../types";

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

export interface OpportunityEvidence {
  subreddit: string;
  title: string;
  excerpt: string | null;
  commercialIntent: number | null;
  painCategory: string | null;
}

export interface OpportunityContext {
  label: string;
  postCount: number;
  velocity30d: number | null;
  volume: number | null;
  kd: number | null;
  cpc: number | null;
  avgIntent: number | null;
  opportunityScore: number | null;
  evidence: OpportunityEvidence[];
}

export interface OpportunityAnalysis {
  whyItMatters: string;
  productIdeas: Array<{ name: string; angle: string }>;
  validationPlan: string[];
  risks: string[];
  verdict: "pursue" | "watch" | "kill";
}

const SYSTEM_PROMPT = `You are a ruthless product-opportunity analyst. Analyze repeated Reddit pain signals for practical commercial opportunities. Use only the supplied evidence and metrics. Prefer narrow products that can be validated cheaply. Do not invent market facts.

Return ONLY valid JSON with this exact shape:
{
  "whyItMatters": "2-4 concise sentences",
  "productIdeas": [{"name":"short name","angle":"one-sentence product angle"}],
  "validationPlan": ["specific step", "specific step", "specific step"],
  "risks": ["specific risk"],
  "verdict": "pursue|watch|kill"
}

Give 3 product ideas, 3 validation steps, and 2-4 risks.`;

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function isAnalysis(value: unknown): value is OpportunityAnalysis {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.whyItMatters === "string" &&
    Array.isArray(v.productIdeas) &&
    v.productIdeas.every((idea) => {
      if (!idea || typeof idea !== "object") return false;
      const item = idea as Record<string, unknown>;
      return typeof item.name === "string" && typeof item.angle === "string";
    }) &&
    Array.isArray(v.validationPlan) && v.validationPlan.every((step) => typeof step === "string") &&
    Array.isArray(v.risks) && v.risks.every((risk) => typeof risk === "string") &&
    (v.verdict === "pursue" || v.verdict === "watch" || v.verdict === "kill")
  );
}

export async function analyzeOpportunity(env: Env, context: OpportunityContext): Promise<OpportunityAnalysis> {
  const result = await env.AI.run(
    MODEL as Parameters<Ai["run"]>[0],
    {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(context) },
      ],
    } as Parameters<Ai["run"]>[1],
  );

  const raw = (result as { response?: unknown })?.response ?? result;
  const parsed = typeof raw === "string" ? JSON.parse(stripCodeFences(raw)) : raw;
  if (!isAnalysis(parsed)) throw new Error("Workers AI returned an invalid opportunity analysis");
  return parsed;
}
