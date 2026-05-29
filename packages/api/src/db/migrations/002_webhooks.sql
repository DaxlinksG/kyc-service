CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]', -- JSON array of event types
  signing_secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, -- boolean
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_webhooks_merchant ON webhook_endpoints(merchant_id, active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  event TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | DELIVERED | FAILED
  attempts INTEGER NOT NULL DEFAULT 0,
  last_response_status INTEGER,
  last_error TEXT,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON webhook_deliveries(status, next_retry_at);
