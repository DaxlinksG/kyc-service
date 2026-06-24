import {
  RekognitionClient,
  DetectFacesCommand,
  CompareFacesCommand,
  GetFaceLivenessSessionResultsCommand,
} from '@aws-sdk/client-rekognition';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import type { DbSelfieCheck, DbDocument } from '../db/schema.js';
import { env } from '../config/env.js';
import { FaceIndexService } from './FaceIndexService.js';

const faceIndexService = new FaceIndexService();

const rekognition = new RekognitionClient({ region: env.AWS_REGION });

export class LivenessService {
  async process(selfieId: string, sessionId: string): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare("UPDATE selfie_checks SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(now, selfieId);

    const selfie = db.prepare('SELECT * FROM selfie_checks WHERE id = ?').get(selfieId) as DbSelfieCheck | undefined;
    if (!selfie) throw new Error(`Selfie check not found: ${selfieId}`);

    try {
      // ── Path A: AWS Face Liveness (active challenge) ───────────────────────
      if ((selfie as any).face_liveness_session_id) {
        await this.processLivenessSession(selfieId, sessionId, (selfie as any).face_liveness_session_id);
        return;
      }

      // ── Path B: Static selfie upload → Rekognition DetectFaces ────────────
      await this.processStaticSelfie(selfieId, sessionId, selfie);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE selfie_checks SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?").run(
        error, now, selfieId,
      );
      throw err;
    }
  }

  // ── Active liveness: GetFaceLivenessSessionResults + CompareFaces ──────────
  private async processLivenessSession(
    selfieId: string,
    sessionId: string,
    faceLivenessSessionId: string,
  ): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const result = await rekognition.send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: faceLivenessSessionId })
    );

    // Confidence is 0–100; AWS recommends ≥ 90 as the live threshold
    const livenessScore = Math.round((result.Confidence ?? 0)) / 100; // normalize to 0–1

    const faceDetected = (result.Confidence ?? 0) > 0;

    // ── Face match: use ReferenceImage from liveness vs. ID document ──────────
    let matchScore: number | null = null;

    const refImageBytes = result.ReferenceImage?.S3Object
      ? undefined // S3 path — fall back to compare against ID doc below
      : result.ReferenceImage?.Bytes;

    const docRow = db.prepare(`
      SELECT storage_path FROM documents
      WHERE session_id = ? AND side = 'FRONT' AND status = 'DONE'
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionId) as Pick<DbDocument, 'storage_path'> | undefined;

    if (docRow && (refImageBytes || faceDetected)) {
      try {
        const docBuffer = readFileSync(join(env.STORAGE_PATH, docRow.storage_path));

        // Use ReferenceImage from liveness if available; otherwise re-detect from doc
        const compareResult = await rekognition.send(new CompareFacesCommand({
          SourceImage: { Bytes: docBuffer },
          TargetImage: refImageBytes
            ? { Bytes: Buffer.from(refImageBytes) }
            : { Bytes: docBuffer }, // fallback — shouldn't happen
          SimilarityThreshold: 0,
        }));

        const topMatch = compareResult.FaceMatches?.[0];
        matchScore = topMatch ? Math.round(topMatch.Similarity ?? 0) / 100 : 0;
      } catch {
        matchScore = 0;
      }
    }

    db.prepare(`
      UPDATE selfie_checks
      SET status = 'DONE', face_detected = ?, liveness_score = ?, match_score = ?, updated_at = ?
      WHERE id = ?
    `).run(faceDetected ? 1 : 0, livenessScore, matchScore, now, selfieId);

    // Dedup: search the face collection for a prior match under a different identity
    if (faceDetected && refImageBytes) {
      await this.runDedupSearch(selfieId, Buffer.from(refImageBytes));
    } else if (faceDetected && docRow) {
      const docBuffer = readFileSync(join(env.STORAGE_PATH, docRow.storage_path));
      await this.runDedupSearch(selfieId, docBuffer);
    }
  }

  // ── Passive: static upload → DetectFaces quality scores + CompareFaces ─────
  private async processStaticSelfie(
    selfieId: string,
    sessionId: string,
    selfie: DbSelfieCheck,
  ): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const selfieBuffer = readFileSync(join(env.STORAGE_PATH, selfie.storage_path));

    const detectResult = await rekognition.send(new DetectFacesCommand({
      Image: { Bytes: selfieBuffer },
      Attributes: ['ALL'],
    }));

    const face = detectResult.FaceDetails?.[0];

    if (!face) {
      db.prepare(`
        UPDATE selfie_checks SET status = 'DONE', face_detected = 0, liveness_score = 0, updated_at = ? WHERE id = ?
      `).run(now, selfieId);
      return;
    }

    const sharpness = face.Quality?.Sharpness ?? 0;
    const brightness = face.Quality?.Brightness ?? 0;
    const faceConfidence = face.Confidence ?? 0;
    const sunglasses = face.Sunglasses?.Value === true && (face.Sunglasses?.Confidence ?? 0) > 90;

    const rawLiveness = (sharpness * 0.55 + faceConfidence * 0.35 + brightness * 0.10) / 100;
    const livenessScore = sunglasses ? Math.min(rawLiveness, 0.4) : Math.round(rawLiveness * 100) / 100;

    let matchScore: number | null = null;

    const docRow = db.prepare(`
      SELECT storage_path FROM documents
      WHERE session_id = ? AND side = 'FRONT' AND status = 'DONE'
      ORDER BY created_at DESC LIMIT 1
    `).get(sessionId) as Pick<DbDocument, 'storage_path'> | undefined;

    if (docRow) {
      try {
        const docBuffer = readFileSync(join(env.STORAGE_PATH, docRow.storage_path));
        const compareResult = await rekognition.send(new CompareFacesCommand({
          SourceImage: { Bytes: docBuffer },
          TargetImage: { Bytes: selfieBuffer },
          SimilarityThreshold: 0,
        }));
        const topMatch = compareResult.FaceMatches?.[0];
        matchScore = topMatch ? Math.round(topMatch.Similarity ?? 0) / 100 : 0;
      } catch {
        matchScore = 0;
      }
    }

    db.prepare(`
      UPDATE selfie_checks
      SET status = 'DONE', face_detected = 1, liveness_score = ?, match_score = ?, updated_at = ?
      WHERE id = ?
    `).run(livenessScore, matchScore, now, selfieId);

    // Dedup: search the face collection for a prior match under a different identity
    await this.runDedupSearch(selfieId, selfieBuffer);
  }

  private async runDedupSearch(selfieId: string, imageBuffer: Buffer): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const selfie = db.prepare('SELECT session_id FROM selfie_checks WHERE id = ?').get(selfieId) as { session_id: string } | undefined;
    if (!selfie) return;

    const match = await faceIndexService.searchFace(imageBuffer);
    if (!match) return;

    // Only flag if the match is from a DIFFERENT session
    if (match.session_id === selfie.session_id) return;

    db.prepare(`
      UPDATE selfie_checks
      SET duplicate_face_id = ?, duplicate_session_id = ?, duplicate_similarity = ?, updated_at = ?
      WHERE id = ?
    `).run(match.face_id, match.session_id, match.similarity, now, selfieId);
  }
}
