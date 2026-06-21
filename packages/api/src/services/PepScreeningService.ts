/**
 * PepScreeningService — screens a session's identity against the indexed PEP/sanctions lists.
 *
 * Uses SQLite FTS5 full-text search for fast fuzzy name matching.
 * DOB is used as a tiebreaker / filter when available (reduces false positives).
 *
 * Results:
 *   clear         — no match found
 *   pep_hit       — name match on a PEP-only entry → forces manual_review
 *   sanctions_hit — name match on a sanctions entry → hard fail (rejected)
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import type { DbDocument, DbPepCheck } from '../db/schema.js';

// Minimum FTS5 rank score to consider a match (lower = stricter; FTS5 ranks are negative)
// -1.0 is roughly "all query terms matched at least once"
const MATCH_RANK_THRESHOLD = -1.0;

export class PepScreeningService {
  async screen(sessionId: string): Promise<DbPepCheck> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const checkId = `pep_${nanoid(12)}`;

    // Insert pending record
    db.prepare(`
      INSERT INTO pep_checks (id, session_id, status, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?)
    `).run(checkId, sessionId, now, now);

    try {
      const doc = db.prepare(`
        SELECT * FROM documents
        WHERE session_id = ? AND side = 'FRONT' AND status = 'DONE'
        ORDER BY created_at DESC LIMIT 1
      `).get(sessionId) as DbDocument | undefined;

      if (!doc?.ocr_parsed) {
        return this.markDone(checkId, 'clear', null, now);
      }

      let parsed: Record<string, any>;
      try { parsed = JSON.parse(doc.ocr_parsed); } catch {
        return this.markDone(checkId, 'clear', null, now);
      }

      const { fullName, dateOfBirth } = parsed;
      if (!fullName) {
        return this.markDone(checkId, 'clear', null, now);
      }

      const hit = this.searchName(fullName, dateOfBirth);

      if (!hit) {
        return this.markDone(checkId, 'clear', null, now);
      }

      const result = hit.is_sanctions ? 'sanctions_hit' : 'pep_hit';
      return this.markDone(checkId, result, hit, now);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE pep_checks SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?
      `).run(error, now, checkId);
      return db.prepare('SELECT * FROM pep_checks WHERE id = ?').get(checkId) as DbPepCheck;
    }
  }

  private searchName(
    fullName: string,
    dateOfBirth?: string,
  ): { entry_id: string; full_name: string; list_source: string; is_sanctions: number; rank: number } | null {
    const db = getDb();

    // Build FTS5 query — each word is a separate required term
    const terms = fullName
      .toUpperCase()
      .replace(/[^A-Z\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return null;

    // Search against full_name and aliases columns
    // FTS5 rank: more negative = better match
    const ftsQuery = terms.map(t => `"${t}"`).join(' ');

    const rows = db.prepare(`
      SELECT entry_id, full_name, list_source, is_sanctions, rank
      FROM pep_entries
      WHERE pep_entries MATCH ?
        AND rank < ?
      ORDER BY rank
      LIMIT 10
    `).all(ftsQuery, MATCH_RANK_THRESHOLD) as Array<{
      entry_id: string; full_name: string; list_source: string; is_sanctions: number; rank: number;
    }>;

    if (rows.length === 0) return null;

    // If DOB is available, prefer entries where DOB matches or is unknown
    if (dateOfBirth) {
      const dobYear = dateOfBirth.split('-')[0];

      // Try strict DOB match first
      for (const row of rows) {
        const entryDob = (db.prepare('SELECT date_of_birth FROM pep_entries WHERE entry_id = ?').get(row.entry_id) as any)?.date_of_birth ?? '';
        if (entryDob && (entryDob === dateOfBirth || entryDob.startsWith(dobYear))) {
          return row; // confirmed match: name + DOB year align
        }
      }

      // If no DOB match, only flag if the best-ranking name hit has no DOB (can't rule out)
      const best = rows[0] ?? null;
      if (!best) return null;
      const bestDob = (db.prepare('SELECT date_of_birth FROM pep_entries WHERE entry_id = ?').get(best.entry_id) as any)?.date_of_birth ?? '';
      if (bestDob) {
        // Entry has a DOB but it doesn't match — likely a different person
        return null;
      }
      return best;
    }

    // No DOB to compare — return best name match
    return rows[0] ?? null;
  }

  private markDone(
    checkId: string,
    result: 'clear' | 'pep_hit' | 'sanctions_hit',
    hit: { entry_id: string; full_name: string; list_source: string; rank: number } | null,
    now: number,
  ): DbPepCheck {
    const db = getDb();
    const matchScore = hit ? Math.min(1, Math.abs(hit.rank) / 5) : null;

    db.prepare(`
      UPDATE pep_checks
      SET status = 'DONE', result = ?, matched_entry_id = ?, matched_name = ?,
          matched_list = ?, match_score = ?, updated_at = ?
      WHERE id = ?
    `).run(
      result,
      hit?.entry_id ?? null,
      hit?.full_name ?? null,
      hit?.list_source ?? null,
      matchScore,
      now,
      checkId,
    );

    return db.prepare('SELECT * FROM pep_checks WHERE id = ?').get(checkId) as DbPepCheck;
  }
}
