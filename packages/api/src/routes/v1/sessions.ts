import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SessionService } from '../../services/SessionService.js';
import { RiskScoringService } from '../../services/RiskScoringService.js';
import { getDb } from '../../db/client.js';
import type { DbDocument, DbSelfieCheck, DbAddressCheck } from '../../db/schema.js';

const sessionService = new SessionService();
const riskService = new RiskScoringService();

const createSessionSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  redirect_url: z.string().url().optional(),
});

export default async function sessionRoutes(app: FastifyInstance) {
  // POST /v1/sessions
  app.post('/sessions', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    const body = createSessionSchema.parse(request.body);
    const result = sessionService.create({
      merchantId: request.merchantId!,
      metadata: body.metadata,
      redirectUrl: body.redirect_url,
    });

    return reply.status(201).send({
      session_id: result.sessionId,
      session_token: result.sessionToken,
      expires_at: result.expiresAt,
      widget_url: result.widgetUrl,
    });
  });

  // GET /v1/sessions/:id
  app.get<{ Params: { id: string } }>('/sessions/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    const session = sessionService.getById(request.params.id, request.merchantId);
    return reply.send(formatSession(session.id));
  });

  // GET /v1/sessions/:id/status
  app.get<{ Params: { id: string } }>('/sessions/:id/status', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    const session = sessionService.getById(request.params.id, request.merchantId);
    return reply.send(formatSession(session.id));
  });
}

function formatSession(sessionId: string) {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;

  const doc = db.prepare("SELECT * FROM documents WHERE session_id = ? AND side = 'FRONT' ORDER BY created_at DESC LIMIT 1")
    .get(sessionId) as DbDocument | undefined;
  const selfie = db.prepare('SELECT * FROM selfie_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId) as DbSelfieCheck | undefined;
  const address = db.prepare('SELECT * FROM address_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId) as DbAddressCheck | undefined;

  const result: Record<string, unknown> = {
    id: session.id,
    state: session.state,
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
    metadata: session.metadata ? JSON.parse(session.metadata) : null,
  };

  if (doc) {
    result['document_check'] = {
      id: doc.id,
      status: doc.status,
      document_type: doc.document_type,
      side: doc.side,
      parsed: doc.ocr_parsed ? JSON.parse(doc.ocr_parsed) : null,
      confidence: doc.confidence,
    };
  }

  if (selfie) {
    result['selfie_check'] = {
      id: selfie.id,
      status: selfie.status,
      face_detected: selfie.face_detected === 1,
      liveness_score: selfie.liveness_score,
      match_score: selfie.match_score,
    };
  }

  if (address) {
    result['address_check'] = {
      id: address.id,
      status: address.status,
      document_type: address.document_type,
      parsed: address.ocr_parsed ? JSON.parse(address.ocr_parsed) : null,
      name_match_score: address.name_match_score,
      confidence: address.confidence,
    };
  }

  if (['approved', 'rejected', 'manual_review'].includes(session.state)) {
    result['risk_score'] = riskService.score(sessionId);
  }

  return result;
}
