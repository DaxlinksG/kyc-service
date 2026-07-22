class ApiClient {
  private key = '';
  private base = '';

  setKey(key: string) { this.key = key; }
  setBase(base: string) { this.base = base; }

  async get<T = any>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.base}${path}`, location.origin);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.key}` } });
    if (!r.ok) throw await parseError(r);
    return r.json();
  }

  async post<T = any>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw await parseError(r);
    return r.json();
  }
}

/**
 * Normalise an error response into the `{ error: { message } }` shape callers expect.
 * A non-JSON body (nginx 502/504 HTML, gateway timeouts, network stubs) would otherwise
 * make `r.json()` throw a cryptic SyntaxError, hiding the real HTTP status from the operator.
 */
async function parseError(r: Response): Promise<{ error: { message: string } }> {
  try {
    const body = await r.json();
    if (body?.error?.message) return body;
    return { error: { message: body?.message ?? `${r.status} ${r.statusText || 'Request failed'}` } };
  } catch {
    return { error: { message: `${r.status} ${r.statusText || 'Request failed'}` } };
  }
}

export const api = new ApiClient();
