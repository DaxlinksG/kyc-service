import type { SessionClient } from '../api/sessionClient.js';

export type StepName = 'welcome' | 'document' | 'selfie' | 'address' | 'processing' | 'result';

export interface StepContext {
  client: SessionClient;
  container: HTMLElement;
  onComplete: (decision: string) => void;
  onError: (error: Error) => void;
  advance: () => void;
  showError: (msg: string) => void;
}

const STEPS: StepName[] = ['welcome', 'document', 'selfie', 'address', 'processing', 'result'];
const PROGRESS_STEPS: StepName[] = ['document', 'selfie', 'address']; // shown in indicator

export class StepManager {
  private currentIndex = 0;
  private activeStream: MediaStream | null = null;

  constructor(private readonly ctx: StepContext) {}

  async start(): Promise<void> { this.render(); }

  advance(): void {
    this.stopCamera();
    if (this.currentIndex < STEPS.length - 1) {
      this.currentIndex++;
      this.render();
    }
  }

  private stopCamera() {
    this.activeStream?.getTracks().forEach((t) => t.stop());
    this.activeStream = null;
  }

  private render(): void {
    const step = STEPS[this.currentIndex]!;
    this.ctx.container.innerHTML = '';

    // Progress indicator (only during capture steps)
    if (PROGRESS_STEPS.includes(step)) {
      const indicator = document.createElement('div');
      indicator.className = 'step-indicator';
      PROGRESS_STEPS.forEach((s, i) => {
        const dot = document.createElement('div');
        const idx = PROGRESS_STEPS.indexOf(step);
        dot.className = `step-dot ${i < idx ? 'done' : i === idx ? 'active' : ''}`;
        dot.textContent = i < idx ? '' : String(i + 1);
        if (i < idx) dot.textContent = '✓';
        indicator.appendChild(dot);
        if (i < PROGRESS_STEPS.length - 1) {
          const line = document.createElement('div');
          line.className = `step-line ${i < idx ? 'done' : ''}`;
          indicator.appendChild(line);
        }
      });
      this.ctx.container.appendChild(indicator);
    }

    switch (step) {
      case 'welcome':    this.renderWelcome(); break;
      case 'document':   this.renderDocument(); break;
      case 'selfie':     this.renderSelfie(); break;
      case 'address':    this.renderAddress(); break;
      case 'processing': this.renderProcessing(); break;
      case 'result':     break;
    }
  }

  // ─── WELCOME ────────────────────────────────────────────────────────────────

  private renderWelcome(): void {
    const el = this.ctx.container;
    el.insertAdjacentHTML('beforeend', `
      <h2>Identity Verification</h2>
      <p>We need to verify your identity to continue. This takes about 2–3 minutes.</p>
      <ul class="check-list" style="margin-top:20px">
        <li>Government-issued ID (passport, national ID, or driver's license)</li>
        <li>A short selfie video to confirm it's you</li>
        <li>Proof of address (utility bill or bank statement)</li>
      </ul>
      <p style="margin-top:16px;font-size:12px">
        Your data is encrypted and processed securely. We never store raw video.
      </p>
      <div class="actions">
        <button class="btn btn-primary" id="start-btn" style="flex:1">Start Verification →</button>
      </div>
    `);
    el.querySelector('#start-btn')!.addEventListener('click', () => this.advance());
  }

  // ─── DOCUMENT ────────────────────────────────────────────────────────────────

