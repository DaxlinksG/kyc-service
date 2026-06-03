ALTER TABLE sessions ADD COLUMN external_id TEXT;
CREATE INDEX idx_sessions_external_id ON sessions(merchant_id, external_id);
