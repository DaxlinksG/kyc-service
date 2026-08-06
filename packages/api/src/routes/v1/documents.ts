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
import { DOCUMENT_TYPES, DOCUMENT_SIDES } from '../../config/constants.js';
import { multipartUploadSchema, skipBodyValidation, readUploadedFile } from '../../lib/multipartUpload.js';

const sessionService = new SessionService();

export default async function documentRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/sessions/:id/documents', {
    preHandler: [(app as any).verifySessionAuth],
    validatorCompiler: skipBodyValidation,
    schema: {
      tags: ['Documents'],
      summary: 'Upload an identity document',
      description: `Upload a photo of the user's identity document. The service will extract text via OCR, parse the MRZ (Machine Readable Zone), and validate document authenticity.

**Accepted document types:** PASSPORT, NATIONAL_ID, DRIVING_LICENSE

**For NATIONAL_ID and DRIVING_LICENSE:** Upload the front first, then call this endpoint again with \`side=BACK\`.

**North American driver's licenses / provincial ID cards (Canada & US):** when uploading the \`BACK\`, include the AAMVA PDF417 barcode contents in the optional \`barcode_raw\` form field. This machine-readable data (name, DOB, document number, expiry, province) is used as the authoritative identity source. Decode it client-side from the barcode on the back of the card.

**Accepted file formats:** JPEG, PNG, PDF — max 10 MB.

**Auth:** Use the \`session_token\` from \`POST /v1/sessions\` — not your API key.`,
      security: [{ SessionToken: [] }],
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Session ID', example: 'ses_abc123' },
        },
      },
      body: multipartUploadSchema(
        {
          document_type: {
            type: 'string',
            enum: [...DOCUMENT_TYPES],
            description: 'PASSPORT, NATIONAL_ID, or DRIVING_LICENSE',
          },
          side: {
            type: 'string',
            enum: [...DOCUMENT_SIDES],
            default: 'FRONT',
            description: 'FRONT (default) or BACK — upload BACK separately for ID cards / licenses.',
          },
          barcode_raw: {
            type: 'string',
            description: 'Optional AAMVA PDF417 barcode contents (North American DL/ID back).',
          },
        },
        ['document_type'],
      ),
      response: {
        202: {
          description: 'Document accepted and queued for processing',
          type: 'object',
          properties: {
            document_id: { type: 'string', example: 'doc_xyz789' },
            status: { type: 'string', example: 'processing' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const sessionId = request.params.id;
    const session = sessionService.getById(sessionId);
    sessionService.assertNotExpired(session);

    const { buffer: fileBuffer, mimetype, fields: formFields } = await readUploadedFile(request);
    await validateImageFile(fileBuffer, mimetype);

    const fields = z.object({
      document_type: z.enum(DOCUMENT_TYPES),
      side: z.enum(DOCUMENT_SIDES).default('FRONT'),
      // Raw AAMVA PDF417 barcode string, decoded client-side from a North American
      // DL/ID back. Capped to guard against oversized junk (spec max ~2 KB).
      barcode_raw: z.string().trim().min(1).max(8192).optional(),
    }).parse(formFields);

    // Store file
    const docId = `doc_${nanoid(12)}`;
    const ext = fileBuffer[0] === 0x25 ? 'pdf' : 'jpg'; // %PDF vs image
    const relativePath = join(session.merchant_id, sessionId, `${docId}.${ext}`);
    const absoluteDir = join(env.STORAGE_PATH, session.merchant_id, sessionId);
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(join(env.STORAGE_PATH, relativePath), fileBuffer);

    // Insert record
    getDb().prepare(`
      INSERT INTO documents (id, session_id, document_type, side, storage_path, barcode_raw)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(docId, sessionId, fields.document_type, fields.side, relativePath, fields.barcode_raw ?? null);

    // Transition session state
    if (session.state === 'created') {
      sessionService.transition(sessionId, 'document_submitted');
    }

    // Enqueue processing
    enqueueJob('PROCESS_DOCUMENT', { documentId: docId, sessionId });

    return reply.status(202).send({ document_id: docId, status: 'processing' });
  });
}
