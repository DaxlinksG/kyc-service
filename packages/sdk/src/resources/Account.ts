import type { HttpClient } from '../utils/httpClient.js';
import type { MerchantInfo, Metrics } from '../types/responses.js';

/** Account-level reads: identify the key's merchant and fetch aggregate metrics. */
export class Account {
  constructor(private readonly http: HttpClient) {}

  /** Identify the merchant account behind the current API key. */
  async me(): Promise<MerchantInfo> {
    return this.http.get<MerchantInfo>('/v1/me');
  }

  /** Aggregate KYC statistics for your account (totals, decision breakdown, approval rate). */
  async metrics(): Promise<Metrics> {
    return this.http.get<Metrics>('/v1/metrics');
  }
}
