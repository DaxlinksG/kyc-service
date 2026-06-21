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
      { id: 'DRIVING_LICENSE', icon: '🚗', label: "Driver's\nLicense" },
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
        <input type="file" id="doc-file" accept="image/*">
        <div class="upload-icon">📄</div>
        <p>Click to upload or drag & drop</p>
        <p style="font-size:12px;margin-top:4px;color:var(--kyc-text-muted)">JPG, PNG or WebP · max 20MB</p>
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

  // ─── SELFIE (AWS Face Liveness via iframe) ───────────────────────────────────

  private renderSelfie(): void {
    const el = this.ctx.container;

    el.insertAdjacentHTML('beforeend', `
      <h2>Liveness Check</h2>
      <p>We need to confirm you're a real person. Follow the on-screen instructions.</p>
      <div id="liveness-container" style="position:relative;width:100%;min-height:400px;border-radius:12px;overflow:hidden;background:#0f172a;margin-top:12px">
        <div id="liveness-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#94a3b8;font-size:14px">
          <div class="spinner"></div>
          <span>Preparing liveness check…</span>
        </div>
      </div>
      <div id="selfie-error" style="margin-top:8px"></div>
    `);

    const container = el.querySelector('#liveness-container') as HTMLElement;
    const errorDiv = el.querySelector('#selfie-error') as HTMLElement;

    const showError = (msg: string) => {
      container.innerHTML = '';
      errorDiv.innerHTML = `<div class="error-banner">${msg}</div>`;
    };

    const launchLiveness = async () => {
      try {
        // 1. Get face liveness session params from server
        const sessionId = this.ctx.client.getSessionId();
        const data = await this.ctx.client.createFaceLivenessSession(sessionId);

        // 2. Build iframe URL
        const apiBase = this.ctx.client.getApiBase();
        const params = new URLSearchParams({
          session_token: this.ctx.client.getSessionToken(),
          face_liveness_session_id: data.face_liveness_session_id,
          region: data.region,
          api_base: apiBase,
          access_key_id: data.access_key_id,
          secret_access_key: data.secret_access_key,
        });

        const iframe = document.createElement('iframe');
        iframe.src = `${apiBase}/liveness/?${params.toString()}`;
        iframe.style.cssText = 'width:100%;height:520px;border:none;border-radius:12px;display:block;';
        iframe.allow = 'camera; microphone';
        iframe.setAttribute('allowfullscreen', '');

        container.innerHTML = '';
        container.appendChild(iframe);

        // 3. Listen for result from iframe
        const onMessage = (e: MessageEvent) => {
          if (e.data?.type === 'kyc:liveness:done') {
            window.removeEventListener('message', onMessage);
            container.innerHTML = `
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:12px;color:#16a34a">
                <div style="width:56px;height:56px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;font-size:24px">✓</div>
                <span style="font-size:14px;color:#94a3b8">Liveness confirmed — continuing…</span>
              </div>`;
            setTimeout(() => this.advance(), 800);
          } else if (e.data?.type === 'kyc:liveness:error') {
            window.removeEventListener('message', onMessage);
            showError(e.data.message ?? 'Liveness check failed. Please try again.');
          }
        };
        window.addEventListener('message', onMessage);

      } catch (err) {
        showError((err as Error).message ?? 'Could not start liveness check.');
      }
    };

    launchLiveness();
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
        <input type="file" id="addr-file" accept="image/*">
        <div class="upload-icon">📄</div>
        <p>Click to upload or drag & drop</p>
        <p style="font-size:12px;margin-top:4px;color:var(--kyc-text-muted)">JPG, PNG or WebP · max 20MB</p>
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

    const config: Record<string, { svg: string; title: string; msg: string }> = {
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

    const c = config[state] ?? config['rejected'];

    el.innerHTML = `
      <div class="result-center">
        <div class="result-icon-svg">${c.svg}</div>
        <h2>${c.title}</h2>
        <p style="margin-top:10px;color:var(--kyc-text-muted);line-height:1.5">${c.msg}</p>
      </div>
    `;

    this.ctx.onComplete(state);
  }
}
