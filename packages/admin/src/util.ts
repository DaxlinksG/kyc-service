/**
 * HTML-escape an untrusted value before interpolating it into an innerHTML
 * template. The admin runs with the master API key in memory, so any script that
 * executes in this page can exfiltrate it — every value that originates from the
 * API (merchant metadata, OCR'd document text, job/error messages, operator-entered
 * names) MUST pass through here. Escaping quotes as well makes it safe in both text
 * (`<p>${esc(v)}</p>`) and attribute (`data-id="${esc(v)}"`) contexts.
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
