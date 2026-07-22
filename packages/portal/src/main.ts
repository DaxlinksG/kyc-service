import './styles/global.css';
import { api } from './api/client.js';
import { renderApp } from './app.js';
import { renderLogin } from './pages/login.js';
import { STORE_KEY, STORE_BASE } from './pages/login.js';

async function boot() {
  const key = localStorage.getItem(STORE_KEY);
  if (key) {
    api.setKey(key);
    const base = localStorage.getItem(STORE_BASE);
    if (base) api.setBase(base);
    try {
      await api.get('/v1/metrics');
      renderApp();
      return;
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  }
  renderLogin();
}

boot();
