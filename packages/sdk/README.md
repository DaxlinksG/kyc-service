# @zeehfi/kyc-sdk

Official TypeScript / Node.js SDK for the **Zeeh KYC verification service** — create verification sessions, upload documents, and verify webhooks with a typed, ergonomic client.

- **Base URL:** `https://kyc.zeehfi.ca`
- **Interactive API docs:** https://kyc.zeehfi.ca/docs
- **Full integration guide:** [`INTEGRATION.md`](https://github.com/DaxlinksG/kyc-service/blob/main/INTEGRATION.md)

> Your `kyc_live_` API key is a **server-side** secret. Never ship it in browser or mobile code. For frontend document uploads, pass the short-lived `session_token` to your client instead.

## Install

```bash
npm install @zeehfi/kyc-sdk
```

Requires Node.js 18+. Ships both ESM and CommonJS builds with full type declarations.

## Quick start

```typescript
import { KycClient } from '@zeehfi/kyc-sdk';

const kyc = new KycClient({
  apiKey: process.env.KYC_API_KEY!, // kyc_live_...
  // baseUrl defaults to https://kyc.zeehfi.ca
});

// 1. Create a session on your server
const session = await kyc.sessions.create({
  metadata: { externalId: 'user_123' },
});

// 2. Hand session.session_token to your frontend (widget or custom UI)

// 3. Wait for the decision (polls with backoff, up to 2 minutes)
const result = await kyc.sessions.waitForDecision(session.session_id);
console.log(result.state); // "approved" | "rejected" | "manual_review"
```

## Client options

```typescript
new KycClient({
  apiKey: 'kyc_live_...', // required
  baseUrl: 'https://kyc.zeehfi.ca', // optional, this is the default
  timeout: 30_000, // optional, ms (default 30s)
  maxRetries: 3, // optional (default 3)
});
```

## Sessions

```typescript
await kyc.sessions.create({ metadata, redirect_url });
await kyc.sessions.get(sessionId);        // full result with per-check breakdown
await kyc.sessions.getStatus(sessionId);  // lightweight status poll
await kyc.sessions.waitForDecision(sessionId, { /* PollOptions */ });

// Direct uploads (use the session_token as apiKey on a separate client, or from your frontend)
await kyc.sessions.uploadDocument(sessionId, { file, documentType: 'PASSPORT', side: 'FRONT' });
await kyc.sessions.uploadSelfie(sessionId, { file });
await kyc.sessions.uploadAddress(sessionId, { file, documentType: 'UTILITY_BILL' });
```

`file` accepts a `Blob`, `Buffer`, or Node `ReadableStream`.

## Webhooks

Register an endpoint and verify incoming events. **Always verify the signature before trusting the payload.**

```typescript
// Register (returns signing_secret ONCE — store it securely)
const wh = await kyc.webhooks.create('https://your-app.com/webhooks/kyc', [
  'session.approved',
  'session.rejected',
  'session.manual_review',
]);

await kyc.webhooks.list();
await kyc.webhooks.test(webhookId);
await kyc.webhooks.delete(webhookId);
```

### Verifying a webhook (Express)

```typescript
import express from 'express';
import { KycClient } from '@zeehfi/kyc-sdk';

const kyc = new KycClient({ apiKey: process.env.KYC_API_KEY! });

app.post('/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = kyc.verifyWebhook(
      req.body,                              // raw Buffer
      req.headers['x-kyc-signature'] as string,
      process.env.KYC_WEBHOOK_SECRET!,       // the signing_secret from registration
    );

    switch (event.event) {
      case 'session.approved':      /* activate the user */ break;
      case 'session.rejected':      /* flag the user */ break;
      case 'session.manual_review': /* notify compliance */ break;
    }

    res.status(200).send('ok');
  } catch {
    res.status(400).send('Invalid signature');
  }
});
```

`verifyWebhook` performs HMAC-SHA256 verification with a constant-time comparison and a 5-minute replay window, then returns the parsed event. A standalone `verifyWebhookSignature(rawBody, signature, secret, toleranceSeconds?)` export is also available if you prefer not to instantiate the client.

## Error handling

```typescript
import { KycApiError, KycNetworkError } from '@zeehfi/kyc-sdk';

try {
  await kyc.sessions.get('ses_does_not_exist');
} catch (err) {
  if (err instanceof KycApiError) {
    console.error(err.code, err.statusCode, err.message); // e.g. SESSION_NOT_FOUND 404
  } else if (err instanceof KycNetworkError) {
    console.error('Network/timeout:', err.message);
  }
}
```

## License

MIT
