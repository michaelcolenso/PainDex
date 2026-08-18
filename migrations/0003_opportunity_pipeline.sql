PRAGMA foreign_keys = ON;

CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL UNIQUE,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','watching','validating','pursue','building','launched','killed','archived')),
  owner TEXT,
  thesis TEXT,
  next_action TEXT,
  next_action_due_at TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  launched_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);
CREATE INDEX opportunities_stage_idx ON opportunities(stage);
CREATE INDEX opportunities_next_action_due_idx ON opportunities(next_action_due_at);

CREATE TABLE opportunity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX opportunity_events_opportunity_idx ON opportunity_events(opportunity_id);
CREATE INDEX opportunity_events_created_idx ON opportunity_events(created_at);

CREATE TABLE score_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  score REAL,
  demand REAL,
  ease REAL,
  pain REAL,
  intent REAL,
  momentum REAL,
  captured_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX score_snapshots_opportunity_captured_idx ON score_snapshots(opportunity_id, captured_at);

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  analysis_type TEXT NOT NULL,
  model TEXT,
  version TEXT,
  input_hash TEXT,
  context_json TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX analyses_opportunity_created_idx ON analyses(opportunity_id, created_at);

CREATE TABLE product_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  brief_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  UNIQUE (opportunity_id, version)
);
CREATE INDEX product_briefs_opportunity_created_idx ON product_briefs(opportunity_id, created_at);

CREATE TABLE experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  hypothesis TEXT NOT NULL,
  method TEXT,
  success_criterion TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','passed','failed','inconclusive','cancelled')),
  result TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX experiments_opportunity_status_idx ON experiments(opportunity_id, status);

CREATE TABLE interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  participant TEXT,
  notes TEXT NOT NULL,
  pain_strength INTEGER CHECK (pain_strength IS NULL OR (pain_strength >= 0 AND pain_strength <= 10)),
  willingness_to_pay TEXT,
  source_url TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX interviews_opportunity_occurred_idx ON interviews(opportunity_id, occurred_at);

CREATE TABLE competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  type TEXT,
  positioning TEXT,
  pricing_notes TEXT,
  strengths TEXT,
  gaps TEXT,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX competitors_opportunity_idx ON competitors(opportunity_id);

CREATE TABLE opportunity_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);
CREATE INDEX opportunity_links_opportunity_kind_idx ON opportunity_links(opportunity_id, kind);

CREATE TABLE outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL,
  metric TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  period TEXT,
  observed_at TEXT NOT NULL DEFAULT (current_timestamp),
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  CHECK (numeric_value IS NOT NULL OR text_value IS NOT NULL)
);
CREATE INDEX outcomes_opportunity_observed_idx ON outcomes(opportunity_id, observed_at);
