class ApiClient {
  private key = '';
  private base = '';

  setKey(key: string) { this.key = key; }
  setBase(base: string) { this.base = base; }

  async get<T = any>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.base}${path}`, location.origin);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.key}` } });
    if (!r.ok) throw await r.json();
    return r.json();
  }

  async post<T = any>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw await r.json();
    return r.json();
  }
}

export const api = new ApiClient();
