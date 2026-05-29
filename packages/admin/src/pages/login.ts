import { api } from '../api/client.js';
import { renderDashboard } from './dashboard.js';

export function renderLogin() {
  document.getElementById('app')!.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          <div style="font-size:40px">🔐</div>
          <h1>KYC Admin</h1>
          <p>Sign in with your master API key</p>
        </div>
        <div id="login-error"></div>
        <div class="form-group">
          <label>API Base URL</label>
          <input id="base-url" type="text" value="${location.origin}" placeholder="https://your-kyc-api.com" />
        </div>
        <div class="form-group">
          <label>Master API Key</label>
          <input id="api-key" type="password" placeholder="kyc_master_..." />
        </div>
        <button class="btn btn-primary" id="login-btn" style="width:100%;justify-content:center;padding:10px">
          Sign In
        </button>
      </div>
    </div>
  `;

  const keyInput = document.getElementById('api-key') as HTMLInputElement;
  const baseInput = document.getElementById('base-url') as HTMLInputElement;
  const btn = document.getElementById('login-btn') as HTMLButtonElement;
  const errorDiv = document.getElementById('login-error')!;

  const attempt = async () => {
    const key = keyInput.value.trim();
    const base = baseInput.value.trim().replace(/\/$/, '');
    if (!key) return;

    btn.textContent = 'Verifying…';
    btn.disabled = true;
    errorDiv.innerHTML = '';

    try {
      api.setKey(key);
      api.setBase(base === location.origin ? '' : base);
      await api.get('/v1/admin/metrics');
      localStorage.setItem('kyc_admin_key', key);
      if (base !== location.origin) localStorage.setItem('kyc_admin_base', base);
      renderDashboard();
    } catch {
      errorDiv.innerHTML = `<div class="alert alert-error">Invalid API key or unable to reach the server.</div>`;
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', attempt);
  keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
}
