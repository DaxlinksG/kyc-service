PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_merchant ON api_keys(merchant_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  state TEXT NOT NULL DEFAULT 'created',
  session_token_hash TEXT NOT NULL,
  metadata TEXT, -- JSON blob
  redirect_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_merchant ON sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  document_type TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'FRONT',
  storage_path TEXT NOT NULL,
  ocr_raw TEXT, -- JSON
  ocr_parsed TEXT, -- JSON
  face_descriptor TEXT, -- JSON float array
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);

CREATE TABLE IF NOT EXISTS selfie_checks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  storage_path TEXT NOT NULL,
  face_detected INTEGER, -- boolean
  liveness_score REAL,
  match_score REAL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_selfie_session ON selfie_checks(session_id);

CREATE TABLE IF NOT EXISTS address_checks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  document_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  ocr_raw TEXT, -- JSON
  ocr_parsed TEXT, -- JSON
  name_match_score REAL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_address_session ON address_checks(session_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  actor_type TEXT NOT NULL, -- 'api_key' | 'session_token' | 'system'
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT, -- JSON
  prev_hash TEXT,
  row_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
