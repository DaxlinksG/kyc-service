import { api, errMessage } from '../api/client.js';
import { esc, timeAgo, toast, copyToClipboard } from '../util.js';
import { icons } from '../icons.js';

export async function renderLinks(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="section-head">
      <div><h2>Verification links</h2><p>Share a URL that launches KYC — no code required. Perfect for email, WhatsApp, or SMS onboarding.</p></div>
      <button class="btn btn-primary btn-sm" id="add-link">${icons.plus}<span>Create link</span></button>
    </div>
    <div id="link-list"><div class="loader"><div class="spinner"></div></div></div>
  `;
  document.getElementById('add-link')!.addEventListener('click', showCreateModal);
  await load();
}

async function load(): Promise<void> {
  const list = document.getElementById('link-list');
  if (!list) return;
  const { data } = await api.get('/v1/verification-links');

  if (!data.length) {
    list.innerHTML = `<div class="table-card"><div class="empty"><div class="ic">🔗</div><div class="t">No links yet</div><div class="s">Create a shareable link to onboard users without writing any integration code.</div></div></div>`;
    return;
  }

  list.innerHTML = `<div class="stack">${data.map(linkCard).join('')}</div>`;

  list.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    copyToClipboard((b as HTMLElement).dataset['copy']!, 'Link copied');
  }));

  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = (b as HTMLElement).dataset['del']!;
    if (!confirm('Deactivate this link? It will stop creating new sessions. Sessions already created are unaffected.')) return;
    try { await api.del(`/v1/verification-links/${id}`); toast('Link deactivated', 'success'); load(); }
    catch (e: any) { toast(errMessage(e), 'error'); }
  }));
}

function linkCard(l: any): string {
  const tags = [
    l.single_use ? '<span class="tag">single-use</span>' : '',
    `<span class="tag">${l.sessions_created} session${l.sessions_created === 1 ? '' : 's'}</span>`,
  ].filter(Boolean).join(' ');
  return `
    <div class="list-card">
      <div class="grow">
        <div class="lc-title">
          ${l.is_active ? '<span class="pill pill-approved">active</span>' : '<span class="pill pill-expired">inactive</span>'}
          <span style="font-weight:600">${esc(l.name)}</span>
        </div>
        <div class="lc-url">${esc(l.url)}</div>
        <div class="lc-meta"><span>${tags}</span><span>Created ${esc(timeAgo(l.created_at))}</span></div>
      </div>
      <div class="list-actions">
        <button class="btn btn-ghost btn-sm" data-copy="${esc(l.url)}">${icons.copy}<span>Copy</span></button>
        <a class="btn btn-ghost btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${icons.external}<span>Open</span></a>
        ${l.is_active ? `<button class="btn btn-danger-ghost btn-sm" data-del="${esc(l.id)}" aria-label="Deactivate">${icons.trash}</button>` : ''}
      </div>
    </div>
  `;
}

function showCreateModal(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h2>Create verification link</h2><button class="icon-btn" id="m-close" aria-label="Close">${icons.close}</button></div>
      <div class="modal-body">
        <div id="m-body">
          <div class="field">
            <label for="l-name">Name</label>
            <input id="l-name" type="text" placeholder="Customer Onboarding — 2026" spellcheck="false" />
            <div class="hint">Internal label to help you recognise this link.</div>
          </div>
          <div class="field">
            <label for="l-slug">Custom slug <span class="muted">(optional)</span></label>
            <input id="l-slug" type="text" placeholder="acme-onboard" spellcheck="false" />
            <div class="hint">Lowercase letters, numbers, and hyphens only. Auto-generated if left blank.</div>
          </div>
          <div class="field">
            <label for="l-redirect">Redirect URL <span class="muted">(optional)</span></label>
            <input id="l-redirect" type="text" placeholder="https://your-app.com/verified" spellcheck="false" />
            <div class="hint">Where users are sent after they finish verifying.</div>
          </div>
          <div class="field">
            <label class="checkbox-row"><input id="l-single" type="checkbox" /> <span>Single-use — deactivate after the first session is created</span></label>
          </div>
          <div id="m-error"></div>
          <button class="btn btn-primary btn-block" id="l-submit">Create link</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const close = () => { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#m-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('l-submit')!.addEventListener('click', async () => {
    const name = (document.getElementById('l-name') as HTMLInputElement).value.trim();
    const slug = (document.getElementById('l-slug') as HTMLInputElement).value.trim();
    const redirect = (document.getElementById('l-redirect') as HTMLInputElement).value.trim();
    const single_use = (document.getElementById('l-single') as HTMLInputElement).checked;
    const errBox = document.getElementById('m-error')!;
    errBox.innerHTML = '';
    if (!name) { errBox.innerHTML = `<div class="alert alert-error">Enter a name for this link.</div>`; return; }

    const payload: Record<string, unknown> = { name, single_use };
    if (slug) payload['slug'] = slug;
    if (redirect) payload['redirect_url'] = redirect;

    const btn = document.getElementById('l-submit') as HTMLButtonElement;
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const res = await api.post('/v1/verification-links', payload);
      showLink(overlay, res);
    } catch (e: any) {
      errBox.innerHTML = `<div class="alert alert-error">${esc(errMessage(e))}</div>`;
      btn.disabled = false; btn.textContent = 'Create link';
    }
  });
}

function showLink(overlay: HTMLElement, res: any): void {
  const body = overlay.querySelector('#m-body')!;
  body.innerHTML = `
    <div class="alert alert-success">Link created. Share it with your users to start verifying.</div>
    <div class="field">
      <label>Shareable link</label>
      <div class="secret-box"><span class="key" id="link-val">${esc(res.url)}</span><button class="icon-btn" id="copy-link" style="color:#e5e9f0" aria-label="Copy">${icons.copy}</button></div>
      <div class="hint">Anyone with this link can start a verification. Deactivate it any time.</div>
    </div>
    <button class="btn btn-primary btn-block" id="link-done">Done</button>
  `;
  overlay.querySelector('#copy-link')!.addEventListener('click', () => copyToClipboard(res.url, 'Link copied'));
  overlay.querySelector('#link-done')!.addEventListener('click', () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    renderLinks(document.getElementById('page')!);
  });
}
