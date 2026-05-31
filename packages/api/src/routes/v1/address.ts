import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../services/SessionService.js';
import { validateImageFile } from '../../lib/fileValidator.js';
import { enqueueJob } from '../../workers/queue.js';
import { getDb } from '../../db/client.js';
import { env } from '../../config/env.js';
import { ADDRESS_DOCUMENT_TYPES } from '../../config/constants.js';
import { ValidationError } from '../../types/errors.js';

const sessionService = new SessionService();

export default async function addressRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/sessions/:id/address', {
    preHandler: [(app as any).verifySessionAuth],
    schema: {
      tags: ['Documents'],
      summary: 'Upload proof of address',
      description: `Upload a document that proves the user's current residential address. The service will extract the name and address via OCR and match the name against the identity document.

**Accepted document types:** UTILITY_BILL, BANK_STATEMENT, GOVERNMENT_LETTER

**Requirements:**
- Document must be dated within the last **90 days**
- Name on the document must match the name on the ID

**Accepted formats:** JPEG, PNG, WebP — max 10 MB.

**Auth:** Use the \`session_token\` — not your API key.`,
      security: [{ SessionToken: [] }],
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
      // body schema omitted — multipart/form-data bypasses JSON body validation
      response: {
        202: {
          description: 'Address document accepted and queued for processing',
          type: 'object',
          properties: {
            address_id: { type: 'string', example: 'adr_abc123' },
            status: { type: 'string', example: 'processing' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const sessionId = request.params.id;
    const session = sessionService.getById(sessionId);
    sessionService.assertNotExpired(session);

    const data = await (request as any).file();
    if (!data) throw new ValidationError('No file uploaded');

    const fileBuffer = await data.toBuffer();
    await validateImageFile(fileBuffer, data.mimetype);

    const formFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.fields ?? {})) {
      formFields[key] = (value as any).value ?? value;
    }

    const fields = z.object({
      document_type: z.enum(ADDRESS_DOCUMENT_TYPES),
    }).parse(formFields);

    const addressId = `adr_${nanoid(12)}`;
    const ext = 'jpg';
    const relativePath = join(session.merchant_id, sessionId, `${addressId}.${ext}`);
    const absoluteDir = join(env.STORAGE_PATH, session.merchant_id, sessionId);
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(join(env.STORAGE_PATH, relativePath), fileBuffer);

    getDb().prepare(`
      INSERT INTO address_checks (id, session_id, document_type, storage_path) VALUES (?, ?, ?, ?)
    `).run(addressId, sessionId, fields.document_type, relativePath);

    if (session.state === 'selfie_submitted') {
      sessionService.transition(sessionId, 'address_submitted');
    }

    enqueueJob('PROCESS_ADDRESS', { addressId, sessionId });

    return reply.status(202).send({ address_id: addressId, status: 'processing' });
  });
}
