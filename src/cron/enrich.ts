import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import { clusters, runs } from "../db/schema";
import { fetchKeywordMetrics } from "../lib/ahrefs";
import { computeOpportunityScore } from "../lib/scoring";
import { getScoringWeights } from "../lib/config";

const KEYWORD_ELIGIBILITY_MIN_POSTS = 3;
const KEYWORD_RECHECK_DAYS = 90;
const WEEKLY_LOOKUP_CAP = 100;
const VELOCITY_MIN_POSTS = 2;

export async function runWeeklyEnrich(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const startedAt = new Date().toISOString();
  const run = await db.insert(runs).values({ kind: "enrich", startedAt }).returning({ id: runs.id }).get();
  const errors: string[] = [];

  await computeVelocities(env);

  const recheckCutoff = new Date(Date.now() - KEYWORD_RECHECK_DAYS * 86400 * 1000).toISOString();
  const eligible = await db
    .select()
    .from(clusters)
    .where(
      and(
        gte(clusters.postCount, KEYWORD_ELIGIBILITY_MIN_POSTS),
        or(isNull(clusters.keywordCheckedAt), lt(clusters.keywordCheckedAt, recheckCutoff)),
      ),
    )
    .limit(WEEKLY_LOOKUP_CAP)
    .all();

  if (eligible.length > 0) {
    try {
      const metrics = await fetchKeywordMetrics(
        env,
        eligible.map((c) => c.canonicalQuery),
      );
      const nowIso = new Date().toISOString();
      const updates = eligible.map((c) => {
        const m = metrics.get(c.canonicalQuery) ?? { volume: 0, kd: 0, cpc: 0 };
        return db
          .update(clusters)
          .set({ volume: m.volume, kd: m.kd, cpc: m.cpc, keywordCheckedAt: nowIso })
          .where(eq(clusters.id, c.id));
      });
      await runBatch(db, updates);
    } catch (err) {
      errors.push(`ahrefs enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await rescoreClusters(env);

  await db
    .update(runs)
    .set({
      errors: errors.length > 0 ? JSON.stringify(errors) : null,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(runs.id, run.id));
}

async function computeVelocities(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const cutoff30 = now - 30 * 86400;
  const cutoff31 = now - 31 * 86400;
  const cutoff60 = now - 60 * 86400;

  const { results } = await env.DB.prepare(
    `SELECT p.cluster_id AS clusterId,
            SUM(CASE WHEN p.created_utc >= ?1 THEN 1 ELSE 0 END) AS count30,
            SUM(CASE WHEN p.created_utc >= ?2 AND p.created_utc < ?3 THEN 1 ELSE 0 END) AS count3160
     FROM posts p
     JOIN clusters c ON c.id = p.cluster_id
     WHERE c.post_count >= ?4
     GROUP BY p.cluster_id`,
  )
    .bind(cutoff30, cutoff60, cutoff31, VELOCITY_MIN_POSTS)
    .all<{ clusterId: number; count30: number; count3160: number }>();

  if (results.length === 0) return;

  const updates = results.map((row) => {
    const velocity = row.count30 / Math.max(row.count3160, 1);
    return db.update(clusters).set({ velocity30d: velocity }).where(eq(clusters.id, row.clusterId));
  });
  await runBatch(db, updates);
}

async function rescoreClusters(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const weights = await getScoringWeights(env.KV);
  const withKeywordData = await db.select().from(clusters).where(isNotNull(clusters.keywordCheckedAt)).all();
  if (withKeywordData.length === 0) return;

  const updates = withKeywordData.map((c) => {
    const score = computeOpportunityScore(
      {
        volume: c.volume,
        kd: c.kd,
        postCount: c.postCount,
        avgIntent: c.avgIntent,
        velocity30d: c.velocity30d,
      },
      weights,
    );
    return db.update(clusters).set({ opportunityScore: score }).where(eq(clusters.id, c.id));
  });
  await runBatch(db, updates);
}

// D1 batch() requires a non-empty tuple typed as [first, ...rest]; chunk to
// stay well under D1's per-batch statement ceiling too. `any` here is the
// pragmatic escape hatch for drizzle's batch tuple typing -- statements are
// always update() builders constructed just above each call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runBatch(db: ReturnType<typeof drizzle>, statements: any[]): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const slice = statements.slice(i, i + CHUNK) as [any, ...any[]];
    await db.batch(slice);
  }
}
