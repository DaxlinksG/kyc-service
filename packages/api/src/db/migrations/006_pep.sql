-- PEP / Sanctions Screening (opt-in per merchant)
-- Data sourced from OFAC SDN list and UN Consolidated Sanctions list (free, public).
-- Synced weekly via background job.

-- Per-merchant feature flag
ALTER TABLE merchants ADD COLUMN pep_screening_enabled INTEGER NOT NULL DEFAULT 0;

-- FTS5 virtual table for fast fuzzy name search across all lists
-- Note: FTS5 columns cannot have type declarations — all values stored as TEXT.
-- is_sanctions stores '1' or '0' as text; cast when reading.
CREATE VIRTUAL TABLE IF NOT EXISTS pep_entries USING fts5(
  entry_id UNINDEXED,   -- stable unique key from source (e.g. OFAC uid, UN ref)
  list_source UNINDEXED, -- 'OFAC_SDN' | 'UN_CONSOLIDATED'
  entry_type UNINDEXED, -- 'individual' | 'entity'
  full_name,            -- primary name (tokenised + indexed)
  aliases,              -- pipe-separated alt names (also indexed by FTS5)
  date_of_birth UNINDEXED, -- YYYY-MM-DD or partial (YYYY only)
  nationality UNINDEXED, -- ISO-3166-1 alpha-2 or free text
  program UNINDEXED,    -- sanctions program / designation (e.g. "SDGT", "DPRK")
  is_sanctions UNINDEXED, -- '1' = hard sanctions, '0' = PEP-only
  tokenize='porter ascii'
);

-- Per-session PEP screening result
CREATE TABLE IF NOT EXISTS pep_checks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | DONE | FAILED
  result TEXT,          -- 'clear' | 'pep_hit' | 'sanctions_hit'
  matched_entry_id TEXT,
  matched_name TEXT,
  matched_list TEXT,
  match_score REAL,     -- fuzzy similarity 0–1
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_pep_checks_session ON pep_checks(session_id);

-- Track list sync metadata
CREATE TABLE IF NOT EXISTS pep_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_source TEXT NOT NULL,
  entries_loaded INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  error TEXT
);
