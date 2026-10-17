/** Actual scheduler/queue/AgentPool/SDK session; deterministic credential-free provider. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { ModelRuntime, ModelRegistry, SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Provider } from '@earendil-works/pi-ai';
import { AgentPool } from '../../src/agent-pool.js';
import { createSessionInDir } from '../../src/agent-pool/session.js';
import { createTestCredentialStore } from '../model-services-fixture.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { createTask, getTaskById, getTaskRunLogs } from '../../src/db/tasks.js';
import { AgentQueue } from '../../src/queue.js';
import { startSchedulerLoop, stopSchedulerLoop, resetSchedulerMetricsForTests, getSchedulerMetrics } from '../../src/task-scheduler.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const root = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(root, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, '0');
const guard = (globalThis as any).__ADMISSION_ENFORCEMENT__ as { networkAttempts: number; childProcessAttempts: number };
assert(guard, 'Offline guard preload required');
mkdirSync(join(root, '.piclaw'), { recursive: true });
writeFileSync(join(root, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }), { mode: 0o600 });
initDatabase();
const credentials = createTestCredentialStore();
const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: null, allowModelNetwork: false, refreshOnCreate: false });
const model: Model<'openai-completions'> = { id: 'scheduled-v1', provider: 'synthetic-scheduler-local', name: 'Synthetic scheduler', api: 'openai-completions', baseUrl: 'https://unused.invalid', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
let providerCalls = 0;
const stream = () => {
  providerCalls++; assert(providerCalls <= 6, 'Unexpected provider continuation');
  const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text', text: 'Synthetic scheduler response ' + providerCalls }], timestamp: Date.now(), stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const events = createAssistantMessageEventStream(); events.push({ type: 'done', reason: 'stop', message }); return events;
};
const provider: Provider = { id: model.provider, name: 'Synthetic scheduler', getModels: () => [model], auth: { apiKey: { name: 'No credential', resolve: async () => ({ auth: {}, source: 'synthetic' }) } }, stream, streamSimple: stream };
runtime.registerNativeProvider(provider); await runtime.refresh({ allowNetwork: false });
const settings = SettingsManager.inMemory({ defaultProvider: model.provider, defaultModel: model.id, defaultThinkingLevel: 'off', compaction: { enabled: false }, retry: { enabled: false } });
const pool = new AgentPool({ credentialStore: credentials, modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime), createSession: (chatJid, sessionDir) => createSessionInDir(sessionDir, { chatJid, modelRuntime: runtime, settingsManager: settings, tools: [] }) });
const queue = new AgentQueue(), deliveries: Array<{ jid: string; text: string }> = [];
const chat = 'web:synthetic-real-scheduler', prompt = 'Synthetic scheduled branch fixture';
const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();
const start = performance.now(), cpu = process.cpuUsage();
try {
  const baseline = await pool.runAgent('Synthetic baseline conversation', chat, { timeoutMs: 0 });
  assert.equal(baseline.status, 'success', JSON.stringify(baseline));
  const before = await pool.getSessionTreeSummaryForChat(chat); assert(before?.leafId);
  const due = new Date(Date.now() - 60000).toISOString();
  createTask({ id: 'real-agent-task', chat_jid: chat, prompt, schedule_type: 'interval', schedule_value: '3600000', next_run: due, status: 'active', notify_on_complete: false, created_at: due });
  resetSchedulerMetricsForTests();
  startSchedulerLoop({ queue, agentPool: pool, sendMessage: async (jid, text) => { deliveries.push({ jid, text }); } });
  const deadline = performance.now() + 15000;
  while (queue.getMetrics().succeeded < 1 && queue.getMetrics().failed === 0 && performance.now() < deadline) await Bun.sleep(5);
  await stopSchedulerLoop();
  assert.equal(queue.getMetrics().failed, 0); assert.equal(queue.getMetrics().succeeded, 1);
  const logs = getTaskRunLogs('real-agent-task'); assert.equal(logs.length, 1); assert.equal(logs[0].status, 'success', JSON.stringify(logs));
  assert.equal(providerCalls, 2); assert.equal(deliveries.length, 1); assert.equal(deliveries[0].jid, chat); assert(deliveries[0].text.includes('Synthetic scheduler response 2'));
  const session = await pool.getSessionForIntrospection(chat), after = await pool.getSessionTreeSummaryForChat(chat);
  assert.equal(after?.leafId, before.leafId); assert(after!.total > before.total);
  assert(JSON.stringify(session.sessionManager.getEntries()).includes(prompt)); assert(!JSON.stringify(session.sessionManager.getBranch()).includes(prompt));
  const persisted = SessionManager.open(session.sessionFile!);
  assert(JSON.stringify(persisted.getEntries()).includes(prompt)); assert.equal(persisted.getEntries().length, session.sessionManager.getEntries().length);
  const row = getDb().query("SELECT r.state,r.run_id,r.settled_at,r.next_run_at,s.state AS source_state,o.phase FROM service_effect_s07_occurrences r JOIN service_effect_s01_sources s ON s.source_id=r.run_id JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq WHERE r.task_id='real-agent-task'").get() as any;
  assert(row); assert.equal(row.state, 'completed'); assert.equal(row.source_state, 'consumed'); assert.equal(row.phase, 'terminal');
  assert.equal(row.next_run_at, new Date(Date.parse(row.settled_at) + 3600000).toISOString()); assert.equal(getTaskById('real-agent-task')?.next_run, row.next_run_at);
  assert.deepEqual(getDb().query('PRAGMA quick_check').get(), { quick_check: 'ok' });
  assert.equal(guard.networkAttempts, 0); assert.equal(guard.childProcessAttempts, 0);
  loop.disable();
  console.log(JSON.stringify({ runtime: Bun.version, providerCalls, deliveries: deliveries.length, realAgentPool: true, realSessionConstruction: true, realLeafRestored: true, scheduledBranchPersisted: true, scheduledBranchExcludedFromActiveContext: true, durableSourceSettled: true, recurrenceVerified: true, entriesBefore: before.total, entriesAfter: after!.total, sessionBytes: statSync(session.sessionFile!).size, queue: queue.getMetrics(), scheduler: getSchedulerMetrics(), networkAttempts: guard.networkAttempts, childProcessAttempts: guard.childProcessAttempts, wallMs: performance.now() - start, cpu: process.cpuUsage(cpu), eventLoop: { samples: loop.count, maxMs: loop.max / 1e6, meanMs: loop.mean / 1e6 }, scope: 'Actual scheduler claim/AgentQueue/AgentPool.runAgent/Piclaw session construction/public Pi SDK prompting and leaf navigation over owned disk state. Native synthetic provider emits deterministic zero-cost responses; outbound sink observes delivery only, no live provider/account/transport. No raw auth/provider/account-generation contract qualification.' }));
} finally {
  await stopSchedulerLoop();
  try { await queue.shutdown(); }
  finally {
    try { await pool.shutdown(); }
    finally { runtime.unregisterProvider(model.provider); loop.disable(); closeDatabase(); }
  }
}
