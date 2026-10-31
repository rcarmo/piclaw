import "./src/test-guard.js";
import { beforeAll, expect, test, spyOn } from "bun:test";
import { writeFileSync } from 'node:fs';
import { createSession, GenerationTask, CompactionTask, type ConversationId, type TaskId, type StorageWrite } from "../../runtime/durable-engine/qualification/durable.ts";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { assertConversationAccountingReady, operationBudgetWorkId } from "../../runtime/durable-engine/src/host-request-accounting.js";
import { projectTerminalOutcome } from "../../runtime/durable-engine/src/host-terminal-outcome.js";
import { modelRequestAccounting } from "../../runtime/src/budget/model-request-accounting.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { ensureBudgetWork, setBudgetWorkStatus } from "../../runtime/src/db/budget-limits.js";
import { abandonBudgetRequest, BudgetRequestError, dispatchBudgetRequest, getBudgetRequest, recordBudgetTerminalReceipt, reserveBudgetRequest, type BudgetRequestBinding } from "../../runtime/src/db/budget-request-reservations.js";
import type { AssistantMessage } from "../../runtime/src/durable-legacy-sdk.js";
import { createTempWorkspace, setEnv } from "../../runtime/test/helpers.js";
import { resolveRuntimeConfigPaths } from "../../runtime/src/core/config-paths.js";

// Financial metadata/dependency units only. No Harness, scheduler, provider,
// credential lookup, source authority, or outbound execution is exercised here.
// The default application factory tests own the real SDK/provider-flow contract.
const domain = "sdk-accounting-scope-unit", chatJid = "web:accounting-scope-unit";
const physical = { provider: "synthetic-accounting", id: "local-model", api: "openai-responses" };
type Location = { conversationId: ConversationId; taskId: StoredTask['id'] };
type Graph = Record<'parent' | 'child' | 'sibling' | 'independent' | 'fork', Location>;
let seed: { image: Uint8Array; graph: Graph } | undefined;
type StoredTask = Extract<StorageWrite, { type: "task" }>["value"];
const owner = { signal: new AbortController().signal, assertCurrent() {} };
function terminal(unknown = false): AssistantMessage {
  return { role: "assistant", provider: physical.provider, model: physical.id, api: physical.api,
    content: [{ type: "text", text: "Synthetic local accounting evidence; no provider call." }],
    stopReason: "stop", timestamp: 123,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: unknown ? 0 : 0.001, output: unknown ? 0 : 0.001, cacheRead: 0, cacheWrite: 0, total: unknown ? 0 : 0.002 } } };
}

