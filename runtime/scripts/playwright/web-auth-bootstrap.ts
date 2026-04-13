#!/usr/bin/env bun
// @ts-nocheck

export function resolveInternalSecret(explicitSecret?: string): string {
  const value = String(
    explicitSecret ||
    process.env.PICLAW_INTERNAL_SECRET ||
    process.env.PICLAW_WEB_INTERNAL_SECRET ||
    ''
  ).trim();
  if (!value) {
    throw new Error('Missing internal secret. Pass --internal-secret or set PICLAW_INTERNAL_SECRET / PICLAW_WEB_INTERNAL_SECRET.');
  }
  return value;
}

function parseSetCookie(setCookieHeader: string | null, baseUrl: string) {
  if (!setCookieHeader) {
    throw new Error('E2E auth bootstrap did not return a Set-Cookie header.');
  }

  const parts = setCookieHeader.split(';').map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  if (eq <= 0) {
    throw new Error(`Invalid Set-Cookie header: ${setCookieHeader}`);
  }

  const name = nameValue.slice(0, eq).trim();
  const value = nameValue.slice(eq + 1);
  const url = new URL(baseUrl);
  const cookie = {
    name,
    value,
    domain: url.hostname,
    path: '/',
    httpOnly: false,
    secure: url.protocol === 'https:',
    sameSite: 'Lax',
    expires: -1,
  } as any;

  for (const attr of attrs) {
    const [rawKey, ...rawRest] = attr.split('=');
    const key = String(rawKey || '').trim().toLowerCase();
    const attrValue = rawRest.join('=').trim();
    if (key === 'path' && attrValue) cookie.path = attrValue;
    else if (key === 'domain' && attrValue) cookie.domain = attrValue.replace(/^\./, '');
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite' && attrValue) {
      const normalized = attrValue.toLowerCase();
      if (normalized === 'strict') cookie.sameSite = 'Strict';
      else if (normalized === 'none') cookie.sameSite = 'None';
      else cookie.sameSite = 'Lax';
    } else if (key === 'max-age' && attrValue && Number.isFinite(Number(attrValue))) {
      cookie.expires = Math.floor(Date.now() / 1000) + Number(attrValue);
    }
  }

  return cookie;
}

export async function bootstrapE2EStorageState(options: {
  baseUrl: string;
  internalSecret?: string;
}) {
  const baseUrl = String(options.baseUrl || '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('bootstrapE2EStorageState requires a baseUrl.');

  const response = await fetch(`${baseUrl}/auth/e2e/bootstrap`, {
    method: 'POST',
    headers: {
      'x-piclaw-internal-secret': resolveInternalSecret(options.internalSecret),
    },
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error([
      `E2E auth bootstrap failed: HTTP ${response.status}`,
      bodyText && `body: ${bodyText}`,
      'Expected loopback access to the local web server plus a valid internal secret.',
    ].filter(Boolean).join('\n'));
  }

  const cookie = parseSetCookie(response.headers.get('set-cookie'), baseUrl);
  return {
    cookies: [cookie],
    origins: [],
  };
}
