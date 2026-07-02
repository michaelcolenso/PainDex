export const KV_KEYS = {
  ingestCursor: "ingest:cursor",
  prefilterPatterns: "prefilter:patterns",
  clusterThreshold: "cluster:threshold",
  scoringWeights: "scoring:weights",
  redditToken: "reddit:token",
} as const;

export interface PrefilterPatterns {
  titleKeywords: string; // regex source, case-insensitive
  bodyKeywords: string; // regex source, case-insensitive
}

export const DEFAULT_PREFILTER_PATTERNS: PrefilterPatterns = {
  titleKeywords:
    "how do|how to|where can|where do|anyone know|recommend|worth it|best way|is it legal|do i need|going pro|start(ing)? a|charge for|price|pricing|supplier|wholesale|license|permit|insurance",
  bodyKeywords: "charge|price|customer|client|sell|llc|license|permit|insurance|wholesale|supplier|invoice",
};

export const DEFAULT_CLUSTER_THRESHOLD = 0.85;

export interface ScoringWeights {
  demandMultiplier: number; // demand = log10(volume + 1) * demandMultiplier
  easeMultiplier: number; // ease = (100 - kd) * easeMultiplier
  painMultiplier: number; // pain = min(post_count, painCap) * painMultiplier
  painCap: number;
  intentMultiplier: number; // intent = avg_intent * intentMultiplier
  momentumMultiplier: number; // momentum = clamp((velocity_30d - 1) * momentumMultiplier, momentumMin, momentumMax)
  momentumMin: number;
  momentumMax: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  demandMultiplier: 12,
  easeMultiplier: 0.3,
  painMultiplier: 1.5,
  painCap: 20,
  intentMultiplier: 2,
  momentumMultiplier: 10,
  momentumMin: -10,
  momentumMax: 15,
};

async function getJson<T>(kv: KVNamespace, key: string, fallback: T): Promise<T> {
  const raw = await kv.get(key, "json");
  if (raw === null) return fallback;
  return raw as T;
}

export function getPrefilterPatterns(kv: KVNamespace): Promise<PrefilterPatterns> {
  return getJson(kv, KV_KEYS.prefilterPatterns, DEFAULT_PREFILTER_PATTERNS);
}

export async function getClusterThreshold(kv: KVNamespace): Promise<number> {
  const raw = await kv.get(KV_KEYS.clusterThreshold);
  if (raw === null) return DEFAULT_CLUSTER_THRESHOLD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_CLUSTER_THRESHOLD;
}

export function getScoringWeights(kv: KVNamespace): Promise<ScoringWeights> {
  return getJson(kv, KV_KEYS.scoringWeights, DEFAULT_SCORING_WEIGHTS);
}
