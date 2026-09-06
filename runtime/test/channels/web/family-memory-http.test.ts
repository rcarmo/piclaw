import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv, waitFor } from '../../helpers.js';
import { closeDatabase, getDb, initDatabase } from '../../../src/db/connection.js';
import { createWebSession } from '../../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../../src/db/account-administration.js';
import { getUser } from '../../../src/db/users.js';
import { storeMessageInDatabase } from '../../../src/db/messages.js';
import { createOwnedRoot, archiveOwnedSession } from '../../../src/db/owned-session-lifecycle.js';
import { previewOwnFamilyMemorySource, publishOwnFamilyMemory, listOwnFamilyMemoryPublications } from '../../../src/db/family-memory.js';
import { RequestRouterService } from '../../../src/channels/web/request-router-service.js';
import { getTimelineResponse } from '../../../src/channels/web/timeline-service.js';
import { WebAuthGateway } from '../../../src/channels/web/auth/auth-gateway.js';
import { WebauthnChallengeTracker } from '../../../src/channels/web/auth/webauthn-challenges.js';
import { TotpFailureTracker } from '../../../src/channels/web/auth/totp-failure-tracker.js';
import { resetRateLimiterStateForTests } from '../../../src/channels/web/http/rate-limit.js';
import { withExecutionIdentity, type ExecutionIdentity } from '../../../src/core/execution-context.js';
import type { AuthenticatedPrincipal } from '../../../src/core/access-types.js';

