import { api, errMessage } from '../api/client.js';
import { esc, timeAgo, toast, copyToClipboard } from '../util.js';
import { icons } from '../icons.js';

const EVENTS = [
  { id: 'session.approved', label: 'Approved' },
  { id: 'session.rejected', label: 'Rejected' },
  { id: 'session.manual_review', label: 'Manual review' },
];

export async function renderWebhooks(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="section-head">
      <div><h2>Webhook endpoints</h2><p>Receive a signed POST when a verification completes.</p></div>
      <button class="btn btn-primary btn-sm" id="add-webhook">${icons.plus}<span>Add endpoint</span></button>
    </div>
    <div id="webhook-list"><div class="loader"><div class="spinner"></div></div></div>
  `;
  document.getElementById('add-webhook')!.addEventListener('click', showCreateModal);
  await load();
}

async function load(): Promise<void> {
  const list = document.getElementById('webhook-list');
  if (!list) return;
  const { data } = await api.get('/v1/webhooks');

  if (!data.length) {
    list.innerHTML = `<div class="table-card"><div class="empty"><div class="ic">🔔</div><div class="t">No webhooks yet</div><div class="s">Add an endpoint to get notified the moment a session is approved or rejected.</div></div></div>`;
    return;
  }

  list.innerHTML = `<div class="stack">${data.map(webhookCard).join('')}</div>`;

  list.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
    const id = (b as HTMLElement).dataset['test']!;
    (b as HTMLButtonElement).disabled = true;
    try { await api.post(`/v1/webhooks/${id}/test`); toast('Test event sent', 'success'); }
    catch (e: any) { toast(errMessage(e), 'error'); }
    finally { (b as HTMLButtonElement).disabled = false; }
  }));

  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = (b as HTMLElement).dataset['del']!;
    if (!confirm('Delete this webhook endpoint? You will stop receiving events immediately.')) return;
    try { await api.del(`/v1/webhooks/${id}`); toast('Endpoint deleted', 'success'); load(); }
    catch (e: any) { toast(errMessage(e), 'error'); }
  }));
}

function webhookCard(w: any): string {
  const events = (w.events as string[]).map((e) => `<span class="tag">${esc(e.replace('session.', ''))}</span>`).join(' ');
  return `
    <div class="list-card">
      <div class="grow">
        <div class="lc-title">${w.active ? '<span class="pill pill-approved">active</span>' : '<span class="pill pill-expired">inactive</span>'}</div>
        <div class="lc-url">${esc(w.url)}</div>
        <div class="lc-meta"><span>${events}</span><span>Added ${esc(timeAgo(w.created_at))}</span></div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" data-test="${esc(w.id)}">${icons.send}<span>Test</span></button>
        <button class="btn btn-danger-ghost btn-sm" data-del="${esc(w.id)}" aria-label="Delete">${icons.trash}</button>
      </div>
    </div>
  `;
}

function showCreateModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>Add webhook endpoint</h2><button class="icon-btn" id="m-close" aria-label="Close">${icons.close}</button></div>
      <div class="modal-body">
        <div id="m-body">
          <div class="field">
            <label for="w-url">Endpoint URL</label>
            <input id="w-url" type="text" placeholder="https://your-app.com/webhooks/kyc" spellcheck="false" />
            <div class="hint">Must be an HTTPS URL that accepts POST requests.</div>
          </div>
          <div class="field">
            <label>Events</label>
            <div class="stack" style="gap:8px;margin-top:4px">
              ${EVENTS.map((e) => `
                <label class="checkbox-row"><input type="checkbox" value="${esc(e.id)}" checked /> <span>${esc(e.label)} <code style="font-size:11.5px;color:var(--muted)">${esc(e.id)}</code></span></label>
              `).join('')}
            </div>
          </div>
          <div id="m-error"></div>
          <button class="btn btn-primary btn-block" id="w-submit">Create endpoint</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#m-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('w-submit')!.addEventListener('click', async () => {
    const url = (document.getElementById('w-url') as HTMLInputElement).value.trim();
    const events = Array.from(overlay.querySelectorAll('input[type=checkbox]:checked')).map((c) => (c as HTMLInputElement).value);
    const errBox = document.getElementById('m-error')!;
    errBox.innerHTML = '';
    if (!url) { errBox.innerHTML = `<div class="alert alert-error">Enter an endpoint URL.</div>`; return; }
    if (!events.length) { errBox.innerHTML = `<div class="alert alert-error">Select at least one event.</div>`; return; }

    const btn = document.getElementById('w-submit') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const res = await api.post('/v1/webhooks', { url, events });
      showSecret(overlay, res);
    } catch (e: any) {
      errBox.innerHTML = `<div class="alert alert-error">${esc(errMessage(e))}</div>`;
      btn.disabled = false; btn.textContent = 'Create endpoint';
    }
  });
}

function showSecret(overlay: HTMLElement, res: any): void {
  const body = overlay.querySelector('#m-body')!;
  body.innerHTML = `
    <div class="alert alert-success">Endpoint created. Save the signing secret now — it is shown only once.</div>
    <div class="field">
      <label>Signing secret</label>
      <div class="secret-box"><span class="key" id="secret-val">${esc(res.signing_secret)}</span><button class="icon-btn" id="copy-secret" style="color:#e5e9f0" aria-label="Copy">${icons.copy}</button></div>
      <div class="hint">Use this to verify the <code>X-KYC-Signature</code> header on incoming requests.</div>
    </div>
    <button class="btn btn-primary btn-block" id="secret-done">Done</button>
  `;
  overlay.querySelector('#copy-secret')!.addEventListener('click', () => copyToClipboard(res.signing_secret, 'Signing secret copied'));
  overlay.querySelector('#secret-done')!.addEventListener('click', () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    renderWebhooks(document.getElementById('page')!);
  });
}
