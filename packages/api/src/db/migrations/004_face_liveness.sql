-- Add face_liveness_session_id to selfie_checks
-- Used when AWS Face Liveness (active challenge) is used instead of static selfie upload
ALTER TABLE selfie_checks ADD COLUMN face_liveness_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_selfie_face_liveness ON selfie_checks (face_liveness_session_id);
