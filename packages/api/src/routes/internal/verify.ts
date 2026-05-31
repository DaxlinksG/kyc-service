import type { FastifyInstance } from 'fastify';

const HTML = (sessionToken: string, apiBase: string) => `<!DOCTYPE html>
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

    widget.addEventListener('kyc:complete', (e) => {
      const { decision } = e.detail;
      // Notify parent frame / opener
      if (window.opener) window.opener.postMessage({ type: 'kyc:complete', decision }, '*');
      if (window.parent !== window) window.parent.postMessage({ type: 'kyc:complete', decision }, '*');
      // Result is already shown inside the widget — nothing else to do
    });

    widget.addEventListener('kyc:error', (e) => {
      console.error('[KYC] error:', e.detail.message);
      if (window.opener) window.opener.postMessage({ type: 'kyc:error', message: e.detail.message }, '*');
      if (window.parent !== window) window.parent.postMessage({ type: 'kyc:error', message: e.detail.message }, '*');
    });

    // Debug: log when widget JS loads and any uncaught errors
    window.addEventListener('error', (e) => {
      console.error('[KYC] uncaught:', e.message, e.filename, e.lineno);
    });
  </script>
</body>
</html>`;

export default async function verifyPageRoute(app: FastifyInstance) {
  app.get<{ Querystring: { session_token?: string } }>('/verify', {
    schema: { hide: true },
  }, async (request, reply) => {
    const token = request.query.session_token;
    if (!token) {
      return reply.status(400).type('text/html').send(`
        <!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2>Missing session_token</h2>
          <p style="color:#64748b;margin-top:8px">This link is invalid. Please contact support.</p>
        </body></html>
      `);
    }
    // Use X-Forwarded-Proto if behind a reverse proxy (nginx), fallback to request.protocol
    const proto = (request.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ?? request.protocol;
    const apiBase = `${proto}://${request.hostname}`;
    return reply.type('text/html').send(HTML(token, apiBase));
  });
}
