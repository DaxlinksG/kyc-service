import { api } from '../api/client.js';
import { sessionsTableHTML, attachSessionRowListeners } from '../pages/dashboard.js';

let currentPage = 1;
let currentState = '';
let currentMerchant = '';

export async function renderSessionsPage(container: HTMLElement) {
  container.innerHTML = `
    <div class="filters">
      <input id="filter-merchant" type="text" placeholder="Filter by merchant ID..." style="max-width:200px">
      <select id="filter-state">
        <option value="">All states</option>
        <option value="created">Created</option>
        <option value="document_submitted">Document Submitted</option>
        <option value="selfie_submitted">Selfie Submitted</option>
        <option value="address_submitted">Address Submitted</option>
        <option value="processing">Processing</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="manual_review">Manual Review</option>
        <option value="expired">Expired</option>
      </select>
      <button class="btn btn-outline btn-sm" id="filter-apply">Apply</button>
    </div>
    <div class="table-wrap" id="sessions-table">
      <div class="loader"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('filter-apply')!.addEventListener('click', () => {
    currentPage = 1;
    currentMerchant = (document.getElementById('filter-merchant') as HTMLInputElement).value.trim();
    currentState = (document.getElementById('filter-state') as HTMLSelectElement).value;
    loadSessions();
  });

  loadSessions();
}

async function loadSessions() {
  const tableEl = document.getElementById('sessions-table')!;
  tableEl.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  const params: Record<string, string | number> = { page: currentPage, limit: 20 };
  if (currentState) params['state'] = currentState;
  if (currentMerchant) params['merchant_id'] = currentMerchant;

  const { data, pagination } = await api.get('/v1/admin/sessions', params);

  tableEl.innerHTML = sessionsTableHTML(data) + paginationHTML(pagination);
  attachSessionRowListeners();

  document.getElementById('prev-page')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadSessions(); }
  });
  document.getElementById('next-page')?.addEventListener('click', () => {
    if (currentPage < pagination.pages) { currentPage++; loadSessions(); }
  });
}

function paginationHTML(p: any) {
  return `
    <div class="pagination">
      <span>Page ${p.page} of ${p.pages} (${p.total} total)</span>
      <button class="btn btn-outline btn-sm" id="prev-page" ${p.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <button class="btn btn-outline btn-sm" id="next-page" ${p.page >= p.pages ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}
