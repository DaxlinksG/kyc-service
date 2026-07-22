import { api } from '../api/client.js';
import { esc, fmtDateTime, pct, scoreBar, stateLabel } from '../util.js';
import { icons } from '../icons.js';

/**
 * Slide-in, read-only detail for a single session. Merchants can inspect the outcome
 * and per-check breakdown but cannot approve/reject — manual overrides stay with the
 * platform operator (a compliance decision), so no action buttons are rendered here.
 */
export async function openSessionDrawer(sessionId: string): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>Session detail</h2>
        <div class="sub">${esc(sessionId)}</div>
      </div>
      <button class="icon-btn" id="drawer-close" aria-label="Close">${icons.close}</button>
    </div>
    <div class="drawer-body" id="drawer-body"><div class="loader"><div class="spinner"></div></div></div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  requestAnimationFrame(() => { overlay.classList.add('show'); drawer.classList.add('show'); });

  const close = () => {
    overlay.classList.remove('show');
    drawer.classList.remove('show');
    setTimeout(() => { overlay.remove(); drawer.remove(); }, 280);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  drawer.querySelector('#drawer-close')!.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  const body = drawer.querySelector('#drawer-body') as HTMLElement;
  try {
    const s = await api.get(`/v1/sessions/${sessionId}`);
    body.innerHTML = renderDetail(s);
  } catch (e: any) {
    body.innerHTML = `<div class="alert alert-error">${esc(e?.error?.message ?? 'Failed to load session.')}</div>`;
  }
}

function renderDetail(s: any): string {
  const dp = s.document_check?.parsed ?? {};
  const ap = s.address_check?.parsed ?? {};

  return `
    ${decisionBanner(s)}

    <div class="check">
      <div class="check-head">${icons.sessions}<span class="ttl">Session</span></div>
      <div class="check-body">
        ${kv('Reference (external ID)', s.external_id ? esc(s.external_id) : '<span class="muted">—</span>')}
        ${kv('Created', fmtDateTime(s.created_at))}
        ${kv('Last updated', fmtDateTime(s.updated_at))}
        ${kv('Expires', fmtDateTime(s.expires_at))}
        ${s.identity_reused ? kv('Identity reuse', '<span class="tag">Reused — prior approval matched</span>') : ''}
        ${s.metadata ? kv('Metadata', `<code style="font-size:12px">${esc(JSON.stringify(s.metadata))}</code>`, true) : ''}
      </div>
    </div>

    ${s.document_check ? `
      <div class="check">
        <div class="check-head">${icons.document}<span class="ttl">Document</span>${statusChip(s.document_check.status)}</div>
        <div class="check-body">
          ${kv('Type', esc(s.document_check.document_type ?? '—'))}
          ${verificationMethodRow(dp)}
          ${kv('OCR confidence', pct(s.document_check.confidence))}
          ${dp.fullName ? kv('Name', esc(dp.fullName)) : ''}
          ${dp.dateOfBirth ? kv('Date of birth', esc(dp.dateOfBirth)) : ''}
          ${dp.documentNumber ? kv('Document number', esc(dp.documentNumber)) : ''}
          ${dp.expiryDate ? kv('Expiry', esc(dp.expiryDate) + (dp.isExpired ? ' <span class="tag" style="color:var(--danger)">expired</span>' : '')) : ''}
          ${dp.issuingCountry ? kv('Issuing country', esc(dp.issuingCountry)) : ''}
          ${dp.province ? kv('Province / State', esc(dp.province)) : ''}
          ${dp.nationality ? kv('Nationality', esc(dp.nationality)) : ''}
        </div>
      </div>
    ` : ''}

    ${s.selfie_check ? `
      <div class="check">
        <div class="check-head">${icons.face}<span class="ttl">Liveness &amp; face match</span>${statusChip(s.selfie_check.status)}</div>
        <div class="check-body">
          ${kv('Face detected', s.selfie_check.face_detected ? 'Yes' : 'No')}
          ${kv('Liveness score', scoreBar(s.selfie_check.liveness_score), true)}
          ${kv('Face match score', scoreBar(s.selfie_check.match_score), true)}
        </div>
      </div>
    ` : ''}

    ${s.address_check ? `
      <div class="check">
        <div class="check-head">${icons.home}<span class="ttl">Address</span>${statusChip(s.address_check.status)}</div>
        <div class="check-body">
          ${kv('Type', esc(s.address_check.document_type ?? '—'))}
          ${kv('OCR confidence', pct(s.address_check.confidence))}
          ${kv('Name match', scoreBar(s.address_check.name_match_score), true)}
          ${ap.fullName ? kv('Name on document', esc(ap.fullName)) : ''}
          ${ap.addressLine1 ? kv('Address', esc([ap.addressLine1, ap.addressLine2, ap.city, ap.postcode].filter(Boolean).join(', '))) : ''}
          ${ap.issueDate ? kv('Issue date', esc(ap.issueDate) + (ap.isStale ? ' <span class="tag" style="color:var(--warning)">stale</span>' : '')) : ''}
        </div>
      </div>
    ` : ''}

    ${s.pep_check ? `
      <div class="check">
        <div class="check-head">${icons.shield}<span class="ttl">PEP &amp; sanctions screening</span>${statusChip(s.pep_check.status)}</div>
        <div class="check-body">
          ${kv('Result', pepResult(s.pep_check.result))}
          ${s.pep_check.matched_name ? kv('Matched name', esc(s.pep_check.matched_name)) : ''}
          ${s.pep_check.matched_list ? kv('Matched list', esc(s.pep_check.matched_list)) : ''}
        </div>
      </div>
    ` : ''}
  `;
}

