import type { SessionState, JobType, WebhookEvent } from '../config/constants.js';

export interface DbMerchant {
  id: string;
  name: string;
  pep_screening_enabled: number; // 0|1
  created_at: number;
}

export interface DbPepCheck {
  id: string;
  session_id: string;
  status: 'PENDING' | 'DONE' | 'FAILED';
  result: 'clear' | 'pep_hit' | 'sanctions_hit' | null;
  matched_entry_id: string | null;
  matched_name: string | null;
  matched_list: string | null;
  match_score: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbApiKey {
  id: string;
  merchant_id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface DbSession {
  id: string;
  merchant_id: string;
  state: SessionState;
  session_token_hash: string;
  metadata: string | null; // JSON
  redirect_url: string | null;
  identity_id: string | null; // set when this session matched a known kyc_identity
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface DbKycIdentity {
  id: string;
  identity_hash: string;
  first_approved_at: number;
  last_approved_at: number;
  expires_at: number;
  source_session_id: string;
}

export interface DbKycIdentitySession {
  id: string;
  identity_id: string;
  session_id: string;
  merchant_id: string;
  linked_at: number;
}

export interface DbDocument {
  id: string;
  session_id: string;
  document_type: string;
  side: string;
  storage_path: string;
  ocr_raw: string | null; // JSON
  ocr_parsed: string | null; // JSON
  face_descriptor: string | null; // JSON float[]
  confidence: number | null;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbSelfieCheck {
  id: string;
  session_id: string;
  storage_path: string;
  face_detected: number | null; // 0|1
  liveness_score: number | null;
  match_score: number | null;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbAddressCheck {
  id: string;
  session_id: string;
  document_type: string;
  storage_path: string;
  ocr_raw: string | null; // JSON
  ocr_parsed: string | null; // JSON
  name_match_score: number | null;
  confidence: number | null;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbJob {
  id: string;
  job_type: JobType;
  payload: string; // JSON
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: number;
  processed_at: number | null;
}

export interface DbWebhookEndpoint {
  id: string;
  merchant_id: string;
  url: string;
  events: string; // JSON string[]
  signing_secret: string;
  active: number; // 0|1
  created_at: number;
}

export interface DbWebhookDelivery {
  id: string;
  endpoint_id: string;
  event: WebhookEvent;
  payload: string; // JSON
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  last_response_status: number | null;
  last_error: string | null;
  next_retry_at: number | null;
  created_at: number;
  delivered_at: number | null;
}
