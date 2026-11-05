import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createTempWorkspace, setEnv } from '../../../helpers';
import { closeDatabase, getDb, initDatabase, createWebSession } from '../../../../src/db';
import { getWebSession, revokeUserWebSession } from '../../../../src/db/web-sessions';
function deleteWebSession(token: string) { const session = getWebSession(token); if (session?.session_id) revokeUserWebSession(session.user_id, session.session_id); }
import { createSingleUserPasskeyHandler } from '../../../../src/channels/web/auth/single-user-passkeys';
import { resetRateLimiterStateForTests } from '../../../../src/channels/web/http/rate-limit';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfigPath } from '../../../../src/core/config-context';
import { createWebauthnEnrollment } from '../../../../src/db/webauthn';
import { handleWebauthnRegisterStart, handleWebauthnRegisterFinish } from '../../../../src/channels/web/auth/webauthn-auth';
import { handlePasskey } from '../../../../src/agent-control/handlers/passkey';
import { handleAgentRoutes } from '../../../../src/channels/web/http/dispatch-agent';
import { WEB_RUNTIME_CONFIG } from '../../../../src/core/config-web';
import { addLogSink, removeLogSink, type LogRecord } from '../../../../src/utils/logger';
const savedConfig = { passkeyMode: WEB_RUNTIME_CONFIG.passkeyMode, totpSecret: WEB_RUNTIME_CONFIG.totpSecret, trustProxy: WEB_RUNTIME_CONFIG.trustProxy };

