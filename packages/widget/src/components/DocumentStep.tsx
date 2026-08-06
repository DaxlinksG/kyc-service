import React, { useEffect, useRef, useState } from 'react';
import type { SessionClient } from '../api/sessionClient.js';
import { initBarcodeScanner, scanPdf417 } from '../lib/barcodeScanner.js';
import { COUNTRIES, flagEmoji, AAMVA_BARCODE_COUNTRIES } from '../lib/countries.js';

interface Props {
  client: SessionClient;
  apiBaseUrl: string;
  onNext: () => void;
  onError: (msg: string) => void;
}

const DOC_TYPES = [
  { id: 'PASSPORT', icon: '🛂', label: 'Passport' },
  { id: 'NATIONAL_ID', icon: '🪪', label: 'National ID' },
  { id: 'DRIVING_LICENSE', icon: '🚗', label: "Driver's License" },
] as const;

// Document types that MAY have a scannable barcode on the back. Only North
// American driver's licenses / ID cards actually carry an AAMVA PDF417 barcode,
// so the back-scan step is additionally gated on the selected country below.
const DOCS_WITH_BACK = new Set(['NATIONAL_ID', 'DRIVING_LICENSE']);

type Phase = 'front' | 'back';

export function DocumentStep({ client, apiBaseUrl, onNext, onError }: Props) {
  const [country, setCountry] = useState<string>('');
  const [docType, setDocType] = useState<string>('PASSPORT');
  const [phase, setPhase] = useState<Phase>('front');
  const [mode, setMode] = useState<'camera' | 'upload'>('camera');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [barcodeRaw, setBarcodeRaw] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showCanvas, setShowCanvas] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanBusyRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A back scan is only meaningful for North American licenses/ID cards, which
  // carry an AAMVA PDF417 barcode. For every other country the front image + OCR
  // is authoritative, so we don't send the user through a barcode step that can't
  // apply to their document.
  const requiresBack = DOCS_WITH_BACK.has(docType) && AAMVA_BARCODE_COUNTRIES.has(country);
  const scanningBack = phase === 'back' && requiresBack;

  useEffect(() => {
    initBarcodeScanner(apiBaseUrl);
  }, [apiBaseUrl]);

  const startCamera = async () => {
    // Release any stream still held before opening a new one. startCamera is called
    // on doc-type change, retake, back-step and mode toggle, each of which would
    // otherwise overwrite streamRef and leak the previous camera track.
    stopCamera();
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
    return () => {
      stopCamera();
      // Cancel an in-flight countdown so its callback can't run captureFrame()
      // against refs that are null after unmount.
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // Live PDF417 scanning loop — active only on the back of a DL/ID while the
  // camera is live and no frame has been captured yet.
  useEffect(() => {
    if (!scanningBack || mode !== 'camera' || !cameraReady || showCanvas) return;

    // Guard against the async decode resolving after this effect is torn down
    // (unmount or dependency change), which would setState/stopCamera on a stale
    // component and could re-open/leak the camera.
    let cancelled = false;

    const interval = setInterval(async () => {
      if (scanBusyRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return;

      scanBusyRef.current = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const raw = await scanPdf417(imageData);
        if (raw && !cancelled) {
          // Freeze this frame as the back image and keep the decoded barcode.
          setBarcodeRaw(raw);
          setShowCanvas(true);
          canvas.toBlob(
            (blob) => { if (blob) setCapturedFile(new File([blob], 'document-back.jpg', { type: 'image/jpeg' })); },
            'image/jpeg',
            0.95,
          );
          stopCamera();
        }
      } catch {
        // decode errors are expected frame-to-frame; keep scanning
      } finally {
        scanBusyRef.current = false;
      }
    }, 350);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scanningBack, mode, cameraReady, showCanvas]);

  const captureFrame = () => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stopCamera();
    setShowCanvas(true);
    const name = phase === 'back' ? 'document-back.jpg' : 'document.jpg';
    canvas.toBlob((blob) => {
      if (blob) setCapturedFile(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.95);
  };

  const handleShutter = () => {
    if (!cameraReady) return;
    let n = 3;
    setCountdown(n);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      n--;
      if (n > 0) setCountdown(n);
      else {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        setCountdown(null);
        captureFrame();
      }
    }, 1000);
  };

  const handleRetake = () => {
    setCapturedFile(null);
    setBarcodeRaw(null);
    setShowCanvas(false);
    setCameraReady(false);
    startCamera();
  };

  const handleUploadFile = (file: File) => {
    setCapturedFile(file);
    // A hand-uploaded back image can't be barcode-scanned live; backend OCR handles it.
    if (phase === 'back') setBarcodeRaw(null);
  };

  const selectCountry = (code: string) => {
    setCountry(code);
    // Camera is deferred until an issuing country is chosen — kick it off now so
    // the applicant lands straight on a live viewfinder once they've picked.
    if (code && mode === 'camera' && !capturedFile) startCamera();
  };

  const selectDocType = (id: string) => {
    if (id === docType) return;
    setDocType(id);
    setPhase('front');
    setBarcodeRaw(null);
    handleRetake();
  };

  const goToBack = () => {
    setPhase('back');
    setCapturedFile(null);
    setBarcodeRaw(null);
    setShowCanvas(false);
    setCameraReady(false);
    startCamera();
  };

  const handleSubmit = async () => {
    if (!capturedFile) return;
    setError('');
    setUploading(true);
    try {
      if (phase === 'front') {
        await client.uploadDocument(capturedFile, docType, 'FRONT');
        if (requiresBack) {
          setUploading(false);
          goToBack();
          return;
        }
        onNext();
      } else {
        await client.uploadDocument(capturedFile, docType, 'BACK', barcodeRaw ?? undefined);
        onNext();
      }
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

  const heading = phase === 'front' ? 'ID Document' : 'Back of Card';
  const needsCountry = phase === 'front' && !country;
  const subheading = phase === 'front'
    ? (needsCountry
        ? 'Verification is available worldwide. Tell us where your document was issued to begin.'
        : 'Select your document type, then scan or upload a clear photo.')
    : 'If your card has a barcode on the back, show it — we scan it automatically. No barcode? Skip this step below.';

  return (
    <>
      <h2>{heading}</h2>
      <p>{subheading}</p>

      {phase === 'front' && (
        <label className="kyc-field">
          <span className="kyc-field-label">Issuing country</span>
          <div className="kyc-select-wrap">
            <span className="kyc-select-flag">{country ? flagEmoji(country) : '🌍'}</span>
            <select
              className="kyc-select"
              value={country}
              onChange={(e) => selectCountry(e.target.value)}
            >
              <option value="" disabled>Select country…</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </label>
      )}

      {phase === 'front' && !needsCountry && (
        <div className="kyc-doc-grid">
          {DOC_TYPES.map((d) => (
            <div
              key={d.id}
              className={`kyc-doc-card ${docType === d.id ? 'selected' : ''}`}
              onClick={() => selectDocType(d.id)}
            >
              <span className="kyc-doc-icon">{d.icon}</span>
              <span className="kyc-doc-label">{d.label}</span>
            </div>
          ))}
        </div>
      )}

      {!needsCountry && mode === 'camera' && (
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
                {scanningBack
                  ? (cameraReady ? '🔎 Scanning barcode…' : 'Align the back of your card within the frame')
                  : (cameraReady ? '✓ Document detected — tap Capture' : 'Align your ID within the frame')}
              </div>
            </>
          )}
          {showCanvas && barcodeRaw && (
            <div className="kyc-camera-hint">✓ Barcode captured</div>
          )}
          {countdown !== null && (
            <div className="kyc-countdown-overlay">
              <span className="kyc-countdown-num">{countdown}</span>
            </div>
          )}
        </div>
      )}

      {!needsCountry && mode === 'upload' && (
        <UploadZone onFile={handleUploadFile} file={capturedFile} accept="image/*" hint="JPG, PNG or WebP · max 20MB" />
      )}

      {error && <div className="kyc-error-banner">{error}</div>}

      {!needsCountry && (
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
      )}

      {/* Not every card has a scannable barcode (e.g. a Nigerian National ID or
          driver's license). Let those users skip the back step rather than forcing
          a scan that can't apply — the front image / OCR still drives the check. */}
      {phase === 'back' && !showCanvas && (
        <button
          className="kyc-btn-skip"
          style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: 'var(--kyc-text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: 13 }}
          disabled={uploading}
          onClick={() => { stopCamera(); onNext(); }}
        >
          My ID has no barcode — skip this step
        </button>
      )}
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
