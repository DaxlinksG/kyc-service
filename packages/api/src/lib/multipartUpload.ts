import type { FastifyRequest } from 'fastify';
import { KycError } from '../types/errors.js';

/**
 * OpenAPI request-body schema for a single-file multipart upload.
 *
 * Without this, Swagger UI renders no file input for the endpoint, so clicking
 * "Try it out" → "Execute" sends a `multipart/form-data` request with no
 * boundary. busboy then throws "Multipart: Boundary not found", which surfaces
 * as a confusing 500 INTERNAL_ERROR. Declaring the body makes the docs render a
 * proper file picker (plus any extra form fields).
 */
export function multipartUploadSchema(
  props: Record<string, unknown> = {},
  required: string[] = [],
) {
  return {
    type: 'object',
    required: ['file', ...required],
    properties: {
      file: {
        type: 'string',
        format: 'binary',
        description: 'The file to upload (see accepted formats above).',
      },
      ...props,
    },
  } as const;
}

/**
 * Streaming multipart leaves `request.body` undefined, so Fastify's default body
 * validator rejects every upload with "body must be object". We still want the
 * schema above in the OpenAPI spec (for the file picker), so we bypass runtime
 * body validation here and validate the parsed form fields explicitly with zod.
 */
export const skipBodyValidation = () => () => true;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  fields: Record<string, string>;
}

/**
 * Read the single uploaded file from a multipart request, converting
 * multipart/busboy parse and size errors into clean 4xx responses instead of an
 * opaque 500. Scalar form fields (sent alongside the file) are returned in
 * `fields`; the caller validates them with zod.
 */
export async function readUploadedFile(request: FastifyRequest): Promise<UploadedFile> {
  let data: Awaited<ReturnType<(typeof request)['file']>>;
  try {
    data = await request.file();
  } catch (err) {
    throw toUploadError(err);
  }
  if (!data) {
    throw new KycError('No file uploaded. Attach the file in the "file" field.', 'NO_FILE', 400);
  }

  let buffer: Buffer;
  try {
    buffer = await data.toBuffer();
  } catch (err) {
    throw toUploadError(err);
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.fields ?? {})) {
    const scalar = (value as { value?: unknown } | undefined)?.value;
    if (typeof scalar === 'string') fields[key] = scalar;
  }

  return { buffer, mimetype: data.mimetype, fields };
}

function toUploadError(err: unknown): KycError {
  if (err instanceof KycError) return err;
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new KycError('File exceeds the maximum allowed size.', 'FILE_TOO_LARGE', 413);
  }
  // busboy: "Multipart: Boundary not found", "Unexpected end of form", missing
  // Content-Type, etc. — all client-side malformed requests, not server faults.
  return new KycError(
    'Malformed upload. Send the request as multipart/form-data with a "file" part.',
    'INVALID_UPLOAD',
    415,
  );
}
