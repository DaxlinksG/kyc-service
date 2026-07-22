import { api } from '../api/client.js';
import { esc } from '../util.js';
import { icons } from '../icons.js';
import { sessionsTableHTML, attachRowHandlers } from '../components/sessionsTable.js';

const STATES = ['created', 'document_submitted', 'selfie_submitted', 'address_submitted', 'processing', 'approved', 'rejected', 'manual_review', 'expired'];

let page = 1;
let state = '';
let search = '';

export async function renderSessions(container: HTMLElement): Promise<void> {
  // Reset view state each time the page mounts.
  page = 1; state = ''; search = '';

  container.innerHTML = `
    <div class="filters">
      <div class="search">
        ${icons.search}
        <input id="f-search" type="text" placeholder="Search by session ID or reference…" spellcheck="false" />
      </div>
      <select id="f-state">
        <option value="">All states</option>
        ${STATES.map((s) => `<option value="${esc(s)}">${esc(s.replace(/_/g, ' '))}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="f-refresh">${icons.refresh}<span>Refresh</span></button>
    </div>
    <div class="table-card" id="sessions-table"><div class="loader"><div class="spinner"></div></div></div>
  `;

  const searchInput = document.getElementById('f-search') as HTMLInputElement;
  const stateSelect = document.getElementById('f-state') as HTMLSelectElement;

  let debounce: number | undefined;
  searchInput.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => { search = searchInput.value.trim(); page = 1; load(); }, 280);
  });
  stateSelect.addEventListener('change', () => { state = stateSelect.value; page = 1; load(); });
  document.getElementById('f-refresh')!.addEventListener('click', () => load());

  load();
}

async function load(): Promise<void> {
  const el = document.getElementById('sessions-table');
  if (!el) return; // page navigated away
  el.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;

  const { data, pagination } = await api.get('/v1/sessions', {
    page, limit: 20, state: state || undefined, search: search || undefined,
  });

  el.innerHTML = sessionsTableHTML(data) + paginationHTML(pagination);
  attachRowHandlers(el);

  el.querySelector('#prev')?.addEventListener('click', () => { if (page > 1) { page--; load(); } });
  el.querySelector('#next')?.addEventListener('click', () => { if (page < pagination.pages) { page++; load(); } });
}

function paginationHTML(p: any): string {
  if (!p.total) return '';
  return `
    <div class="pagination">
      <span>Page ${p.page} of ${Math.max(1, p.pages)} · ${p.total.toLocaleString()} total</span>
      <button class="btn btn-ghost btn-sm" id="prev" ${p.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <button class="btn btn-ghost btn-sm" id="next" ${p.page >= p.pages ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}
