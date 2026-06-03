import { nanoid } from 'nanoid';
import { getDb } from '../db/client.js';
import type { DbWebhookEndpoint, DbWebhookDelivery } from '../db/schema.js';
import { signWebhookPayload, generateWebhookSecret } from '../lib/tokenManager.js';
import type { WebhookEvent } from '../config/constants.js';
import { enqueueJob } from '../workers/queue.js';

export class WebhookService {
  createEndpoint(merchantId: string, url: string, events: WebhookEvent[]): { id: string; signingSecret: string } {
    const db = getDb();
    const id = `whe_${nanoid(12)}`;
    const signingSecret = generateWebhookSecret();

    db.prepare(`
      INSERT INTO webhook_endpoints (id, merchant_id, url, events, signing_secret)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, merchantId, url, JSON.stringify(events), signingSecret);

    return { id, signingSecret };
  }

  listEndpoints(merchantId: string): DbWebhookEndpoint[] {
    return getDb()
      .prepare('SELECT * FROM webhook_endpoints WHERE merchant_id = ? AND active = 1')
      .all(merchantId) as DbWebhookEndpoint[];
  }

  deleteEndpoint(id: string, merchantId: string): void {
    getDb()
      .prepare('UPDATE webhook_endpoints SET active = 0 WHERE id = ? AND merchant_id = ?')
      .run(id, merchantId);
  }

  async dispatch(sessionId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    const db = getDb();
    const session = db.prepare('SELECT merchant_id, external_id, metadata FROM sessions WHERE id = ?').get(sessionId) as { merchant_id: string; external_id: string | null; metadata: string | null } | undefined;
    if (!session) return;

    const endpoints = db
      .prepare("SELECT * FROM webhook_endpoints WHERE merchant_id = ? AND active = 1")
      .all(session.merchant_id) as DbWebhookEndpoint[];

    for (const endpoint of endpoints) {
      const subscribedEvents: WebhookEvent[] = JSON.parse(endpoint.events);
      if (!subscribedEvents.includes(event) && !subscribedEvents.includes('*' as any)) continue;

      const deliveryId = `whd_${nanoid(12)}`;
      const payload = JSON.stringify({
        event,
        session_id: sessionId,
        external_id: session.external_id ?? null,
        metadata: session.metadata ? JSON.parse(session.metadata) : null,
        data,
        created_at: Date.now(),
      });

      db.prepare(`
        INSERT INTO webhook_deliveries (id, endpoint_id, event, payload, next_retry_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(deliveryId, endpoint.id, event, payload, Math.floor(Date.now() / 1000));

      enqueueJob('DELIVER_WEBHOOK', { deliveryId });
    }
  }

  async deliverWebhook(deliveryId: string): Promise<void> {
    const db = getDb();
    const delivery = db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(deliveryId) as DbWebhookDelivery | undefined;
    if (!delivery) return;

    const endpoint = db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(delivery.endpoint_id) as DbWebhookEndpoint | undefined;
    if (!endpoint) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(delivery.payload, endpoint.signing_secret, timestamp);

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KYC-Signature': signature,
          'X-KYC-Event': delivery.event,
          'User-Agent': 'KYC-Webhooks/1.0',
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        db.prepare(`
          UPDATE webhook_deliveries SET status = 'DELIVERED', delivered_at = ?, last_response_status = ?, attempts = attempts + 1
          WHERE id = ?
        `).run(timestamp, response.status, deliveryId);
      } else {
        this.scheduleRetry(deliveryId, delivery.attempts + 1, response.status, `HTTP ${response.status}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.scheduleRetry(deliveryId, delivery.attempts + 1, null, error);
    }
  }

  private scheduleRetry(deliveryId: string, attempts: number, status: number | null, error: string): void {
    const db = getDb();
    const MAX_ATTEMPTS = 5;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE webhook_deliveries SET status = 'FAILED', last_error = ?, last_response_status = ?, attempts = ? WHERE id = ?")
        .run(error, status, attempts, deliveryId);
      return;
    }
    // Exponential backoff: 30s, 2m, 10m, 30m
    const delays = [30, 120, 600, 1800];
    const nextRetry = Math.floor(Date.now() / 1000) + (delays[attempts - 1] ?? 1800);
    db.prepare(`
      UPDATE webhook_deliveries
      SET status = 'PENDING', attempts = ?, last_error = ?, last_response_status = ?, next_retry_at = ?
      WHERE id = ?
    `).run(attempts, error, status, nextRetry, deliveryId);
  }
}