let ws: ReturnType<typeof createTempWorkspace>, restore: () => void, config: string;
let admin: AuthenticatedPrincipal, alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let r: RequestRouterService;
const base = '/agent/family-memory';
function actor(id: string): AuthenticatedPrincipal {
  const user = getUser(getDb(), id)!, session = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return { kind: 'user', mode: 'family-shared', userId: id, username: user.username, displayName: user.display_name, role: user.role,
    homeChatJid: user.home_chat_jid, authentication: { method: 'passkey', sessionId: session.session_id!, expiresAt: session.expires_at } };
}
function mode(name: string) { writeFileSync(config, JSON.stringify({ domains: { access: { mode: name } } })); }
beforeEach(() => {
  ws = createTempWorkspace('memory-http-'); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, '.piclaw')); config = join(ws.workspace, '.piclaw/config.json'); mode('family-shared');
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests(); admin = actor('default');
  [alice, bob] = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'family.local' }); return actor(user.id);
  });
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 },
    { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  r = new RequestRouterService({ json, authGateway, clampInt: (v: string | null, fallback: number) => v === null ? fallback : Number(v),
    parseOptionalInt: (v: string | null) => v === null ? null : Number(v) } as any, 'family-shared');
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); restore(); ws.cleanup(); });
function request(path = base, who = alice, method = 'GET', body?: BodyInit, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request('https://family.local' + path, { method, body, signal, headers: { cookie: `piclaw_session=token-${who.userId}`, origin: 'https://family.local',
    'content-type': 'application/json', 'x-piclaw-account-id': who.userId, 'x-piclaw-login-id': who.authentication.sessionId!, ...headers } });
}
function post(path: string, body: unknown, who = alice, headers: Record<string, string> = {}) {
  return r.handle(request(path, who, 'POST', JSON.stringify(body), headers));
}
function source(who = alice, text = 'private prefix\nshared fact\nprivate suffix', chat = who.homeChatJid!) {
  const id = randomUUID(), row = storeMessageInDatabase(getDb(), { id, chat_jid: chat, sender: 'Smith', sender_name: 'Smith', content: text, timestamp: new Date().toISOString(), is_bot_message: true })!;
  return { chat_jid: chat, message_rowid: row, message_id: id };
}
function prepared(who = alice, text = 'shared fact') {
  const selected = source(who, 'private prefix\n' + text + '\nprivate suffix');
  const preview = previewOwnFamilyMemorySource(getDb(), who, selected);
  return { ...selected, source_hash: preview.source_hash, request_id: randomUUID(), text, confirm: true } as const;
}
function stored(who = alice) { const input = prepared(who); return { input, ...publishOwnFamilyMemory(getDb(), who, input) }; }
function count(table = 'family_memory_publications') { return (getDb().query(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n; }
function snapshot() { return JSON.stringify(['messages', 'messages_fts', 'chat_cursors', 'family_workspace_files', 'family_workspace_fts', 'scheduled_tasks', 'access_state'].map(t => getDb().query(`SELECT * FROM ${t}`).all())); }

test('HTTP preview publish own receipt shared projection and withdrawal work without other side effects', async () => {
  const selected = source(), before = snapshot(), preview = await post(base + '/preview', selected);
  expect(preview.status).toBe(200); const value = await preview.json(); expect(value.text).toContain('private prefix'); expect(count()).toBe(0);
  const input = { ...selected, source_hash: value.source_hash, request_id: randomUUID(), text: 'shared fact', confirm: true };
  const first = await post(base, input); expect(first.status).toBe(201); const result = await first.json();
  expect(result).toEqual({ publication_id: expect.any(String), request_id: input.request_id, created: true });
  const retry = await post(base, input); expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ ...result, created: false });
  const own = await r.handle(request(base + '/own')); expect(await own.json()).toMatchObject({ owner_user_id: alice.userId, window_size: 100, items: [{ publication_id: result.publication_id, request_id: input.request_id, withdrawn: false }] });
  const receipt = await r.handle(request(base + '/' + result.publication_id)); expect(await receipt.json()).toMatchObject({ text: input.text, source: { ...selected, source_hash: input.source_hash } });
  const shared = await r.handle(request(base + '/shared', bob)), sharedText = await shared.text(); expect(sharedText).toContain('shared fact'); expect(sharedText).toContain(alice.userId);
  for (const hidden of [selected.chat_jid, selected.message_id, input.source_hash, input.request_id, alice.authentication.sessionId!, 'private prefix', 'private suffix']) expect(sharedText).not.toContain(hidden);
  for (const response of [first, own, receipt, shared]) { expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie'); }
  const withdrawn = await post(`${base}/${result.publication_id}/withdraw`, { confirm: true }); expect(withdrawn.status).toBe(201);
  expect((await post(`${base}/${result.publication_id}/withdraw`, { confirm: true })).status).toBe(200);
  expect((await (await r.handle(request(base + '/shared', bob))).json()).items).toEqual([]); expect((await post(base, input)).status).toBe(403);
  expect(snapshot()).toBe(before);
});

test('only authorised family timeline exposes exact stable preview source references without publishing',async()=>{
  const selected=source(),foreign=source(bob),large=source(alice,'x'.repeat(102401));
  const response=await r.handle(request('/timeline?chat_jid='+encodeURIComponent(alice.homeChatJid!)));expect(response.status).toBe(200);
  const value=await response.json();expect(value.posts.find((p:any)=>p.id===selected.message_rowid).memory_source).toEqual(selected);
  expect(value.posts.find((p:any)=>p.id===large.message_rowid).memory_source).toBeUndefined();expect(JSON.stringify(value)).not.toContain(foreign.message_id);
  for(const who of [bob,admin])expect((await r.handle(request('/timeline?chat_jid='+encodeURIComponent(alice.homeChatJid!),who))).status).toBe(403);
  const preview=await post(base+'/preview',value.posts.find((p:any)=>p.id===selected.message_rowid).memory_source);expect(preview.status).toBe(200);expect(count()).toBe(0);
  expect(JSON.stringify(getTimelineResponse(alice.homeChatJid!,100))).not.toContain('memory_source');
});

test('owner history is complete bounded metadata only including withdrawn and archived sources', async () => {
  const db = getDb(), first = stored(), other = stored(bob), ids = [first.publication_id];
  for (let i = 0; i < 99; i++) ids.push(publishOwnFamilyMemory(db, alice, { ...first.input, request_id: randomUUID() }).publication_id);
  await post(`${base}/${ids[0]}/withdraw`, { confirm: true }); db.query('DELETE FROM messages WHERE rowid=?').run(first.input.message_rowid);
  const list = listOwnFamilyMemoryPublications(db, alice), text = JSON.stringify(list); expect(list.items).toHaveLength(100); expect(list.items.some(v => v.withdrawn)).toBe(true);
  expect(list.items.map(v => v.publication_id)).toEqual((db.query('SELECT publication_id FROM family_memory_publications WHERE owner_user_id=? ORDER BY published_at DESC,publication_id DESC').all(alice.userId) as any[]).map(v => v.publication_id));
  for (const secret of [other.publication_id, bob.userId, first.input.chat_jid, first.input.message_id, first.input.source_hash, first.input.text, alice.authentication.sessionId!]) expect(text).not.toContain(secret);
  expect((await (await r.handle(request(base + '/own', admin))).json()).items).toEqual([]);
  const inspected = await r.handle(request(`${base}/${first.publication_id}`)); expect(inspected.status).toBe(200); expect((await inspected.json()).withdrawn).toBe(true);
});

test('missing/stale pins and unauthenticated or foreign owners cannot read private receipts or publish', async () => {
  const row = stored(), privatePath = `${base}/${row.publication_id}`;
  for (const path of [privatePath, base + '/own', base + '/shared']) {
    const missing = request(path); missing.headers.delete('x-piclaw-account-id'); missing.headers.delete('x-piclaw-login-id'); expect((await r.handle(missing)).status).toBe(403);
    const partial = request(path); partial.headers.delete('x-piclaw-login-id'); expect((await r.handle(partial)).status).toBe(409);
    expect((await r.handle(request(path, alice, 'GET', undefined, { 'x-piclaw-account-id': bob.userId }))).status).toBe(409);
    expect((await r.handle(request(path, alice, 'GET', undefined, { cookie: '', 'x-internal-secret': 'fake' }))).status).toBe(401);
  }
  for (const who of [bob, admin]) {
    expect((await r.handle(request(privatePath, who))).status).toBe(403); expect((await post(base, row.input, who)).status).toBe(403);
    expect((await post(privatePath + '/withdraw', { confirm: true }, who)).status).toBe(403);
    expect((await post(base + '/preview', { chat_jid: row.input.chat_jid, message_id: row.input.message_id, message_rowid: row.input.message_rowid }, who)).status).toBe(403);
  }
});

test('exact route method input Origin JSON type and encoding constraints reject before mutation', async () => {
  const input = prepared(), row = stored(), before = count();
  for (const path of [base + '?owner=alice', base + '/own?limit=100', base + '/shared?x=1', base + '/', base + '/other', base + '/own/extra', `${base}/${row.publication_id}/publish`]) expect((await post(path, input)).status).toBe(403);
  for (const path of [base, base + '/preview', `${base}/${row.publication_id}/withdraw`]) expect((await r.handle(request(path))).status).toBe(403);
  for (const method of ['PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) expect((await r.handle(request(base, alice, method))).status).toBe(403);
  for (const headers of [{origin:''},{origin:'null'},{origin:'https://foreign.local'},{'content-type':'text/plain'},{'content-type':''}]) expect((await post(base,input,alice,headers)).status).toBe(403);
  for (const value of [null, [], {}, { ...input, confirm: false }, { ...input, owner: bob.userId }, { ...input, text: 'new summary' }]) expect((await post(base,value)).status).toBe(403);
  expect((await r.handle(request(base,alice,'POST',new Uint8Array([0xff])))).status).toBe(403);
  expect((await r.handle(request(base,alice,'POST','bad json'))).status).toBe(403); expect(count()).toBe(before);
});

test('body byte limits allow escaped 16KiB excerpt but reject overflow and malformed preview/withdrawal shapes', async () => {
  const input=prepared(alice,'\t'.repeat(16380)+'fact'); const encoded=JSON.stringify(input); expect(encoded.length).toBeGreaterThan(16384); expect((await post(base,input)).status).toBe(201);
  const id=(await (await r.handle(request(base+'/own'))).json()).items[0].publication_id;
  for(const [path,size] of [[base,131072],[base+'/preview',4096],[`${base}/${id}/withdraw`,1024]] as const){ resetRateLimiterStateForTests(); expect((await r.handle(request(path,alice,'POST',' '.repeat(size+1)))).status).toBe(403); }
  expect((await post(base+'/preview',{chat_jid:input.chat_jid,message_id:input.message_id,message_rowid:input.message_rowid,confirm:true})).status).toBe(403);
  for(const value of [{},{confirm:false},{confirm:true,source:'extra'}]) expect((await post(`${base}/${id}/withdraw`,value)).status).toBe(403);
  expect(count('family_memory_withdrawals')).toBe(0);
});

test('recent factor requirement survives awaits; reads allow old valid login but replacement pin cannot authorise writes', async () => {
  const row=stored(), db=getDb(); db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(),alice.authentication.sessionId!);
  expect((await r.handle(request(base+'/own'))).status).toBe(200); expect((await post(base,row.input)).status).toBe(403); expect((await post(`${base}/${row.publication_id}/withdraw`,{confirm:true})).status).toBe(403);
  alice=actor(alice.userId); const old=alice; alice=actor(alice.userId); expect((await post(base,row.input,old)).status).toBe(409);
  expect((await post(base,row.input)).status).toBe(200);
});

test('revocation role disablement source edits and configuration drift during body read deny without publication', async () => {
  const input=prepared(), originalRole=alice.role;
  for(const change of ['logout','role','disabled','source','mode','malformed'] as const){
    alice=actor(alice.userId); resetRateLimiterStateForTests(); let stream!: ReadableStreamDefaultController; let read=false;
    const pending=r.handle(request(base,alice,'POST',new ReadableStream({start(c){stream=c;},pull(){read=true;}})));
    await waitFor(()=>read);await Bun.sleep(5);
    if(change==='logout')getDb().query('DELETE FROM web_sessions WHERE user_id=?').run(alice.userId);
    if(change==='role')getDb().query("UPDATE users SET role='admin' WHERE id=?").run(alice.userId);
    if(change==='disabled')getDb().query('UPDATE users SET enabled=0 WHERE id=?').run(alice.userId);
    if(change==='source')getDb().query("UPDATE messages SET content='changed' WHERE rowid=?").run(input.message_rowid);
    if(change==='mode')mode('single-user');if(change==='malformed')writeFileSync(config,'{bad');
    stream.enqueue(new TextEncoder().encode(JSON.stringify(input)));stream.close();expect((await pending).status).toBe(403);expect(count()).toBe(0);
    mode('family-shared');getDb().query('UPDATE users SET enabled=1,role=? WHERE id=?').run(originalRole,alice.userId);
    if(change==='source')getDb().query("UPDATE messages SET content='private prefix\nshared fact\nprivate suffix' WHERE rowid=?").run(input.message_rowid);
  }
});

test('body timeout abort and stream failure release reader without publication or late writes', async () => {
  const input=prepared(); const controller=new AbortController();controller.abort();expect((await r.handle(request(base,alice,'POST',JSON.stringify(input),{},controller.signal))).status).toBe(403);
  const original=globalThis.setTimeout;let expire:(()=>void)|undefined,cancelled=false;
  const timer=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,ms:number,...args:any[])=>{if(ms===10000){expire=fn;return {unref(){}} as any;}return original(fn,ms,...args);}) as any);
  try{const pending=r.handle(request(base,alice,'POST',new ReadableStream({cancel(){cancelled=true;}})));await waitFor(()=>!!expire);expire!();expect((await pending).status).toBe(403);expect(cancelled).toBe(true);}finally{timer.mockRestore();}
  expect((await r.handle(request(base,alice,'POST',new ReadableStream({pull(c){c.error(new Error('private stream failure'));}})))).status).toBe(403);
  expect(count()).toBe(0);
});

