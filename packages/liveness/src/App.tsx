import { useState, useEffect } from 'react';
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import { ThemeProvider } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

type Phase = 'loading' | 'ready' | 'done' | 'error';

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    sessionToken: p.get('session_token') ?? '',
    faceLivenessSessionId: p.get('face_liveness_session_id') ?? '',
    region: p.get('region') ?? 'us-east-1',
    apiBase: p.get('api_base') ?? '',
    accessKeyId: p.get('access_key_id') ?? '',
    secretAccessKey: p.get('secret_access_key') ?? '',
  };
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const params = getParams();

  useEffect(() => {
    if (!params.faceLivenessSessionId || !params.sessionToken) {
      setError('Missing required parameters.');
      setPhase('error');
      return;
    }
    setPhase('ready');
  }, []);

  const credentialProvider = async () => ({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    sessionToken: undefined as unknown as string,
  });

  async function handleAnalysisComplete() {
    try {
      // Notify backend to fetch results and process the liveness check
      await fetch(
        `${params.apiBase}/v1/sessions/face-liveness/${params.faceLivenessSessionId}/complete`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${params.sessionToken}` },
        }
      );
    } catch {
      // Non-blocking — backend will pick up results via webhook or polling
    }

    setPhase('done');
    window.parent.postMessage({ type: 'kyc:liveness:done' }, '*');
  }

  function handleError(err: Error) {
    setError(err.message || 'Liveness check failed.');
    setPhase('error');
    window.parent.postMessage({ type: 'kyc:liveness:error', message: err.message }, '*');
  }

  if (phase === 'loading') {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={styles.hint}>Preparing liveness check…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={styles.center}>
        <div style={styles.errorIcon}>⚠️</div>
        <p style={styles.errorText}>{error}</p>
        <button style={styles.retryBtn} onClick={() => window.parent.postMessage({ type: 'kyc:liveness:error', message: error }, '*')}>
          Go back
        </button>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div style={styles.center}>
        <div style={styles.checkIcon}>✓</div>
        <p style={styles.hint}>Liveness confirmed — continuing…</p>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <div style={styles.wrapper}>
        <FaceLivenessDetector
          sessionId={params.faceLivenessSessionId}
          region={params.region}
          credentialProvider={credentialProvider}
          onAnalysisComplete={handleAnalysisComplete}
          onError={handleError}
          displayText={{
            hintMoveFaceFrontOfCameraText: 'Move your face in front of the camera',
            hintTooManyFacesText: 'Only one face should be visible',
            hintFaceDetectedText: 'Face detected',
            hintCanNotIdentifyText: 'Move your face into the oval',
            hintTooClose: 'Move back',
            hintTooFar: 'Move closer',
            hintConnectingText: 'Connecting…',
            hintVerifyingText: 'Verifying…',
            hintCheckCompleteText: 'Check complete',
            hintIlluminationTooBrightText: 'Move to a dimmer area',
            hintIlluminationTooDarkText: 'Move to a brighter area',
            hintIlluminationNormalText: 'Lighting looks good',
            hintHoldFaceForFreshnessText: 'Hold still…',
            photosensitivyWarningHeadingText: 'Photosensitivity warning',
            photosensitivyWarningBodyText:
              'This check displays flashing lights. Use caution if you are sensitive to flashing or bright lights.',
            photosensitivyWarningInfoText: 'A small percentage of people may experience seizures.',
            photosensitivyWarningDismissText: 'I understand',
            retryCameraPermissionsText: 'Retry',
            cancelLivenessCheckText: 'Cancel',
            recordingIndicatorText: 'Rec',
            goodFitCaptionText: 'Good fit',
            tooFarCaptionText: 'Too far',
            startScreenBeginCheckingText: 'Start check',
          }}
        />
      </div>
    </ThemeProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    height: '100vh',
    background: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f172a',
    gap: 16,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #334155',
    borderTop: '3px solid #6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  hint: {
    color: '#94a3b8',
    fontSize: 14,
  },
  errorIcon: {
    fontSize: 40,
  },
  errorText: {
    color: '#f87171',
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
  retryBtn: {
    marginTop: 8,
    padding: '10px 24px',
    background: '#1e293b',
    color: '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
  },
  checkIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#dcfce7',
    color: '#16a34a',
    fontSize: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
