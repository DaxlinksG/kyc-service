/**
 * FaceIndexService — face deduplication via AWS Rekognition Face Collections.
 *
 * Flow:
 *   1. SearchFacesByImage — run on every new selfie BEFORE scoring.
 *      A match under a different identity = duplicate_face hard fail.
 *   2. IndexFaces — called AFTER a session is approved to add the face to the collection.
 *      Only approved faces are indexed so the collection stays clean.
 *
 * The Rekognition collection is created automatically on first use.
 */

import {
  RekognitionClient,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  CreateCollectionCommand,
  DescribeCollectionCommand,
} from '@aws-sdk/client-rekognition';
import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import { env } from '../config/env.js';

// Minimum similarity to consider two faces the same person (0–100 scale for Rekognition)
const SIMILARITY_THRESHOLD = 90;

export class FaceIndexService {
  private client: RekognitionClient;
  private collectionId: string;
  private collectionReady = false;

  constructor() {
    this.client = new RekognitionClient({ region: env.AWS_REGION });
    this.collectionId = env.FACE_COLLECTION_ID;
  }

  /** Ensure the Rekognition collection exists (idempotent). */
  async ensureCollection(): Promise<void> {
    if (this.collectionReady) return;
    try {
      await this.client.send(new DescribeCollectionCommand({ CollectionId: this.collectionId }));
    } catch {
      // Collection doesn't exist — create it
      await this.client.send(new CreateCollectionCommand({ CollectionId: this.collectionId }));
    }
    this.collectionReady = true;
  }

  /**
   * Search for a similar face in the collection.
   * Called during PROCESS_SELFIE. Returns the best match if found.
   */
  async searchFace(selfieBuffer: Buffer): Promise<{
    face_id: string;
    session_id: string;
    similarity: number;
  } | null> {
    await this.ensureCollection();
    try {
      const result = await this.client.send(new SearchFacesByImageCommand({
        CollectionId: this.collectionId,
        Image: { Bytes: selfieBuffer },
        FaceMatchThreshold: SIMILARITY_THRESHOLD,
        MaxFaces: 1,
      }));

      const match = result.FaceMatches?.[0];
      if (!match?.Face?.FaceId || !match.Face.ExternalImageId) return null;

      // ExternalImageId is the session_id we stored at index time
      return {
        face_id: match.Face.FaceId,
        session_id: match.Face.ExternalImageId,
        similarity: (match.Similarity ?? 0) / 100,
      };
    } catch {
      // Non-fatal — if Rekognition fails, skip dedup rather than blocking the check
      return null;
    }
  }

  /**
   * Index an approved face into the collection.
   * Called after SCORE_SESSION results in approved.
   */
  async indexFace(sessionId: string, merchantId: string, selfieBuffer: Buffer): Promise<void> {
    await this.ensureCollection();
    const db = getDb();

    try {
      const result = await this.client.send(new IndexFacesCommand({
        CollectionId: this.collectionId,
        Image: { Bytes: selfieBuffer },
        ExternalImageId: sessionId,   // lets us look up the session from a search match
        MaxFaces: 1,
        DetectionAttributes: [],
      }));

      const faceRecord = result.FaceRecords?.[0];
      if (!faceRecord?.Face?.FaceId) return;

      const session = db.prepare('SELECT identity_id FROM sessions WHERE id = ?').get(sessionId) as { identity_id: string | null } | undefined;

      db.prepare(`
        INSERT OR IGNORE INTO face_index (id, face_id, session_id, merchant_id, identity_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        `fi_${nanoid(12)}`,
        faceRecord.Face.FaceId,
        sessionId,
        merchantId,
        session?.identity_id ?? null,
      );
    } catch {
      // Non-fatal — log but don't fail the approval
      console.warn(`[FaceIndex] Failed to index face for session ${sessionId}`);
    }
  }
}
