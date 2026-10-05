/** Offline invocation/authority profile on a disposable WAL/FULL database. */
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Type } from 'typebox';
import type { Extension, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';
import { bindAddonChildRequestTools, addonChildRequestsApi, setAddonChildRequestsHost, shutdownAddonChildRequests } from '../../src/addons/child-request-runtime.js';
import { withExternalAddonRegistrationContext } from '../../src/addons/external-routes.js';
import { withBudgetWorkContext } from '../../src/budget/context.js';
import { withChatContext } from '../../src/core/chat-context.js';
import { initDatabase, closeDatabase, getDb } from '../../src/db/connection.js';
import { ensureBudgetWork } from '../../src/db/budget-limits.js';

const workspace = process.env.PICLAW_WORKSPACE!;
assertPathWithinTestFilesystemIsolation(workspace, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, '0');
mkdirSync(join(workspace, '.piclaw'), { recursive: true });
writeFileSync(join(workspace, '.piclaw/config.json'), JSON.stringify({ domains: { access: { mode: 'single-user' } } }), { mode: 0o600 });
const dir = join(workspace, '.pi/extensions/node_modules/piclaw-addon-profile');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'piclaw-addon-profile', pi: { extensions: ['index.ts'] } }));
const entry = join(dir, 'index.ts'); writeFileSync(entry, 'export default()=>{}');
initDatabase();
const database = getDb();
ensureBudgetWork({ id: 'profile-work', chatJid: 'web:profile', executionKind: 'interactive' });
const registration = await withExternalAddonRegistrationContext({ packageName: 'piclaw-addon-profile', entryPath: entry }, async () => addonChildRequestsApi.register());
let admitted = 0, authorised = 0, closed = 0;
setAddonChildRequestsHost({ createScope(input, invocation) {
  admitted++; invocation.authorise(); authorised++;
  return { plan: { version: 1, execution: 'parent-provider-proxy', mcp: 'none', model: input.model }, stream() { throw Error('unused'); }, async close() { closed++; } };
} });
const controller = new AbortController();
const definition: ToolDefinition = { name: 'profile', label: 'profile', description: 'synthetic', parameters: Type.Object({}), async execute() {
  registration.createScope({ model: { provider: 'fixture', id: 'fixture' }, signal: controller.signal, deadlineAt: Date.now() + 5000 });
  return { content: [], details: {} };
} };
const extension = { path: entry, resolvedPath: realpathSync(entry), tools: new Map([['profile', { definition }]]) } as unknown as Extension;
bindAddonChildRequestTools([extension], 'web:profile');
const instrument = process.argv.includes('--instrument');
const originalParse = JSON.parse, originalStringify = JSON.stringify;
const json = { parse: { calls: 0, ms: 0 }, stringify: { calls: 0, ms: 0 } };
if (instrument) {
  JSON.parse = (...args: Parameters<typeof JSON.parse>) => { const at = performance.now(); try { return originalParse(...args); } finally { json.parse.calls++; json.parse.ms += performance.now() - at; } };
  JSON.stringify = (...args: Parameters<typeof JSON.stringify>) => { const at = performance.now(); try { return originalStringify(...args); } finally { json.stringify.calls++; json.stringify.ms += performance.now() - at; } };
}
const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable();
const cpu = process.cpuUsage(), start = performance.now();
try {
  await withBudgetWorkContext({ workId: 'profile-work', chatJid: 'web:profile', kind: 'interactive' }, () => withChatContext('web:profile', 'web', async () => {
    for (let n = 0; n < 500; n++) { await definition.execute(`profile-${n}`, {}, controller.signal, undefined, {} as never); if (n % 50 === 0) await Bun.sleep(0); }
  }));
  const wallMs = performance.now() - start, usage = process.cpuUsage(cpu);
  loop.disable(); JSON.parse = originalParse; JSON.stringify = originalStringify;
  assert.equal(admitted, 500); assert.equal(authorised, 500); assert.equal(closed, 500);
  assert.deepEqual(database.query('PRAGMA quick_check').get(), { quick_check: 'ok' });
  console.log(JSON.stringify({ runtime: Bun.version, instrument, admitted, authorised, closed, wallMs, cpu: usage, json,
    eventLoop: { resolutionMs: 1, samples: loop.count, maxMs: loop.max / 1e6 },
    journal: database.query('PRAGMA journal_mode').get(), synchronous: database.query('PRAGMA synchronous').get(),
    scope: '500 sequential actual installed-tool wrappers and synchronous durable-work/DB/path/config authority checks over owned WAL/FULL database; injected scope closes, no auth/provider/HTTP/reservation or OS child; startup excluded from wall/CPU, CPU profile includes startup; no baseline speed claim' }));
} finally { loop.disable(); JSON.parse = originalParse; JSON.stringify = originalStringify; await shutdownAddonChildRequests(); closeDatabase(); }
