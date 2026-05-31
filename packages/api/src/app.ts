import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { env } from './config/env.js';
import { MAX_FILE_SIZE_BYTES } from './config/constants.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import v1Routes from './routes/v1/index.js';
import healthRoutes from './routes/internal/health.js';
import verifyPageRoute from './routes/internal/verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({
    ajv: {
      customOptions: { keywords: ['example'] },
    },
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // CORS — allow any origin for API calls (auth is enforced via Bearer tokens, not cookies)
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // Multipart (file uploads)
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  });

  // Rate limiting
  await app.register(rateLimit, {
    global: false, // per-route configuration
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    }),
  });

  // OpenAPI / Swagger docs
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'KYC Verification API',
        description: `
## Overview
The KYC Verification API lets you verify the identity of your users through document scanning, liveness detection, and address verification — all in one flow.

## Authentication
All endpoints (except \`/health\`) require an **API Key** passed as a Bearer token:
\`\`\`
Authorization: Bearer kyc_live_your_api_key
\`\`\`

For document/selfie/address uploads from the **frontend**, use a short-lived **Session Token** instead:
\`\`\`
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
\`\`\`

Session tokens are obtained by creating a session from your **server** and passing the token to your frontend. Never expose your API key in browser code.

## Verification Flow
1. **Server** calls \`POST /v1/sessions\` → receives \`session_token\`
2. **Frontend** (or widget) uploads documents using \`session_token\`
3. **Server** polls \`GET /v1/sessions/:id\` or receives a **webhook** when processing completes

## Decisions
| Decision | Meaning |
|----------|---------|
| \`approved\` | All checks passed — user is verified |
| \`rejected\` | One or more checks failed |
| \`manual_review\` | Borderline result — awaiting admin decision |
        `.trim(),
        version: '1.0.0',
        contact: {
          name: 'KYC Service Support',
          url: 'https://kyc.zeehfi.ca/admin',
        },
      },
      servers: [{ url: 'https://kyc.zeehfi.ca', description: 'Production' }],
      components: {
        securitySchemes: {
          ApiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'Your merchant API key (`kyc_live_...`). Use for all server-side calls.',
          },
          SessionToken: {
            type: 'http',
            scheme: 'bearer',
            description: 'Short-lived session token (`eyJ...`). Use only for document uploads from the frontend.',
          },
        },
      },
      tags: [
        { name: 'Sessions', description: 'Create and manage KYC verification sessions' },
        { name: 'Documents', description: 'Upload identity documents, selfies, and address proof' },
        { name: 'Webhooks', description: 'Register endpoints to receive real-time verification results' },
        { name: 'Health', description: 'Service health check' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: false,
  });

  // Auth plugin
  await app.register(authPlugin);

  // Error handler
  await app.register(errorHandlerPlugin);

  // Serve admin dashboard and widget (built static files)
  const publicDir = join(__dirname, '../public');
  if (existsSync(publicDir)) {
    // Admin dashboard
    app.get('/admin', (_req, reply) => reply.redirect('/admin/'));
    await app.register(staticFiles, {
      root: publicDir,
      prefix: '/admin/',
    });
    // Widget JS — served at /widget/kyc-widget.js
    const widgetDir = join(publicDir, 'widget');
    if (existsSync(widgetDir)) {
      await app.register(staticFiles, {
        root: widgetDir,
        prefix: '/widget/',
        decorateReply: false,
      });
    }
  }

  // Routes
  await app.register(healthRoutes);
  await app.register(verifyPageRoute);
  await app.register(v1Routes, { prefix: '/v1' });

  return app;
}
