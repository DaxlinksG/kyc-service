import { readFileSync } from 'fs';
import { createRequire } from 'module';
import sharp from 'sharp';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

/**
 * Server-side re-decode of the PDF417 barcode from a stored back-of-card image.
 *
 * The widget decodes the AAMVA barcode client-side and sends us the raw string.
 * Re-decoding the barcode from the image the server actually received lets us
 * confirm that string wasn't fabricated or swapped by a tampered/hostile client —
 * i.e. the identity we trust is the one physically encoded in the uploaded card,
 * not whatever the browser claimed. The server-decoded value is authoritative.
 *
 * The WASM binary is the one shipped inside the zxing-wasm package (self-hosted,
 * no network fetch): we read it off disk and hand it to Emscripten as `wasmBinary`.
 * Plain Node has no fetch/fs loader branch in the emscripten glue, so `wasmBinary`
 * is the reliable way to instantiate it.
 */

let prepared = false;
function ensurePrepared(): void {
  if (prepared) return;
  prepared = true;
  const require = createRequire(import.meta.url);
  const file = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  // Hand emscripten a standalone ArrayBuffer of exactly the wasm bytes.
  const wasmBinary = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  prepareZXingModule({ overrides: { wasmBinary } });
}

/**
 * Decode a single PDF417 barcode from an encoded image buffer (JPEG/PNG — zxing
 * decodes the image itself). Returns the raw decoded string, or null if no valid
 * PDF417 is present.
 */
export async function decodePdf417FromImage(imageBuffer: Buffer): Promise<string | null> {
  ensurePrepared();

  // Cap the working resolution before handing the image to the WASM decoder. A
  // hostile client could upload a huge image to make `tryHarder` decoding burn CPU;
  // downscaling oversized images bounds that cost. Only resize when needed so normal
  // card photos are decoded at full fidelity. PDF417 stays readable well under 2000px.
  let decodeBuffer: Buffer = imageBuffer;
  try {
    const meta = await sharp(imageBuffer).metadata();
    if ((meta.width ?? 0) > 2000 || (meta.height ?? 0) > 2000) {
      decodeBuffer = await sharp(imageBuffer)
        .resize({ width: 2000, height: 2000, fit: 'inside' })
        .png()
        .toBuffer();
    }
  } catch {
    decodeBuffer = imageBuffer;
  }

  const results = await readBarcodes(new Uint8Array(decodeBuffer), {
    formats: ['PDF417'],
    tryHarder: true,
  });
  for (const r of results) {
    if (r.isValid && r.format === 'PDF417' && r.text) return r.text;
  }
  return null;
}
