import '../setup-filesystem-isolation.js';
import { expect, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { closeDatabase, getDb, initDatabase, getDatabaseBinding } from '../../src/db/connection.js';
import { createWebSession, getWebSession } from '../../src/db/web-sessions.js';
import { createWebauthnEnrollment, getWebauthnCredentialById, getWebauthnEnrollment, storeWebauthnCredential } from '../../src/db/webauthn.js';
import { WEB_RUNTIME_CONFIG } from '../../src/core/config-web.js';
import { createSingleUserPasskeyHandler } from '../../src/channels/web/auth/single-user-passkeys.js';
import { handleWebauthnLoginFinish, handleWebauthnRegisterFinish, type WebauthnAuthContext } from '../../src/channels/web/auth/webauthn-auth.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, blocker: Database;
const cases: { name: string; run: () => Promise<void> }[] = [];
function test(name: string, run: () => Promise<void>) { cases.push({ name, run }); }
const savedConfig = { passkeyMode: WEB_RUNTIME_CONFIG.passkeyMode, totpSecret: WEB_RUNTIME_CONFIG.totpSecret, trustProxy: WEB_RUNTIME_CONFIG.trustProxy };
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = keys.publicKey.export({ format: 'jwk' });
// Same real EC2/P-256 COSE fixture as webauthn-user-login.test.ts.
const cose = Buffer.concat([Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 0x20]), Buffer.from(jwk.x!, 'base64url'), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, 'base64url')]);
const credentialId = Buffer.from('wal-credential').toString('base64url');
const policy = () => getDb().query('PRAGMA busy_timeout').get();
const sessions = () => getDb().query('SELECT * FROM web_sessions ORDER BY token').all();
function request(path: string, body: unknown, signal?: AbortSignal) {
  return new Request(`https://example.com${path}`, { method: 'POST', headers: { origin: 'https://example.com', cookie: 'piclaw_session=owner', 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}
function context(): WebauthnAuthContext {
  return { accessMode: 'family-shared', isPasskeyEnabled: () => true, authoriseEnrolment: () => true, json: (body, status = 200) => Response.json(body, { status }), buildSessionCookie: token => { expect(getDb().inTransaction).toBe(false); expect(getWebSession(token)).not.toBeNull(); return `piclaw_session=${token}`; }, logAuthEvent() {}, getClientKey: () => 'wal-fixture', challenges: new WebauthnChallengeTracker() };
}
function login(ctx: WebauthnAuthContext, signal?: AbortSignal) {
  ctx.challenges.trackLogin('login', { challenge: 'challenge', rpId: 'example.com', origin: 'https://example.com', userId: 'default' });
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'challenge', origin: 'https://example.com' }));
  const auth = Buffer.concat([createHash('sha256').update('example.com').digest(), Buffer.from([5, 0, 0, 0, 1])]);
  const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), keys.privateKey);
  return request('/auth/webauthn/login/finish', { token: 'login', credential: { id: credentialId, rawId: credentialId, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: Buffer.from('default').toString('base64url') } } }, signal);
}
function registration(ctx: WebauthnAuthContext, signal?: AbortSignal) {
  const enrollment = createWebauthnEnrollment();
  ctx.challenges.trackRegistration(enrollment.token, { challenge: 'challenge', rpId: 'example.com', origin: 'https://example.com', userId: 'default' });
  const id = Buffer.from('new-wal-credential');
  const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
  const auth = Buffer.concat([createHash('sha256').update('example.com').digest(), Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16), length, id, cose]);
  // CBOR {fmt:'none', attStmt:{}, authData:bytes} (no attestation signature).
  const authLength = Buffer.alloc(2); authLength.writeUInt16BE(auth.length);
  const attestation = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746159', 'hex'), authLength, auth]);
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: 'challenge', origin: 'https://example.com' }));
  return { token: enrollment.token, id: id.toString('base64url'), req: request('/auth/webauthn/register/finish', { token: enrollment.token, credential: { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), attestationObject: attestation.toString('base64url'), transports: ['internal'] } } }, signal) };
}
async function setup() {
  ws = createTempWorkspace('auth-scheduler-wal-');
  restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_ACCESS_MODE: 'single-user' });
  // Explicitly opt this owned disposable fixture out of helpers' memory mode.
  await closeDatabase();
  process.env.PICLAW_DB_IN_MEMORY = '0'; initDatabase();
  WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only'; WEB_RUNTIME_CONFIG.totpSecret = ''; WEB_RUNTIME_CONFIG.trustProxy = false;
  resetRateLimiterStateForTests();
  createWebSession('owner', 'default', 3600, 'passkey');
  getDb().query("UPDATE users SET home_chat_jid='web:default' WHERE id='default'").run();
  storeWebauthnCredential({ user_id: 'default', rp_id: 'example.com', credential_id: credentialId, public_key: cose.toString('base64url'), sign_count: 0 });
  expect(getDb().query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  const file = getDatabaseBinding()!.path;
  expect(file).toBe(join(ws.store, 'messages.db'));
  blocker = new Database(file);
  expect((blocker.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file).toBe(file);
}
async function cleanup() {
  if (blocker?.inTransaction) blocker.exec('ROLLBACK');
  blocker?.close(); await closeDatabase(); restore(); Object.assign(WEB_RUNTIME_CONFIG, savedConfig); resetRateLimiterStateForTests(); ws.cleanup();
}

for (const outcome of ['commit', 'abort', 'revoke', 'counter-changed'] as const) test(`signed login waits for WAL writer; ${outcome}`, async () => {
  const ctx = context(), aborter = new AbortController();
  let ready!: () => void;
  const verified = new Promise<void>(resolve => { ready = resolve; });
  ctx.randomToken = () => { ready(); return 'issued'; };
  const req = login(ctx, aborter.signal), before = sessions(), previous = policy();
  blocker.exec('BEGIN IMMEDIATE');
  let settled = false;
  const pending = handleWebauthnLoginFinish(req, ctx).then(response => ({ response }), error => ({ error })).finally(() => { settled = true; });
  await verified; await Bun.sleep(10);
  expect(settled).toBe(false); expect(sessions()).toEqual(before); expect(policy()).toEqual(previous);
  expect(getWebauthnCredentialById(credentialId)?.sign_count).toBe(0);
  if (outcome === 'abort') aborter.abort(Error('cancelled'));
  if (outcome === 'revoke') blocker.query("UPDATE users SET enabled=0 WHERE id='default'").run();
  if (outcome === 'counter-changed') blocker.query('UPDATE webauthn_credentials SET sign_count=7 WHERE credential_id=?').run(credentialId);
  blocker.exec('COMMIT');
  const result = await pending;
  if (outcome === 'abort') expect('error' in result && String(result.error)).toContain('cancelled');
  else {
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(outcome === 'commit' ? 200 : 401);
      expect(Boolean(result.response.headers.get('set-cookie'))).toBe(outcome === 'commit');
    }
  }
  expect(getWebauthnCredentialById(credentialId)?.sign_count).toBe(outcome === 'commit' ? 1 : outcome === 'counter-changed' ? 7 : 0);
  expect(sessions().length).toBe(before.length + Number(outcome === 'commit'));
  // Login challenge stays single-use even if acquisition was cancelled/revoked.
  expect((await handleWebauthnLoginFinish(loginReplay(), ctx)).status).toBe(400);
  expect(policy()).toEqual(previous); expect(getDb().inTransaction).toBe(false);
});
function loginReplay() { return request('/auth/webauthn/login/finish', { token: 'login', credential: { id: credentialId } }); }

