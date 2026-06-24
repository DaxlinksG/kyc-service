import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/client.js';
import { SessionService } from '../../services/SessionService.js';
import type { DbVerificationLink } from '../../db/schema.js';

const sessionService = new SessionService();

function formatLink(link: DbVerificationLink) {
  return {
    id: link.id,
    name: link.name,
    url: null as string | null, // populated by route handler with full URL
    slug: link.slug,
    is_active: !!link.is_active,
    single_use: !!link.single_use,
    sessions_created: link.sessions_created,
    redirect_url: link.redirect_url ?? null,
    metadata: link.metadata ? JSON.parse(link.metadata) : null,
    created_at: link.created_at,
    expires_at: link.expires_at ?? null,
  };
}

export default async function verificationLinkRoutes(app: FastifyInstance) {

  // POST /v1/verification-links — create a shareable link
  app.post('/verification-links', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Verification Links'],
      summary: 'Create a verification link',
      description: `Generate a shareable URL that launches a KYC flow without any developer integration.
Share the link with users — when they open it, a session is automatically created and the verification widget loads.
Ideal for onboarding via email, WhatsApp, or SMS.`,
      security: [{ ApiKey: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Internal label for this link.', example: 'Customer Onboarding — June 2026' },
          slug: { type: 'string', description: 'Custom URL slug. Auto-generated if omitted.', example: 'acme-onboard' },
          single_use: { type: 'boolean', description: 'If true, the link is deactivated after the first session is created.', default: false },
          redirect_url: { type: 'string', description: 'URL to redirect users to after the widget completes.', example: 'https://your-app.com/verified' },
          metadata: { type: 'object', description: 'JSON merged into each session created from this link (e.g. campaign or source tag).', example: { source: 'email_campaign' } },
          expires_at: { type: 'number', description: 'Unix timestamp after which the link stops working.', example: 1800000000 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string', description: 'The shareable link. Send this to users.' },
            slug: { type: 'string' },
            is_active: { type: 'boolean' },
            single_use: { type: 'boolean' },
            sessions_created: { type: 'number' },
            redirect_url: { type: 'string', nullable: true },
            metadata: { type: 'object', nullable: true },
            created_at: { type: 'number' },
            expires_at: { type: 'number', nullable: true },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only').optional(),
      single_use: z.boolean().default(false),
      redirect_url: z.string().url().optional(),
      metadata: z.record(z.unknown()).optional(),
      expires_at: z.number().int().optional(),
    }).parse(request.body);

    const db = getDb();
    const id = `lnk_${nanoid(12)}`;
    const slug = body.slug ?? nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);

    const existing = db.prepare('SELECT id FROM verification_links WHERE slug = ?').get(slug);
    if (existing) return reply.status(409).send({ error: { code: 'CONFLICT', message: `Slug "${slug}" is already taken.` } });

    db.prepare(`
      INSERT INTO verification_links (id, merchant_id, name, slug, single_use, redirect_url, metadata, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      request.merchantId,
      body.name,
      slug,
      body.single_use ? 1 : 0,
      body.redirect_url ?? null,
      body.metadata ? JSON.stringify(body.metadata) : null,
      body.expires_at ?? null,
    );

    const link = db.prepare('SELECT * FROM verification_links WHERE id = ?').get(id) as DbVerificationLink;
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const baseUrl = `${proto}://${request.hostname}`;

    const result = formatLink(link);
    result.url = `${baseUrl}/verify/${link.slug}`;

    return reply.status(201).send(result);
  });

  // GET /v1/verification-links — list all links for this merchant
  app.get('/verification-links', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Verification Links'],
      summary: 'List verification links',
      security: [{ ApiKey: [] }],
    },
  }, async (request, reply) => {
    const db = getDb();
    const links = db.prepare('SELECT * FROM verification_links WHERE merchant_id = ? ORDER BY created_at DESC').all(request.merchantId) as DbVerificationLink[];
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const baseUrl = `${proto}://${request.hostname}`;

    return reply.send({
      data: links.map(l => {
        const r = formatLink(l);
        r.url = `${baseUrl}/verify/${l.slug}`;
        return r;
      }),
    });
  });

  // GET /v1/verification-links/:id — get one link
  app.get<{ Params: { id: string } }>('/verification-links/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Verification Links'],
      summary: 'Get a verification link',
      security: [{ ApiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const link = db.prepare('SELECT * FROM verification_links WHERE id = ? AND merchant_id = ?').get(request.params.id, request.merchantId) as DbVerificationLink | undefined;
    if (!link) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Link not found' } });

    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const result = formatLink(link);
    result.url = `${proto}://${request.hostname}/verify/${link.slug}`;
    return reply.send(result);
  });

  // PATCH /v1/verification-links/:id — update a link (name, active state, redirect_url)
  app.patch<{ Params: { id: string } }>('/verification-links/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Verification Links'],
      summary: 'Update a verification link',
      security: [{ ApiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          is_active: { type: 'boolean' },
          redirect_url: { type: 'string', nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).optional(),
      is_active: z.boolean().optional(),
      redirect_url: z.string().url().nullable().optional(),
    }).parse(request.body);

    const db = getDb();
    const link = db.prepare('SELECT * FROM verification_links WHERE id = ? AND merchant_id = ?').get(request.params.id, request.merchantId) as DbVerificationLink | undefined;
    if (!link) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Link not found' } });

    if (body.name !== undefined) db.prepare('UPDATE verification_links SET name = ? WHERE id = ?').run(body.name, link.id);
    if (body.is_active !== undefined) db.prepare('UPDATE verification_links SET is_active = ? WHERE id = ?').run(body.is_active ? 1 : 0, link.id);
    if (body.redirect_url !== undefined) db.prepare('UPDATE verification_links SET redirect_url = ? WHERE id = ?').run(body.redirect_url, link.id);

    const updated = db.prepare('SELECT * FROM verification_links WHERE id = ?').get(link.id) as DbVerificationLink;
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const result = formatLink(updated);
    result.url = `${proto}://${request.hostname}/verify/${updated.slug}`;
    return reply.send(result);
  });

  // DELETE /v1/verification-links/:id — deactivate (soft delete)
  app.delete<{ Params: { id: string } }>('/verification-links/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Verification Links'],
      summary: 'Deactivate a verification link',
      description: 'Deactivates the link so it no longer creates sessions. Sessions already created are not affected.',
      security: [{ ApiKey: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { deactivated: { type: 'boolean' } } } },
    },
  }, async (request, reply) => {
    const db = getDb();
    const link = db.prepare('SELECT id FROM verification_links WHERE id = ? AND merchant_id = ?').get(request.params.id, request.merchantId);
    if (!link) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    db.prepare('UPDATE verification_links SET is_active = 0 WHERE id = ?').run(request.params.id);
    return reply.send({ deactivated: true });
  });
}
