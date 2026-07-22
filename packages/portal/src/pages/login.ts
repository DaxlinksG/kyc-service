import { api, errMessage } from '../api/client.js';
import { renderApp } from '../app.js';
import { esc } from '../util.js';

/** Storage keys — kept distinct from the admin app's (`kyc_admin_*`). */
export const STORE_KEY = 'kyc_portal_key';
export const STORE_BASE = 'kyc_portal_base';

export function renderLogin() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-brand">
          <div class="mark">🛡️</div>
          <h1>KYC Portal</h1>
          <p>Sign in with your API key to view verifications</p>
        </div>
        <div id="login-error"></div>
        <div class="field">
          <label for="base-url">API Base URL</label>
          <input id="base-url" type="text" value="${esc(location.origin)}" placeholder="https://kyc.zeehfi.ca" spellcheck="false" autocapitalize="off" />
        </div>
        <div class="field">
          <label for="api-key">API Key</label>
          <input id="api-key" type="password" placeholder="kyc_live_..." spellcheck="false" autocomplete="off" />
          <div class="hint">Your live merchant key. It is stored only in this browser and never sent anywhere except your API.</div>
        </div>
        <button class="btn btn-primary btn-block" id="login-btn">Sign in</button>
        <div class="login-foot">Need a key? Contact your KYC provider.</div>
      </div>
    </div>
  `;

  const keyInput = document.getElementById('api-key') as HTMLInputElement;
  const baseInput = document.getElementById('base-url') as HTMLInputElement;
  const btn = document.getElementById('login-btn') as HTMLButtonElement;
  const errorBox = document.getElementById('login-error')!;

  const attempt = async () => {
    const key = keyInput.value.trim();
    const base = baseInput.value.trim().replace(/\/$/, '');
    if (!key) { keyInput.focus(); return; }

    btn.textContent = 'Verifying…';
    btn.disabled = true;
    errorBox.innerHTML = '';

    const resolvedBase = base === location.origin ? '' : base;
    api.setKey(key);
    api.setBase(resolvedBase);

    try {
      await api.get('/v1/metrics');
      localStorage.setItem(STORE_KEY, key);
      if (resolvedBase) localStorage.setItem(STORE_BASE, resolvedBase);
      else localStorage.removeItem(STORE_BASE);
      renderApp();
    } catch (e: any) {
      errorBox.innerHTML = `<div class="alert alert-error">${esc(errMessage(e, 'Invalid API key or unable to reach the server.'))}</div>`;
      btn.textContent = 'Sign in';
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', attempt);
  keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  baseInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') keyInput.focus(); });
  keyInput.focus();
}
