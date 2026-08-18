import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    status: text("status").notNull().default("new"), // legacy triage status; durable pipeline state lives in opportunities
    notes: text("notes"),
  },
  (table) => [index("clusters_status_score_idx").on(table.status, table.opportunityScore)],
);

export const opportunities = sqliteTable(
  "opportunities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clusterId: integer("cluster_id").notNull().references(() => clusters.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: ["new", "watching", "validating", "pursue", "building", "launched", "killed", "archived"] })
      .notNull()
      .default("new"),
    owner: text("owner"),
    thesis: text("thesis"),
    nextAction: text("next_action"),
    nextActionDueAt: text("next_action_due_at"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
    launchedAt: text("launched_at"),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("opportunities_cluster_id_uidx").on(table.clusterId),
    index("opportunities_stage_idx").on(table.stage),
    index("opportunities_next_action_due_idx").on(table.nextActionDueAt),
  ],
);

export const opportunityEvents = sqliteTable(
  "opportunity_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [
    index("opportunity_events_opportunity_idx").on(table.opportunityId),
    index("opportunity_events_created_idx").on(table.createdAt),
  ],
);

export const scoreSnapshots = sqliteTable(
  "score_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    score: real("score"),
    demand: real("demand"),
    ease: real("ease"),
    pain: real("pain"),
    intent: real("intent"),
    momentum: real("momentum"),
    capturedAt: text("captured_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("score_snapshots_opportunity_captured_idx").on(table.opportunityId, table.capturedAt)],
);

export const analyses = sqliteTable(
  "analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    analysisType: text("analysis_type").notNull(),
    model: text("model"),
    version: text("version"),
    inputHash: text("input_hash"),
    contextJson: text("context_json"),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("analyses_opportunity_created_idx").on(table.opportunityId, table.createdAt)],
);

export const productBriefs = sqliteTable(
  "product_briefs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    briefJson: text("brief_json").notNull(),
    markdown: text("markdown").notNull(),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("product_briefs_opportunity_version_uidx").on(table.opportunityId, table.version),
    index("product_briefs_opportunity_created_idx").on(table.opportunityId, table.createdAt),
  ],
);

export const experiments = sqliteTable(
  "experiments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    hypothesis: text("hypothesis").notNull(),
    method: text("method"),
    successCriterion: text("success_criterion"),
    status: text("status", { enum: ["planned", "running", "passed", "failed", "inconclusive", "cancelled"] })
      .notNull()
      .default("planned"),
    result: text("result"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("experiments_opportunity_status_idx").on(table.opportunityId, table.status)],
);

export const interviews = sqliteTable(
  "interviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    participant: text("participant"),
    notes: text("notes").notNull(),
    painStrength: integer("pain_strength"),
    willingnessToPay: text("willingness_to_pay"),
    sourceUrl: text("source_url"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("interviews_opportunity_occurred_idx").on(table.opportunityId, table.occurredAt)],
);

export const competitors = sqliteTable(
  "competitors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url"),
    type: text("type"),
    positioning: text("positioning"),
    pricingNotes: text("pricing_notes"),
    strengths: text("strengths"),
    gaps: text("gaps"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("competitors_opportunity_idx").on(table.opportunityId)],
);

export const opportunityLinks = sqliteTable(
  "opportunity_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label"),
    url: text("url").notNull(),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("opportunity_links_opportunity_kind_idx").on(table.opportunityId, table.kind)],
);

export const outcomes = sqliteTable(
  "outcomes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    numericValue: real("numeric_value"),
    textValue: text("text_value"),
    period: text("period"),
    observedAt: text("observed_at").notNull().default(sql`(current_timestamp)`),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (table) => [index("outcomes_opportunity_observed_idx").on(table.opportunityId, table.observedAt)],
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