let restore: () => void, ws: ReturnType<typeof createTempWorkspace>;
let now: number, handler: ReturnType<typeof createSingleUserPasskeyHandler>;
let verify: (value: any) => Promise<any>;
let options: any;
function key(id: string, rp = 'piclaw.test', user = 'default') {
  getDb().query(`INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,created_at,last_used_at,label) VALUES (?,?,?,'test-public',0,'2026-01-01T00:00:00Z',NULL,?)`).run(user, rp, id, id);
}
function request(path = '/agent/passkeys', body?: any, token = 'owner', origin = 'https://piclaw.test') {
  return new Request(`https://piclaw.test${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `piclaw_session=${token}`, Origin: origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const validRegistration = () => ({ verified: true, registrationInfo: { credential: { id: 'new-key', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } } });
beforeEach(async () => {
  ws = createTempWorkspace('passkey-settings-');
  restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '1', PICLAW_WEB_PASSKEY_MODE: 'passkey-only', PICLAW_WEB_TOTP_SECRET: '', PICLAW_TOTP_SECRET: '', PICLAW_WEB_TRUST_PROXY: 'false', PICLAW_ACCESS_MODE: 'single-user' });
  WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only'; WEB_RUNTIME_CONFIG.totpSecret = ''; WEB_RUNTIME_CONFIG.trustProxy = false;
  await closeDatabase(); initDatabase(); now = Date.now(); resetRateLimiterStateForTests();
  createWebSession('owner', 'default', 3600, 'passkey');
  createWebSession('second', 'default', 3600, 'passkey'); now = Date.now();
  verify = async () => validRegistration();
  handler = createSingleUserPasskeyHandler({ now: () => now, server: {
    generateRegistrationOptions: async (value: any) => { options = value; return { challenge: 'challenge', ...value } as any; },
    verifyRegistrationResponse: async (value: any) => verify(value),
  } });
});
afterEach(async () => { await closeDatabase(); restore(); Object.assign(WEB_RUNTIME_CONFIG, savedConfig); ws.cleanup(); resetRateLimiterStateForTests(); });

test('lists only owner credentials with names/dates and current-RP availability', async () => {
  key('laptop'); key('backup'); key('wrong-rp', 'old.piclaw.test'); key('other-user', 'piclaw.test', 'other');
  const res = await handler(request()); const data = await res.json();
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(data.passkeys.map((k: any) => k.id)).toEqual(['backup', 'laptop', 'wrong-rp']);
  expect(data.passkeys[0]).toMatchObject({ lastUsedAt: null, name: 'backup', usable: true, removable: true });
  expect(data.passkeys[2].usable).toBe(false); expect(JSON.stringify(data)).not.toContain('test-public');
});

test('rename is trimmed/literal, bounded and does not change credential material', async () => {
  key('laptop');
  const before = getDb().query('SELECT * FROM webauthn_credentials').get() as any;
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name: ' <b>Tablet</b> ' }))).status).toBe(200);
  const after = getDb().query('SELECT * FROM webauthn_credentials').get() as any;
  expect(after).toEqual({ ...before, label: '<b>Tablet</b>' });
  for (const name of ['', ' ', 'x'.repeat(81), 'bad\u0000name']) expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name }))).status).toBe(400);
});

test('removal preserves other keys and existing sessions', async () => {
  key('laptop'); key('backup');
  expect((await handler(request('/agent/passkeys', { action: 'remove', id: 'laptop' }))).status).toBe(200);
  expect(getDb().query('SELECT credential_id FROM webauthn_credentials').all()).toEqual([{ credential_id: 'backup' }]);
  expect((await handler(request())).status).toBe(200);
  const last = await handler(request('/agent/passkeys', { action: 'remove', id: 'backup' }));
  expect(last.status).toBe(409); expect((await last.json()).code).toBe('last_factor');
});

test('simultaneous removals cannot consume both accepted factors', async () => {
  key('laptop'); key('backup');
  const replies = await Promise.all(['laptop', 'backup'].map(id => handler(request('/agent/passkeys', { action: 'remove', id }))));
  expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
  expect(getDb().query('SELECT COUNT(*) AS n FROM webauthn_credentials').get()).toEqual({ n: 1 });
});

test('wrong-RP keys and inactive TOTP never provide fallback', async () => {
  key('laptop'); key('old', 'old.piclaw.test');
  WEB_RUNTIME_CONFIG.totpSecret = 'JBSWY3DPEHPK3PXP';
  const reset = () => { WEB_RUNTIME_CONFIG.totpSecret = ''; };
  try { expect((await handler(request('/agent/passkeys', { action: 'remove', id: 'laptop' }))).status).toBe(409); }
  finally { reset(); }
});

test('accepted configured TOTP provides fallback and policy changes are rechecked', async () => {
  key('laptop');
  WEB_RUNTIME_CONFIG.totpSecret = 'JBSWY3DPEHPK3PXP'; WEB_RUNTIME_CONFIG.passkeyMode = 'totp-fallback';
  const reset = () => { WEB_RUNTIME_CONFIG.totpSecret = ''; WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only'; };
  try {
    expect((await (await handler(request())).json()).passkeys[0].removable).toBe(true);
    WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only';
    const policyReset = () => { WEB_RUNTIME_CONFIG.passkeyMode = 'totp-fallback'; };
    try { expect((await handler(request('/agent/passkeys', { action: 'remove', id: 'laptop' }))).status).toBe(409); }
    finally { policyReset(); }
    expect((await handler(request('/agent/passkeys', { action: 'remove', id: 'laptop' }))).status).toBe(200);
  } finally { reset(); }
});

test('recent authentication is session-bound; GET does not renew it', async () => {
  key('laptop');
  getDb().query('UPDATE web_sessions SET created_at=?').run(new Date(now - 300001).toISOString());
  createWebSession('owner', 'default', 3600, 'passkey'); now = Date.now();
  expect((await (await handler(request(undefined, undefined, 'second'))).json()).recent_auth).toBe(false);
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name: 'Second' }, 'second'))).status).toBe(403);
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name: 'First' }))).status).toBe(200);
});

test('management rejects missing/internal-only/foreign sessions and cross-origin or forged fields', async () => {
  key('laptop'); key('other-user', 'piclaw.test', 'other');
  expect((await handler(request(undefined, undefined, 'missing'))).status).toBe(401);
  expect((await handler(new Request('https://piclaw.test/agent/passkeys', { headers: { 'x-piclaw-internal-secret': 'test' } }))).status).toBe(401);
  expect((await handler(request('/agent/passkeys', { action: 'remove', id: 'laptop' }, 'owner', 'https://evil.test'))).status).toBe(403);
  expect((await handler(request('/agent/passkeys?user_id=other'))).status).toBe(400);
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name: 'x', user_id: 'other' }))).status).toBe(400);
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'other-user', name: 'x' }))).status).toBe(404);
  deleteWebSession('owner'); expect((await handler(request())).status).toBe(401);
});

test('a passkey-only owner registers a second credential without any TOTP/enrolment link', async () => {
  key('laptop');
  const start = await handler(request('/agent/passkeys/register/start', { name: 'Backup key' }));
  expect(start.status).toBe(200); const body = await start.json();
  expect(options.excludeCredentials).toEqual([{ id: 'laptop' }]);
  expect(options.authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'required' });
  verify = async value => { expect(value).toMatchObject({ expectedRPID: 'piclaw.test', expectedOrigin: 'https://piclaw.test', expectedChallenge: 'challenge', requireUserVerification: true }); return validRegistration(); };
  expect((await handler(request('/agent/passkeys/register/finish', { token: body.token, credential: {} }))).status).toBe(200);
  expect(getDb().query('SELECT credential_id,label,last_used_at FROM webauthn_credentials WHERE credential_id=?').get('new-key')).toEqual({ credential_id: 'new-key', label: 'Backup key', last_used_at: null });
  expect((await handler(request('/agent/passkeys/register/finish', { token: body.token, credential: {} }))).status).toBe(403);
});

test('registration rejects other sessions, expiry, duplicate and failed verification', async () => {
  key('new-key');
  const start = async () => (await (await handler(request('/agent/passkeys/register/start', { name: 'Another' }))).json()).token;
  let token = await start();
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }, 'second'))).status).toBe(403);
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }))).status).toBe(409);
  token = await start(); verify = async () => { throw Error('private-proof-error'); };
  const failed = await handler(request('/agent/passkeys/register/finish', { token, credential: {} }));
  expect(failed.status).toBe(400); expect(await failed.text()).not.toContain('private-proof-error');
  token = await start(); now += 300001;
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }))).status).toBe(403);
});

test('revocation while verification waits prevents commit', async () => {
  const token = (await (await handler(request('/agent/passkeys/register/start', { name: 'Backup' }))).json()).token;
  verify = async () => { deleteWebSession('owner'); return validRegistration(); };
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }))).status).toBe(401);
  expect(getDb().query('SELECT COUNT(*) AS n FROM webauthn_credentials').get()).toEqual({ n: 0 });
});

test('real agent-route dispatch wires GET and enforces the service authority', async () => {
  key('laptop'); const req = request(); const res = await handleAgentRoutes({} as any, req, new URL(req.url).pathname, new URL(req.url));
  expect(res?.status).toBe(200); expect((await res!.json()).passkeys).toHaveLength(1);
});

test('missing Origin, auth-disabled access, oversized bodies and family mode fail closed', async () => {
  key('laptop');
  const missingOrigin = new Request('https://piclaw.test/agent/passkeys', { method: 'POST', headers: { cookie: 'piclaw_session=owner' }, body: JSON.stringify({ action: 'remove', id: 'laptop' }) });
  expect((await handler(missingOrigin)).status).toBe(403);
  expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'laptop', name: 'x'.repeat(70000) }))).status).toBe(413);
  WEB_RUNTIME_CONFIG.passkeyMode = 'totp-fallback'; WEB_RUNTIME_CONFIG.totpSecret = '';
  expect((await handler(request())).status).toBe(401);
  WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only';
  mkdirSync(dirname(getConfigPath()), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ domains: { access: { mode: 'family-shared' } } }));
  expect((await handler(request())).status).toBe(404);
});

test('invalid access configuration fails closed without exposing configuration contents', async () => {
  key('laptop');
  const records: LogRecord[] = [], sink = (record: LogRecord) => { records.push(record); };
  mkdirSync(dirname(getConfigPath()), { recursive: true });
  writeFileSync(getConfigPath(), '{"private-config-marker":');
  addLogSink(sink);
  try {
    const response = await handler(request());
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('private-config-marker');
    const record = records.find(record => record.operation === 'passkey_settings.invalid_access_config');
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain('private-config-marker');
    expect(getDb().query('SELECT credential_id FROM webauthn_credentials').all()).toEqual([{ credential_id: 'laptop' }]);
  } finally { removeLogSink(sink); }
});

test('legacy links and slash commands cannot enrol or remove credentials outside Settings', async () => {
  key('laptop'); const enrolment = createWebauthnEnrollment();
  const ctx = { accessMode: 'single-user', json: Response.json, isPasskeyEnabled: () => true } as any;
  expect((await handleWebauthnRegisterStart(request('/auth/webauthn/register/start', { token: enrolment.token }), ctx)).status).toBe(410);
  expect((await handleWebauthnRegisterFinish(request('/auth/webauthn/register/finish', { token: enrolment.token, credential: {} }), ctx)).status).toBe(410);
  expect((await handlePasskey({} as any, { type: 'passkey', action: 'delete', target: 'laptop' } as any)).status).toBe('error');
  expect(getDb().query('SELECT credential_id FROM webauthn_credentials').all()).toEqual([{ credential_id: 'laptop' }]);
});

test('first enrolment from accepted TOTP and wrong-origin finish', async () => {
  WEB_RUNTIME_CONFIG.passkeyMode = 'totp-fallback'; WEB_RUNTIME_CONFIG.totpSecret = 'JBSWY3DPEHPK3PXP';
  createWebSession('owner', 'default', 3600, 'totp'); now = Date.now();
  const start = await handler(request('/agent/passkeys/register/start', { name: 'First' }));
  expect(start.status).toBe(200); const { token } = await start.json();
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }, 'owner', 'https://evil.test'))).status).toBe(403);
  expect((await handler(request('/agent/passkeys/register/finish', { token, credential: {} }))).status).toBe(200);
});

test('file-backed store reopening preserves credentials and labels', async () => {
  await closeDatabase();
  // Only this owned disposable store; restore the runner memory mode afterward.
  process.env.PICLAW_DB_IN_MEMORY = '0';
  try {
    initDatabase(); createWebSession('owner', 'default', 3600, 'passkey'); now = Date.now(); key('persisted');
    expect((await handler(request('/agent/passkeys', { action: 'rename', id: 'persisted', name: 'Tablet' }))).status).toBe(200);
    await closeDatabase(); initDatabase();
    const data = await (await handler(request())).json();
    expect(data.passkeys).toHaveLength(1); expect(data.passkeys[0]).toMatchObject({ name: 'Tablet', id: 'persisted', lastUsedAt: null });
  } finally { await closeDatabase(); process.env.PICLAW_DB_IN_MEMORY = '1'; }
}, 20_000);
