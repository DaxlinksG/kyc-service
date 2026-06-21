# KYC Service — Integration Guide

**Base URL:** `https://kyc.zeehfi.ca`  
**Interactive API Docs:** `https://kyc.zeehfi.ca/docs`  
**Admin Dashboard:** `https://kyc.zeehfi.ca/admin`  
**Support:** Contact your account manager to get your API key.

---

## How It Works

```
Your Server                  KYC Service                  Your Frontend / Widget
─────────────────────────────────────────────────────────────────────────────────
POST /v1/sessions ─────────────────────────────>
                  <─────────────── session_token
Pass session_token to frontend ─────────────────────────────────────────────────>
                                                      Widget guides user through:
                                                       1. ID document scan
                                                       2. Active liveness check
                                                       3. Proof of address upload
                                                <─────────── kyc:complete event
GET /v1/sessions/:id ──────────────────────────>
                     <─────── { decision: "approved" }
```

Your server creates the session and receives the result. Your frontend — or our drop-in widget — collects documents from the user. **Your API key never touches the browser.**

---

## Step 1 — Get Your API Key

Ask your administrator to create your merchant account via the admin dashboard at `https://kyc.zeehfi.ca/admin`. You will receive an API key like:

```
kyc_live_a1b2c3d4e5f6...
```

**Keep this secret.** Never put it in frontend code, mobile apps, or public repos.

---

## Step 2 — Create a Session (Server-Side)

Call this from your backend when a user begins KYC onboarding.

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
| `externalId` | string | Yes | Your internal user or application ID |
| `metadata` | object | No | Any extra data stored with this session |

**Response**
```json
{
  "session_id": "ses_abc123",
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "status": "created",
  "expires_at": 1780180945
}
```

Pass `session_token` to your frontend. It is short-lived (2 hours) and scoped to this session only.

---

## Step 3 — Collect Documents

### Option A — Drop-in Widget (Recommended)

Zero UI work. One script tag, one custom element. Works on desktop and mobile.

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
      showMessage("Your documents are under review. We'll notify you shortly.");
    } else {
      showMessage('Verification was unsuccessful. Please try again or contact support.');
    }
  });

  widget.addEventListener('kyc:error', (e) => {
    console.error('KYC error:', e.detail.message);
  });
</script>
```

#### What the widget does — step by step

**Step 1 — ID Document**
- Opens the device rear camera automatically
- Card-shaped frame overlay — user aligns their ID inside it
- Frame turns green when the document is detected; 3-second countdown then captures
- Retake option if the image isn't clear
- Falls back to file upload if camera is unavailable

**Step 2 — Active Liveness Check**
- Powered by AWS Rekognition Face Liveness (same technology used by AWS Connect, Onfido, etc.)
- Shows an oval overlay and runs a short randomised challenge (colour flash + head movement)
- Impossible to spoof with a photo or pre-recorded video
- Runs natively in the widget — no redirect, no iframe, works on iOS Safari
- On completion the face is automatically matched against the ID document

**Step 3 — Proof of Address**
- User selects document type (Utility Bill, Bank Statement, Government Letter)
- Drag & drop or click-to-upload — JPEG, PNG, PDF accepted
- Must be dated within 90 days

**Result screen**
- Polls for the decision automatically (every 3 seconds, up to 2 minutes)
- Shows a clear result: ✅ Approved · ❌ Rejected · ⏳ Under Review
- Fires `kyc:complete` with the decision

#### Hosted verification page

You can also send users to a hosted page instead of embedding the widget:

```
https://kyc.zeehfi.ca/verify?session_token=<session_token>
```

Useful for email links or when you don't want to embed anything.

#### Browser compatibility

| Browser | Version |
|---------|---------|
| Chrome | 80+ |
| Firefox | 75+ |
| Safari | 14+ (including iOS) |
| Edge | 80+ |

Camera capture uses the browser's native `getUserMedia` API. If denied, the widget falls back to file upload for document and address steps. The liveness check requires camera access — the widget will prompt the user to grant it.

---

### Option B — REST API (Custom UI)

Use these endpoints if you want full control over the upload UI. All requests use the `session_token` as the Bearer token (not your API key).

#### Upload ID Document

```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/documents
Authorization: Bearer <session_token>
Content-Type: multipart/form-data

file=<image>
document_type=PASSPORT          (or NATIONAL_ID, DRIVING_LICENSE)
side=FRONT                      (FRONT required; BACK optional for national IDs)
```

Accepted formats: `JPEG`, `PNG`, `WebP` — max 20 MB.

#### Active Liveness Check (2 calls)

The liveness step requires two API calls — one to create the AWS session, one to trigger result processing after the user completes the challenge.

**1. Create the liveness session**
```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/face-liveness
Authorization: Bearer <session_token>
```

Response:
```json
{
  "face_liveness_session_id": "abc123-def456",
  "region": "us-east-1",
  "access_key_id": "ASIA...",
  "secret_access_key": "..."
}
```

**2. Render the Amplify FaceLivenessDetector**

Use the response to render `@aws-amplify/ui-react-liveness` in your React app:

```tsx
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';