  private renderDocument(): void {
    const el = this.ctx.container;
    let selectedType = 'PASSPORT';
    let capturedFile: File | null = null;
    let cameraMode = false;
    let stream: MediaStream | null = null;
    let captureReady = false;

    const docTypes = [
      { id: 'PASSPORT', icon: '🛂', label: 'Passport' },
      { id: 'NATIONAL_ID', icon: '🪪', label: 'National ID' },
      { id: 'DRIVERS_LICENSE', icon: '🚗', label: "Driver's\nLicense" },
    ];

    el.insertAdjacentHTML('beforeend', `
      <h2>ID Document</h2>
      <p>Select your document type, then scan or upload a clear photo.</p>
      <div class="doc-type-grid">
        ${docTypes.map((d) => `
          <div class="doc-type-card ${d.id === selectedType ? 'selected' : ''}" data-type="${d.id}">
            <span class="doc-icon">${d.icon}</span>
            <span class="doc-label">${d.label}</span>
          </div>`).join('')}
      </div>
      <div class="capture-area" id="doc-capture">
        <div class="cam-error" id="doc-cam-error" style="display:none">
          <span style="font-size:32px">📷</span>
          <p>Camera not available</p>
          <p>Please upload a photo instead</p>
        </div>
        <video id="doc-video" autoplay muted playsinline style="display:none"></video>
        <canvas id="doc-canvas" style="display:none"></canvas>
        <div class="id-overlay" id="doc-overlay" style="display:none">
          <div class="id-frame" id="id-frame"></div>
        </div>
        <div class="camera-hint" id="doc-hint" style="display:none">Align your ID within the frame</div>
        <div class="countdown-overlay" id="doc-countdown" style="display:none">
          <span class="countdown-num" id="doc-count-num"></span>
        </div>
      </div>
      <div class="upload-zone" id="doc-upload" style="display:none">
        <input type="file" id="doc-file" accept="image/*,.pdf">
        <div class="upload-icon">📄</div>
        <p>Click to upload or drag & drop</p>
        <p style="font-size:12px;margin-top:4px;color:var(--kyc-text-muted)">JPG, PNG, WebP or PDF · max 20MB</p>
        <div class="file-selected" id="doc-filename"></div>
      </div>
      <div id="doc-error"></div>
      <div class="actions">
        <button class="btn btn-secondary" id="doc-toggle" style="flex:0 0 auto">📤 Upload</button>
        <button class="btn btn-primary" id="doc-shutter" style="flex:1;display:none">📸 Capture</button>
        <button class="btn btn-primary" id="doc-retake" style="display:none">Retake</button>
        <button class="btn btn-primary" id="doc-submit" disabled style="flex:1">Continue →</button>
      </div>
    `);

    const video = el.querySelector('#doc-video') as HTMLVideoElement;
    const canvas = el.querySelector('#doc-canvas') as HTMLCanvasElement;
    const overlay = el.querySelector('#doc-overlay') as HTMLElement;
    const idFrame = el.querySelector('#id-frame') as HTMLElement;
    const hint = el.querySelector('#doc-hint') as HTMLElement;
    const countdown = el.querySelector('#doc-countdown') as HTMLElement;
    const countNum = el.querySelector('#doc-count-num') as HTMLElement;
    const uploadZone = el.querySelector('#doc-upload') as HTMLElement;
    const fileInput = el.querySelector('#doc-file') as HTMLInputElement;
    const toggleBtn = el.querySelector('#doc-toggle') as HTMLButtonElement;
    const shutterBtn = el.querySelector('#doc-shutter') as HTMLButtonElement;
    const retakeBtn = el.querySelector('#doc-retake') as HTMLButtonElement;
    const submitBtn = el.querySelector('#doc-submit') as HTMLButtonElement;
    const errorDiv = el.querySelector('#doc-error') as HTMLElement;
    const camError = el.querySelector('#doc-cam-error') as HTMLElement;

    el.querySelectorAll('.doc-type-card').forEach((card) => {
      card.addEventListener('click', () => {
        el.querySelectorAll('.doc-type-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedType = (card as HTMLElement).dataset['type']!;
      });
    });

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        this.activeStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        overlay.style.display = 'flex';
        hint.style.display = 'block';
        shutterBtn.style.display = 'flex';
        camError.style.display = 'none';
        uploadZone.style.display = 'none';
        cameraMode = true;

        // Simulate "ready" after 1.5s (in production you'd check for edges/contrast)
        setTimeout(() => {
          idFrame.classList.add('ready');
          hint.textContent = '✓ Document detected — tap Capture';
          captureReady = true;
        }, 1500);
      } catch {
        camError.style.display = 'flex';
        showUploadFallback();
      }
    };

    const showUploadFallback = () => {
      video.style.display = 'none';
      overlay.style.display = 'none';
      hint.style.display = 'none';
      shutterBtn.style.display = 'none';
      uploadZone.style.display = 'block';
      toggleBtn.textContent = '📷 Camera';
      cameraMode = false;
    };

