import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import { clusters, posts, subreddits } from "../db/schema";
import { redditPermalink } from "../lib/auth";

const VALID_STATUSES = new Set(["new", "watching", "pursue", "killed"]);

export const api = new Hono<{ Bindings: Env }>();

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
      createdUtc: posts.createdUtc,
    })
    .from(posts)
    .where(eq(posts.clusterId, id))
    .orderBy(desc(posts.createdUtc))
    .limit(10)
    .all();

  return c.json(
    rows.map((r) => ({
      title: r.title,
      subreddit: r.subreddit,
      createdUtc: r.createdUtc,
      permalink: redditPermalink(r.subreddit, r.id),
    })),
  );
});

api.post("/subreddits", async (c) => {
  const body = await c.req
    .json<{ name?: string; category?: string; subscribers?: number }>()
    .catch(() => ({}) as { name?: string; category?: string; subscribers?: number });
  if (!body.name) return c.text("name is required", 400);

  const db = drizzle(c.env.DB);
  await db
    .insert(subreddits)
    .values({ name: body.name, category: body.category ?? null, subscribers: body.subscribers ?? null })
    .onConflictDoNothing();
  return c.json({ ok: true });
});
