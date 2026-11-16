import './src/test-guard.js';
import { expect } from 'bun:test';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { importSessionHistory } from '../../runtime/durable-engine/src/session-history-import.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { getRuntimeConfigPaths } from '../../runtime/src/core/config.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.js';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent';
import { AgentPool } from '../../runtime/src/agent-pool.js';
import { createRuntimeBaseServices } from '../../runtime/src/runtime/composition.js';
const applicationTest = isolatedApplicationTest(import.meta.url);
applicationTest('completed native session import binds to Core histories without source/config/task replay and reopens with stable identities', async () => {
  const workspace = process.env.PICLAW_WORKSPACE!, source = join(workspace, 'offline.jsonl'), timestamp = '2026-01-01T00:00:00.000Z';
  const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const messages = [
    { type: 'session', version: 3, id: 'source-history', timestamp, cwd: '/offline/source' },
    { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', timestamp: 1, content: 'HISTORY_ONLY' } },
    ...['a', 'b'].map(id => ({ type: 'message', id, parentId: 'user', timestamp, message: { role: 'assistant', timestamp: 2, content: [{ type: 'text', text: `SOURCE_BRANCH_${id}` }], api: 'openai-completions', provider: 'old-provider', model: 'old-model', stopReason: 'stop', usage } })),
  ];
  writeFileSync(source, messages.map(entry => JSON.stringify(entry)).join('\n') + '\n'); const sourceBefore = readFileSync(source);
  process.env.PICLAW_DB_IN_MEMORY = '0';
  const paths = getRuntimeConfigPaths(); mkdirSync(dirname(paths.databasePath), { recursive: true });
  const imported = await importSessionHistory({ sourceFile: source, destinationFile: paths.databasePath, leaves: ['a', 'b'] });
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'import-native-owner.lock'), strictOwnership: true, disabled: false });
  initDatabase(paths); const root = getDb();
  const historicalRows = root.query("SELECT id,record FROM entries WHERE json_extract(record,'$.kind')='app.imported-history' ORDER BY id").all();
  expect(historicalRows).toHaveLength(imported.importedEntries);
  let modelCalls = 0;
  const credentials = createTestCredentialStore({}), models = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, refreshOnCreate: false, allowModelNetwork: false });
  const model = { provider: 'fixture', id: 'gpt-6.1-sol', name: 'Current native default', api: 'openai-completions', baseUrl: 'https://invalid.invalid', contextWindow: 100000, maxTokens: 1000, input: ['text'], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const forbidden = () => { modelCalls++; throw Error('History import/bootstrap must not call a model'); };
  models.registerNativeProvider({ id: 'fixture', name: 'Fixture', getModels: () => [model] as any, auth: { apiKey: { name: 'Keyless', resolve: async () => ({ auth: {}, source: 'fixture' }) } }, stream: forbidden as any, streamSimple: forbidden as any });
  const services: any = { modelRuntime: models, modelRegistry: { getAvailable: () => [model] } };
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined, pool: AgentPool | undefined;
  const base = createRuntimeBaseServices({ dataDir: workspace });
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    pool = new AgentPool({ credentialStore: credentials, modelRuntime: models, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    backend.bind({ queue: base.queue, agentPool: pool });
    const chats = root.query("SELECT chat_jid,branch_id FROM chat_branches WHERE chat_jid LIKE 'web:imported:%' ORDER BY chat_jid").all() as { chat_jid: string; branch_id: string }[];
    expect(chats).toHaveLength(2);
    for (const chat of chats) {
      const tree = await pool.getSessionTreeForChat(chat.chat_jid);
      expect(JSON.stringify(tree)).toContain('HISTORY_ONLY');
      expect(tree.nodes.some(node => node.type === 'message' && node.role === 'assistant')).toBe(true);
    }
    expect(root.query("SELECT id,record FROM entries WHERE json_extract(record,'$.kind')='app.imported-history' ORDER BY id").all()).toEqual(historicalRows);
    expect(root.query('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 }); expect(root.query('SELECT COUNT(*) AS count FROM submissions').get()).toEqual({ count: 0 });
    const identities = root.query(`SELECT owner_id,content FROM documents JOIN document_revisions ON document_id=documents.id WHERE documents.kind='"app.application-identity"' ORDER BY owner_id`).all();
    expect(JSON.stringify(identities)).toContain(String(imported.leaves[0]!.conversationId));
    await backend.close(); await pool.shutdown();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query(`SELECT owner_id,content FROM documents JOIN document_revisions ON document_id=documents.id WHERE documents.kind='"app.application-identity"' ORDER BY owner_id`).all()).toEqual(identities);
    expect(readFileSync(source).equals(sourceBefore)).toBe(true); expect(modelCalls).toBe(0);
  } finally { await backend?.close(); await pool?.shutdown(); await base.queue.shutdown(); await closeDatabase(); owner.release(); }
});
