import React, { useState } from 'react';
import { SessionClient } from '../api/sessionClient.js';
import { WelcomeStep } from './WelcomeStep.js';
import { DocumentStep } from './DocumentStep.js';
import { SelfieStep } from './SelfieStep.js';
import { AddressStep } from './AddressStep.js';
import { ProcessingStep } from './ProcessingStep.js';
import { ResultStep } from './ResultStep.js';
import '../styles/widget.css';

type Step = 'welcome' | 'document' | 'selfie' | 'address' | 'processing' | 'result';
const STEPS: Step[] = ['welcome', 'document', 'selfie', 'address', 'processing', 'result'];
const PROGRESS_STEPS: Step[] = ['document', 'selfie', 'address'];

interface AppProps {
  sessionToken: string;
  apiBaseUrl: string;
  onComplete: (decision: string) => void;
  onError: (message: string) => void;
}

export function App({ sessionToken, apiBaseUrl, onComplete, onError }: AppProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<{ state: string; score?: number } | null>(null);

  const client = React.useMemo(
    () => new SessionClient(sessionToken, apiBaseUrl),
    [sessionToken, apiBaseUrl],
  );

  const step = STEPS[stepIndex]!;

  const advance = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
  };

  const showResult = (state: string, score?: number) => {
    setResult({ state, score });
    setStepIndex(STEPS.indexOf('result'));
    onComplete(state);
  };

  return (
    <div className="kyc-container">
      {PROGRESS_STEPS.includes(step) && (
        <div className="kyc-step-indicator">
          {PROGRESS_STEPS.map((s, i) => {
            const currentIdx = PROGRESS_STEPS.indexOf(step);
            const isDone = i < currentIdx;
            const isActive = i === currentIdx;
            return (
              <React.Fragment key={s}>
                <div className={`kyc-step-dot ${isDone ? 'done' : isActive ? 'active' : ''}`}>
                  {isDone ? '✓' : i + 1}
                </div>
                {i < PROGRESS_STEPS.length - 1 && (
                  <div className={`kyc-step-line ${isDone ? 'done' : ''}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="kyc-body">
        {step === 'welcome' && <WelcomeStep onNext={advance} />}
        {step === 'document' && <DocumentStep client={client} onNext={advance} onError={onError} />}
        {step === 'selfie' && <SelfieStep client={client} onNext={advance} onError={onError} />}
        {step === 'address' && <AddressStep client={client} onNext={advance} onError={onError} />}
        {step === 'processing' && <ProcessingStep client={client} onResult={showResult} />}
        {step === 'result' && result && <ResultStep state={result.state} />}
      </div>
    </div>
  );
}
