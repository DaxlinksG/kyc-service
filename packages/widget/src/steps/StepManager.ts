import type { SessionClient } from '../api/sessionClient.js';

export type StepName = 'welcome' | 'document' | 'selfie' | 'address' | 'result';

export interface StepContext {
  client: SessionClient;
  container: HTMLElement;
  onComplete: (decision: string) => void;
  onError: (error: Error) => void;
  advance: () => void;
  showError: (msg: string) => void;
}

const STEP_ORDER: StepName[] = ['welcome', 'document', 'selfie', 'address', 'result'];

export class StepManager {
  private currentIndex = 0;

  constructor(private readonly ctx: StepContext) {}

  async start(): Promise<void> {
    this.render();
  }

  advance(): void {
    if (this.currentIndex < STEP_ORDER.length - 1) {
      this.currentIndex++;
      this.render();
    }
  }

  private render(): void {
    const step = STEP_ORDER[this.currentIndex]!;
    this.ctx.container.innerHTML = '';

    // Progress dots
    const dots = document.createElement('div');
    dots.className = 'step-indicator';
    for (let i = 0; i < STEP_ORDER.length - 1; i++) {
      const dot = document.createElement('div');
      dot.className = `step-dot ${i < this.currentIndex ? 'done' : i === this.currentIndex ? 'active' : ''}`;
      dots.appendChild(dot);
    }
    if (step !== 'result') this.ctx.container.appendChild(dots);

    switch (step) {
      case 'welcome': this.renderWelcome(); break;
      case 'document': this.renderDocument(); break;
      case 'selfie': this.renderSelfie(); break;
      case 'address': this.renderAddress(); break;
      case 'result': this.renderResult(); break;
    }
  }

  private renderWelcome(): void {
    const el = this.ctx.container;
    el.innerHTML += `
      <h2>Identity Verification</h2>
      <p>We need to verify your identity. This takes about 2 minutes. Please have ready:</p>
      <ul style="margin:16px 0 0 18px; font-size:14px; color:var(--kyc-text-muted); line-height:2">
        <li>A valid government-issued ID (passport or ID card)</li>
        <li>A selfie photo</li>
        <li>Proof of address (utility bill or bank statement)</li>
      </ul>
      <div class="actions">
        <button class="btn btn-primary" id="start-btn" style="flex:1">Start Verification</button>
      </div>
    `;
    el.querySelector('#start-btn')!.addEventListener('click', () => this.advance());
  }

