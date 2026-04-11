/**
 * channels/web/webauthn-enrol-page.ts – Passkey enrolment HTML page response.
 */

/** Runtime dependencies required to serve the passkey enrolment page. */
export interface WebauthnEnrolPageContext {
  isPasskeyEnabled(): boolean;
  json(payload: unknown, status?: number): Response;
}

const WEBAUTHN_ENROL_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Passkey enrolment</title>
    <style>
      :root { color-scheme: light dark; --bg:#0b0f14; --card:#111827; --text:#e5e7eb; --muted:#94a3b8; --border:#1f2937; --accent:#38bdf8; }
      @media (prefers-color-scheme: light) { :root { --bg:#f8fafc; --card:#fff; --text:#0f172a; --muted:#64748b; --border:#e2e8f0; --accent:#2563eb; } }
      body { margin:0; font-family:"Segoe UI", system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; }
      .card { width:min(92vw, 520px); background:var(--card); border:1px solid var(--border); border-radius:16px; padding:28px; box-shadow:0 24px 48px rgba(0,0,0,0.2); }
      h1 { font-size:22px; margin:0 0 8px; }
      p { margin:0 0 16px; color:var(--muted); }
      .status { margin-top:12px; font-size:14px; }
      button { padding:12px 16px; border-radius:10px; border:none; background:var(--accent); color:white; font-size:16px; cursor:pointer; }
      button[disabled] { opacity:0.6; cursor:not-allowed; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Register a passkey</h1>
      <p>This link expires in a few minutes. Keep this tab open.</p>
      <button id="start">Create passkey</button>
      <div class="status" id="status"></div>
    </div>
    <script>
      const statusEl = document.getElementById('status');
      const startBtn = document.getElementById('start');

      const base64UrlToBuffer = (value) => {
        const pad = '='.repeat((4 - (value.length % 4)) % 4);
        const base64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const buffer = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
        return buffer;
      };

      const bufferToBase64Url = (buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      };

      const parseError = async (res, fallback) => {
        try {
          const data = await res.json();
          const message = data && (data.error || data.detail || data.message);
          if (message) return message;
        } catch {
          /* expected: some error responses are plain text or empty, so JSON parsing is best-effort. */
        }
        try {
          const text = await res.text();
          if (text) return text;
        } catch {
          /* expected: body streams can already be consumed/empty on failing enrol responses. */
        }
        return fallback || ('HTTP ' + res.status);
      };

      const credentialToJSON = (cred) => ({
        id: cred.id,
        rawId: bufferToBase64Url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
          attestationObject: bufferToBase64Url(cred.response.attestationObject),
          transports: cred.response.getTransports ? cred.response.getTransports() : undefined
        }
      });

      const parseOptions = (options) => {
        return {
          ...options,
          challenge: base64UrlToBuffer(options.challenge),
          user: {
            ...options.user,
            id: base64UrlToBuffer(options.user.id)
          },
          excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
            ...cred,
            id: base64UrlToBuffer(cred.id)
          }))
        };
      };

      const token = new URLSearchParams(window.location.search).get('token');
      if (!window.PublicKeyCredential || !navigator.credentials) {
        statusEl.textContent = 'Passkeys are not supported in this browser.';
        startBtn.disabled = true;
      } else if (!window.isSecureContext) {
        statusEl.textContent = 'Passkeys require HTTPS or localhost.';
        startBtn.disabled = true;
      } else if (!token) {
        statusEl.textContent = 'Missing enrol token.';
        startBtn.disabled = true;
      }

      let publicKeyOptions = null;

      const loadOptions = async () => {
        if (!token) return;
        startBtn.disabled = true;
        statusEl.textContent = 'Preparing passkey options…';
        try {
          const res = await fetch('/auth/webauthn/register/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          if (!res.ok) {
            const detail = await parseError(res, 'Failed to start registration');
            throw new Error(detail);
          }
          const payload = await res.json();
          publicKeyOptions = parseOptions(payload.options);
          statusEl.textContent = 'Ready to create passkey.';
          startBtn.disabled = false;
        } catch (err) {
          statusEl.textContent = err && err.message ? err.message : 'Failed to prepare passkey options.';
          startBtn.disabled = true;
        }
      };

      const startEnrollment = async () => {
        if (!token) return;
        if (!publicKeyOptions) {
          statusEl.textContent = 'Passkey options are not ready yet.';
          return;
        }
        startBtn.disabled = true;
        try {
          statusEl.textContent = 'Waiting for your passkey…';
          const cred = await navigator.credentials.create({ publicKey: publicKeyOptions });
          if (!cred) throw new Error('Passkey creation cancelled');
          const finish = await fetch('/auth/webauthn/register/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, credential: credentialToJSON(cred) })
          });
          if (!finish.ok) {
            const detail = await parseError(finish, 'Registration failed');
            throw new Error(detail);
          }
          statusEl.textContent = 'Passkey registered. You can close this tab.';
        } catch (err) {
          const name = err && err.name ? err.name : '';
          const message = err && err.message ? err.message : '';
          const detail = [name, message].filter(Boolean).join(' ').trim();
          statusEl.textContent = detail ? 'Passkey error: ' + detail : 'Passkey registration failed.';
          startBtn.disabled = false;
        }
      };

      startBtn.addEventListener('click', startEnrollment);
      if (window.PublicKeyCredential && window.isSecureContext && token) {
        loadOptions();
      }

    </script>
  </body>
</html>`;

/** Return passkey enrolment HTML when passkeys are enabled. */
export function handleWebauthnEnrollPageRequest(ctx: WebauthnEnrolPageContext): Response {
  if (!ctx.isPasskeyEnabled()) return ctx.json({ error: "Passkeys disabled" }, 404);
  return new Response(WEBAUTHN_ENROL_PAGE_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
