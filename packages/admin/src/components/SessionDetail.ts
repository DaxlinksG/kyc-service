import { api } from '../api/client.js';
import { esc } from '../util.js';

export async function renderSessionDetail(sessionId: string) {
  // Overlay modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Session Detail</h2>
        <button class="close-btn" id="close-modal">✕</button>
      </div>
      <div id="modal-body"><div class="loader"><div class="spinner"></div></div></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('close-modal')!.addEventListener('click', () => overlay.remove());

  const body = document.getElementById('modal-body')!;

  try {
    const s = await api.get(`/v1/admin/sessions/${sessionId}`);
    const canOverride = ['manual_review', 'processing'].includes(s.state);

    // The admin detail endpoint spreads the raw DB rows, so the parsed OCR/barcode
    // object lives under `ocr_parsed` (not `parsed`). Read the correct key.
    const dp = s.document_check?.ocr_parsed ?? {};
    const ap = s.address_check?.ocr_parsed ?? {};

    body.innerHTML = `
      <div class="detail-grid" style="margin-bottom:20px">
        ${detail('Session ID', `<code style="font-size:12px">${esc(s.id)}</code>`)}
        ${detail('Merchant', esc(s.merchant_id))}
        ${detail('State', `<span class="badge badge-${esc(s.state)}">${esc(String(s.state).replace('_',' '))}</span>`)}
        ${detail('Created', new Date(s.created_at * 1000).toLocaleString())}
        ${detail('Expires', new Date(s.expires_at * 1000).toLocaleString())}
        ${s.metadata ? detail('Metadata', `<pre style="font-size:11px;white-space:pre-wrap">${esc(JSON.stringify(s.metadata, null, 2))}</pre>`) : ''}
      </div>

      ${s.risk_score ? riskScoreHTML(s.risk_score) : ''}

      ${s.document_check ? checkSection('📄 Document Check', [
        detail('Status', statusBadge(s.document_check.status)),
        detail('Type', esc(s.document_check.document_type)),
        s.document_check.side ? detail('Side', esc(s.document_check.side)) : '',
        detail('Verification Method', verificationMethod(dp)),
        detail('Confidence', pct(s.document_check.confidence)),
        dp.fullName ? detail('Name', esc(dp.fullName)) : '',
        dp.dateOfBirth ? detail('Date of Birth', esc(dp.dateOfBirth)) : '',
        dp.documentNumber ? detail('Doc Number', esc(dp.documentNumber)) : '',
        dp.expiryDate ? detail('Expiry', esc(dp.expiryDate) + (dp.isExpired ? ' ⚠️ EXPIRED' : '')) : '',
        dp.issuingCountry ? detail('Issuing Country', esc(dp.issuingCountry)) : '',
        dp.province ? detail('Province / State', esc(dp.province)) : '',
        dp.nationality ? detail('Nationality', esc(dp.nationality)) : '',
      ]) : ''}

      ${s.selfie_check ? checkSection('🤳 Liveness Check', [
        detail('Status', statusBadge(s.selfie_check.status)),
        detail('Face Detected', s.selfie_check.face_detected ? '✅ Yes' : '❌ No'),
        detail('Liveness Score', scoreBar(s.selfie_check.liveness_score)),
        detail('Face Match Score', scoreBar(s.selfie_check.match_score)),
      ]) : ''}

      ${s.address_check ? checkSection('🏠 Address Check', [
        detail('Status', statusBadge(s.address_check.status)),
        detail('Document Type', esc(s.address_check.document_type)),
        detail('Confidence', pct(s.address_check.confidence)),
        detail('Name Match', scoreBar(s.address_check.name_match_score)),
        ap.fullName ? detail('Name on Doc', esc(ap.fullName)) : '',
        ap.addressLine1 ? detail('Address', esc([ap.addressLine1, ap.addressLine2, ap.city, ap.postcode].filter(Boolean).join(', '))) : '',
        ap.issueDate ? detail('Issue Date', esc(ap.issueDate) + (ap.isStale ? ' ⚠️ STALE' : '')) : '',
      ]) : ''}

      ${canOverride ? `
        <div style="display:flex;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <button class="btn btn-success" id="approve-btn" style="flex:1;justify-content:center">✅ Approve</button>
          <button class="btn btn-danger" id="reject-btn" style="flex:1;justify-content:center">❌ Reject</button>
        </div>
        <div id="override-msg"></div>
      ` : ''}
    `;

    document.getElementById('approve-btn')?.addEventListener('click', async () => {
      if (!confirm('Manually approve this session?')) return;
      try {
        await api.post(`/v1/admin/sessions/${sessionId}/approve`);
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-success" style="margin-top:12px">Session approved successfully.</div>`;
      } catch (e: any) {
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">${esc(e?.error?.message ?? 'Request failed')}</div>`;
      }
    });

    document.getElementById('reject-btn')?.addEventListener('click', async () => {
      if (!confirm('Manually reject this session?')) return;
      try {
        await api.post(`/v1/admin/sessions/${sessionId}/reject`);
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">Session rejected.</div>`;
      } catch (e: any) {
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">${esc(e?.error?.message ?? 'Request failed')}</div>`;
      }
    });

  } catch {
    body.innerHTML = `<div class="alert alert-error">Failed to load session details.</div>`;
  }
}

