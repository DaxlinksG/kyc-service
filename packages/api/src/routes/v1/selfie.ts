import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SessionService } from '../../services/SessionService.js';
import { validateImageFile } from '../../lib/fileValidator.js';
import { enqueueJob } from '../../workers/queue.js';
import { getDb } from '../../db/client.js';
import { env } from '../../config/env.js';
import { ValidationError } from '../../types/errors.js';

const sessionService = new SessionService();

export default async function selfieRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/sessions/:id/selfie', {
    preHandler: [(app as any).verifySessionAuth],
    schema: {
      tags: ['Documents'],
      summary: 'Upload a selfie',
      description: `Upload a photo of the user's face. The service will:
- Detect a face in the image
- Run a **passive liveness check** (detects photo/screen attacks using facial landmark geometry)
- **Match the face** against the ID document uploaded in the previous step

**Tips for best results:**
- Good lighting, no sunglasses
- Face clearly visible and centred
- Taken in real time (not a photo of a photo)

**Accepted formats:** JPEG, PNG — max 10 MB. PDF is not accepted.

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
          description: 'Selfie accepted and queued for processing',
          type: 'object',
          properties: {
            selfie_id: { type: 'string', example: 'slf_abc123' },
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

    // Selfie: images only (no PDF)
    if (fileBuffer[0] === 0x25) throw new ValidationError('PDF not allowed for selfie. Please upload an image.');
    await validateImageFile(fileBuffer, data.mimetype);

    const selfieId = `slf_${nanoid(12)}`;
    const relativePath = join(session.merchant_id, sessionId, `${selfieId}.jpg`);
    const absoluteDir = join(env.STORAGE_PATH, session.merchant_id, sessionId);
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(join(env.STORAGE_PATH, relativePath), fileBuffer);

    getDb().prepare(`
      INSERT INTO selfie_checks (id, session_id, storage_path) VALUES (?, ?, ?)
    `).run(selfieId, sessionId, relativePath);

    if (session.state === 'document_submitted') {
      sessionService.transition(sessionId, 'selfie_submitted');
    }

    enqueueJob('PROCESS_SELFIE', { selfieId, sessionId });

    return reply.status(202).send({ selfie_id: selfieId, status: 'processing' });
  });
}
