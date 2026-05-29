# KYC Service — Integration Guide

## Quick Start

### 1. Install & Run the API

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET (64+ chars) and MASTER_API_KEY

npm install
npm run migrate --workspace=packages/api
npm run dev --workspace=packages/api
# API running at http://localhost:3000
```

### 2. Create a Merchant & API Key

```bash
curl -X POST http://localhost:3000/v1/api-keys \
  -H "Authorization: Bearer <MASTER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "my_fintech_app", "name": "Production key"}'

# Response: { "api_key": "kyc_live_...", ... }
# Save the api_key — it's shown only once.
```

### 3. Server-Side: Create a KYC Session

```typescript
import { KycClient } from '@kyc/sdk';

const kyc = new KycClient({
  apiKey: process.env.KYC_API_KEY!,
  baseUrl: 'https://your-kyc-instance.com',
});

// In your onboarding endpoint:
const session = await kyc.sessions.create({
  metadata: { userId: req.user.id, email: req.user.email },
});

// Return session_token to frontend (never the api_key!)
res.json({ session_token: session.session_token, widget_url: session.widget_url });
```

### 4a. Embed the Widget

```html
<!-- In your onboarding page -->
<script src="https://your-kyc-instance.com/widget/kyc-widget.js"></script>

<kyc-widget
  session-token="eyJ..."
  api-base-url="https://your-kyc-instance.com"
></kyc-widget>

<script>
  const widget = document.querySelector('kyc-widget');

  widget.addEventListener('kyc:complete', (e) => {
    const { decision } = e.detail; // 'approved' | 'rejected' | 'manual_review'
    if (decision === 'approved') {
      window.location.href = '/dashboard';
    } else {
      showMessage('Verification failed: ' + decision);
    }
  });

  widget.addEventListener('kyc:error', (e) => {
    console.error('KYC error:', e.detail.message);
  });
</script>
```

### 4b. Custom UI with the SDK

```typescript
// Upload directly if you have your own UI
await kyc.sessions.uploadDocument(session.session_id, {
  file: fs.createReadStream('./passport.jpg'),
  documentType: 'PASSPORT',
  side: 'FRONT',
});

await kyc.sessions.uploadSelfie(session.session_id, {
  file: fs.createReadStream('./selfie.jpg'),
});

await kyc.sessions.uploadAddress(session.session_id, {
  file: fs.createReadStream('./utility_bill.pdf'),
  documentType: 'UTILITY_BILL',
});

// Poll until done
const result = await kyc.sessions.waitForDecision(session.session_id, {
  timeout: 120_000,
  onStatusChange: (state) => console.log('KYC state:', state),
});

console.log('Decision:', result.risk_score?.decision);
```

### 5. Receive Webhooks

```typescript
// Register a webhook endpoint
const webhook = await kyc.webhooks.create('https://your-app.com/webhooks/kyc', [
  'session.approved',
  'session.rejected',
  'session.manual_review',
]);

// Save webhook.signing_secret securely — not retrievable again!

// In your webhook handler (Express example):
app.post('/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = kyc.verifyWebhook(req.body, req.headers['x-kyc-signature'], SIGNING_SECRET);
    const { session_id, data } = event;

    if (event.event === 'session.approved') {
      await activateUserAccount(session_id);
    }

    res.status(200).send('ok');
  } catch (err) {
    res.status(400).send('Signature verification failed');
  }
});
```

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/v1/sessions` | API Key | Create a verification session |
| GET | `/v1/sessions/:id` | API Key | Get full session details |
| GET | `/v1/sessions/:id/status` | API Key | Poll for session status |
| POST | `/v1/sessions/:id/documents` | Session Token | Upload ID document |
| POST | `/v1/sessions/:id/selfie` | Session Token | Upload selfie |
| POST | `/v1/sessions/:id/address` | Session Token | Upload address proof |
| POST | `/v1/webhooks` | API Key | Register webhook endpoint |
| GET | `/v1/webhooks` | API Key | List webhook endpoints |
| DELETE | `/v1/webhooks/:id` | API Key | Delete webhook endpoint |
| POST | `/v1/api-keys` | Master Key | Create merchant + API key |
| GET | `/health` | None | Health check |

## Session State Machine

```
created
  └─> document_submitted
        └─> selfie_submitted
              └─> address_submitted
                    └─> processing
                          ├─> approved
                          ├─> rejected
                          └─> manual_review
```

Any state can transition to `expired` if the session TTL (default 24h) is exceeded.

## Security Notes

- Never expose your API key to frontend code. Only pass the `session_token`.
- Session tokens are scoped to one session and expire in 2 hours.
- All uploaded files are stored outside the webroot and are never served directly.
- Webhook signatures use HMAC-SHA256 — always verify before trusting payloads.
- The MRZ checksum validation (TD3/passports) catches OCR errors before they affect scoring.
