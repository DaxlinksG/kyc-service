import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import type { DbKycIdentity, DbDocument } from '../db/schema.js';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Normalise a name string for hashing — remove extra whitespace, uppercase, collapse diacritics.
 */
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute the deterministic identity hash from MRZ fields.
 * SHA-256( normalize(fullName) + ":" + dateOfBirth + ":" + documentNumber )
 */
export function computeIdentityHash(fullName: string, dateOfBirth: string, documentNumber: string): string {
  const input = `${normalizeName(fullName)}:${dateOfBirth}:${documentNumber.toUpperCase()}`;
  return createHash('sha256').update(input).digest('hex');
}

export class IdentityService {
  /**
   * After a session is approved: compute the identity hash from the session's MRZ data
   * and upsert a kyc_identities record. Links the session in kyc_identity_sessions.
   * Returns the identity id.
   */
  async recordApprovedIdentity(sessionId: string, merchantId: string): Promise<string | null> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Get the best document with MRZ data
    const doc = db.prepare(`
      SELECT * FROM documents
      WHERE session_id = ? AND side = 'FRONT' AND status = 'DONE'
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionId) as DbDocument | undefined;

    if (!doc?.ocr_parsed) return null;

    let parsed: Record<string, any>;
    try { parsed = JSON.parse(doc.ocr_parsed); } catch { return null; }

    const { fullName, dateOfBirth, documentNumber, mrzDetected } = parsed;
    if (!mrzDetected || !fullName || !dateOfBirth || !documentNumber) return null;

    const hash = computeIdentityHash(fullName, dateOfBirth, documentNumber);

    // Upsert identity (update timestamps if exists, rolling 1-year expiry)
    let identity = db.prepare('SELECT * FROM kyc_identities WHERE identity_hash = ?').get(hash) as DbKycIdentity | undefined;

    if (identity) {
      db.prepare(`
        UPDATE kyc_identities
        SET last_approved_at = ?, expires_at = ?
        WHERE id = ?
      `).run(now, now + ONE_YEAR_SECONDS, identity.id);
    } else {
      const id = `kid_${nanoid(12)}`;
      db.prepare(`
        INSERT INTO kyc_identities (id, identity_hash, first_approved_at, last_approved_at, expires_at, source_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, hash, now, now, now + ONE_YEAR_SECONDS, sessionId);
      identity = db.prepare('SELECT * FROM kyc_identities WHERE id = ?').get(id) as DbKycIdentity;
    }

    // Link this session to the identity
    const alreadyLinked = db.prepare('SELECT 1 FROM kyc_identity_sessions WHERE session_id = ?').get(sessionId);
    if (!alreadyLinked) {
      db.prepare(`
        INSERT INTO kyc_identity_sessions (id, identity_id, session_id, merchant_id, linked_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(`kis_${nanoid(12)}`, identity.id, sessionId, merchantId, now);
    }

    // Tag session with identity_id
    db.prepare('UPDATE sessions SET identity_id = ? WHERE id = ?').run(identity.id, sessionId);

    return identity.id;
  }

  /**
   * After document is processed: check if the MRZ data matches a known approved identity.
   * If found and not expired, tag the session and link it.
   * Returns the identity if matched, null otherwise.
   */
  checkIdentityMatch(sessionId: string, merchantId: string): DbKycIdentity | null {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const doc = db.prepare(`
      SELECT * FROM documents
      WHERE session_id = ? AND side = 'FRONT' AND status = 'DONE'
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionId) as DbDocument | undefined;

    if (!doc?.ocr_parsed) return null;

    let parsed: Record<string, any>;
    try { parsed = JSON.parse(doc.ocr_parsed); } catch { return null; }

    const { fullName, dateOfBirth, documentNumber, mrzDetected } = parsed;
    if (!mrzDetected || !fullName || !dateOfBirth || !documentNumber) return null;

    const hash = computeIdentityHash(fullName, dateOfBirth, documentNumber);

    const identity = db.prepare(`
      SELECT * FROM kyc_identities
      WHERE identity_hash = ? AND expires_at > ?
    `).get(hash, now) as DbKycIdentity | undefined;

    if (!identity) return null;

    // Tag the session so scoring knows it's a reuse
    db.prepare('UPDATE sessions SET identity_id = ? WHERE id = ?').run(identity.id, sessionId);

    // Link for audit trail (if not already linked)
    const alreadyLinked = db.prepare('SELECT 1 FROM kyc_identity_sessions WHERE session_id = ?').get(sessionId);
    if (!alreadyLinked) {
      db.prepare(`
        INSERT INTO kyc_identity_sessions (id, identity_id, session_id, merchant_id, linked_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(`kis_${nanoid(12)}`, identity.id, sessionId, merchantId, now);
    }

    return identity;
  }
}