async function fixture(body: (f: {
  parent: Location; child: Location; sibling: Location; independent: Location; fork: Location;
  readonly database: ReturnType<typeof getDb>; readonly storage: Awaited<ReturnType<typeof SqliteStorage.open>>;
  reopen(): Promise<void>;
  reserve(at: Location, namespace?: string): BudgetRequestBinding;
  retain(binding: BudgetRequestBinding, message?: AssistantMessage): void;
  ready(at: Location, exclude?: string, terminal?: boolean, namespace?: string): void;
  compaction(at: Location, state: StoredTask["state"], abortRequested?: boolean): Promise<TaskId>;
}) => Promise<void>) {
  // Same disposable application Root setup as reservedTerminal, but genuinely
  // file-backed so the SDK and Root read the same migrated tables.
  const workspace = createTempWorkspace("sdk-accounting-scope-");
  const restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  let storage: Awaited<ReturnType<typeof SqliteStorage.open>> | undefined;
  let session: ReturnType<typeof createSession> | undefined;
  try {
    const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: "0" } });
    // One fully migrated/public-API-built seed, independently restored per case.
    // Avoid repeating hundreds of fsynced bootstrap DDL writes under each 5s
    // deadline; keep real shared-file SDK/Root storage and normal durability.
    if (seed) writeFileSync(paths.databasePath, seed.image);
    initDatabase(paths);
    let database = getDb();
    expect(database.query("SELECT file FROM pragma_database_list WHERE name='main'").get()).toEqual({ file: paths.databasePath });
    const open = () => SqliteStorage.open(new BunSqliteDatabase(paths.databasePath, { root: database, assertOwner() {}, fenceTransactions: true }));
    storage = await open();
    let graph: Graph;
    if (seed) graph = seed.graph;
    else {
      session = createSession(storage); // A raw Session has no scheduler to resume.
      const main = await session.commit(async tx => {
        const parent = await tx.createConversation({ ownership: { kind: "ownerless" } });
        const parentTask = await tx.createTask(GenerationTask, {}, { conversationId: parent.id, ownership: { kind: "conversation" } });
        const child = await tx.createConversation({ ownership: { kind: "task", taskId: parentTask } });
        const sibling = await tx.createConversation({ ownership: { kind: "task", taskId: parentTask } });
        const independent = await tx.createConversation({ ownership: { kind: "ownerless" } });
        const entry = await tx.appendEntry(parent.id, { kind: "pi.user", model: [{ role: "user", content: "local history", timestamp: 1 }] });
        const location = async (conversationId: ConversationId): Promise<Location> => ({ conversationId,
          taskId: await tx.createTask(GenerationTask, {}, { conversationId, ownership: { kind: "conversation" } }) });
        return { parent: { conversationId: parent.id, taskId: parentTask }, child: await location(child.id),
          sibling: await location(sibling.id), independent: await location(independent.id), entryId: entry.id };
      }, context);
      // The public fork reads its committed source history, not a provisional entry.
      const fork = await session.commit(async tx => {
        const conversation = await tx.forkConversation(main.parent.conversationId, main.entryId, { ownership: { kind: 'ownerless' } });
        return { conversationId: conversation.id, taskId: await tx.createTask(GenerationTask, {}, {
          conversationId: conversation.id, ownership: { kind: 'conversation' } }) };
      }, context);
      // No direct Storage writes while a Session owns it. Metadata-only state
      // replacements below use the public StorageWrite contract after close/reopen.
      await session.close(context); session = undefined; storage = undefined;
      storage = await open();
      graph = { ...main, fork };
    }
    let serial = 0;
    const f = {
      ...graph,
      get database() { return database; }, get storage() { return storage!; },
      async reopen() {
        await storage!.close(context); storage = undefined;
        closeDatabase(); initDatabase(paths); database = getDb(); storage = await open();
      },
      reserve(at: Location, namespace = domain) {
        const id = `scope-request-${++serial}`, operationId = `scope-operation-${serial}`;
        const parentWorkId = operationBudgetWorkId(operationId), workId = `durable-request:${id}`;
        ensureBudgetWork({ id: parentWorkId, chatJid, executionKind: "interactive" }, database);
        ensureBudgetWork({ id: workId, chatJid, executionKind: "interactive", parentWorkId }, database);
        const binding: BudgetRequestBinding = { id, workId, chatJid, providerId: physical.provider, modelId: physical.id,
          accountRef: "synthetic-local-account", amountMicros: 10_000,
          modelInvocation: { version: 1, domain: namespace, operationId, conversationId: at.conversationId,
            taskId: at.taskId, taskKind: "pi.generation", phase: "request", checkpointHash: serial.toString(16).padStart(64, "0") } };
        // Public reservation validation checks all eight invocation fields. These
        // synthetic checkpoint identities are data, not claimed running requests.
        reserveBudgetRequest(binding, {}, database);
        return binding;
      },
      retain(binding: BudgetRequestBinding, message = terminal()) {
        dispatchBudgetRequest(binding, { signal: owner.signal, authorise() {} }, database);
        recordBudgetTerminalReceipt(binding, { version: 1, requestId: binding.id,
          requestBindingSha256: getBudgetRequest(binding.id, database)!.binding_sha256,
          projectedOutcome: JSON.parse(JSON.stringify(projectTerminalOutcome(message, physical))) }, "2026-01-02T03:04:05.000Z", database);
      },
      ready(at: Location, exclude?: string, isTerminal = false, namespace = domain) {
        assertConversationAccountingReady(database, { domain: namespace, chatJid, conversationId: at.conversationId }, exclude, isTerminal);
      },
      async compaction(at: Location, state: StoredTask["state"], abortRequested = false) {
        const id = await storage!.mintId<StoredTask['id']>();
        const base = { id, conversationId: at.conversationId, kind: 'pi.compaction',
          version: CompactionTask.definition.version, input: { reason: 'threshold' }, background: true, abortRequested };
        // Preserve the SDK live/terminal record union without casting away its memo contract.
        const value: StoredTask = state.status === 'terminal' || state.status === 'completing'
          ? { ...base, state } : { ...base, state };
        await storage!.commit([{ type: 'task', value }], context);
        return id;
      },
    };
    await body(f);
  } finally {
    if (session) await session.close(context);
    else if (storage) await storage.close(context);
    closeDatabase(); restore(); workspace.cleanup();
  }
}
beforeAll(() => fixture(async f => {
  seed = { image: f.database.serialize(), graph: { parent: f.parent, child: f.child, sibling: f.sibling, independent: f.independent, fork: f.fork } };
}));

