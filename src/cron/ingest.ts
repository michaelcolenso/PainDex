import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import { posts, runs, subreddits } from "../db/schema";
import { fetchNewPosts, fetchTopWeekPosts, type RedditListingPost } from "../lib/reddit";
import { getPrefilterPatterns } from "../lib/config";
import { passesPrefilter } from "../lib/prefilter";
import { classifyPost } from "../lib/classify";
import { assignToCluster } from "../lib/cluster";

const BATCH_SIZE = 10;
const MAX_CONSECUTIVE_FAILURES = 5;
const MIN_COMMERCIAL_INTENT = 3;

interface IngestCursor {
  runId: number;
  date: string; // YYYY-MM-DD (UTC)
  offset: number;
  done: boolean;
}

const CURSOR_KEY = "ingest:cursor";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSundayUtc(): boolean {
  return new Date().getUTCDay() === 0;
}

export async function runIngestBatch(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const today = todayUtc();

  let cursor = await env.KV.get<IngestCursor>(CURSOR_KEY, "json");
  if (!cursor || cursor.date !== today) {
    const run = await db
      .insert(runs)
      .values({ kind: "ingest", startedAt: new Date().toISOString() })
      .returning({ id: runs.id })
      .get();
    cursor = { runId: run.id, date: today, offset: 0, done: false };
  }

  if (cursor.done) return; // this night's ingest already completed

  const active = await db.select().from(subreddits).where(eq(subreddits.active, 1)).orderBy(subreddits.name).all();
  const batch = active.slice(cursor.offset, cursor.offset + BATCH_SIZE);

  const errors: string[] = [];
  let postsFetched = 0;
  let postsClassified = 0;
  let clustersCreated = 0;
  const patterns = await getPrefilterPatterns(env.KV);
  const includeTopWeek = isSundayUtc();

  for (const sub of batch) {
    let listing: RedditListingPost[];
    try {
      const newPosts = await fetchNewPosts(env, sub.name);
      const topPosts = includeTopWeek ? await fetchTopWeekPosts(env, sub.name) : [];
      listing = [...newPosts, ...topPosts];
    } catch (err) {
      const failures = sub.consecutiveFailures + 1;
      const message = `${sub.name}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(message);
      await db
        .update(subreddits)
        .set({
          consecutiveFailures: failures,
          active: failures >= MAX_CONSECUTIVE_FAILURES ? 0 : 1,
          lastFetchedAt: new Date().toISOString(),
        })
        .where(eq(subreddits.name, sub.name));
      continue;
    }

    postsFetched += listing.length;

    await db
      .update(subreddits)
      .set({
        consecutiveFailures: 0,
        lastFetchedAt: new Date().toISOString(),
        ...(listing[0]?.subreddit_subscribers ? { subscribers: listing[0].subreddit_subscribers } : {}),
      })
      .where(eq(subreddits.name, sub.name));

    if (listing.length === 0) continue;

    const fullnames = listing.map((p) => p.name);
    const existing = await db
      .select({ id: posts.id })
      .from(posts)
      .where(inArray(posts.id, fullnames))
      .all();
    const existingIds = new Set(existing.map((r) => r.id));
    const newListingPosts = listing.filter((p) => !existingIds.has(p.name));
    if (newListingPosts.length === 0) continue;

    // De-dupe within the fetched listing itself (new+top can overlap).
    const seen = new Set<string>();
    const rows = newListingPosts.filter((p) => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });

    await db
      .insert(posts)
      .values(
        rows.map((p) => ({
          id: p.name,
          subreddit: sub.name,
          title: p.title,
          excerpt: (p.selftext ?? "").slice(0, 500),
          createdUtc: Math.floor(p.created_utc),
          score: p.score ?? 0,
          numComments: p.num_comments ?? 0,
        })),
      )
      .onConflictDoNothing();

    for (const p of rows) {
      const excerpt = (p.selftext ?? "").slice(0, 500);
      const nowIso = new Date().toISOString();

      if (!passesPrefilter(p.title, excerpt, patterns)) {
        await db.update(posts).set({ passedPrefilter: 0, processedAt: nowIso }).where(eq(posts.id, p.name));
        continue;
      }

      postsClassified++;
      const result = await classifyPost(env, sub.name, p.title, excerpt);

      if (!result) {
        await db
          .update(posts)
          .set({ passedPrefilter: 1, classifyFailed: 1, processedAt: nowIso })
          .where(eq(posts.id, p.name));
        continue;
      }

      if (!result.is_question || result.commercial_intent < MIN_COMMERCIAL_INTENT || !result.extracted_query) {
        await db
          .update(posts)
          .set({
            passedPrefilter: 1,
            isQuestion: result.is_question ? 1 : 0,
            commercialIntent: result.commercial_intent,
            painCategory: result.pain_category,
            extractedQuery: result.extracted_query,
            processedAt: nowIso,
          })
          .where(eq(posts.id, p.name));
        continue;
      }

      let clusterId: number;
      try {
        const assignment = await assignToCluster(env, db, result.extracted_query, result.commercial_intent, nowIso);
        clusterId = assignment.clusterId;
        if (assignment.created) clustersCreated++;
      } catch (err) {
        errors.push(`cluster assignment failed for ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        await db
          .update(posts)
          .set({
            passedPrefilter: 1,
            isQuestion: 1,
            commercialIntent: result.commercial_intent,
            painCategory: result.pain_category,
            extractedQuery: result.extracted_query,
            processedAt: nowIso,
          })
          .where(eq(posts.id, p.name));
        continue;
      }

      await db
        .update(posts)
        .set({
          passedPrefilter: 1,
          isQuestion: 1,
          commercialIntent: result.commercial_intent,
          painCategory: result.pain_category,
          extractedQuery: result.extracted_query,
          clusterId,
          processedAt: nowIso,
        })
        .where(eq(posts.id, p.name));
    }
  }

  const newOffset = cursor.offset + batch.length;
  const done = newOffset >= active.length;

  let mergedErrors: string[] | undefined;
  if (errors.length > 0) {
    const runRow = await db.select({ errors: runs.errors }).from(runs).where(eq(runs.id, cursor.runId)).get();
    const priorErrors: string[] = runRow?.errors ? JSON.parse(runRow.errors) : [];
    mergedErrors = [...priorErrors, ...errors];
  }

  await db
    .update(runs)
    .set({
      subsProcessed: sql`${runs.subsProcessed} + ${batch.length}`,
      postsFetched: sql`${runs.postsFetched} + ${postsFetched}`,
      postsClassified: sql`${runs.postsClassified} + ${postsClassified}`,
      clustersCreated: sql`${runs.clustersCreated} + ${clustersCreated}`,
      ...(mergedErrors ? { errors: JSON.stringify(mergedErrors) } : {}),
      ...(done ? { finishedAt: new Date().toISOString() } : {}),
    })
    .where(eq(runs.id, cursor.runId));

  await env.KV.put(CURSOR_KEY, JSON.stringify({ ...cursor, offset: newOffset, done }));
}
