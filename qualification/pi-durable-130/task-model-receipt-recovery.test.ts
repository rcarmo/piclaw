import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { createTempWorkspace, setEnv } from '../../runtime/test/helpers.js';
import { resolveRuntimeConfigPaths } from '../../runtime/src/core/config-paths.js';
import { Harness, createRegistry, type TaskId, type ConversationId, type CompactionResult } from '../../runtime/durable-engine/qualification/durable.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { createAssistantMessageEventStream, type Model, type Api, type AssistantMessage } from '../../node_modules/@earendil-works/pi-ai';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { createHostModels } from '../../runtime/durable-engine/src/host-models.js';
import type { ModelRuntime } from '../../runtime/src/durable-legacy-sdk.js';
import { reserveHostRequest } from '../../runtime/durable-engine/src/host-request-accounting.js';
import { taskModelRequestScope, withTaskModelRequestScope, type TaskModelRequestScope } from '../../runtime/durable-engine/src/task-model-boundary-shim.js';
import { awaitWithContext, withAbortSignal } from '../../runtime/durable-engine/qualification/context.ts';
import { context, barrier } from './src/fixture.js';
import { assertPathWithinTestFilesystemIsolation } from '../../runtime/scripts/test-filesystem-isolation.js';

const windows = ['before-receipt', 'retained', 'charged'] as const;
type Window = typeof windows[number];
type CrashState = { pid: number; taskId: TaskId<CompactionResult>; conversationId: ConversationId; checkpointHash: string; before: Record<string, unknown> };
const crashPhase = process.env.PICLAW_RECEIPT_CRASH_PHASE;
for (const window of windows.filter(value => !crashPhase || value === process.env.PICLAW_RECEIPT_CRASH_WINDOW)) test(`actual SDK summary checkpoint reopens without paid transport replay: ${window}`, async () => {
  const base = process.env.PICLAW_RECEIPT_CRASH_BASE;
  if (crashPhase && (!base || !['write', 'read'].includes(crashPhase))) throw Error('Owned crash fixture required');
  if (crashPhase) assertPathWithinTestFilesystemIsolation(base!, process.env, { allowRoot: false });
  const workspace = crashPhase ? { workspace: base!, store: join(base!, 'store'), data: join(base!, 'data'), cleanup() {} } : createTempWorkspace('model-receipt-reopen-');
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  const lifetime = new AbortController(), entered = barrier(), hold = barrier();
  let harness: Harness | undefined, providerCalls = 0, storedPublications = 0, interrupted = false;
  const scopes: TaskModelRequestScope[] = [];
  const model: Model<Api> = { provider: 'openai-codex', id: 'synthetic-receipt-summary', api: 'openai-completions', name: 'Offline summary',
    baseUrl: 'https://invalid.invalid', reasoning: false, input: ['text'], contextWindow: 100000, maxTokens: 100,
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
  const message: AssistantMessage = { role: 'assistant', provider: model.provider, model: model.id, api: model.api, timestamp: 123,
    content: [{ type: 'text', text: 'Original paid summary' }], stopReason: 'stop',
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000002, output: 0.000003, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
  try {
    const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: '0' } }); initDatabase(paths);
    const root = getDb(), authPath = join(workspace.workspace, 'synthetic-auth.json');
    if (crashPhase !== 'read') writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic', refresh: 'synthetic', accountId: 'receipt-reopen', expires: Date.now() + 60000 } }));
    const stream: ModelRuntime['stream'] = (_model, _context, options) => {
      const output = createAssistantMessageEventStream();
      void (async () => {
        try {
          // Exercise the same guarded host dispatch seam as the root runtime.
          await options?.transformHeaders?.({});
          providerCalls++;
          const result = structuredClone(message);
          output.push({ type: 'done', reason: 'stop', message: result }); output.end(result);
        } catch (cause) {
          const error = { ...structuredClone(message), stopReason: 'error' as const, errorMessage: String(cause) };
          output.push({ type: 'error', reason: 'error', error }); output.end(error);
        }
      })();
      return output;
    };
    const models = createHostModels({ getPhysicalModel: () => model, stream, streamSimple: stream }, [model], {
      signal: lifetime.signal, captureSourceGuard: () => () => lifetime.signal.throwIfAborted(),
      async authorize() { lifetime.signal.throwIfAborted(); }, assertCurrent() { lifetime.signal.throwIfAborted(); },
      assertStoredOutcomeCurrent() { storedPublications++; lifetime.signal.throwIfAborted(); },
      async prepareRequest(physical, options, signal) {
        const scope = taskModelRequestScope(options?.signal);
        if (!scope?.checkpointHash || scope.taskKind !== 'pi.compaction' || scope.phase !== 'summarize') throw Error('Exact summary checkpoint required');
        scopes.push(scope);
        const operationId = `summary:${scope.taskId}`;
        const request = await reserveHostRequest({ database: root, operationId, maintenanceWorkId: operationId, chatJid: 'web:receipt-reopen', authPath, model: physical,
          modelInvocation: { version: 1, domain: 'receipt-reopen', operationId, conversationId: scope.conversationId, taskId: scope.taskId,
            taskKind: scope.taskKind, phase: scope.phase, checkpointHash: scope.checkpointHash }, usageSource: 'compaction',
          signal, assertCurrent() { signal.throwIfAborted(); lifetime.signal.throwIfAborted(); },
          terminalOwner: { signal: lifetime.signal, assertCurrent() { lifetime.signal.throwIfAborted(); } } });
        if (!request) throw Error('Funded request required');
        if (interrupted || request.recoveredTerminal) return request;
        const pause = async () => { entered.release(); await awaitWithContext(hold.promise, withAbortSignal(signal, context)); };
        return { ...request,
          async retainTerminal(terminal) {
            if (window === 'before-receipt') await pause();
            const receipt = await request.retainTerminal(terminal);
            if (window === 'retained') await pause();
            return receipt;
          },
          async settle(terminal) { await request.settle(terminal); if (window === 'charged') await pause(); },
        };
      },
    });
    const options = { models, registry: withTaskModelRequestScope(createRegistry()), settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1 } } };
    const open = async () => Harness.open(await SqliteStorage.open(new BunSqliteDatabase(paths.databasePath, { root, assertOwner() { lifetime.signal.throwIfAborted(); }, fenceTransactions: true })), options, context);
    let saved: CrashState;
    if (crashPhase === 'read') {
      saved = JSON.parse(readFileSync(join(workspace.workspace, 'crash-state.json'), 'utf8'));
      expect(saved.pid).not.toBe(process.pid);
      expect(() => process.kill(saved.pid, 0)).toThrow();
      expect(root.query('SELECT * FROM budget_request_reservations').get()).toEqual(saved.before);
      interrupted = true;
    } else {
      harness = await open();
      const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: model.provider, modelId: model.id } } }, context);
      await conversation.commit(async tx => { for (let i = 0; i < 4; i++) await tx.appendEntry(conversation.id, { kind: 'pi.user', model: [{ role: 'user', content: `checkpoint ${i}`, timestamp: i }] }); }, context);
      const taskId = await conversation.compact('Keep original facts', context); harness.resume();
      await entered.promise;
      expect(providerCalls).toBe(1);
      const before = root.query('SELECT * FROM budget_request_reservations').get() as Record<string, unknown>;
      expect(before.terminal_receipt_json === null).toBe(window === 'before-receipt');
      expect(root.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: window === 'charged' ? 1 : 0 });
      const running = await harness.getTask(taskId, context); expect(running?.state.status).toBe('running');
      saved = { pid: process.pid, taskId, conversationId: conversation.id, checkpointHash: scopes[0]!.checkpointHash!, before };
      if (crashPhase === 'write') {
        writeFileSync(join(workspace.workspace, 'crash-state.json'), JSON.stringify(saved));
        await hold.promise; throw Error('Crash fixture must not resume');
      }
      await harness.close(context); harness = undefined; interrupted = true;
      const held = root.query('SELECT * FROM budget_request_reservations').get() as Record<string, unknown>;
      expect(held.terminal_receipt_json).toBe(before.terminal_receipt_json); expect(scopes[0]!.signal.aborted).toBe(true);
    }
    const { taskId, conversationId, before } = saved;
    harness = await open();
    // Reopen releases the old in-memory invocation; the persisted summary
    // checkpoint is pending, never terminal/failed and never revived by us.
    expect((await harness.getTask(taskId, context))?.state).toMatchObject({ status: 'pending', checkpoint: { phase: 'summarize' } });
    harness.resume();
    const settled = await harness.waitForTask(taskId, context);
    expect(settled.state.outcome.status).toBe(window === 'before-receipt' ? 'failed' : 'completed');
    expect(providerCalls).toBe(crashPhase === 'read' ? 0 : 1); expect(scopes).toHaveLength(crashPhase === 'read' ? 1 : 2);
    expect(scopes.at(-1)!.checkpointHash).toBe(saved.checkpointHash);
    if (!crashPhase) expect(scopes[1]!.signal).not.toBe(scopes[0]!.signal);
    expect(root.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
    expect(root.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: window === 'before-receipt' ? 0 : 1 });
    const after = root.query('SELECT * FROM budget_request_reservations').get() as Record<string, unknown>;
    expect(after.id).toBe(before.id); expect(after.terminal_receipt_json).toBe(before.terminal_receipt_json); expect(after.terminal_received_at).toBe(before.terminal_received_at);
    expect(after.state).toBe(window === 'before-receipt' ? crashPhase === 'read' ? 'dispatched' : 'unresolved' : 'settled');
    if (crashPhase === 'read' && window === 'before-receipt') expect(after).toEqual(before);
    if (window !== 'before-receipt') {
      expect(storedPublications).toBe(2);
      if (settled.state.outcome.status !== 'completed' || !settled.state.outcome.result.submissionId) throw Error('Exact summary write required');
      await (await harness.submission(settled.state.outcome.result.submissionId, context))!.wait(context);
      const reopened = (await harness.conversation(conversationId, context))!;
      const view = await reopened.context(context);
      const summaries = view.entries.filter(entry => entry.kind === 'pi.compaction');
      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.model).toEqual([{ role: 'user', content: [{ type: 'text', text: 'The conversation history before this point was compacted into the following summary:\n\n<summary>\nOriginal paid summary\n</summary>' }], timestamp: summaries[0]!.model![0]!.timestamp }]);
    }
  } finally { hold.release(); await harness?.close(context); lifetime.abort(); closeDatabase(); restore(); workspace.cleanup(); }
}, 10000);

