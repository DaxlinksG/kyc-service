import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

export interface SessionTokenPayload {
  sub: string;       // session id
  merchant_id: string;
  scope: 'widget';
}

export interface ApiKeyTokenPayload {
  sub: string;       // api key id
  merchant_id: string;
  scope: 'merchant';
}

export function signSessionToken(payload: Omit<SessionTokenPayload, 'scope'>): string {
  return jwt.sign({ ...payload, scope: 'widget' }, env.JWT_SECRET, {
    expiresIn: `${env.SESSION_TOKEN_TTL_HOURS}h`,
  });
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as SessionTokenPayload;
  if (decoded.scope !== 'widget') throw new Error('Invalid token scope');
  return decoded;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Generate a new API key in the format kyc_live_<48hex>. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString('hex');
  const raw = `${env.API_KEY_PREFIX}${secret}`;
  const prefix = raw.slice(0, env.API_KEY_PREFIX.length + 8);
  const salt = randomBytes(16);
  const hash = `${salt.toString('hex')}:${scryptSync(raw, salt, 32).toString('hex')}`;
  return { raw, prefix, hash };
}

export function verifyApiKey(raw: string, storedHash: string): boolean {
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const stored = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(raw, salt, 32);
  return timingSafeEqual(stored, derived);
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function signWebhookPayload(payload: string, secret: string, timestamp: number): string {
  const data = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(data).digest('hex');
  return `t=${timestamp},v1=${hmac}`;
}
