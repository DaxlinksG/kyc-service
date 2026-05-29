# KYC Service — Integration Guide

**Base URL:** `https://kyc.zeehfi.ca`  
**Admin Dashboard:** `https://kyc.zeehfi.ca/admin`  
**Support:** Contact your account manager to get your API key.

---

## How It Works

The KYC flow has three steps your user completes in order:

```
1. Upload ID document (passport or national ID)
2. Take a selfie (liveness check + face match)
3. Upload proof of address (utility bill or bank statement)
```

Your server creates the session and receives the result. Your frontend (or our drop-in widget) collects the documents from the user. You never expose your API key to the browser.

```
Your Server                  KYC Service                  Your Frontend / Widget
─────────────────────────────────────────────────────────────────────────────────
POST /v1/sessions ─────────────────────────────>
                  <─────────────── session_token
Pass session_token to frontend ─────────────────────────────────────────────────>
                                                      Upload docs with session_token
                                                <───────────────── kyc:complete event
GET /v1/sessions/:id ──────────────────────────>
                     <─────── { decision: "approved" }
```

---

## Step 1 — Get Your API Key

Ask your administrator to create a merchant account for you via the admin dashboard at `https://kyc.zeehfi.ca/admin`. You will receive an API key like:

```
kyc_live_a1b2c3d4e5f6...
```

**Keep this secret.** Never put it in frontend code, mobile apps, or public repos.

---

## Step 2 — Create a Session (Server-Side)

Call this from your backend when a user starts KYC onboarding.

**Request**
```http
POST https://kyc.zeehfi.ca/v1/sessions
Authorization: Bearer kyc_live_your_api_key
Content-Type: application/json

{
  "externalId": "user_123",
  "metadata": {
    "email": "jane@example.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `externalId` | string | Yes | Your internal user/application ID |
| `metadata` | object | No | Any extra data you want stored with the session |

**Response**
```json
{
  "session_id": "ses_abc123",
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "status": "created",
  "expires_at": 1780180945
}
```

Pass the `session_token` to your frontend — it's short-lived (2 hours) and scoped to this session only.

---

## Step 3 — Collect Documents

### Option A: Drop-in Widget (Recommended)

Zero UI work. Add one script tag and a custom element to your page.

```html
<script src="https://kyc.zeehfi.ca/widget/kyc-widget.js"></script>

<kyc-widget
  session-token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  api-base-url="https://kyc.zeehfi.ca"
></kyc-widget>

