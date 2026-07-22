import type Database from 'better-sqlite3';
import type { DbDocument } from '../db/schema.js';
import type { ParsedDocument } from '../types/domain.js';

export interface IdentityDoc {
  doc: DbDocument;
  parsed: ParsedDocument;
}

/**
 * Rank a processed document by how authoritative its identity data is:
 *   barcode-verified (AAMVA PDF417) > MRZ-verified > plain OCR.
 * Within a tier, higher OCR/parse confidence wins.
 */
function identityRank(doc: DbDocument, parsed: ParsedDocument): number {
  let tier = 0;
  if (parsed.barcodeVerified) tier = 2;
  else if (parsed.mrzDetected) tier = 1;
  return tier * 1000 + (doc.confidence ?? 0);
}

/**
 * Pick the single best identity-bearing document for a session across BOTH sides.
 *
 * Historically identity/scoring only ever read the FRONT document, but for North
 * American driver's licenses and provincial ID cards the machine-readable identity
 * data lives in the AAMVA barcode on the BACK. This selector considers every DONE
 * document and returns the most authoritative one, so barcode data feeds identity
 * reuse and risk scoring instead of being ignored.
 */
export function selectBestIdentityDoc(db: Database.Database, sessionId: string): IdentityDoc | null {
  const docs = db.prepare(`
    SELECT * FROM documents
    WHERE session_id = ? AND status = 'DONE'
    ORDER BY created_at DESC
  `).all(sessionId) as DbDocument[];

  let best: IdentityDoc | null = null;
  let bestRank = -1;

  for (const doc of docs) {
    if (!doc.ocr_parsed) continue;
    let parsed: ParsedDocument;
    try { parsed = JSON.parse(doc.ocr_parsed); } catch { continue; }
    const rank = identityRank(doc, parsed);
    if (rank > bestRank) {
      bestRank = rank;
      best = { doc, parsed };
    }
  }

  return best;
}
