import { registerProcessor } from './queue.js';
import { DocumentService } from '../services/DocumentService.js';
import { LivenessService } from '../services/LivenessService.js';
import { AddressService } from '../services/AddressService.js';
import { RiskScoringService } from '../services/RiskScoringService.js';
import { IdentityService } from '../services/IdentityService.js';
import { PepScreeningService } from '../services/PepScreeningService.js';
import { PepSyncService } from '../services/PepSyncService.js';
import { FaceIndexService } from '../services/FaceIndexService.js';
import { SessionService } from '../services/SessionService.js';
import { WebhookService } from '../services/WebhookService.js';
import { enqueueJob } from './queue.js';
import { getDb } from '../db/client.js';
import type { DbSession } from '../db/schema.js';

const sessionService = new SessionService();
const documentService = new DocumentService();
const livenessService = new LivenessService();
const addressService = new AddressService();
const riskService = new RiskScoringService();
const identityService = new IdentityService();
const pepService = new PepScreeningService();
const pepSyncService = new PepSyncService();
const faceIndexService = new FaceIndexService();
const webhookService = new WebhookService();

export function registerAllProcessors(): void {
  registerProcessor('PROCESS_DOCUMENT', async ({ documentId, sessionId }) => {
    try {
      await documentService.process(documentId as string);
      const db = getDb();
      const session = db.prepare('SELECT merchant_id, pep_screening_enabled FROM sessions s JOIN merchants m ON m.id = s.merchant_id WHERE s.id = ?').get(sessionId as string) as { merchant_id: string; pep_screening_enabled: number } | undefined;
      if (session) {
        // Check if MRZ matches a known approved identity
        identityService.checkIdentityMatch(sessionId as string, session.merchant_id);
        // Enqueue PEP screening if merchant has it enabled
        if (session.pep_screening_enabled) {
          enqueueJob('SCREEN_PEP', { sessionId: sessionId as string });
        }
      }
    } finally {
      checkAndScoreIfReady(sessionId as string);
    }
  });

  registerProcessor('PROCESS_SELFIE', async ({ selfieId, sessionId }) => {
    try {
      await livenessService.process(selfieId as string, sessionId as string);
    } finally {
      checkAndScoreIfReady(sessionId as string);
    }
  });

  registerProcessor('PROCESS_ADDRESS', async ({ addressId, sessionId }) => {
    try {
      await addressService.process(addressId as string);
    } finally {
      checkAndScoreIfReady(sessionId as string);
    }
  });

  registerProcessor('SCORE_SESSION', async ({ sessionId }) => {
    const id = sessionId as string;
    const result = riskService.score(id);
    sessionService.transition(id, result.decision);

    // If approved: record identity for reuse + index face for dedup
    if (result.decision === 'approved') {
      const db = getDb();
      const session = db.prepare('SELECT merchant_id FROM sessions WHERE id = ?').get(id) as { merchant_id: string } | undefined;
      if (session) {
        await identityService.recordApprovedIdentity(id, session.merchant_id);

        // Index the selfie face into the Rekognition collection
        const selfieRow = db.prepare(`
          SELECT storage_path FROM selfie_checks
          WHERE session_id = ? AND status = 'DONE' ORDER BY created_at DESC LIMIT 1
        `).get(id) as { storage_path: string } | undefined;
        if (selfieRow) {
          const { readFileSync } = await import('fs');
          const { join } = await import('path');
          const { env } = await import('../config/env.js');
          const selfieBuffer = readFileSync(join(env.STORAGE_PATH, selfieRow.storage_path));
          await faceIndexService.indexFace(id, session.merchant_id, selfieBuffer);
        }
      }
    }

    await webhookService.dispatch(id, `session.${result.decision}` as any, { result });
  });

  registerProcessor('DELIVER_WEBHOOK', async ({ deliveryId }) => {
    await webhookService.deliverWebhook(deliveryId as string);
  });

  registerProcessor('SCREEN_PEP', async ({ sessionId }) => {
    await pepService.screen(sessionId as string);
    checkAndScoreIfReady(sessionId as string);
  });

  registerProcessor('SYNC_PEP_LISTS', async () => {
    const result = await pepSyncService.syncAll();
    console.log(`[PEP sync] OFAC: ${result.ofac} entries, UN: ${result.un} entries`);
  });
}

function checkAndScoreIfReady(sessionId: string): void {
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, m.pep_screening_enabled
    FROM sessions s JOIN merchants m ON m.id = s.merchant_id
    WHERE s.id = ?
  `).get(sessionId) as (DbSession & { pep_screening_enabled: number }) | undefined;
  if (!session) return;

  // Score once all checks are terminal (DONE or FAILED)
  const docTerminal = db.prepare("SELECT 1 FROM documents WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);
  const selfieTerminal = db.prepare("SELECT 1 FROM selfie_checks WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);
  const addressTerminal = db.prepare("SELECT 1 FROM address_checks WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);

  if (!docTerminal || !selfieTerminal || !addressTerminal) return;

  // If PEP screening is enabled, also wait for the pep_check to complete
  if (session.pep_screening_enabled) {
    const pepTerminal = db.prepare("SELECT 1 FROM pep_checks WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);
    if (!pepTerminal) return;
  }

  sessionService.transition(sessionId, 'processing');
  enqueueJob('SCORE_SESSION', { sessionId });
}
