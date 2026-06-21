import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getDb } from '../db/client.js';
import type { DbApiKey } from '../db/schema.js';
import { verifyApiKey, verifySessionToken, hashSessionToken } from '../lib/tokenManager.js';
import { UnauthorizedError, ForbiddenError } from '../types/errors.js';
import { env } from '../config/env.js';

// In-memory LRU-style cache to avoid scrypt on every request
const apiKeyCache = new Map<string, { merchantId: string; keyId: string; ts: number }>();
const CACHE_TTL_MS = 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    merchantId?: string;
    apiKeyId?: string;
    sessionId?: string;
    authScope?: 'merchant' | 'widget';
  }
  interface FastifyInstance {
    verifyMerchantAuth: (request: FastifyRequest) => Promise<void>;
    verifySessionAuth: (request: FastifyRequest) => Promise<void>;
    verifyAnyAuth: (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorate('verifyMerchantAuth', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Authorization header');
    const token = header.slice(7);

    // Master key bypass for admin routes
    if (token === env.MASTER_API_KEY) {
      request.merchantId = '__admin__';
      request.authScope = 'merchant';
      return;
    }

    const cached = apiKeyCache.get(token);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      request.merchantId = cached.merchantId;
      request.apiKeyId = cached.keyId;
      request.authScope = 'merchant';
      return;
    }

    // Find by prefix
    const prefix = token.slice(0, env.API_KEY_PREFIX.length + 8);
    const db = getDb();
    const keys = db.prepare(`
      SELECT * FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL
    `).all(prefix) as DbApiKey[];

    const valid = keys.find((k) => verifyApiKey(token, k.key_hash));
    if (!valid) throw new UnauthorizedError('Invalid API key');

    // Update last_used_at
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(
      Math.floor(Date.now() / 1000), valid.id,
    );

    apiKeyCache.set(token, { merchantId: valid.merchant_id, keyId: valid.id, ts: Date.now() });

    request.merchantId = valid.merchant_id;
    request.apiKeyId = valid.id;
    request.authScope = 'merchant';
  });

  // Accepts either a merchant API key OR a session token — used for status polling from widget
  app.decorate('verifyAnyAuth', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Authorization header');
    const token = header.slice(7);

    // Try session token first (widget case)
    if (token.startsWith('eyJ')) {
      try {
        const payload = verifySessionToken(token);
        const sessionId = (request.params as Record<string, string>)['id'];
        if (payload.sub !== sessionId) throw new ForbiddenError('Token not valid for this session');
        const db = getDb();
        const session = db.prepare('SELECT session_token_hash FROM sessions WHERE id = ?').get(sessionId) as
          | { session_token_hash: string } | undefined;
        if (!session) throw new UnauthorizedError('Session not found');
        const tokenHash = hashSessionToken(token);
        if (tokenHash !== session.session_token_hash) throw new UnauthorizedError('Token revoked');
        request.sessionId = payload.sub;
        request.merchantId = payload.merchant_id;
        request.authScope = 'widget';
        return;
      } catch (err) {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) throw err;
        throw new UnauthorizedError('Invalid session token');
      }
    }

    // Fall back to merchant API key
    if (token === env.MASTER_API_KEY) {
      request.merchantId = '__admin__';
      request.authScope = 'merchant';
      return;
    }
    const prefix = token.slice(0, env.API_KEY_PREFIX.length + 8);
    const db = getDb();
    const keys = db.prepare(`SELECT * FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL`).all(prefix) as DbApiKey[];
    const valid = keys.find((k) => verifyApiKey(token, k.key_hash));
    if (!valid) throw new UnauthorizedError('Invalid API key');
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), valid.id);
    request.merchantId = valid.merchant_id;
    request.apiKeyId = valid.id;
    request.authScope = 'merchant';
  });

  app.decorate('verifySessionAuth', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Authorization header');
    const token = header.slice(7);

    try {
      const payload = verifySessionToken(token);
      const sessionId = (request.params as Record<string, string>)['id'];

      // Only enforce session-id matching on routes that have an :id param.
      // Routes like /sessions/face-liveness/:faceLivenessSessionId/complete don't
      // have :id — the handler is responsible for verifying ownership there.
      if (sessionId !== undefined && payload.sub !== sessionId) {
        throw new ForbiddenError('Token not valid for this session');
      }

      // Verify token hash matches DB
      const db = getDb();
      const session = db.prepare('SELECT session_token_hash FROM sessions WHERE id = ?').get(sessionId) as
        | { session_token_hash: string }
        | undefined;
      if (!session) throw new UnauthorizedError('Session not found');

      const tokenHash = hashSessionToken(token);
      if (tokenHash !== session.session_token_hash) throw new UnauthorizedError('Token revoked');

      request.sessionId = payload.sub;
      request.merchantId = payload.merchant_id;
      request.authScope = 'widget';
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ForbiddenError) throw err;
      throw new UnauthorizedError('Invalid session token');
    }
  });
});
