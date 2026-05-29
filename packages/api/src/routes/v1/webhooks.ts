import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WebhookService } from '../../services/WebhookService.js';
import { WEBHOOK_EVENTS } from '../../config/constants.js';
import type { WebhookEvent } from '../../config/constants.js';

const webhookService = new WebhookService();

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

export default async function webhookRoutes(app: FastifyInstance) {
  app.post('/webhooks', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Webhooks'],
      summary: 'Register a webhook endpoint',
      description: `Register a URL to receive real-time notifications when KYC sessions complete.

**Available events:**
- \`session.approved\` — user passed all checks
- \`session.rejected\` — one or more checks failed
- \`session.manual_review\` — borderline score, awaiting admin decision

**Signature verification:** Every request includes an \`X-KYC-Signature\` header in the format \`t=<timestamp>,v1=<hmac_sha256>\`. Always verify this before trusting the payload.

> ⚠️ The \`signing_secret\` is only returned once at creation. Store it securely.`,
      security: [{ ApiKey: [] }],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'Your HTTPS endpoint that will receive POST requests',
            example: 'https://your-app.com/webhooks/kyc',
          },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['session.approved', 'session.rejected', 'session.manual_review'],
            },
            description: 'List of events to subscribe to',
            example: ['session.approved', 'session.rejected'],
          },
        },
      },
      response: {
        201: {
          description: 'Webhook registered. Save the signing_secret — it cannot be retrieved again.',
          type: 'object',
          properties: {
            id: { type: 'string', example: 'wh_xyz789' },
            signing_secret: {
              type: 'string',
              description: '⚠️ Save this immediately — shown only once. Use it to verify incoming webhook signatures.',
              example: 'whsec_a1b2c3d4e5f6...',
            },
            url: { type: 'string' },
            events: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = createWebhookSchema.parse(request.body);
    const result = webhookService.createEndpoint(request.merchantId!, body.url, body.events as WebhookEvent[]);

    return reply.status(201).send({
      id: result.id,
      signing_secret: result.signingSecret,
      url: body.url,
      events: body.events,
      active: true,
    });
  });

  app.get('/webhooks', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Webhooks'],
      summary: 'List webhook endpoints',
      security: [{ ApiKey: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  events: { type: 'array', items: { type: 'string' } },
                  active: { type: 'boolean' },
                  created_at: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const endpoints = webhookService.listEndpoints(request.merchantId!);
    return reply.send({
      data: endpoints.map((e) => ({
        id: e.id,
        url: e.url,
        events: JSON.parse(e.events),
        active: e.active === 1,
        created_at: e.created_at,
      })),
    });
  });

  app.delete<{ Params: { id: string } }>('/webhooks/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Webhooks'],
      summary: 'Delete a webhook endpoint',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'wh_xyz789' },
        },
      },
      response: { 204: { description: 'Deleted successfully', type: 'null' } },
    },
  }, async (request, reply) => {
    webhookService.deleteEndpoint(request.params.id, request.merchantId!);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/webhooks/:id/test', {
    preHandler: [(app as any).verifyMerchantAuth],
    schema: {
      tags: ['Webhooks'],
      summary: 'Send a test event',
      description: 'Sends a test `ping` event to your webhook URL so you can verify your handler is receiving and processing requests correctly.',
      security: [{ ApiKey: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'wh_xyz789' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { delivered: { type: 'boolean' } },
        },
      },
    },
  }, async (request, reply) => {
    await webhookService.dispatch('__test__', 'ping', { message: 'Webhook test' });
    return reply.send({ delivered: true });
  });
}
