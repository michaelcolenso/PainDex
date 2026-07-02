-- PainDex v1.0 initial schema

CREATE TABLE IF NOT EXISTS subreddits (
  name TEXT PRIMARY KEY,
  subscribers INTEGER,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  added_at TEXT NOT NULL DEFAULT (current_timestamp),
  last_fetched_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_query TEXT NOT NULL,
  label TEXT NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL DEFAULT (current_timestamp),
  last_seen TEXT NOT NULL DEFAULT (current_timestamp),
  velocity_30d REAL,
  avg_intent REAL,
  volume INTEGER,
  kd INTEGER,
  cpc REAL,
  keyword_checked_at TEXT,
  opportunity_score REAL,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  created_utc INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  num_comments INTEGER NOT NULL DEFAULT 0,
  passed_prefilter INTEGER NOT NULL DEFAULT 0,
  is_question INTEGER,
  commercial_intent INTEGER,
  pain_category TEXT,
  extracted_query TEXT,
  cluster_id INTEGER REFERENCES clusters(id),
  classify_failed INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (current_timestamp),
  kind TEXT NOT NULL,
  subs_processed INTEGER NOT NULL DEFAULT 0,
  posts_fetched INTEGER NOT NULL DEFAULT 0,
  posts_classified INTEGER NOT NULL DEFAULT 0,
  clusters_created INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS posts_cluster_id_idx ON posts(cluster_id);
CREATE INDEX IF NOT EXISTS posts_subreddit_created_idx ON posts(subreddit, created_utc);
CREATE INDEX IF NOT EXISTS clusters_status_score_idx ON clusters(status, opportunity_score);
