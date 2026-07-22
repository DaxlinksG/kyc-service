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
    await this.request(`/v1/sessions/${this.sessionId}/documents`, { method: 'POST', body: form });
  }

  async uploadSelfie(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await this.request(`/v1/sessions/${this.sessionId}/selfie`, { method: 'POST', body: form });
  }

  async uploadAddress(file: File, documentType: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    await this.request(`/v1/sessions/${this.sessionId}/address`, { method: 'POST', body: form });
  }

  async getStatus(): Promise<SessionStatus> {
    return this.request<SessionStatus>(`/v1/sessions/${this.sessionId}/status`);
  }

  /** Creates an AWS Face Liveness session, returns credentials scoped to StartFaceLivenessSession only. */
  async createFaceLivenessSession(): Promise<LivenessSessionData> {
    return this.request<LivenessSessionData>(
      `/v1/sessions/${this.sessionId}/face-liveness`,
      { method: 'POST' },
    );
  }

  /** Notifies the server that the liveness session is complete — triggers PROCESS_SELFIE job. */
  async completeFaceLivenessSession(faceLivenessSessionId: string): Promise<void> {
    await this.request(
      `/v1/sessions/face-liveness/${faceLivenessSessionId}/complete`,
      { method: 'POST' },
    );
  }

  private async request<T = void>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await globalThis.fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.sessionToken}`,
      },
    });

    if (response.status === 204) return undefined as T;

    const json = await response.json();
    if (!response.ok) {
      const msg = (json as any)?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(msg);
    }
    return json as T;
  }
}
