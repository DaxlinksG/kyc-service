import { HttpClient } from './utils/httpClient.js';
import { Sessions } from './resources/Sessions.js';
import { Webhooks } from './resources/Webhooks.js';
import { ApiKeys } from './resources/ApiKeys.js';
import { verifyWebhookSignature } from './utils/webhookVerifier.js';

export interface KycClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export class KycClient {
  readonly sessions: Sessions;
  readonly webhooks: Webhooks;
  readonly apiKeys: ApiKeys;

  private readonly http: HttpClient;

  constructor(opts: KycClientOptions) {
    this.http = new HttpClient({
      baseUrl: (opts.baseUrl ?? 'http://localhost:3000').replace(/\/$/, ''),
      apiKey: opts.apiKey,
      timeout: opts.timeout ?? 30_000,
      maxRetries: opts.maxRetries ?? 3,
    });

    this.sessions = new Sessions(this.http);
    this.webhooks = new Webhooks(this.http);
    this.apiKeys = new ApiKeys(this.http);
  }

  /**
   * Verify a webhook signature and parse the event payload.
   * Call this in your webhook handler before trusting the payload.
   */
  verifyWebhook(
    rawBody: string | Buffer,
    signature: string,
    signingSecret: string,
  ): Record<string, unknown> {
    return verifyWebhookSignature(rawBody, signature, signingSecret);
  }
}
