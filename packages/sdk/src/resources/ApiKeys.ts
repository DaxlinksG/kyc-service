import type { HttpClient } from '../utils/httpClient.js';
import type { ApiKey } from '../types/responses.js';

export class ApiKeys {
  constructor(private readonly http: HttpClient) {}

  async create(merchantId: string, name?: string): Promise<ApiKey> {
    return this.http.post<ApiKey>('/v1/api-keys', { merchant_id: merchantId, name });
  }

  async revoke(keyId: string): Promise<void> {
    return this.http.delete(`/v1/api-keys/${keyId}`);
  }
}
