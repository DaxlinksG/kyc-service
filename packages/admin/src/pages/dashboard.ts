import { api } from '../api/client.js';
import { renderSessionsPage } from '../components/SessionsTable.js';
import { renderMerchantsPage } from '../components/MerchantsTable.js';
import { renderSessionDetail } from '../components/SessionDetail.js';

type Page = 'overview' | 'sessions' | 'merchants' | 'jobs';
let currentPage: Page = 'overview';

export function renderDashboard(page: Page = 'overview') {
  currentPage = page;

  document.getElementById('app')!.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo"><span>🔐</span> KYC Admin</div>
        <nav class="sidebar-nav">
          <div class="nav-item ${page === 'overview' ? 'active' : ''}" data-page="overview"><span class="icon">📊</span> Overview</div>
          <div class="nav-item ${page === 'sessions' ? 'active' : ''}" data-page="sessions"><span class="icon">🗂️</span> Sessions</div>
          <div class="nav-item ${page === 'merchants' ? 'active' : ''}" data-page="merchants"><span class="icon">🏢</span> Merchants</div>
          <div class="nav-item ${page === 'jobs' ? 'active' : ''}" data-page="jobs"><span class="icon">⚙️</span> Job Queue</div>
        </nav>
        <div class="sidebar-footer">KYC Service v1.0</div>
      </aside>
      <div class="main">
        <div class="topbar">
          <h1 id="page-title">${pageTitles[page]}</h1>
          <button class="btn btn-outline btn-sm" id="logout-btn">Sign out</button>
        </div>
        <div class="page" id="page-content">
          <div class="loader"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  `;

  // Navigation
  document.querySelectorAll('.nav-item[data-page]').forEach((el) => {
    el.addEventListener('click', () => {
      renderDashboard((el as HTMLElement).dataset['page'] as Page);
    });
  });

  document.getElementById('logout-btn')!.addEventListener('click', () => {
    localStorage.removeItem('kyc_admin_key');
    localStorage.removeItem('kyc_admin_base');
    location.reload();
  });

  loadPage(page);
}

const pageTitles: Record<Page, string> = {
  overview: 'Overview',
  sessions: 'Sessions',
  merchants: 'Merchants',
  jobs: 'Job Queue',
};

async function loadPage(page: Page) {
  const content = document.getElementById('page-content')!;
  try {
    if (page === 'overview') await renderOverview(content);
    else if (page === 'sessions') await renderSessionsPage(content);
    else if (page === 'merchants') await renderMerchantsPage(content);
    else if (page === 'jobs') await renderJobsPage(content);
  } catch (err: any) {
    content.innerHTML = `<div class="alert alert-error">${err?.error?.message ?? 'Failed to load page'}</div>`;
  }
}

async function renderOverview(container: HTMLElement) {
  const m = await api.get('/v1/admin/metrics');

  const approvalRate = m.total_sessions > 0
    ? Math.round((m.approved / m.total_sessions) * 100)
    : 0;

  container.innerHTML = `
    <div class="metrics-grid">
      ${metricCard('Total Sessions', m.total_sessions, '🗂️')}
      ${metricCard('Today', m.sessions_today, '📅')}
      ${metricCard('Approved', m.approved, '✅', 'color:#166534')}
      ${metricCard('Rejected', m.rejected, '❌', 'color:#991b1b')}
      ${metricCard('Manual Review', m.manual_review, '⏳', 'color:#854d0e')}
      ${metricCard('Processing', m.processing, '🔄', 'color:#1e40af')}
      ${metricCard('Merchants', m.total_merchants, '🏢')}
      ${metricCard('Pending Jobs', m.pending_jobs, '⚙️')}
    </div>

    <div class="card" style="margin-bottom:24px">
      <div class="card-title">Approval Rate (all time)</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
        <div style="font-size:24px;font-weight:700">${approvalRate}%</div>
        <div style="flex:1">
          <div class="score-bar" style="height:10px">
            <div class="score-fill" style="width:${approvalRate}%;background:${approvalRate >= 70 ? 'var(--success)' : approvalRate >= 40 ? 'var(--warning)' : 'var(--danger)'}"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="table-wrap">
      <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <strong>Recent Sessions</strong>
        <button class="btn btn-outline btn-sm" id="view-all-btn">View All →</button>
      </div>
      <div id="recent-sessions-content"><div class="loader"><div class="spinner"></div></div></div>
    </div>
  `;

  document.getElementById('view-all-btn')!.addEventListener('click', () => renderDashboard('sessions'));

  // Load recent sessions
  const { data } = await api.get('/v1/admin/sessions', { limit: 10, page: 1 });
  const el = document.getElementById('recent-sessions-content')!;
  el.innerHTML = sessionsTableHTML(data, false);
  attachSessionRowListeners();
}

export function sessionsTableHTML(sessions: any[], showPagination = true) {
  if (!sessions.length) return `<div class="empty"><div class="icon">🗂️</div><p>No sessions found</p></div>`;
  return `
    <table>
      <thead><tr>
        <th>Session ID</th><th>Merchant</th><th>State</th>
        <th>Doc Confidence</th><th>Face Match</th><th>Created</th><th></th>
      </tr></thead>
      <tbody>
        ${sessions.map((s: any) => `
          <tr>
            <td><code style="font-size:11px">${s.id}</code></td>
            <td>${s.merchant_id}</td>
            <td><span class="badge badge-${s.state}">${s.state.replace('_', ' ')}</span></td>
            <td>${s.doc_confidence != null ? `${Math.round(s.doc_confidence * 100)}%` : '—'}</td>
            <td>${s.match_score != null ? `${Math.round(s.match_score * 100)}%` : '—'}</td>
            <td>${timeAgo(s.created_at)}</td>
            <td><button class="btn btn-outline btn-sm view-session-btn" data-id="${s.id}">View</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function attachSessionRowListeners() {
  document.querySelectorAll('.view-session-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderSessionDetail((btn as HTMLElement).dataset['id']!);
    });
  });
}

function metricCard(title: string, value: number, icon: string, style = '') {
  return `
    <div class="card">
      <div class="card-title">${icon} ${title}</div>
      <div class="card-value" style="${style}">${value.toLocaleString()}</div>
    </div>
  `;
}

async function renderJobsPage(container: HTMLElement) {
  const data = await api.get('/v1/admin/jobs');
  container.innerHTML = `
    <div class="metrics-grid" style="margin-bottom:24px">
      ${(data.by_status as any[]).map((s: any) =>
        metricCard(s.status, s.n, s.status === 'DONE' ? '✅' : s.status === 'FAILED' ? '❌' : '🔄')
      ).join('')}
    </div>
    <div class="table-wrap">
      <div style="padding:16px;border-bottom:1px solid var(--border)"><strong>Recent Jobs</strong></div>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Attempts</th><th>Error</th><th>Created</th></tr></thead>
        <tbody>
          ${(data.recent as any[]).map((j: any) => `
            <tr>
              <td><code style="font-size:11px">${j.id}</code></td>
              <td>${j.job_type}</td>
              <td><span class="badge badge-${j.status.toLowerCase()}">${j.status}</span></td>
              <td>${j.attempts}/${j.max_attempts}</td>
              <td style="color:var(--danger);font-size:12px">${j.error ?? '—'}</td>
              <td>${timeAgo(j.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function timeAgo(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixTs * 1000).toLocaleDateString();
}
