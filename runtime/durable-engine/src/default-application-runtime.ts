import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { apply } from "@earendil-works/chord/delta";
import { Harness, AgentDoc, configure, createRegistry, defineDoc, defineExtension, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { RuntimeModelServices } from "../../src/agent-pool/model-services.js";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { getDb, storeChatMetadata } from "../../src/db.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import { DATA_DIR, SESSIONS_DIR, WORKSPACE_DIR } from "../../src/core/config.js";
import { getPiclawAgentDir } from "../../src/core/agent-dir.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "./application-bootstrap.js";
import { createHostModels } from "./host-models.js";
import { createHostBuiltinTools } from "./host-builtins.js";
import { loadApplicationExtensionCatalog, qualifyInstalledPlan, qualifyInstalledDelegate, assertApplicationExtensionCatalogSupported } from "./host-extension-catalog.js";
import { createHostDelegateTool } from "./host-delegate-tool.js";
import { extensionKvGet } from "../../src/db/extension-kv.js";
import { createHostPlanTool } from "./host-plan-tool.js";
import { createHostPlanPrompt } from "./host-plan-prompt.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { registerRootExtensionKvStore } from "../../src/db/register-extension-kv.js";
import { requireExtensionKvAuthority } from "../../src/extension-kv-registry.js";

const ApplicationConversations = defineDoc({ kind: "app.application-conversations", version: 1,
  scope: "conversation", history: "latest", fork: "initial", initial: () => ({ version: 1, domain: "", bindings: [] as { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] }) });

type ApplicationMapping = { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
const defaultToolNames = ["read", "bash", "edit", "write", "find", "ls", "grep"] as const;
const isOldDefault = (tools: unknown) => Array.isArray(tools) &&
  ((tools.length === 1 && tools[0] === "bash") ||
    (tools.length === 6 && defaultToolNames.slice(0, 6).every((name, i) => tools[i] === name)));

/** Read-only preflight, before Harness.open can normalize pending work. All
 * configuration writes still go through public configure in one SDK commit. */
function storedDocument(root: ReturnType<typeof getDb>, id: number): any {
  let value: unknown;
  const revisions = root.query("SELECT kind, version, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(id) as { kind: string; version: number; content: string }[];
  for (const revision of revisions) {
    if (revision.version !== 1) throw Error("Invalid persisted document version");
    if (revision.kind === "base") value = JSON.parse(revision.content);
    else if (revision.kind === "delta" && value) value = apply(value, JSON.parse(revision.content));
    else throw Error("Invalid persisted document");
  }
  if (!value) throw Error("Invalid persisted document");
  return value;
}
function assertToolUpgradeIdle(root: ReturnType<typeof getDb>): void {
  if (root.inTransaction) throw Error("Root connection transaction active");
  if (root.query("SELECT 1 FROM tasks WHERE status <> 'terminal' UNION ALL SELECT 1 FROM submissions WHERE status IN ('queued','placed') LIMIT 1").get())
    throw Error("Host tool upgrade requires idle SDK work");
  const docs = root.query(`SELECT id, kind FROM documents WHERE kind IN ('"pi.inbox"','"pi.live"') AND retired_at IS NULL`).all() as { id: number; kind: string }[];
  for (const doc of docs) {
    const state = storedDocument(root, doc.id);
    if (doc.kind === '"pi.inbox"' ? state.items?.length : state.run) throw Error("Host tool upgrade requires idle SDK work");
  }
  const exists = (table: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (exists("service_effect_s01_chats") && root.query(`SELECT 1 FROM service_effect_s01_chats WHERE active_operation_id IS NOT NULL
    UNION ALL SELECT 1 FROM service_effect_s01_sources WHERE state NOT IN ('consumed','disposed')
    UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE phase <> 'terminal'
    UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE state NOT IN ('consumed','disposed') LIMIT 1`).get())
    throw Error("Host tool upgrade requires idle host work");
}
function validateApplicationMapping(root: ReturnType<typeof getDb>, value: unknown): asserts value is ApplicationMapping {
  const m = value as ApplicationMapping;
  const canonical = (v: unknown): v is string => typeof v === "string" && !!v && v === v.trim();
  if (!m || m.version !== 1 || !canonical(m.domain) || !Array.isArray(m.bindings) || !m.bindings.length ||
    ["chatJid", "branchId", "conversationId", "sessionId"].some(key => new Set(m.bindings.map(b => b?.[key as keyof typeof b])).size !== m.bindings.length) ||
    m.bindings.some(b => !b || !canonical(b.chatJid) || !canonical(b.branchId) || !canonical(b.sessionId) || !Number.isSafeInteger(b.conversationId) || b.conversationId <= 1 ||
      !root.query("SELECT 1 FROM conversations WHERE id=?").get(b.conversationId) ||
      !root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(b.chatJid, b.branchId))) throw Error("Invalid durable application conversation manifest");
}

/** Presence detection only: migration remains a separate, unimplemented operation. */
export function assertFreshApplicationHistory(root: ReturnType<typeof getDb>, sessionsDir: string): void {
  const files = existsSync(sessionsDir) ? readdirSync(sessionsDir, { recursive: true, withFileTypes: true }) : [];
  if (files.some(file => file.isFile())) throw Error("Durable startup requires migration: legacy session files exist; no files were imported or reset");
  const exists = (name: string) => !!root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const sdkTables = ["durable_schema", "durable_metadata", "record_ids", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"];
  let mapping: ApplicationMapping | undefined;
  if (sdkTables.some(exists)) {
    if (!sdkTables.every(exists)) throw Error("Durable startup requires migration: partial SDK storage");
    const docs = root.query("SELECT id FROM documents WHERE kind='\"app.application-conversations\"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL").all() as { id: number }[];
    if (docs.length !== 1) throw Error("Invalid durable application conversation manifest: migration required");
    const revisions = root.query("SELECT kind, version, content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0]!.id) as { kind: string; version: number; content: string }[];
    let materialized: unknown;
    for (const revision of revisions) {
      if (revision.version !== 1) throw Error("Invalid durable application conversation manifest");
      if (revision.kind === "base") materialized = JSON.parse(revision.content);
      else if (revision.kind === "delta" && materialized) materialized = apply(materialized, JSON.parse(revision.content));
      else throw Error("Invalid durable application conversation manifest");
    }
    mapping = materialized as ApplicationMapping;
    validateApplicationMapping(root, mapping);
    for (const b of mapping.bindings) {
      const row = root.query(`SELECT r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='"app.application-identity"' AND d.owner_id=? AND d.retired_at IS NULL ORDER BY r.seq DESC LIMIT 1`).get(b.conversationId) as { content: string } | null;
      if (!row || row.content !== JSON.stringify({ domain: mapping.domain, chatJid: b.chatJid, branchId: b.branchId, sessionId: b.sessionId })) throw Error("Invalid durable application identity");
    }
  }
  const messages = root.query("SELECT rowid, id, chat_jid, is_bot_message FROM messages").all() as { rowid: number; id: string; chat_jid: string; is_bot_message: number }[];
  for (const message of messages) {
    if (!mapping || !exists("service_effect_s01_sources")) throw Error("Durable startup requires migration: legacy message history exists");
    const binding = mapping.bindings.find(b => b.chatJid === message.chat_jid);
    const source = root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=? AND kind='message' AND payload_ref=? AND provenance_ref='application:durable'").get(message.chat_jid, message.id, `message-row:${message.rowid}`);
    const terminal = message.is_bot_message && exists("service_effect_s01_operations") && exists("piclaw_durable_bindings_v1") && root.query(`SELECT 1 FROM service_effect_s01_operations o JOIN piclaw_durable_bindings_v1 b ON b.operation_id=o.operation_id JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE o.chat_jid=? AND o.terminal_message_row_id=? AND o.phase='terminal' AND b.domain=? AND b.incarnation=? AND b.conversation_id=? AND s.provenance_ref='application:durable'`).get(message.chat_jid, message.rowid, mapping.domain, mapping.domain, binding?.conversationId ?? -1);
    if (!binding || !(message.is_bot_message ? terminal : source)) throw Error("Durable startup requires migration: unverified message provenance");
  }
  if (mapping) for (const table of ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"]) {
    if (!exists(table)) continue;
    const rows = root.query(`SELECT domain, incarnation, chat_jid, branch_id, conversation_id, operation_id, source_seq FROM ${table}`).all() as { domain: string; incarnation: string; chat_jid: string; branch_id: string; conversation_id: number; operation_id: string; source_seq: number }[];
    for (const row of rows) {
      const scope = mapping.bindings.find(b => b.chatJid === row.chat_jid && b.branchId === row.branch_id);
      if (row.domain !== mapping.domain || row.incarnation !== mapping.domain || !scope) throw Error("Invalid durable application routing provenance");
      if (scope.conversationId === row.conversation_id) continue;
      // Scheduled forks are not main conversation routes. Validate their persisted
      // EF-S07/EF-S01 allocation provenance, including already completed occurrences.
      const scheduled = table === "piclaw_durable_bindings_v1" && exists("service_effect_s07_occurrences") && root.query(`SELECT 1 FROM piclaw_durable_bindings_v1 b
        JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq AND s.source_id=b.source_id AND s.payload_ref=b.payload_ref
        JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id AND r.operation_id=b.operation_id AND r.accepted_source_seq=s.source_seq
        JOIN service_effect_s01_operation_sources os ON os.operation_id=b.operation_id AND os.chat_jid=b.chat_jid AND os.source_seq=b.source_seq
        JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
        JOIN conversations c ON c.id=b.conversation_id
        WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=? AND b.conversation_id=?
          AND s.kind='scheduled_agent' AND b.request_id='scheduled:' || r.run_id
          AND c.owner_conversation_id IS NULL AND c.owner_task_id IS NULL
          AND (json_extract(c.record,'$.parent.conversationId') IS NULL OR json_extract(c.record,'$.parent.conversationId')=?)`)
        .get(mapping.domain, mapping.domain, row.operation_id, row.source_seq, row.conversation_id, scope.conversationId);
      if (!scheduled) throw Error("Invalid durable application routing provenance");
    }
  }
}

/** Mainstream source factory. Only startup-known chats are admitted; unknown chats fail closed. */
export async function createDefaultApplicationRuntime(owner: RuntimeLockHandle, getModels: () => Promise<RuntimeModelServices>): Promise<RuntimeBackend> {
  if (process.platform !== "linux") throw Error("Durable application ownership is qualified only on Linux");
  if (readAccessConfig().mode !== "single-user") throw Error("Durable host builtins require single-user policy; family effect ports are not qualified");
  const ownership = applicationOwnership(owner);
  const assert = () => owner.assertCurrentOwner();
  const root = getDb();
  assertFreshApplicationHistory(root, SESSIONS_DIR); // BEFORE SDK/schema/model construction
  registerRootExtensionKvStore();
  requireExtensionKvAuthority();
  const settings = SettingsManager.create(WORKSPACE_DIR, getPiclawAgentDir());
  // Public registration happens before model construction, AgentPool, or SDK
  // writes. Never silently start with seven tools when installed tools exist.
  const catalog = await loadApplicationExtensionCatalog({ cwd: WORKSPACE_DIR, agentDir: getPiclawAgentDir(), settingsManager: settings });
  const plan = await qualifyInstalledPlan(catalog, WORKSPACE_DIR);
  const delegate = await qualifyInstalledDelegate(catalog, WORKSPACE_DIR);
  try { assert(); assertApplicationExtensionCatalogSupported(catalog, plan, delegate); }
  finally { catalog.runtime.invalidate("Application extension preflight ended"); }
  const applicationToolNames: readonly string[] = [...defaultToolNames, ...(plan ? ["plan"] : []), ...(delegate ? ["delegate"] : [])];
  const isFactoryDefault = (tools: unknown) => isOldDefault(tools) || ((!!plan || !!delegate) && Array.isArray(tools) &&
    tools.length === defaultToolNames.length && defaultToolNames.every((name, index) => tools[index] === name));
  const host = await getModels(); assert();
  const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
  // Only the host's authenticated/approved catalog grants admission, never getAll().
  const available = host.modelRegistry.getAvailable().filter(model => {
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    return physical?.provider === model.provider && physical.id === model.id;
  });
  const selected = provider && modelId ? available.find(model => model.provider === provider && model.id === modelId) : available[0];
  if (!selected) throw Error("Durable startup requires an available host default model");
  const ref = { provider: selected.provider, id: selected.id };
  const lifetime = new AbortController();
  const check = (model: { provider: string; id: string }, signal: AbortSignal) => {
    assert(); signal.throwIfAborted();
    if (!available.some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model not approved");
    if (!host.modelRegistry.getAvailable().some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model no longer available");
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    if (physical?.provider !== model.provider || physical.id !== model.id) throw Error("Host model no longer available");
  };
  const toolUpgrades: number[] = [];
  // Validate stored choices without opening/writing SDK documents or bundle ports.
  if (root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get()) {
    const manifest = root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"' AND owner_id=1 AND retired_at IS NULL`).get() as { id: number };
    const mapping = storedDocument(root, manifest.id) as ApplicationMapping;
    const active = new Set([1, ...mapping.bindings.map(binding => binding.conversationId)]);
    const docs = root.query(`SELECT id, owner_id, scope_kind FROM documents WHERE kind='"pi.agent"' AND retired_at IS NULL`).all() as { id: number; owner_id: number; scope_kind: string }[];
    for (const doc of docs) {
      const stored = storedDocument(root, doc.id) as { model?: { provider: string; modelId: string }; tools?: unknown };
      if (stored.model && !available.some(model => model.provider === stored.model!.provider && model.id === stored.model!.modelId))
        throw Error("Persisted host model not approved");
      if (doc.scope_kind !== "conversation" || !active.has(doc.owner_id)) continue;
      if (Array.isArray(stored.tools) && stored.tools.some(name => !applicationToolNames.includes(name)))
        throw Error("Persisted host tool not available");
      // Only the recognised previous factory default converges. Explicit custom
      // subsets/filters, modelTools, instructions and extensions remain intact.
      if (isFactoryDefault(stored.tools)) toolUpgrades.push(doc.owner_id);
    }
    if (toolUpgrades.length) { assert(); assertToolUpgradeIdle(root); }
  }
  // Restricted native profile: inherit only the approved parent model. The
  // installed add-on's own classification/exclusion policy remains authoritative.
  const assertDelegateModel = (model: { provider: string; modelId: string }) => {
    if (!delegate) throw Error("Native Delegate unavailable");
    delegate.assertCurrent(); check({ provider: model.provider, id: model.modelId }, lifetime.signal);
    if (root.query("SELECT 1 FROM budget_caps WHERE enabled=1 LIMIT 1").get()) throw Error("Native Delegate budget admission unavailable");
    const config = extensionKvGet("delegate", "config", "global");
    const candidate = { provider: model.provider, id: model.modelId, fullId: `${model.provider}/${model.modelId}` };
    if (!delegate.buildModelCandidates([candidate], config).some(entry => entry.id === candidate.fullId)) throw Error("Native Delegate model not approved");
  };
  const requestGuards = new WeakMap<AbortSignal, () => void>();
  const models = createHostModels(host.modelRuntime, available.map(model => ({ provider: model.provider, id: model.id })), { signal: lifetime.signal,
    captureSourceGuard(signal) { return signal ? requestGuards.get(signal) ?? (() => {}) : () => {}; },
    async authorize(model, _kind, signal) { check(model, signal); }, assertCurrent(model, _kind, signal) { check(model, signal); } });
  const registry = createRegistry();
  // Existing host SDK definitions, never durable's independent coding tools.
  let captureRuntime: HostConversationRuntime | undefined;
  const runtime = () => {
    assert(); lifetime.signal.throwIfAborted();
    if (!captureRuntime) throw Error("Host capture runtime unavailable");
    return captureRuntime;
  };
  registry.install(defineExtension({ name: "app.host-scheduled-source", hooks: [{ task: "pi.generation", handlers: {
    async beforeRequest(_request: Parameters<NonNullable<import("@earendil-works/pi-durable").GenerationHooks["beforeRequest"]>>[0], api: Parameters<NonNullable<import("@earendil-works/pi-durable").GenerationHooks["beforeRequest"]>>[1], hookContext: Parameters<NonNullable<import("@earendil-works/pi-durable").GenerationHooks["beforeRequest"]>>[2]) {
      let guard: () => void;
      try {
        const captured = await runtime().captureRunSource(api.conversationId, api.taskId);
        guard = () => {
          runtime().assertCapturedSourceCurrent(captured.inputs);
          if (captured.delegateModel) assertDelegateModel(captured.delegateModel);
        };
      } catch (error) {
        // Deny this request through the model result, not an infrastructure hook fault
        // or a permanent abort of the shared model lifetime.
        guard = () => { throw error; };
      }
      if (!hookContext.abortSignal) throw Error("Scheduled request signal unavailable");
      requestGuards.set(hookContext.abortSignal, guard);
    },
  } }] }));
  const tools = createHostBuiltinTools({ cwd: WORKSPACE_DIR,
    async captureSourceGuard(call) {
      const captured = await runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      return () => {
        runtime().assertCapturedSourceCurrent(captured.inputs);
        if (captured.delegateModel) assertDelegateModel(captured.delegateModel);
      };
    }, authority: { assertAllowed() {
    assert(); lifetime.signal.throwIfAborted();
    if (readAccessConfig().mode !== "single-user") throw Error("Host tool permission denied");
  } }, signal: lifetime.signal, shellPath: () => settings.getShellPath(), names: defaultToolNames });
  if (plan) tools.push(createHostPlanTool(plan.definition as Parameters<typeof createHostPlanTool>[0], { root, assertOwner: () => {
    assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent();
  }, runtime }));
  if (delegate) {
    const readers = tools.filter(tool => ["read", "grep", "find", "ls"].includes(tool.name));
    const readerExtension = defineExtension({ name: "app.host-delegate-readers", tools: readers });
    registry.install(readerExtension);
    tools.push(createHostDelegateTool(delegate.definition as Parameters<typeof createHostDelegateTool>[0], {
      assertCurrent() { assert(); lifetime.signal.throwIfAborted(); delegate.assertCurrent(); }, runtime,
      async selectModel(args, parent) {
        if (!parent) throw Error("Delegate parent model required");
        const fullId = `${parent.provider}/${parent.modelId}`;
        if (args.model !== undefined && args.model !== fullId) throw Error("Native Delegate supports parent model inheritance only");
        if (args.task_category !== undefined && !["quick", "summarize", "code", "analyze", "reason"].includes(String(args.task_category))) throw Error("Native Delegate task category not qualified");
        assertDelegateModel(parent); return parent;
      }, assertModelCurrent: assertDelegateModel, readonlyTools: readers, readonlyExtensions: [readerExtension],
    }));
  }
  registry.install(defineExtension({ name: "app.host-builtins", tools }));
  if (plan) registry.install(createHostPlanPrompt(plan.addon, { root, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent(); }, failClosed(error) { lifetime.abort(error); } }));
  const harnessOptions = { models, registry, settings: { retry: { enabled: false } } };
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")?.file;
  if (!path) throw Error("Durable default requires a file-backed application database");
  const storage = new BunSqliteDatabase(path, { root, assertOwner: assert, fenceTransactions: true });
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  let mapping!: { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
  let primary: unknown;
  let failed = false;
  try {
    assert();
    harness = await Harness.open(await SqliteStorage.open(storage), harnessOptions, context);
    const app = await harness.root(context, { agent: { model: { provider: ref.provider, modelId: ref.id }, tools } });
    // The SDK document is the sole routing authority; host binding tables link accepted sources only.
    mapping = await app.commit(async tx => {
      const doc = await tx.doc(ApplicationConversations, app.id);
      return JSON.parse(JSON.stringify(doc)) as typeof mapping;
    }, context);
    if (!mapping.domain) {
      // A fresh host may not have its initial web header until WebChannel construction.
      storeChatMetadata("web:default", new Date().toISOString());
      const chats = root.query("SELECT c.jid, b.branch_id FROM chats c JOIN chat_branches b ON b.chat_jid=c.jid WHERE b.archived_at IS NULL ORDER BY c.jid").all() as { jid: string; branch_id: string }[];
      const bindings = [] as typeof mapping.bindings;
      for (const chat of chats) {
        assert();
        const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: ref.provider, modelId: ref.id }, tools } }, context);
        bindings.push({ chatJid: chat.jid, branchId: chat.branch_id, conversationId: conversation.id, sessionId: crypto.randomUUID() });
      }
      mapping = { version: 1, domain: crypto.randomUUID(), bindings };
      for (const binding of bindings) {
        const identity = { domain: mapping.domain, chatJid: binding.chatJid, branchId: binding.branchId, sessionId: binding.sessionId };
        // Initial creation stores one base, independently anchoring root routing identities.
        const conversation = (await harness.conversation(binding.conversationId as ConversationId, context))!;
        const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
        await conversation.commit(async tx => { await tx.doc(token, conversation.id); }, context);
      }
      await app.commit(async tx => { const doc = await tx.doc(ApplicationConversations, app.id); Object.assign(doc, mapping); }, context);
    }
    validateApplicationMapping(root, mapping);
    if (toolUpgrades.length) {
      // Same-file BEGIN IMMEDIATE fences host admissions for the whole public
      // commit. Repeat global SDK/host preflight under that lock before ANY
      // configuration, not one conversation at a time after partial writes.
      await storage.withIdleModelGuard(() => app.commit(async tx => {
        assert(); assertToolUpgradeIdle(root);
        for (const id of toolUpgrades) {
          const agent = await tx.doc(AgentDoc, id as ConversationId);
          if (!isFactoryDefault(agent.tools)) throw Error("Persisted host tool selection changed");
        }
        assert(); assertToolUpgradeIdle(root);
        for (const id of toolUpgrades) await configure(tx, id as ConversationId, { tools });
        assert(); assertToolUpgradeIdle(root);
      }, context));
    }
  } catch (error) { failed = true; primary = error; }
  // Harness.open may allocate storage before rejecting; the application connection
  // is ours even when no harness was returned. Confirm both layers closed.
  const cleanupFailures: unknown[] = [];
  if (harness) {
    try { await harness.close(context); } catch (error) { cleanupFailures.push(error); }
  }
  try { await storage.close(); } catch (error) { if (!cleanupFailures.includes(error)) cleanupFailures.push(error); }
  if (cleanupFailures.length) throw new RuntimeStartupCleanupError(
    [...(failed ? [primary] : []), ...cleanupFailures], "Application preparation cleanup uncertain");
  if (failed) throw primary;
  assert();
  installTerminalSettlementCompositionSchema(root);
  const payloadDir = join(DATA_DIR, "durable-answers");
  const payloadPath = (ref: string) => join(payloadDir, createHash("sha256").update(ref).digest("hex"));
  const answers = { put(ref: string, text: string) {
    assert(); mkdirSync(payloadDir, { recursive: true });
    const file = payloadPath(ref);
    if (existsSync(file)) { if (readFileSync(file, "utf8") !== text) throw Error("Immutable answer collision"); return; }
    writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  }, resolver: { resolve(ref: string) {
    assert(); const file = payloadPath(ref); if (!existsSync(file)) return null;
    const bytes = new Uint8Array(readFileSync(file));
    return { ref, bytes, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" as const };
  } } };
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership, offlineInitialize: true, answers,
    onRuntime(value) { captureRuntime = value; },
    manifest: mapping.bindings.map(({ chatJid, branchId, conversationId }) => ({ chatJid, branchId, conversationId: conversationId as ConversationId })),
    sessions: new Map(mapping.bindings.map(binding => [binding.chatJid, binding.sessionId])),
    assertConversationAvailable() { check(ref, lifetime.signal); },
    async createConversation(tx, chatJid, branchId) {
      assert(); check(ref, lifetime.signal);
      const doc = await tx.doc(ApplicationConversations, 1 as ConversationId);
      if (doc.domain !== mapping.domain || doc.bindings.some(b => b.chatJid === chatJid || b.branchId === branchId)) throw Error("Application mapping conflict");
      const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, conversation.id, { model: { provider: ref.provider, modelId: ref.id }, tools });
      const binding = { chatJid, branchId, conversationId: conversation.id, sessionId: crypto.randomUUID() };
      const identity = { domain: mapping.domain, chatJid, branchId, sessionId: binding.sessionId };
      const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => identity });
      await tx.doc(token, conversation.id);
      doc.bindings.push(binding);
      assert(); check(ref, lifetime.signal);
      return Object.freeze(binding);
    },
    runtime: { incarnation: mapping.domain, sessionId: mapping.domain, lane: "main", generation: 1, now: () => new Date().toISOString(), harnessOptions } }, context);
  return { sessionOptions: bundle.sessionOptions, bind: bundle.bind,
    stop() { lifetime.abort(); bundle.stop(); }, async close() { lifetime.abort(); await bundle.close(); } };
}
