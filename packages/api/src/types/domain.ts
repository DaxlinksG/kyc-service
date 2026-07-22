import type { SessionState } from '../config/constants.js';

export interface ParsedDocument {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  documentNumber?: string;
  expiryDate?: string; // YYYY-MM-DD
  issueDate?: string; // YYYY-MM-DD
  nationality?: string;
  isExpired?: boolean;
  mrzDetected?: boolean;
  // AAMVA PDF417 barcode (North American driver's licenses / provincial ID cards)
  barcodeVerified?: boolean; // parsed from a machine-readable, structured barcode
  province?: string; // jurisdiction code, e.g. 'ON', 'BC', 'QC'
  issuingCountry?: string; // 'CAN' | 'USA'
}

export interface ParsedAddress {
  fullName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  province?: string; // state / province, e.g. 'ON', 'BC'
  postcode?: string;
  country?: string;
  issueDate?: string; // YYYY-MM-DD
  isStale?: boolean; // older than ADDRESS_DOC_MAX_AGE_DAYS
}

export interface DocumentCheckResult {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  documentType: string;
  side: string;
  parsed?: ParsedDocument;
  confidence?: number;
  error?: string;
}

export interface LivenessCheckResult {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  faceDetected?: boolean;
  livenessScore?: number;
  matchScore?: number;
  error?: string;
}

export interface AddressCheckResult {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  documentType: string;
  parsed?: ParsedAddress;
  nameMatchScore?: number;
  confidence?: number;
  error?: string;
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

export interface SessionStatus {
  id: string;
  state: SessionState;
  documentCheck?: DocumentCheckResult;
  selfieCheck?: LivenessCheckResult;
  addressCheck?: AddressCheckResult;
  riskScore?: RiskScore;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}
