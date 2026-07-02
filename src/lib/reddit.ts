import type { Env } from "../types";
import { KV_KEYS } from "./config";

// Reddit tokens are typically valid 24h; we refresh a bit early so a
// straggling batch never gets caught mid-request with a dead token.
const TOKEN_REFRESH_AFTER_SECONDS = 23 * 60 * 60;
const MIN_REQUEST_INTERVAL_MS = 1000; // 1 request/second, per spec §4.1
const MAX_RETRIES = 3;

interface CachedToken {
  accessToken: string;
  obtainedAt: number; // epoch seconds
  expiresIn: number;
}

export interface RedditListingPost {
  id: string; // short id, e.g. "abc123"
  name: string; // fullname, e.g. "t3_abc123" -- this is what we key posts on
  subreddit: string;
  title: string;
  selftext: string;
  created_utc: number;
  score: number;
  num_comments: number;
  permalink: string;
  subreddit_subscribers: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function userAgent(env: Env): string {
  return `web:paindex:v1.0 (by /u/${env.REDDIT_USERNAME})`;
}

async function fetchNewToken(env: Env): Promise<CachedToken> {
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(env),
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Reddit token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    obtainedAt: Math.floor(Date.now() / 1000),
    expiresIn: data.expires_in,
  };
}

async function getRedditToken(env: Env): Promise<string> {
  const cached = await env.KV.get<CachedToken>(KV_KEYS.redditToken, "json");
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.obtainedAt < TOKEN_REFRESH_AFTER_SECONDS) {
    return cached.accessToken;
  }
  const fresh = await fetchNewToken(env);
  await env.KV.put(KV_KEYS.redditToken, JSON.stringify(fresh), {
    expirationTtl: Math.max(fresh.expiresIn - 300, 60),
  });
  return fresh.accessToken;
}

// Module-scope throttle. Best-effort: it holds within a single invocation's
// serial fetch loop, which is the only place we call this. Cross-invocation
// pacing isn't needed since batches are already 15 minutes apart.
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function redditRequest(env: Env, path: string): Promise<unknown> {
  const token = await getRedditToken(env);

  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent(env),
      },
    });

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Reddit 429 rate-limited after ${MAX_RETRIES} retries: ${path}`);
      }
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`Reddit request failed (${res.status}) for ${path}: ${await res.text()}`);
    }

    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null && Number(remaining) < 2) {
      const resetSeconds = Number(res.headers.get("x-ratelimit-reset") ?? "1");
      await sleep(Math.min(Math.max(resetSeconds, 1), 10) * 1000);
    }

    return res.json();
  }
}

function parseListing(data: unknown): RedditListingPost[] {
  const children = (data as { data?: { children?: { data?: unknown }[] } })?.data?.children ?? [];
  return children.map((c) => c.data).filter((d): d is RedditListingPost => Boolean(d));
}

export async function fetchNewPosts(env: Env, subreddit: string, limit = 100): Promise<RedditListingPost[]> {
  const data = await redditRequest(env, `/r/${subreddit}/new?limit=${limit}`);
  return parseListing(data);
}

export async function fetchTopWeekPosts(env: Env, subreddit: string, limit = 25): Promise<RedditListingPost[]> {
  const data = await redditRequest(env, `/r/${subreddit}/top?t=week&limit=${limit}`);
  return parseListing(data);
}
