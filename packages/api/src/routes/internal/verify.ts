import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../../db/client.js';
import { SessionService } from '../../services/SessionService.js';
import type { DbVerificationLink } from '../../db/schema.js';

const sessionService = new SessionService();

const HTML = (sessionToken: string, apiBase: string, redirectUrl?: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Identity Verification</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    kyc-widget { width: 100%; max-width: 420px; }
    .powered {
      margin-top: 16px;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <kyc-widget
    session-token="${sessionToken}"
    api-base-url="${apiBase}"
  ></kyc-widget>
  <div class="powered">Powered by Usezeeh</div>
  <script src="${apiBase}/widget/kyc-widget.js"></script>
  <script>
    const widget = document.querySelector('kyc-widget');
    const redirectUrl = ${redirectUrl ? JSON.stringify(redirectUrl) : 'null'};

    widget.addEventListener('kyc:complete', (e) => {
      const { decision } = e.detail;
      // Notify parent frame / opener
      if (window.opener) window.opener.postMessage({ type: 'kyc:complete', decision }, '*');
      if (window.parent !== window) window.parent.postMessage({ type: 'kyc:complete', decision }, '*');
      // Redirect if configured
      if (redirectUrl) {
        const url = new URL(redirectUrl);
        url.searchParams.set('kyc_decision', decision);
        setTimeout(() => { window.location.href = url.toString(); }, 1500);
      }
    });

    widget.addEventListener('kyc:error', (e) => {
      console.error('[KYC] error:', e.detail.message);
      if (window.opener) window.opener.postMessage({ type: 'kyc:error', message: e.detail.message }, '*');
      if (window.parent !== window) window.parent.postMessage({ type: 'kyc:error', message: e.detail.message }, '*');
    });

    window.addEventListener('error', (e) => {
      console.error('[KYC] uncaught:', e.message, e.filename, e.lineno);
    });
  </script>
</body>
</html>`;

const ERROR_PAGE = (title: string, message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Verification Unavailable</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh;
           display: flex; align-items: center; justify-content: center; background: #f8fafc; padding: 24px; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h2 { color: #1e293b; margin-bottom: 12px; }
    p { color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;

export default async function verifyPageRoute(app: FastifyInstance) {

  // GET /verify — direct link with a pre-issued session_token (embedded widget integration)
  app.get<{ Querystring: { session_token?: string } }>('/verify', {
    schema: { hide: true },
  }, async (request, reply) => {
    const token = request.query.session_token;
    if (!token) {
      return reply.status(400).type('text/html').send(ERROR_PAGE(
        'Missing session token',
        'This link is invalid or incomplete. Please contact the service provider.',
      ));
    }
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const apiBase = `${proto}://${request.hostname}`;
    return reply.type('text/html').send(HTML(token, apiBase));
  });

  // GET /verify/:slug — no-code verification link (auto-creates session)
  app.get<{ Params: { slug: string } }>('/verify/:slug', {
    schema: { hide: true },
  }, async (request, reply) => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const link = db.prepare('SELECT * FROM verification_links WHERE slug = ?').get(request.params.slug) as DbVerificationLink | undefined;

    if (!link) {
      return reply.status(404).type('text/html').send(ERROR_PAGE(
        'Link not found',
        'This verification link does not exist. Please check the URL or contact support.',
      ));
    }

    if (!link.is_active) {
      return reply.status(410).type('text/html').send(ERROR_PAGE(
        'Link no longer active',
        'This verification link has been deactivated. Please contact the service provider for a new link.',
      ));
    }

    if (link.expires_at && link.expires_at < now) {
      return reply.status(410).type('text/html').send(ERROR_PAGE(
        'Link expired',
        'This verification link has expired. Please contact the service provider for a new one.',
      ));
    }

    // Auto-create a session for this merchant
    const metadata = link.metadata ? JSON.parse(link.metadata) : undefined;
    const result = sessionService.create({
      merchantId: link.merchant_id,
      metadata: { ...metadata, _source: 'verification_link', _link_id: link.id },
    });

    // Tag the session with the link that created it
    db.prepare('UPDATE sessions SET verification_link_id = ? WHERE id = ?').run(link.id, result.sessionId);

    // Increment usage counter
    db.prepare('UPDATE verification_links SET sessions_created = sessions_created + 1 WHERE id = ?').run(link.id);

    // Deactivate if single-use
    if (link.single_use) {
      db.prepare('UPDATE verification_links SET is_active = 0 WHERE id = ?').run(link.id);
    }

    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const apiBase = `${proto}://${request.hostname}`;

    return reply.type('text/html').send(HTML(result.sessionToken, apiBase, link.redirect_url ?? undefined));
  });
}