function riskScoreHTML(r: any) {
  const pctVal = Math.round(r.score * 100);
  const color = r.decision === 'approved' ? '#166534' : r.decision === 'rejected' ? '#991b1b' : '#854d0e';
  return `
    <div class="card" style="margin-bottom:20px;border-color:${color}20;background:${color}08">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <strong>Risk Score</strong>
        <span class="badge badge-${r.decision}">${r.decision.replace('_',' ')}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:28px;font-weight:700;color:${color}">${pctVal}%</div>
        <div style="flex:1"><div class="score-bar" style="height:8px"><div class="score-fill" style="width:${pctVal}%;background:${color}"></div></div></div>
      </div>
      ${r.factors.hardFails.length ? `<div style="margin-top:10px;font-size:12px;color:var(--danger)">⚠️ Hard fails: ${r.factors.hardFails.join(', ')}</div>` : ''}
    </div>
  `;
}

function checkSection(title: string, items: string[]) {
  return `
    <div style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:10px">${title}</div>
      <div class="detail-grid">${items.filter(Boolean).join('')}</div>
    </div>
  `;
}

function detail(label: string, value: string) {
  return `<div class="detail-item"><label>${label}</label><p>${value}</p></div>`;
}

function pct(v: number | null) {
  return v != null ? `${Math.round(v * 100)}%` : '—';
}

function scoreBar(v: number | null) {
  if (v == null) return '—';
  const p = Math.round(v * 100);
  const color = p >= 70 ? 'var(--success)' : p >= 40 ? 'var(--warning)' : 'var(--danger)';
  return `<span>${p}%</span><div class="score-bar" style="margin-top:4px"><div class="score-fill" style="width:${p}%;background:${color}"></div></div>`;
}

/**
 * How the document's identity data was obtained, in trust order:
 * a server-verified AAMVA barcode is the strongest (green badge), then MRZ, then
 * plain OCR. This replaces the old "MRZ Detected: No" line, which was misleading for
 * barcode-verified North American cards (they legitimately have no MRZ).
 */
function verificationMethod(parsed: any): string {
  if (parsed?.barcodeVerified) return '<span class="badge badge-approved">🔒 Barcode (verified)</span>';
  if (parsed?.mrzDetected) return '<span class="badge badge-processing">✅ MRZ</span>';
  return '<span class="badge badge-created">OCR</span>';
}

function statusBadge(s: string) {
  const map: Record<string, string> = { DONE: '✅ Done', FAILED: '❌ Failed', PROCESSING: '🔄 Processing', PENDING: '⏳ Pending' };
  return map[s] ?? s;
}
