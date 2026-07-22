import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

/**
 * Client-side AAMVA PDF417 scanning for North American driver's licenses and
 * provincial/state ID cards. The barcode on the back of the card holds structured,
 * machine-readable identity data; we decode it in the browser and send the raw
 * string to the API (which owns parsing). The WASM binary is self-hosted alongside
 * the widget — no third-party CDN dependency.
 */

let initialized = false;

/** Point zxing-wasm at our self-hosted WASM binary. Idempotent. */
export function initBarcodeScanner(apiBaseUrl: string): void {
  if (initialized) return;
  initialized = true;
  const base = apiBaseUrl.replace(/\/$/, '');
  prepareZXingModule({
    overrides: {
      // zxing types locateFile as (path) => url. Serve the .wasm from our own origin.
      locateFile: (path: string) =>
        path.endsWith('.wasm') ? `${base}/widget/${path}` : path,
    },
  });
}

/**
 * Attempt to decode a single PDF417 barcode from a video frame.
 * Returns the raw decoded string (control characters preserved) or null.
 */
export async function scanPdf417(imageData: ImageData): Promise<string | null> {
  const results = await readBarcodes(imageData, { formats: ['PDF417'], tryHarder: true });
  for (const r of results) {
    if (r.isValid && r.format === 'PDF417' && r.text) return r.text;
  }
  return null;
}
