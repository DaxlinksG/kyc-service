export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  'application/pdf',
] as const;

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MIN_IMAGE_DIMENSION = 400;
export const MAX_IMAGE_DIMENSION = 8000;

// Magic bytes for file type detection
export const MAGIC_BYTES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
};

export const SESSION_STATES = [
  'created',
  'document_submitted',
  'selfie_submitted',
  'address_submitted',
  'processing',
  'approved',
  'rejected',
  'manual_review',
  'expired',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export const DOCUMENT_TYPES = [
  'PASSPORT',
  'NATIONAL_ID',
  'DRIVING_LICENSE',
] as const;

export const DOCUMENT_SIDES = ['FRONT', 'BACK'] as const;

export const ADDRESS_DOCUMENT_TYPES = [
  'UTILITY_BILL',
  'BANK_STATEMENT',
  'GOVERNMENT_LETTER',
] as const;

export const JOB_TYPES = [
  'PROCESS_DOCUMENT',
  'PROCESS_SELFIE',
  'PROCESS_ADDRESS',
  'SCORE_SESSION',
  'DELIVER_WEBHOOK',
  'SCREEN_PEP',
  'SYNC_PEP_LISTS',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export const WEBHOOK_EVENTS = [
  'session.created',
  'session.document_submitted',
  'session.selfie_submitted',
  'session.address_submitted',
  'session.approved',
  'session.rejected',
  'session.manual_review',
  'session.expired',
  'ping',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
