export type SessionState =
  | 'created'
  | 'document_submitted'
  | 'selfie_submitted'
  | 'address_submitted'
  | 'processing'
  | 'approved'
  | 'rejected'
  | 'manual_review'
  | 'expired';

export type CheckStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface DocumentCheck {
  id: string;
  status: CheckStatus;
  document_type: string;
  side: string;
  parsed?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    nationality?: string;
    isExpired?: boolean;
    mrzDetected?: boolean;
  };
  confidence?: number;
}

export interface SelfieCheck {
  id: string;
  status: CheckStatus;
  face_detected?: boolean;
  liveness_score?: number;
  match_score?: number;
}

export interface AddressCheck {
  id: string;
  status: CheckStatus;
  document_type: string;
  parsed?: {
    fullName?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    postcode?: string;
    issueDate?: string;
    isStale?: boolean;
  };
  name_match_score?: number;
  confidence?: number;
}

export interface RiskScore {
  score: number;
  decision: 'approved' | 'rejected' | 'manual_review';
  factors: {
    documentConfidence: number;
    livenessScore: number;
    matchScore: number;
    addressNameMatch: number;
    hardFails: string[];
  };
}

export interface PepCheck {
  status: 'PENDING' | 'DONE' | 'FAILED';
  /** `clear` = no match · `pep_hit` = politically exposed → manual review · `sanctions_hit` = hard fail → rejected */
  result?: 'clear' | 'pep_hit' | 'sanctions_hit' | null;
  matched_name?: string | null;
  /** `OFAC_SDN` or `UN_CONSOLIDATED` */
  matched_list?: string | null;
  match_score?: number | null;
}

export interface Session {
  id: string;
  state: SessionState;
  created_at: number;
  updated_at: number;
  expires_at: number;
  metadata?: Record<string, unknown>;
  document_check?: DocumentCheck;
  selfie_check?: SelfieCheck;
  address_check?: AddressCheck;
  risk_score?: RiskScore;
  /** Present only if the merchant has PEP/sanctions screening enabled. */
  pep_check?: PepCheck;
}

/** Condensed row returned by `sessions.list()` (not the full detail object). */
export interface SessionListItem {
  id: string;
  external_id?: string | null;
  state: SessionState;
  created_at: number;
  updated_at: number;
  doc_confidence?: number | null;
  liveness_score?: number | null;
  match_score?: number | null;
  name_match_score?: number | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface SessionList {
  data: SessionListItem[];
  pagination: Pagination;
}

export interface Metrics {
  total_sessions: number;
  sessions_today: number;
  approved: number;
  rejected: number;
  manual_review: number;
  processing: number;
  in_progress: number;
  /** approved ÷ (approved + rejected + manual_review), 0–1; 0 when none completed. */
  approval_rate: number;
}

export interface MerchantInfo {
  merchant_id: string;
  name?: string | null;
  pep_screening_enabled: boolean;
  created_at?: number | null;
}

export interface VerificationLink {
  id: string;
  name: string;
  /** The shareable URL to send to users. */
  url: string | null;
  slug: string;
  is_active: boolean;
  single_use: boolean;
  sessions_created: number;
  redirect_url?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: number;
  expires_at?: number | null;
}

export interface CreateSessionResponse {
  session_id: string;
  session_token: string;
  expires_at: number;
  widget_url: string;
}

export interface UploadResponse {
  document_id?: string;
  selfie_id?: string;
  address_id?: string;
  status: 'processing';
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: number;
}

export interface CreateWebhookResponse extends WebhookEndpoint {
  signing_secret: string; // Only returned on creation
}

export interface ApiKey {
  id: string;
  api_key: string; // Only returned on creation
  prefix: string;
  merchant_id: string;
}
