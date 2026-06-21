import React, { useRef, useState } from 'react';
import type { SessionClient } from '../api/sessionClient.js';

interface Props {
  client: SessionClient;
  onNext: () => void;
  onError: (msg: string) => void;
}

const TYPES = [
  { id: 'UTILITY_BILL', icon: '💡', label: 'Utility Bill', desc: 'Gas, electricity, water, internet' },
  { id: 'BANK_STATEMENT', icon: '🏦', label: 'Bank Statement', desc: 'Official bank or credit union statement' },
  { id: 'GOVERNMENT_LETTER', icon: '📮', label: 'Government Letter', desc: 'Tax, benefits, or official government mail' },
] as const;

export function AddressStep({ client, onNext }: Props) {
  const [docType, setDocType] = useState<string>('UTILITY_BILL');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await client.uploadAddress(file, docType);
      onNext();
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  return (
    <>
      <h2>Proof of Address</h2>
      <p>Upload a document dated within the last 90 days showing your name and address.</p>

      <div className="kyc-addr-list">
        {TYPES.map((t) => (
          <div
            key={t.id}
            className={`kyc-addr-item ${docType === t.id ? 'selected' : ''}`}
            onClick={() => setDocType(t.id)}
          >
            <span className="kyc-addr-icon">{t.icon}</span>
            <div className="kyc-addr-text">
              <div className="kyc-addr-label">{t.label}</div>
              <div className="kyc-addr-desc">{t.desc}</div>
            </div>
            <div className="kyc-addr-check" />
          </div>
        ))}
      </div>

      <div
        className={`kyc-upload-zone ${drag ? 'drag-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
      >
        <input ref={inputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
        <div className="kyc-upload-icon">📄</div>
        <p>Click to upload or drag & drop</p>
        <p style={{ fontSize: 12, marginTop: 4, color: 'var(--kyc-text-muted)' }}>JPG, PNG, WebP or PDF · max 20MB</p>
        {file && <div className="kyc-file-selected">{file.name}</div>}
      </div>

      {error && <div className="kyc-error-banner">{error}</div>}

      <div className="kyc-actions">
        <button className="kyc-btn kyc-btn-primary" style={{ flex: 1 }} disabled={!file || uploading} onClick={handleSubmit}>
          {uploading ? 'Uploading…' : 'Submit & Verify →'}
        </button>
      </div>
    </>
  );
}
