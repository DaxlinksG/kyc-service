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
  }, async (request, reply) => {
    const body = createWebhookSchema.parse(request.body);
    const result = webhookService.createEndpoint(request.merchantId!, body.url, body.events as WebhookEvent[]);

    // Only return signing secret on creation — can't be retrieved again
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
  }, async (request, reply) => {
    webhookService.deleteEndpoint(request.params.id, request.merchantId!);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/webhooks/:id/test', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    await webhookService.dispatch('__test__', 'ping', { message: 'Webhook test' });
    return reply.send({ delivered: true });
  });
}
