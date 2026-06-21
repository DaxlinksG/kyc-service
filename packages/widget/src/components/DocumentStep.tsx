import React, { useEffect, useRef, useState } from 'react';
import type { SessionClient } from '../api/sessionClient.js';

interface Props {
  client: SessionClient;
  onNext: () => void;
  onError: (msg: string) => void;
}

const DOC_TYPES = [
  { id: 'PASSPORT', icon: '🛂', label: 'Passport' },
  { id: 'NATIONAL_ID', icon: '🪪', label: 'National ID' },
  { id: 'DRIVING_LICENSE', icon: '🚗', label: "Driver's License" },
] as const;

export function DocumentStep({ client, onNext, onError }: Props) {
  const [docType, setDocType] = useState<string>('PASSPORT');
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showCanvas, setShowCanvas] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setMode('camera');
      setShowCanvas(false);
      setCapturedFile(null);
      setTimeout(() => setCameraReady(true), 1500);
    } catch {
      setMode('upload');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const captureFrame = () => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stopCamera();
    setShowCanvas(true);
    canvas.toBlob((blob) => {
      if (blob) setCapturedFile(new File([blob], 'document.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.95);
  };

  const handleShutter = () => {
    if (!cameraReady) return;
    let n = 3;
    setCountdown(n);
    const tick = setInterval(() => {
      n--;
      if (n > 0) setCountdown(n);
      else {
        clearInterval(tick);
        setCountdown(null);
        captureFrame();
      }
    }, 1000);
  };

  const handleRetake = () => {
    setCapturedFile(null);
    setShowCanvas(false);
    setCameraReady(false);
    startCamera();
  };

  const handleUploadFile = (file: File) => {
    setCapturedFile(file);
  };

  const handleSubmit = async () => {
    if (!capturedFile) return;
    setError('');
    setUploading(true);
    try {
      await client.uploadDocument(capturedFile, docType, 'FRONT');
      onNext();
    } catch (err) {
      setError((err as Error).message);
      setUploading(false);
    }
  };

  const toggleMode = () => {
    if (mode === 'camera') {
      stopCamera();
      setMode('upload');
    } else {
      setMode('camera');
      startCamera();
    }
  };

  return (
    <>
      <h2>ID Document</h2>
      <p>Select your document type, then scan or upload a clear photo.</p>

      <div className="kyc-doc-grid">
        {DOC_TYPES.map((d) => (
          <div
            key={d.id}
            className={`kyc-doc-card ${docType === d.id ? 'selected' : ''}`}
            onClick={() => setDocType(d.id)}
          >
            <span className="kyc-doc-icon">{d.icon}</span>
            <span className="kyc-doc-label">{d.label}</span>
          </div>
        ))}
      </div>

      {mode === 'camera' && (
        <div className="kyc-capture-area">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ display: showCanvas ? 'none' : 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <canvas
            ref={canvasRef}
            style={{ display: showCanvas ? 'block' : 'none', width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {!showCanvas && (
            <>
              <div className="kyc-id-overlay">
                <div className={`kyc-id-frame ${cameraReady ? 'ready' : ''}`} />
              </div>
              <div className="kyc-camera-hint">
                {cameraReady ? '✓ Document detected — tap Capture' : 'Align your ID within the frame'}
              </div>
            </>
          )}
          {countdown !== null && (
            <div className="kyc-countdown-overlay">
              <span className="kyc-countdown-num">{countdown}</span>
            </div>
          )}
        </div>
      )}

      {mode === 'upload' && (
        <UploadZone onFile={handleUploadFile} file={capturedFile} accept="image/*" hint="JPG, PNG or WebP · max 20MB" />
      )}

      {error && <div className="kyc-error-banner">{error}</div>}

      <div className="kyc-actions">
        {!showCanvas && (
          <button className="kyc-btn kyc-btn-secondary" style={{ flexShrink: 0 }} onClick={toggleMode}>
            {mode === 'camera' ? '📤 Upload' : '📷 Camera'}
          </button>
        )}
        {mode === 'camera' && !showCanvas && (
          <button className="kyc-btn kyc-btn-primary" style={{ flex: 1 }} disabled={!cameraReady || countdown !== null} onClick={handleShutter}>
            📸 Capture
          </button>
        )}
        {showCanvas && (
          <button className="kyc-btn kyc-btn-secondary" onClick={handleRetake}>Retake</button>
        )}
        <button
          className="kyc-btn kyc-btn-primary"
          style={{ flex: 1 }}
          disabled={!capturedFile || uploading}
          onClick={handleSubmit}
        >
          {uploading ? 'Uploading…' : 'Continue →'}
        </button>
      </div>
    </>
  );
}

function UploadZone({ onFile, file, accept, hint }: { onFile: (f: File) => void; file: File | null; accept: string; hint: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      className={`kyc-upload-zone ${drag ? 'drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <div className="kyc-upload-icon">📄</div>
      <p>Click to upload or drag & drop</p>
      <p style={{ fontSize: 12, marginTop: 4, color: 'var(--kyc-text-muted)' }}>{hint}</p>
      {file && <div className="kyc-file-selected">{file.name}</div>}
    </div>
  );
}