function decisionBanner(s: any): string {
  const decision = s.risk_score?.decision as string | undefined;
  const map: Record<string, { cls: string; ic: string; title: string; sub: string }> = {
    approved: { cls: 'db-approved', ic: '✓', title: 'Approved', sub: 'All checks passed — the user is verified.' },
    rejected: { cls: 'db-rejected', ic: '✕', title: 'Rejected', sub: 'One or more checks failed.' },
    manual_review: { cls: 'db-manual_review', ic: '◷', title: 'Manual review', sub: 'Borderline result — awaiting an operator decision.' },
  };
  const d = decision ? map[decision] : undefined;
  if (d) {
    const conf = s.risk_score?.score != null ? ` · Confidence ${pct(s.risk_score.score)}` : '';
    return `<div class="decision-banner ${d.cls}"><div class="db-ic">${d.ic}</div><div><div class="db-title">${d.title}</div><div class="db-sub">${esc(d.sub)}${conf}</div></div></div>`;
  }
  return `<div class="decision-banner db-pending"><div class="db-ic">●</div><div><div class="db-title">${esc(stateLabel(s.state))}</div><div class="db-sub">Verification in progress — no final decision yet.</div></div></div>`;
}

function verificationMethodRow(dp: any): string {
  let v: string;
  if (dp?.barcodeVerified) v = '<span class="tag" style="color:var(--success)">🔒 Barcode (verified)</span>';
  else if (dp?.mrzDetected) v = '<span class="tag" style="color:var(--info)">MRZ</span>';
  else v = '<span class="tag">OCR</span>';
  return kv('Verification method', v);
}

function pepResult(result: string | null): string {
  if (result === 'clear') return '<span class="tag" style="color:var(--success)">Clear</span>';
  if (result === 'pep_hit') return '<span class="tag" style="color:var(--warning)">PEP match</span>';
  if (result === 'sanctions_hit') return '<span class="tag" style="color:var(--danger)">Sanctions match</span>';
  return '<span class="muted">—</span>';
}

function statusChip(status: string): string {
  const label: Record<string, string> = { DONE: 'Done', FAILED: 'Failed', PROCESSING: 'Processing', PENDING: 'Pending' };
  return `<span class="status-chip status-${esc(status)}">${esc(label[status] ?? status)}</span>`;
}

function kv(k: string, v: string, wide = false): string {
  return `<div class="kv"><span class="k">${esc(k)}</span><span class="v ${wide ? 'wide' : ''}">${v}</span></div>`;
}
