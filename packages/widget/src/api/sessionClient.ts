export interface SessionStatus {
  id: string;
  state: string;
  document_check?: { id: string; status: string };
  selfie_check?: { id: string; status: string };
  address_check?: { id: string; status: string };
  risk_score?: { score: number; decision: string };
}

export class SessionClient {
  constructor(
    private readonly sessionToken: string,
    private readonly apiBaseUrl: string,
  ) {}

  private get sessionId(): string {
    // Decode session ID from JWT sub claim (no signature verification — server validates)
    try {
      const payload = JSON.parse(atob(this.sessionToken.split('.')[1]!));
      return payload.sub as string;
    } catch {
      throw new Error('Invalid session token');
    }
  }

  async uploadDocument(file: File, documentType: string, side: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    form.append('side', side);
    await this.fetch(`/v1/sessions/${this.sessionId}/documents`, { method: 'POST', body: form });
  }

  async uploadSelfie(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    await this.fetch(`/v1/sessions/${this.sessionId}/selfie`, { method: 'POST', body: form });
  }

  async uploadAddress(file: File, documentType: string): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('document_type', documentType);
    await this.fetch(`/v1/sessions/${this.sessionId}/address`, { method: 'POST', body: form });
  }

  async getStatus(): Promise<SessionStatus> {
    return this.fetch<SessionStatus>(`/v1/sessions/${this.sessionId}/status`);
  }

  async createFaceLivenessSession(sessionId: string): Promise<{
    face_liveness_session_id: string;
    region: string;
    access_key_id: string;
    secret_access_key: string;
  }> {
    return this.fetch(`/v1/sessions/${sessionId}/face-liveness`, { method: 'POST' });
  }

  getSessionId(): string { return this.sessionId; }
  getSessionToken(): string { return this.sessionToken; }
  getApiBase(): string { return this.apiBaseUrl; }

  private async fetch<T = void>(path: string, init: RequestInit = {}): Promise<T> {
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