<FaceLivenessDetector
  sessionId={face_liveness_session_id}
  region={region}
  credentialProvider={async () => ({ accessKeyId, secretAccessKey })}
  onAnalysisComplete={handleComplete}
  onError={handleError}
/>
```

**3. Signal completion**
```http
POST https://kyc.zeehfi.ca/v1/sessions/face-liveness/{face_liveness_session_id}/complete
Authorization: Bearer <session_token>
```

This triggers the server to fetch the liveness confidence score from AWS and run face matching against the ID document.

> If you are not building a React app, use the drop-in widget (Option A) — it handles the entire liveness flow for you.

#### Upload Proof of Address

```http
POST https://kyc.zeehfi.ca/v1/sessions/{session_id}/address
Authorization: Bearer <session_token>
Content-Type: multipart/form-data

file=<image or PDF>
document_type=UTILITY_BILL      (or BANK_STATEMENT, GOVERNMENT_LETTER)
```

Document must be dated within the last 90 days.

---

## Step 4 — Get the Result

### Webhooks (Recommended)

Register a webhook to receive the decision in real time.

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

> **Save `signing_secret` immediately** — it is shown only once.

**Verify & handle incoming webhooks**

Every webhook request includes an `X-KYC-Signature` header. Always verify it before trusting the payload.

```typescript
// Express example
import crypto from 'crypto';

app.post('/webhooks/kyc', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-kyc-signature'] as string;
  const secret = process.env.KYC_WEBHOOK_SECRET!;

  // Header format: t=<timestamp>,v1=<hex_signature>
  const [tPart, v1Part] = signature.split(',');
  const timestamp = tPart!.split('=')[1]!;
  const receivedSig = v1Part!.split('=')[1]!;

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

**Webhook payload**
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

## SDK (TypeScript / Node.js)

```bash
npm install @kyc/sdk
```

```typescript
import { KycClient } from '@kyc/sdk';

const kyc = new KycClient({
  apiKey: process.env.KYC_API_KEY!,
  baseUrl: 'https://kyc.zeehfi.ca',
});

// Create a session
const session = await kyc.sessions.create({ externalId: 'user_123' });

// Pass session.sessionToken to your frontend

// Poll for the decision (backoff, up to 2 minutes)
const result = await kyc.sessions.waitForDecision(session.sessionId);
console.log(result.status); // "approved"

// Verify a webhook signature
const event = kyc.webhooks.verify(rawBody, signatureHeader, signingSecret);
```

---

## Quick Reference

### Authentication

| Key Type | Format | Used For |
|----------|--------|----------|
| API Key | `kyc_live_...` | Server-side API calls |
| Session Token | `eyJ...` (JWT) | Widget / direct upload endpoints |
| Master Key | `kyc_master_...` | Admin operations only |

### Document Requirements

| Type | Accepted Formats | Notes |
|------|-----------------|-------|
| ID | JPEG, PNG, WebP | Passport, National ID, or Driver's License |
| Selfie / Liveness | Live camera (widget handles this) | Active challenge — cannot be a static photo |
| Address proof | JPEG, PNG, WebP, PDF | Must be ≤ 90 days old |

### How Decisions Are Made

| Component | Weight | What It Measures |
|-----------|--------|-----------------|
| Document confidence | 35% | OCR quality + MRZ checksum validity |
| Liveness score | 30% | AWS Rekognition confidence (0–100 → 0–1) |
| Face match | 25% | Selfie vs. ID photo similarity |
| Address match | 10% | Name on address doc matches ID |

**Thresholds:** ≥ 0.80 → `approved` · 0.55–0.79 → `manual_review` · < 0.55 → `rejected`

### Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key / session token |
| `SESSION_NOT_FOUND` | 404 | Session ID does not exist |
| `SESSION_EXPIRED` | 410 | Session TTL (24h) exceeded — create a new one |
| `INVALID_FILE_TYPE` | 422 | Only JPEG, PNG, WebP, PDF accepted |
| `FILE_TOO_LARGE` | 422 | Max file size is 20 MB |
| `RATE_LIMITED` | 429 | Max 100 requests/minute per key |
| `DOCUMENT_ALREADY_UPLOADED` | 409 | Each document type can only be uploaded once per session |

---

## Security Checklist

- [ ] API key stored as an environment variable, never in source code
- [ ] `session_token` generated fresh per user session — never reused or cached
- [ ] `signing_secret` stored securely (env var), rotated immediately if compromised
- [ ] Webhook handler verifies HMAC-SHA256 signature on every request
- [ ] Webhook handler rejects payloads with timestamps older than 5 minutes
- [ ] All API calls made over HTTPS — never plain HTTP

---

## Need Help?

- **Interactive API docs:** `https://kyc.zeehfi.ca/docs`
- **Admin dashboard:** `https://kyc.zeehfi.ca/admin`
- **Health check:** `https://kyc.zeehfi.ca/health`
- **Session logs:** visible in the admin dashboard under Sessions
