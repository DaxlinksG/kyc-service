import { registerProcessor } from './queue.js';
import { DocumentService } from '../services/DocumentService.js';
import { LivenessService } from '../services/LivenessService.js';
import { AddressService } from '../services/AddressService.js';
import { RiskScoringService } from '../services/RiskScoringService.js';
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
const webhookService = new WebhookService();

export function registerAllProcessors(): void {
  registerProcessor('PROCESS_DOCUMENT', async ({ documentId, sessionId }) => {
    try {
      await documentService.process(documentId as string);
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
    await webhookService.dispatch(id, `session.${result.decision}` as any, { result });
  });

  registerProcessor('DELIVER_WEBHOOK', async ({ deliveryId }) => {
    await webhookService.deliverWebhook(deliveryId as string);
  });
}

function checkAndScoreIfReady(sessionId: string): void {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as DbSession | undefined;
  if (!session) return;

  // Score once all three checks are terminal (DONE or FAILED — not still PROCESSING/QUEUED)
  const docTerminal = db.prepare("SELECT 1 FROM documents WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);
  const selfieTerminal = db.prepare("SELECT 1 FROM selfie_checks WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);
  const addressTerminal = db.prepare("SELECT 1 FROM address_checks WHERE session_id = ? AND status IN ('DONE','FAILED')").get(sessionId);

  if (docTerminal && selfieTerminal && addressTerminal) {
    sessionService.transition(sessionId, 'processing');
    enqueueJob('SCORE_SESSION', { sessionId });
  }
}
