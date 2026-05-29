import { api } from '../api/client.js';

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

    body.innerHTML = `
      <div class="detail-grid" style="margin-bottom:20px">
        ${detail('Session ID', `<code style="font-size:12px">${s.id}</code>`)}
        ${detail('Merchant', s.merchant_id)}
        ${detail('State', `<span class="badge badge-${s.state}">${s.state.replace('_',' ')}</span>`)}
        ${detail('Created', new Date(s.created_at * 1000).toLocaleString())}
        ${detail('Expires', new Date(s.expires_at * 1000).toLocaleString())}
        ${s.metadata ? detail('Metadata', `<pre style="font-size:11px;white-space:pre-wrap">${JSON.stringify(s.metadata, null, 2)}</pre>`) : ''}
      </div>

      ${s.risk_score ? riskScoreHTML(s.risk_score) : ''}

      ${s.document_check ? checkSection('📄 Document Check', [
        detail('Status', statusBadge(s.document_check.status)),
        detail('Type', s.document_check.document_type),
        detail('Confidence', pct(s.document_check.confidence)),
        s.document_check.parsed?.fullName ? detail('Name', s.document_check.parsed.fullName) : '',
        s.document_check.parsed?.dateOfBirth ? detail('Date of Birth', s.document_check.parsed.dateOfBirth) : '',
        s.document_check.parsed?.documentNumber ? detail('Doc Number', s.document_check.parsed.documentNumber) : '',
        s.document_check.parsed?.expiryDate ? detail('Expiry', s.document_check.parsed.expiryDate + (s.document_check.parsed.isExpired ? ' ⚠️ EXPIRED' : '')) : '',
        s.document_check.parsed?.nationality ? detail('Nationality', s.document_check.parsed.nationality) : '',
        detail('MRZ Detected', s.document_check.parsed?.mrzDetected ? '✅ Yes' : '❌ No'),
      ]) : ''}

      ${s.selfie_check ? checkSection('🤳 Liveness Check', [
        detail('Status', statusBadge(s.selfie_check.status)),
        detail('Face Detected', s.selfie_check.face_detected ? '✅ Yes' : '❌ No'),
        detail('Liveness Score', scoreBar(s.selfie_check.liveness_score)),
        detail('Face Match Score', scoreBar(s.selfie_check.match_score)),
      ]) : ''}

      ${s.address_check ? checkSection('🏠 Address Check', [
        detail('Status', statusBadge(s.address_check.status)),
        detail('Document Type', s.address_check.document_type),
        detail('Confidence', pct(s.address_check.confidence)),
        detail('Name Match', scoreBar(s.address_check.name_match_score)),
        s.address_check.parsed?.fullName ? detail('Name on Doc', s.address_check.parsed.fullName) : '',
        s.address_check.parsed?.addressLine1 ? detail('Address', [s.address_check.parsed.addressLine1, s.address_check.parsed.addressLine2, s.address_check.parsed.city, s.address_check.parsed.postcode].filter(Boolean).join(', ')) : '',
        s.address_check.parsed?.issueDate ? detail('Issue Date', s.address_check.parsed.issueDate + (s.address_check.parsed.isStale ? ' ⚠️ STALE' : '')) : '',
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
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">${e?.error?.message}</div>`;
      }
    });

    document.getElementById('reject-btn')?.addEventListener('click', async () => {
      if (!confirm('Manually reject this session?')) return;
      try {
        await api.post(`/v1/admin/sessions/${sessionId}/reject`);
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">Session rejected.</div>`;
      } catch (e: any) {
        document.getElementById('override-msg')!.innerHTML = `<div class="alert alert-error" style="margin-top:12px">${e?.error?.message}</div>`;
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

function statusBadge(s: string) {
  const map: Record<string, string> = { DONE: '✅ Done', FAILED: '❌ Failed', PROCESSING: '🔄 Processing', PENDING: '⏳ Pending' };
  return map[s] ?? s;
}
