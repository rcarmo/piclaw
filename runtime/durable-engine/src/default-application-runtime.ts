import { resolveAcceptedMessageThread } from "./host-message-thread.js";
import { modelFailureNotice } from "./host-model-failure.js";
import { storeMessageInDatabase } from "../../src/db/messages.js";
import { getIdentityConfig } from "../../src/core/config.js";
import { recordMessageUsage } from "../../src/agent-pool/usage.js";
import { admitSqliteWrite, type SyncSqliteOperation, isSqliteContention } from "../../src/db/sqlite-async-admission.js";
import { RuntimePreparationError } from "../../src/runtime/preparation-error.js";
import { HostEffectError } from "./host-effects.js";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createNativeTurnView, type NativeTurnViewChannel } from "../../src/channels/web/agent/native-turn-view.js";
import { createLogger } from "../../src/utils/logger.js";
import { registerProcessAdmissionGuard } from "../../src/runtime/process-admission.js";
import { createHostRemotePeerTool } from "./host-remote-peer-tool.js";
import { registerChatTransport } from "../../src/extensions/chat-transport-registry.js";
import { createHostRegretsTool, createHostRegretsPromptExtension, createHostRegretsSettings } from "./host-regrets-tool.js";
import { createHostRegretsBindings } from "./host-regrets-bindings.js";
import { pathToFileURL } from "node:url";
import { qualifyNativeResourceSource, createRootDashboardReader } from "./host-addon-resources.js";
import { addonLocalContextApi } from "../../src/addons/local-context.js";
import { registerOwnedAddonConfigApi, registerAddonConfigKvAuthority } from "../../src/channels/web/handlers/addon-config-api.js";
import { createHash, randomUUID } from "node:crypto";
import { createHostCodexToolGroup, type HostCodexToolGroupAddon } from "./host-codex-tool-group.js";
import { HostCodexModelServices } from "./host-codex-model-services.js";
import { createHostCodexArtifactStore, createHostCodexAnswerMaterializer, renderCodexAnswer } from "./host-codex-artifacts.js";
import type { CodexOperation, NativeCodexFactories } from "./host-codex-model-profile.js";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync,openSync,closeSync,fsyncSync,fstatSync,lstatSync,realpathSync } from "node:fs";
import { readNativeBackgroundContexts,readNativeBackgroundPayloads,publishNativeBackgroundContext,backgroundPolicyProvenance,assertStoredBackgroundExecution,type NativeBackgroundContext } from './host-background-context.js';
import { nativeBackgroundIdentity,assertNativeBackgroundModel,createNativeBackgroundPayload,assertNativeBackgroundDeadline,type NativeBackgroundPayload } from '../../src/agent-pool/background-operation-contract.js';
import { join, extname } from "node:path";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "@earendil-works/chord/context";
import { apply } from "@earendil-works/chord/delta";
import { Harness, AgentDoc, configure, createRegistry, defineDoc, defineExtension, defineTool, type ToolExecutionApi, type ToolHooks, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createCodemodeTool } from "@earendil-works/pi-durable/codemode";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { accessSync, constants } from "node:fs";
import { createReadToolDefinition, SettingsManager, normalizeContext } from "../../src/durable-legacy-sdk.js";
import { assertModelContextFits } from "./host-model-context.js";
import type { RuntimeModelServices } from "../../src/agent-pool/model-services.js";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { getDb, getMessageByRowId, storeChatMetadata } from "../../src/db.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import { DATA_DIR, SESSIONS_DIR, WORKSPACE_DIR } from "../../src/core/config.js";
import { retainModelFailureEvidence } from "./host-model-failure-evidence.js";
import { getPiclawAgentDir } from "../../src/core/agent-dir.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "./application-bootstrap.js";
import { previewHostRequest } from "../../src/agent-pool/model-request-preview.js";
import { createHostModels } from "./host-models.js";
import { readStoredProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";
import { createHostDreamTools } from './host-dream-tools.js';
import { buildDreamPrompt } from '../../src/agent-memory/dream-prompt.js';
import type { NativeDreamRequest,AgentOutput } from '../../src/agent-pool/contracts.js';
import { createHostMcp } from "./host-mcp.js";
import { createHostFetch } from "./host-fetch.js";
import { taskModelRequestScope, taskModelHookScope, taskModelToolScope, withTaskModelRequestScope, type TaskModelRequestScope } from "./task-model-boundary-shim.js";
import { createHostBuiltinTools } from "./host-builtins.js";
import { createHostModelTools, hostModelToolNames, nativeToolInstructions } from "./host-model-controls.js";
import { createHostCommandPolicy } from "./host-command-policy.js";
import { createHostProcessControls, nativeProcessToolNames, nativeProcessInstructions } from "./host-process-controls.js";
import { loadApplicationExtensionCatalog, qualifyInstalledAddon, bindInstalledAddon, qualifyInstalledPlan, qualifyInstalledDelegate, qualifyInstalledCodeReview, qualifyInstalledEditableTable, qualifyInstalledOfficeViewer, qualifyInstalledDrawio, qualifyInstalledGoal, qualifyInstalledObservability, qualifyInstalledRestic, assertApplicationExtensionCatalogSupported } from "./host-extension-catalog.js";
import { createHostDelegateTool } from "./host-delegate-tool.js";
import { createHostDelegateFileReader } from "./host-delegate-files.js";
import { extensionKvGet } from "../../src/db/extension-kv.js";
import { createHostProxmoxTool, type ProxmoxNativeExports } from "./host-proxmox-tool.js";
import { createHostPortainerTool, type PortainerNativeExports } from "./host-portainer-tool.js";
import { createHostImapTool, type ImapNativeExports } from "./host-imap-tool.js";
import { infrastructurePrompt, infrastructureLifecycle } from "./host-addon-prompts.js";
import { createHostPlanTool } from "./host-plan-tool.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import { createHostCodeReviewTool } from "./host-code-review-tool.js";
import { createHostEditableTableTool, type WidgetPublisher } from "./host-editable-table-tool.js";
import { createHostOfficeViewerTool } from "./host-office-viewer-tool.js";
import { createHostDrawioTool, type WorkspaceFileOpener, type DrawioNativeExports } from "./host-drawio-tool.js";
import { createHostPlanPrompt } from "./host-plan-prompt.js";
import { createHostObservabilityPrompt } from "./host-observability.js";
import { createHostResticTool } from "./host-restic-tool.js";
import { createHostGoalTools } from "./host-goal-tools.js";
import { createHostGoalPrompt, GoalRequestDenied } from "./host-goal-prompt.js";
import { createHostGoalTerminalFence } from "./host-goal-terminal.js";
import { createHostGoalInput } from "./host-goal-input.js";
import { isGoalBudgetWrapup } from "./host-goal-usage.js";
import { createHostGoalSettlement, createNativeGoalProjection } from "./host-goal-settlement.js";
import { createHostGoalProgressReader } from "./host-goal-progress.js";
import { createHostGoalPlanReader } from "./host-goal-plan.js";
import { registerAddonConfigApi } from "../../src/channels/web/handlers/addon-config-api.js";
import { createHostGoalConfig } from "./host-goal-config.js";
import { createHostGoalCommand } from "./host-goal-command.js";
import type { HostConversationRuntime } from "./host-runtime.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { registerRootExtensionKvStore } from "../../src/db/register-extension-kv.js";
import { getExtensionKvStore, withExtensionKvAuthority, requireExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import { registerExtensionRoute } from "../../src/channels/web/http/extension-routes.js";

import { HostManagedInstructions, instructionHash, shouldManageInstructions } from "./host-managed-instructions.js";
import { loadHostInstructions } from "./host-instructions.js";
import { detectChannel } from "../../src/router.js";
import { buildChannelSystemPromptAppendix } from "../../src/channels/formatting.js";

const ApplicationConversations = defineDoc({ kind: "app.application-conversations", version: 1,
  scope: "conversation", history: "latest", fork: "initial", checkpointWhen: () => false, initial: () => ({ version: 1, domain: "", bindings: [] as { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] }) });

type ApplicationMapping = { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
const defaultToolNames = ["read", "bash", "edit", "write", "find", "ls", "grep"] as const;

/** Decorate only this executor's public commit port. The SDK owns the SQL
 * transaction; both checks run under its write lock, including store/result and
 * run-journal commits. Private memo/task bookkeeping and parent settlement keep
 * their original API and lifecycle; this is not a global storage policy. */
function withGuardedCommit(api: ToolExecutionApi, assertCurrent: () => void): ToolExecutionApi {
  const originalCommit = api.commit.bind(api);
  const commit: ToolExecutionApi["commit"] = (body, context) => originalCommit(async tx => {
    assertCurrent();
    const value = await body(tx);
    assertCurrent();
    return value;
  }, context);
  return new Proxy(api, { get(target, key) {
    if (key === "commit") return commit;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
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
      !root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=?").get(b.chatJid, b.branchId))) throw Error("Invalid durable application conversation manifest");
}

function readBackgroundPayloadText(ref:string):string|undefined {
  if(typeof ref!=='string'||!/^background:[a-f0-9]{64}$/.test(ref))throw Error('Invalid background payload reference');
  const file=join(DATA_DIR,'durable-answers',createHash('sha256').update(ref).digest('hex'));
  let named;try{named=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  if(!named.isFile()||named.nlink!==1||(process.getuid&&named.uid!==process.getuid())||realpathSync(file)!==file||named.size>1024*1024||(named.mode&0o077)!==0)throw Error('Invalid private background payload file');
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=fstatSync(fd);if(before.dev!==named.dev||before.ino!==named.ino)throw Error('Background payload identity changed');
    const value=readFileSync(fd,'utf8'),after=fstatSync(fd),current=lstatSync(file);
    if(!current.isFile()||current.nlink!==1||(current.mode&0o077)!==0||after.dev!==current.dev||after.ino!==current.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||Buffer.byteLength(value)!==before.size)throw Error('Background payload changed while reading');
    return value;
  }finally{closeSync(fd);}
}

/** Validate persisted SDK storage, conversation identities and execution routes. */
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
      const rows = root.query(`SELECT r.kind,r.version,r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='"app.application-identity"' AND d.scope_kind='conversation' AND d.owner_id=? AND d.retired_at IS NULL ORDER BY r.seq`).all(b.conversationId) as { kind: string; version: number; content: string }[];
      if (rows.length !== 1 || rows[0]!.kind !== "base" || rows[0]!.version !== 1 || rows[0]!.content !== JSON.stringify({ domain: mapping.domain, chatJid: b.chatJid, branchId: b.branchId, sessionId: b.sessionId })) throw Error("Invalid durable application identity");
    }
  }
  const privateContexts=mapping?readNativeBackgroundContexts(root,mapping.domain):[];
  const privatePayloads=mapping?readNativeBackgroundPayloads(root,privateContexts,readBackgroundPayloadText):new Map<string,NativeBackgroundPayload>();
  if (mapping) for (const table of ["piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"]) {
    if (!exists(table)) continue;
    const rows = root.query(`SELECT domain, incarnation, chat_jid, branch_id, conversation_id, operation_id, source_seq,source_id,payload_ref,request_id,request_hash FROM ${table}`).all() as { domain: string; incarnation: string; chat_jid: string; branch_id: string; conversation_id: number; operation_id: string; source_seq: number;source_id:string;payload_ref:string;request_id:string;request_hash:string }[];
    for (const row of rows) {
      const privateContext=privateContexts.find(entry=>entry.chatJid===row.chat_jid&&entry.branchId===row.branch_id&&entry.conversationId===row.conversation_id);
      if(privateContext){
        const payload=privatePayloads.get(row.source_id),id=payload&&nativeBackgroundIdentity(payload.policy);
        const proof=payload&&root.query(`SELECT 1 FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq
          JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=o.operation_id
          WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.kind='internal' AND s.provenance_ref=? AND o.operation_id=?`)
          .get(row.chat_jid,row.source_seq,row.source_id,row.payload_ref,backgroundPolicyProvenance(payload),row.operation_id);
        if(table!=='piclaw_durable_bindings_v1'||!payload||!id||row.domain!==mapping.domain||row.incarnation!==mapping.domain||id.contextKey!==privateContext.contextKey||id.operationId!==row.operation_id||
          id.payloadRef!==row.payload_ref||id.requestId!==row.request_id||row.request_hash!==hashCanonicalRequest({type:'input',requestId:id.requestId,content:payload.prompt})||!proof)throw Error('Invalid private background routing provenance');
        continue;
      }
      const scope = mapping.bindings.find(b => b.chatJid === row.chat_jid && b.branchId === row.branch_id);
      if (row.domain !== mapping.domain || row.incarnation !== mapping.domain || !scope) throw Error("Invalid durable application routing provenance");
      if (scope.conversationId === row.conversation_id) continue;
      // Side forks retain exact source/operation and parent provenance after settlement.
      const side = table === "piclaw_durable_bindings_v1" && root.query(`SELECT b.source_id,b.payload_ref,b.request_id FROM piclaw_durable_bindings_v1 b
        JOIN service_effect_s01_sources s ON s.chat_jid=b.chat_jid AND s.source_seq=b.source_seq AND s.source_id=b.source_id AND s.payload_ref=b.payload_ref
        JOIN service_effect_s01_operations o ON o.operation_id=b.operation_id AND o.chat_jid=b.chat_jid AND o.primary_source_seq=b.source_seq
        JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
        JOIN conversations c ON c.id=b.conversation_id
        WHERE b.domain=? AND b.incarnation=? AND b.operation_id=? AND b.source_seq=? AND b.conversation_id=?
          AND s.kind='internal' AND s.state IN ('claimed','consumed','disposed') AND json_extract(c.record,'$.parent.conversationId')=?
          AND json_extract(c.record,'$.owner.taskId') IS NULL AND json_extract(c.record,'$.owner.conversationId') IS NULL`)
        .get(row.domain, row.incarnation, row.operation_id, row.source_seq, row.conversation_id, scope.conversationId) as { source_id: string; payload_ref: string; request_id: string } | null | false;
      if (side && /^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(side.source_id) &&
        side.payload_ref === side.source_id && side.request_id === side.source_id) continue;
      // Scheduled forks use persisted EF-S07/EF-S01 provenance, including completed occurrences.
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
export async function createDefaultApplicationRuntime(owner: RuntimeLockHandle, getModels: () => Promise<RuntimeModelServices>, remotePeerOptions?: { offlineMaintenance?: boolean; transportFactory?: (options: any) => any; discoveryFactory?: (options: any) => any }): Promise<RuntimeBackend> {
  const offlineMaintenance = remotePeerOptions?.offlineMaintenance === true;
  let processControls: ReturnType<typeof createHostProcessControls> | undefined;
  let closeForProcessControl: (() => Promise<void>) | undefined;
  const assertAdmission = () => {
    if (offlineMaintenance) throw Error("Offline maintenance cannot admit conversations");
    processControls?.assertAdmission();
  };
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
  // Loading retains the static source gate before any extension evaluation.
  // Source qualification alone is never a native binding/provider receipt.
  const codex = await qualifyInstalledAddon(catalog, WORKSPACE_DIR, "codex-conversion");
  const codexHost = codex ? await getModels() : undefined;
  const plan = await qualifyInstalledPlan(catalog, WORKSPACE_DIR);
  const observability = await qualifyInstalledObservability(catalog, WORKSPACE_DIR);
  const restic = await qualifyInstalledRestic(catalog, WORKSPACE_DIR);
  const readObservabilityConfiguration = () => {
    assert(); observability?.assertCurrent();
    const saved = extensionKvGet<Record<string, unknown>>("observability", "config", "global");
    assert(); observability?.assertCurrent();
    return saved;
  };
  const delegate = await qualifyInstalledDelegate(catalog, WORKSPACE_DIR);
  const codeReview = await qualifyInstalledCodeReview(catalog, WORKSPACE_DIR);
  const editableTable = await qualifyInstalledEditableTable(catalog, WORKSPACE_DIR);
  const officeViewer = qualifyInstalledOfficeViewer(catalog, WORKSPACE_DIR);
  const drawio = await qualifyInstalledDrawio(catalog, WORKSPACE_DIR), goal = await qualifyInstalledGoal(catalog, WORKSPACE_DIR);
  const lifetime = new AbortController(), terminalLifetime = new AbortController();
  // Fatal source errors seal execution. Passive reporting retains its own
  // database lifetime until SDK shutdown has joined provider calls.
  const usageReports = new Set<Promise<void>>();
  const reportUsage = (chat: string, message: unknown, id: string, source: "assistant" | "compaction" | "tool") => {
    const fact = structuredClone(message) as Record<string, unknown>;
    const report = admitSqliteWrite(root, () => {
      if (getDb() !== root) throw Error("Usage database binding changed");
      recordMessageUsage(chat, { ...fact, id }, source);
    }, assert, terminalLifetime.signal)
      .catch(error => { log.warn("Token telemetry write failed", { operation: "durable.usage_failed", chatJid: chat, err: error }); })
      .finally(() => usageReports.delete(report));
    usageReports.add(report);
  };
  let notifyStorageFailure!: (error: unknown) => void;
  const storageFailure = new Promise<unknown>(resolve => { notifyStorageFailure = resolve; });
  const remotePeer = await qualifyInstalledAddon(catalog, WORKSPACE_DIR, "remote-peer");
  const remoteNative = remotePeer?.nativeExports["native.ts"] as any;
  let remotePorts: any;
  let remoteClosing: Promise<void> | undefined;
  const remoteDisposers: (() => void)[] = [];
  const assertRemote = () => { assert(); lifetime.signal.throwIfAborted(); remotePeer?.assertCurrent();
    if (readAccessConfig().mode !== "single-user") throw Error("Remote Peer requires single-user policy"); };
  const closeRemote = () => {
    for (const dispose of remoteDisposers.splice(0).reverse()) dispose();
    return remoteClosing ??= remotePorts?.close() ?? Promise.resolve();
  };
  const remoteTool = remotePeer ? createHostRemotePeerTool(remoteNative, { root, cwd: WORKSPACE_DIR, runtime: () => runtime(), assertOwner: assertRemote,
    nativeHostPorts: new Proxy({}, { get(_target, key) { if (!remotePorts) throw Error("Remote Peer not attached"); return remotePorts[key]; } }) }) : undefined;
  // All captured declarations retain their native dispatcher; unsupported exact controls fail closed.
  const remoteReceipt = remotePeer ? bindInstalledAddon(remotePeer, { tools: [remoteTool!], commands: {},
    lifecycle: { resources_discover: () => ({ skillPaths: remotePeer.skillPaths }) } }) : undefined;
  const regrets = await qualifyInstalledAddon(catalog, WORKSPACE_DIR, "late-night-regrets");
  const regretsAddon = regrets?.nativeExports["native.ts"] as any;
  const assertRegrets = () => { assert(); lifetime.signal.throwIfAborted(); regrets?.assertCurrent();
    if (readAccessConfig().mode !== "single-user") throw Error("Regrets requires single-user mode"); };
  const configWrite = <T>(body: SyncSqliteOperation<T>): Promise<T> => getExtensionKvStore().write!<T>("late-night-regrets", body);
  const regretsPorts = (chat: string, assertCurrent = assertRegrets, transactionalWrite = configWrite, accountedDecision?: any) => createHostRegretsBindings({
    root, historyDatabase: root, cwd: WORKSPACE_DIR, chat, assertCurrent, transactionalWrite,
    accessMode: () => readAccessConfig().mode, allowAllChats: () => true,
    readExchanges: regretsAddon.readExchanges,
    async readFile(path) { return existsSync(path) ? readFileSync(path, "utf8") : undefined; },
    async admitConversationInput(text) {
      assertAdmission();
      assertCurrent(); assertRegrets();
      const target = bundle.sessionTargets.list().find(target => target.chatJid === chat);
      if (!target) throw Error("Unbound Regrets chat");
      if (!owner.record.nonce) throw Error("Regrets runtime owner identity unavailable");
      const principal = { id: `runtime-owner:${owner.record.nonce}`, revision: hashCanonicalRequest(owner.record) };
      return bundle.admitApplicationInput({ source: "regrets.command", sourceId: crypto.randomUUID(), text,
        queuedAt: new Date().toISOString(), principal, target, mode: "queue", assertCurrent() { assertCurrent(); assertRegrets(); } });
    }, accountedDecision,
  });
  const regretsCommand = async (chat: string) => {
    assertRegrets();
    return regretsAddon.createLateNightRegrets(regretsPorts(chat)).command();
  };
  let regretsDecision: ((captured: Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>, authority: ReturnType<typeof createHostOperationAuthority>, scope: TaskModelRequestScope) => ReturnType<typeof createHostRegretsBindings>["accountedDecision"]) | undefined;
  const regretsTool = regrets ? createHostRegretsTool(regretsAddon, { root, runtime: () => runtime(), assertOwner: assertRegrets,
    definition: regrets.extension!.tools.get("regrets_review")!.definition as Parameters<typeof createHostRegretsTool>[1]["definition"],
    bind(captured, authority, call) {
      const scope = taskModelToolScope(call);
      if (!scope?.checkpointHash) throw Error('Exact Regrets SDK tool scope required');
      return regretsPorts(captured.operation.chatJid, authority.assertSourceCurrent, body => admitSqliteWrite(root, body, authority.assertCurrent), regretsDecision!(captured, authority, scope));
    },
  }) : undefined;
  const regretsPrompt = regrets ? createHostRegretsPromptExtension(regretsAddon, { async bindBeforeModelRequest(input) {
    assertRegrets();
    const target = bundle.sessionTargets.list().find(target => target.conversationId === input.conversationId);
    if (!target) throw Error("Unbound Regrets prompt conversation");
    // Pure native prompt: config reads only, no execution context or captured operation.
    return { chat: target.chatJid, assertCurrent: assertRegrets, config: { get() { assertRegrets(); return extensionKvGet("late-night-regrets", "config", "global") ?? {}; } } };
  } }) : undefined;
  const regretsReceipt = regrets ? bindInstalledAddon(regrets, { tools: [regretsTool!],
    lifecycle: { resources_discover: () => ({ skillPaths: regrets.skillPaths }) },
    commands: { regrets: regretsCommand } }) : undefined;
  let workspaceFileOpener: WorkspaceFileOpener | undefined;
  let widgetPublisher: WidgetPublisher | undefined;
  let terminalBroadcast: ((type: string, data: Record<string, unknown>) => void) | undefined;
  const pendingTerminalEvents = new Set<string>(), publishedTerminalEvents = new Set<string>();
  const publishTerminal = (operationId: string) => {
    if (publishedTerminalEvents.has(operationId)) return;
    const row = root.query("SELECT rowid,chat_jid FROM messages WHERE id=?").get(`service-terminal:${operationId}`) as { rowid: number; chat_jid: string } | null;
    if (!row) return;
    const interaction = getMessageByRowId(row.chat_jid, row.rowid);
    if (!terminalBroadcast || !interaction) { pendingTerminalEvents.add(operationId); return; }
    try {
      terminalBroadcast("new_post", interaction as unknown as Record<string, unknown>);
      publishedTerminalEvents.add(operationId); pendingTerminalEvents.delete(operationId);
    } catch { pendingTerminalEvents.add(operationId); /* Committed reply remains available on reload. */ }
  };
  const infrastructure = (await Promise.all((["proxmox", "portainer", "imap"] as const).map(kind => qualifyInstalledAddon(catalog, WORKSPACE_DIR, kind)))).filter(item => item !== undefined);
  let mcp: Awaited<ReturnType<typeof createHostMcp>> | undefined;
  let captureRuntime: HostConversationRuntime | undefined;
  let liveChannel: NativeTurnViewChannel | undefined;
  let nativeQueue: Parameters<RuntimeBackend["bind"]>[0]["queue"] | undefined;
  const liveWatches = new Map<string, Promise<() => Promise<void>>>();
  let viewsClosing=false;
  const log = createLogger("native.turn-view");
  const ensureLiveWatch = (chat: string) => {
    if (viewsClosing || !liveChannel || liveWatches.has(chat)) return;
    const target = bundle.sessionTargets.list().find(target => target.chatJid === chat);
    if (!target) return;
    const channel=liveChannel,render=createNativeTurnView(root,{
      broadcastEvent:channel.broadcastEvent.bind(channel),updateAgentStatus:channel.updateAgentStatus?.bind(channel),
      updateThoughtBuffer:channel.updateThoughtBuffer?.bind(channel),updateDraftBuffer:channel.updateDraftBuffer?.bind(channel),
      publishInput(sourceId){
        assert();const row=root.query("SELECT m.rowid FROM messages m JOIN piclaw_durable_bindings_v1 b ON b.chat_jid=m.chat_jid AND b.source_id=m.id WHERE m.chat_jid=? AND m.id=? AND b.conversation_id=? AND m.is_bot_message=0").get(chat,sourceId,target.conversationId) as {rowid:number}|null;
        const post=row&&getMessageByRowId(chat,row.rowid);if(post)channel.broadcastEvent("new_post",post as unknown as Record<string,unknown>);
      },
    },chat);
    const watching = runtime().watchSession({ incarnation: target.domain, chatJid: chat, branchId: target.branchId, conversationId: target.conversationId },
      view => { if (liveChannel === channel) render(view); });
    liveWatches.set(chat, watching);
    void watching.catch(error => { liveWatches.delete(chat); log.error("Conversation watch failed", { chatJid: chat, err: error }); });
  };
  const drainPending = (chat: string, recover=false) => {
    if (viewsClosing || processControls?.pending()) return;
    assert(); ensureLiveWatch(chat);
    // Recover delivery/correlation only for this direct SDK path. Historical
    // host operations/UI intents are never adopted or resubmitted.
    const inputs = root.query(`SELECT s.source_id,m.rowid FROM service_effect_s01_sources s
      JOIN messages m ON m.chat_jid=s.chat_jid AND m.id=s.source_id
      LEFT JOIN piclaw_durable_bindings_v1 b ON b.chat_jid=s.chat_jid AND b.source_seq=s.source_seq
      WHERE s.chat_jid=? AND s.kind='message' AND
        ((s.state='pending' AND s.provenance_ref LIKE 'application:pi-durable%') OR (?=1 AND s.state='consumed' AND b.operation_id LIKE 'native-message:%'))
      ORDER BY s.source_seq`).all(chat,recover?1:0) as {source_id:string;rowid:number}[];
    for (const input of inputs) void bundle.dispatchAcceptedInput(chat,input.source_id,input.rowid)
      .catch(error=>{if(!viewsClosing)log.warn("Native input delivery could not be reconciled",{operation:"native.input_delivery_pending",chatJid:chat,err:error});});
  };
  const stopLiveViews = () => { viewsClosing=true;liveChannel = undefined; };
  const closeLiveViews = async () => {
    stopLiveViews();
    await Promise.allSettled([...liveWatches.values()].map(async pending => { const stop = await pending; await stop(); }));
    liveWatches.clear();
  };
  const wakeGoalFollowups = (chat: string) => { assert(); if(!lifetime.signal.aborted)drainPending(chat); };
  const runtime = () => {
    assert(); lifetime.signal.throwIfAborted();
    if (!captureRuntime) throw Error("Host capture runtime unavailable");
    return captureRuntime;
  };
  const captureSource = async (call: { conversationId: ConversationId; taskId: import("@earendil-works/pi-durable").TaskId; toolCallId: string }) => {
    const dream = await captureDreamSource({conversationId:call.conversationId,taskId:call.taskId,taskKind:'pi.tool',callId:call.toolCallId,signal:taskModelToolScope(call)?.signal});
    if(dream)return dream.assertCurrent;
    const captured = await runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
    const authority = createHostOperationAuthority(root, captured, () => {
      assert(); lifetime.signal.throwIfAborted(); runtime().assertCapturedSourceCurrent(captured.inputs);
    }, true);
    return () => { authority.assertCurrent();if (captured.delegateModel) assertDelegateModel(captured.delegateModel); };
  };
  let assertDelegateModel: (model: { provider: string; modelId: string }) => void = () => { throw Error("Delegate unavailable"); };
  const infrastructureTools = infrastructure.map(qualified => {
    const options = { root, runtime, assertOwner() { assert(); lifetime.signal.throwIfAborted(); qualified.assertCurrent(); } };
    const native = qualified.nativeExports["index.ts"]!;
    return qualified.kind === "proxmox" ? createHostProxmoxTool(native as unknown as ProxmoxNativeExports, options)
      : qualified.kind === "portainer" ? createHostPortainerTool(native as unknown as PortainerNativeExports, options)
      : createHostImapTool(native as unknown as ImapNativeExports, options);
  });
  let bundle!: Awaited<ReturnType<typeof createApplicationBootstrapBundle>>;
  const dreamOwners=new Map<string,{payload:NativeBackgroundPayload;assertCurrent():void}>();
  const assertDreamCurrent=(payload:NativeBackgroundPayload)=>{
    const owned=dreamOwners.get(payload.policy.sourceId);if(!owned||JSON.stringify(owned.payload)!==JSON.stringify(payload))throw Error('Live Dream invocation unavailable');owned.assertCurrent();
    assertNativeBackgroundDeadline(payload.policy,Date.now());
  };
  const assertBackgroundCurrent=(payload:NativeBackgroundPayload)=>{if(payload.policy.origin.kind!=='dream')throw Error('Retired add-on background execution is unavailable');assertDreamCurrent(payload);};
  const maintenanceRequests = new WeakMap<AbortSignal, { chatJid: string; workId: string; operationId?: string; assertCurrent(): void }>();
  const requestSources = new WeakMap<AbortSignal, Awaited<ReturnType<HostConversationRuntime["captureRunSource"]>>>();
  const dreamRequests = new WeakMap<AbortSignal, Awaited<ReturnType<typeof captureDreamSource>>>();
  let assertDreamModel: (model: NativeBackgroundPayload['policy']['model']) => void = () => { throw Error('Dream model authority unavailable'); };
  async function captureDreamSource(scope:{conversationId:number;taskId:number;taskKind:'pi.generation'|'pi.compaction'|'pi.tool';callId?:string;signal?:AbortSignal}){
    const source=bundle.dreamSourceFor(scope.conversationId);if(!source)return;
    const owned=dreamOwners.get(source.payload.policy.sourceId);if(!owned)throw Error('Live Dream invocation unavailable');
    const current=()=>{
      assert();lifetime.signal.throwIfAborted();scope.signal?.throwIfAborted();
      if(dreamOwners.get(source.payload.policy.sourceId)!==owned)throw Error('Dream invocation owner changed');
      assertDreamCurrent(source.payload);
      assertDreamModel(source.payload.policy.model);
      assertStoredBackgroundExecution(root,source.context.conversationId,source.payload);
    };
    current();await runtime().qualifyDreamSource(source.context,source.payload,scope,current);current();
    return Object.freeze({...source,assertCurrent:current});
  }
  const codexNative = {} as HostCodexToolGroupAddon & NativeCodexFactories & Record<string, any>;
  for (const exports of Object.values(codex?.nativeExports ?? {})) for (const [name, value] of Object.entries(exports)) {
    if (name in codexNative && codexNative[name] !== value) throw Error("Ambiguous qualified Codex export: " + name);
    codexNative[name] = value;
  }
  const assertCodex = () => { assert(); lifetime.signal.throwIfAborted(); codex?.assertCurrent(); if (!owner.record.nonce) throw Error("Codex application owner identity unavailable"); };
  const outputs = new Map<string, any>();
  const outputBindings = new WeakMap<CodexOperation, ReturnType<typeof createHostCodexArtifactStore>>();
  const accountBindings = new WeakMap<CodexOperation, { turnId: string; accountRef: string | null; provider: object | undefined }>();
  const codexAuthPath = join(getPiclawAgentDir(), "auth.json");
  const codexServices = codex ? new HostCodexModelServices({
    preserveHostTools: true,
    async capture(signal, model, original) {
      assertCodex();
      const scope = taskModelRequestScope(original);
      if (!scope) throw Error("Codex native task source unavailable");
      const captured = scope.taskKind === "pi.generation" ? requestSources.get(scope.signal) : undefined;
      const dream=dreamRequests.get(scope.signal);
      if (scope.taskKind === "pi.generation" && !captured && !dream) throw Error("Codex generation source unavailable");
      const sourceCurrent = () => { assertCodex(); signal.throwIfAborted(); scope.signal.throwIfAborted();
        if(dream)dream.assertCurrent();else if (captured) runtime().assertCapturedSourceCurrent(captured.inputs); else { const maintenance = maintenanceRequests.get(scope.signal); if (!maintenance) throw Error("Compaction source capture unavailable"); maintenance.assertCurrent(); } };
      sourceCurrent();
      const accountRef = readStoredProviderUsageAccountRef(model.provider, codexAuthPath);
      const accountProvider = codexHost!.modelRuntime.getRegisteredNativeProvider(model.provider);
      if (["openai-codex", "github-copilot"].includes(model.provider) && !accountRef) throw Error("Codex profile account identity unavailable");
      const current = () => {
        sourceCurrent();
        if (readStoredProviderUsageAccountRef(model.provider, codexAuthPath) !== accountRef ||
            codexHost!.modelRuntime.getRegisteredNativeProvider(model.provider) !== accountProvider) throw Error("Codex source account changed");
        const physical = codexHost!.modelRuntime.getPhysicalModel(model.provider, model.id);
        if (!physical || physical.api !== model.api || model.input.some(mode => !physical.input.includes(mode))) throw Error("Codex source capability changed");
      };
      const operation: CodexOperation = Object.freeze({ id: randomUUID(), sessionId: "native-conversation:" + scope.conversationId,
        cwd: WORKSPACE_DIR, model: Object.freeze({ provider: model.provider, id: model.id, api: model.api, input: Object.freeze([...model.input]) }),
        signal, profilePrompt: scope.taskKind === "pi.generation", assertCurrent: current });
      // Physical task IDs change each tool round. Keep the actual accepted SDK
      // input identity separate from Delegate and maintenance request scopes.
      const turnId = dream?.payload.policy.sourceId ?? (captured ? captured.operation.operationId : maintenanceRequests.get(scope.signal)!.workId);
      accountBindings.set(operation, { turnId, accountRef, provider: accountProvider });
      if (captured || dream && scope.taskKind === "pi.generation") outputBindings.set(operation, createHostCodexArtifactStore(root, operation, {
        hostOperationId: turnId, chatJid: dream?.context.chatJid ?? captured!.operation.chatJid, assertCurrent: current,
        write(body) { return admitSqliteWrite(root, body, current, signal); },
      }));
      return operation;
    },
    routingScope(operation) {
      operation.assertCurrent();
      const binding = accountBindings.get(operation);
      if (!binding) throw Error("Codex routing authority unavailable");
      // A compaction summarizer has no tool loop. Retire its hint even if the
      // task fails before its normal maintenance cleanup.
      return { ...binding, requestOnly: operation.profilePrompt === false };
    },
    assertAccount(operation) {
      operation.assertCurrent();
      const binding = accountBindings.get(operation);
      if (!binding || readStoredProviderUsageAccountRef(operation.model.provider, codexAuthPath) !== binding.accountRef ||
          codexHost!.modelRuntime.getRegisteredNativeProvider(operation.model.provider) !== binding.provider) throw Error("Codex provider/account identity changed");
      if (!codexHost!.modelRegistry.getAvailable().some(m => m.provider === operation.model.provider && m.id === operation.model.id)) throw Error("Codex account/model unavailable");
      const actual = codexHost!.modelRuntime.getPhysicalModel(operation.model.provider, operation.model.id);
      if (!actual || actual.api !== operation.model.api) throw Error("Codex physical model changed");
    },
    async observe(operation, response, beforeEffect) {
      beforeEffect();
      let output = outputs.get(operation.id);
      if (!output) {
        output = await codexNative.createNativeCodexOutput(operation, async (actual: CodexOperation, activity: any) => {
          beforeEffect(); const store = outputBindings.get(actual);
          if (activity.kind === "image" && !store) throw Error("Maintenance image output is not authorised");
          if (store) await store.publish(actual, activity);
        });
        beforeEffect(); outputs.set(operation.id, output);
      }
      try { await output.capture(response); beforeEffect(); }
      catch (error) { if (output.discardFailedCapture()) outputs.delete(operation.id); throw error; }
    },
    async flush(operation) { const output = outputs.get(operation.id); if (output) {
      try { await output.finish(); outputs.delete(operation.id); }
      catch (error) { if (output.discardFailedCapture()) outputs.delete(operation.id); throw error; }
    } },
  }, codexNative) : undefined;
  const codexDeclarations = new Map<string, any>([...(codex?.extension?.tools.values() ?? [])].map((tool: any) => [tool.definition.name, tool.definition]));
  const codexTarget = (chat: string) => { assertCodex(); const target = bundle.sessionTargets.list().find(t => t.chatJid === chat); if (!target) throw Error("Codex session target unavailable"); return bundle.sessionTargets.resolve(target); };
  const codexGroup = codex ? createHostCodexToolGroup(codexNative, {
    process: { root, runtime, assertOwner: assertCodex, ownerIncarnation: owner.record.nonce!, declarations: codexDeclarations,
      async bind(chat) { const target = codexTarget(chat); return { cwd: WORKSPACE_DIR, sessionRevision: target.revision }; } },
    applyPatch: codexDeclarations.get("apply_patch"),
    provider: { root, runtime, assertOwner: assertCodex, declarations: codexDeclarations,
      metadata() {
        assertCodex();
        // Registry validation admits the supported schema union; each request advertises
        // the exact source-model schema and execution independently checks that model.
        const available = codexHost!.modelRegistry.getAvailable();
        const selected = available.find(model => codexNative.createNativeCodexHooks(model)
          .toolDeclarations!([{ name: "view_image", parameters: { properties: {} as Record<string, unknown> } }])[0]!.parameters.properties.detail) ?? available[0];
        if (!selected) throw Error("Codex model metadata unavailable");
        return { cwd: WORKSPACE_DIR, model: selected };
      },
      async bind({chatId, signal, assertCurrent, sourceModel}) {
        const target = codexTarget(chatId);
        const model = codexHost!.modelRuntime.getPhysicalModel(sourceModel.provider, sourceModel.id);
        assertCurrent(); bundle.sessionTargets.resolve(target);
        if (!model || model.api !== sourceModel.api) throw Error("Codex physical source model unavailable");
        return { chatId, cwd: WORKSPACE_DIR, model, signal, assertCurrent,
          async readImage(input) {
            const check = () => { input.assertCurrent(); input.signal?.throwIfAborted(); };
            check();
            const read = createReadToolDefinition(WORKSPACE_DIR, { autoResizeImages: !input.original, operations: {
              readFile: async path => { check(); return readFileSync(path); },
              access: async path => { check(); accessSync(path, constants.R_OK); },
              detectImageMimeType: async path => { check(); return ({".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".bmp":"image/bmp"} as Record<string,string>)[extname(path).toLowerCase()]; },
            } });
            const result = await read.execute(input.toolCallId, { path: input.path }, input.signal, undefined, undefined as never); check(); return result;
          },
        };
      },
    },
  }) : undefined;
  let providerBinding: { check(): void } | undefined;
  const codexProviderRegistrations = [...catalog.runtime.pendingProviderRegistrations];
  if (codex) {
    // The qualified legacy override only decorates Responses streamSimple.
    // Its replacement is the owned constructor pipeline above, not that legacy closure.
    if (codexProviderRegistrations.length !== 1 || codexProviderRegistrations[0]!.name !== "openai-codex" ||
        codexProviderRegistrations[0]!.config.api !== "openai-codex-responses" ||
        typeof codexProviderRegistrations[0]!.config.streamSimple !== "function" ||
        Object.keys(codexProviderRegistrations[0]!.config).some(key => !["api", "streamSimple"].includes(key)) ||
        catalog.runtime.pendingNativeProviderRegistrations.length || catalog.runtime.pendingVirtualModelRegistrations.length)
      throw Error("Unsupported Codex provider override contract");
    const provider = codexHost!.modelRuntime.getRegisteredNativeProvider("openai-codex") ?? codexHost!.modelRuntime.getProvider("openai-codex");
    if (!provider) throw Error("Codex native base provider unavailable");
    providerBinding = codexNative.bindNativeCodexProvider({ setProvider: (p: any) => codexServices!.register(codexHost!.modelRuntime,p), getProvider: (id: string) => codexHost!.modelRuntime.getRegisteredNativeProvider(id) }, provider, () => closeCodex());
  }
  const codexReceipt = codex ? bindInstalledAddon(codex, {
    tools: codex.capabilities.tools.map(name => { const tool = codexGroup!.tools.find(tool => tool.name === name); if (!tool) throw Error("Missing Codex native tool: " + name); return tool; }),
    commands: {},
    // These are the concrete native entrypoints, not legacy event adapters.
    // Model phases are composed by bind(); execution state comes from the SDK
    // task wrapping execute(). Legacy exploration render caches remain in the
    // unchanged TUI entry; Smith Web never consumed those component callbacks.
    lifecycle: {
      session_start: codexServices!.register.bind(codexServices),
      model_select: codexServices!.bind.bind(codexServices),
      message_start: codexNative.createNativeCodexOutput,
      agent_end: flushCodexOutputs,
      tool_execution_start: codexGroup!.tools.find(tool => tool.name === "exec_command")!.execute!,
      tool_execution_end: codexGroup!.tools.find(tool => tool.name === "exec_command")!.execute!,
      session_shutdown: closeCodex,
      before_agent_start: codexServices!.bind.bind(codexServices),
      before_provider_headers: codexServices!.bind.bind(codexServices),
      before_provider_request: codexServices!.bind.bind(codexServices),
      context: codexServices!.bind.bind(codexServices),
    },
    provider: { registrations: codexProviderRegistrations, assertCurrent() { assertCodex(); providerBinding!.check(); } },
  }) : undefined;
  async function closeCodex() { codexServices?.dispose(); codexGroup?.dispose(); await flushCodexOutputs(); }
  async function flushCodexOutputs() {
    const entries = [...outputs];
    const results = await Promise.allSettled(entries.map(async ([id, output]) => { try { await output.finish(); outputs.delete(id); }
      catch (error) { if (output.discardFailedCapture()) outputs.delete(id); throw error; } }));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Codex output cleanup uncertain");
  }
  const resourceDisposers: (() => void)[] = [];
  const resourceKinds = ["diagram-tools", "export-timeline-pdf", "kanban-editor", "yolo-vibe", "mindmap", "web-viewer", "eml-viewer", "session-dashboard"] as const;
  const resourceReceipts = [];
  const resourceQualifications: NonNullable<Awaited<ReturnType<typeof qualifyInstalledAddon>>>[] = [];
  try {
    for (const kind of resourceKinds) {
      const qualified = await qualifyInstalledAddon(catalog, WORKSPACE_DIR, kind);
      if (!qualified) continue;
      resourceQualifications.push(qualified);
      const source = await qualifyNativeResourceSource(kind, pathToFileURL(join(qualified.source.packageDir, "native-resources.ts")));
      qualified.assertCurrent();
      const pkg = JSON.parse(readFileSync(join(qualified.source.packageDir, "package.json"), "utf8"));
      const descriptor = source.descriptor;
      if (JSON.stringify(descriptor.webEntries) !== JSON.stringify(pkg.pi?.web?.entries ?? []) ||
          JSON.stringify(descriptor.skillPaths.map(p => join(qualified.source.packageDir, p)).sort()) !== JSON.stringify([...qualified.skillPaths].sort()) ||
          JSON.stringify(descriptor.routes) !== JSON.stringify(qualified.capabilities.routes) ||
          JSON.stringify(descriptor.settingsActions) !== JSON.stringify(qualified.capabilities.configActions)) throw Error("Native resource declaration mismatch: " + kind);
      let registration: ReturnType<typeof registerOwnedAddonConfigApi> | undefined;
      const isCurrent = () => { assert(); lifetime.signal.throwIfAborted(); qualified.assertCurrent(); return true; };
      if (source.factory) {
        const scope = { ownerId: "default", authScope: "single-user:operator:root" };
        const reader = createRootDashboardReader({ root, scope, isCurrent, sessionTargets: () => bundle.sessionTargets,
          canReadTarget(request, target) {
            isCurrent();
            return readAccessConfig().mode === "single-user" && request.ownerId === scope.ownerId && request.authScope === scope.authScope &&
              !!root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL AND handle_owner_id=''").get(target.chatJid, target.branchId);
          } });
        const dispose = source.factory({ scope, reader, isCurrent,
          authorize(req: Request, requested: typeof scope) {
            const operator = addonLocalContextApi.getRequestContext(req);
            return readAccessConfig().mode === "single-user" && operator?.kind === "operator" && operator.accessMode === "single-user" &&
              operator.ownerId === requested.ownerId && requested.authScope === scope.authScope;
          },
          register(addon: string, action: string, handlers: any) {
            registration = registerOwnedAddonConfigApi(addon, action, handlers, qualified.source.packageDir);
            return registration.dispose;
          } });
        resourceDisposers.push(dispose);
      }
      resourceReceipts.push(bindInstalledAddon(qualified, { tools: [], lifecycle: {}, commands: {}, resources: {
        assertCurrent() { isCurrent(); registration?.assertCurrent(); }
      } }));
    }
  } catch (error) { for (const dispose of resourceDisposers.reverse()) dispose(); throw error; }
  const closeResources = () => { for (const dispose of resourceDisposers.splice(0).reverse()) dispose(); };
  const receipts = infrastructure.map((qualified, index) => bindInstalledAddon(qualified, {
    tools: [infrastructureTools[index]!], lifecycle: infrastructureLifecycle(qualified), commands: {},
  }));
  try {
    assert(); assertApplicationExtensionCatalogSupported(catalog, plan, delegate, codeReview, editableTable, officeViewer, drawio, goal, observability, restic, [...receipts, ...resourceReceipts, ...(remoteReceipt ? [remoteReceipt] : []), ...(regretsReceipt ? [regretsReceipt] : []), ...(codexReceipt ? [codexReceipt] : [])]);
    if (goal && !plan) throw Error("Native Goal requires qualified Plan");
  } catch (error) { closeResources(); throw error; } finally { catalog.runtime.invalidate("Application extension preflight ended"); }
  let infrastructureClosed = false;
  const closeInfrastructure = () => { if (infrastructureClosed) return; infrastructureClosed = true; for (const qualified of infrastructure) if (qualified.kind === "imap") (qualified.nativeExports["index.ts"]!.disposeImapPool as () => void)(); };
  const baseApplicationToolNames: readonly string[] = [...defaultToolNames, ...hostModelToolNames, ...nativeProcessToolNames, ...(codexGroup?.tools.map(tool => tool.name) ?? []), "codemode", ...(remotePeer ? ["remote_peer"] : []), ...(regrets ? ["regrets_review"] : []), ...infrastructureTools.map(tool => tool.name), ...(restic ? ["restic"] : []), ...(goal ? ["get_goal", "create_goal", "goal_complete", "goal_stop", "update_goal"] : []), ...(plan ? ["plan"] : []), ...(delegate ? ["delegate"] : []), ...(codeReview ? ["code_review"] : []), ...(editableTable ? ["editable_table"] : []), ...(officeViewer ? ["open_office_viewer"] : []), ...(drawio ? ["open_drawio_editor"] : [])];
  const fetchDefault = [...baseApplicationToolNames, "fetch"];
  const previousDefault = baseApplicationToolNames.filter(name => name !== "codemode");
  let previousModelDefault: readonly string[] = [];
  let previousProcessDefault: readonly string[] = [];
  const completeToolSet = (value: unknown, names: readonly string[]) => Array.isArray(value) && value.length === names.length && new Set(value).size === names.length && names.every(name => value.includes(name));
  const isFactoryDefault = (value: unknown) => isOldDefault(value) || completeToolSet(value, defaultToolNames) ||
    completeToolSet(value, previousDefault) || completeToolSet(value, fetchDefault) ||
    completeToolSet(value, baseApplicationToolNames) || completeToolSet(value, previousModelDefault) ||
    completeToolSet(value, previousModelDefault.filter(name => name !== "codemode")) ||
    completeToolSet(value, previousProcessDefault) || completeToolSet(value, previousProcessDefault.filter(name => name !== "fetch")) ||
    completeToolSet(value, previousProcessDefault.filter(name => !(hostModelToolNames as readonly string[]).includes(name)));
  let drawioHost: ReturnType<DrawioNativeExports["bindDrawioVendorHost"]> | undefined;
  let sandbox: CodemodeSandbox | undefined;
  let sandboxClose: Promise<void> | undefined;
  const closeSandbox = () => sandboxClose ??= sandbox?.close() ?? Promise.resolve();
  const releaseReviewSource = codeReview?.addon.setReviewDatabaseSource({ database: root, assertOwner: assert,
    admitWrite: body => admitSqliteWrite(root, body, () => { assert(); codeReview!.assertCurrent(); }) });
  if (codeReview) await codeReview.addon.prepareReviewService();
  const assertObservability = () => { assert(); lifetime.signal.throwIfAborted(); observability?.assertCurrent(); };
  let releaseObservabilityConfiguration: (() => void) | undefined;
  let releaseAdminKv: (() => void) | undefined;
  try {
    // Native consumers are qualified separately from generic installed add-ons.
    // Keep their exact namespaces and source assertions after legacy preflight ends.
    const nativeConfigOwners = new Map<string, { assertCurrent(): void } | undefined>([
      ["goal", goal], ["observability", observability], ["plan-sidebar", plan],
      ["delegate", delegate], ["code-review", codeReview],
    ]);
    releaseAdminKv = registerAddonConfigKvAuthority((extensionId, chatJid, request) => {
      const qualified = infrastructure.find(item => item.kind === extensionId) ?? resourceQualifications.find(item => item.kind === extensionId) ?? (regrets?.kind === extensionId ? regrets : undefined)
        ?? nativeConfigOwners.get(extensionId);
      if (!qualified) throw Error("Addon configuration namespace denied");
      const assertCurrent = () => { assert(); lifetime.signal.throwIfAborted(); qualified.assertCurrent();
        if (readAccessConfig().mode !== "single-user") throw Error("Configuration requires single-user policy"); };
      assertCurrent();
      return { extensionId, chatJid, globalRead: extensionId !== "session-dashboard" && extensionId !== "goal", globalWrite: extensionId !== "session-dashboard" && extensionId !== "goal", assertCurrent,
        admitWrite<T>(body: SyncSqliteOperation<T>) {
          if (request.method !== "POST") throw Error("Extension KV scope denied");
          const current = () => this.assertCurrent();
          return admitSqliteWrite(root, body, current, request.signal, undefined, current);
        },
        write: body => {
          if (request.method !== "POST") throw Error("Extension KV scope denied");
          assertCurrent(); if (!root.inTransaction) throw Error("Admitted configuration write transaction required");
          const result = body(); assertCurrent(); return result;
        } };
    });
  if (observability) releaseObservabilityConfiguration = observability.addon.bindObservabilityConfiguration({
    assertCurrent: assertObservability, read: readObservabilityConfiguration,
    write(config) { const store = getExtensionKvStore(); return store.write!("observability", () => store.set("observability", "config", config, "global")); },
  });
  mcp = await createHostMcp({ offlineMaintenance, assertCurrent() { assert(); lifetime.signal.throwIfAborted(); },
    captureSource: api => captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId }) });
  const applicationToolNames = [...baseApplicationToolNames, "fetch", ...mcp.tools.map(tool => tool.name)];
  previousModelDefault = applicationToolNames.filter(name => !(hostModelToolNames as readonly string[]).includes(name));
  previousProcessDefault = applicationToolNames.filter(name => !(nativeProcessToolNames as readonly string[]).includes(name));
  if (drawio) {
    drawioHost = drawio.addon.bindDrawioVendorHost({
      assertCurrent() { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent(); },
      baseDir: drawio.source.packageDir, cwd: WORKSPACE_DIR,
      cacheDir: drawio.addon.getDrawioVendorCacheDir(DATA_DIR),
    });
    // SDK evaluation and native imports can have distinct module state. Route
    // the existing owner/prefix to the same native module that owns preparation.
    if (registerExtensionRoute("/drawio", (request, pathname) => {
      try { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent(); }
      catch { return new Response("Draw.io vendor unavailable", { status: 503 }); }
      return drawio.addon.handleRoute(request, pathname);
    }, drawio.source.packageDir) === "rejected") throw Error("Draw.io native route unavailable");
    if (!offlineMaintenance) await drawioHost.prepare();
  }
  if (observability && !offlineMaintenance) {
    assertObservability();
    await observability.addon.prepareObservabilityRuntime(assertObservability);
    assertObservability();
  }
  const host = codexHost ?? await getModels(); assert();
  const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
  // Only the host's authenticated/approved catalog grants admission, never getAll().
  const available = host.modelRegistry.getAvailable().filter(model => {
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    return physical?.provider === model.provider && physical.id === model.id;
  });
  const selected = provider && modelId ? available.find(model => model.provider === provider && model.id === modelId) : available[0];
  if (!selected) throw Error("Durable startup requires an available host default model");
  const ref = { provider: selected.provider, id: selected.id };
  const defaultThinking = (model: any) => getSupportedThinkingLevels(model).includes("medium") ? "medium" as const : getSupportedThinkingLevels(model)[0]!;
  // Allocate/recover the shared namespace before any accepted task or API read.
  codeReview?.addon.reviewService();
  const check = (model: { provider: string; id: string }, signal: AbortSignal) => {
    assertAdmission(); assert(); signal.throwIfAborted();
    if (!available.some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model not approved");
    if (!host.modelRegistry.getAvailable().some(entry => entry.provider === model.provider && entry.id === model.id)) throw Error("Host model no longer available");
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
    if (!physical || physical.provider !== model.provider || physical.id !== model.id) throw Error("Host model no longer available");
  };
  assertDreamModel = model => {
    check({ provider: model.provider, id: model.modelId }, lifetime.signal);
    const physical = host.modelRuntime.getPhysicalModel(model.provider, model.modelId);
    if (!physical || physical.api !== model.api) throw Error('Dream source model changed');
  };
  const instructionsFor = (chatJid?: string) => loadHostInstructions({ cwd: WORKSPACE_DIR, agentDir: getPiclawAgentDir(),
    projectTrusted: true, additionalSkillPaths: [...settings.getSkillPaths(), ...infrastructure.flatMap(item => [...item.skillPaths]), ...resourceQualifications.flatMap(item => [...item.skillPaths]), ...(regrets?.skillPaths ?? [])],
    channelAppendix: [nativeToolInstructions, nativeProcessInstructions, chatJid ? buildChannelSystemPromptAppendix(detectChannel(chatJid), chatJid) ?? "" : "", ...infrastructure.map(infrastructurePrompt)].filter(Boolean).join("\n\n") });
  const instructionUpgrades = new Map<number, string>();
  const toolUpgrades: number[] = [];
  // Validate stored choices without opening/writing SDK documents or bundle ports.
  if (root.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'").get()) {
    const manifest = root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"' AND owner_id=1 AND retired_at IS NULL`).get() as { id: number };
    const mapping = storedDocument(root, manifest.id) as ApplicationMapping;
    const active = new Set([1, ...mapping.bindings.map(binding => binding.conversationId)]);
    // The preflight proves private metadata and historical binding provenance.
    // Fresh Dream uses SDK input evidence; retained old choices remain readable
    // without becoming execution authority.
    const privateIds = new Set(readNativeBackgroundContexts(root, mapping.domain).map(binding => binding.conversationId));
    if ([...privateIds].some(id => active.has(id))) throw Error('Private background context overlaps a public route');
    const docs = root.query(`SELECT id, owner_id, scope_kind FROM documents WHERE kind='"pi.agent"' AND retired_at IS NULL`).all() as { id: number; owner_id: number; scope_kind: string }[];
    for (const doc of docs) {
      const stored = storedDocument(root, doc.id) as { model?: { provider: string; modelId: string }; tools?: unknown; extensions?: unknown; instructions?: string };
      if (doc.scope_kind !== "conversation" || !active.has(doc.owner_id)) continue;
      // Resume through pi-durable; current source, model and tool fences apply at execution.
      // Only the recognised previous factory default converges. Explicit custom
      // subsets/filters, modelTools, instructions and extensions remain intact.
      if (!mcp.deferredMaintenance && isFactoryDefault(stored.tools) && Array.isArray(stored.tools) &&
          (stored.tools.length !== applicationToolNames.length || stored.tools.some(name => !applicationToolNames.includes(name)))) toolUpgrades.push(doc.owner_id);
      const desired = instructionsFor(mapping.bindings.find(b => b.conversationId === doc.owner_id)?.chatJid);
      const metadata = root.query(`SELECT id FROM documents WHERE kind='"app.host-managed-instructions"' AND scope_kind='conversation' AND owner_id=? AND retired_at IS NULL`).get(doc.owner_id) as { id: number } | null;
      const managedHash = metadata ? storedDocument(root, metadata.id).managedHash : undefined;
      if (shouldManageInstructions(stored.instructions, managedHash) &&
        (stored.instructions !== desired || managedHash !== instructionHash(desired))) instructionUpgrades.set(doc.owner_id, desired);
    }
    if (toolUpgrades.length || instructionUpgrades.size) {
      assert();
      try { assertToolUpgradeIdle(root); }
      catch (error) {
        if (!(error instanceof Error) || !["Host tool upgrade requires idle host work", "Host tool upgrade requires idle SDK work"].includes(error.message)) throw error;
        // Recover admitted work with its persisted configuration before changing
        // tools or instructions. Upgrade guards still apply to explicit changes.
        toolUpgrades.length = 0;
        instructionUpgrades.clear();
      }
    }
  }
  // Automatic selection inherits the parent; explicit exact models use the same
  // installed approval/classification/exclusion policy, without a parent-tier cap.
  assertDelegateModel = (model: { provider: string; modelId: string }) => {
    if (!delegate) throw Error("Native Delegate unavailable");
    delegate.assertCurrent(); check({ provider: model.provider, id: model.modelId }, lifetime.signal);
    const config = extensionKvGet("delegate", "config", "global");
    const candidate = { provider: model.provider, id: model.modelId, fullId: `${model.provider}/${model.modelId}` };
    if (!delegate.buildModelCandidates([candidate], config).some(entry => entry.id === candidate.fullId)) throw Error("Native Delegate model not approved");
  };
  const sideObservers = new Map<string, NonNullable<import("../../src/agent-pool/contracts.js").SidePromptOptions["onEvent"]>>();
  // SDK hook failures are reported but can still reach the model bridge. Keep
  // expected Goal denials on the exact task-owned signal, never on the app lifetime.
  const goalRequestDenials = new WeakMap<AbortSignal, GoalRequestDenied>();
  const models = createHostModels(host.modelRuntime, available.map(model => ({ provider: model.provider, id: model.id })), { signal: lifetime.signal, codex: codexServices,
    previewRequest: (model, transcript, options) => previewHostRequest(host.modelRuntime, model, transcript, options ?? {}),
    async captureSourceGuard(signal) {
      const scope = taskModelRequestScope(signal);
      if (!scope) throw Error("Native model request source unavailable");
      const denied = goalRequestDenials.get(scope.signal);
      if (denied) { runtime(); throw denied; } // Preserve ownership/fatal-lifetime fences first.
      if(scope.taskKind !== 'pi.generation' && scope.taskKind !== 'pi.compaction') throw Error('Native model task kind unavailable');
      const dream=await captureDreamSource({...scope,taskKind:scope.taskKind});
      if(dream){dreamRequests.set(scope.signal,dream);return dream.assertCurrent;}
      if (scope.taskKind === "pi.generation") {
        const captured = await runtime().captureRunSource(scope.conversationId, scope.taskId);
        requestSources.set(scope.signal, captured);
        let assertGoalInput:(()=>void)|undefined;
        if(goal){
          const authority=createHostOperationAuthority(root,captured,assertGoal,true);
          const inGoal=<T>(body:()=>T)=>withExtensionKvAuthority({extensionId:"goal",chatJid:captured.operation.chatJid,
            assertCurrent:authority.assertCurrent,write:authority.write},body);
          const texts=await runtime().readCapturedInputText(captured.inputs);
          const inputGoal:import("./host-goal-input.js").GoalInputAddon=goal.addon;
          const prepared=inGoal(()=>texts.map(text=>inputGoal.prepareGoalInput(text,captured.operation.chatJid)));
          if(prepared.some(input=>input.decision.action==="handled")&&!inGoal(()=>isGoalBudgetWrapup(goal.addon,captured.operation.chatJid,texts,
              {operationId:captured.operation.operationId,conversationId:captured.inputs[0]!.conversationId}))){
            // Do not renew a stale Goal by capturing its already-revoked state
            // after the prompt hook. Only this SDK round's terminal proof may
            // finish its own Goal; an unrelated stop is never that proof.
            const promptGoal:Parameters<typeof createHostGoalPrompt>[0]=goal.addon;
            const current=inGoal(()=>promptGoal.loadThreadGoal(captured.operation.chatJid));
            if(!current||(current.status!=="complete"&&current.status!=="stopped")||
                !await runtime().hasGoalTerminalResult(scope.conversationId,scope.taskId,
                  {goalId:current.goal_id,generation:current.lifecycle_generation,status:current.status}))throw new GoalRequestDenied("Goal input lifecycle changed");
          }
          // Goal input remains revocable across asynchronous credential/header
          // preparation too. Ordinary human input inherits no Goal grant.
          assertGoalInput=()=>inGoal(()=>{for(const input of prepared)input.assertCurrent();});
        }
        return () => {
          signal!.throwIfAborted();
          runtime().assertCapturedSourceCurrent(captured.inputs);
          assertGoalInput?.();
          if (captured.delegateModel) assertDelegateModel(captured.delegateModel);
        };
      }
      if (scope.taskKind !== "pi.compaction") throw Error("Native model request kind unavailable");
      let maintenance;
      if (runtime().ownsMaintenance(scope.taskId)) {
        const identity = runtime().maintenanceRequestIdentity(scope);
        maintenance = { ...identity, assertCurrent: () => runtime().assertMaintenanceRequest(scope) };
      } else {
        const target = bundle.sessionTargets.list().find(target => target.conversationId === scope.conversationId);
        const captured = await runtime().captureAutomaticCompaction(scope, target && { incarnation: target.domain, ...target });
        maintenance = { ...captured, assertCurrent() { captured.assertCurrent(); if (captured.delegateModel) assertDelegateModel(captured.delegateModel); } };
      }
      maintenanceRequests.set(scope.signal, maintenance);
      maintenance.assertCurrent();
      return maintenance.assertCurrent;
    },
    retainFailure(evidence) {
      assert();
      const id = retainModelFailureEvidence(join(DATA_DIR, "diagnostics", "model-failures"), evidence);
      assert();
      return id;
    },
    captureEventObserver(signal) {
      const captured = signal && requestSources.get(signal);
      if (!captured || captured.delegateModel) return;
      const source = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      if (!source || !sideObservers.has(source.sourceId)) return;
      return {
        assertCurrent() {
          assert(); signal!.throwIfAborted(); runtime().assertCapturedSourceCurrent(captured.inputs);
        },
        // Preserve the return for async misuse detection; the bridge owns the copy.
        onEvent(event) { return sideObservers.get(source.sourceId)?.(event); },
      };
    },
    observeUsage(message, scope) {
      if (!scope?.checkpointHash) return;
      const source = requestSources.get(scope.signal);
      const chat = dreamRequests.get(scope.signal)?.context.chatJid ?? source?.operation.chatJid ?? maintenanceRequests.get(scope.signal)?.chatJid;
      if (chat) reportUsage(chat, message, `native:${mapping.domain}:${scope.taskId}:${scope.checkpointHash}`, scope.taskKind === "pi.compaction" ? "compaction" : "assistant");
    },
    async authorize(model, _kind, signal) { check(model, signal); }, assertCurrent(model, _kind, signal) { check(model, signal); } });
  let decisionSequence = 0;
  regretsDecision = (captured, authority, scope) => ({
    getAvailable() {
      assertRegrets(); authority.assertSourceCurrent();
      return host.modelRuntime.getAvailableSnapshot().filter(model => {
        const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
        return available.some(approved => approved.provider === model.provider && approved.id === model.id) && physical?.provider === model.provider
          && physical.id === model.id && physical.api === model.api;
      });
    },
    async complete(model, context, options) {
      const producer = host.modelRuntime.getProvider?.(model.provider);
      const checkModel = () => {
      assertRegrets(); authority.assertSourceCurrent(); options.signal?.throwIfAborted();
      const physical = host.modelRuntime.getPhysicalModel(model.provider, model.id);
      if (!available.some(a => a.provider === model.provider && a.id === model.id) ||
          !host.modelRuntime.getAvailableSnapshot().some(a => a.provider === model.provider && a.id === model.id) ||
          physical?.provider !== model.provider || physical.id !== model.id || physical.api !== model.api
          || physical.contextWindow !== model.contextWindow || physical.maxTokens !== model.maxTokens
          || host.modelRuntime.getProvider?.(model.provider) !== producer)
        throw Error("Regrets model no longer approved");
      };
      checkModel();
      const normalized = normalizeContext(context);
      const output = await models.previewSimple?.(model, normalized, options);
      checkModel();
      assertModelContextFits(normalized.messages, model, output);
      const message = await host.modelRuntime.completeSimple(model, context, { ...options, transformHeaders: headers => { checkModel(); return headers; } });
      reportUsage(captured.operation.chatJid, message, `native:${mapping.domain}:${scope.taskId}:decision:${decisionSequence++}`, "tool");
      checkModel(); return message;
    },
  });
  const registry = createRegistry();
  // Preserve old persisted extension names without depending on their hook selection.
  registry.install(defineExtension({ name: "app.host-scheduled-source" }));
  const assertGoal = () => { assert(); lifetime.signal.throwIfAborted(); goal?.assertCurrent(); };
  const tools = createHostBuiltinTools({ cwd: WORKSPACE_DIR,
    captureSourceGuard: captureSource,
    authority: { assertAllowed() {
    assert(); lifetime.signal.throwIfAborted();
    if (readAccessConfig().mode !== "single-user") throw Error("Host tool permission denied");
  } }, signal: lifetime.signal, shellPath: () => settings.getShellPath(), names: defaultToolNames });
  const builtins = [...tools];
  processControls = createHostProcessControls({ root, runtime,
    assertOwner() { assert(); if (readAccessConfig().mode !== "single-user") throw Error("Native process control requires single-user policy"); },
    assertHostIdle(input) {
      bundle.assertProcessControlIdle(input);
      if (!nativeQueue) throw Error("Shared execution queue unavailable");
      if (!input) { nativeQueue.assertProcessControlIdle(); return; }
      const message = root.query("SELECT rowid FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=0").get(input.chatJid, input.sourceId) as { rowid: number } | null;
      const chat = input.chatJid;
      const ids = [`durable-recovery:${input.operationId}`, `chat:${chat}`, `resume:${chat}`, `resume:${chat}:wake`,
        ...(message ? [`chat:${chat}:${message.rowid}`, `resume:${chat}:${message.rowid}`, `compaction-resume:${chat}:${input.sourceId}`] : [])];
      nativeQueue.assertProcessControlIdle({ lane: `chat:${chat}`, ids });
    },
    async closeNative() { if (!closeForProcessControl) throw Error("Native cleanup owner unavailable"); await closeForProcessControl(); },
  });
  const releaseProcessAdmission = registerProcessAdmissionGuard(() => processControls!.assertAdmission());
  // A failed/uncertain or successful shutdown stays sealed through process exit.
  resourceDisposers.push(() => { if (!processControls!.pending()) releaseProcessAdmission(); });
  tools.push(...processControls.tools);
  tools.push(...createHostModelTools({
    assertCurrent() { assert(); lifetime.signal.throwIfAborted(); if (readAccessConfig().mode !== "single-user") throw Error("Native model controls unavailable"); },
    prepareContext: (call, model, thinkingLevel, signal) => runtime().prepareToolModelContext(call, model, thinkingLevel, signal),
    available: () => available.filter(model => host.modelRegistry.getAvailable().some(current => current.provider === model.provider && current.id === model.id)),
    assertModel: choice => check({ provider: choice.provider, id: choice.modelId }, lifetime.signal),
    captureSourceGuard: captureSource,
  }));
  tools.push(...infrastructureTools, ...(codexGroup?.tools ?? []));
  if (regretsTool) tools.push(regretsTool);
  if (remoteTool) tools.push(remoteTool);
  tools.push(createHostFetch({ async captureSource(api) {
    const source = await captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
    return () => { source(); if (readAccessConfig().mode !== "single-user") throw Error("Host fetch permission denied"); };
  } }));
  tools.push(...mcp.tools);
  if (restic) tools.push(createHostResticTool(restic.addon, { root, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); restic.assertCurrent(); } }));
  if (goal) tools.push(...createHostGoalTools(goal.addon.createGoalTools, { root, runtime, assertOwner: assertGoal, resolveGoalInput: goal.addon.resolveGoalInput }));
  if (plan) tools.push(createHostPlanTool(plan.definition as Parameters<typeof createHostPlanTool>[0], { root, assertOwner: () => {
    assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent();
  }, runtime, createTool: plan.addon.createPlanTool }));
  if (codeReview) tools.push(createHostCodeReviewTool(codeReview.addon, { root, cwd: WORKSPACE_DIR, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); codeReview.assertCurrent(); } }));
  if (officeViewer) tools.push(createHostOfficeViewerTool(officeViewer.definition as Parameters<typeof createHostOfficeViewerTool>[0], { root, runtime, workspace: WORKSPACE_DIR,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); officeViewer.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Office viewer requires single-user mode");
    } }));
  if (editableTable) tools.push(createHostEditableTableTool(editableTable.addon, { root, runtime, publisher: () => widgetPublisher,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); editableTable.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Editable table requires single-user mode");
    } }));
  if (drawio) tools.push(createHostDrawioTool(drawio.addon, { root, cwd: WORKSPACE_DIR, runtime, opener: () => workspaceFileOpener,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); drawio.assertCurrent();
      if (readAccessConfig().mode !== "single-user") throw Error("Draw.io requires single-user mode");
    } }));
  if (delegate) {
    const readers = builtins.filter(tool => ["read", "grep", "find", "ls"].includes(tool.name));
    const readerExtension = defineExtension({ name: "app.host-delegate-readers", tools: readers });
    const standardExtension = defineExtension({ name: "app.host-delegate-standard", tools: builtins });
    registry.install(readerExtension);
    registry.install(standardExtension);
    tools.push(createHostDelegateTool(delegate.definition as Parameters<typeof createHostDelegateTool>[0], {
      assertCurrent() { assert(); lifetime.signal.throwIfAborted(); delegate.assertCurrent(); }, runtime,
      async selectModel(args, parent) {
        if (args.task_category !== undefined && !["quick", "summarize", "code", "analyze", "reason"].includes(String(args.task_category))) throw Error("Native Delegate task category not qualified");
        let model = parent;
        if (args.model !== undefined) {
          if (typeof args.model !== "string") throw Error("Delegate model must be an exact provider/model ID");
          const slash = args.model.indexOf("/");
          if (slash <= 0 || slash === args.model.length - 1) throw Error("Delegate model must be an exact provider/model ID");
          const provider = args.model.slice(0, slash), modelId = args.model.slice(slash + 1);
          const exact = available.find(entry => entry.provider === provider && entry.id === modelId);
          if (!exact) throw Error("Native Delegate model unavailable");
          model = { provider: exact.provider, modelId: exact.id };
        }
        if (!model) throw Error("Delegate parent model required");
        assertDelegateModel(model); return model;
      }, assertModelCurrent: assertDelegateModel,
      modelSupportsImages(model) {
        assertDelegateModel(model);
        const physical = host.modelRuntime.getPhysicalModel(model.provider, model.modelId);
        return physical?.provider === model.provider && physical.id === model.modelId && physical.input?.includes("image") === true;
      }, readFiles: createHostDelegateFileReader(WORKSPACE_DIR), readonlyTools: readers, readonlyExtensions: [readerExtension], standardTools: builtins, standardExtensions: [standardExtension],
    }));
  }
  sandbox = new CodemodeSandbox({ memoryLimitBytes: 128 * 1024 * 1024 });
  // Native tool description includes discovery instructions. Deliberately no dynamic
  // declaration section: scheduled overrides retain their own model choice.
  const codemode = createCodemodeTool({ sandbox, models: false });
  tools.push(defineTool<typeof codemode.parameters>({ ...codemode, async execute(args, api, context) {
    const sourceCurrent = await captureSource({ conversationId: api.conversationId, taskId: api.taskId, toolCallId: api.callId });
    const assertCurrent = () => { sourceCurrent(); mcp!.assertCurrent(); };
    assertCurrent();
    const result = await codemode.execute(args, withGuardedCommit(api, assertCurrent), context);
    assertCurrent();
    return result;
  } }));
  const dreamTools=createHostDreamTools({assertOwner(){assert();lifetime.signal.throwIfAborted();if(readAccessConfig().mode!=='single-user')throw Error('Dream requires single-user authority');},async capture(call){
    const source=await captureDreamSource({conversationId:call.conversationId,taskId:call.taskId,taskKind:'pi.tool',callId:call.toolCallId,signal:taskModelToolScope(call)?.signal});
    if(!source)throw Error('Exact SDK Dream source required');
    return{chatJid:source.context.chatJid,assertCurrent:source.assertCurrent};
  }});
  registry.install(defineExtension({ name: "app.host-builtins", tools:[...tools,...dreamTools], hooks: processControls.extension.hooks }));
  const backgroundExtension=defineExtension({name:'app.host-background-policy',hooks:[{task:'pi.tool',handlers:{beforeTool:async(call:Parameters<ToolHooks['beforeTool']>[0],api:Parameters<ToolHooks['beforeTool']>[1])=>{
    await captureDreamSource({conversationId:api.conversationId,taskId:api.taskId,taskKind:'pi.tool',callId:call.id});
  }}}]});
  registry.install(backgroundExtension);
  // Goal and Plan retain immutable context before request-only system hooks.
  // Their shared materializer repairs only source-owned trailing snapshots at
  // the SDK pinned cutoff; neither prompt moves across later tool results.
  if (goal) registry.install(createHostGoalPrompt(goal.addon, { root, runtime, assertOwner: assertGoal, failClosed(error, api) {
    const scope = taskModelHookScope(api);
    if (error instanceof GoalRequestDenied && scope) {
      try { assertGoal(); } catch (fatal) { lifetime.abort(fatal); return; }
      goalRequestDenials.set(scope.signal, error);
    } else lifetime.abort(error);
  } }));
  if (plan) registry.install(createHostPlanPrompt(plan.addon, { root, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); plan.assertCurrent(); }, failClosed(error) { lifetime.abort(error); } }));
  if (regretsPrompt) registry.install(regretsPrompt);
  if (observability) registry.install(createHostObservabilityPrompt(observability.addon, { root, runtime,
    assertOwner() { assert(); lifetime.signal.throwIfAborted(); observability.assertCurrent(); }, failClosed(error) { lifetime.abort(error); } }));
  if (goal) registry.install(createHostGoalTerminalFence(goal.addon, { root, runtime, assertOwner: assertGoal }));
  const commandPolicy = createHostCommandPolicy(root, () => { assert(); if (readAccessConfig().mode !== "single-user") throw Error("Native controls require single-user policy"); });
  const harnessOptions = { models, registry: withTaskModelRequestScope(registry), settings: commandPolicy.settings };
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")?.file;
  if (!path) throw Error("Durable default requires a file-backed application database");
  const storage = new BunSqliteDatabase(path, { root, assertOwner: assert, fenceTransactions: true });
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  let mapping!: { version: number; domain: string; bindings: { chatJid: string; branchId: string; conversationId: number; sessionId: string }[] };
  let primary: unknown;
  let backgroundContexts:readonly NativeBackgroundContext[]=[];
  let backgroundPayloads=new Map<string,NativeBackgroundPayload>();
  // Bootstrap publishes metadata even in explicit offline maintenance. Runtime
  // creation checks execution admission separately, before and after publication.
  async function publishApplicationBinding(tx: import("@earendil-works/pi-durable").Tx, domain: string, chatJid: string, branchId: string) {
    assert(); lifetime.signal.throwIfAborted();
    const doc = await tx.doc(ApplicationConversations, 1 as ConversationId);
    if (doc.domain !== domain || doc.bindings.some(b => b.chatJid === chatJid || b.branchId === branchId)) throw Error("Application mapping conflict");
    const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const instructions = instructionsFor(chatJid);
    await configure(tx, conversation.id, { model: { provider: ref.provider, modelId: ref.id }, thinkingLevel: defaultThinking(selected), tools, instructions });
    (await tx.doc(HostManagedInstructions, conversation.id)).managedHash = instructionHash(instructions);
    const binding = { chatJid, branchId, conversationId: conversation.id, sessionId: crypto.randomUUID() };
    const identity = { domain, chatJid, branchId, sessionId: binding.sessionId };
    const token = defineDoc({ kind: "app.application-identity", version: 1, scope: "conversation", history: "latest", fork: "initial", checkpointWhen: () => false, initial: () => identity });
    await tx.doc(token, conversation.id);
    doc.bindings.push(binding);
    assert(); lifetime.signal.throwIfAborted();
    return Object.freeze(binding);
  }
  let failed = false;
  try {
    assert();
    harness = await Harness.open(await SqliteStorage.open(storage), harnessOptions, context);
    // One application publication: root config, every initial conversation,
    // creation anchor and populated manifest share the public root-creation commit.
    const initial = !root.query("SELECT 1 FROM documents WHERE kind='\"app.application-conversations\"' AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL").get();
    if (initial) storeChatMetadata("web:default", new Date().toISOString());
    const initialBranches = initial ? root.query("SELECT c.jid,b.branch_id FROM chats c JOIN chat_branches b ON b.chat_jid=c.jid WHERE b.archived_at IS NULL ORDER BY c.jid").all() as { jid: string; branch_id: string }[] : [];
    const assertInitial = () => {
      assert(); lifetime.signal.throwIfAborted();
      if (initial && !offlineMaintenance) check(ref, lifetime.signal);
      for (const branch of initialBranches) if (!root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(branch.jid, branch.branch_id)) throw Error("Initial application branch changed");
    };
    const app = await storage.withAdmissionGuard(assertInitial, () => harness!.root(context, { init: async (tx, id) => {
      assertInitial();
      const doc = await tx.doc(ApplicationConversations, id);
      if (doc.domain || doc.bindings.length) throw Error("Application mapping conflict");
      doc.domain = crypto.randomUUID();
      const instructions = instructionsFor();
      await configure(tx, id, { model: { provider: ref.provider, modelId: ref.id }, thinkingLevel: defaultThinking(selected), tools, instructions });
      (await tx.doc(HostManagedInstructions, id)).managedHash = instructionHash(instructions);
      for (const branch of initialBranches) await publishApplicationBinding(tx, doc.domain, branch.jid, branch.branch_id);
      assertInitial();
    } }));
    const persisted = await harness.snapshot(ApplicationConversations, app.id, context);
    validateApplicationMapping(root, persisted);
    mapping = JSON.parse(JSON.stringify(persisted));
    backgroundContexts=readNativeBackgroundContexts(root,mapping.domain);
    backgroundPayloads=readNativeBackgroundPayloads(root,backgroundContexts,readBackgroundPayloadText);
    // Retired protocol history stays readable. Never resume its unfinished SDK
    // work or invent a terminal outcome after removing its execution owner.
    const retiredContexts=new Set([...backgroundPayloads.values()].filter(payload=>payload.policy.origin.kind==='addon').map(payload=>nativeBackgroundIdentity(payload.policy).contextKey));
    for(const retired of backgroundContexts){
      if(root.query("SELECT 1 FROM tasks WHERE conversation_id=? AND status<>'terminal' LIMIT 1").get(retired.conversationId)||
         root.query("SELECT 1 FROM submissions WHERE conversation_id=? AND status NOT IN ('done','unanswered') LIMIT 1").get(retired.conversationId)||
         root.query("SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND phase<>'terminal' LIMIT 1").get(retired.chatJid))
        throw Error(retiredContexts.has(retired.contextKey)?'A2A support was removed; unfinished retired add-on work requires explicit operator reconciliation':'Interrupted Dream SDK work has no live caller lease; explicit reconciliation is required without resubmission');
    }
    // Older native bootstrap omitted thinkingLevel entirely. Repair only that
    // omission through the public SDK; an explicitly selected off is preserved.
    const missingThinking = await app.commit(async tx => {
      const missing: ConversationId[] = [];
      for (const id of [app.id, ...mapping.bindings.map(binding => binding.conversationId as ConversationId)]) {
        const agent = await tx.doc(AgentDoc, id);
        if (agent.thinkingLevel === undefined && agent.model) missing.push(id);
      }
      return missing;
    }, context);
    // A no-op startup read must not demand global idleness: it would reject a
    // genuine paused compaction checkpoint before exact same-task recovery.
    if (missingThinking.length) {
      let idle = true;
      try { assertToolUpgradeIdle(root); }
      catch (error) {
        if (!(error instanceof Error) || !["Host tool upgrade requires idle host work", "Host tool upgrade requires idle SDK work"].includes(error.message)) throw error;
        idle = false;
      }
      if (idle) await storage.withIdleModelGuard(() => app.commit(async tx => {
        assert(); assertToolUpgradeIdle(root);
        for (const id of missingThinking) {
          const agent = await tx.doc(AgentDoc, id);
          if (agent.thinkingLevel !== undefined || !agent.model) continue;
          const model = models.getModel(agent.model.provider, agent.model.modelId);
          if (model) await configure(tx, id, { thinkingLevel: defaultThinking(model) });
        }
        assert(); assertToolUpgradeIdle(root);
      }, context));
    }
    validateApplicationMapping(root, mapping);
    if (toolUpgrades.length || instructionUpgrades.size) {
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
        for (const [id, instructions] of instructionUpgrades) {
          const agent = await tx.doc(AgentDoc, id as ConversationId);
          const metadata = await tx.doc(HostManagedInstructions, id as ConversationId);
          if (!shouldManageInstructions(agent.instructions, metadata.managedHash)) throw Error("Persisted host instructions changed");
          await configure(tx, id as ConversationId, { instructions });
          metadata.managedHash = instructionHash(instructions);
        }
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

      // Routes can be created after startup. The bundle publishes the persisted
      // SDK mapping atomically; the preparation-time mapping is only a snapshot.
      const goalAdmission = (chat: string) => { assertAdmission(); assertGoal(); if (!bundle.sessionTargets.list().some(binding => binding.chatJid === chat)) throw Error("Unbound Goal chat"); };
      const goalInput = goal ? createHostGoalInput(goal.addon, goalAdmission) : undefined;
      const goalCommand = goal ? createHostGoalCommand(goal.addon, { root, assertAdmission: goalAdmission, admit: input => bundle.admitHostFollowup(input) }) : undefined;
      const goalProjectionOptions:Parameters<typeof createHostGoalSettlement>[1]|undefined=goal?{root,runtime,assertOwner:assertGoal,continuation:{
        addon:goal.addon,prepare:createHostGoalProgressReader(goal.addon,{runtime,assertOwner:assertGoal}),
        readPlan:createHostGoalPlanReader(root,plan!.addon,goal.addon),admit:input=>bundle.admitHostFollowup(input),
      }}:undefined;
      const goalSettlement=goal&&goalProjectionOptions?createHostGoalSettlement(goal.addon,goalProjectionOptions):undefined;
      const nativeGoalProjection=goal&&goalProjectionOptions?createNativeGoalProjection(goal.addon,goalProjectionOptions):undefined;
      bundle = await createApplicationBootstrapBundle({ root, path, ownership, offlineInitialize: true, answers, contentionSignal: lifetime.signal,
        background:{contexts:backgroundContexts,payloads:backgroundPayloads,
          assertCurrent(payload){check({provider:payload.policy.model.provider,id:payload.policy.model.modelId},lifetime.signal);assertBackgroundCurrent(payload);
            const model=host.modelRuntime.getPhysicalModel(payload.policy.model.provider,payload.policy.model.modelId)!;assertNativeBackgroundModel(payload.policy,model);},

          put(payload){assert();const file=payloadPath(payload.policy.sourceId),encoded=JSON.stringify(payload);if(Buffer.byteLength(encoded)>1024*1024)throw Error('Background payload exceeds storage bound');
            mkdirSync(payloadDir,{recursive:true});let fd:number,created=false;
            try{fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;}
            catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(readBackgroundPayloadText(payload.policy.sourceId)!==encoded)throw Error('Immutable background input collision');
              fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);}
            try{if(created)writeFileSync(fd,encoded,'utf8');fsyncSync(fd);}finally{closeSync(fd);}
            if(readBackgroundPayloadText(payload.policy.sourceId)!==encoded)throw Error('Background payload publication changed');
            const directory=openSync(payloadDir,'r');try{fsyncSync(directory);}finally{closeSync(directory);}
          },
          publish: (tx,payload)=>publishNativeBackgroundContext(tx,mapping.domain,payload,[...tools,...dreamTools].filter(tool=>payload.policy.allowedTools.includes(tool.name)),[registry.snapshot().extension('app.host-builtins')!,backgroundExtension],()=>{
            check({provider:payload.policy.model.provider,id:payload.policy.model.modelId},lifetime.signal);assertBackgroundCurrent(payload);
          }),
        },
        assertAdmission: input => processControls!.assertAdmission(input),
        assertInputAdmission(chat) { assertAdmission(); ensureLiveWatch(chat); },
        materializeAnswer: codex ? createHostCodexAnswerMaterializer({ root, cwd: WORKSPACE_DIR, answers, assertOwner: assert }) : undefined,
        async onMessageResult(input,result) {
          assert();
          const status=result.status;
          if (status.type!=="input" || (status.status!=="done" && !(status.status==="unanswered" && status.reason==="model_error"))) return;
          const primary=result.inputs[0];
          if (!primary || primary.chatJid!==input.chatJid || primary.conversationId!==input.conversationId) throw Error("Native reply source conflict");
          const messageId=`native-answer:${mapping.domain}:${input.conversationId}:${status.status==="done"?status.answer:"failed-"+status.id}`;
          if(getDb()!==root)throw Error("Native reply database binding changed");
          const existing=root.query("SELECT rowid,thread_id,is_bot_message,is_terminal_agent_reply FROM messages WHERE chat_jid=? AND id=?").get(input.chatJid,messageId) as {rowid:number;thread_id:number|null;is_bot_message:number;is_terminal_agent_reply:number}|null;
          if(existing){
            if(existing.is_bot_message!==1||existing.is_terminal_agent_reply!==1||existing.thread_id!==resolveAcceptedMessageThread(root,primary))throw Error("Native reply identity conflict");
            codexServices?.releaseTurn(result.runId);
            processControls!.onMessagePublished(primary,existing.rowid,result.answer?.processExit);
            const interaction=getMessageByRowId(input.chatJid,existing.rowid);
            if(interaction)terminalBroadcast?.("new_post",interaction as unknown as Record<string,unknown>);
            return;
          }
          const content=result.answer ? codex ? await renderCodexAnswer(root,WORKSPACE_DIR,input.chatJid,result.runId,result.answer.text,assert) : result.answer.text
            :modelFailureNotice(status.status==="unanswered"?status.detail:undefined,status.id);
          if(!content.trim())return; // A tool-only turn without its verified exit receipt is not a timeline reply.
          const applyGoal=status.status==="done"&&!result.answer?.processExit&&nativeGoalProjection?await nativeGoalProjection(primary,result):undefined;
          const rowId=await admitSqliteWrite(root,()=>{
            assert();if(getDb()!==root)throw Error("Native reply database binding changed");
            const threadId=resolveAcceptedMessageThread(root,primary);
            const prior=root.query("SELECT rowid,thread_id,is_bot_message,is_terminal_agent_reply FROM messages WHERE chat_jid=? AND id=?").get(input.chatJid,messageId) as {rowid:number;thread_id:number|null;is_bot_message:number;is_terminal_agent_reply:number}|null;
            if(prior){
              if(prior.is_bot_message!==1||prior.is_terminal_agent_reply!==1||prior.thread_id!==threadId)throw Error("Native reply identity conflict");
              return prior.rowid; // Preserve original/user-edited history; no record rewrite on ACK repair.
            }
            const rowId=storeMessageInDatabase(root,{id:messageId,chat_jid:input.chatJid,sender:"assistant",sender_name:getIdentityConfig().assistantName,
              content,timestamp:new Date().toISOString(),is_from_me:true,is_bot_message:true,is_terminal_agent_reply:true,thread_id:threadId});
            if(applyGoal){
              const check=()=>{
                assertGoal();if(!root.inTransaction||getDb()!==root)throw Error("Native Goal publication transaction required");
                const publication=root.query("SELECT rowid FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=1 AND is_terminal_agent_reply=1").get(input.chatJid,messageId) as {rowid:number}|null;
                if(publication?.rowid!==rowId)throw Error("Native Goal publication identity changed");
              };
              const authority={extensionId:"goal",chatJid:input.chatJid,assertCurrent:check,write<T>(body:()=>T):T{check();const value=body();check();return value;}};
              withExtensionKvAuthority(authority,()=>applyGoal(authority,new Date().toISOString()));
            }
            return rowId;
          },assert,terminalLifetime.signal);
          codexServices?.releaseTurn(result.runId);
          processControls!.onMessagePublished(primary,rowId,result.answer?.processExit);
          const interaction=getMessageByRowId(input.chatJid,rowId);
          if(interaction)terminalBroadcast?.("new_post",interaction as unknown as Record<string,unknown>);
          if(goal&&!result.answer?.processExit)wakeGoalFollowups(input.chatJid);
        },
    onExecutionSettled(workId) { codexServices?.releaseTurn(workId); assert(); },
    async onOperationSettled(operationId, processExit) {
      codexServices?.releaseTurn(operationId);
      assert();
      if (processExit || processControls!.ownsOperation(operationId)) {
        publishTerminal(operationId);
        processControls!.onOperationSettled(operationId, processExit);
        return; // No Goal or queue continuation after a committed exit receipt.
      }
      publishTerminal(operationId);
      const row = root.query("SELECT chat_jid FROM service_effect_s01_operations WHERE operation_id=?").get(operationId) as { chat_jid: string } | null;
      if (row) { if (goal) wakeGoalFollowups(row.chat_jid); drainPending(row.chat_jid); }
    },
    onRuntime(value) { captureRuntime = value; },
        prepareInputText: goalInput, prepareTerminalEffect: goalSettlement,
        readExecutionPolicy: commandPolicy.read,
        setExecutionPolicy: commandPolicy.set,
        prepareInterruptedScheduledHarness: identity => runtime().captureInterruptedScheduledHarness(identity),
        requestProcessExit: reason => processControls!.requestCommandExit(reason),
        dispatchHostCommand: (regrets || goalCommand) ? async (chat, text) => {
          if (regrets && /^\/regrets(?:\s|$)/.test(text.trim())) { await regretsCommand(chat); return { status: "success", message: "Regrets input queued" }; }
          if (goalCommand) { const result = await goalCommand(chat, text); wakeGoalFollowups(chat); return result; }
          return { status: "error", message: "Unknown host command" };
        } : undefined,
    observeSidePrompt(sourceId, observer) {
      assert();
      if (sideObservers.has(sourceId)) throw Error("Side prompt observer already registered");
      sideObservers.set(sourceId, observer);
      return () => { if (sideObservers.get(sourceId) === observer) sideObservers.delete(sourceId); };
    },
    manifest: mapping.bindings.map(({ chatJid, branchId, conversationId }) => ({ chatJid, branchId, conversationId: conversationId as ConversationId })),
    sessions: new Map(mapping.bindings.map(binding => [binding.chatJid, binding.sessionId])),
    assertConversationAvailable() { assertAdmission(); check(ref, lifetime.signal); },
    resolveScheduledModel(label) {
      const slash = label.indexOf("/");
      const choice = { provider: label.slice(0, slash), id: label.slice(slash + 1) };
      check(choice, lifetime.signal);
      const physical = host.modelRuntime.getPhysicalModel(choice.provider, choice.id)!;
      if (!Number.isFinite(physical.contextWindow) || physical.contextWindow <= 0 ||
        !Number.isFinite(physical.maxTokens) || physical.maxTokens < 0) throw Error("Model context unavailable");
      return { provider: choice.provider, modelId: choice.id };
    },
    historicalBindings: true,
    async createConversation(tx, chatJid, branchId) {
      check(ref, lifetime.signal);
      const binding = await publishApplicationBinding(tx, mapping.domain, chatJid, branchId);
      check(ref, lifetime.signal);
      return binding;
    },
    runtime: { onStorageFailure: notifyStorageFailure, incarnation: mapping.domain, sessionId: mapping.domain, now: () => new Date().toISOString(), harnessOptions,
      codemodeExecute: tools.find(tool => tool.name === "codemode")!.execute } }, context);
  if (remotePeer) {
    const native = await import(pathToFileURL(join(remotePeer.source.packageDir, "native.ts")).href);
    assertRemote();
    const canonical = (target: any) => {
      assertRemote();
      const row = root.query("SELECT agent_name FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(target.chatJid, target.branchId) as { agent_name: string } | null;
      if (!row?.agent_name) throw Error("Canonical peer target unavailable");
      return { ...target, agentName: row.agent_name };
    };
    remotePorts = await native.bindNativeRemotePeer({ ...remotePeerOptions, dataDir: join(DATA_DIR, "addons", "remote-peer"),
      nativeRootServiceOwner: { assertCurrent() { assert(); remotePeer.assertCurrent(); if (readAccessConfig().mode !== "single-user") throw Error("Remote Peer policy revoked"); } },
      bundle: { sessionTargets: { list: () => bundle.sessionTargets.list().map(canonical), resolve: (target: any) => canonical(bundle.sessionTargets.resolve(target)) },
        admitApplicationInput: (input: any) => { assertAdmission(); return bundle.admitApplicationInput(input); },
        steerApplicationInput: (input: any) => { assertAdmission(); return bundle.steerApplicationInput(input); } },
      scopedRoot: <T>(assertCurrent: () => void, body: () => T) => {
        assertCurrent(); const result = body();
        if (result instanceof Promise) return result.then(value => { assertCurrent(); return value; }) as T;
        assertCurrent(); return result;
      },
      registerChatTransport,
    });
    for (const action of ["config", "dashboard"] as const) {
      const handlers = action === "config" ? { get: () => remotePorts.config.get(), set: (input: any) => remotePorts.config.set(input) }
        : { get: () => remotePorts.authority.application("dashboard.get", () => remotePorts.service.dashboard(remotePorts.localContext())),
            set: (input: any) => remotePorts.authority.application("dashboard.set", () => remotePorts.dashboard({ chatJid: "", cwd: WORKSPACE_DIR, assertCurrent: assertRemote }, input)) };
      const registration = registerOwnedAddonConfigApi("remote-peer", action, handlers, remotePeer.source.packageDir);
      remoteDisposers.push(registration.dispose);
    }
    remoteDisposers.push(registerChatTransport(remotePorts.chatTransport));
    if (!offlineMaintenance) await remotePorts.start();
  }
  if (regrets) {
    const settings = createHostRegretsSettings(regretsAddon, async () => {
      assertRegrets(); const target = bundle.sessionTargets.list()[0];
      if (!target) throw Error("Regrets application configuration unavailable");
      return regretsPorts(target.chatJid, assertRegrets, configWrite, { getAvailable: () => host.modelRuntime.getAvailableSnapshot().filter(model => available.some(a => a.provider === model.provider && a.id === model.id)) });
    });
    registerAddonConfigApi("late-night-regrets", "config", { get: () => settings.getConfig(), set: patch => settings.setConfig(patch) }, regrets.source.packageDir);
    registerAddonConfigApi("late-night-regrets", "models", { get: () => settings.getModels() }, regrets.source.packageDir);
  }
  if (goal) {
    const config = createHostGoalConfig(goal.addon, { assertAdmission: goalAdmission, admit: input => bundle.admitHostFollowup(input) });
    const chatFrom = (payload: unknown, request: Request) => {
      const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const chat = new URL(request.url).searchParams.get("chat_jid") || body.chat_jid;
      if (typeof chat !== "string" || !chat.trim()) throw Error("Explicit Goal Settings chat required");
      return chat.trim();
    };
    registerAddonConfigApi("goal", "goal", {
      get(payload, request) { return config.get(chatFrom(payload, request)); },
      async set(payload, request) {
        const chat = chatFrom(payload, request);
        const result = await config.set(chat, payload && typeof payload === "object" ? payload as Record<string, unknown> : {});
        wakeGoalFollowups(chat); return result;
      },
    }, goal.source.packageDir);
  }
  if (!offlineMaintenance) await bundle.retryRecoveredWork();
  const dispatchDreamOperation=async(request:NativeDreamRequest):Promise<AgentOutput>=>{
    const signal=request.signal??new AbortController().signal;signal.throwIfAborted();
    assertAdmission();const checkInvocation=request.assertCurrent.bind(request);checkInvocation();
    const invocation=Object.freeze({invocationId:request.invocationId,chatJid:request.chatJid,mode:request.mode,days:request.days,model:request.model,timeoutMs:request.timeoutMs,acceptedAt:request.acceptedAt});
    if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(invocation.invocationId)||!invocation.chatJid||!['manual','auto'].includes(invocation.mode)||!Number.isSafeInteger(invocation.days)||invocation.days<1||!Number.isSafeInteger(invocation.timeoutMs)||invocation.timeoutMs<1)throw Error('Invalid Dream invocation');
    const label=invocation.model?.trim(),choices=available.filter(model=>label?(model.provider+'/'+model.id===label||model.id===label):(model.provider===ref.provider&&model.id===ref.id));
    if(choices.length!==1)throw Error('Exact approved Dream model required');const choice=choices[0]!;check(choice,lifetime.signal);
    const physical=host.modelRuntime.getPhysicalModel(choice.provider,choice.id)!;
    const allowedTools=['read','edit','write','grep','find','ls','messages','search_workspace'];
    if(allowedTools.some(name=>![...tools,...dreamTools].some(tool=>tool.name===name)))throw Error('Full native Dream tool set unavailable');
    const acceptedAt=invocation.acceptedAt;if(!Number.isFinite(Date.parse(acceptedAt))||new Date(acceptedAt).toISOString()!==acceptedAt||Date.parse(acceptedAt)>Date.now())throw Error('Original Dream admission time required');
    const invocationId=invocation.invocationId;
    const payload=createNativeBackgroundPayload({origin:{kind:'dream',invocationId,chatJid:invocation.chatJid,mode:invocation.mode},workId:'background:dream:'+invocationId,parentWorkId:null,
      model:{provider:physical.provider,modelId:physical.id,api:physical.api},allowedTools,maxToolCalls:null,acceptedAt,expiresAt:new Date(Date.parse(acceptedAt)+invocation.timeoutMs).toISOString(),prompt:buildDreamPrompt(invocation),instructions:instructionsFor()});
    const identity=nativeBackgroundIdentity(payload.policy);checkInvocation();assertNativeBackgroundDeadline(payload.policy,Date.now());
    if(dreamOwners.has(payload.policy.sourceId))throw Error('Dream invocation already has a live owner');
    dreamOwners.set(payload.policy.sourceId,{payload,assertCurrent:checkInvocation});
    try{
      assertDreamCurrent(payload);const result=await bundle.dispatchDreamPayload(payload,signal);checkInvocation();
      if(result.status==='success'&&codex&&result.result){
        try {
          result.result=await renderCodexAnswer(root,WORKSPACE_DIR,identity.chatJid,payload.policy.sourceId,result.result,()=>{assert();checkInvocation();});
        } catch (error) {
          assert();checkInvocation();
          log.warn('Dream SDK result retained without optional artifact projection',{operation:'durable_dream.artifact_projection_failed',err:error});
        }
      }
      return result;
    }
    finally{codexServices?.releaseTurn(payload.policy.sourceId);dreamOwners.delete(payload.policy.sourceId);}
  };
  let closing: Promise<void> | undefined;
  const backend: RuntimeBackend = { storageFailure, sessionOptions: offlineMaintenance ? { getDurableSession(chat) {
      const position = bundle.sessionOptions.getDurableSession?.(chat);
      return position && { ...position, compact: async () => { throw Error("Offline maintenance cannot admit compaction"); } };
    },
    dispatchDreamOperation:async()=>{throw Error('Offline maintenance cannot execute Dream');},
    dispatchScheduledAgent: async () => { throw Error("Offline maintenance cannot admit conversations"); }, dispatchSidePrompt: async () => { throw Error("Offline maintenance cannot admit conversations"); },
    dispatchHostCommand: async () => { throw Error("Offline maintenance cannot admit conversations"); } } : {...bundle.sessionOptions,dispatchDreamOperation},
    bind(options) {
      assertAdmission(); nativeQueue=options.queue; // Resource-idle check for process controls only.
      return Object.freeze({ ...bundle.bind(options), resumeNativeInputs(chatJid?: string) {
        assertAdmission();
        const targets = bundle.sessionTargets.list().filter(target => !chatJid || chatJid === "all" || target.chatJid === chatJid);
        if (chatJid && chatJid !== "all" && targets.length === 0) throw Error("Unbound native input target");
        for (const target of targets) drainPending(target.chatJid);
      } });
    },
    attachChannel(channel) {
      assertAdmission();
      assert(); lifetime.signal.throwIfAborted();
      if (widgetPublisher) throw Error("Widget channel already attached");
      const broadcast = channel.broadcastEvent.bind(channel);
      terminalBroadcast = broadcast;
      for (const operationId of pendingTerminalEvents) publishTerminal(operationId);
      bundle.bindInputProjection({ pendingLinkPreviews: new Set<number>(), broadcastEvent: (event, data) => broadcast(event, data as Record<string, unknown>) });
      liveChannel = channel;
      for (const target of bundle.sessionTargets.list()) ensureLiveWatch(target.chatJid);
      workspaceFileOpener = channel.requestWorkspaceFileOpen?.bind(channel);
      widgetPublisher = (chatJid, key, content, options) => {
        assert(); lifetime.signal.throwIfAborted();
        broadcast("extension_ui_widget", { chat_jid: chatJid, key, content, options });
      };
      for (const target of bundle.sessionTargets.list()) drainPending(target.chatJid,true);
    },
    stop() {
      stopLiveViews();
      bundle.bindInputProjection(undefined);
      terminalBroadcast = undefined; pendingTerminalEvents.clear(); publishedTerminalEvents.clear();
      widgetPublisher = undefined; workspaceFileOpener = undefined;
      // Stop producers/observers, not execution dependencies. Aborting the model
      // bridge while the SDK can still commit would manufacture model_error and
      // consume the accepted input instead of preserving its request checkpoint.
      bundle.stop();
    }, close() {
      return closing ??= (async () => {
      bundle.bindInputProjection(undefined);
      widgetPublisher = undefined; workspaceFileOpener = undefined;
      bundle.stop();
      // Finish/stop display handshakes while their SDK reader still exists.
      // Admission is already sealed; neither watch nor delivery may restart it.
      await closeLiveViews();
      // Public SDK close seals scheduling and joins invocations without writing
      // cancellation outcomes. Keep tool/provider dependencies alive until then.
      // If close is uncertain or held maintenance cannot join, retain them and
      // ownership; the operator's process-wide backstop still bounds shutdown.
      await bundle.close();
      await Promise.allSettled([...usageReports]);
      const producerResults = await Promise.allSettled([closeRemote(), closeCodex()]);
      terminalLifetime.abort(); lifetime.abort(); closeResources(); releaseAdminKv?.(); closeInfrastructure(); releaseReviewSource?.(); releaseObservabilityConfiguration?.();
      const results = [...producerResults, ...await Promise.allSettled([mcp?.close(), closeSandbox(), drawioHost?.close()])];
      const failures: unknown[] = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, "Native tool cleanup uncertain");
      })();
    } };
  closeForProcessControl = () => backend.close();
  return backend;
  } catch (error) {
    // A post-construction failure still owns a live SDK scheduler/storage graph.
    // Join it before invalidating execution dependencies or financial ownership.
    if (typeof bundle !== 'undefined') {
      try { bundle.stop(); await bundle.close(); }
      catch (cleanup) { throw new RuntimeStartupCleanupError([error, cleanup], 'Application startup cleanup uncertain'); }
    }
    const cleanupFailures: unknown[] = [];
    for (const release of [() => terminalLifetime.abort(), () => lifetime.abort(), closeResources, releaseAdminKv,
      closeInfrastructure, releaseReviewSource, releaseObservabilityConfiguration]) {
      try { release?.(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    }
    try { await closeRemote(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await closeCodex(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await mcp?.close(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await closeSandbox(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    try { await drawioHost?.close(); } catch (cleanup) { cleanupFailures.push(cleanup); }
    if (cleanupFailures.length) throw new RuntimeStartupCleanupError([error, ...cleanupFailures], "Native tool preparation cleanup uncertain");
    // Inner cleanup uncertainty cannot be repaired by disposing outer tools.
    if (error instanceof RuntimeStartupCleanupError) throw error;
    // Certify only after every partial SDK/tool/ownership resource has closed.
    // This permits another preparation, never replay of an existing invocation.
    throw new RuntimePreparationError(error, isSqliteContention(error) || (error instanceof HostEffectError && error.retryableStorage));
  }
}
