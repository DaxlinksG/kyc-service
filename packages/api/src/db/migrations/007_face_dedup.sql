-- Face deduplication via AWS Rekognition Face Collections
-- Approved faces are indexed; every new selfie is searched before approval.
-- A high-similarity match under a DIFFERENT identity = duplicate_face hard fail.

CREATE TABLE IF NOT EXISTS face_index (
  id TEXT PRIMARY KEY,
  face_id TEXT NOT NULL UNIQUE,        -- Rekognition FaceId (UUID)
  session_id TEXT NOT NULL REFERENCES sessions(id),
  merchant_id TEXT NOT NULL,
  identity_id TEXT REFERENCES kyc_identities(id),
  indexed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_face_index_session ON face_index(session_id);

-- Store dedup result on the selfie_check row
ALTER TABLE selfie_checks ADD COLUMN duplicate_face_id TEXT;      -- Rekognition FaceId of the match
ALTER TABLE selfie_checks ADD COLUMN duplicate_session_id TEXT;   -- session_id of the matching face
ALTER TABLE selfie_checks ADD COLUMN duplicate_similarity REAL;   -- 0–1 similarity score