function denied(action: () => void, code: BudgetRequestError["code"] = "budget_denied") {
  expect(action).toThrow(BudgetRequestError);
  expect(action).toThrow(`Model request ${code}.`);
}

for (const origin of ["parent", "child", "sibling"] as const) test(`retained known facts in ${origin} block parent, child and sibling reciprocally`, () => fixture(async f => {
  const binding = f.reserve(f[origin]); f.retain(binding);
  const before = getBudgetRequest(binding.id, f.database);
  for (const at of [f.parent, f.child, f.sibling]) {
    denied(() => f.ready(at)); denied(() => f.ready(at, undefined, true));
  }
  expect(getBudgetRequest(binding.id, f.database)).toEqual(before); // denial is read-only
  const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false }, f.database);
  expect((await accounting.settleRetainedRequest(binding, owner)).state).toBe("settled");
  for (const at of [f.parent, f.child, f.sibling]) expect(() => f.ready(at, undefined, true)).not.toThrow();
}));

for (const unrelated of ["independent", "fork"] as const) test(`same-chat ${unrelated} does not join the ownership scope`, () => fixture(async f => {
  const record = await f.storage.conversation(f.fork.conversationId, context);
  expect(record?.parent?.conversationId).toBe(f.parent.conversationId);
  expect(record?.owner).toBeUndefined();
  const binding = f.reserve(f[unrelated]); f.retain(binding);
  for (const at of [f.parent, f.child, f.sibling]) expect(() => f.ready(at, undefined, true)).not.toThrow();
  denied(() => f.ready(f[unrelated]));
  // Reciprocal isolation: a parent fact cannot block the independent/fork root.
  const parent = f.reserve(f.parent); f.retain(parent);
  expect(() => f.ready(f[unrelated], binding.id, true)).not.toThrow();
}));

test("domain namespaces remain separate even for the same SDK ownership tree", () => fixture(async f => {
  const binding = f.reserve(f.child, "other-domain"); f.retain(binding);
  expect(() => f.ready(f.parent, undefined, true)).not.toThrow();
  denied(() => f.ready(f.sibling, undefined, true, "other-domain"));
}));

test("terminal owner ancestry and old financial facts survive full disk reopen and finished operations", () => fixture(async f => {
  const original = await f.storage.task(f.parent.taskId, context);
  if (!original) throw Error("missing parent task");
  const { memos: _memos, ...finished } = original;
  await f.storage.commit([{ type: "task", value: { ...finished, state: { status: "terminal", outcome: { status: "aborted", reason: "metadata-only fixture" } } } }], context);
  const binding = f.reserve(f.child); f.retain(binding);
  setBudgetWorkStatus(operationBudgetWorkId(binding.modelInvocation!.operationId), "completed", { boundary: "unit-operation-finished" }, f.database);
  // Outstanding facts must not depend on their original request work staying active either.
  setBudgetWorkStatus(binding.workId, "stopped", { boundary: "unit-work-finished" }, f.database);
  await f.reopen();
  expect((await f.storage.task(f.parent.taskId, context))?.state.status).toBe("terminal");
  expect((await f.storage.conversation(f.child.conversationId, context))?.owner?.taskId).toBe(f.parent.taskId);
  denied(() => f.ready(f.parent)); denied(() => f.ready(f.sibling, undefined, true));
}));

