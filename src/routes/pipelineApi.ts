import { Hono } from "hono";
import type { Env } from "../types";

export const pipelineApi = new Hono<{ Bindings: Env }>();

type Resource = "experiments" | "interviews" | "competitors" | "opportunity_links" | "outcomes";

const RESOURCE_CONFIG: Record<Resource, { fields: string[]; required: string[] }> = {
  experiments: {
    fields: ["hypothesis", "method", "success_criterion", "status", "result", "started_at", "completed_at"],
    required: ["hypothesis"],
  },
  interviews: {
    fields: ["participant", "notes", "pain_strength", "willingness_to_pay", "source_url", "occurred_at"],
    required: ["notes", "occurred_at"],
  },
  competitors: {
    fields: ["name", "url", "type", "positioning", "pricing_notes", "strengths", "gaps"],
    required: ["name"],
  },
  opportunity_links: {
    fields: ["kind", "label", "url"],
    required: ["kind", "url"],
  },
  outcomes: {
    fields: ["metric", "numeric_value", "text_value", "period", "observed_at"],
    required: ["metric"],
  },
};

function opportunityId(c: { req: { param: (name: string) => string } }): number {
  return Number(c.req.param("id"));
}

function validId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

async function exists(env: Env, id: number): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 AS ok FROM opportunities WHERE id = ?1").bind(id).first());
}

function cleanBody(body: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) result[key] = body[key];
  }
  return result;
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const raw = await c.req.json().catch(() => ({}));
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function resourceName(value: string): Resource | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_CONFIG, value) ? (value as Resource) : null;
}

pipelineApi.get("/opportunities/:id/workspace", async (c) => {
  const id = opportunityId(c);
  if (!validId(id)) return c.text("Invalid opportunity id", 400);
  const opportunity = await c.env.DB.prepare(
    `SELECT o.*, c.label, c.opportunity_score AS opportunityScore, c.post_count AS postCount,
            c.velocity_30d AS velocity30d, c.volume, c.kd, c.avg_intent AS avgIntent
     FROM opportunities o JOIN clusters c ON c.id = o.cluster_id WHERE o.id = ?1`,
  ).bind(id).first();
  if (!opportunity) return c.text("Opportunity not found", 404);

  const statements = [
    c.env.DB.prepare("SELECT * FROM opportunity_events WHERE opportunity_id = ?1 ORDER BY created_at DESC LIMIT 100").bind(id),
    c.env.DB.prepare("SELECT * FROM score_snapshots WHERE opportunity_id = ?1 ORDER BY captured_at DESC LIMIT 100").bind(id),
    c.env.DB.prepare("SELECT * FROM analyses WHERE opportunity_id = ?1 ORDER BY created_at DESC LIMIT 20").bind(id),
    c.env.DB.prepare("SELECT * FROM product_briefs WHERE opportunity_id = ?1 ORDER BY version DESC LIMIT 20").bind(id),
    c.env.DB.prepare("SELECT * FROM experiments WHERE opportunity_id = ?1 ORDER BY created_at DESC").bind(id),
    c.env.DB.prepare("SELECT * FROM interviews WHERE opportunity_id = ?1 ORDER BY occurred_at DESC").bind(id),
    c.env.DB.prepare("SELECT * FROM competitors WHERE opportunity_id = ?1 ORDER BY updated_at DESC").bind(id),
    c.env.DB.prepare("SELECT * FROM opportunity_links WHERE opportunity_id = ?1 ORDER BY created_at DESC").bind(id),
    c.env.DB.prepare("SELECT * FROM outcomes WHERE opportunity_id = ?1 ORDER BY observed_at DESC").bind(id),
  ];
  const [events, scores, analyses, briefs, experiments, interviews, competitors, links, outcomes] = await c.env.DB.batch(statements);
  return c.json({
    opportunity,
    events: events.results,
    scoreSnapshots: scores.results,
    analyses: analyses.results,
    productBriefs: briefs.results,
    experiments: experiments.results,
    interviews: interviews.results,
    competitors: competitors.results,
    links: links.results,
    outcomes: outcomes.results,
  });
});

