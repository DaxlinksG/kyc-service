import type { Session, SessionState } from '../types/responses.js';
import { KycApiError } from '../types/errors.js';

const TERMINAL_STATES: SessionState[] = ['approved', 'rejected', 'manual_review', 'expired'];

export interface PollOptions {
  /** Interval between polls in ms (default: 2000) */
  pollInterval?: number;
  /** Max total wait time in ms (default: 120000) */
  timeout?: number;
  /** Called whenever the session state changes */
  onStatusChange?: (state: SessionState) => void;
}

export async function pollUntilDecision(
  fetchSession: () => Promise<Session>,
  opts: PollOptions = {},
): Promise<Session> {
  const { pollInterval = 2000, timeout = 120_000, onStatusChange } = opts;
  const deadline = Date.now() + timeout;
  let lastState: SessionState | undefined;

  while (Date.now() < deadline) {
    const session = await fetchSession();

    if (session.state !== lastState) {
      lastState = session.state;
      onStatusChange?.(session.state);
    }

    if (TERMINAL_STATES.includes(session.state)) {
      return session;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await sleep(Math.min(pollInterval, remaining));
  }

  throw new KycApiError('Timed out waiting for verification decision', 'POLL_TIMEOUT', 408);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
