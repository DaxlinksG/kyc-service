import { getDb } from '../db/client.js';
import type { DbSelfieCheck, DbAddressCheck, DbSession, DbPepCheck } from '../db/schema.js';
import type { RiskScore } from '../types/domain.js';
import { selectBestIdentityDoc } from '../lib/identityDoc.js';
import { env } from '../config/env.js';

// Human-readable explanations, keyed by hard-fail code. Surfaced to testers,
// merchants, and end users so a rejection/review is never an opaque dead end.
const HARD_FAIL_REASONS: Record<string, string> = {
  expired_document: 'The identity document has expired.',
  no_face_in_selfie: 'No face could be detected in the selfie.',
  document_unreadable: "The identity document couldn't be read clearly. A reviewer will verify it manually.",
  liveness_check_failed: "The liveness check didn't pass — please retake the selfie in good lighting.",
  face_mismatch: "The selfie doesn't match the face on the identity document.",
  passport_no_mrz: "The passport's machine-readable zone couldn't be read. A reviewer will verify it manually.",
  sanctions_hit: 'The applicant matched a sanctions or watchlist record.',
  duplicate_face: 'This face is already linked to a different verified identity.',
};

// Quality / capture failures are NOT evidence of fraud — an OCR miss or an
// unreadable MRZ on an otherwise-genuine document should go to a human reviewer,
// never an automatic rejection. Everything else (mismatched face, sanctions,
// duplicate identity, expired doc, failed liveness) is substantive and still
// auto-rejects. This is stricter coverage (adds human oversight), not relaxed
// security: a real fraud signal never gets downgraded to review.
const QUALITY_HARD_FAILS = new Set(['document_unreadable', 'passport_no_mrz']);

export class RiskScoringService {
  score(sessionId: string): RiskScore {
    const db = getDb();

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as DbSession | undefined;
    const identityReused = !!session?.identity_id;

    // Best identity-bearing document across both sides (barcode-verified > MRZ > OCR).
    // For North American DL/ID cards the authoritative data is the AAMVA barcode on
    // the BACK, so we must not restrict to side='FRONT'.
    const bestDoc = selectBestIdentityDoc(db, sessionId);
    const document = bestDoc?.doc;

    const selfie = db
      .prepare('SELECT * FROM selfie_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as DbSelfieCheck | undefined;

    const address = db
      .prepare('SELECT * FROM address_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as DbAddressCheck | undefined;

    const pepCheck = db
      .prepare('SELECT * FROM pep_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as DbPepCheck | undefined;

    const hardFails: string[] = [];

    // Extract scores (default 0 if not available)
    const documentConfidence = document?.confidence ?? 0;
    const livenessScore = selfie?.liveness_score ?? 0;
    const matchScore = selfie?.match_score ?? 0;
    const addressNameMatch = address?.name_match_score ?? 0;

    // Hard fail conditions
    const docParsed = bestDoc?.parsed ?? null;
    if (docParsed?.isExpired) hardFails.push('expired_document');
    if (selfie && !selfie.face_detected) hardFails.push('no_face_in_selfie');
    if (document && documentConfidence < 0.1) hardFails.push('document_unreadable');
    // livenessScore === 0 with face_detected=true (e.g. DetectFaces returned 0 quality) is also a fail
    if (livenessScore < 0.3) hardFails.push('liveness_check_failed');

    // Face match: the selfie must match the ID document face. Only gate when a face was
    // actually detected in the selfie (no_face_in_selfie covers the missing-face case);
    // a match below the threshold means the selfie is a different person than the ID.
    if (selfie?.face_detected && matchScore < env.FACE_MATCH_THRESHOLD) hardFails.push('face_mismatch');

    // Passport MUST have MRZ — unless identity is being reused (document already
    // validated in a prior approved session; only liveness is required this time)
    if (!identityReused && document?.document_type === 'PASSPORT' && docParsed?.mrzDetected === false) {
      hardFails.push('passport_no_mrz');
    }

    // PEP / sanctions screening (only present if merchant has it enabled)
    if (pepCheck?.status === 'DONE') {
      if (pepCheck.result === 'sanctions_hit') hardFails.push('sanctions_hit');
      // pep_hit alone does not hard-fail — it forces manual_review via decision override below
    }

    // Face deduplication — same face under a different approved identity = fraud
    if (selfie?.duplicate_session_id) {
      const matchedSession = db.prepare('SELECT identity_id FROM sessions WHERE id = ?').get(selfie.duplicate_session_id) as { identity_id: string | null } | undefined;
      const currentSession = db.prepare('SELECT identity_id FROM sessions WHERE id = ?').get(sessionId) as { identity_id: string | null } | undefined;
      // Only flag if the identities differ (same person re-verifying is expected and fine)
      const sameIdentity = matchedSession?.identity_id && currentSession?.identity_id
        && matchedSession.identity_id === currentSession.identity_id;
      if (!sameIdentity) {
        hardFails.push('duplicate_face');
      }
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

    // Separate substantive fraud signals from recoverable capture/quality problems.
    const securityFails = hardFails.filter((f) => !QUALITY_HARD_FAILS.has(f));
    const qualityFails = hardFails.filter((f) => QUALITY_HARD_FAILS.has(f));

    let decision: RiskScore['decision'];
    if (securityFails.length > 0) {
      // A real fraud signal — reject.
      decision = 'rejected';
    } else if (qualityFails.length > 0) {
      // Document couldn't be read, but nothing substantive failed (e.g. the face
      // still matched and liveness passed). Route to a human instead of rejecting
      // a potentially genuine applicant.
      decision = 'manual_review';
    } else if (baseScore >= env.RISK_APPROVE_THRESHOLD) {
      decision = 'approved';
    } else if (baseScore >= env.RISK_MANUAL_THRESHOLD) {
      decision = 'manual_review';
    } else {
      decision = 'rejected';
    }

    // PEP hit forces manual review regardless of score (unless already rejected/hard-failed)
    if (decision === 'approved' && pepCheck?.result === 'pep_hit') {
      decision = 'manual_review';
    }

    // Governing reason: the first hard fail explains a reject/review directly; a
    // low-score reject/review without a hard fail gets a generic score explanation.
    const governingFail = securityFails[0] ?? qualityFails[0];
    let reason: string | undefined;
    if (governingFail) {
      reason = HARD_FAIL_REASONS[governingFail] ?? 'The verification could not be completed automatically.';
    } else if (decision === 'manual_review') {
      reason = pepCheck?.result === 'pep_hit'
        ? 'The applicant matched a politically-exposed-person record and needs a manual review.'
        : 'The verification needs a manual review before it can be approved.';
    } else if (decision === 'rejected') {
      reason = 'The verification did not meet the required confidence to be approved.';
    }

    return {
      score: Math.round(baseScore * 100) / 100,
      decision,
      ...(reason ? { reason } : {}),
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
