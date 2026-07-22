/**
 * Minimal API client for the merchant portal. Authenticates with a merchant API key
 * (`kyc_live_...`) sent as a Bearer token. The key lives only in this browser's
 * localStorage and memory; every request is scoped server-side to the key's merchant.
 */
class ApiClient {
  private key = '';
  private base = '';

  setKey(key: string) { this.key = key; }
  setBase(base: string) { this.base = base; }

  async get<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.base}${path}`, location.origin);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
      }
    }
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

  async del<T = any>(path: string): Promise<T | null> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.key}` },
    });
    if (!r.ok) throw await parseError(r);
    // 204 No Content has no body to parse.
    if (r.status === 204) return null;
    return r.json();
  }
}

/**
 * Normalise an error response into the `{ error: { message } }` shape callers expect.
 * A non-JSON body (nginx 502/504 HTML, gateway timeouts) would otherwise make `r.json()`
 * throw a cryptic SyntaxError, hiding the real HTTP status from the user.
 */
async function parseError(r: Response): Promise<{ error: { message: string; code?: string } }> {
  try {
    const body = await r.json();
    if (body?.error?.message) return body;
    return { error: { message: body?.message ?? `${r.status} ${r.statusText || 'Request failed'}` } };
  } catch {
    return { error: { message: `${r.status} ${r.statusText || 'Request failed'}` } };
  }
}

/** Pull a human message out of whatever an API call rejected with. */
export function errMessage(e: any, fallback = 'Request failed'): string {
  return e?.error?.message ?? e?.message ?? fallback;
}

export const api = new ApiClient();
