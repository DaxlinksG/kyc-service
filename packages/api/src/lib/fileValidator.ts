import sharp from 'sharp';
import { MAGIC_BYTES, MAX_FILE_SIZE_BYTES, MIN_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION } from '../config/constants.js';
import { FileValidationError } from '../types/errors.js';

export async function validateImageFile(buffer: Buffer, declaredMime?: string): Promise<void> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new FileValidationError(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`);
  }

  const detectedType = detectMimeType(buffer);
  if (!detectedType) {
    throw new FileValidationError('Unrecognized file type. Only JPEG, PNG, WebP, and PDF are allowed.');
  }

  // PDFs are not image-processable by sharp — skip dimension check
  if (detectedType === 'application/pdf') return;

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new FileValidationError('Could not parse image file. File may be corrupt.');
  }

  const { width = 0, height = 0 } = metadata;

  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new FileValidationError(
      `Image too small (${width}x${height}). Minimum ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}px required.`,
    );
  }

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new FileValidationError(
      `Image too large (${width}x${height}). Maximum ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}px allowed.`,
    );
  }
}

function detectMimeType(buffer: Buffer): string | null {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        // Extra check for WebP: bytes 8-11 must be 'WEBP'
        if (mime === 'image/webp') {
          const riff = buffer.slice(8, 12).toString('ascii');
          if (riff !== 'WEBP') continue;
        }
        return mime;
      }
    }
  }
  return null;
}

export function sanitizeFilename(ext: string): string {
  // Only allow safe extensions; always generate a new UUID-based name
  const safe = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
  const normalized = ext.toLowerCase().replace(/^\./, '');
  return safe.includes(normalized) ? normalized : 'bin';
}
