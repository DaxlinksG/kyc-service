import { getDb } from '../db/client.js';
import type { DbDocument, DbSelfieCheck, DbAddressCheck } from '../db/schema.js';
import type { RiskScore } from '../types/domain.js';
import { env } from '../config/env.js';

export class RiskScoringService {
  score(sessionId: string): RiskScore {
    const db = getDb();

    const document = db
      .prepare("SELECT * FROM documents WHERE session_id = ? AND side = 'FRONT' ORDER BY created_at DESC LIMIT 1")
      .get(sessionId) as DbDocument | undefined;

    const selfie = db
      .prepare('SELECT * FROM selfie_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as DbSelfieCheck | undefined;

    const address = db
      .prepare('SELECT * FROM address_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as DbAddressCheck | undefined;

    const hardFails: string[] = [];

    // Extract scores (default 0 if not available)
    const documentConfidence = document?.confidence ?? 0;
    const livenessScore = selfie?.liveness_score ?? 0;
    const matchScore = selfie?.match_score ?? 0;
    const addressNameMatch = address?.name_match_score ?? 0;

    // Hard fail conditions
    const docParsed = document?.ocr_parsed ? JSON.parse(document.ocr_parsed) : null;
    if (docParsed?.isExpired) hardFails.push('expired_document');
    if (selfie && !selfie.face_detected) hardFails.push('no_face_in_selfie');
    if (document && documentConfidence < 0.1) hardFails.push('document_unreadable');
    if (livenessScore > 0 && livenessScore < 0.3) hardFails.push('liveness_check_failed');

    const baseScore =
      hardFails.length > 0
        ? 0
        : documentConfidence * 0.35 +
          livenessScore * 0.30 +
          matchScore * 0.25 +
          addressNameMatch * 0.10;

    let decision: RiskScore['decision'];
    if (baseScore >= env.RISK_APPROVE_THRESHOLD) {
      decision = 'approved';
    } else if (baseScore >= env.RISK_MANUAL_THRESHOLD) {
      decision = 'manual_review';
    } else {
      decision = 'rejected';
    }

    return {
      score: Math.round(baseScore * 100) / 100,
      decision,
      factors: {
        documentConfidence,
        livenessScore,
        matchScore,
        addressNameMatch,
        hardFails,
      },
    };
  }
}
