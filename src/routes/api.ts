import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import {
  analyses,
  clusters,
  opportunityEvents,
  opportunities,
  posts,
  productBriefs,
  subreddits,
} from "../db/schema";
import { redditPermalink } from "../lib/auth";
import { analyzeOpportunity } from "../lib/analyzeOpportunity";
import { buildOpportunity } from "../lib/buildOpportunity";
import { getScoringWeights } from "../lib/config";
import {
  isOpportunityStage,
  legacyStatusFromStage,
  stageFromLegacyStatus,
  validateTransition,
  type OpportunityStage,
  type TransitionAction,
} from "../lib/opportunityPipeline";

const VALID_STATUSES = new Set(["new", "watching", "pursue", "killed"]);

export const api = new Hono<{ Bindings: Env }>();

type Db = ReturnType<typeof drizzle>;
type Cluster = typeof clusters.$inferSelect;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function getContext(db: Db, id: number) {
  const cluster = await db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (!cluster) return null;
  const evidence = await db
    .select({
      subreddit: posts.subreddit,
      title: posts.title,
      excerpt: posts.excerpt,
      commercialIntent: posts.commercialIntent,
      painCategory: posts.painCategory,
    })
    .from(posts)
    .where(eq(posts.clusterId, id))
    .orderBy(desc(posts.createdUtc))
    .limit(10)
    .all();
  return {
    cluster,
    context: {
      label: cluster.label,
      postCount: cluster.postCount,
      velocity30d: cluster.velocity30d,
      volume: cluster.volume,
      kd: cluster.kd,
      cpc: cluster.cpc,
      avgIntent: cluster.avgIntent,
      opportunityScore: cluster.opportunityScore,
      evidence,
    },
  };
}

async function ensureOpportunity(db: Db, cluster: Cluster) {
  const existing = await db.select().from(opportunities).where(eq(opportunities.clusterId, cluster.id)).get();
  if (existing) return { opportunity: existing, created: false };

  const stage = stageFromLegacyStatus(cluster.status);
  const opportunity = await db
    .insert(opportunities)
    .values({ clusterId: cluster.id, stage })
    .returning()
    .get();
  await db.insert(opportunityEvents).values({
    opportunityId: opportunity.id,
    eventType: "promoted",
    toStage: stage,
    payloadJson: JSON.stringify({ legacyStatus: cluster.status }),
  });
  return { opportunity, created: true };
}

api.get("/opportunities", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: opportunities.id,
      clusterId: opportunities.clusterId,
      stage: opportunities.stage,
      owner: opportunities.owner,
      thesis: opportunities.thesis,
      nextAction: opportunities.nextAction,
      nextActionDueAt: opportunities.nextActionDueAt,
      updatedAt: opportunities.updatedAt,
      label: clusters.label,
      opportunityScore: clusters.opportunityScore,
      velocity30d: clusters.velocity30d,
      postCount: clusters.postCount,
    })
    .from(opportunities)
    .innerJoin(clusters, eq(opportunities.clusterId, clusters.id))
    .orderBy(desc(opportunities.updatedAt))
    .all();
  return c.json(rows);
});

api.get("/opportunities/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid opportunity id", 400);
  const db = drizzle(c.env.DB);
  const opportunity = await db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  if (!opportunity) return c.text("Opportunity not found", 404);
  const cluster = await db.select().from(clusters).where(eq(clusters.id, opportunity.clusterId)).get();
  const events = await db
    .select()
    .from(opportunityEvents)
    .where(eq(opportunityEvents.opportunityId, id))
    .orderBy(desc(opportunityEvents.createdAt))
    .limit(100)
    .all();
  const savedAnalyses = await db
    .select()
    .from(analyses)
    .where(eq(analyses.opportunityId, id))
    .orderBy(desc(analyses.createdAt))
    .limit(20)
    .all();
  const briefs = await db
    .select()
    .from(productBriefs)
    .where(eq(productBriefs.opportunityId, id))
    .orderBy(desc(productBriefs.version))
    .limit(20)
    .all();
  return c.json({ opportunity, cluster, events, analyses: savedAnalyses, productBriefs: briefs });
});

api.post("/clusters/:id/promote", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const db = drizzle(c.env.DB);
  const cluster = await db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (!cluster) return c.text("Cluster not found", 404);
  const result = await ensureOpportunity(db, cluster);
  return c.json({ ...result.opportunity, created: result.created }, result.created ? 201 : 200);
});

