import type { Env } from "../types";

// Ahrefs v3 Standard-tier requests cap at 25 result rows; keeping the
// per-request keyword batch at that size avoids silently truncated
// responses. Bump if the connected account is on a higher tier.
const AHREFS_BATCH_SIZE = 25;
const AHREFS_COUNTRY = "us";

export interface KeywordMetrics {
  volume: number;
  kd: number;
  cpc: number; // USD, converted from Ahrefs' native cents
}

interface AhrefsOverviewResponse {
  keywords: {
    keyword: string;
    volume: number | null;
    difficulty: number | null;
    cpc: number | null;
  }[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchBatch(env: Env, keywords: string[]): Promise<AhrefsOverviewResponse> {
  const params = new URLSearchParams({
    select: "keyword,volume,difficulty,cpc",
    country: AHREFS_COUNTRY,
    keywords: keywords.join(","),
    limit: String(keywords.length),
  });
  const res = await fetch(`https://api.ahrefs.com/v3/keywords-explorer/overview?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${env.AHREFS_API_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Ahrefs overview request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// Looks up volume/difficulty/cpc for a batch of keywords. Keywords Ahrefs
// has no data for come back with volume 0 (still "checked", per spec §6),
// and keywords absent from the response entirely (Ahrefs omits truly
// unknown terms) are likewise treated as zero-volume.
export async function fetchKeywordMetrics(env: Env, keywords: string[]): Promise<Map<string, KeywordMetrics>> {
  const results = new Map<string, KeywordMetrics>();
  for (const batch of chunk(keywords, AHREFS_BATCH_SIZE)) {
    const data = await fetchBatch(env, batch);
    for (const kw of batch) {
      const match = data.keywords.find((k) => k.keyword.toLowerCase() === kw.toLowerCase());
      results.set(kw, {
        volume: match?.volume ?? 0,
        kd: match?.difficulty ?? 0,
        cpc: match?.cpc ? match.cpc / 100 : 0,
      });
    }
  }
  return results;
}
