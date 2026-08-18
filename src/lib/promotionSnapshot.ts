import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";
import { getScoringWeights } from "./config";
import { computeOpportunityScoreFactors } from "./scoring";

interface PromotedClusterRow {
  opportunityId: number;
  score: number | null;
  volume: number | null;
  kd: number | null;
  postCount: number;
  avgIntent: number | null;
  velocity30d: number | null;
}

export async function seedPromotionScoreSnapshot(env: Env, clusterId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT o.id AS opportunityId,
            c.opportunity_score AS score,
            c.volume,
            c.kd,
            c.post_count AS postCount,
            c.avg_intent AS avgIntent,
            c.velocity_30d AS velocity30d
     FROM opportunities o
     JOIN clusters c ON c.id = o.cluster_id
     WHERE o.cluster_id = ?1`,
  ).bind(clusterId).first<PromotedClusterRow>();

  if (!row || row.score == null) return false;

  const existing = await env.DB.prepare(
    "SELECT 1 AS found FROM score_snapshots WHERE opportunity_id = ?1 LIMIT 1",
  ).bind(row.opportunityId).first();
  if (existing) return false;

  const weights = await getScoringWeights(env.KV);
  const factors = computeOpportunityScoreFactors(
    {
      volume: row.volume,
      kd: row.kd,
      postCount: row.postCount,
      avgIntent: row.avgIntent,
      velocity30d: row.velocity30d,
    },
    weights,
  );

  await env.DB.prepare(
    `INSERT INTO score_snapshots
      (opportunity_id, score, demand, ease, pain, intent, momentum)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    row.opportunityId,
    row.score,
    factors.demand,
    factors.ease,
    factors.pain,
    factors.intent,
    factors.momentum,
  ).run();

  return true;
}

export const seedPromotionSnapshot: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  if (c.res.status >= 400) return;

  const clusterId = Number(c.req.param("id"));
  if (!Number.isInteger(clusterId) || clusterId <= 0) return;

  try {
    await seedPromotionScoreSnapshot(c.env, clusterId);
  } catch (error) {
    // Promotion/build should not fail solely because historical telemetry could not be written.
    console.error("promotion score snapshot failed", { clusterId, error });
  }
};