const liveStates: StoredTask["state"][] = [
  { status: "pending", checkpoint: { phase: "select" } },
  { status: "running", checkpoint: { phase: "select" } },
  { status: "waiting", checkpoint: { phase: "select" }, on: [], policy: "allSettled" },
  { status: "sleeping", checkpoint: { phase: "select" }, until: 9_000_000_000_000 },
  { status: "completing", outcome: { status: "aborted", reason: "metadata-only" } },
];
for (const state of liveStates) for (const abortRequested of [false, true]) test(`terminal joins background compaction ${state.status}, abort-marked=${abortRequested}, before any reservation`, () => fixture(async f => {
  const id = await f.compaction(f.child, state, abortRequested);
  expect(f.database.query("SELECT count(*) n FROM budget_request_reservations").get()).toEqual({ n: 0 });
  for (const at of [f.parent, f.child, f.sibling]) {
    expect(() => f.ready(at)).not.toThrow(); // Not a global in-flight serialization gate.
    denied(() => f.ready(at, undefined, true));
  }
  expect(() => f.ready(f.independent, undefined, true)).not.toThrow();
  expect(() => f.ready(f.fork, undefined, true)).not.toThrow();
  const task = await f.storage.task(id, context);
  if (!task) throw Error("missing compaction fixture");
  const { memos: _memos, ...finished } = task;
  await f.storage.commit([{ type: "task", value: { ...finished, state: { status: "terminal", outcome: { status: "aborted" } } } }], context);
  expect(() => f.ready(f.parent, undefined, true)).not.toThrow();
}));

for (const dispatched of [false, true]) test(`nonterminal readiness permits merely ${dispatched ? "dispatched" : "reserved"} work; terminal waits`, () => fixture(async f => {
  const binding = f.reserve(f.child);
  if (dispatched) dispatchBudgetRequest(binding, { signal: owner.signal, authorise() {} }, f.database);
  expect(() => f.ready(f.sibling)).not.toThrow();
  denied(() => f.ready(f.parent, undefined, true));
  expect(() => f.ready(f.parent, binding.id, true)).not.toThrow();
}));

test("exact request exclusion does not exempt its sibling or the whole conversation scope", () => fixture(async f => {
  const first = f.reserve(f.child), second = f.reserve(f.child);
  f.retain(first); f.retain(second);
  denied(() => f.ready(f.parent, first.id));
  denied(() => f.ready(f.sibling, second.id, true));
  await modelRequestAccounting({ authorise() {}, documentedFree: false }, f.database).settleRetainedRequest(second, owner);
  expect(() => f.ready(f.sibling, first.id, true)).not.toThrow();
  denied(() => f.ready(f.sibling));
}));

test("unresolved receipt-less sends block normal and terminal readiness after work finishes", () => fixture(async f => {
  const binding = f.reserve(f.parent);
  dispatchBudgetRequest(binding, { signal: owner.signal, authorise() {} }, f.database);
  expect(abandonBudgetRequest(binding, f.database).state).toBe("unresolved");
  setBudgetWorkStatus(binding.workId, "stopped", { boundary: "unit-finished" }, f.database);
  for (const at of [f.parent, f.child, f.sibling]) {
    denied(() => f.ready(at)); denied(() => f.ready(at, undefined, true));
  }
}));

test("intentional valid unknown valuation stays held but is allowed by the existing evaluator", () => fixture(async f => {
  const binding = f.reserve(f.child); f.retain(binding, terminal(true));
  // A retained but not yet evaluated unknown is still pending reconciliation.
  denied(() => f.ready(f.parent));
  const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false }, f.database);
  expect((await accounting.settleRetainedRequest(binding, owner)).state).toBe("unresolved");
  const before = getBudgetRequest(binding.id, f.database);
  expect(before?.terminal_receipt_json).not.toBeNull();
  expect(before?.usage_event_id).toBeNull(); expect(before?.settlement_sha256).toBeNull();
  for (const at of [f.parent, f.child, f.sibling]) expect(() => f.ready(at, undefined, true)).not.toThrow();
  expect(getBudgetRequest(binding.id, f.database)).toEqual(before);
  expect(f.database.query("SELECT count(*) n FROM budget_usage_events").get()).toEqual({ n: 0 });
}));

