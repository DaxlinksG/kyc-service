import React from 'react';

const RESULTS: Record<string, { svg: string; title: string; msg: string }> = {
  approved: {
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="#dcfce7"/><path d="M20 33l9 9 15-16" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    title: 'Identity Verified',
    msg: 'Your identity has been successfully verified. You can now continue.',
  },
  rejected: {
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="#fee2e2"/><path d="M22 22l20 20M42 22L22 42" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/></svg>`,
    title: 'Verification Unsuccessful',
    msg: "We couldn't verify your identity with the documents provided. Please ensure your ID is valid and your photos are clear, then try again.",
  },
  manual_review: {
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="#fef9c3"/><path d="M32 20v14M32 38v4" stroke="#ca8a04" stroke-width="4" stroke-linecap="round"/></svg>`,
    title: 'Under Review',
    msg: "Your documents are being reviewed by our team. This usually takes a few hours. We'll notify you once complete.",
  },
  expired: {
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="32" fill="#f1f5f9"/><path d="M32 20v12l7 7" stroke="#94a3b8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    title: 'Session Expired',
    msg: 'This session has expired. Please go back and start a new verification.',
  },
};

export function ResultStep({ state }: { state: string }) {
  const c = RESULTS[state] ?? RESULTS['rejected']!;
  return (
    <div className="kyc-result-center">
      <div className="kyc-result-icon" dangerouslySetInnerHTML={{ __html: c.svg }} />
      <h2>{c.title}</h2>
      <p style={{ marginTop: 10, color: 'var(--kyc-text-muted)', lineHeight: 1.5 }}>{c.msg}</p>
    </div>
  );
}
