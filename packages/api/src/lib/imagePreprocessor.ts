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
 * Crop the bottom 35% of a document image and apply heavy contrast/threshold
 * for MRZ detection. The larger crop handles full-spread passport photos where
 * the data page starts at ~50% of the image height. The threshold step converts
 * the security-pattern background to pure white so Tesseract only sees the dark
 * MRZ characters.
 */
export async function cropMrzZone(input: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(input).metadata();
  const mrzHeight = Math.floor(height * 0.35);
  const top = height - mrzHeight;
  return sharp(input)
    .extract({ left: 0, top, width, height: mrzHeight })
    .grayscale()
    .normalize()
    // Linear stretch: push mid-tones toward white to kill the security pattern,
    // keep dark MRZ ink. threshold(160) means pixels below 160 → black, rest → white.
    .threshold(160)
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
