import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import { expect, spyOn } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { nativeGoalFixture } from './src/native-goal-default-fixture.js';
import type { NativeDreamRequest } from '../../runtime/src/agent-pool/contracts.js';
import { HostConversationRuntime } from '../../runtime/durable-engine/src/host-runtime.js';
import { Harness, type SubmissionDraft } from '../../runtime/durable-engine/qualification/durable.ts';
import type { Context } from '../../runtime/durable-engine/qualification/context.ts';
const applicationTest = isolatedApplicationTest(import.meta.url);
const barrier = () => { const p = Promise.withResolvers<void>(); return { promise: p.promise, release: () => p.resolve() }; };

applicationTest('actual Dream retains source-bound tools, private history and no-replay after A2A retirement', async () => {
  const proof = join(process.env.PICLAW_WORKSPACE!, 'dream-private-proof.md');
  const f = await nativeGoalFixture(false, false, attempt => attempt === 1
    ? [{ type: 'toolCall', id: 'dream-proof-write', name: 'write', arguments: { path: proof, content: 'Private Dream source proof' } }]
    : [{ type: 'text', text: 'Private Dream completed' }]);
  const legacy = (['submit', 'wait', 'settle', 'reconcile'] as const).map(method => spyOn(HostConversationRuntime.prototype, method).mockImplementation(() => { throw Error('Dream must not use host lifecycle: ' + method); }));
  try {
    installHistoricalExpenseFixture(f.root);
    f.root.query("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES('retired-a2a-finance','operation:retired','background','paused','2026-01-01','2026-01-01')").run();
    f.root.query("INSERT INTO budget_caps(id,scope,metric,amount,work_id,created_at,updated_at) VALUES('retired-a2a-cap','task','api_usd_micros',0,'retired-a2a-finance','2026-01-01','2026-01-01')").run();
    f.root.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at) VALUES('retired-a2a-hold','retired-a2a-finance','operation:retired','fixture','unpriced','opaque-old-account',?,'unresolved','2026-01-01','2026-01-01')").run('a'.repeat(64));
    f.root.query(`INSERT INTO addon_operations(id,addon_id,principal_id,idempotency_key,input_hash,target,text,input_bytes,grant_json,chat_jid,work_id,status,sequence,created_at,updated_at,output,reason)
      VALUES('retired-a2a-task','a2a','old-caller','old-key',?,'old-agent','historical input',16,'{}','operation:retired','retired-a2a-finance','working',1,'2026-01-01','2026-01-01',NULL,'historical')`).run('b'.repeat(64));
    f.root.query("INSERT INTO addon_operation_events(operation_id,sequence,snapshot_json) VALUES('retired-a2a-task',1,?)").run('{"status":"working","historical":true}');
    const tables = ['addon_operations', 'addon_operation_events', ...(f.root.query("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'budget_%' ORDER BY name").all() as { name: string }[]).map(row => row.name)];
    const history = () => tables.map(table => f.root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const original = history();
    await f.reopen(); expect(history()).toEqual(original); expect(f.calls()).toBe(0);
    const parent = await f.pool.getSessionTreeSummaryForChat('web:default');
    const request: NativeDreamRequest = {
      invocationId: '00000000-0000-4000-8000-000000000033', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(),
      assertCurrent() { expect(this).toBe(request); },
    };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([f.entered.promise, running.then(result => { throw Error('Dream finished before model entry: ' + String(result.error)); })]);
    f.held.release(); const result = await running;
    expect(result.error).toBeNull(); expect(result.value).toMatchObject({ status: 'success', result: 'Private Dream completed' });
    expect(readFileSync(proof, 'utf8')).toBe('Private Dream source proof'); expect(f.calls()).toBe(2);
    expect(await f.pool.getSessionTreeSummaryForChat('web:default')).toEqual(parent);
    expect(f.root.query("SELECT * FROM messages WHERE chat_jid='web:default'").all()).toEqual([]);
    expect(history()).toEqual(original);
    const ownership = {
      hostOperations: f.root.query("SELECT count(*) n FROM service_effect_s01_operations WHERE chat_jid LIKE 'dream:%'").get(),
      hostTerminals: f.root.query("SELECT count(*) n FROM service_effect_s02_commits WHERE chat_jid LIKE 'dream:%'").get(),
      hostMessages: f.root.query("SELECT count(*) n FROM messages WHERE chat_jid LIKE 'dream:%'").get(),
      hostChats: f.root.query("SELECT count(*) n FROM chats WHERE jid LIKE 'dream:%'").get(),
      hostBindings: f.root.query("SELECT count(*) n FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").get(),
    };
    expect(ownership).toEqual({hostOperations:{n:0},hostTerminals:{n:0},hostMessages:{n:0},hostChats:{n:0},hostBindings:{n:0}});
    for (const method of legacy) expect(method).not.toHaveBeenCalled();
    console.log(JSON.stringify({ kind: 'dream-direct-sdk', ...ownership }));
    const sdk = ['entries', 'submissions'].map(table => f.root.query(`SELECT * FROM ${table} ORDER BY id`).all());
    await f.reopen(); expect(f.calls()).toBe(2); expect(history()).toEqual(original);
    expect(['entries', 'submissions'].map(table => f.root.query(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(sdk);
  } finally { for (const method of legacy) method.mockRestore(); await f.close(); }
}, 30000);

for (const revocation of ['caller', 'model'] as const) applicationTest(`actual Dream ${revocation} revocation across credential preparation prevents provider execution`, async () => {
  const entered = barrier(), released = barrier(); let armed = false, waited = false, valid = true;
  const f = await nativeGoalFixture(false, false, undefined, undefined, async () => {
    if (armed && !waited) { waited = true; entered.release(); await released.promise; }
  });
  const physical = f.modelRuntime.getPhysicalModel.bind(f.modelRuntime);
  const modelGuard = spyOn(f.modelRuntime, 'getPhysicalModel').mockImplementation((...args) => revocation === 'model' && !valid ? undefined : physical(...args));
  try {
    armed = true; f.held.release();
    const request: NativeDreamRequest = {
      invocationId: '00000000-0000-4000-8000-000000000034', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(),
      assertCurrent() { if (revocation === 'caller' && !valid) throw Error('Original Dream caller revoked'); },
    };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([entered.promise, running.then(result => { throw Error('Credential boundary not reached: ' + String(result.error)); })]);
    valid = false; released.release(); const result = await running;
    if (result.value) expect(result.value.status).toBe('error'); else expect(result.error).toBeInstanceOf(Error);
    expect(f.calls()).toBe(0);
  } finally { released.release(); modelGuard.mockRestore(); await f.close(); }
}, 30000);

applicationTest('Dream deadline aborts and joins its exact SDK scope without host cancellation or settlement', async () => {
  const f = await nativeGoalFixture();
  try {
    const request: NativeDreamRequest = { invocationId: '00000000-0000-4000-8000-000000000035', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 1500, acceptedAt: new Date().toISOString(), assertCurrent() {} };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([f.entered.promise, running.then(result => { throw Error('Dream did not enter its held SDK model: ' + String(result.error)); })]);
    await f.until(() => f.root.query("SELECT 1 FROM tasks WHERE abort_requested=1 LIMIT 1").get() !== null);
    expect(f.calls()).toBe(1); f.held.release(); const result = await running;
    if (result.value) expect(result.value).toMatchObject({ status: 'error', failureCategory: 'timeout' }); else expect(result.error).toBeInstanceOf(Error);
    expect(f.root.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);
    expect(f.root.query("SELECT * FROM service_effect_s01_operations WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
    expect(f.root.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
    expect(f.calls()).toBe(1);
  } finally { await f.close(); }
}, 30000);

applicationTest('Dream caller lease stays held until the actual SDK model joins shutdown', async () => {
  const f = await nativeGoalFixture(); let leased = true, finished = false, closed = false;
  try {
    const request: NativeDreamRequest = { invocationId: '00000000-0000-4000-8000-000000000036', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(), assertCurrent() { if (!leased) throw Error('Dream lease released'); } };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { leased = false; finished = true; });
    await Promise.race([f.entered.promise, running.then(result => { throw Error('Dream did not enter SDK model: ' + String(result.error)); })]);
    const closing = f.backend.close().then(() => { closed = true; }); await Bun.sleep(30);
    expect(leased).toBe(true); expect(finished).toBe(false); expect(closed).toBe(false);
    f.held.release(); await closing; await running;
    expect(closed).toBe(true); expect(leased).toBe(false); expect(f.calls()).toBe(1);
    expect(f.root.query("SELECT * FROM service_effect_s01_operations WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
  } finally { f.held.release(); await f.close(); }
}, 30000);

applicationTest('legacy side-source admission can progress alongside SDK-only Dream without adopting its work', async () => {
  const f = await nativeGoalFixture();
  try {
    expect((await f.pool.applyControlCommand('web:default', { type: 'new_session', raw: '/new-session' })).status).toBe('success');
    const request: NativeDreamRequest = { invocationId: '00000000-0000-4000-8000-000000000037', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(), assertCurrent() {} };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([f.entered.promise, running.then(result => { throw Error('Dream did not enter its SDK model: ' + String(result.error)); })]);
    const side = await f.pool.runSidePrompt('web:default', 'Independent side source during Dream', { requestId: 'side-alongside-direct-dream' });
    expect(side.status, JSON.stringify(side)).toBe('success'); expect(f.calls()).toBe(2);
    f.held.release(); const result = await running; expect(result.error).toBeNull(); expect(result.value?.status).toBe('success');
    expect(f.root.query("SELECT * FROM service_effect_s01_operations WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
    expect(f.root.query("SELECT * FROM service_effect_s02_commits WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
  } finally { f.held.release(); await f.close(); }
}, 30000);

for (const fault of ['submit-return', 'wait-return'] as const) applicationTest(`Dream re-observes ${fault} through the same actual SDK submission without cancellation or replay`, async () => {
  const open = Harness.open.bind(Harness); let submits = 0, injected = false;
  const opening = spyOn(Harness, 'open').mockImplementation(async (...args) => {
    const harness = await open(...args);
    return new Proxy(harness, { get(target, property) {
      if (property === 'conversation') return async (...parameters: Parameters<typeof harness.conversation>) => {
        const conversation = await target.conversation(...parameters); if (!conversation) return conversation;
        return new Proxy(conversation, { get(actual, key) {
          if (key === 'submit') return async (draft: SubmissionDraft, context: Context) => {
            const submission = await actual.submit(draft, context);
            if (draft.type !== 'input' || draft.entry?.kind !== 'app.dream-input') return submission;
            submits++;
            if (fault === 'submit-return' && !injected) { injected = true; throw Error('Synthetic loss after confirmed SDK admission'); }
            return new Proxy(submission, { get(handle, member) {
              if (member === 'wait') return async (...waiting: Parameters<typeof submission.wait>) => {
                const result = await handle.wait(...waiting);
                if (!injected) { injected = true; throw Error('Synthetic loss after confirmed SDK completion'); }
                return result;
              };
              const value = Reflect.get(handle, member); return typeof value === 'function' ? value.bind(handle) : value;
            } });
          };
          const value = Reflect.get(actual, key); return typeof value === 'function' ? value.bind(actual) : value;
        } });
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  let f: Awaited<ReturnType<typeof nativeGoalFixture>> | undefined;
  try {
    f = await nativeGoalFixture();
    const request: NativeDreamRequest = { invocationId: fault === 'submit-return' ? '00000000-0000-4000-8000-000000000038' : '00000000-0000-4000-8000-000000000039',
      chatJid: 'web:default', mode: 'manual', days: 1, model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(), assertCurrent() {} };
    const running = f.pool.dispatchDreamOperation(request).then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([f.entered.promise, running.then(result => { throw Error('SDK model was not reached: ' + String(result.error)); })]);
    f.held.release(); const result = await running;
    expect(result.error).toBeNull(); expect(result.value).toMatchObject({ status: 'success', result: 'Ordinary native reply' });
    expect(injected).toBe(true); expect(submits).toBe(1); expect(f.calls()).toBe(1);
    expect(f.root.query("SELECT id FROM submissions WHERE status<>'done'").all()).toEqual([]);
    expect(f.root.query("SELECT * FROM service_effect_s01_operations WHERE chat_jid LIKE 'dream:%'").all()).toEqual([]);
    const before = f.root.query('SELECT * FROM submissions ORDER BY id').all();
    await f.reopen(); expect(f.calls()).toBe(1); expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(before);
  } finally { if (f) await f.close(); opening.mockRestore(); }
}, 30000);

applicationTest('Dream automatic compaction retains its exact SDK task and input provenance without host maintenance ownership', async () => {
  let enabled = false; const open = Harness.open;
  const settings = spyOn(Harness, 'open').mockImplementation((storage, options, context) => open.call(Harness, storage, { ...options, settings: () => {
    const current = typeof options.settings === 'function' ? options.settings() : options.settings;
    return { ...current, compaction: { ...current?.compaction, enabled, keepRecentTokens: 1, reserveTokens: 99999, backgroundTokens: 0 } };
  } }, context));
  const path = join(process.env.PICLAW_WORKSPACE!, 'dream-compaction-source.md'); writeFileSync(path, 'Source-bound Dream fact. '.repeat(400));
  const f = await nativeGoalFixture(false, false, attempt => {
    if (attempt === 1) { enabled = true; return [{ type: 'toolCall', id: 'dream-compaction-read', name: 'read', arguments: { path } }]; }
    enabled = false; return [{ type: 'text', text: 'Dream summary and terminal preserve the source-bound fact' }];
  });
  const qualify = HostConversationRuntime.prototype.qualifyDreamSource; let compactions = 0;
  const source = spyOn(HostConversationRuntime.prototype, 'qualifyDreamSource').mockImplementation(async function(this: HostConversationRuntime, ...args) {
    const result = await qualify.apply(this, args); if (args[2].taskKind === 'pi.compaction') compactions++; return result;
  });
  try {
    const running = f.pool.dispatchDreamOperation({ invocationId: '00000000-0000-4000-8000-000000000042', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${f.model.provider}/${f.model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(), assertCurrent() {} });
    const caught = running.then(value => ({ value, error: null }), error => ({ value: null, error }));
    await Promise.race([f.entered.promise, caught.then(result => { throw Error('Dream model not reached: ' + String(result.error)); })]);
    f.held.release(); const result = await caught; expect(result.error).toBeNull(); expect(result.value?.status).toBe('success');
    expect(compactions).toBeGreaterThan(0);
    const tasks = f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.compaction')").all() as { record: string }[];
    expect(tasks).toHaveLength(1); expect(JSON.parse(tasks[0]!.record)).toMatchObject({ input: { reason: 'threshold' }, state: { status: 'terminal', outcome: { status: 'completed' } } });
    for (const table of ['service_effect_s01_operations', 'service_effect_s02_commits']) expect(table.startsWith('budget_') ? historicalExpenseRows(f.root,[table])[0] : f.root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
  } finally { source.mockRestore(); settings.mockRestore(); await f.close(); }
}, 30000);