pipelineApi.post("/opportunities/:id", async (c) => {
  const id = opportunityId(c);
  if (!validId(id)) return c.text("Invalid opportunity id", 400);
  if (!(await exists(c.env, id))) return c.text("Opportunity not found", 404);
  const body = cleanBody(await jsonBody(c), ["owner", "thesis", "next_action", "next_action_due_at"]);
  const entries = Object.entries(body);
  if (!entries.length) return c.text("Nothing to update", 400);
  const sets = entries.map(([key], i) => `${key} = ?${i + 1}`).join(", ");
  const nowIndex = entries.length + 1;
  const idIndex = entries.length + 2;
  await c.env.DB.prepare(`UPDATE opportunities SET ${sets}, updated_at = ?${nowIndex} WHERE id = ?${idIndex}`)
    .bind(...entries.map(([, value]) => value ?? null), new Date().toISOString(), id)
    .run();
  return c.json({ ok: true });
});

pipelineApi.post("/opportunities/:id/resources/:resource", async (c) => {
  const id = opportunityId(c);
  if (!validId(id)) return c.text("Invalid opportunity id", 400);
  const resource = resourceName(c.req.param("resource"));
  if (!resource) return c.text("Unknown resource", 404);
  if (!(await exists(c.env, id))) return c.text("Opportunity not found", 404);
  const config = RESOURCE_CONFIG[resource];
  const body = cleanBody(await jsonBody(c), config.fields);
  for (const field of config.required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") return c.text(`${field} is required`, 400);
  }
  if (resource === "outcomes" && body.numeric_value == null && body.text_value == null) {
    return c.text("numeric_value or text_value is required", 400);
  }
  if (resource === "experiments" && body.status === undefined) body.status = "planned";
  if (resource === "outcomes" && body.observed_at === undefined) body.observed_at = new Date().toISOString();
  const fields = Object.keys(body);
  const placeholders = fields.map((_, i) => `?${i + 2}`).join(", ");
  const result = await c.env.DB.prepare(
    `INSERT INTO ${resource} (opportunity_id, ${fields.join(", ")}) VALUES (?1, ${placeholders}) RETURNING *`,
  ).bind(id, ...fields.map((field) => body[field] ?? null)).first();
  await c.env.DB.prepare(
    "INSERT INTO opportunity_events (opportunity_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
  ).bind(id, `${resource}:created`, JSON.stringify({ id: (result as { id?: number } | null)?.id ?? null })).run();
  return c.json(result, 201);
});

pipelineApi.post("/opportunities/:id/resources/:resource/:resourceId", async (c) => {
  const id = opportunityId(c);
  const resourceId = Number(c.req.param("resourceId"));
  if (!validId(id) || !validId(resourceId)) return c.text("Invalid id", 400);
  const resource = resourceName(c.req.param("resource"));
  if (!resource) return c.text("Unknown resource", 404);
  const body = cleanBody(await jsonBody(c), RESOURCE_CONFIG[resource].fields);
  const entries = Object.entries(body);
  if (!entries.length) return c.text("Nothing to update", 400);
  const sets = entries.map(([key], i) => `${key} = ?${i + 1}`).join(", ");
  const idIndex = entries.length + 1;
  const opportunityIndex = entries.length + 2;
  const result = await c.env.DB.prepare(
    `UPDATE ${resource} SET ${sets}${["experiments", "competitors"].includes(resource) ? ", updated_at = current_timestamp" : ""}
     WHERE id = ?${idIndex} AND opportunity_id = ?${opportunityIndex} RETURNING *`,
  ).bind(...entries.map(([, value]) => value ?? null), resourceId, id).first();
  if (!result) return c.text("Resource not found", 404);
  await c.env.DB.prepare(
    "INSERT INTO opportunity_events (opportunity_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
  ).bind(id, `${resource}:updated`, JSON.stringify({ id: resourceId })).run();
  return c.json(result);
});

pipelineApi.delete("/opportunities/:id/resources/:resource/:resourceId", async (c) => {
  const id = opportunityId(c);
  const resourceId = Number(c.req.param("resourceId"));
  if (!validId(id) || !validId(resourceId)) return c.text("Invalid id", 400);
  const resource = resourceName(c.req.param("resource"));
  if (!resource) return c.text("Unknown resource", 404);
  const result = await c.env.DB.prepare(`DELETE FROM ${resource} WHERE id = ?1 AND opportunity_id = ?2 RETURNING id`)
    .bind(resourceId, id).first();
  if (!result) return c.text("Resource not found", 404);
  await c.env.DB.prepare(
    "INSERT INTO opportunity_events (opportunity_id, event_type, payload_json) VALUES (?1, ?2, ?3)",
  ).bind(id, `${resource}:deleted`, JSON.stringify({ id: resourceId })).run();
  return c.json({ ok: true });
});
