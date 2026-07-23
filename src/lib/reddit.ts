import type { Env } from "../types";

// Scrappy, no-cost Reddit access: public endpoints only — no OAuth, no API
// keys, no paid tier. We fetch the anonymous `.json` listing first and fall
// back to the `.rss` feed when Reddit refuses the JSON path (it sometimes 403s
// datacenter / Workers egress on `.json` while still serving the lighter feed).
//
// Reddit's unauthenticated budget is roughly 10 requests/minute per IP, so we
// pace one request every few seconds and back off on 429/5xx. Batches are 15
// minutes apart, so the extra wall-clock spent sleeping is comfortably within a
// cron invocation.
const MIN_REQUEST_INTERVAL_MS = 6000; // ~10 req/min, the anonymous ceiling
const MAX_RETRIES = 3;

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

// Reddit rejects requests with a missing or generic User-Agent. Identify the
// app honestly; REDDIT_USERNAME is optional contact info, never a credential.
export function userAgent(env: Env): string {
  const contact = env.REDDIT_USERNAME ? ` (by /u/${env.REDDIT_USERNAME})` : "";
  return `web:paindex:v1.0${contact}`;
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

// A throttled, retrying GET against reddit.com. Returns the Response as-is so
// callers can decide whether a non-ok status means "try the fallback" or "fail".
async function publicGet(env: Env, url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent(env), Accept: "application/json, text/xml;q=0.9, */*;q=0.5" },
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    return res;
  }
}

export function parseListing(data: unknown): RedditListingPost[] {
  const children = (data as { data?: { children?: { data?: unknown }[] } })?.data?.children ?? [];
  return children.map((c) => c.data).filter((d): d is RedditListingPost => Boolean(d));
}

// Fetch a listing as anonymous JSON. Returns null (rather than throwing) when
// Reddit refuses the JSON path, signalling the caller to try the RSS fallback.
async function fetchListingJson(env: Env, subreddit: string, query: string): Promise<RedditListingPost[] | null> {
  const res = await publicGet(env, `https://www.reddit.com/r/${subreddit}/${query}&raw_json=1`);
  if (!res.ok) return null;
  try {
    return parseListing(await res.json());
  } catch {
    return null;
  }
}

function firstGroup(source: string, re: RegExp): string | null {
  const m = source.match(re);
  return m ? m[1] : null;
}

function codePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

// Decode the XML/HTML entities Reddit's feed uses. `&amp;` is handled last so an
// already-decoded `&` isn't re-consumed; call twice to unwind double-encoding.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function htmlToText(raw: string): string {
  const html = decodeEntities(raw); // entity-encoded HTML -> HTML
  const stripped = html.replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped)
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1") // drop the space a stripped closing tag leaves before punctuation
    .trim();
}

// Parse Reddit's Atom feed into the same shape as the JSON listing. The feed
// carries less: no score or comment count (both default to 0) and no subscriber
// count. Enough to keep prefilter + classification alive when JSON is blocked.
export function parseRss(xml: string, subreddit: string): RedditListingPost[] {
  const entries = xml
    .split(/<entry>/i)
    .slice(1)
    .map((chunk) => chunk.split(/<\/entry>/i)[0]);

  const posts: RedditListingPost[] = [];
  for (const entry of entries) {
    const permalink = firstGroup(entry, /<link[^>]*href="([^"]+)"/i) ?? "";
    const idRaw = firstGroup(entry, /<id>\s*([^<]+?)\s*<\/id>/i) ?? "";
    let name = idRaw;
    if (!/^t3_[a-z0-9]+$/i.test(name)) {
      const fromLink = permalink.match(/\/comments\/([a-z0-9]+)/i);
      name = fromLink ? `t3_${fromLink[1]}` : "";
    }
    if (!name) continue;

    const publishedRaw =
      firstGroup(entry, /<published>\s*([^<]+?)\s*<\/published>/i) ??
      firstGroup(entry, /<updated>\s*([^<]+?)\s*<\/updated>/i);
    const parsed = publishedRaw ? Date.parse(publishedRaw) : NaN;
    const created_utc = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;

    posts.push({
      id: name.replace(/^t3_/, ""),
      name,
      subreddit,
      title: decodeEntities(firstGroup(entry, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? ""),
      selftext: htmlToText(firstGroup(entry, /<content[^>]*>([\s\S]*?)<\/content>/i) ?? ""),
      created_utc,
      score: 0,
      num_comments: 0,
      permalink,
      subreddit_subscribers: null,
    });
  }
  return posts;
}

async function fetchListingRss(env: Env, subreddit: string, sort: string): Promise<RedditListingPost[]> {
  const res = await publicGet(env, `https://www.reddit.com/r/${subreddit}/${sort}.rss?limit=100`);
  if (!res.ok) {
    throw new Error(`Reddit unavailable for r/${subreddit} (${sort}): JSON refused, RSS ${res.status}`);
  }
  return parseRss(await res.text(), subreddit);
}

export async function fetchNewPosts(env: Env, subreddit: string, limit = 100): Promise<RedditListingPost[]> {
  const json = await fetchListingJson(env, subreddit, `new.json?limit=${limit}`);
  if (json !== null) return json;
  return fetchListingRss(env, subreddit, "new");
}

export async function fetchTopWeekPosts(env: Env, subreddit: string, limit = 25): Promise<RedditListingPost[]> {
  const json = await fetchListingJson(env, subreddit, `top.json?t=week&limit=${limit}`);
  // `top` has no meaningful RSS equivalent (the feed can't take t=week), and the
  // weekly top pull is a Sunday bonus, so on JSON failure we simply skip it.
  return json ?? [];
}
