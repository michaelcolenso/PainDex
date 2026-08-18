import type { Env } from "../types";
import type { OpportunityContext } from "./analyzeOpportunity";

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

export interface ProductBrief {
  workingTitle: string;
  oneLiner: string;
  targetUser: string;
  problem: string;
  proposedSolution: string;
  wedge: string;
  monetization: string[];
  validation: string[];
  mvp: string[];
  implementation: Array<{ phase: string; objective: string; tasks: string[] }>;
  successMetrics: string[];
  killCriteria: string[];
  markdown: string;
}

const SYSTEM_PROMPT = `You convert a validated pain-signal cluster into a practical product brief and implementation plan. Use only the supplied evidence and metrics. Favor the smallest credible wedge and a cheap validation path before substantial engineering. Do not invent market facts, customer counts, prices, or competitors.

Return ONLY valid JSON with this exact shape:
{
  "workingTitle":"short product name",
  "oneLiner":"single sentence",
  "targetUser":"specific user",
  "problem":"concise problem statement",
  "proposedSolution":"concise solution",
  "wedge":"why this narrow starting point can win",
  "monetization":["option","option"],
  "validation":["step","step","step"],
  "mvp":["feature","feature","feature"],
  "implementation":[{"phase":"Phase 1","objective":"objective","tasks":["task","task"]}],
  "successMetrics":["metric","metric"],
  "killCriteria":["criterion","criterion"]
}

Use 3 validation steps, 3-6 MVP features, 3 implementation phases, 2-4 monetization options, 3-5 success metrics, and 2-4 kill criteria.`;

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function valid(value: unknown): value is Omit<ProductBrief, "markdown"> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.workingTitle === "string" && typeof v.oneLiner === "string" &&
    typeof v.targetUser === "string" && typeof v.problem === "string" &&
    typeof v.proposedSolution === "string" && typeof v.wedge === "string" &&
    stringArray(v.monetization) && stringArray(v.validation) && stringArray(v.mvp) &&
    stringArray(v.successMetrics) && stringArray(v.killCriteria) && Array.isArray(v.implementation) &&
    v.implementation.every((phase) => {
      if (!phase || typeof phase !== "object") return false;
      const p = phase as Record<string, unknown>;
      return typeof p.phase === "string" && typeof p.objective === "string" && stringArray(p.tasks);
    });
}

function markdown(brief: Omit<ProductBrief, "markdown">, sourceLabel: string): string {
  const bullets = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const phases = brief.implementation.map((p) => `### ${p.phase}: ${p.objective}\n${bullets(p.tasks)}`).join("\n\n");
  return `# ${brief.workingTitle}\n\n> PainDex source: ${sourceLabel}\n\n${brief.oneLiner}\n\n## Target user\n${brief.targetUser}\n\n## Problem\n${brief.problem}\n\n## Proposed solution\n${brief.proposedSolution}\n\n## Wedge\n${brief.wedge}\n\n## Monetization\n${bullets(brief.monetization)}\n\n## Validation plan\n${bullets(brief.validation)}\n\n## MVP\n${bullets(brief.mvp)}\n\n## Implementation plan\n${phases}\n\n## Success metrics\n${bullets(brief.successMetrics)}\n\n## Kill criteria\n${bullets(brief.killCriteria)}\n`;
}

export async function buildOpportunity(env: Env, context: OpportunityContext): Promise<ProductBrief> {
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
  if (!valid(parsed)) throw new Error("Workers AI returned an invalid product brief");
  return { ...parsed, markdown: markdown(parsed, context.label) };
}