api.post("/opportunities/:id/stage", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid opportunity id", 400);
  const body = await c.req
    .json<{ stage?: unknown; action?: TransitionAction }>()
    .catch(() => ({}) as { stage?: unknown; action?: TransitionAction });
  if (!isOpportunityStage(body.stage)) return c.text("Invalid opportunity stage", 400);
  const action: TransitionAction = body.action === "restore" ? "restore" : "set";

  const db = drizzle(c.env.DB);
  const opportunity = await db.select().from(opportunities).where(eq(opportunities.id, id)).get();
  if (!opportunity) return c.text("Opportunity not found", 404);
  const from = opportunity.stage as OpportunityStage;
  const transition = validateTransition(from, body.stage, action);
  if (!transition.ok) return c.json({ error: "invalid_transition", reason: transition.reason }, 409);
  if (transition.idempotent) return c.json({ ok: true, stage: from, idempotent: true });

  const now = new Date().toISOString();
  const legacyStatus = legacyStatusFromStage(body.stage);
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE opportunities
         SET stage = ?1, updated_at = ?2,
             launched_at = CASE WHEN ?1 = 'launched' THEN COALESCE(launched_at, ?2) ELSE launched_at END,
             archived_at = CASE WHEN ?1 = 'archived' THEN ?2 WHEN ?3 = 'restore' THEN NULL ELSE archived_at END
         WHERE id = ?4`,
      )
      .bind(body.stage, now, action, id),
    c.env.DB
      .prepare(
        `INSERT INTO opportunity_events (opportunity_id, event_type, from_stage, to_stage, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(id, action === "restore" ? "restored" : "stage_changed", from, body.stage, JSON.stringify({ action }), now),
    c.env.DB.prepare("UPDATE clusters SET status = ?1 WHERE id = ?2").bind(legacyStatus, opportunity.clusterId),
  ]);

  return c.json({ ok: true, stage: body.stage, idempotent: false });
});

api.post("/clusters/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return c.text(`status must be one of: ${[...VALID_STATUSES].join(", ")}`, 400);
  }
  const db = drizzle(c.env.DB);
  await db.update(clusters).set({ status: body.status }).where(eq(clusters.id, id));

  const opportunity = await db.select().from(opportunities).where(eq(opportunities.clusterId, id)).get();
  if (opportunity) {
    const target = stageFromLegacyStatus(body.status);
    const from = opportunity.stage as OpportunityStage;
    const transition = validateTransition(from, target);
    if (transition.ok && !transition.idempotent) {
      const now = new Date().toISOString();
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE opportunities SET stage = ?1, updated_at = ?2 WHERE id = ?3").bind(target, now, opportunity.id),
        c.env.DB
          .prepare(
            `INSERT INTO opportunity_events (opportunity_id, event_type, from_stage, to_stage, payload_json, created_at)
             VALUES (?1, 'legacy_status_changed', ?2, ?3, ?4, ?5)`,
          )
          .bind(opportunity.id, from, target, JSON.stringify({ status: body.status }), now),
      ]);
    }
  }
  return c.json({ ok: true });
});

api.post("/clusters/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const body = await c.req
    .json<{ label?: string; notes?: string }>()
    .catch(() => ({}) as { label?: string; notes?: string });
  const update: Partial<{ label: string; notes: string }> = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.notes === "string") update.notes = body.notes;
  if (Object.keys(update).length === 0) return c.text("Nothing to update", 400);
  const db = drizzle(c.env.DB);
  await db.update(clusters).set(update).where(eq(clusters.id, id));
  return c.json({ ok: true });
});

api.get("/clusters/:id/posts", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({
      id: posts.id,
      subreddit: posts.subreddit,
      title: posts.title,
      excerpt: posts.excerpt,
      createdUtc: posts.createdUtc,
      commercialIntent: posts.commercialIntent,
      painCategory: posts.painCategory,
    })
    .from(posts)
    .where(eq(posts.clusterId, id))
    .orderBy(desc(posts.createdUtc))
    .limit(12)
    .all();
  return c.json(rows.map((r) => ({
    title: r.title,
    excerpt: r.excerpt,
    subreddit: r.subreddit,
    createdUtc: r.createdUtc,
    commercialIntent: r.commercialIntent,
    painCategory: r.painCategory,
    permalink: redditPermalink(r.subreddit, r.id),
  })));
});

