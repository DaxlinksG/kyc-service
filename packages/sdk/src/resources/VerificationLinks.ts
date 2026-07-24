import type { HttpClient } from '../utils/httpClient.js';
import type { VerificationLink } from '../types/responses.js';

export interface CreateVerificationLinkOptions {
  /** Internal label to recognise this link. */
  name: string;
  /** Custom URL slug (lowercase letters, numbers, hyphens). Auto-generated if omitted. */
  slug?: string;
  /** Deactivate the link after the first session is created. */
  single_use?: boolean;
  /** Where users are sent after they finish verifying. */
  redirect_url?: string;
  /** JSON merged into every session created from this link. */
  metadata?: Record<string, unknown>;
  /** Unix timestamp after which the link stops working. */
  expires_at?: number;
}

export interface UpdateVerificationLinkOptions {
  name?: string;
  is_active?: boolean;
  redirect_url?: string | null;
}

/**
 * No-code shareable links that auto-create a session and launch the widget.
 * Ideal for onboarding via email, WhatsApp, or SMS — zero integration required.
 */
export class VerificationLinks {
  constructor(private readonly http: HttpClient) {}

  /** Create a shareable verification link. The returned `url` is what you send to users. */
  async create(opts: CreateVerificationLinkOptions): Promise<VerificationLink> {
    return this.http.post<VerificationLink>('/v1/verification-links', opts);
  }

  /** List all links for your account, newest first. */
  async list(): Promise<{ data: VerificationLink[] }> {
    return this.http.get<{ data: VerificationLink[] }>('/v1/verification-links');
  }

  async get(linkId: string): Promise<VerificationLink> {
    return this.http.get<VerificationLink>(`/v1/verification-links/${linkId}`);
  }

  /** Update a link's name, active state, or redirect URL. */
  async update(linkId: string, opts: UpdateVerificationLinkOptions): Promise<VerificationLink> {
    return this.http.patch<VerificationLink>(`/v1/verification-links/${linkId}`, opts);
  }

  /** Deactivate a link so it stops creating new sessions. Existing sessions are unaffected. */
  async deactivate(linkId: string): Promise<{ deactivated: boolean }> {
    return this.http.delete<{ deactivated: boolean }>(`/v1/verification-links/${linkId}`);
  }
}
