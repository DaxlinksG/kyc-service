import { api } from '../api/client.js';

export async function renderMerchantsPage(container: HTMLElement) {
  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
      <button class="btn btn-primary" id="add-merchant-btn">+ Add Merchant</button>
    </div>
    <div class="table-wrap" id="merchants-table">
      <div class="loader"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('add-merchant-btn')!.addEventListener('click', () => showAddMerchantModal());
  loadMerchants();
}

async function loadMerchants() {
  const el = document.getElementById('merchants-table')!;
  const { data } = await api.get('/v1/admin/merchants');

  if (!data.length) {
    el.innerHTML = `<div class="empty"><div class="icon">🏢</div><p>No merchants yet</p></div>`;
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Merchant ID</th><th>Name</th><th>Active Keys</th><th>Total Sessions</th><th>Created</th><th></th>
      </tr></thead>
      <tbody>
        ${data.map((m: any) => `
          <tr>
            <td><code style="font-size:12px">${m.id}</code></td>
            <td>${m.name}</td>
            <td>${m.active_keys}</td>
            <td>${m.total_sessions}</td>
            <td>${new Date(m.created_at * 1000).toLocaleDateString()}</td>
            <td>
              <button class="btn btn-outline btn-sm create-key-btn" data-merchant="${m.id}">+ API Key</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.querySelectorAll('.create-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => showCreateKeyModal((btn as HTMLElement).dataset['merchant']!));
  });
}

function showAddMerchantModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h2>Add Merchant</h2>
        <button class="close-btn" id="close-m">✕</button>
      </div>
      <div class="form-group"><label>Merchant ID</label><input id="m-id" placeholder="e.g. acme_fintech" /></div>
      <div class="form-group"><label>Name</label><input id="m-name" placeholder="Acme Fintech" /></div>
      <div id="m-error"></div>
      <div id="m-success"></div>
      <button class="btn btn-primary" id="m-submit" style="width:100%;justify-content:center">Create Merchant</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#close-m')!.addEventListener('click', () => { overlay.remove(); loadMerchants(); });

  document.getElementById('m-submit')!.addEventListener('click', async () => {
    const id = (document.getElementById('m-id') as HTMLInputElement).value.trim();
    const name = (document.getElementById('m-name') as HTMLInputElement).value.trim();
    if (!id || !name) return;
    try {
      await api.post('/v1/admin/merchants', { id, name });
      document.getElementById('m-success')!.innerHTML = `<div class="alert alert-success">Merchant created!</div>`;
    } catch (e: any) {
      document.getElementById('m-error')!.innerHTML = `<div class="alert alert-error">${e?.error?.message}</div>`;
    }
  });
}

function showCreateKeyModal(merchantId: string) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <div class="modal-header">
        <h2>Create API Key</h2>
        <button class="close-btn" id="close-k">✕</button>
      </div>
      <p style="color:var(--muted);margin-bottom:16px">Creating key for merchant: <strong>${merchantId}</strong></p>
      <div class="form-group"><label>Key Name (optional)</label><input id="k-name" placeholder="Production key" /></div>
      <div id="k-error"></div>
      <div id="k-result"></div>
      <button class="btn btn-primary" id="k-submit" style="width:100%;justify-content:center">Generate API Key</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#close-k')!.addEventListener('click', () => overlay.remove());

  document.getElementById('k-submit')!.addEventListener('click', async () => {
    const name = (document.getElementById('k-name') as HTMLInputElement).value.trim();
    try {
      const result = await api.post('/v1/api-keys', { merchant_id: merchantId, name: name || undefined });
      document.getElementById('k-result')!.innerHTML = `
        <div class="alert alert-success" style="margin-bottom:12px">
          <strong>✅ API Key created — save it now, it won't be shown again!</strong>
        </div>
        <div style="background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:12px;word-break:break-all;font-family:monospace;font-size:13px;user-select:all">
          ${result.api_key}
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:8px">Click the key above to select all, then copy it.</p>
      `;
      document.getElementById('k-submit')!.style.display = 'none';
    } catch (e: any) {
      document.getElementById('k-error')!.innerHTML = `<div class="alert alert-error">${e?.error?.message}</div>`;
    }
  });
}
