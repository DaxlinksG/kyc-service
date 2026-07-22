import { esc, timeAgo, pct, stateLabel } from '../util.js';
import { openSessionDrawer } from './sessionDrawer.js';

/** Render the shared sessions table body (used by Overview and the Sessions page). */
export function sessionsTableHTML(rows: any[]): string {
  if (!rows.length) {
    return `<div class="empty"><div class="ic">🗂️</div><div class="t">No sessions yet</div><div class="s">Verifications will appear here once your users start onboarding.</div></div>`;
  }
  return `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Session</th><th>Reference</th><th>State</th>
          <th>Document</th><th>Liveness</th><th>Face Match</th><th>Created</th>
        </tr></thead>
        <tbody>
          ${rows.map((s) => `
            <tr data-id="${esc(s.id)}">
              <td><span class="cell-id">${esc(s.id)}</span></td>
              <td>${s.external_id ? esc(s.external_id) : '<span class="muted">—</span>'}</td>
              <td><span class="pill pill-${esc(s.state)}">${esc(stateLabel(s.state))}</span></td>
              <td>${pct(s.doc_confidence)}</td>
              <td>${pct(s.liveness_score)}</td>
              <td>${pct(s.match_score)}</td>
              <td class="muted">${timeAgo(s.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/** Wire up row clicks within a container to open the detail drawer. */
export function attachRowHandlers(container: HTMLElement): void {
  container.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.addEventListener('click', () => openSessionDrawer((tr as HTMLElement).dataset['id']!));
  });
}
