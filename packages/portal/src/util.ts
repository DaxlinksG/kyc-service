/**
 * HTML-escape an untrusted value before interpolating it into an innerHTML template.
 * Every value that originates from the API (session IDs, external IDs, OCR'd document
 * text, webhook URLs, link names/slugs) MUST pass through here. Escaping quotes too makes
 * it safe in both text (`<p>${esc(v)}</p>`) and attribute (`data-id="${esc(v)}"`) contexts.
 */
export function esc(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Relative "time ago" for unix-seconds timestamps, falling back to a date for old values. */
export function timeAgo(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 0) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixTs * 1000).toLocaleDateString();
}

/** Full localized datetime for a unix-seconds timestamp. */
export function fmtDateTime(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Format a 0–1 score as an integer percentage, or an em dash when null/undefined. */
export function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

/** Human label for a session state (snake_case → Title Case). */
export function stateLabel(state: string): string {
  return String(state).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Threshold color for a 0–1 score bar/ring. */
export function scoreColor(p: number): string {
  return p >= 70 ? 'var(--success)' : p >= 40 ? 'var(--warning)' : 'var(--danger)';
}

/** A small colored progress bar for a 0–1 score. Returns '—' when null. */
export function scoreBar(v: number | null | undefined): string {
  if (v == null) return '<span class="muted">—</span>';
  const p = Math.round(v * 100);
  return `
    <div class="scorebar-wrap">
      <div class="scorebar"><div class="scorebar-fill" style="width:${p}%;background:${scoreColor(p)}"></div></div>
      <span class="scorebar-label">${p}%</span>
    </div>`;
}

/** Lightweight toast notifications. */
export function toast(message: string, kind: 'success' | 'error' | 'info' = 'info'): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  const icon = kind === 'success' ? '✓' : kind === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span>${esc(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

/** Copy text to the clipboard, with a toast on success/failure. */
export async function copyToClipboard(text: string, label = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success');
  } catch {
    toast('Could not copy — copy manually', 'error');
  }
}
