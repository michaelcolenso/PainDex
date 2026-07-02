import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "../types";
import { clusters } from "../db/schema";
import { getClusterThreshold } from "./config";

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export async function embedQuery(env: Env, text: string): Promise<number[]> {
  const result = await env.AI.run(EMBED_MODEL as Parameters<Ai["run"]>[0], { text: [text] } as Parameters<
    Ai["run"]
  >[1]);
  const vector = (result as { data: number[][] }).data?.[0];
  if (!vector) throw new Error(`Embedding failed for query: ${text}`);
  return vector;
}

export interface ClusterAssignment {
  clusterId: number;
  created: boolean;
}

// Attaches a classified post's extracted_query to the nearest existing
// cluster (cosine >= threshold) or creates a new one. Caller is responsible
// for setting posts.cluster_id from the returned id.
export async function assignToCluster(
  env: Env,
  db: DrizzleD1Database<Record<string, unknown>>,
  extractedQuery: string,
  commercialIntent: number,
  nowIso: string,
): Promise<ClusterAssignment> {
  const threshold = await getClusterThreshold(env.KV);
  const vector = await embedQuery(env, extractedQuery);

  const queryResult = await env.VECTORIZE.query(vector, { topK: 1 });
  const best = queryResult.matches[0];

  if (best && best.score >= threshold) {
    const clusterId = Number(best.id);
    const existing = await db.select().from(clusters).where(eq(clusters.id, clusterId)).get();
    if (existing) {
      const newPostCount = existing.postCount + 1;
      const priorAvg = existing.avgIntent ?? commercialIntent;
      const newAvgIntent = (priorAvg * existing.postCount + commercialIntent) / newPostCount;
      await db
        .update(clusters)
        .set({ postCount: newPostCount, lastSeen: nowIso, avgIntent: newAvgIntent })
        .where(eq(clusters.id, clusterId));
      return { clusterId, created: false };
    }
  }

  const inserted = await db
    .insert(clusters)
    .values({
      canonicalQuery: extractedQuery,
      label: extractedQuery,
      postCount: 1,
      firstSeen: nowIso,
      lastSeen: nowIso,
      avgIntent: commercialIntent,
    })
    .returning({ id: clusters.id })
    .get();

  await env.VECTORIZE.upsert([{ id: String(inserted.id), values: vector }]);

  return { clusterId: inserted.id, created: true };
}
