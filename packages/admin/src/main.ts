import './styles/global.css';
import { api } from './api/client.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';

async function boot() {
  const stored = localStorage.getItem('kyc_admin_key');
  if (stored) {
    api.setKey(stored);
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
