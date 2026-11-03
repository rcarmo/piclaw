import '../setup-filesystem-isolation.js';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ModelRuntime, SettingsManager, SessionManager, DefaultResourceLoader, createAgentSessionFromServices } from '@earendil-works/pi-coding-agent';
import { AgentSessionManager } from '../../src/agent-pool/session-manager.js';
import { AgentPool } from '../../src/agent-pool.js';
import { initDatabase } from '../../src/db.js';
import { createTestCredentialStore } from '../model-services-fixture.js';
import { withTempWorkspaceEnv } from '../helpers.js';

// Actual public session/context reconstruction; synthetic content, no model requests.
const count = Number(process.argv[2] ?? 4), max = Number(process.argv[3] ?? 1), rows = Number(process.argv[4] ?? 1000), rounds = 6;
const fullPool = process.argv[5] === 'full';
await withTempWorkspaceEnv('multi-session-profile-', { PICLAW_ACCESS_MODE: 'single-user', PICLAW_MAIN_SESSION_POOL_MAX_SIZE: String(max) }, async ws => {
  if (fullPool) initDatabase();
  const modelRuntime = await ModelRuntime.create({ credentials: createTestCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: ws.workspace, agentDir: ws.base, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await resourceLoader.reload();
  const paths = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    const dir = join(ws.base, `session-${index}`); mkdirSync(dir);
    const sm = SessionManager.create(ws.workspace, dir);
    for (let row = 0; row < rows; row++) sm.appendMessage({ role: 'user', content: `Synthetic session ${index} row ${row}: ${'fixture '.repeat(160)}`, timestamp: row });
    sm.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic final' }], api: 'openai-completions', provider: 'fixture', model: 'fixture', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 1000 });
    paths.set(`web:profile-${index}`, sm.getSessionFile()!);
  }
  let creates = 0, disposals = 0, parseMs = 0, contextMs = 0, sdkMs = 0, bytesRead = 0;
  const pool = new Map();
  const createSession = async (chatJid: string) => {
      creates++;
      const path = paths.get(chatJid)!; bytesRead += statSync(path).size;
      let at = performance.now(); const sm = SessionManager.open(path); parseMs += performance.now() - at;
      at = performance.now(); const built = await createAgentSessionFromServices({ services: { cwd: ws.workspace, agentDir: ws.base, modelRuntime, settingsManager, resourceLoader, diagnostics: [] }, sessionManager: sm, tools: [], customTools: [] }); sdkMs += performance.now() - at;
      return { session: built.session, dispose: async () => { disposals++; built.session.dispose(); } } as any;
    };
  const manager = new AgentSessionManager({ pool, modelRuntime, settingsManager, mainSessionMaxSize: max, createDefaultTools: () => [], bindSession: async () => {}, createSession, disposePersistence: () => {} });
  const agentPool = fullPool ? new AgentPool({ legacyCapture:true, modelRuntime, credentialStore: createTestCredentialStore(), createSession }) : null;
  const acquire = (chat: string) => agentPool ? (agentPool as any).getOrCreateRuntime(chat) : manager.getOrCreate(chat);
  const delays: number[] = [], requests: number[] = [], outputs = new Set<string>();
  let expected = performance.now() + 5;
  const timer = setInterval(() => { const now = performance.now(); delays.push(Math.max(0, now - expected)); expected = now + 5; }, 5);
  const cpu = process.cpuUsage(), start = performance.now(), startRss = process.memoryUsage.rss();
  try {
    for (let round = 0; round < rounds; round++) for (let index = 0; index < count; index++) {
      const at = performance.now(); const runtime = await acquire(`web:profile-${index}`);
      const projectionAt = performance.now(), context = runtime.session.sessionManager.buildSessionContext(); contextMs += performance.now() - projectionAt;
      if (context.messages.length !== rows + 1) throw Error('Context equivalence failed');
      const digest = createHash('sha256').update(JSON.stringify(context.messages)).digest('hex'); outputs.add(`${index}:${digest}`);
      requests.push(projectionAt - at);
      await Bun.sleep(10);
    }
    const endRss = process.memoryUsage.rss();
    const report = { count, max, rows, rounds, fullPool, retained: agentPool?.getMemoryInstrumentationSnapshot().cachedMainSessions ?? pool.size, requests: requests.length, creates, disposalsBeforeShutdown: disposals, bytesRead, parseMs, contextMs, sdkMs, wallMs: performance.now() - start, cpuUs: process.cpuUsage(cpu), startRss, endRss, heapUsed: process.memoryUsage().heapUsed, maxRequestMs: Math.max(...requests), meanRequestMs: requests.reduce((a,b)=>a+b,0)/requests.length, timerSamples: delays.length, maxTimerDelayMs: Math.max(0,...delays), outputContexts: outputs.size, workload: `${rows + 1} finalized synthetic messages per session, actual public SDK reconstruction/context; no inference/network/credentials/live DB` };
    if (outputs.size !== count) throw Error('Repeated contexts changed');
    console.log(JSON.stringify(report));
  } finally { clearInterval(timer); if (agentPool) await agentPool.shutdown(); await manager.shutdown(); }
});
