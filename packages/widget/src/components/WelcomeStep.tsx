import React from 'react';

interface Props { onNext: () => void; }

export function WelcomeStep({ onNext }: Props) {
  return (
    <>
      <h2>Identity Verification</h2>
      <p>We need to verify your identity to continue. This takes about 2–3 minutes.</p>
      <ul className="kyc-check-list" style={{ marginTop: 20 }}>
        <li>Government-issued ID (passport, national ID, or driver's license)</li>
        <li>A live selfie to confirm it's you</li>
        <li>Proof of address (utility bill or bank statement)</li>
      </ul>
      <p style={{ marginTop: 16, fontSize: 12 }}>
        Your data is encrypted and processed securely. We never store raw video.
      </p>
      <div className="kyc-actions">
        <button className="kyc-btn kyc-btn-primary" style={{ flex: 1 }} onClick={onNext}>
          Start Verification →
        </button>
      </div>
    </>
  );
}
