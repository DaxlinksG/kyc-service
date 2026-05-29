import { KycApiError, KycNetworkError } from '../types/errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async postForm<T>(path: string, form: FormData): Promise<T> {
    return this.requestRaw<T>('POST', path, form);
  }

  async delete(path: string): Promise<void> {
    await this.request('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'kyc-sdk/1.0',
    };
    return this.requestRaw<T>(method, path, body !== undefined ? JSON.stringify(body) : undefined, headers);
  }

  private async requestRaw<T>(
    method: string,
    path: string,
    body?: BodyInit,
    headers?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.opts.baseUrl}${path}`;
    const defaultHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      'User-Agent': 'kyc-sdk/1.0',
      ...(headers ?? {}),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }

      try {
        const response = await fetch(url, {
          method,
          headers: defaultHeaders,
          body,
          signal: AbortSignal.timeout(this.opts.timeout),
        });

        if (response.status === 204) return undefined as T;

        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          const err = (json as any)?.error ?? {};
          throw new KycApiError(
            err.message ?? `HTTP ${response.status}`,
            err.code ?? 'API_ERROR',
            response.status,
            err.details,
          );
        }

        return json as T;
      } catch (err) {
        if (err instanceof KycApiError) {
          // Don't retry 4xx errors
          if (err.statusCode < 500) throw err;
        }
        lastError = err;
        if (attempt === this.opts.maxRetries) break;
      }
    }

    if (lastError instanceof KycApiError) throw lastError;
    throw new KycNetworkError('Request failed after retries', lastError);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
