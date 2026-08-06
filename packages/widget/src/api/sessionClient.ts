// Per-request timeouts (ms). No call should hang indefinitely — a stalled fetch
// otherwise freezes the widget on the "Verifying…" / spinner screens.
const SHORT_TIMEOUT_MS = 15_000;    // status polls, session creation
const COMPLETE_TIMEOUT_MS = 30_000; // liveness /complete (backend hits AWS)
const UPLOAD_TIMEOUT_MS = 120_000;  // file uploads — generous for slow mobile
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SessionStatus {
  id: string;
  state: string;
  document_check?: { id: string; status: string };
  selfie_check?: { id: string; status: string };
  address_check?: { id: string; status: string };
  risk_score?: { score: number; decision: string };
}

export interface LivenessSessionData {
  face_liveness_session_id: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
}

export class SessionClient {
  constructor(
    private readonly sessionToken: string,
    private readonly apiBaseUrl: string,
  ) {}

  private get sessionId(): string {
    // Decode session ID from JWT sub claim (no signature verification — server validates)
    try {
      // JWT payloads are base64url-encoded; atob only accepts standard base64, so
      // translate the URL-safe alphabet (-/_) and restore padding before decoding.
      const b64url = this.sessionToken.split('.')[1]!;
      const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
      const payload = JSON.parse(atob(b64));
      return payload.sub as string;
    } catch {
      throw new Error('Invalid session token');
    }
  }

  async uploadDocument(file: File, documentType: string, side: string, barcodeRaw?: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    form.append('side', side);
    // AAMVA PDF417 barcode decoded client-side from a North American DL/ID back.
    if (barcodeRaw) form.append('barcode_raw', barcodeRaw);
    // Generous timeout: large images on slow mobile connections.
    await this.request(`/v1/sessions/${this.sessionId}/documents`, { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
  }

  async uploadSelfie(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await this.request(`/v1/sessions/${this.sessionId}/selfie`, { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
  }

  async uploadAddress(file: File, documentType: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    await this.request(`/v1/sessions/${this.sessionId}/address`, { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS);
  }

  async getStatus(): Promise<SessionStatus> {
    return this.request<SessionStatus>(`/v1/sessions/${this.sessionId}/status`, {}, SHORT_TIMEOUT_MS);
  }

  /** Creates an AWS Face Liveness session, returns credentials scoped to StartFaceLivenessSession only. */
  async createFaceLivenessSession(): Promise<LivenessSessionData> {
    return this.request<LivenessSessionData>(
      `/v1/sessions/${this.sessionId}/face-liveness`,
      { method: 'POST' },
      SHORT_TIMEOUT_MS,
    );
  }

  /** Notifies the server that the liveness session is complete — triggers PROCESS_SELFIE job. */
  async completeFaceLivenessSession(faceLivenessSessionId: string): Promise<void> {
    await this.request(
      `/v1/sessions/face-liveness/${faceLivenessSessionId}/complete`,
      { method: 'POST' },
      COMPLETE_TIMEOUT_MS,
    );
  }

  private async request<T = void>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    // Abort a stalled request instead of hanging forever — otherwise a slow
    // /complete call leaves the widget frozen on the "Verifying…" screen.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await globalThis.fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.sessionToken}`,
        },
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new Error('The request timed out. Please check your connection and try again.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;

    const json = await response.json();
    if (!response.ok) {
      const msg = (json as any)?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(msg);
    }
    return json as T;
  }
}
