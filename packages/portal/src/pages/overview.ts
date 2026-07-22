import { api } from '../api/client.js';
import { esc } from '../util.js';
import type { Route } from '../app.js';
import { sessionsTableHTML, attachRowHandlers } from '../components/sessionsTable.js';

export async function renderOverview(page: HTMLElement, go: (r: Route) => void): Promise<void> {
  const m = await api.get('/v1/metrics');
  const ratePct = Math.round((m.approval_rate ?? 0) * 100);

  // Ring geometry (r=46 → circumference ≈ 289).
  const C = 2 * Math.PI * 46;
  const offset = C * (1 - ratePct / 100);

  page.innerHTML = `
    <div class="metrics">
      ${metric('Total sessions', m.total_sessions, '🗂️', 'tone-accent')}
      ${metric('Today', m.sessions_today, '📅', 'tone-info')}
      ${metric('Approved', m.approved, '✓', 'tone-success')}
      ${metric('Rejected', m.rejected, '✕', 'tone-danger')}
      ${metric('Manual review', m.manual_review, '◷', 'tone-warning')}
      ${metric('In progress', m.in_progress + m.processing, '↻', 'tone-muted')}
    </div>

    <div class="card card-pad section-gap ring-card">
      <div class="ring" style="--p:${ratePct}">
        <svg width="108" height="108" viewBox="0 0 108 108">
          <circle class="ring-track" cx="54" cy="54" r="46"></circle>
          <circle class="ring-fill" cx="54" cy="54" r="46"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="ring-center"><div class="v">${ratePct}%</div><div class="l">Approval</div></div>
      </div>
      <div class="ring-legend">
        <div style="font-weight:700;font-size:14px;margin-bottom:2px">Approval rate</div>
        <div class="muted" style="font-size:12.5px;margin-bottom:6px">Share of completed verifications that were approved.</div>
        <div class="legend-row"><span class="legend-dot" style="background:var(--success)"></span> Approved <b>${esc(m.approved)}</b></div>
        <div class="legend-row"><span class="legend-dot" style="background:var(--danger)"></span> Rejected <b>${esc(m.rejected)}</b></div>
        <div class="legend-row"><span class="legend-dot" style="background:var(--warning)"></span> Manual review <b>${esc(m.manual_review)}</b></div>
      </div>
    </div>

    <div class="section-gap">
      <div class="section-head">
        <div><h2>Recent sessions</h2></div>
        <button class="btn btn-ghost btn-sm" id="view-all">View all</button>
      </div>
      <div class="table-card" id="recent"><div class="loader"><div class="spinner"></div></div></div>
    </div>
  `;

  document.getElementById('view-all')!.addEventListener('click', () => go('sessions'));

  const { data } = await api.get('/v1/sessions', { limit: 8, page: 1 });
  const recent = document.getElementById('recent')!;
  recent.innerHTML = sessionsTableHTML(data);
  attachRowHandlers(recent);
}

function metric(label: string, value: number, icon: string, tone: string): string {
  return `
    <div class="metric">
      <div class="metric-top">
        <span class="metric-label">${esc(label)}</span>
        <span class="metric-ic ${tone}">${icon}</span>
      </div>
      <div class="metric-value">${Number(value ?? 0).toLocaleString()}</div>
    </div>
  `;
}
