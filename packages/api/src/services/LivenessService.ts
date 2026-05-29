import * as faceapi from 'face-api.js';
import { Canvas, Image, ImageData } from 'canvas';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import type { DbSelfieCheck, DbDocument } from '../db/schema.js';
import { preprocessForFace } from '../lib/imagePreprocessor.js';
import { env } from '../config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = join(__dirname, '../../models/face-api');

let modelsLoaded = false;

async function ensureModels(): Promise<void> {
  if (modelsLoaded) return;
  // Patch face-api.js to work in Node.js with canvas
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH);
  modelsLoaded = true;
}

export class LivenessService {
  async process(selfieId: string, sessionId: string): Promise<void> {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    db.prepare("UPDATE selfie_checks SET status = 'PROCESSING', updated_at = ? WHERE id = ?").run(now, selfieId);

    const selfie = db.prepare('SELECT * FROM selfie_checks WHERE id = ?').get(selfieId) as DbSelfieCheck | undefined;
    if (!selfie) throw new Error(`Selfie check not found: ${selfieId}`);

    try {
      await ensureModels();

      const imageBuffer = readFileSync(join(env.STORAGE_PATH, selfie.storage_path));
      const preprocessed = await preprocessForFace(imageBuffer);

      const { createCanvas, loadImage } = await import('canvas');
      const img = await loadImage(preprocessed);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img as any, 0, 0);

      const detection = await faceapi
        .detectSingleFace(canvas as any, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        db.prepare(`
          UPDATE selfie_checks SET status = 'DONE', face_detected = 0, liveness_score = 0, updated_at = ? WHERE id = ?
        `).run(now, selfieId);
        return;
      }

      // Passive liveness: measure landmark geometric spread
      const livenessScore = computeLivenessScore(detection.landmarks);

      // Face matching against document
      let matchScore: number | null = null;
      const docWithFace = db.prepare(`
        SELECT face_descriptor FROM documents
        WHERE session_id = ? AND face_descriptor IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(sessionId) as { face_descriptor: string } | undefined;

      if (docWithFace) {
        const docDescriptor = new Float32Array(JSON.parse(docWithFace.face_descriptor));
        const distance = faceapi.euclideanDistance(
          Array.from(detection.descriptor),
          Array.from(docDescriptor),
        );
        // Convert distance to 0-1 match score (lower distance = better match)
        matchScore = Math.max(0, 1 - distance / env.FACE_MATCH_THRESHOLD);
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

/** Compute a liveness score (0-1) based on facial landmark geometric variation. */
function computeLivenessScore(landmarks: faceapi.FaceLandmarks68): number {
  const positions = landmarks.positions;
  if (positions.length < 68) return 0;

  // Compute variance of x and y coordinates
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);

  const varX = variance(xs);
  const varY = variance(ys);

  // Very uniform (near-zero variance ratio) suggests a flat photo
  const totalVar = varX + varY;
  if (totalVar < 1) return 0.1; // suspiciously uniform

  // Normalize: a real face should have reasonable spread
  const score = Math.min(1, totalVar / 5000);
  return Math.round(score * 100) / 100;
}

function variance(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
}
