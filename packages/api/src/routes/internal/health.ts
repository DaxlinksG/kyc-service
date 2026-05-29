import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/client.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Service health check',
      description: 'Returns the current health status of the API and database. Use this for uptime monitoring.',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            db: { type: 'string', example: 'ok' },
            ts: { type: 'number', example: 1780094545083 },
          },
        },
      },
    },
  }, async (_req, reply) => {
    try {
      getDb().prepare('SELECT 1').get();
      return reply.send({ status: 'ok', db: 'ok', ts: Date.now() });
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'error', ts: Date.now() });
    }
  });
}
