-- KYC Identity Reuse
-- Stores a deterministic hash of a verified person (name:dob:docnumber from MRZ).
-- When the same person verifies on another merchant's platform, we can auto-approve
-- the document step and skip address proof — liveness is always required.

CREATE TABLE IF NOT EXISTS kyc_identities (
  id TEXT PRIMARY KEY,
  identity_hash TEXT UNIQUE NOT NULL,   -- SHA-256 of normalize(fullName):dob:docNumber
  first_approved_at INTEGER NOT NULL,
  last_approved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,           -- rolling 1-year TTL from last approval
  source_session_id TEXT NOT NULL REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_kyc_identities_hash ON kyc_identities(identity_hash);
CREATE INDEX IF NOT EXISTS idx_kyc_identities_expires ON kyc_identities(expires_at);

-- Track which sessions used a known identity (cross-merchant audit trail)
CREATE TABLE IF NOT EXISTS kyc_identity_sessions (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES kyc_identities(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  merchant_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_kyc_identity_sessions_identity ON kyc_identity_sessions(identity_id);
CREATE INDEX IF NOT EXISTS idx_kyc_identity_sessions_session ON kyc_identity_sessions(session_id);

-- Add identity_id to sessions so scoring can detect reuse
ALTER TABLE sessions ADD COLUMN identity_id TEXT REFERENCES kyc_identities(id);