for (const outcome of ['commit', 'abort', 'revoke', 'duplicate'] as const) test(`registration rechecks enrollment authority/uniqueness after WAL wait; ${outcome}`, async () => {
  const ctx = context(), aborter = new AbortController();
  const fixture = registration(ctx, aborter.signal), previous = policy();
  let ready!: () => void, checks = 0;
  const verified = new Promise<void>(resolve => { ready = resolve; });
  ctx.authoriseEnrolment = () => { if (++checks === 2) ready(); return true; };
  blocker.exec('BEGIN IMMEDIATE');
  let settled = false;
  const pending = handleWebauthnRegisterFinish(fixture.req, ctx).then(response => ({ response }), error => ({ error })).finally(() => { settled = true; });
  await verified; await Bun.sleep(10);
  expect(settled).toBe(false); expect(getWebauthnCredentialById(fixture.id)).toBeNull(); expect(policy()).toEqual(previous);
  if (outcome === 'abort') aborter.abort(Error('cancelled'));
  if (outcome === 'revoke') blocker.query("UPDATE users SET enabled=0 WHERE id='default'").run();
  if (outcome === 'duplicate') blocker.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,created_at) VALUES('default','example.com',?,'other-key',9,CURRENT_TIMESTAMP)").run(fixture.id);
  blocker.exec('COMMIT');
  const result = await pending;
  if (outcome === 'abort') expect('error' in result && String(result.error)).toContain('cancelled');
  else if ('response' in result) expect(result.response.status).toBe(outcome === 'commit' ? 200 : outcome === 'revoke' ? 403 : 409);
  else throw result.error;
  expect(getWebauthnEnrollment(fixture.token) === null).toBe(outcome === 'commit');
  expect(ctx.challenges.getRegistration(fixture.token)).toBeNull();
  expect(getWebauthnCredentialById(fixture.id)?.public_key ?? null).toBe(outcome === 'commit' ? cose.toString('base64url') : outcome === 'duplicate' ? 'other-key' : null);
  expect(policy()).toEqual(previous); expect(getDb().inTransaction).toBe(false);
});

