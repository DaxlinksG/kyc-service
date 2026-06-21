import { getDb } from '../db/client.js';
import type { DbDocument, DbSelfieCheck, DbAddressCheck, DbSession } from '../db/schema.js';
import type { RiskScore } from '../types/domain.js';
import { env } from '../config/env.js';

export class RiskScoringService {
  score(sessionId: string): RiskScore {
    const db = getDb();

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as DbSession | undefined;
    const identityReused = !!session?.identity_id;

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

    // Passport MUST have MRZ — unless identity is being reused (document already
    // validated in a prior approved session; only liveness is required this time)
    if (!identityReused && document?.document_type === 'PASSPORT' && docParsed?.mrzDetected === false) {
      hardFails.push('passport_no_mrz');
    }

    // Address name match of 0 when an address check was completed means the name on the
    // address doc doesn't match the ID at all — weight the address score by both
    // OCR confidence AND name match so a 0% name match tanks the address contribution.
    const addressConfidence = address?.confidence ?? 0;
    const effectiveAddressScore = address
      ? addressConfidence * addressNameMatch  // both must be non-zero to contribute
      : 0;

    // Identity reuse: document was already validated in a prior approved session.
    // Give doc and address full marks — only liveness + face match matter today.
    const effectiveDocConfidence = identityReused ? Math.max(documentConfidence, 0.9) : documentConfidence;
    const effectiveAddressForScore = identityReused ? 0.9 : effectiveAddressScore;

    const baseScore =
      hardFails.length > 0
        ? 0
        : effectiveDocConfidence * 0.35 +
          livenessScore * 0.30 +
          matchScore * 0.25 +
          effectiveAddressForScore * 0.10;

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
