import React, { useEffect } from 'react';
import type { SessionClient } from '../api/sessionClient.js';

interface Props {
  client: SessionClient;
  onResult: (state: string, score?: number) => void;
}

const POLL_MS = 3000;
const TIMEOUT_MS = 120_000;
const TERMINAL = new Set(['approved', 'rejected', 'manual_review', 'expired']);

export function ProcessingStep({ client, onResult }: Props) {
  useEffect(() => {
    const deadline = Date.now() + TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const status = await client.getStatus();
        if (TERMINAL.has(status.state)) {
          onResult(status.state, status.risk_score?.score);
          return;
        }
        if (Date.now() < deadline) {
          timer = setTimeout(poll, POLL_MS);
        } else {
          onResult('expired');
        }
      } catch {
        onResult('expired');
      }
    };

    timer = setTimeout(poll, POLL_MS);
    return () => clearTimeout(timer);
  }, [client, onResult]);

  return (
    <div className="kyc-result-center">
      <div className="kyc-spinner" />
      <h2 style={{ marginTop: 24 }}>Verifying…</h2>
      <p style={{ marginTop: 8 }}>Checking your documents. This usually takes 10–30 seconds.</p>
    </div>
  );
}
