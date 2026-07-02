import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const subreddits = sqliteTable("subreddits", {
  name: text("name").primaryKey(), // "FoodTrucks", no r/ prefix
  subscribers: integer("subscribers"),
  category: text("category"), // "regulated" | "b2b" | "platform" | "arbitrage"
  active: integer("active").notNull().default(1),
  addedAt: text("added_at").notNull().default(sql`(current_timestamp)`),
  lastFetchedAt: text("last_fetched_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(), // reddit fullname t3_xxxxx
    subreddit: text("subreddit").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"), // first 500 chars of selftext
    createdUtc: integer("created_utc").notNull(),
    score: integer("score").notNull().default(0),
    numComments: integer("num_comments").notNull().default(0),
    passedPrefilter: integer("passed_prefilter").notNull().default(0),
    isQuestion: integer("is_question"),
    commercialIntent: integer("commercial_intent"),
    painCategory: text("pain_category"),
    extractedQuery: text("extracted_query"),
    clusterId: integer("cluster_id").references(() => clusters.id),
    classifyFailed: integer("classify_failed").notNull().default(0),
    processedAt: text("processed_at"),
  },
  (table) => [
    index("posts_cluster_id_idx").on(table.clusterId),
    index("posts_subreddit_created_idx").on(table.subreddit, table.createdUtc),
  ],
);

export const clusters = sqliteTable(
  "clusters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    canonicalQuery: text("canonical_query").notNull(),
    label: text("label").notNull(), // human-edited display name, defaults to canonical_query
    postCount: integer("post_count").notNull().default(1),
    firstSeen: text("first_seen").notNull().default(sql`(current_timestamp)`),
    lastSeen: text("last_seen").notNull().default(sql`(current_timestamp)`),
    velocity30d: real("velocity_30d"),
    avgIntent: real("avg_intent"),
    volume: integer("volume"), // Ahrefs monthly search volume, null until checked
    kd: integer("kd"), // Ahrefs keyword difficulty
    cpc: real("cpc"),
    keywordCheckedAt: text("keyword_checked_at"),
    opportunityScore: real("opportunity_score"),
    status: text("status").notNull().default("new"), // new | watching | pursue | killed
    notes: text("notes"),
  },
  (table) => [index("clusters_status_score_idx").on(table.status, table.opportunityScore)],
);

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull().default(sql`(current_timestamp)`),
  kind: text("kind").notNull(), // "ingest" | "enrich"
  subsProcessed: integer("subs_processed").notNull().default(0),
  postsFetched: integer("posts_fetched").notNull().default(0),
  postsClassified: integer("posts_classified").notNull().default(0),
  clustersCreated: integer("clusters_created").notNull().default(0),
  errors: text("errors"), // JSON array
  finishedAt: text("finished_at"),
});
