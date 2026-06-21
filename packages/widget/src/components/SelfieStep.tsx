import React, { useEffect, useState } from 'react';
// FaceLivenessDetector (the wrapper) hardwires fetchAuthSession() as its credential
// provider and ignores the credentialProvider prop — it only passes it through config.
// FaceLivenessDetectorCore is what the wrapper renders internally; it accepts
// credentialProvider directly without touching Amplify Auth.
import { FaceLivenessDetectorCore as FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';
import type { SessionClient } from '../api/sessionClient.js';

interface Props {
  client: SessionClient;
  onNext: () => void;
  onError: (msg: string) => void;
}

type Phase = 'loading' | 'ready' | 'done' | 'error';

interface LivenessSession {
  face_liveness_session_id: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
}

export function SelfieStep({ client, onNext, onError }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<LivenessSession | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    client.createFaceLivenessSession()
      .then((data) => {
        setSession(data);
        setPhase('ready');
      })
      .catch((err: Error) => {
        setErrorMsg(err.message ?? 'Could not start liveness check.');
        setPhase('error');
      });
  }, [client]);

  const handleAnalysisComplete = async () => {
    if (!session || completing) return;
    setCompleting(true);
    try {
      await client.completeFaceLivenessSession(session.face_liveness_session_id);
      setPhase('done');
      setTimeout(() => onNext(), 800);
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Liveness check failed.');
      setPhase('error');
    }
  };

  const handleError = (err: Error) => {
    setErrorMsg(err.message ?? 'Liveness check failed. Please try again.');
    setPhase('error');
  };

  const handleRetry = () => {
    setPhase('loading');
    setSession(null);
    setErrorMsg('');
    setCompleting(false);
    client.createFaceLivenessSession()
      .then((data) => { setSession(data); setPhase('ready'); })
      .catch((err: Error) => { setErrorMsg(err.message); setPhase('error'); });
  };

  return (
    <>
      <h2>Liveness Check</h2>
      <p>Follow the on-screen instructions to confirm you're a real person.</p>

      <div className="kyc-liveness-container">
        {phase === 'loading' && (
          <div className="kyc-liveness-loading">
            <div className="kyc-spinner" />
            <span>Preparing liveness check…</span>
          </div>
        )}

        {phase === 'ready' && session && (
          <FaceLivenessDetector
            key={session.face_liveness_session_id}
            sessionId={session.face_liveness_session_id}
            region={session.region}
            onAnalysisComplete={handleAnalysisComplete}
            onError={(err) => {
              const detail = err.error?.message ? ` (${err.error.message})` : '';
              handleError(new Error(`${String(err.state)}${detail}`));
            }}
            config={{
              // credentialProvider lives inside FaceLivenessDetectorCoreConfig,
              // not as a top-level prop — passing it top-level is silently ignored.
              credentialProvider: async () => ({
                accessKeyId: session.access_key_id,
                secretAccessKey: session.secret_access_key,
                sessionToken: session.session_token,
              }),
            }}
            disableStartScreen={false}
          />
        )}

        {phase === 'done' && (
          <div className="kyc-liveness-success">
            <div className="kyc-liveness-check">✓</div>
            <span>Liveness confirmed — continuing…</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="kyc-liveness-error-box">
            <div className="kyc-error-banner">{errorMsg}</div>
            <button className="kyc-btn kyc-btn-primary" style={{ marginTop: 16 }} onClick={handleRetry}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </>
  );
}
