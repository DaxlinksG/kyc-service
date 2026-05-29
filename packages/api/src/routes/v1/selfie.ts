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