<script>
  const widget = document.querySelector('kyc-widget');

  widget.addEventListener('kyc:complete', (e) => {
    const { decision } = e.detail;
    // decision: "approved" | "rejected" | "manual_review"

    if (decision === 'approved') {
      window.location.href = '/dashboard';
    } else if (decision === 'manual_review') {
      showMessage('Your documents are under review. We'll notify you shortly.');
    } else {
      showMessage('Verification was unsuccessful. Please try again or contact support.');
    }
  });

  widget.addEventListener('kyc:error', (e) => {
    console.error('KYC error:', e.detail.message);
  });
</script>
```

The widget handles the full multi-step flow: ID upload → selfie → address → result screen.

---

### Option B: REST API (Custom UI)

Use these endpoints if you want full control over the upload UI. All requests use the `session_token` (not your API key).

#### Upload ID Document
```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/document
Authorization: Bearer <session_token>
Content-Type: multipart/form-data

file=<image or PDF>
documentType=PASSPORT   (or NATIONAL_ID, DRIVERS_LICENSE)
side=FRONT              (or BACK — required for national IDs)
```

Accepted formats: `JPEG`, `PNG`, `PDF` — max 10 MB.

#### Upload Selfie
```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/selfie
Authorization: Bearer <session_token>
Content-Type: multipart/form-data

file=<image>
```

The service runs a passive liveness check and matches the face against the ID photo automatically.

#### Upload Proof of Address
```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/address
Authorization: Bearer <session_token>
Content-Type: multipart/form-data

file=<image or PDF>
documentType=UTILITY_BILL   (or BANK_STATEMENT, GOVERNMENT_LETTER)
```

Document must be dated within the last 90 days.

---

## Step 4 — Get the Result

Poll or use webhooks (recommended) to get the decision.

### Poll for Status
```http
GET https://kyc.zeehfi.ca/v1/sessions/{session_id}
Authorization: Bearer kyc_live_your_api_key
```

**Response**
```json
{
  "session_id": "ses_abc123",
  "external_id": "user_123",
  "status": "approved",
  "risk_score": {
    "decision": "approved",
    "score": 0.87,
    "document_confidence": 0.92,
    "liveness_score": 0.89,
    "face_match_score": 0.83,
    "address_match_score": 0.91
  },
  "created_at": 1780094400,
  "completed_at": 1780094545
}
```

| `status` | Meaning |
|----------|---------|
| `created` | Session started, awaiting documents |
| `processing` | Documents submitted, running verification |
| `approved` | All checks passed — user is verified |
| `rejected` | One or more checks failed — do not onboard |
| `manual_review` | Borderline result — awaiting admin decision |
| `expired` | Session TTL exceeded (24 hours) |

---

### Webhooks (Recommended)

Register a webhook to receive real-time notifications instead of polling.

**Register**
```http
POST https://kyc.zeehfi.ca/v1/webhooks
Authorization: Bearer kyc_live_your_api_key
Content-Type: application/json

{
  "url": "https://your-app.com/webhooks/kyc",
  "events": ["session.approved", "session.rejected", "session.manual_review"]
}
```

**Response**
```json
{
  "webhook_id": "wh_xyz789",
  "signing_secret": "whsec_a1b2c3..."
}
```

> **Save `signing_secret` immediately** — it is only shown once.

**Verify & Handle Incoming Webhooks**

Every webhook request includes an `X-KYC-Signature` header. Always verify it before trusting the payload.

```typescript
// Express example
import crypto from 'crypto';

app.post('/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-kyc-signature'] as string;
  const secret = process.env.KYC_WEBHOOK_SECRET!;

  // Header format: t=<timestamp>,v1=<hex_signature>
  const [tPart, v1Part] = signature.split(',');
  const timestamp = tPart.split('=')[1];
  const receivedSig = v1Part.split('=')[1];

  // Verify
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${req.body}`)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig))) {
    return res.status(400).send('Invalid signature');
  }

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return res.status(400).send('Timestamp too old');
  }

  const event = JSON.parse(req.body.toString());

  switch (event.event) {
    case 'session.approved':
      await activateUserAccount(event.data.external_id);
      break;
    case 'session.rejected':
      await flagUserAccount(event.data.external_id);
      break;
    case 'session.manual_review':
      await notifyComplianceTeam(event.data.session_id);
      break;
  }

  res.status(200).send('ok');
});
```

**Webhook Payload**
```json
{
  "event": "session.approved",
  "session_id": "ses_abc123",
  "timestamp": 1780094545,
  "data": {
    "external_id": "user_123",
    "decision": "approved",
    "score": 0.87
  }
}
```

---

## SDK (TypeScript / Node.js)

Install from your private registry or directly from the repo:

```bash
npm install @kyc/sdk
```

```typescript
import { KycClient } from '@kyc/sdk';

const kyc = new KycClient({
  apiKey: process.env.KYC_API_KEY!,
  baseUrl: 'https://kyc.zeehfi.ca',
});

// Create session
const session = await kyc.sessions.create({ externalId: 'user_123' });

// Pass session.sessionToken to your frontend

// Wait for a decision (polls with backoff, up to 2 minutes)
const result = await kyc.sessions.waitForDecision(session.sessionId);
console.log(result.status); // "approved"

// Verify a webhook signature
const event = kyc.webhooks.verify(rawBody, signatureHeader, signingSecret);
```

---

## Quick Reference

### Authentication

| Key Type | Looks Like | Used For |
|----------|-----------|----------|
| API Key | `kyc_live_...` | Server-side API calls |
| Session Token | `eyJ...` (JWT) | Widget / direct upload only |
| Master Key | `kyc_master_...` | Admin operations only |

### Document Requirements

| Document | Accepted Types | Notes |
|----------|---------------|-------|
| ID | Passport, National ID, Driver's License | Both sides required for National ID |
| Selfie | Photo (JPEG/PNG) | Clear face, no sunglasses |
| Address Proof | Utility bill, bank statement, government letter | Must be ≤ 90 days old |

### Risk Score Breakdown

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Document confidence | 35% | OCR quality + MRZ checksum |
| Liveness score | 30% | Real person vs. photo attack |
| Face match | 25% | Selfie matches ID photo |
| Address match | 10% | Name on address doc matches ID |

**Thresholds:** `≥ 0.80` → approved · `0.55 – 0.79` → manual review · `< 0.55` → rejected

### Error Codes

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | Missing or invalid API key / session token |
| `SESSION_NOT_FOUND` | Session ID does not exist |
| `SESSION_EXPIRED` | Session TTL (24h) exceeded — create a new one |
| `INVALID_FILE_TYPE` | Only JPEG, PNG, PDF accepted |
| `FILE_TOO_LARGE` | Max file size is 10 MB |
| `RATE_LIMITED` | Slow down — max 100 requests/minute per key |
| `DOCUMENT_ALREADY_UPLOADED` | Each document type can only be uploaded once |

---

## Security Checklist

- [ ] API key is stored as an environment variable, never in code
- [ ] `session_token` is generated fresh per user session — never reused
- [ ] Webhook `signing_secret` is stored securely and rotated if compromised
- [ ] Webhook handler verifies the HMAC signature on every request
- [ ] Webhook handler rejects payloads with timestamps older than 5 minutes
- [ ] HTTPS is enforced end-to-end (never call over plain HTTP)

---

## Need Help?

- **Admin dashboard:** `https://kyc.zeehfi.ca/admin`
- **Health status:** `https://kyc.zeehfi.ca/health`
- **Session logs:** visible in the admin dashboard under Sessions