api.get("/clusters/:id/trend", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const db = drizzle(c.env.DB);
  const cluster = await db.select().from(clusters).where(eq(clusters.id, id)).get();
  if (!cluster) return c.text("Cluster not found", 404);
  const rows = await db.select({ createdUtc: posts.createdUtc }).from(posts).where(eq(posts.clusterId, id)).all();
  const now = Math.floor(Date.now() / 1000);
  const weekSeconds = 7 * 86400;
  const buckets = Array.from({ length: 8 }, (_, index) => ({
    start: now - (8 - index) * weekSeconds,
    end: now - (7 - index) * weekSeconds,
    count: 0,
  }));
  for (const row of rows) {
    const bucket = buckets.find((b) => row.createdUtc >= b.start && row.createdUtc < b.end);
    if (bucket) bucket.count += 1;
  }
  const weights = await getScoringWeights(c.env.KV);
  const volume = cluster.volume ?? 0;
  const kd = cluster.kd ?? 50;
  const intent = cluster.avgIntent ?? 0;
  const velocity = cluster.velocity30d ?? 1;
  const factors = [
    { key: "demand", label: "Search demand", value: Math.log10(volume + 1) * weights.demandMultiplier },
    { key: "ease", label: "Ranking ease", value: (100 - kd) * weights.easeMultiplier },
    { key: "pain", label: "Repeated pain", value: Math.min(cluster.postCount, weights.painCap) * weights.painMultiplier },
    { key: "intent", label: "Commercial intent", value: intent * weights.intentMultiplier },
    { key: "momentum", label: "Momentum", value: clamp((velocity - 1) * weights.momentumMultiplier, weights.momentumMin, weights.momentumMax) },
  ];
  return c.json({
    weeks: buckets.map((b) => ({ start: new Date(b.start * 1000).toISOString(), count: b.count })),
    factors,
    score: cluster.opportunityScore,
    formula: "demand + ease + pain + intent + momentum",
  });
});

api.post("/clusters/:id/analyze", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const db = drizzle(c.env.DB);
  const payload = await getContext(db, id);
  if (!payload) return c.text("Cluster not found", 404);
  try {
    const result = await analyzeOpportunity(c.env, payload.context);
    const opportunity = await db.select().from(opportunities).where(eq(opportunities.clusterId, id)).get();
    if (opportunity) {
      await db.insert(analyses).values({
        opportunityId: opportunity.id,
        analysisType: "opportunity",
        model: "@cf/meta/llama-3.2-3b-instruct",
        contextJson: JSON.stringify(payload.context),
        resultJson: JSON.stringify(result),
      });
    }
    return c.json(result);
  } catch (error) {
    console.error("opportunity analysis failed", error);
    return c.json({ error: "analysis_failed" }, 502);
  }
});

api.post("/clusters/:id/build", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const db = drizzle(c.env.DB);
  const payload = await getContext(db, id);
  if (!payload) return c.text("Cluster not found", 404);

  const promoted = await ensureOpportunity(db, payload.cluster);
  const opportunity = promoted.opportunity;
  if (opportunity.stage === "killed" || opportunity.stage === "archived") {
    return c.json({ error: "terminal_opportunity", reason: "restore the opportunity before building" }, 409);
  }

  try {
    const brief = await buildOpportunity(c.env, payload.context);
    const versionRow = await c.env.DB
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM product_briefs WHERE opportunity_id = ?1")
      .bind(opportunity.id)
      .first<{ version: number }>();
    const version = Number(versionRow?.version ?? 1);
    const now = new Date().toISOString();
    const targetStage: OpportunityStage = opportunity.stage === "launched" ? "launched" : "pursue";

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO product_briefs (opportunity_id, version, brief_json, markdown, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(opportunity.id, version, JSON.stringify(brief), brief.markdown, now),
      c.env.DB
        .prepare("UPDATE opportunities SET stage = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(targetStage, now, opportunity.id),
      c.env.DB
        .prepare(
          `INSERT INTO opportunity_events (opportunity_id, event_type, from_stage, to_stage, payload_json, created_at)
           VALUES (?1, 'product_brief_generated', ?2, ?3, ?4, ?5)`,
        )
        .bind(opportunity.id, opportunity.stage, targetStage, JSON.stringify({ version }), now),
      c.env.DB.prepare("UPDATE clusters SET status = ?1 WHERE id = ?2").bind(legacyStatusFromStage(targetStage), id),
    ]);
    return c.json({ ...brief, opportunityId: opportunity.id, briefVersion: version, stage: targetStage });
  } catch (error) {
    console.error("product brief generation failed", error);
    return c.json({ error: "build_failed" }, 502);
  }
});

api.post("/subreddits", async (c) => {
  const body = await c.req
    .json<{ name?: string; category?: string; subscribers?: number }>()
    .catch(() => ({}) as { name?: string; category?: string; subscribers?: number });
  if (!body.name) return c.text("name is required", 400);
  const db = drizzle(c.env.DB);
  await db.insert(subreddits).values({
    name: body.name,
    category: body.category ?? null,
    subscribers: body.subscribers ?? null,
  }).onConflictDoNothing();
  return c.json({ ok: true });
});