for (const status of ["active", "paused"] as const) test(`settled receipt with ${status} request work still requires its local completion`, () => fixture(async f => {
  const binding = f.reserve(f.child), message = terminal(); f.retain(binding, message);
  await modelRequestAccounting({ authorise() {}, documentedFree: false }, f.database).settle(binding, message);
  if (status === "paused") setBudgetWorkStatus(binding.workId, "paused", { boundary: "unit-paused" }, f.database);
  expect(getBudgetRequest(binding.id, f.database)?.state).toBe("settled");
  denied(() => f.ready(f.parent));
  setBudgetWorkStatus(binding.workId, "completed", { boundary: "unit-completed" }, f.database);
  expect(() => f.ready(f.parent, undefined, true)).not.toThrow();
}));

test("missing or malformed scope conversation fails closed in a real SDK schema", () => fixture(async f => {
  const missing = await f.storage.mintId<ConversationId>();
  for (const conversationId of [missing, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    denied(() => assertConversationAccountingReady(f.database, { domain, chatJid, conversationId }), "conflict");
  }
}));

test("dangling ownership fails closed both as target and as an outstanding invocation locator", () => fixture(async f => {
  const conversationId = await f.storage.mintId<ConversationId>(), taskId = await f.storage.mintId<StoredTask['id']>();
  // Deliberately corrupt graph, expressed through the public storage boundary
  // (which trusts its caller for ancestry), never an invented SQL schema.
  await f.storage.commit([{ type: "conversation", value: { id: conversationId,
    owner: { conversationId: f.parent.conversationId, taskId } } }], context);
  const broken = { conversationId, taskId };
  denied(() => f.ready(broken), "conflict");
  f.retain(f.reserve(broken));
  denied(() => f.ready(f.parent), "conflict");
}));

test('dependency queries use outstanding-work/status indexes rather than billed history scans', () => fixture(async f => {
  const spy = spyOn(f.database, 'query'); let queries: string[];
  try { f.ready(f.parent, undefined, true); queries = spy.mock.calls.map(call => call[0]); }
  finally { spy.mockRestore(); }
  const pending = queries.find(sql => sql.startsWith('SELECT r.* FROM budget_request_reservations'));
  const live = queries.find(sql => sql.startsWith('SELECT conversation_id FROM tasks'));
  if (!pending || !live) throw Error('Actual dependency queries not observed');
  const pendingPlan = f.database.query('EXPLAIN QUERY PLAN ' + pending).all(chatJid, chatJid) as { detail: string }[];
  const livePlan = f.database.query('EXPLAIN QUERY PLAN ' + live).all(JSON.stringify(CompactionTask.definition.name)) as { detail: string }[];
  for (const name of ['idx_budget_requests_state', 'idx_budget_work_chat_status', 'idx_budget_requests_work_state'])
    expect(pendingPlan.some(row => row.detail.includes(name))).toBe(true);
  expect(livePlan.some(row => row.detail.includes('tasks_by_status'))).toBe(true);
  const scan = /\bSCAN (r|w|tasks)\b/;
  expect(scan.test('SCAN r')).toBe(true);
  expect([...pendingPlan, ...livePlan].some(row => scan.test(row.detail))).toBe(false);
}));

test("cyclic ownership with no ownerless root fails closed, including terminal checks", () => fixture(async f => {
  const a = await f.storage.mintId<ConversationId>(), b = await f.storage.mintId<ConversationId>();
  const ta = await f.storage.mintId<StoredTask['id']>(), tb = await f.storage.mintId<StoredTask['id']>();
  const task = (id: StoredTask['id'], conversationId: ConversationId): StoredTask => ({ id, conversationId,
    kind: "pi.generation", version: 1, input: {}, background: false, abortRequested: false,
    state: { status: "terminal", outcome: { status: "aborted" } } });
  const writes: StorageWrite[] = [
    { type: "conversation", value: { id: a, owner: { conversationId: b, taskId: tb } } },
    { type: "conversation", value: { id: b, owner: { conversationId: a, taskId: ta } } },
    { type: "task", value: task(ta, a) }, { type: "task", value: task(tb, b) },
  ];
  await f.storage.commit(writes, context);
  denied(() => f.ready({ conversationId: a, taskId: ta }), "conflict");
  denied(() => f.ready({ conversationId: b, taskId: tb }, undefined, true), "conflict");
}));
