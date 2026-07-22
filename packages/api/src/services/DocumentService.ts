import { createWorker } from 'tesseract.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import type { DbDocument } from '../db/schema.js';
import { preprocessForOcr, cropMrzZone, pdfToImage } from '../lib/imagePreprocessor.js';
import { extractMrzLines, parseMrz } from '../lib/ocrParsers/mrzParser.js';
import { parseIdDocument } from '../lib/ocrParsers/idParser.js';
import { parseAamva, type AamvaData } from '../lib/ocrParsers/aamvaParser.js';
import { decodePdf417FromImage } from '../lib/barcodeVerifier.js';
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
      // AAMVA PDF417 barcode fast path (North American driver's licenses / provincial
      // ID cards). The client decodes the barcode in the browser and sends the raw
      // string, but we do NOT trust that string blind: we re-decode the barcode from
      // the back-of-card image the server actually received. The value we re-read off
      // the image is authoritative, which defeats a tampered/hostile client sending a
      // fabricated or swapped identity. Only a barcode we verified this way earns the
      // high-confidence fast path; anything else falls through to OCR below.
      if (doc.barcode_raw) {
        const verified = await this.verifyBarcode(doc);
        if (verified) {
          const aamva = verified.aamva;
          const parsed: ParsedDocument = {
            firstName: aamva.firstName,
            lastName: aamva.lastName,
            fullName: aamva.fullName,
            dateOfBirth: aamva.dateOfBirth,
            documentNumber: aamva.documentNumber,
            expiryDate: aamva.expiryDate,
            isExpired: aamva.isExpired,
            mrzDetected: false,
            barcodeVerified: true,
            issuingCountry: aamva.country,
          };
          if (aamva.issueDate) parsed.issueDate = aamva.issueDate;
          if (aamva.province) parsed.province = aamva.province;

          db.prepare(`
            UPDATE documents
            SET status = 'DONE', ocr_raw = ?, ocr_parsed = ?, confidence = ?, updated_at = ?
            WHERE id = ?
          `).run(
            JSON.stringify({ barcode: verified.raw }),
            JSON.stringify(parsed),
            0.95, // structured barcode, server-verified against the image — highest document confidence
            now,
            documentId,
          );
          return;
        }
        // Barcode claimed but not verifiable from the stored image — fall through to
        // OCR below. Identity then comes from the front-side OCR, at OCR confidence.
      }

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

          // Second MRZ attempt: try extracting MRZ from the full-page OCR text.
          // This catches cases where the MRZ crop was too narrow (e.g., full-spread
          // passport photos where the data page starts mid-image).
          const mrzFromFull = extractMrzLines(fullResult.data.text);
          const mrzFull = mrzFromFull ? parseMrz(mrzFromFull) : null;
          if (mrzFull) {
            parsed = {
              firstName: mrzFull.firstName,
              lastName: mrzFull.lastName,
              fullName: `${mrzFull.firstName} ${mrzFull.lastName}`.trim(),
              dateOfBirth: mrzFull.dateOfBirth,
              documentNumber: mrzFull.documentNumber,
              expiryDate: mrzFull.expiryDate,
              nationality: mrzFull.nationality,
              isExpired: mrzFull.isExpired,
              mrzDetected: true,
            };
            confidence = mrzFull.checksumsValid ? 0.9 : 0.65;
          } else {
            // Parse structured fields from printed text (driver's license, national ID)
            const idData = parseIdDocument(rawText);
            const fieldCount = [idData.fullName, idData.documentNumber, idData.dateOfBirth]
              .filter(Boolean).length;
            parsed = {
              mrzDetected: false,
              ...idData,
            };
            // Confidence reflects how many ID fields were extracted, not OCR confidence.
            if (fieldCount === 0) {
              confidence = 0.05; // No ID data — hard fail in risk scoring
            } else if (fieldCount === 1) {
              confidence = 0.45; // Minimal data — manual review
            } else {
              confidence = 0.55 + (fullResult.data.confidence / 100) * 0.15;
            }
          }
        }
      } finally {
        await worker.terminate();
      }

      // face_descriptor column kept in schema for backward compat but no longer used —
      // face matching is now handled by Rekognition CompareFaces in LivenessService
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

  /**
   * Re-decode the PDF417 barcode from the stored back-of-card image and return the
   * server-verified AAMVA data, or null if the image holds no valid barcode we can
   * read. The client-supplied `barcode_raw` is only a hint here — the value we parse
   * comes from the image itself, so a client that lies about the barcode can't get a
   * high-confidence pass. A client/server disagreement is logged as a spoofing signal.
   */
  private async verifyBarcode(doc: DbDocument): Promise<{ raw: string; aamva: AamvaData } | null> {
    let imageBuffer: Buffer;
    try {
      imageBuffer = readFileSync(join(env.STORAGE_PATH, doc.storage_path));
      if (doc.storage_path.endsWith('.pdf')) imageBuffer = await pdfToImage(imageBuffer);
    } catch {
      return null;
    }

    let serverRaw: string | null;
    try {
      serverRaw = await decodePdf417FromImage(imageBuffer);
    } catch {
      serverRaw = null;
    }
    if (!serverRaw) return null;

    const aamva = parseAamva(serverRaw);
    if (!aamva?.valid) return null;

    // Anti-spoofing: the client-decoded barcode should match what we just read off
    // the image. If it names a different person, the client sent something that isn't
    // physically in the uploaded card — flag it. We proceed with the server value.
    const clientRaw = doc.barcode_raw ?? '';
    if (clientRaw && clientRaw !== serverRaw) {
      const client = parseAamva(clientRaw);
      const differs =
        !client?.valid ||
        client.documentNumber !== aamva.documentNumber ||
        client.dateOfBirth !== aamva.dateOfBirth ||
        client.lastName !== aamva.lastName;
      if (differs) {
        console.warn(
          `[DocumentService] barcode mismatch on document ${doc.id}: client-supplied barcode does not match server re-decode of the image — using server value`,
        );
      }
    }

    return { raw: serverRaw, aamva };
  }
}
