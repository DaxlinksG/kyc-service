import { api } from './api/client.js';
import { esc } from './util.js';
import { icons } from './icons.js';
import { STORE_KEY, STORE_BASE, renderLogin } from './pages/login.js';
import { renderOverview } from './pages/overview.js';
import { renderSessions } from './pages/sessions.js';
import { renderWebhooks } from './pages/webhooks.js';
import { renderLinks } from './pages/links.js';

export type Route = 'overview' | 'sessions' | 'webhooks' | 'links';

interface Me { merchant_id: string; name: string | null; pep_screening_enabled: boolean; }

const NAV: { route: Route; label: string; icon: keyof typeof icons; title: string; subtitle: string }[] = [
  { route: 'overview', label: 'Overview', icon: 'overview', title: 'Overview', subtitle: 'Your verification activity at a glance' },
  { route: 'sessions', label: 'Sessions', icon: 'sessions', title: 'Sessions', subtitle: 'Every KYC verification for your account' },
  { route: 'webhooks', label: 'Webhooks', icon: 'webhooks', title: 'Webhooks', subtitle: 'Receive real-time verification results' },
  { route: 'links', label: 'Verification Links', icon: 'links', title: 'Verification Links', subtitle: 'No-code shareable KYC links' },
];

let me: Me | null = null;
let current: Route = 'overview';

/** Entry point once authenticated. Fetches identity, then paints the shell. */
export async function renderApp(route: Route = 'overview') {
  current = route;
  try {
    me = await api.get<Me>('/v1/me');
  } catch {
    // Key no longer valid — bounce to login.
    localStorage.removeItem(STORE_KEY);
    renderLogin();
    return;
  }
  paintShell();
  loadRoute(current);
}

function paintShell() {
  const nav = NAV.find((n) => n.route === current)!;
  const merchantName = me?.name || me?.merchant_id || 'Merchant';
  const initial = merchantName.trim().charAt(0).toUpperCase() || 'M';

  document.getElementById('app')!.innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">🛡️</div>
          <div>
            <div class="brand-name">KYC Portal</div>
            <div class="brand-sub">Verification dashboard</div>
          </div>
        </div>
        <nav class="nav">
          ${NAV.map((n) => `
            <a class="nav-item ${n.route === current ? 'active' : ''}" data-route="${n.route}">
              ${icons[n.icon]}<span>${esc(n.label)}</span>
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-foot">
          <div class="merchant-chip">
            <div class="merchant-avatar">${esc(initial)}</div>
            <div class="merchant-meta">
              <div class="merchant-name">${esc(merchantName)}</div>
              <div class="merchant-role">${esc(me?.merchant_id ?? '')}</div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:12px">
            <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Menu">${icons.menu}</button>
            <div class="topbar-titles">
              <h1 id="page-title">${esc(nav.title)}</h1>
              <p id="page-subtitle">${esc(nav.subtitle)}</p>
            </div>
          </div>
          <div class="topbar-actions">
            <button class="btn btn-ghost btn-sm" id="signout-btn">${icons.logout}<span>Sign out</span></button>
          </div>
        </div>
        <div class="page" id="page"></div>
      </div>
    </div>
  `;

  document.querySelectorAll('.nav-item[data-route]').forEach((el) => {
    el.addEventListener('click', () => {
      const route = (el as HTMLElement).dataset['route'] as Route;
      if (route === current) return;
      current = route;
      paintShell();
      loadRoute(route);
    });
  });

  document.getElementById('signout-btn')!.addEventListener('click', () => {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_BASE);
    location.reload();
  });

  const sidebar = document.getElementById('sidebar')!;
  document.getElementById('menu-toggle')?.addEventListener('click', () => sidebar.classList.toggle('open'));
}

async function loadRoute(route: Route) {
  const page = document.getElementById('page')!;
  page.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
  try {
    if (route === 'overview') await renderOverview(page, (r) => navigate(r));
    else if (route === 'sessions') await renderSessions(page);
    else if (route === 'webhooks') await renderWebhooks(page);
    else if (route === 'links') await renderLinks(page);
  } catch (e: any) {
    page.innerHTML = `<div class="alert alert-error">${esc(e?.error?.message ?? 'Failed to load this page.')}</div>`;
  }
}

/** Programmatic navigation used by in-page buttons (e.g. "View all sessions"). */
export function navigate(route: Route) {
  if (route === current) return;
  current = route;
  paintShell();
  loadRoute(route);
}

export function pepEnabled(): boolean {
  return !!me?.pep_screening_enabled;
}
