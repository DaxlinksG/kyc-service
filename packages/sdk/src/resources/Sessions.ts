import type { HttpClient } from '../utils/httpClient.js';
import type { Session, CreateSessionResponse } from '../types/responses.js';
import { pollUntilDecision, type PollOptions } from '../utils/polling.js';

export interface CreateSessionOptions {
  metadata?: Record<string, unknown>;
  redirect_url?: string;
}

export interface UploadDocumentOptions {
  /** A Blob, File, Buffer, or ReadableStream containing the document image or PDF */
  file: Blob | Buffer | NodeJS.ReadableStream;
  fileName?: string;
  mimeType?: string;
  documentType: 'PASSPORT' | 'NATIONAL_ID' | 'DRIVING_LICENSE';
  side?: 'FRONT' | 'BACK';
}

export interface UploadSelfieOptions {
  file: Blob | Buffer | NodeJS.ReadableStream;
  fileName?: string;
  mimeType?: string;
}

export interface UploadAddressOptions {
  file: Blob | Buffer | NodeJS.ReadableStream;
  fileName?: string;
  mimeType?: string;
  documentType: 'UTILITY_BILL' | 'BANK_STATEMENT' | 'GOVERNMENT_LETTER';
}

export class Sessions {
  constructor(private readonly http: HttpClient) {}

  async create(opts: CreateSessionOptions = {}): Promise<CreateSessionResponse> {
    return this.http.post<CreateSessionResponse>('/v1/sessions', opts);
  }

  async get(sessionId: string): Promise<Session> {
    return this.http.get<Session>(`/v1/sessions/${sessionId}`);
  }

  async getStatus(sessionId: string): Promise<Session> {
    return this.http.get<Session>(`/v1/sessions/${sessionId}/status`);
  }

  async uploadDocument(sessionId: string, opts: UploadDocumentOptions): Promise<{ document_id: string; status: string }> {
    const form = await buildFormData(opts.file, opts.fileName ?? 'document.jpg', opts.mimeType ?? 'image/jpeg');
    form.append('document_type', opts.documentType);
    form.append('side', opts.side ?? 'FRONT');
    return this.http.postForm(`/v1/sessions/${sessionId}/documents`, form);
  }

  async uploadSelfie(sessionId: string, opts: UploadSelfieOptions): Promise<{ selfie_id: string; status: string }> {
    const form = await buildFormData(opts.file, opts.fileName ?? 'selfie.jpg', opts.mimeType ?? 'image/jpeg');
    return this.http.postForm(`/v1/sessions/${sessionId}/selfie`, form);
  }

  async uploadAddress(sessionId: string, opts: UploadAddressOptions): Promise<{ address_id: string; status: string }> {
    const form = await buildFormData(opts.file, opts.fileName ?? 'address.jpg', opts.mimeType ?? 'image/jpeg');
    form.append('document_type', opts.documentType);
    return this.http.postForm(`/v1/sessions/${sessionId}/address`, form);
  }

  /**
   * Wait for the session to reach a terminal state (approved/rejected/manual_review).
   * Polls the status endpoint with exponential backoff.
   */
  async waitForDecision(sessionId: string, opts: PollOptions = {}): Promise<Session> {
    return pollUntilDecision(() => this.getStatus(sessionId), opts);
  }
}

async function buildFormData(
  file: Blob | Buffer | NodeJS.ReadableStream,
  fileName: string,
  mimeType: string,
): Promise<FormData> {
  const form = new FormData();

  if (file instanceof Blob) {
    form.append('file', file, fileName);
  } else if (Buffer.isBuffer(file)) {
    form.append('file', new Blob([file], { type: mimeType }), fileName);
  } else {
    // ReadableStream — collect chunks
    const chunks: Buffer[] = [];
    for await (const chunk of file as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  }

  return form;
}
