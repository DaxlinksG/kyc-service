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
