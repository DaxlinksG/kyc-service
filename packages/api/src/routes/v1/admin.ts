import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { ForbiddenError } from '../../types/errors.js';
import { SessionService } from '../../services/SessionService.js';
import { RiskScoringService } from '../../services/RiskScoringService.js';
import { WebhookService } from '../../services/WebhookService.js';
import { enqueueJob } from '../../workers/queue.js';

const sessionService = new SessionService();
const riskService = new RiskScoringService();
const webhookService = new WebhookService();

function adminOnly(request: any) {
  if (request.merchantId !== '__admin__') throw new ForbiddenError('Admin access required');
}

export default async function adminRoutes(app: FastifyInstance) {

  // GET /admin/metrics — overview stats
  app.get('/admin/metrics', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Platform metrics',
      description: 'Returns aggregate KYC session statistics across all merchants. Requires master API key.',
      security: [{ ApiKey: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            total_sessions: { type: 'number', example: 1240 },
            sessions_today: { type: 'number', example: 37 },
            approved: { type: 'number', example: 980 },
            rejected: { type: 'number', example: 180 },
            manual_review: { type: 'number', example: 42 },
            processing: { type: 'number', example: 12 },
            pending_jobs: { type: 'number', example: 3 },
            total_merchants: { type: 'number', example: 8 },
          },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const db = getDb();

    const total = (db.prepare('SELECT COUNT(*) as n FROM sessions').get() as any).n;
    const byState = db.prepare(`
      SELECT state, COUNT(*) as n FROM sessions GROUP BY state
    `).all() as { state: string; n: number }[];

    const today = Math.floor(Date.now() / 1000) - 86400;
    const todayCount = (db.prepare('SELECT COUNT(*) as n FROM sessions WHERE created_at > ?').get(today) as any).n;
    const pending = (db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status = 'QUEUED' OR status = 'PROCESSING'").get() as any).n;
    const merchants = (db.prepare('SELECT COUNT(*) as n FROM merchants').get() as any).n;

    const stateMap = Object.fromEntries(byState.map((r) => [r.state, r.n]));

    return reply.send({
      total_sessions: total,
      sessions_today: todayCount,
      approved: stateMap['approved'] ?? 0,
      rejected: stateMap['rejected'] ?? 0,
      manual_review: stateMap['manual_review'] ?? 0,
      processing: (stateMap['processing'] ?? 0) + (stateMap['document_submitted'] ?? 0) + (stateMap['selfie_submitted'] ?? 0) + (stateMap['address_submitted'] ?? 0),
      pending_jobs: pending,
      total_merchants: merchants,
    });
  });

  // GET /admin/sessions — paginated list with filters
  app.get('/admin/sessions', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'List all sessions',
      description: 'Paginated list of KYC sessions across all merchants. Filterable by state and merchant. Requires master API key.',
      security: [{ ApiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1, description: 'Page number' },
          limit: { type: 'number', default: 20, description: 'Results per page (max 100)' },
          state: { type: 'string', enum: ['created', 'processing', 'approved', 'rejected', 'manual_review', 'expired'], description: 'Filter by session state' },
          merchant_id: { type: 'string', description: 'Filter by merchant', example: 'acme-corp' },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const query = z.object({
      page: z.coerce.number().default(1),
      limit: z.coerce.number().max(100).default(20),
      state: z.string().optional(),
      merchant_id: z.string().optional(),
      search: z.string().optional(),
    }).parse(req.query);

    const db = getDb();
    const offset = (query.page - 1) * query.limit;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (query.state) { where += ' AND s.state = ?'; params.push(query.state); }
    if (query.merchant_id) { where += ' AND s.merchant_id = ?'; params.push(query.merchant_id); }

    const sessions = db.prepare(`
      SELECT s.id, s.merchant_id, s.state, s.created_at, s.updated_at, s.expires_at,
             d.confidence as doc_confidence,
             sl.liveness_score, sl.match_score,
             a.name_match_score
      FROM sessions s
      LEFT JOIN documents d ON d.session_id = s.id AND d.side = 'FRONT'
      LEFT JOIN selfie_checks sl ON sl.session_id = s.id
      LEFT JOIN address_checks a ON a.session_id = s.id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `).all([...params, query.limit, offset]);

    const total = (db.prepare(`SELECT COUNT(*) as n FROM sessions s ${where}`).get(params) as any).n;

    return reply.send({
      data: sessions,
      pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
    });
  });

  // GET /admin/sessions/:id — full detail
  app.get<{ Params: { id: string } }>('/admin/sessions/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Get full session detail',
      description: 'Returns the complete session record including document OCR data, selfie scores, address check, risk score breakdown, and audit trail. Requires master API key.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as any;
    if (!session) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Session not found' } });

    const doc = db.prepare("SELECT * FROM documents WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id) as any;
    const selfie = db.prepare("SELECT * FROM selfie_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id) as any;
    const address = db.prepare("SELECT * FROM address_checks WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id) as any;
    const audit = db.prepare("SELECT * FROM audit_log WHERE session_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.id);

    return reply.send({
      ...session,
      metadata: session.metadata ? JSON.parse(session.metadata) : null,
      document_check: doc ? { ...doc, ocr_parsed: doc.ocr_parsed ? JSON.parse(doc.ocr_parsed) : null } : null,
      selfie_check: selfie,
      address_check: address ? { ...address, ocr_parsed: address.ocr_parsed ? JSON.parse(address.ocr_parsed) : null } : null,
      risk_score: ['approved','rejected','manual_review','processing'].includes(session.state) ? riskService.score(req.params.id) : null,
      audit_log: audit,
    });
  });

  // POST /admin/sessions/:id/approve — manual override
  app.post<{ Params: { id: string } }>('/admin/sessions/:id/approve', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Manually approve a session',
      description: 'Override the automated decision and approve a session. Only valid for sessions in `manual_review` or `processing` state. Triggers the `session.approved` webhook.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
      body: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'Optional internal note recorded in the audit log',
            example: 'Document quality confirmed by ops team',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ses_abc123' },
            state: { type: 'string', example: 'approved' },
          },
        },
        409: {
          description: 'Session is not in an approvable state',
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const session = sessionService.getById(req.params.id);
    if (!['manual_review', 'processing'].includes(session.state)) {
      return reply.status(409).send({ error: { code: 'INVALID_STATE', message: `Cannot approve session in state: ${session.state}` } });
    }
    sessionService.transition(req.params.id, 'approved');
    await webhookService.dispatch(req.params.id, 'session.approved', { manual: true });
    return reply.send({ id: req.params.id, state: 'approved' });
  });

  // POST /admin/sessions/:id/reject — manual override
  app.post<{ Params: { id: string } }>('/admin/sessions/:id/reject', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Manually reject a session',
      description: 'Override the automated decision and reject a session. Only valid for sessions in `manual_review` or `processing` state. Triggers the `session.rejected` webhook.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
      body: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Reason for rejection — recorded in audit log and optionally sent to the merchant via webhook',
            example: 'Document appears altered — expiry date inconsistent with MRZ',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'ses_abc123' },
            state: { type: 'string', example: 'rejected' },
          },
        },
        409: {
          description: 'Session is not in a rejectable state',
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const session = sessionService.getById(req.params.id);
    if (!['manual_review', 'processing'].includes(session.state)) {
      return reply.status(409).send({ error: { code: 'INVALID_STATE', message: `Cannot reject session in state: ${session.state}` } });
    }
    sessionService.transition(req.params.id, 'rejected');
    await webhookService.dispatch(req.params.id, 'session.rejected', { manual: true });
    return reply.send({ id: req.params.id, state: 'rejected' });
  });

  // GET /admin/merchants — list all merchants + key count
  app.get('/admin/merchants', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'List merchants',
      description: 'Returns all registered merchants with their active API key count and total session count. Requires master API key.',
      security: [{ ApiKey: [] }],
    },
  }, async (req, reply) => {
    adminOnly(req);
    const db = getDb();
    const merchants = db.prepare(`
      SELECT m.id, m.name, m.created_at,
             COUNT(k.id) as active_keys,
             COUNT(s.id) as total_sessions
      FROM merchants m
      LEFT JOIN api_keys k ON k.merchant_id = m.id AND k.revoked_at IS NULL
      LEFT JOIN sessions s ON s.merchant_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `).all();
    return reply.send({ data: merchants });
  });

  // POST /admin/merchants — create merchant
  app.post('/admin/merchants', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Create a merchant',
      description: 'Registers a new merchant. After creating a merchant, issue them an API key via `POST /v1/api-keys`. Requires master API key.',
      security: [{ ApiKey: [] }],
      body: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', description: 'Unique merchant identifier (slug-style, no spaces)', example: 'acme-corp' },
          name: { type: 'string', description: 'Human-readable merchant name', example: 'Acme Corporation' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'acme-corp' },
            name: { type: 'string', example: 'Acme Corporation' },
          },
        },
      },
    },
  }, async (req, reply) => {
    adminOnly(req);
    const body = z.object({ id: z.string().min(3), name: z.string() }).parse(req.body);
    const db = getDb();
    const exists = db.prepare('SELECT id FROM merchants WHERE id = ?').get(body.id);
    if (exists) return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Merchant already exists' } });
    db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(body.id, body.name);
    return reply.status(201).send({ id: body.id, name: body.name });
  });

  // GET /admin/jobs — job queue status
  app.get('/admin/jobs', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Admin'],
      summary: 'Job queue status',
      description: 'Returns job queue counts by status and the 20 most recent jobs. Useful for monitoring processing backlogs. Requires master API key.',
      security: [{ ApiKey: [] }],
    },
  }, async (req, reply) => {
    adminOnly(req);
    const db = getDb();
    const byStatus = db.prepare("SELECT status, COUNT(*) as n FROM jobs GROUP BY status").all();
    const recent = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20").all();
    return reply.send({ by_status: byStatus, recent });
  });
}
