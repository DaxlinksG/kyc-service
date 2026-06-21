import type { FastifyInstance } from 'fastify';
import { RekognitionClient, CreateFaceLivenessSessionCommand } from '@aws-sdk/client-rekognition';
import { getDb } from '../../db/client.js';
import { SessionService } from '../../services/SessionService.js';
import { LivenessService } from '../../services/LivenessService.js';
import { enqueueJob } from '../../workers/queue.js';
import { env } from '../../config/env.js';
import { nanoid } from 'nanoid';

const rekognition = new RekognitionClient({ region: env.AWS_REGION });
const sessionService = new SessionService();
const livenessService = new LivenessService();

export default async function faceLivenessRoutes(app: FastifyInstance) {

  // POST /v1/sessions/:id/face-liveness
  // Creates an AWS Face Liveness session and returns the session ID + scoped credentials
  // for the browser-side Amplify component.
  app.post<{ Params: { id: string } }>('/sessions/:id/face-liveness', {
    preHandler: [(app as any).verifySessionAuth],
    schema: {
      tags: ['Documents'],
      summary: 'Create a Face Liveness session',
      description: `Creates an AWS Rekognition Face Liveness session. Returns a \`face_liveness_session_id\` and
short-lived credentials scoped **only** to \`rekognition:StartFaceLivenessSession\`.

Pass these to the liveness iframe/widget. When the check completes, the widget will call
\`POST /v1/sessions/face-liveness/:face_liveness_session_id/complete\` to trigger result processing.`,
      security: [{ SessionToken: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', example: 'ses_abc123' } },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            face_liveness_session_id: { type: 'string', example: 'abc123-def456' },
            region: { type: 'string', example: 'us-east-1' },
            access_key_id: { type: 'string', description: 'Scoped to StartFaceLivenessSession only' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const session = sessionService.getById(req.params.id);
    sessionService.assertNotExpired(session);

    const result = await rekognition.send(new CreateFaceLivenessSessionCommand({}));
    const faceLivenessSessionId = result.SessionId!;

    // Store on the selfie_checks row so LivenessService can retrieve it
    const selfieId = `slf_${nanoid(12)}`;
    getDb().prepare(`
      INSERT INTO selfie_checks (id, session_id, storage_path, face_liveness_session_id)
      VALUES (?, ?, '', ?)
    `).run(selfieId, req.params.id, faceLivenessSessionId);

    if (session.state === 'document_submitted') {
      sessionService.transition(req.params.id, 'selfie_submitted');
    }

    return reply.status(201).send({
      face_liveness_session_id: faceLivenessSessionId,
      region: env.AWS_REGION,
      access_key_id: env.AWS_LIVENESS_ACCESS_KEY_ID,
      secret_access_key: env.AWS_LIVENESS_SECRET_ACCESS_KEY,
    });
  });

  // POST /v1/sessions/face-liveness/:faceLivenessSessionId/complete
  // Called by the liveness iframe after FaceLivenessDetector fires onAnalysisComplete.
  // Enqueues the processing job to fetch results from AWS.
  app.post<{ Params: { faceLivenessSessionId: string } }>(
    '/sessions/face-liveness/:faceLivenessSessionId/complete',
    {
      preHandler: [(app as any).verifySessionAuth],
      schema: {
        tags: ['Documents'],
        summary: 'Trigger liveness result processing',
        description: 'Call this after the Amplify FaceLivenessDetector fires `onAnalysisComplete`. The server fetches the confidence score and reference image from AWS and enqueues face matching against the ID document.',
        security: [{ SessionToken: [] }],
        params: {
          type: 'object',
          properties: { faceLivenessSessionId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const row = db.prepare(`
        SELECT id, session_id FROM selfie_checks WHERE face_liveness_session_id = ?
      `).get(req.params.faceLivenessSessionId) as { id: string; session_id: string } | undefined;

      if (!row) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Liveness session not found' } });

      enqueueJob('PROCESS_SELFIE', { selfieId: row.id, sessionId: row.session_id });

      return reply.send({ ok: true });
    }
  );
}
