import { RekognitionClient, DetectFacesCommand, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/client.js';
import type { DbSelfieCheck, DbDocument } from '../db/schema.js';
import { env } from '../config/env.js';

const rekognition = new RekognitionClient({ region: env.AWS_REGION });

export class LivenessService {
  async process(selfieId: string, sessionId: string): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare("UPDATE selfie_checks SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(now, selfieId);

    const selfie = db.prepare('SELECT * FROM selfie_checks WHERE id = ?').get(selfieId) as DbSelfieCheck | undefined;
    if (!selfie) throw new Error(`Selfie check not found: ${selfieId}`);

    try {
      const selfieBuffer = readFileSync(join(env.STORAGE_PATH, selfie.storage_path));

      // ── Step 1: Detect face + quality signals ──────────────────────────────
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

      // ── Step 2: Liveness proxy from quality attributes ─────────────────────
      // Sharpness catches photo-of-screen/photo attacks — real camera ≥ 50, screen/print < 30
      // Confidence is how certain Rekognition is the region contains a real face
      const sharpness = face.Quality?.Sharpness ?? 0;   // 0–100
      const brightness = face.Quality?.Brightness ?? 0; // 0–100
      const faceConfidence = face.Confidence ?? 0;       // 0–100

      // Reject obvious spoofs via hard signal — sunglasses mask key landmarks
      const sunglasses = face.Sunglasses?.Value === true && (face.Sunglasses?.Confidence ?? 0) > 90;

      // Weighted liveness score: sharpness is the strongest anti-spoof signal
      const rawLiveness = (sharpness * 0.55 + faceConfidence * 0.35 + brightness * 0.10) / 100;
      const livenessScore = sunglasses ? Math.min(rawLiveness, 0.4) : Math.round(rawLiveness * 100) / 100;

      // ── Step 3: Face match against ID document ─────────────────────────────
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
            SourceImage: { Bytes: docBuffer },   // ID document (source of truth)
            TargetImage: { Bytes: selfieBuffer }, // selfie to verify
            SimilarityThreshold: 0,              // return all matches so we can score them ourselves
          }));

          const topMatch = compareResult.FaceMatches?.[0];
          // Similarity is 0–100; normalize to 0–1
          matchScore = topMatch ? Math.round((topMatch.Similarity ?? 0)) / 100 : 0;
        } catch (err) {
          // CompareFaces throws InvalidParameterException when no face is found in source/target
          // Treat as no match rather than crashing the job
          matchScore = 0;
        }
      }

      db.prepare(`
        UPDATE selfie_checks
        SET status = 'DONE', face_detected = 1, liveness_score = ?, match_score = ?, updated_at = ?
        WHERE id = ?
      `).run(livenessScore, matchScore, now, selfieId);

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE selfie_checks SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?").run(
        error, now, selfieId,
      );
      throw err;
    }
  }
}
