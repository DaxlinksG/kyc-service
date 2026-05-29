import { createWorker } from 'tesseract.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import type { DbAddressCheck, DbDocument } from '../db/schema.js';
import { preprocessForOcr, pdfToImage } from '../lib/imagePreprocessor.js';
import { parseAddressDocument, nameMatchScore } from '../lib/ocrParsers/addressParser.js';
import { env } from '../config/env.js';

export class AddressService {
  async process(addressId: string): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare("UPDATE address_checks SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(now, addressId);

    const check = db.prepare('SELECT * FROM address_checks WHERE id = ?').get(addressId) as DbAddressCheck | undefined;
    if (!check) throw new Error(`Address check not found: ${addressId}`);

    try {
      let imageBuffer: Buffer = readFileSync(join(env.STORAGE_PATH, check.storage_path));

      if (check.storage_path.endsWith('.pdf')) {
        imageBuffer = await pdfToImage(imageBuffer);
      }

      const preprocessed = await preprocessForOcr(imageBuffer);
      const worker = await createWorker('eng');
      let rawText = '';
      let confidence = 0;

      try {
        const result = await worker.recognize(preprocessed);
        rawText = result.data.text;
        confidence = result.data.confidence / 100;
      } finally {
        await worker.terminate();
      }

      const parsed = parseAddressDocument(rawText);

      // Check issue date staleness
      if (parsed.issueDate) {
        const issueMs = new Date(parsed.issueDate).getTime();
        const ageMs = Date.now() - issueMs;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        parsed.isStale = ageDays > env.ADDRESS_DOC_MAX_AGE_DAYS;
      }

      // Name match against session's document name
      let nameMatch = 0;
      const docParsedRow = db.prepare(`
        SELECT ocr_parsed FROM documents WHERE session_id = ? AND ocr_parsed IS NOT NULL LIMIT 1
      `).get(check.session_id) as { ocr_parsed: string } | undefined;

      if (docParsedRow && parsed.fullName) {
        const docParsed = JSON.parse(docParsedRow.ocr_parsed);
        const docName: string = docParsed.fullName ?? `${docParsed.firstName ?? ''} ${docParsed.lastName ?? ''}`.trim();
        nameMatch = nameMatchScore(docName, parsed.fullName);
      }

      db.prepare(`
        UPDATE address_checks
        SET status = 'DONE', ocr_raw = ?, ocr_parsed = ?, name_match_score = ?, confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ text: rawText }),
        JSON.stringify(parsed),
        nameMatch,
        confidence,
        now,
        addressId,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE address_checks SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?").run(
        error, now, addressId,
      );
      throw err;
    }
  }
}
