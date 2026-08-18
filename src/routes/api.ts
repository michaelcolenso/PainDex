import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import { clusters, posts, subreddits } from "../db/schema";
import { redditPermalink } from "../lib/auth";
import { analyzeOpportunity } from "../lib/analyzeOpportunity";
import { buildOpportunity } from "../lib/buildOpportunity";
import { getScoringWeights } from "../lib/config";

const VALID_STATUSES = new Set(["new", "watching", "pursue", "killed"]);

export const api = new Hono<{ Bindings: Env }>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function getContext(db: ReturnType<typeof drizzle>, id: number) {
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

api.post("/clusters/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Invalid cluster id", 400);
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string });
  if (!body.status || !VALID_STATUSES.has(body.status)) {
    return c.text(`status must be one of: ${[...VALID_STATUSES].join(", ")}`, 400);
  }
  const db = drizzle(c.env.DB);
  await db.update(clusters).set({ status: body.status }).where(eq(clusters.id, id));
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
    return c.json(await analyzeOpportunity(c.env, payload.context));
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
  try {
    const brief = await buildOpportunity(c.env, payload.context);
    await db.update(clusters).set({ status: "pursue" }).where(eq(clusters.id, id));
    return c.json(brief);
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
