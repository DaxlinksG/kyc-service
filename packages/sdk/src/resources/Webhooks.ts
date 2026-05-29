import type { HttpClient } from '../utils/httpClient.js';
import type { WebhookEndpoint, CreateWebhookResponse } from '../types/responses.js';

export type WebhookEvent =
  | 'session.created'
  | 'session.document_submitted'
  | 'session.selfie_submitted'
  | 'session.address_submitted'
  | 'session.approved'
  | 'session.rejected'
  | 'session.manual_review'
  | 'session.expired'
  | 'ping';

export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  async create(url: string, events: WebhookEvent[]): Promise<CreateWebhookResponse> {
    return this.http.post<CreateWebhookResponse>('/v1/webhooks', { url, events });
  }

  async list(): Promise<{ data: WebhookEndpoint[] }> {
    return this.http.get<{ data: WebhookEndpoint[] }>('/v1/webhooks');
  }

  async delete(webhookId: string): Promise<void> {
    return this.http.delete(`/v1/webhooks/${webhookId}`);
  }

  async test(webhookId: string): Promise<{ delivered: boolean }> {
    return this.http.post(`/v1/webhooks/${webhookId}/test`);
  }
}