test('workspace store data and database replacement across a body await cannot redirect publication',async()=>{
  for(const field of ['PICLAW_WORKSPACE','PICLAW_STORE','PICLAW_DATA','database'] as const){
    resetRateLimiterStateForTests();const input=prepared();let stream!:ReadableStreamDefaultController;let read=false;
    const pending=r.handle(request(base,alice,'POST',new ReadableStream({start(c){stream=c;},pull(){read=true;}})));await waitFor(()=>read);await Bun.sleep(5);
    const undo=field==='database'?()=>{}:setEnv({[field]:join(ws.workspace,'replacement')});
    try{
      if(field==='database'){closeDatabase();initDatabase();}
      stream.enqueue(new TextEncoder().encode(JSON.stringify(input)));stream.close();expect((await pending).status).toBe(403);expect(count()).toBe(0);
    }finally{undo();}
  }
});

test('observed mode denial survives stream cleanup restoring configuration; replacement login cannot finish old request',async()=>{
  const input=prepared();let stream!:ReadableStreamDefaultController;let read=false,cancelled=false;
  const pending=r.handle(request(base,alice,'POST',new ReadableStream({start(c){stream=c;},pull(){read=true;},cancel(){cancelled=true;mode('family-shared');}})));
  await waitFor(()=>read);await Bun.sleep(5);mode('single-user');stream.enqueue(new TextEncoder().encode(JSON.stringify(input)));
  expect((await pending).status).toBe(403);expect(cancelled).toBe(true);expect(count()).toBe(0);
  read=false;const old=alice;const relogin=r.handle(request(base,old,'POST',new ReadableStream({start(c){stream=c;},pull(){read=true;}})));
  await waitFor(()=>read);await Bun.sleep(5);alice=actor(alice.userId);stream.enqueue(new TextEncoder().encode(JSON.stringify(input)));stream.close();
  expect((await relogin).status).toBe(403);expect(count()).toBe(0);expect((await post(base,input)).status).toBe(201);
});

