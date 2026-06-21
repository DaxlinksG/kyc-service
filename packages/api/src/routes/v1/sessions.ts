import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SessionService } from '../../services/SessionService.js';
import { RiskScoringService } from '../../services/RiskScoringService.js';
import { getDb } from '../../db/client.js';
import type { DbDocument, DbSelfieCheck, DbAddressCheck } from '../../db/schema.js';

const sessionService = new SessionService();
const riskService = new RiskScoringService();

const createSessionSchema = z.object({
  externalId: z.string().optional(),
  external_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  redirect_url: z.string().url().optional(),
});

const sessionResponseSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string', example: 'ses_abc123' },
    session_token: { type: 'string', description: 'Pass this to your frontend widget or upload calls. Expires in 2 hours.' },
    expires_at: { type: 'number', example: 1780180945 },
    widget_url: { type: 'string', example: 'https://kyc.zeehfi.ca/widget?token=eyJ...' },
  },
};

const sessionDetailSchema = {
  description: 'Session details',
  type: 'object',
  properties: {
    id: { type: 'string', example: 'ses_abc123' },
    external_id: { type: 'string', nullable: true, description: 'Your internal user ID passed at session creation.' },
    state: {
      type: 'string',
      enum: ['created', 'document_submitted', 'selfie_submitted', 'address_submitted', 'processing', 'approved', 'rejected', 'manual_review', 'expired'],
      description: '`approved` = verified ✓ · `rejected` = failed · `manual_review` = pending admin · `processing` = running checks',
    },
    created_at: { type: 'number', description: 'Unix timestamp.' },
    updated_at: { type: 'number', description: 'Unix timestamp of last state change.' },
    expires_at: { type: 'number', description: 'Unix timestamp. Session token is invalid after this.' },
    metadata: { type: 'object', nullable: true, description: 'Arbitrary JSON stored at session creation.' },
    identity_reused: {
      type: 'boolean',
      description: 'True when this session matched a previously approved identity — document and address steps were auto-approved, only liveness was required.',
    },
    identity_id: {
      type: 'string',
      nullable: true,
      description: 'ID of the kyc_identities record linked to this session, if any.',
    },
    document_check: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] },
        document_type: { type: 'string', example: 'PASSPORT' },
        side: { type: 'string', example: 'FRONT' },
        confidence: { type: 'number', description: '0–1. Confidence in OCR/MRZ extraction quality.' },
        parsed: {
          type: 'object',
          nullable: true,
          description: 'Extracted fields: fullName, dateOfBirth, documentNumber, expiryDate, nationality, mrzDetected.',
        },
      },
    },
    selfie_check: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] },
        face_detected: { type: 'boolean' },
        liveness_score: { type: 'number', description: '0–1. ≥ 0.7 = live person confirmed.' },
        match_score: { type: 'number', description: '0–1. ≥ 0.6 = selfie matches ID document.' },
      },
    },
    address_check: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] },
        document_type: { type: 'string', example: 'UTILITY_BILL' },
        name_match_score: { type: 'number', description: '0–1. How closely the name on the address doc matches the ID.' },
        confidence: { type: 'number', description: '0–1. OCR confidence on the address document.' },
        parsed: {
          type: 'object',
          nullable: true,
          description: 'Extracted fields: fullName, address, documentDate.',
        },
      },
    },
    risk_score: {
      type: 'object',
      nullable: true,
      description: 'Only present when state is `approved`, `rejected`, or `manual_review`.',
      properties: {
        decision: { type: 'string', enum: ['approved', 'rejected', 'manual_review'] },
        score: { type: 'number', description: 'Weighted aggregate 0–1. ≥ 0.80 = approved · 0.55–0.79 = manual_review · < 0.55 = rejected.' },
        factors: {
          type: 'object',
          properties: {
            documentConfidence: { type: 'number' },
            livenessScore: { type: 'number' },
            matchScore: { type: 'number' },
            addressNameMatch: { type: 'number' },
            hardFails: { type: 'array', items: { type: 'string' }, description: 'List of hard-fail conditions that forced score to 0.' },
          },
        },
      },
    },
  },
};

export default async function sessionRoutes(app: FastifyInstance) {
  // POST /v1/sessions
  app.post('/sessions', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Sessions'],
      summary: 'Create a KYC session',
      description: 'Creates a new verification session for a user. Call this from your server when a user begins KYC onboarding. Returns a `session_token` to pass to your frontend — never expose your API key in the browser.',
      security: [{ ApiKey: [] }],
      body: {
        type: 'object',
        properties: {
          externalId: {
            type: 'string',
            description: 'Your internal user or application ID. Used to correlate the KYC result with your own records.',
            example: 'user_123',
          },
          metadata: {
            type: 'object',
            description: 'Any additional data to store with this session (e.g. email, plan).',
            example: { email: 'jane@example.com', plan: 'premium' },
          },
          redirect_url: {
            type: 'string',
            description: 'URL to redirect the user to after the widget completes.',
            example: 'https://your-app.com/onboarding/complete',
          },
        },
        required: [],
      },
      response: {
        201: {
          description: 'Session created successfully',
          ...sessionResponseSchema,
        },
      },
    },
  }, async (request, reply) => {
    const body = createSessionSchema.parse(request.body);
    const result = sessionService.create({
      merchantId: request.merchantId!,
      externalId: body.externalId ?? body.external_id,
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
    schema: {
      tags: ['Sessions'],
      summary: 'Get session details',
      description: 'Returns the full session including document check results, selfie/liveness scores, address verification, and the final risk score decision.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
      response: {
        200: sessionDetailSchema,
      },
    },
  }, async (request, reply) => {
    const session = sessionService.getById(request.params.id, request.merchantId);
    return reply.send(formatSession(session.id));
  });

  // GET /v1/sessions/:id/status — accepts both merchant API key and session token
  app.get<{ Params: { id: string } }>('/sessions/:id/status', {
    preHandler: [(app as any).verifyAnyAuth],
    schema: {
      tags: ['Sessions'],
      summary: 'Poll session status',
      description: 'Lightweight endpoint to poll for the current state. Use this if you are not using webhooks.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'ses_abc123' },
        },
      },
      response: {
        200: sessionDetailSchema,
      },
    },
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
    external_id: session.external_id ?? null,
    state: session.state,
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
    metadata: session.metadata ? JSON.parse(session.metadata) : null,
    identity_reused: !!session.identity_id,
    identity_id: session.identity_id ?? null,
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
