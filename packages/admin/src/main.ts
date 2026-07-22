import './styles/global.css';
import { api } from './api/client.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';

async function boot() {
  const stored = localStorage.getItem('kyc_admin_key');
  if (stored) {
    api.setKey(stored);
    // Restore a custom API base URL too, otherwise a reload of an admin pointed at a
    // remote API silently falls back to same-origin and every request 404s/misauths.
    const storedBase = localStorage.getItem('kyc_admin_base');
    if (storedBase) api.setBase(storedBase);
    try {
      await api.get('/v1/admin/metrics');
      renderDashboard();
      return;
    } catch {
      localStorage.removeItem('kyc_admin_key');
    }
  }
  renderLogin();
}

boot();