test('rate budgets are per owner across logins and independent for read preview publish and withdrawal', async () => {
  const row=stored(), selected={chat_jid:row.input.chat_jid,message_id:row.input.message_id,message_rowid:row.input.message_rowid};
  for(let i=0;i<20;i++)expect((await post(base,row.input)).status).toBe(200);
  alice=actor(alice.userId);expect((await post(base,row.input)).status).toBe(429);
  for(let i=0;i<20;i++)expect((await post(base+'/preview',selected)).status).toBe(200);expect((await post(base+'/preview',selected)).status).toBe(429);
  for(let i=0;i<60;i++)expect((await r.handle(request(base+'/own'))).status).toBe(200);expect((await r.handle(request(base+'/shared'))).status).toBe(429);
  expect((await r.handle(request(base+'/shared',bob))).status).toBe(200);
  for(let i=0;i<20;i++)expect([200,201]).toContain((await post(`${base}/${row.publication_id}/withdraw`,{confirm:true})).status);expect((await post(`${base}/${row.publication_id}/withdraw`,{confirm:true})).status).toBe(429);
});

test('publication lost-response retry and withdrawal work after source archival/deletion; storage failures roll back', async () => {
  const db=getDb(), root=createOwnedRoot(db,alice,'memory-http'),selected=source(alice,undefined,root.chat_jid),value=await (await post(base+'/preview',selected)).json();
  const input={...selected,source_hash:value.source_hash,text:'shared fact',request_id:randomUUID(),confirm:true};
  db.exec("CREATE TRIGGER fail_memory_http BEFORE INSERT ON family_memory_publications BEGIN SELECT RAISE(ABORT,'PRIVATE_STORAGE_ERROR'); END");
  const failed=await post(base,input);expect(failed.status).toBe(500);expect(await failed.text()).not.toContain('PRIVATE_STORAGE_ERROR');expect(count()).toBe(0);db.exec('DROP TRIGGER fail_memory_http');
  const first=await (await post(base,input)).json();archiveOwnedSession(db,alice,root.chat_jid);db.query('DELETE FROM messages WHERE rowid=?').run(selected.message_rowid);
  expect((await post(base,input)).status).toBe(200);expect((await post(base,{...input,request_id:randomUUID()})).status).toBe(403);
  expect((await r.handle(request(`${base}/${first.publication_id}`))).status).toBe(200);
  db.exec("CREATE TRIGGER fail_withdraw_http BEFORE INSERT ON family_memory_withdrawals BEGIN SELECT RAISE(ABORT,'PRIVATE_STORAGE_ERROR'); END");
  expect((await post(`${base}/${first.publication_id}/withdraw`,{confirm:true})).status).toBe(500);expect(count('family_memory_withdrawals')).toBe(0);db.exec('DROP TRIGGER fail_withdraw_http');
  expect((await post(`${base}/${first.publication_id}/withdraw`,{confirm:true})).status).toBe(201);
});

test('family mode and control-plane-only boundary deny model identities and preserve single-user gate',async()=>{
  const row=stored();
  for(const kind of ['interactive','scheduled','dream','delegate','side-prompt','followup'] as const){await withExecutionIdentity({mode:'family-shared',provenance:{kind}} as ExecutionIdentity,async()=>{
    expect((await r.handle(request(base+'/own'))).status).toBe(403);expect((await post(base,row.input)).status).toBe(403);
    expect(()=>listOwnFamilyMemoryPublications(getDb(),alice)).toThrow();
  });}
  for(const name of ['single-user','isolated-containers','invalid']){mode(name);expect((await r.handle(request(base+'/shared'))).status).toBe(403);}mode('family-shared');
  expect(getDb().query('SELECT activated_mode FROM access_state').get()).toEqual({activated_mode:'single-user'});
});
