import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/client.js';
import { generateApiKey } from '../../lib/tokenManager.js';
import { ForbiddenError } from '../../types/errors.js';

const createKeySchema = z.object({
  merchant_id: z.string(),
  name: z.string().optional(),
});

export default async function apiKeyRoutes(app: FastifyInstance) {
  // Create merchant + API key (admin only)
  app.post('/api-keys', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    if (request.merchantId !== '__admin__') throw new ForbiddenError('Admin access required');

    const body = createKeySchema.parse(request.body);
    const db = getDb();

    // Ensure merchant exists
    const exists = db.prepare('SELECT id FROM merchants WHERE id = ?').get(body.merchant_id);
    if (!exists) {
      db.prepare('INSERT INTO merchants (id, name) VALUES (?, ?)').run(
        body.merchant_id,
        body.merchant_id,
      );
    }

    const { raw, prefix, hash } = generateApiKey();
    const keyId = `key_${nanoid(12)}`;

    db.prepare(`
      INSERT INTO api_keys (id, merchant_id, key_hash, key_prefix, name)
      VALUES (?, ?, ?, ?, ?)
    `).run(keyId, body.merchant_id, hash, prefix, body.name ?? null);

    return reply.status(201).send({
      id: keyId,
      api_key: raw, // Only shown once
      prefix,
      merchant_id: body.merchant_id,
    });
  });

  app.delete<{ Params: { id: string } }>('/api-keys/:id', {
    preHandler: [(app as any).verifyMerchantAuth],
  }, async (request, reply) => {
    if (request.merchantId !== '__admin__') throw new ForbiddenError('Admin access required');
    getDb()
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000), request.params.id);
    return reply.status(204).send();
  });
}