    const stopCamera = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      this.activeStream = null;
    };

    startCamera();

    toggleBtn.addEventListener('click', () => {
      if (cameraMode) {
        stopCamera();
        showUploadFallback();
      } else {
        uploadZone.style.display = 'none';
        toggleBtn.textContent = '📤 Upload';
        startCamera();
      }
    });

    // Capture with countdown
    shutterBtn.addEventListener('click', () => {
      if (!captureReady) return;
      shutterBtn.disabled = true;
      countdown.style.display = 'flex';
      let n = 3;
      countNum.textContent = String(n);
      const tick = setInterval(() => {
        n--;
        if (n > 0) { countNum.textContent = String(n); }
        else {
          clearInterval(tick);
          countdown.style.display = 'none';
          captureFrame();
        }
      }, 1000);
    });

    const captureFrame = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      stopCamera();
      video.style.display = 'none';
      canvas.style.display = 'block';
      overlay.style.display = 'none';
      hint.style.display = 'none';
      shutterBtn.style.display = 'none';
      retakeBtn.style.display = 'flex';
      submitBtn.disabled = false;

      canvas.toBlob((blob) => {
        if (blob) capturedFile = new File([blob], 'document.jpg', { type: 'image/jpeg' });
      }, 'image/jpeg', 0.95);
    };

    retakeBtn.addEventListener('click', () => {
      capturedFile = null;
      canvas.style.display = 'none';
      retakeBtn.style.display = 'none';
      submitBtn.disabled = true;
      captureReady = false;
      idFrame.classList.remove('ready');
      startCamera();
    });

    // Upload fallback
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault(); uploadZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) setUploadFile(file);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) setUploadFile(fileInput.files[0]); });

    const setUploadFile = (file: File) => {
      capturedFile = file;
      submitBtn.disabled = false;
      el.querySelector('#doc-filename')!.textContent = file.name;
    };

    submitBtn.addEventListener('click', async () => {
      if (!capturedFile) return;
      errorDiv.innerHTML = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await this.ctx.client.uploadDocument(capturedFile, selectedType, 'FRONT');
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue →';
      }
    });
  }

  // ─── SELFIE ──────────────────────────────────────────────────────────────────

  private renderSelfie(): void {
    const el = this.ctx.container;
    let capturedFile: File | null = null;
    let stream: MediaStream | null = null;
    let phase: 'camera' | 'preview' | 'upload' = 'camera';

    el.insertAdjacentHTML('beforeend', `
      <h2>Take a Selfie</h2>
      <p>Look straight at the camera. Good lighting, no sunglasses.</p>
      <div class="capture-area" id="selfie-capture">
        <div class="cam-error" id="selfie-cam-error" style="display:none">
          <span style="font-size:32px">🤳</span>
          <p>Camera not available</p>
          <p>Please upload a photo instead</p>
        </div>
        <video id="selfie-video" autoplay muted playsinline style="display:none;transform:scaleX(-1)"></video>
        <canvas id="selfie-canvas" style="display:none"></canvas>
        <div class="face-overlay" id="selfie-overlay" style="display:none">
          <div class="face-oval" id="face-oval"></div>
        </div>
        <div class="camera-top-hint" id="selfie-hint" style="display:none">Centre your face in the oval</div>
        <div class="countdown-overlay" id="selfie-countdown" style="display:none">
          <span class="countdown-num" id="selfie-count-num"></span>
        </div>
      </div>
      <div class="upload-zone" id="selfie-upload" style="display:none">
        <input type="file" id="selfie-file" accept="image/*" capture="user">
        <div class="upload-icon">🤳</div>
        <p>Tap to take a selfie or choose photo</p>
        <div class="file-selected" id="selfie-filename"></div>
      </div>
      <div id="selfie-error"></div>
      <div class="actions">
        <button class="btn btn-secondary" id="selfie-toggle" style="flex:0 0 auto">📤 Upload</button>
        <button class="btn btn-primary" id="selfie-shutter" style="flex:1;display:none">📸 Capture</button>
        <button class="btn btn-secondary" id="selfie-retake" style="display:none">Retake</button>
        <button class="btn btn-primary" id="selfie-submit" disabled style="flex:1">Submit →</button>
      </div>
    `);

    const video = el.querySelector('#selfie-video') as HTMLVideoElement;
    const canvas = el.querySelector('#selfie-canvas') as HTMLCanvasElement;
    const overlay = el.querySelector('#selfie-overlay') as HTMLElement;
    const faceOval = el.querySelector('#face-oval') as HTMLElement;
    const hint = el.querySelector('#selfie-hint') as HTMLElement;
    const countdown = el.querySelector('#selfie-countdown') as HTMLElement;
    const countNum = el.querySelector('#selfie-count-num') as HTMLElement;
    const uploadZone = el.querySelector('#selfie-upload') as HTMLElement;
    const fileInput = el.querySelector('#selfie-file') as HTMLInputElement;
    const toggleBtn = el.querySelector('#selfie-toggle') as HTMLButtonElement;
    const shutterBtn = el.querySelector('#selfie-shutter') as HTMLButtonElement;
    const retakeBtn = el.querySelector('#selfie-retake') as HTMLButtonElement;
    const submitBtn = el.querySelector('#selfie-submit') as HTMLButtonElement;
    const errorDiv = el.querySelector('#selfie-error') as HTMLElement;
    const camError = el.querySelector('#selfie-cam-error') as HTMLElement;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        this.activeStream = stream;
        video.srcObject = stream;
        video.style.display = 'block';
        overlay.style.display = 'flex';
        hint.style.display = 'block';
        shutterBtn.style.display = 'flex';
        camError.style.display = 'none';
        uploadZone.style.display = 'none';
        phase = 'camera';

        // Animate oval to "ready" after 1.5s
        setTimeout(() => {
          faceOval.classList.add('ready');
          hint.textContent = '✓ Face detected — tap Capture';
        }, 1500);
      } catch {
        camError.style.display = 'flex';
        showUploadFallback();
      }
    };

    const showUploadFallback = () => {
      video.style.display = 'none';
      overlay.style.display = 'none';
      hint.style.display = 'none';
      shutterBtn.style.display = 'none';
      uploadZone.style.display = 'block';
      toggleBtn.textContent = '📷 Camera';
      phase = 'upload';
    };

    const stopCamera = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      this.activeStream = null;
    };

    startCamera();

    toggleBtn.addEventListener('click', () => {
      if (phase === 'camera') {
        stopCamera();
        showUploadFallback();
      } else {
        uploadZone.style.display = 'none';
        canvas.style.display = 'none';
        retakeBtn.style.display = 'none';
        submitBtn.disabled = true;
        toggleBtn.textContent = '📤 Upload';
        faceOval.classList.remove('ready');
        startCamera();
      }
    });

    shutterBtn.addEventListener('click', () => {
      shutterBtn.disabled = true;
      countdown.style.display = 'flex';
      let n = 3;
      countNum.textContent = String(n);
      const tick = setInterval(() => {
        n--;
        if (n > 0) { countNum.textContent = String(n); }
        else {
          clearInterval(tick);
          countdown.style.display = 'none';
          captureFrame();
        }
      }, 1000);
    });

    const captureFrame = () => {
      // Mirror canvas to match mirrored video display
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      stopCamera();
      video.style.display = 'none';
      canvas.style.display = 'block';
      overlay.style.display = 'none';
      hint.style.display = 'none';
      shutterBtn.style.display = 'none';
      retakeBtn.style.display = 'flex';
      submitBtn.disabled = false;
      phase = 'preview';

      canvas.toBlob((blob) => {
        if (blob) capturedFile = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
      }, 'image/jpeg', 0.92);
    };

    retakeBtn.addEventListener('click', () => {
      capturedFile = null;
      canvas.style.display = 'none';
      retakeBtn.style.display = 'none';
      submitBtn.disabled = true;
      faceOval.classList.remove('ready');
      startCamera();
    });

    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        capturedFile = file;
        submitBtn.disabled = false;
        el.querySelector('#selfie-filename')!.textContent = file.name;
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (!capturedFile) return;
      errorDiv.innerHTML = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await this.ctx.client.uploadSelfie(capturedFile);
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit →';
      }
    });
  }

  // ─── ADDRESS ─────────────────────────────────────────────────────────────────

  private renderAddress(): void {
    const el = this.ctx.container;
    let selectedType = 'UTILITY_BILL';
    let selectedFile: File | null = null;

    const types = [
      { id: 'UTILITY_BILL', icon: '💡', label: 'Utility Bill', desc: 'Gas, electricity, water, internet' },
      { id: 'BANK_STATEMENT', icon: '🏦', label: 'Bank Statement', desc: 'Official bank or credit union statement' },
      { id: 'GOVERNMENT_LETTER', icon: '📮', label: 'Government Letter', desc: 'Tax, benefits, or official government mail' },
    ];

    el.insertAdjacentHTML('beforeend', `
      <h2>Proof of Address</h2>
      <p>Upload a document dated within the last 90 days showing your name and address.</p>
      <div class="addr-type-list">
        ${types.map((t) => `
          <div class="addr-type-item ${t.id === selectedType ? 'selected' : ''}" data-type="${t.id}">
            <span class="addr-icon">${t.icon}</span>
            <div class="addr-text">
              <div class="addr-label">${t.label}</div>
              <div class="addr-desc">${t.desc}</div>
            </div>
            <div class="addr-check"></div>
          </div>`).join('')}
      </div>
      <div class="upload-zone" id="addr-zone">
        <input type="file" id="addr-file" accept="image/*,.pdf">
        <div class="upload-icon">📄</div>
        <p>Click to upload or drag & drop</p>
        <p style="font-size:12px;margin-top:4px;color:var(--kyc-text-muted)">JPG, PNG, WebP or PDF · max 20MB</p>
        <div class="file-selected" id="addr-filename"></div>
      </div>
      <div id="addr-error"></div>
      <div class="actions">
        <button class="btn btn-primary" id="addr-submit" disabled style="flex:1">Submit & Verify →</button>
      </div>
    `);

    const zone = el.querySelector('#addr-zone') as HTMLElement;
    const fileInput = el.querySelector('#addr-file') as HTMLInputElement;
    const submitBtn = el.querySelector('#addr-submit') as HTMLButtonElement;
    const errorDiv = el.querySelector('#addr-error') as HTMLElement;

    el.querySelectorAll('.addr-type-item').forEach((item) => {
      item.addEventListener('click', () => {
        el.querySelectorAll('.addr-type-item').forEach((i) => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedType = (item as HTMLElement).dataset['type']!;
      });
    });

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) setFile(file);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) setFile(fileInput.files[0]); });

    const setFile = (file: File) => {
      selectedFile = file;
      submitBtn.disabled = false;
      el.querySelector('#addr-filename')!.textContent = file.name;
    };

    submitBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      errorDiv.innerHTML = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await this.ctx.client.uploadAddress(selectedFile, selectedType);
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit & Verify →';
      }
    });
  }

  // ─── PROCESSING ──────────────────────────────────────────────────────────────

  private renderProcessing(): void {
    const el = this.ctx.container;
    el.insertAdjacentHTML('beforeend', `
      <div class="result-center">
        <div class="spinner"></div>
        <h2 style="margin-top:24px">Verifying…</h2>
        <p style="margin-top:8px">Checking your documents. This usually takes 10–30 seconds.</p>
      </div>
    `);

    const POLL_MS = 3000;
    const TIMEOUT_MS = 120_000;
    const deadline = Date.now() + TIMEOUT_MS;
    const TERMINAL = new Set(['approved', 'rejected', 'manual_review', 'expired']);

    const poll = async () => {
      try {
        const status = await this.ctx.client.getStatus();
        if (TERMINAL.has(status.state)) {
          this.renderResult(status.state, status.risk_score?.score);
          return;
        }
        if (Date.now() < deadline) setTimeout(poll, POLL_MS);
        else this.renderResult('expired');
      } catch (err) {
        el.innerHTML = `<div class="error-banner" style="margin:24px">${(err as Error).message}</div>`;
      }
    };

    setTimeout(poll, POLL_MS);
  }

  // ─── RESULT ──────────────────────────────────────────────────────────────────

  private renderResult(state: string, score?: number): void {
    const el = this.ctx.container;

    const config: Record<string, { icon: string; title: string; msg: string }> = {
      approved: { icon: '✅', title: 'Verification Approved', msg: 'Your identity has been successfully verified.' },
      rejected: { icon: '❌', title: 'Verification Failed', msg: 'We were unable to verify your identity. Please contact support.' },
      manual_review: { icon: '⏳', title: 'Under Review', msg: "Your documents are being reviewed. We'll notify you once complete." },
      expired: { icon: '⚠️', title: 'Session Expired', msg: 'This session has expired. Please start a new verification.' },
    };

    const c = config[state] ?? { icon: '❓', title: 'Unknown', msg: '' };

    el.innerHTML = `
      <div class="result-center">
        <div class="result-icon ${state}">${c.icon}</div>
        <h2>${c.title}</h2>
        <p style="margin-top:10px">${c.msg}</p>
        ${score !== undefined ? `<span class="score-pill">Confidence: ${Math.round(score * 100)}%</span>` : ''}
      </div>
    `;

    this.ctx.onComplete(state);
  }
}
