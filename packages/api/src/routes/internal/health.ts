import type { FastifyInstance } from 'fastify';
import { getDb } from '../../db/client.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    try {
      getDb().prepare('SELECT 1').get();
      return reply.send({ status: 'ok', db: 'ok', ts: Date.now() });
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'error', ts: Date.now() });
    }
  });
}
