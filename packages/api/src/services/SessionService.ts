import { getDb } from '../db/client.js';
import type { DbSession } from '../db/schema.js';
import { env } from '../config/env.js';
import { nanoid } from 'nanoid';
import { signSessionToken, hashSessionToken } from '../lib/tokenManager.js';
import { NotFoundError, SessionExpiredError, InvalidStateError } from '../types/errors.js';
import type { SessionState } from '../config/constants.js';

export interface CreateSessionOptions {
  merchantId: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  redirectUrl?: string;
}

export interface CreatedSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: number;
  widgetUrl: string;
}

export class SessionService {
  create(opts: CreateSessionOptions): CreatedSession {
    const db = getDb();
    const sessionId = `ses_${nanoid(16)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + env.SESSION_TTL_HOURS * 3600;

    const sessionToken = signSessionToken({
      sub: sessionId,
      merchant_id: opts.merchantId,
    });
    const tokenHash = hashSessionToken(sessionToken);

    db.prepare(`
      INSERT INTO sessions (id, merchant_id, state, session_token_hash, external_id, metadata, redirect_url, expires_at)
      VALUES (?, ?, 'created', ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      opts.merchantId,
      tokenHash,
      opts.externalId ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.redirectUrl ?? null,
      expiresAt,
    );

    return {
      sessionId,
      sessionToken,
      expiresAt,
      widgetUrl: `/verify?session_token=${sessionToken}`,
    };
  }

  getById(sessionId: string, merchantId?: string): DbSession {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as DbSession | undefined;

    if (!row) throw new NotFoundError('Session', sessionId);
    if (merchantId && row.merchant_id !== merchantId) throw new NotFoundError('Session', sessionId);

    return row;
  }

  assertNotExpired(session: DbSession): void {
    if (session.state === 'expired') throw new SessionExpiredError();
    const now = Math.floor(Date.now() / 1000);
    if (now > session.expires_at) {
      this.transition(session.id, 'expired');
      throw new SessionExpiredError();
    }
  }

  transition(sessionId: string, newState: SessionState): void {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?
    `).run(newState, now, sessionId);
  }

  assertCanTransitionTo(session: DbSession, newState: SessionState): void {
    const allowed: Partial<Record<SessionState, SessionState[]>> = {
      created: ['document_submitted', 'expired'],
      document_submitted: ['selfie_submitted', 'expired'],
      selfie_submitted: ['address_submitted', 'processing', 'expired'],
      address_submitted: ['processing', 'expired'],
      processing: ['approved', 'rejected', 'manual_review'],
      manual_review: ['approved', 'rejected'],
    };
    const allowedNext = allowed[session.state] ?? [];
    if (!allowedNext.includes(newState)) {
      throw new InvalidStateError(session.state, newState);
    }
  }
}