if (!crashPhase) for (const window of windows) test(`SIGKILL then separate-process SDK receipt recovery: ${window}`, async () => {
  const workspace = createTempWorkspace('receipt-process-crash-');
  const spawn = (phase: string) => Bun.spawn([process.execPath, 'test', import.meta.path], {
    cwd: import.meta.dir, env: { ...process.env, PICLAW_RECEIPT_CRASH_PHASE: phase, PICLAW_RECEIPT_CRASH_WINDOW: window, PICLAW_RECEIPT_CRASH_BASE: workspace.base },
    stdout: 'pipe', stderr: 'pipe',
  });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn('write');
    const first = child, firstOut = new Response(first.stdout).text(), firstErr = new Response(first.stderr).text();
    const ready = join(workspace.base, 'crash-state.json'), deadline = Date.now() + 8000;
    while (!existsSync(ready) && first.exitCode === null && Date.now() < deadline) await Bun.sleep(10);
    if (!existsSync(ready)) { first.kill('SIGKILL'); await first.exited; throw Error('Crash boundary not reached: ' + await firstOut + await firstErr); }
    const saved: CrashState = JSON.parse(readFileSync(ready, 'utf8'));
    expect(saved.pid).toBe(first.pid);
    first.kill('SIGKILL'); await first.exited;
    expect(first.signalCode).toBe('SIGKILL');
    await firstOut; await firstErr;
    child = spawn('read');
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw Error('Separate-process recovery failed: ' + out + err);
    expect(code).toBe(0); expect(child.pid).not.toBe(first.pid);
    console.log('RECEIPT_PROCESS_RECOVERY ' + JSON.stringify({ window, crashedPid: first.pid, recoveryPid: child.pid, requestId: saved.before.id, checkpointHash: saved.checkpointHash, recovered: true }));
  } finally { if (child && child.exitCode === null) { child.kill('SIGKILL'); await child.exited; } workspace.cleanup(); }
}, 30000);
