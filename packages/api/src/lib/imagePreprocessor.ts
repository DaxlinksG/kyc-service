import sharp from 'sharp';

/**
 * Preprocess an image for OCR: grayscale, upscale if too small, sharpen.
 */
export async function preprocessForOcr(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;

  let pipeline = sharp(input).grayscale();

  // Upscale to at least 1200px wide for better OCR accuracy
  if (width > 0 && width < 1200) {
    const scale = Math.ceil(1200 / width);
    pipeline = pipeline.resize({ width: width * scale, kernel: 'lanczos3' });
  }

  return pipeline
    .sharpen({ sigma: 1.5, m1: 0, m2: 3 })
    .normalize()
    .png()
    .toBuffer();
}

/**
 * Preprocess a selfie for face detection: normalize exposure, resize to max 640px.
 */
export async function preprocessForFace(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .normalize()
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Crop the bottom ~15% of a document image for MRZ detection.
 */
export async function cropMrzZone(input: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  const mrzHeight = Math.floor(height * 0.18);
  const top = height - mrzHeight;
  return sharp(input)
    .extract({ left: 0, top, width, height: mrzHeight })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
}

/**
 * Convert a PDF page to a PNG buffer using sharp (requires libvips with poppler).
 * Falls back gracefully if PDF rendering is not available.
 */
export async function pdfToImage(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { density: 300 }).png().toBuffer();
  } catch {
    throw new Error('PDF rendering failed. Please upload an image instead.');
  }
}
