import { createHmac } from 'crypto';
import { KycApiError } from '../types/errors.js';

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook.
 *
 * @param rawBody - The raw request body as a string or Buffer
 * @param signature - The value of the `X-KYC-Signature` header
 * @param secret - Your webhook signing secret
 * @param toleranceSeconds - Max age of the webhook timestamp (default: 300s)
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
  toleranceSeconds = 300,
): Record<string, unknown> {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [k, v] = part.split('=');
      return [k ?? '', v ?? ''];
    }),
  );

  const timestamp = parseInt(parts['t'] ?? '0', 10);
  const v1 = parts['v1'];

  if (!timestamp || !v1) {
    throw new KycApiError('Invalid signature format', 'INVALID_SIGNATURE', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new KycApiError('Webhook timestamp too old', 'SIGNATURE_EXPIRED', 400);
  }

  const expectedHmac = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  // Constant-time comparison
  const expected = Buffer.from(expectedHmac, 'hex');
  const received = Buffer.from(v1, 'hex');

  if (expected.length !== received.length) {
    throw new KycApiError('Signature mismatch', 'INVALID_SIGNATURE', 400);
  }

  // Use timingSafeEqual if available (Node.js)
  const { timingSafeEqual } = await import('crypto').then(m => m).catch(() => ({ timingSafeEqual: null }));
  if (timingSafeEqual) {
    if (!timingSafeEqual(expected, received)) {
      throw new KycApiError('Signature mismatch', 'INVALID_SIGNATURE', 400);
    }
  } else {
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= (expected[i] ?? 0) ^ (received[i] ?? 0);
    }
    if (diff !== 0) {
      throw new KycApiError('Signature mismatch', 'INVALID_SIGNATURE', 400);
    }
  }

  return JSON.parse(body) as Record<string, unknown>;
}
