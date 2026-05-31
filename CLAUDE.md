# KYC Service — Claude Context

## Project Overview
Production-grade KYC (Know Your Customer) verification service built for fintech integration.
No third-party KYC providers — all processing is self-hosted.

## Architecture
- **Monorepo** (npm workspaces): `packages/api`, `packages/sdk`, `packages/widget`, `packages/admin`
- **Runtime**: Node.js 20 + TypeScript (ESM), Fastify v4
- **Database**: SQLite (better-sqlite3) with WAL mode, migrations in `packages/api/src/db/migrations/`
- **Job queue**: SQLite-backed async queue in `packages/api/src/workers/queue.ts`
- **OCR**: Tesseract.js with custom MRZ parser (TD1/TD3) in `packages/api/src/lib/ocrParsers/mrzParser.ts`
- **Face matching**: face-api.js + canvas in `packages/api/src/services/SelfieService.ts`
- **Image processing**: Sharp in `packages/api/src/lib/imagePreprocessor.ts`

## Verification Pipeline
1. **Document check** — OCR + MRZ parsing → extracts name/DOB/expiry/nationality
2. **Selfie/liveness check** — face detection + landmark geometric variance for passive liveness
3. **Address check** — OCR on utility bill/bank statement → name + address extraction
4. **Risk scoring** — weighted aggregate: doc ×0.35 + liveness ×0.30 + face match ×0.25 + address ×0.10

## Auth Model
- **Merchant API keys**: `kyc_live_...` prefix, scrypt-hashed in DB, used for server-side calls
- **Session tokens**: short-lived JWTs (scope: `widget`), issued per KYC session for widget use
- **Master key**: `kyc_master_...` prefix, env var, required for admin routes

## Deployment
- **EC2**: `98.80.172.157` (Ubuntu 22.04, t3.medium)
- **Domain**: `https://kyc.zeehfi.ca`
- **Repo path on EC2**: `/opt/kyc-service`
- **Data volumes**: `/data/storage` (uploads), `/data/db/kyc.db` (SQLite)
- **SSL**: Let's Encrypt via certbot container
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`) — push to `main` → SSH deploy
- **SSH key**: `~/.ssh/kyc-service-key.pem`

## Key Credentials (EC2 .env)
- `MASTER_API_KEY=kyc_master_096a542c400f5f0a4f09acffa6beca4b`
- `JWT_SECRET` — random 32-byte hex, in `/opt/kyc-service/.env`
- `.env` path: `/opt/kyc-service/.env` (chmod 600)

## GitHub Actions Secrets Required
Add to repo `Settings → Secrets → Actions`:
- `EC2_HOST` = `98.80.172.157`
- `EC2_USER` = `ubuntu`
- `EC2_SSH_KEY` = contents of `~/.ssh/kyc-service-key.pem`

## Live URLs
| URL | Description |
|-----|-------------|
| `https://kyc.zeehfi.ca/health` | Health check (no auth) |
| `https://kyc.zeehfi.ca/docs` | Swagger UI — interactive API docs for clients |
| `https://kyc.zeehfi.ca/admin` | Admin dashboard (manage sessions, merchants) |

## Key Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | Health check |
| POST | `/v1/sessions` | API key | Create KYC session |
| GET | `/v1/sessions/:id` | API key | Get full session result |
| GET | `/v1/sessions/:id/status` | API key | Poll session status |
| POST | `/v1/sessions/:id/documents` | Session token | Upload ID/passport |
| POST | `/v1/sessions/:id/selfie` | Session token | Upload selfie |
| POST | `/v1/sessions/:id/address` | Session token | Upload address doc |
| POST | `/v1/webhooks` | API key | Register webhook endpoint |
| GET | `/v1/webhooks` | API key | List webhooks |
| DELETE | `/v1/webhooks/:id` | API key | Delete webhook |
| POST | `/v1/webhooks/:id/test` | API key | Send test event |
| GET | `/v1/admin/metrics` | Master key | Metrics overview |
| GET | `/v1/admin/sessions` | Master key | List all sessions |
| POST | `/v1/admin/merchants` | Master key | Create merchant |
| POST | `/v1/admin/sessions/:id/approve` | Master key | Manual approve |
| POST | `/v1/admin/sessions/:id/reject` | Master key | Manual reject |

## Package Structure
```
packages/
  api/         — Fastify REST API (main service)
    src/
      config/  — env validation (zod), constants
      db/      — SQLite client, migrations, schema types
      lib/     — imagePreprocessor, ocrParsers, tokenManager, webhooks
      plugins/ — auth, errorHandler (Fastify plugins)
      routes/  — v1/ (sessions, documents, selfie, address, webhooks, admin)
                 internal/ (health)
      services/ — DocumentService, SelfieService, AddressService, RiskScoringService
      workers/ — queue.ts (job queue poll loop)
  sdk/         — TypeScript SDK (npm package for server-side integration)
  widget/      — <kyc-widget> vanilla web component (shadow DOM, no framework)
  admin/       — Vite SPA admin dashboard (vanilla TS, served at /admin/)
```

## TypeScript Notes
- Base tsconfig: `tsconfig.base.json` (strict mode, `exactOptionalPropertyTypes: true`)
- API tsconfig overrides: `exactOptionalPropertyTypes: false`, `skipLibCheck: true`
  (needed due to Buffer/NonSharedBuffer incompatibility between @types/node and sharp)
- AJV configured with `{ keywords: ['example'] }` to allow OpenAPI `example` fields in schemas

## Fastify Plugin Version Constraints (Fastify v4)
These must stay on v4-compatible versions — do NOT upgrade to latest without also upgrading Fastify:
- `@fastify/static` → `^7.x`
- `@fastify/swagger` → `^8.x`
- `@fastify/swagger-ui` → `^4.x`

## Nginx Notes
- Config: `nginx/nginx.conf`
- EC2 has a local modification to `nginx.conf` (domain substituted). On EC2, always use:
  `git stash && git pull && git stash pop && sudo docker compose up -d`
- `/docs` and `/admin` redirect to trailing-slash versions via nginx `location = /docs { return 301 /docs/; }`

## Dockerfile Notes
- Multi-stage: `admin-build` (Vite) → `production` (tsc + prune)
- Native deps installed via `apk add`: `python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev vips-dev`
- SQL migrations copied manually after tsc: `cp -r packages/api/src/db/migrations packages/api/dist/db/migrations`
- Install ALL deps first (including devDeps for tsc), build, then prune

## Common Commands
```bash
# Local dev
npm run dev --workspace=packages/api       # API on :3000
npm run dev --workspace=packages/admin     # Admin dashboard on :5173

# Build
npm run build --workspace=packages/api
npm run build --workspace=packages/admin

# Deploy (manual)
ssh -i ~/.ssh/kyc-service-key.pem ubuntu@98.80.172.157
cd /opt/kyc-service && git stash && git pull && git stash pop && sudo docker compose up -d --build

# View API logs on EC2
sudo docker logs -f kyc-service-api-1

# Restart nginx only (no rebuild)
sudo docker exec kyc-service-nginx-1 nginx -s reload
```

## Client Documentation
- **Interactive docs**: `https://kyc.zeehfi.ca/docs` (Swagger UI)
- **Developer guide**: `INTEGRATION.md` in repo root
- Clients receive a `kyc_live_...` API key created via `POST /v1/admin/merchants` using master key
