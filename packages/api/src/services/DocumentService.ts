import { createWorker } from 'tesseract.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import type { DbDocument } from '../db/schema.js';
import { preprocessForOcr, cropMrzZone, pdfToImage } from '../lib/imagePreprocessor.js';
import { extractMrzLines, parseMrz } from '../lib/ocrParsers/mrzParser.js';
import { parseIdDocument } from '../lib/ocrParsers/idParser.js';
import type { ParsedDocument } from '../types/domain.js';
import { env } from '../config/env.js';

export class DocumentService {
  async process(documentId: string): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare("UPDATE documents SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(now, documentId);

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as DbDocument | undefined;
    if (!doc) throw new Error(`Document not found: ${documentId}`);

    try {
      let imageBuffer: Buffer = readFileSync(join(env.STORAGE_PATH, doc.storage_path));

      // Convert PDF to image if needed
      if (doc.storage_path.endsWith('.pdf')) {
        imageBuffer = await pdfToImage(imageBuffer);
      }

      // Preprocess for OCR
      const preprocessed = await preprocessForOcr(imageBuffer);

      // Try MRZ extraction first (bottom zone)
      const mrzZone = await cropMrzZone(preprocessed);
      const worker = await createWorker('eng');

      let parsed: ParsedDocument = {};
      let rawText = '';
      let confidence = 0;

      try {
        // Configure Tesseract for MRZ: restrict to valid chars only
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
          tessedit_pageseg_mode: '6' as any,
        });
        // Try MRZ zone first
        const mrzResult = await worker.recognize(mrzZone);
        const mrzLines = extractMrzLines(mrzResult.data.text);
        const mrz = mrzLines ? parseMrz(mrzLines) : null;

        if (mrz) {
          parsed = {
            firstName: mrz.firstName,
            lastName: mrz.lastName,
            fullName: `${mrz.firstName} ${mrz.lastName}`.trim(),
            dateOfBirth: mrz.dateOfBirth,
            documentNumber: mrz.documentNumber,
            expiryDate: mrz.expiryDate,
            nationality: mrz.nationality,
            isExpired: mrz.isExpired,
            mrzDetected: true,
          };
          confidence = mrz.checksumsValid ? 0.9 : 0.65;
          rawText = mrzResult.data.text;
        } else {
          // Fall back to full-page OCR with no character whitelist
          await worker.setParameters({
            tessedit_char_whitelist: '',
            tessedit_pageseg_mode: '3' as any,
          });
          const fullResult = await worker.recognize(preprocessed);
          rawText = fullResult.data.text;

          // Parse structured fields from printed text (driver's license, national ID)
          const idData = parseIdDocument(rawText);
          const hasData = !!(idData.fullName || idData.documentNumber || idData.dateOfBirth);
          parsed = {
            mrzDetected: false,
            ...idData,
          };
          // Boost confidence if we extracted useful fields
          confidence = hasData
            ? Math.max(0.55, fullResult.data.confidence / 100)
            : fullResult.data.confidence / 100;
        }
      } finally {
        await worker.terminate();
      }

      db.prepare(`
        UPDATE documents
        SET status = 'DONE', ocr_raw = ?, ocr_parsed = ?, confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ text: rawText }),
        JSON.stringify(parsed),
        confidence,
        now,
        documentId,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE documents SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?").run(
        error,
        now,
        documentId,
      );
      throw err;
    }
  }
}
