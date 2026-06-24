-- Verification Links (no-code shareable KYC links)
-- Merchants create links that auto-create a session and launch the widget.
-- No developer integration required from the end-client.

CREATE TABLE IF NOT EXISTS verification_links (
  id TEXT PRIMARY KEY,                  -- lnk_abc123
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  name TEXT NOT NULL,                   -- human label, e.g. "Customer Onboarding"
  slug TEXT NOT NULL UNIQUE,            -- URL-safe slug, e.g. "zeeh-onboard-2026"
  is_active INTEGER NOT NULL DEFAULT 1,
  single_use INTEGER NOT NULL DEFAULT 0, -- if 1, deactivate after first session created
  sessions_created INTEGER NOT NULL DEFAULT 0,
  redirect_url TEXT,                    -- where to send user after widget completes
  metadata TEXT,                        -- JSON merged into every session created from this link
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER                    -- optional Unix expiry
);

CREATE INDEX IF NOT EXISTS idx_verification_links_merchant ON verification_links(merchant_id);
CREATE INDEX IF NOT EXISTS idx_verification_links_slug ON verification_links(slug);

ALTER TABLE sessions ADD COLUMN verification_link_id TEXT REFERENCES verification_links(id);