for (const outcome of ['commit', 'abort', 'revoke'] as const) test(`owner rename retains fresh session checks across WAL admission; ${outcome}`, async () => {
  const handler = createSingleUserPasskeyHandler(), aborter = new AbortController();
  const sessionId = getWebSession('owner')!.session_id!;
  const previous = policy(); blocker.exec('BEGIN IMMEDIATE');
  let settled = false;
  const pending = handler(request('/agent/passkeys', { action: 'rename', id: credentialId, name: 'renamed' }, aborter.signal)).finally(() => { settled = true; });
  await Bun.sleep(20); expect(settled).toBe(false); expect(policy()).toEqual(previous);
  if (outcome === 'abort') aborter.abort(Error('cancelled'));
  if (outcome === 'revoke') blocker.query('DELETE FROM web_sessions WHERE session_id=?').run(sessionId);
  blocker.exec('COMMIT');
  const response = await pending;
  expect(response.status).toBe(outcome === 'commit' ? 200 : outcome === 'revoke' ? 401 : 500);
  expect((getDb().query('SELECT label FROM webauthn_credentials WHERE credential_id=?').get(credentialId) as any).label).toBe(outcome === 'commit' ? 'renamed' : '');
  expect(policy()).toEqual(previous);
});

test('owner registration consumes ceremony once while waiting, then denies revoked session', async () => {
  let verifications = 0;
  const handler = createSingleUserPasskeyHandler({ server: {
    generateRegistrationOptions: async () => ({ challenge: 'challenge' }) as any,
    verifyRegistrationResponse: async () => { verifications++; return { verified: true, registrationInfo: { credential: { id: 'new-key', publicKey: cose, counter: 0 } } } as any; },
  } });
  const { token } = await (await handler(request('/agent/passkeys/register/start', { name: 'Backup' }))).json();
  const sessionId = getWebSession('owner')!.session_id!;
  blocker.exec('BEGIN IMMEDIATE');
  const finish = () => request('/agent/passkeys/register/finish', { token, credential: {} });
  const pending = handler(finish());
  await Bun.sleep(20); expect(verifications).toBe(1);
  expect((await handler(finish())).status).toBe(403);
  blocker.query('DELETE FROM web_sessions WHERE session_id=?').run(sessionId); blocker.exec('COMMIT');
  expect((await pending).status).toBe(401); expect(getWebauthnCredentialById('new-key')).toBeNull(); expect(verifications).toBe(1);
});

test('entered login SQL contention is terminal: counter and session roll back together, never replayed', async () => {
  const database = getDb(), prepare = database.prepare.bind(database), previous = policy(), before = sessions();
  let inserts = 0;
  const busy = Object.assign(Error('entered busy'), { code: 'SQLITE_BUSY' });
  const injected = spyOn(database, 'prepare').mockImplementation(((sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes('INSERT OR REPLACE INTO web_sessions')) return statement;
    return { run(...args: any[]) { inserts++; statement.run(...args); throw busy; } };
  }) as typeof database.prepare);
  const ctx = context();
  try { await expect(handleWebauthnLoginFinish(login(ctx), ctx)).rejects.toBe(busy); }
  finally { injected.mockRestore(); }
  expect(inserts).toBe(1); expect(sessions()).toEqual(before); expect(getWebauthnCredentialById(credentialId)?.sign_count).toBe(0);
  expect(database.inTransaction).toBe(false); expect(policy()).toEqual(previous);
});

const batch = Number(process.argv[2]);
if (!Number.isInteger(batch) || batch < 0 || batch > 3) throw Error("Expected WAL case batch 0..3");
const selected = cases.filter((_, index) => index % 4 === batch);
for (const entry of selected) {
  await setup();
  try { await entry.run(); console.log(`PASS ${entry.name}`); }
  finally { await cleanup(); }
}
console.log(JSON.stringify({ kind: 'auth-scheduler-write-admission', cases: selected.length, realWal: true, abortedAndRevokedDenied: true, noCallbackReplay: true }));