  private renderDocument(): void {
    const el = this.ctx.container;
    const types = ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE'];
    let selectedType = 'PASSPORT';
    let selectedSide = 'FRONT';

    el.innerHTML += `
      <h2>Upload ID Document</h2>
      <p>Select your document type and upload a clear photo of the front.</p>
      <div class="select-row">
        ${types.map((t) => `<button class="type-btn${t === selectedType ? ' selected' : ''}" data-type="${t}">${t.replace('_', ' ')}</button>`).join('')}
      </div>
      <div class="upload-zone" id="doc-zone">
        <input type="file" id="doc-file" accept="image/*,.pdf">
        <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 8px;color:var(--kyc-text-muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
        <p>Click to upload or drag & drop</p>
        <p style="font-size:12px;margin-top:4px">JPG, PNG, WebP or PDF — max 20MB</p>
      </div>
      <div id="doc-error"></div>
      <div class="actions">
        <button class="btn btn-primary" id="doc-submit" disabled style="flex:1">Continue</button>
      </div>
    `;

    let selectedFile: File | null = null;
    const zone = el.querySelector('#doc-zone') as HTMLElement;
    const fileInput = el.querySelector('#doc-file') as HTMLInputElement;
    const submitBtn = el.querySelector('#doc-submit') as HTMLButtonElement;
    const errorDiv = el.querySelector('#doc-error') as HTMLElement;

    el.querySelectorAll('.type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedType = (btn as HTMLElement).dataset['type']!;
      });
    });

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) { selectedFile = file; submitBtn.disabled = false; zone.querySelector('p')!.textContent = file.name; }
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) { selectedFile = file; submitBtn.disabled = false; zone.querySelector('p')!.textContent = file.name; }
    });

    submitBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      errorDiv.innerHTML = '';
      try {
        await this.ctx.client.uploadDocument(selectedFile, selectedType, selectedSide);
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    });
  }

  private renderSelfie(): void {
    const el = this.ctx.container;
    let capturedFile: File | null = null;
    let stream: MediaStream | null = null;

    el.innerHTML += `
      <h2>Take a Selfie</h2>
      <p>Position your face in the frame and take a clear photo.</p>
      <video id="camera" class="camera-preview" autoplay muted playsinline style="margin-top:16px;display:none"></video>
      <canvas id="snapshot" style="display:none;border-radius:10px;width:100%"></canvas>
      <div class="upload-zone" id="selfie-fallback">
        <input type="file" id="selfie-file" accept="image/*" capture="user">
        <p>Click to open camera or upload photo</p>
      </div>
      <div id="selfie-error"></div>
      <div class="actions">
        <button class="btn btn-secondary" id="retake-btn" style="display:none">Retake</button>
        <button class="btn btn-primary" id="selfie-submit" style="flex:1">Use Camera</button>
      </div>
    `;

    const video = el.querySelector('#camera') as HTMLVideoElement;
    const canvas = el.querySelector('#snapshot') as HTMLCanvasElement;
    const fallback = el.querySelector('#selfie-fallback') as HTMLElement;
    const fileInput = el.querySelector('#selfie-file') as HTMLInputElement;
    const submitBtn = el.querySelector('#selfie-submit') as HTMLButtonElement;
    const retakeBtn = el.querySelector('#retake-btn') as HTMLButtonElement;
    const errorDiv = el.querySelector('#selfie-error') as HTMLElement;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = stream;
        video.style.display = 'block';
        fallback.style.display = 'none';
        submitBtn.textContent = 'Capture';
      } catch {
        fallback.style.display = 'block';
      }
    };

    startCamera();

    fallback.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        capturedFile = file;
        submitBtn.textContent = 'Submit Selfie';
        fallback.querySelector('p')!.textContent = file.name;
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (video.style.display !== 'none' && !capturedFile) {
        // Capture frame
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        canvas.style.display = 'block';
        video.style.display = 'none';
        retakeBtn.style.display = 'inline-flex';
        stream?.getTracks().forEach((t) => t.stop());

        canvas.toBlob((blob) => {
          if (blob) capturedFile = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        }, 'image/jpeg', 0.92);

        submitBtn.textContent = 'Submit Selfie';
        return;
      }

      if (!capturedFile) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await this.ctx.client.uploadSelfie(capturedFile);
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Selfie';
      }
    });

    retakeBtn.addEventListener('click', () => {
      capturedFile = null;
      canvas.style.display = 'none';
      retakeBtn.style.display = 'none';
      startCamera();
    });
  }

  private renderAddress(): void {
    const el = this.ctx.container;
    const types = ['UTILITY_BILL', 'BANK_STATEMENT', 'GOVERNMENT_LETTER'];
    let selectedType = 'UTILITY_BILL';
    let selectedFile: File | null = null;

    el.innerHTML += `
      <h2>Proof of Address</h2>
      <p>Upload a recent document (within 90 days) showing your name and address.</p>
      <div class="select-row">
        ${types.map((t) => `<button class="type-btn${t === selectedType ? ' selected' : ''}" data-type="${t}">${t.replace('_', ' ')}</button>`).join('')}
      </div>
      <div class="upload-zone" id="addr-zone">
        <input type="file" id="addr-file" accept="image/*,.pdf">
        <p>Click to upload document</p>
        <p style="font-size:12px;margin-top:4px">JPG, PNG, WebP or PDF — max 20MB</p>
      </div>
      <div id="addr-error"></div>
      <div class="actions">
        <button class="btn btn-primary" id="addr-submit" disabled style="flex:1">Submit</button>
      </div>
    `;

    const zone = el.querySelector('#addr-zone') as HTMLElement;
    const fileInput = el.querySelector('#addr-file') as HTMLInputElement;
    const submitBtn = el.querySelector('#addr-submit') as HTMLButtonElement;
    const errorDiv = el.querySelector('#addr-error') as HTMLElement;

    el.querySelectorAll('.type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedType = (btn as HTMLElement).dataset['type']!;
      });
    });

    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) { selectedFile = file; submitBtn.disabled = false; zone.querySelector('p')!.textContent = file.name; }
    });

    submitBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading…';
      try {
        await this.ctx.client.uploadAddress(selectedFile, selectedType);
        this.advance();
      } catch (err) {
        errorDiv.innerHTML = `<div class="error-banner">${(err as Error).message}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    });
  }

  private async renderResult(): Promise<void> {
    const el = this.ctx.container;
    el.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px">
        <div class="spinner"></div>
        <p style="margin-top:20px">Verifying your documents…</p>
        <p style="font-size:12px;margin-top:6px">This usually takes 10-30 seconds</p>
      </div>
    `;

    // Poll for result
    const POLL_INTERVAL = 3000;
    const TIMEOUT = 120_000;
    const deadline = Date.now() + TIMEOUT;
    const TERMINAL = ['approved', 'rejected', 'manual_review', 'expired'];

    const poll = async () => {
      try {
        const status = await this.ctx.client.getStatus();
        if (TERMINAL.includes(status.state)) {
          this.showFinalResult(status.state, status.risk_score?.score);
          return;
        }
        if (Date.now() < deadline) {
          setTimeout(poll, POLL_INTERVAL);
        } else {
          this.showFinalResult('expired');
        }
      } catch (err) {
        el.innerHTML = `<div class="error-banner" style="margin:24px">${(err as Error).message}</div>`;
      }
    };

    setTimeout(poll, POLL_INTERVAL);
  }

  private showFinalResult(state: string, score?: number): void {
    const el = this.ctx.container;
    const icons = { approved: '✅', rejected: '❌', manual_review: '⏳', expired: '⚠️' };
    const titles = {
      approved: 'Verification Approved',
      rejected: 'Verification Failed',
      manual_review: 'Under Review',
      expired: 'Session Expired',
    };
    const messages = {
      approved: 'Your identity has been successfully verified.',
      rejected: 'We were unable to verify your identity. Please contact support.',
      manual_review: 'Your documents are being reviewed by our team. We will notify you shortly.',
      expired: 'This session has expired. Please start a new verification.',
    };

    el.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px">
        <div style="font-size:48px;margin-bottom:16px">${icons[state as keyof typeof icons] ?? '❓'}</div>
        <h2>${titles[state as keyof typeof titles] ?? 'Unknown'}</h2>
        <p style="margin-top:8px">${messages[state as keyof typeof messages] ?? ''}</p>
        ${score !== undefined ? `<p style="margin-top:12px;font-size:12px;color:var(--kyc-text-muted)">Confidence score: ${Math.round(score * 100)}%</p>` : ''}
      </div>
    `;

    this.ctx.onComplete(state);
  }
}
